use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::{Seek, SeekFrom, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::{SystemTime, UNIX_EPOCH};
use tracing::{info, warn};
#[cfg(windows)]
use windows::Win32::Media::Audio::WAVEFORMATEX;
#[cfg(windows)]
use windows::Win32::Media::KernelStreaming::{KSDATAFORMAT_SUBTYPE_PCM, WAVE_FORMAT_EXTENSIBLE};
#[cfg(windows)]
const WASAPI_BUFFER_DURATION_100NS: i64 = 1_000_000; // 100 ms
#[cfg(windows)]
const KSDATAFORMAT_SUBTYPE_IEEE_FLOAT: windows::core::GUID =
    windows::core::GUID::from_u128(0x00000003_0000_0010_8000_00aa00389b71);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AudioTrackKind {
    System,
    Mic,
}

impl AudioTrackKind {
    pub fn as_str(self) -> &'static str {
        match self {
            AudioTrackKind::System => "system",
            AudioTrackKind::Mic => "mic",
        }
    }
}

#[derive(Debug, Clone)]
pub struct CompletedAudioTrack {
    pub kind: AudioTrackKind,
    pub path: PathBuf,
    pub sample_rate: u32,
    pub channels: u16,
    pub duration_secs: f64,
    pub available: bool,
}

struct RunningAudioTrack {
    kind: AudioTrackKind,
    path: PathBuf,
    stop_signal: Arc<AtomicBool>,
    handle: Option<JoinHandle<CompletedAudioTrack>>,
}

pub struct AudioCaptureSession {
    tracks: Vec<RunningAudioTrack>,
}

pub fn audio_temp_dir() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(|| std::env::temp_dir())
        .join("Caprail")
        .join("audio")
}

pub fn cleanup_audio_track_files(tracks: &[CompletedAudioTrack]) {
    for track in tracks {
        let _ = std::fs::remove_file(&track.path);
    }
}

pub fn start_default_audio_capture(paused: Arc<AtomicBool>) -> AudioCaptureSession {
    let mut tracks = Vec::new();

    for kind in [AudioTrackKind::System, AudioTrackKind::Mic] {
        match start_track(kind, paused.clone()) {
            Ok(track) => tracks.push(track),
            Err(err) => warn!("Audio capture unavailable for {}: {}", kind.as_str(), err),
        }
    }

    AudioCaptureSession { tracks }
}

impl AudioCaptureSession {
    pub fn stop(self) -> Vec<CompletedAudioTrack> {
        for track in &self.tracks {
            track.stop_signal.store(true, Ordering::SeqCst);
        }

        let mut completed = Vec::new();
        for mut track in self.tracks {
            let result = track
                .handle
                .take()
                .map(|handle| {
                    handle
                        .join()
                        .unwrap_or_else(|_| empty_track(track.kind, track.path.clone()))
                })
                .unwrap_or_else(|| empty_track(track.kind, track.path.clone()));

            if result.available {
                info!(
                    "Audio track captured: kind={}, path={}, duration={:.2}s",
                    result.kind.as_str(),
                    result.path.display(),
                    result.duration_secs
                );
            } else {
                warn!(
                    "Audio track produced no usable data: {}",
                    result.kind.as_str()
                );
                let _ = std::fs::remove_file(&result.path);
            }

            completed.push(result);
        }

        completed
    }
}

fn start_track(kind: AudioTrackKind, paused: Arc<AtomicBool>) -> Result<RunningAudioTrack, String> {
    let dir = audio_temp_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("caprail-{}-{}.wav", kind.as_str(), unique_suffix()));
    info!(
        "Starting audio capture: kind={}, path={}",
        kind.as_str(),
        path.display()
    );
    let stop_signal = Arc::new(AtomicBool::new(false));
    let thread_stop = stop_signal.clone();
    let thread_paused = paused.clone();
    let thread_path = path.clone();

    let handle =
        std::thread::spawn(move || capture_track(kind, thread_path, thread_stop, thread_paused));

    Ok(RunningAudioTrack {
        kind,
        path,
        stop_signal,
        handle: Some(handle),
    })
}

#[cfg(windows)]
fn capture_track(
    kind: AudioTrackKind,
    path: PathBuf,
    stop_signal: Arc<AtomicBool>,
    paused: Arc<AtomicBool>,
) -> CompletedAudioTrack {
    match capture_track_windows(kind, path.clone(), stop_signal, paused) {
        Ok(track) => track,
        Err(err) => {
            warn!("WASAPI capture failed for {}: {}", kind.as_str(), err);
            empty_track(kind, path)
        }
    }
}

