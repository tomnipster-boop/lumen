import { invoke, isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef } from "react";

type UiSoundName = "boot" | "scroll" | "select" | "back";

interface UiSoundSpec {
  path: string;
  gain: number;
}

const UI_SOUNDS: Record<UiSoundName, UiSoundSpec> = {
  boot: { path: "/audio/bootup.mp3", gain: 0.82 },
  scroll: { path: "/audio/scrolling-click.wav", gain: 0.72 },
  select: { path: "/audio/select-click.wav", gain: 0.56 },
  back: { path: "/audio/back-noise.wav", gain: 0.88 },
};

// The first navigation tick is dispatched immediately. Only simultaneous
// multi-step rotation events are separated, and even a dense burst is kept
// close enough to the input to sound like the cards crossing—not landing.
const SCROLL_GAP_SECONDS = 0.01;
const COMPRESSED_SCROLL_GAP_SECONDS = 0.0035;
const SCROLL_QUEUE_HORIZON_SECONDS = 0.032;
const MAX_PENDING_INPUT_SOUNDS = 8;
const AUDIO_WARMUP_FRAMES = 512;

export function useUiSounds() {
  const contextRef = useRef<AudioContext | undefined>(undefined);
  const outputRef = useRef<GainNode | undefined>(undefined);
  const buffersRef = useRef<Partial<Record<UiSoundName, AudioBuffer>>>({});
  const pendingRef = useRef<Record<UiSoundName, number>>({ boot: 0, scroll: 0, select: 0, back: 0 });
  const activeSourcesRef = useRef(new Map<AudioBufferSourceNode, GainNode>());
  const nextScrollAtRef = useRef(0);
  const nativeTimersRef = useRef(new Set<number>());

  const scheduleNative = useCallback((name: UiSoundName) => {
    const now = performance.now() / 1000;
    let startAt = now;
    if (name === "scroll") {
      startAt = Math.max(now, nextScrollAtRef.current);
      const queueDepth = Math.max(0, startAt - now);
      const pressure = Math.min(1, queueDepth / SCROLL_QUEUE_HORIZON_SECONDS);
      const gap = SCROLL_GAP_SECONDS
        + (COMPRESSED_SCROLL_GAP_SECONDS - SCROLL_GAP_SECONDS) * pressure;
      nextScrollAtRef.current = startAt + gap;
    }

    const dispatch = () => {
      void invoke("play_ui_sound", { sound: name })
        .catch((reason) => console.warn(`Lumen could not play its ${name} sound.`, reason));
    };
    const delay = Math.max(0, (startAt - now) * 1000);
    if (delay < 1) {
      dispatch();
      return;
    }
    const timer = window.setTimeout(() => {
      nativeTimersRef.current.delete(timer);
      dispatch();
    }, delay);
    nativeTimersRef.current.add(timer);
  }, []);

  const scheduleDecoded = useCallback((name: UiSoundName) => {
    const context = contextRef.current;
    const output = outputRef.current;
    const buffer = buffersRef.current[name];
    if (!context || context.state === "closed" || !output || !buffer) return;

    const now = context.currentTime;
    let startAt = now;
    if (name === "scroll") {
      startAt = Math.max(now, nextScrollAtRef.current);
      const queueDepth = Math.max(0, startAt - now);
      const pressure = Math.min(1, queueDepth / SCROLL_QUEUE_HORIZON_SECONDS);
      const gap = SCROLL_GAP_SECONDS
        + (COMPRESSED_SCROLL_GAP_SECONDS - SCROLL_GAP_SECONDS) * pressure;
      nextScrollAtRef.current = startAt + gap;
    }

    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    gain.gain.setValueAtTime(UI_SOUNDS[name].gain, startAt);
    source.connect(gain);
    gain.connect(output);
    activeSourcesRef.current.set(source, gain);
    source.addEventListener("ended", () => {
      activeSourcesRef.current.delete(source);
      source.disconnect();
      gain.disconnect();
    }, { once: true });
    source.start(startAt);
  }, []);

  const playDecoded = useCallback((name: UiSoundName) => {
    const context = contextRef.current;
    if (!context || context.state === "closed") return;
    if (context.state === "suspended") {
      void context.resume()
        .then(() => scheduleDecoded(name))
        .catch((reason) => console.warn(`Lumen could not resume ${name} audio.`, reason));
      return;
    }
    scheduleDecoded(name);
  }, [scheduleDecoded]);

  const play = useCallback((name: UiSoundName) => {
    if (isTauri()) {
      scheduleNative(name);
      return;
    }
    if (buffersRef.current[name]) {
      playDecoded(name);
      return;
    }
    if (name === "boot") {
      pendingRef.current.boot = 1;
    } else {
      pendingRef.current[name] = Math.min(
        MAX_PENDING_INPUT_SOUNDS,
        pendingRef.current[name] + 1,
      );
    }
  }, [playDecoded, scheduleNative]);

  useEffect(() => () => {
    nativeTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    nativeTimersRef.current.clear();
  }, []);

  useEffect(() => {
    if (isTauri()) return;
    let cancelled = false;
    const context = new AudioContext({ latencyHint: "interactive" });
    const output = context.createGain();
    output.gain.value = 0.9;
    output.connect(context.destination);
    contextRef.current = context;
    outputRef.current = output;

    // WebKitGTK creates its native output pipeline lazily. A tiny silent source
    // pays that setup cost during the early splash without queueing seconds of
    // silence in front of the audible final pulse.
    const warmup = context.createBufferSource();
    const warmupGain = context.createGain();
    warmup.buffer = context.createBuffer(1, AUDIO_WARMUP_FRAMES, context.sampleRate);
    warmupGain.gain.value = 0;
    warmup.connect(warmupGain);
    warmupGain.connect(output);
    warmup.start();
    warmup.addEventListener("ended", () => {
      warmup.disconnect();
      warmupGain.disconnect();
    }, { once: true });
    void context.resume().catch(() => {
      // A later trusted controller/keyboard action will retry resume if the
      // host browser enforces a user-activation policy.
    });

    (Object.entries(UI_SOUNDS) as [UiSoundName, UiSoundSpec][]).forEach(([name, spec]) => {
      void fetch(spec.path)
        .then((response) => {
          if (!response.ok) throw new Error(`${spec.path} returned ${response.status}`);
          return response.arrayBuffer();
        })
        .then((encoded) => context.decodeAudioData(encoded))
        .then((buffer) => {
          if (cancelled) return;
          buffersRef.current[name] = buffer;
          const pending = pendingRef.current[name];
          pendingRef.current[name] = 0;
          for (let index = 0; index < pending; index += 1) playDecoded(name);
        })
        .catch((reason) => {
          if (!cancelled) console.warn(`Lumen could not load its ${name} sound.`, reason);
        });
    });

    return () => {
      cancelled = true;
      activeSourcesRef.current.forEach((gain, source) => {
        try { source.stop(); } catch { /* The source may already have ended. */ }
        source.disconnect();
        gain.disconnect();
      });
      activeSourcesRef.current.clear();
      buffersRef.current = {};
      pendingRef.current = { boot: 0, scroll: 0, select: 0, back: 0 };
      nextScrollAtRef.current = 0;
      contextRef.current = undefined;
      outputRef.current = undefined;
      try { warmup.stop(); } catch { /* The warmup may already have ended. */ }
      warmup.disconnect();
      warmupGain.disconnect();
      output.disconnect();
      void context.close();
    };
  }, [playDecoded]);

  return {
    playBoot: useCallback(() => play("boot"), [play]),
    playScroll: useCallback(() => play("scroll"), [play]),
    playSelect: useCallback(() => play("select"), [play]),
    playBack: useCallback(() => play("back"), [play]),
  };
}
