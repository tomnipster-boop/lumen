import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import type { LaunchExited, LaunchState } from "../types/game";

export type ActiveLaunch = LaunchState;

interface LaunchLifecycleOptions {
  onExited: (event: LaunchExited) => void;
  refreshLibrary: () => Promise<void>;
}

function messageFrom(error: unknown): string {
  return typeof error === "string" ? error : "Lumen could not start that game.";
}

export function useLaunchLifecycle({
  onExited,
  refreshLibrary,
}: LaunchLifecycleOptions) {
  const [activeLaunch, setActiveLaunch] = useState<ActiveLaunch>();
  const onExitedRef = useRef(onExited);
  const refreshRef = useRef(refreshLibrary);
  onExitedRef.current = onExited;
  refreshRef.current = refreshLibrary;

  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    const unlisteners: Array<() => void> = [];

    void invoke<LaunchState | null>("get_launch_state")
      .then((state) => {
        if (!disposed && state) setActiveLaunch(state);
      })
      .catch((error) => console.warn("Launch state could not be restored.", error));

    void Promise.all([
      listen<LaunchState>("game://started", ({ payload }) => {
        if (!disposed) setActiveLaunch({ ...payload, phase: "running" });
      }),
      listen<LaunchState>("game://paused", ({ payload }) => {
        if (!disposed) setActiveLaunch({ ...payload, phase: "paused" });
      }),
      listen<LaunchState>("game://resumed", ({ payload }) => {
        if (!disposed) setActiveLaunch({ ...payload, phase: "running" });
      }),
      listen<LaunchExited>("game://exited", ({ payload }) => {
        if (disposed) return;
        setActiveLaunch((current) =>
          current?.gameId === payload.gameId ? undefined : current,
        );
        void refreshRef.current().finally(() => onExitedRef.current(payload));
      }),
    ]).then((ready) => {
      if (disposed) ready.forEach((unlisten) => unlisten());
      else unlisteners.push(...ready);
    });

    return () => {
      disposed = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, []);

  const launch = useCallback(async (gameId: string, title: string, audioOutput?: string) => {
    if (!isTauri()) throw new Error("Games can only be launched from the Lumen desktop app.");
    const optimistic: ActiveLaunch = {
      gameId,
      title,
      startedAt: new Date().toISOString(),
      phase: "launching",
    };
    setActiveLaunch(optimistic);
    try {
      const state = await invoke<LaunchState>("launch_game", { id: gameId, audioOutput });
      setActiveLaunch((current) =>
        current?.gameId === gameId ? state : current,
      );
      return state;
    } catch (error) {
      setActiveLaunch((current) =>
        current?.gameId === gameId ? undefined : current,
      );
      throw new Error(messageFrom(error));
    }
  }, []);

  const resume = useCallback(async () => {
    if (!isTauri()) throw new Error("Games can only be resumed from the Lumen desktop app.");
    const state = await invoke<LaunchState>("resume_game");
    setActiveLaunch(state);
    return state;
  }, []);

  const quit = useCallback(async () => {
    if (!isTauri()) throw new Error("Games can only be closed from the Lumen desktop app.");
    await invoke("quit_game");
  }, []);

  return { activeLaunch, launch, resume, quit };
}