#[cfg(not(windows))]
fn capture_track(
    kind: AudioTrackKind,
    path: PathBuf,
    stop_signal: Arc<AtomicBool>,
    _paused: Arc<AtomicBool>,
) -> CompletedAudioTrack {
    while !stop_signal.load(Ordering::SeqCst) {
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    empty_track(kind, path)
}

#[cfg(windows)]
fn capture_track_windows(
    kind: AudioTrackKind,
    path: PathBuf,
    stop_signal: Arc<AtomicBool>,
    paused: Arc<AtomicBool>,
) -> Result<CompletedAudioTrack, String> {
    use std::ptr::null_mut;
    use windows::Win32::Media::Audio::{
        eCapture, eMultimedia, eRender, IAudioCaptureClient, IAudioClient, IMMDeviceEnumerator,
        MMDeviceEnumerator, AUDCLNT_BUFFERFLAGS_SILENT, AUDCLNT_SHAREMODE_SHARED,
        AUDCLNT_STREAMFLAGS_LOOPBACK,
    };
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoInitializeSecurity, CoTaskMemFree, CoUninitialize,
        CLSCTX_ALL, COINIT_MULTITHREADED, EOAC_NONE, RPC_C_AUTHN_LEVEL_DEFAULT,
        RPC_C_IMP_LEVEL_IDENTIFY,
    };

    unsafe {
        CoInitializeEx(None, COINIT_MULTITHREADED)
            .ok()
            .map_err(|e| format!("CoInitializeEx failed: {}", e))?;
        let _ = CoInitializeSecurity(
            None,
            -1,
            None,
            None,
            RPC_C_AUTHN_LEVEL_DEFAULT,
            RPC_C_IMP_LEVEL_IDENTIFY,
            None,
            EOAC_NONE,
            None,
        );

        let result = (|| {
            let enumerator: IMMDeviceEnumerator =
                CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                    .map_err(|e| format!("CoCreateInstance(MMDeviceEnumerator) failed: {}", e))?;
            let device = if kind == AudioTrackKind::System {
                enumerator
                    .GetDefaultAudioEndpoint(eRender, eMultimedia)
                    .map_err(|e| format!("GetDefaultAudioEndpoint(render) failed: {}", e))?
            } else {
                enumerator
                    .GetDefaultAudioEndpoint(eCapture, eMultimedia)
                    .map_err(|e| format!("GetDefaultAudioEndpoint(capture) failed: {}", e))?
            };
            let client: IAudioClient = device
                .Activate(CLSCTX_ALL, None)
                .map_err(|e| format!("Activate(IAudioClient) failed: {}", e))?;

            let mix_format = client
                .GetMixFormat()
                .map_err(|e| format!("GetMixFormat failed: {}", e))?;
            let format = *mix_format;
            let stream_flags = if kind == AudioTrackKind::System {
                AUDCLNT_STREAMFLAGS_LOOPBACK
            } else {
                Default::default()
            };
            client
                .Initialize(
                    AUDCLNT_SHAREMODE_SHARED,
                    stream_flags,
                    WASAPI_BUFFER_DURATION_100NS,
                    0,
                    mix_format,
                    None,
                )
                .map_err(|e| format!("IAudioClient::Initialize failed: {}", e))?;

            let capture: IAudioCaptureClient = client
                .GetService()
                .map_err(|e| format!("GetService(IAudioCaptureClient) failed: {}", e))?;
            let mut writer = WaveWriter::create(&path, format.nSamplesPerSec, format.nChannels)?;
            let block_align = format.nBlockAlign as usize;
            client
                .Start()
                .map_err(|e| format!("IAudioClient::Start failed: {}", e))?;
            let mut stream_started = true;

            while !stop_signal.load(Ordering::SeqCst) {
                if paused.load(Ordering::SeqCst) {
                    if stream_started {
                        let _ = client.Stop();
                        if let Err(err) = client.Reset() {
                            warn!(
                                "IAudioClient::Reset on pause failed for {}: {}",
                                kind.as_str(),
                                err
                            );
                        }
                        stream_started = false;
                    }

                    while paused.load(Ordering::SeqCst) && !stop_signal.load(Ordering::SeqCst) {
                        std::thread::sleep(std::time::Duration::from_millis(10));
                    }

                    if stop_signal.load(Ordering::SeqCst) {
                        break;
                    }

                    client
                        .Start()
                        .map_err(|e| format!("IAudioClient::Start after pause failed: {}", e))?;
                    stream_started = true;
                    continue;
                }

                let mut packet_frames = capture
                    .GetNextPacketSize()
                    .map_err(|e| format!("GetNextPacketSize failed: {}", e))?;

                if packet_frames == 0 {
                    std::thread::sleep(std::time::Duration::from_millis(5));
                    continue;
                }

                while packet_frames > 0 {
                    if paused.load(Ordering::SeqCst) {
                        break;
                    }

                    let mut data = null_mut();
                    let mut frames = 0;
                    let mut flags = Default::default();
                    capture
                        .GetBuffer(&mut data, &mut frames, &mut flags, None, None)
                        .map_err(|e| format!("GetBuffer failed: {}", e))?;

                    let byte_len = frames as usize * block_align;
                    if !paused.load(Ordering::SeqCst) {
                        let silent_flag = AUDCLNT_BUFFERFLAGS_SILENT.0 as u32;
                        if flags & silent_flag == silent_flag {
                            writer.write_silence_frames(frames)?;
                        } else {
                            let bytes = std::slice::from_raw_parts(data as *const u8, byte_len);
                            let sample_format =
                                SampleFormat::from_wave_format(mix_format, &format);
                            writer.write_captured_audio(bytes, &format, frames, sample_format)?;
                        }
                    }

                    capture
                        .ReleaseBuffer(frames)
                        .map_err(|e| format!("ReleaseBuffer failed: {}", e))?;
                    if paused.load(Ordering::SeqCst) {
                        break;
                    }
                    packet_frames = capture
                        .GetNextPacketSize()
                        .map_err(|e| format!("GetNextPacketSize failed: {}", e))?;
                }
            }

            if stream_started {
                let _ = client.Stop();
            }
            writer.finalize()?;
            CoTaskMemFree(Some(mix_format as *const _));

            let available = writer.data_len > 0;
            Ok(CompletedAudioTrack {
                kind,
                path,
                sample_rate: format.nSamplesPerSec,
                channels: format.nChannels,
                duration_secs: if format.nAvgBytesPerSec == 0 {
                    0.0
                } else {
                    writer.data_len as f64
                        / (format.nSamplesPerSec as f64 * format.nChannels as f64 * 2.0)
                },
                available,
            })
        })();

        CoUninitialize();
        result
    }
}

