use serde::Deserialize;
use std::{
    io::{self, Write},
    process::{Child, ChildStdin, Command, Stdio},
    sync::mpsc::{self, Receiver, Sender, TryRecvError},
    thread,
    time::{Duration, Instant},
};
use tauri::State;

use crate::launcher::remove_appimage_environment;

const SAMPLE_RATE: u32 = 48_000;
const OUTPUT_CHANNELS: usize = 2;
const CHUNK_FRAMES: usize = 240;
const CHUNK_DURATION: Duration = Duration::from_millis(5);
const PREROLL_CHUNKS: usize = 6;
const PLAYER_RETRY_DELAY: Duration = Duration::from_secs(1);

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum UiSound {
    Boot,
    Scroll,
    Select,
    Back,
}

struct Clip {
    samples: Vec<i16>,
    gain: f32,
}

impl Clip {
    fn frame_count(&self) -> u64 {
        (self.samples.len() / OUTPUT_CHANNELS) as u64
    }
}

struct SoundBank {
    boot: Clip,
    scroll: Clip,
    select: Clip,
    back: Clip,
}

impl SoundBank {
    fn load() -> Result<Self, String> {
        Ok(Self {
            boot: decode_wav(include_bytes!("../../public/audio/bootup.wav"), 0.74)?,
            scroll: decode_wav(
                include_bytes!("../../public/audio/scrolling-click.wav"),
                0.82,
            )?,
            select: decode_wav(include_bytes!("../../public/audio/select-click.wav"), 0.50)?,
            back: decode_wav(include_bytes!("../../public/audio/back-noise.wav"), 0.79)?,
        })
    }

    fn get(&self, sound: UiSound) -> &Clip {
        match sound {
            UiSound::Boot => &self.boot,
            UiSound::Scroll => &self.scroll,
            UiSound::Select => &self.select,
            UiSound::Back => &self.back,
        }
    }
}

fn read_u16(bytes: &[u8], offset: usize) -> Result<u16, String> {
    let value = bytes
        .get(offset..offset + 2)
        .ok_or_else(|| "The WAV header is truncated.".to_string())?;
    Ok(u16::from_le_bytes([value[0], value[1]]))
}

fn read_u32(bytes: &[u8], offset: usize) -> Result<u32, String> {
    let value = bytes
        .get(offset..offset + 4)
        .ok_or_else(|| "The WAV header is truncated.".to_string())?;
    Ok(u32::from_le_bytes([value[0], value[1], value[2], value[3]]))
}

fn decode_wav(bytes: &[u8], gain: f32) -> Result<Clip, String> {
    if bytes.get(0..4) != Some(b"RIFF") || bytes.get(8..12) != Some(b"WAVE") {
        return Err("A bundled UI sound is not a RIFF/WAVE file.".to_string());
    }

    let mut channels = None;
    let mut sample_rate = None;
    let mut bits_per_sample = None;
    let mut format = None;
    let mut pcm = None;
    let mut offset = 12usize;

    while offset + 8 <= bytes.len() {
        let id = &bytes[offset..offset + 4];
        let size = read_u32(bytes, offset + 4)? as usize;
        let body = offset + 8;
        let end = body
            .checked_add(size)
            .filter(|end| *end <= bytes.len())
            .ok_or_else(|| "A bundled WAV chunk is truncated.".to_string())?;

        if id == b"fmt " && size >= 16 {
            format = Some(read_u16(bytes, body)?);
            channels = Some(read_u16(bytes, body + 2)?);
            sample_rate = Some(read_u32(bytes, body + 4)?);
            bits_per_sample = Some(read_u16(bytes, body + 14)?);
        } else if id == b"data" {
            pcm = Some(&bytes[body..end]);
        }

        offset = end + (size & 1);
    }

    if format != Some(1) || bits_per_sample != Some(16) || sample_rate != Some(SAMPLE_RATE) {
        return Err("UI sounds must be 48kHz signed 16-bit PCM WAV files.".to_string());
    }
    let channels = channels.ok_or_else(|| "A bundled WAV has no channel count.".to_string())?;
    if channels != 1 && channels != 2 {
        return Err("UI sounds must be mono or stereo.".to_string());
    }
    let pcm = pcm.ok_or_else(|| "A bundled WAV has no PCM data.".to_string())?;
    if pcm.len() % (channels as usize * 2) != 0 {
        return Err("A bundled WAV has an incomplete PCM frame.".to_string());
    }

    let decoded = pcm
        .chunks_exact(2)
        .map(|sample| i16::from_le_bytes([sample[0], sample[1]]))
        .collect::<Vec<_>>();
    let samples = if channels == 1 {
        decoded
            .into_iter()
            .flat_map(|sample| [sample, sample])
            .collect()
    } else {
        decoded
    };

    Ok(Clip { samples, gain })
}

struct ActiveClip {
    sound: UiSound,
    start_frame: u64,
}

struct RawPlayer {
    child: Child,
    stdin: ChildStdin,
}