struct WaveWriter {
    file: File,
    data_len: u32,
    channels: u16,
}

#[cfg_attr(not(windows), allow(dead_code))]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SampleFormat {
    Float,
    Pcm,
    Unsupported,
}

impl SampleFormat {
    #[cfg(windows)]
    fn from_wave_format(format_ptr: *const WAVEFORMATEX, format: &WAVEFORMATEX) -> Self {
        if format.wFormatTag as u32 == WAVE_FORMAT_EXTENSIBLE && format.cbSize >= 22 {
            unsafe {
                let ext = format_ptr.add(1) as *const u8;
                let subformat = std::ptr::read_unaligned(ext.add(6) as *const windows::core::GUID);
                if subformat == KSDATAFORMAT_SUBTYPE_IEEE_FLOAT {
                    return Self::Float;
                }
                if subformat == KSDATAFORMAT_SUBTYPE_PCM {
                    return Self::Pcm;
                }
            }
            return Self::Unsupported;
        }

        match format.wFormatTag {
            1 => Self::Pcm,
            3 => Self::Float,
            _ => Self::Unsupported,
        }
    }
}

impl WaveWriter {
    fn create(path: &PathBuf, sample_rate: u32, channels: u16) -> Result<Self, String> {
        let mut file = File::create(path)
            .map_err(|e| format!("create audio file '{}' failed: {}", path.display(), e))?;
        let byte_rate = sample_rate
            .saturating_mul(channels as u32)
            .saturating_mul(2);
        let block_align = channels.saturating_mul(2);

        file.write_all(b"RIFF").map_err(|e| e.to_string())?;
        file.write_all(&0u32.to_le_bytes())
            .map_err(|e| e.to_string())?;
        file.write_all(b"WAVEfmt ").map_err(|e| e.to_string())?;
        file.write_all(&16u32.to_le_bytes())
            .map_err(|e| e.to_string())?;
        file.write_all(&1u16.to_le_bytes())
            .map_err(|e| e.to_string())?;
        file.write_all(&channels.to_le_bytes())
            .map_err(|e| e.to_string())?;
        file.write_all(&sample_rate.to_le_bytes())
            .map_err(|e| e.to_string())?;
        file.write_all(&byte_rate.to_le_bytes())
            .map_err(|e| e.to_string())?;
        file.write_all(&block_align.to_le_bytes())
            .map_err(|e| e.to_string())?;
        file.write_all(&16u16.to_le_bytes())
            .map_err(|e| e.to_string())?;
        file.write_all(b"data").map_err(|e| e.to_string())?;
        file.write_all(&0u32.to_le_bytes())
            .map_err(|e| e.to_string())?;
        Ok(Self {
            file,
            data_len: 0,
            channels,
        })
    }