impl RawPlayer {
    fn start() -> io::Result<Self> {
        let executable = if std::path::Path::new("/usr/bin/paplay").is_file() {
            "/usr/bin/paplay"
        } else {
            "paplay"
        };
        let mut command = Command::new(executable);
        remove_appimage_environment(&mut command);
        let mut child = command
            .args([
                "--raw",
                "--rate=48000",
                "--format=s16le",
                "--channels=2",
                "--channel-map=stereo",
                "--latency-msec=10",
                "--process-time-msec=5",
                "--client-name=Lumen",
                "--stream-name=UI Sounds",
            ])
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| io::Error::other("paplay did not open its audio input"))?;
        let mut player = Self { child, stdin };
        let silence = vec![0u8; CHUNK_FRAMES * OUTPUT_CHANNELS * 2];
        for _ in 0..PREROLL_CHUNKS {
            player.stdin.write_all(&silence)?;
        }
        Ok(player)
    }

    fn write(&mut self, bytes: &[u8]) -> io::Result<()> {
        self.stdin.write_all(bytes)
    }
}

impl Drop for RawPlayer {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn mix_chunk(bank: &SoundBank, active: &mut Vec<ActiveClip>, frame: u64) -> Vec<u8> {
    let chunk_end = frame + CHUNK_FRAMES as u64;
    let mut mixed = vec![0i32; CHUNK_FRAMES * OUTPUT_CHANNELS];

    for playing in active.iter() {
        let clip = bank.get(playing.sound);
        let clip_end = playing.start_frame + clip.frame_count();
        let overlap_start = frame.max(playing.start_frame);
        let overlap_end = chunk_end.min(clip_end);
        if overlap_start >= overlap_end {
            continue;
        }

        for absolute_frame in overlap_start..overlap_end {
            let source_frame = (absolute_frame - playing.start_frame) as usize;
            let output_frame = (absolute_frame - frame) as usize;
            for channel in 0..OUTPUT_CHANNELS {
                let source = clip.samples[source_frame * OUTPUT_CHANNELS + channel] as f32;
                mixed[output_frame * OUTPUT_CHANNELS + channel] += (source * clip.gain) as i32;
            }
        }
    }

    active
        .retain(|playing| playing.start_frame + bank.get(playing.sound).frame_count() > chunk_end);

    let mut encoded = Vec::with_capacity(mixed.len() * 2);
    for sample in mixed {
        encoded.extend_from_slice(
            &(sample.clamp(i16::MIN as i32, i16::MAX as i32) as i16).to_le_bytes(),
        );
    }
    encoded
}

fn audio_worker(receiver: Receiver<UiSound>, bank: SoundBank) {
    let mut player = RawPlayer::start().ok();
    let mut retry_at = Instant::now() + PLAYER_RETRY_DELAY;
    let mut active = Vec::new();
    let mut frame = 0u64;
    let mut connected = true;
    let mut next_tick = Instant::now();

    while connected || !active.is_empty() {
        next_tick += CHUNK_DURATION;
        loop {
            match receiver.try_recv() {
                Ok(sound) => active.push(ActiveClip {
                    sound,
                    start_frame: frame,
                }),
                Err(TryRecvError::Empty) => break,
                Err(TryRecvError::Disconnected) => {
                    connected = false;
                    break;
                }
            }
        }

        let chunk = mix_chunk(&bank, &mut active, frame);
        frame += CHUNK_FRAMES as u64;

        if player.is_none() && Instant::now() >= retry_at {
            player = RawPlayer::start().ok();
            retry_at = Instant::now() + PLAYER_RETRY_DELAY;
        }
        if let Some(output) = player.as_mut() {
            if output.write(&chunk).is_err() {
                player = None;
                retry_at = Instant::now() + PLAYER_RETRY_DELAY;
            }
        }

        let now = Instant::now();
        if now < next_tick {
            thread::sleep(next_tick - now);
        }
    }
}

pub struct UiAudio {
    sender: Sender<UiSound>,
}

impl UiAudio {
    pub fn new() -> Self {
        let bank = SoundBank::load().expect("bundled UI sounds must be valid PCM WAV files");
        let (sender, receiver) = mpsc::channel();
        thread::Builder::new()
            .name("lumen-ui-audio".to_string())
            .spawn(move || audio_worker(receiver, bank))
            .expect("Lumen must be able to start its UI audio worker");
        Self { sender }
    }

    fn play(&self, sound: UiSound) -> Result<(), String> {
        self.sender
            .send(sound)
            .map_err(|_| "Lumen's UI audio worker is unavailable.".to_string())
    }
}

#[tauri::command]
pub fn play_ui_sound(audio: State<'_, UiAudio>, sound: UiSound) -> Result<(), String> {
    audio.play(sound)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_sounds_are_valid_stereo_pcm() {
        let bank = SoundBank::load().expect("embedded sounds should decode");
        assert!(bank.boot.frame_count() > SAMPLE_RATE as u64);
        assert!(bank.scroll.frame_count() < SAMPLE_RATE as u64 / 10);
        assert!(bank.select.frame_count() > bank.scroll.frame_count());
        assert!(bank.back.frame_count() > bank.scroll.frame_count());
        assert!(bank.scroll.samples.len() % OUTPUT_CHANNELS == 0);
    }
}