    fn write_all(&mut self, bytes: &[u8]) -> Result<(), String> {
        self.file.write_all(bytes).map_err(|e| e.to_string())?;
        self.data_len = self.data_len.saturating_add(bytes.len() as u32);
        Ok(())
    }

    fn write_silence_frames(&mut self, frames: u32) -> Result<(), String> {
        let silence = vec![0u8; frames as usize * self.channels as usize * 2];
        self.write_all(&silence)
    }

    fn write_captured_audio(
        &mut self,
        bytes: &[u8],
        format: &WAVEFORMATEX,
        frames: u32,
        sample_format: SampleFormat,
    ) -> Result<(), String> {
        let channels = format.nChannels.max(1) as usize;
        let source_bytes_per_sample = (format.nBlockAlign as usize / channels).max(1);
        let format_tag = format.wFormatTag;
        let bits_per_sample = format.wBitsPerSample;

        if sample_format == SampleFormat::Unsupported {
            return Err(format!(
                "unsupported audio sample format: tag={}, bits={}, bytes_per_sample={}",
                format_tag, bits_per_sample, source_bytes_per_sample
            ));
        }

        if sample_format == SampleFormat::Pcm
            && bits_per_sample == 16
            && source_bytes_per_sample == 2
        {
            return self.write_all(bytes);
        }

        let sample_count = frames as usize * channels;
        let mut out = Vec::with_capacity(sample_count * 2);
        for sample_index in 0..sample_count {
            let offset = sample_index * source_bytes_per_sample;
            if offset + source_bytes_per_sample > bytes.len() {
                break;
            }

            let sample = match (
                sample_format,
                bits_per_sample,
                source_bytes_per_sample,
            ) {
                (SampleFormat::Float, 32, 4) => {
                    let value = f32::from_le_bytes([
                        bytes[offset],
                        bytes[offset + 1],
                        bytes[offset + 2],
                        bytes[offset + 3],
                    ]);
                    (value.clamp(-1.0, 1.0) * i16::MAX as f32) as i16
                }
                (SampleFormat::Pcm, 24, 3) => {
                    let raw = i32::from_le_bytes([
                        bytes[offset],
                        bytes[offset + 1],
                        bytes[offset + 2],
                        if bytes[offset + 2] & 0x80 != 0 {
                            0xff
                        } else {
                            0x00
                        },
                    ]);
                    (raw >> 8) as i16
                }
                (SampleFormat::Pcm, 32, 4) => {
                    let raw = i32::from_le_bytes([
                        bytes[offset],
                        bytes[offset + 1],
                        bytes[offset + 2],
                        bytes[offset + 3],
                    ]);
                    (raw >> 16) as i16
                }
                _ => {
                    return Err(format!(
                        "unsupported audio sample layout: format={:?}, bits={}, bytes_per_sample={}",
                        sample_format, bits_per_sample, source_bytes_per_sample
                    ));
                }
            };
            out.extend_from_slice(&sample.to_le_bytes());
        }

        self.write_all(&out)
    }

    fn finalize(&mut self) -> Result<(), String> {
        let riff_len = self.data_len.saturating_add(36);
        self.file
            .seek(SeekFrom::Start(4))
            .map_err(|e| e.to_string())?;
        self.file
            .write_all(&riff_len.to_le_bytes())
            .map_err(|e| e.to_string())?;
        let data_len_offset = 40;
        self.file
            .seek(SeekFrom::Start(data_len_offset))
            .map_err(|e| e.to_string())?;
        self.file
            .write_all(&self.data_len.to_le_bytes())
            .map_err(|e| e.to_string())?;
        self.file.flush().map_err(|e| e.to_string())
    }
}

fn empty_track(kind: AudioTrackKind, path: PathBuf) -> CompletedAudioTrack {
    CompletedAudioTrack {
        kind,
        path,
        sample_rate: 0,
        channels: 0,
        duration_secs: 0.0,
        available: false,
    }
}

fn unique_suffix() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}
