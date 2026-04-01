use serde::{Deserialize, Serialize};
use std::io::Write;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Instant;

static RECORDING: AtomicBool = AtomicBool::new(false);
static PAUSED: AtomicBool = AtomicBool::new(false);

static RECORDING_STATE: once_cell::sync::Lazy<Mutex<RecordingContext>> =
    once_cell::sync::Lazy::new(|| Mutex::new(RecordingContext::default()));

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingConfig {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
    pub fps: u32,
    pub output_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecordingStatus {
    pub is_recording: bool,
    pub is_paused: bool,
    pub duration_secs: f64,
    pub frame_count: u64,
    pub fps: f64,
}

#[derive(Default)]
struct RecordingContext {
    ffmpeg_process: Option<Child>,
    start_time: Option<Instant>,
    pause_duration: f64,
    last_pause_time: Option<Instant>,
    frame_count: u64,
    config: Option<RecordingConfig>,
    capture_thread: Option<std::thread::JoinHandle<()>>,
}

#[tauri::command]
pub fn start_recording(config: RecordingConfig) -> Result<(), String> {
    if RECORDING.load(Ordering::SeqCst) {
        return Err("Already recording".to_string());
    }

    // Round to even dimensions (required by H.264 yuv420p)
    let width = (config.width + 1) & !1;
    let height = (config.height + 1) & !1;
    let fps = config.fps;
    let output_path = config.output_path.clone();

    // Ensure output directory exists
    if let Some(parent) = std::path::Path::new(&output_path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    // Redirect FFmpeg stderr to log file for diagnostics
    let stderr_log_path = format!("{}.log", output_path);
    let stderr_file = std::fs::File::create(&stderr_log_path)
        .map_err(|e| format!("Failed to create ffmpeg log: {}", e))?;

    // Start ffmpeg process
    let mut cmd = Command::new("ffmpeg");
    cmd.args([
            "-y",
            "-f", "rawvideo",
            "-pixel_format", "bgra",
            "-video_size", &format!("{}x{}", width, height),
            "-framerate", &fps.to_string(),
            "-i", "pipe:0",
            "-c:v", "libx264",
            "-preset", "ultrafast",
            "-tune", "zerolatency",
            "-pix_fmt", "yuv420p",
            "-crf", "23",
            &output_path,
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::from(stderr_file));

    // Prevent console window flash on Windows
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let ffmpeg = cmd.spawn()
        .map_err(|e| format!("Failed to start ffmpeg: {}. Make sure ffmpeg is in PATH.", e))?;

    {
        let mut state = RECORDING_STATE.lock().unwrap();
        state.ffmpeg_process = Some(ffmpeg);
        state.start_time = Some(Instant::now());
        state.pause_duration = 0.0;
        state.last_pause_time = None;
        state.frame_count = 0;
        state.config = Some(config.clone());
    }

    RECORDING.store(true, Ordering::SeqCst);
    PAUSED.store(false, Ordering::SeqCst);

    // Spawn capture thread with rounded dimensions
    let mut capture_config = config;
    capture_config.width = width;
    capture_config.height = height;
    let handle = std::thread::spawn(move || {
        capture_loop(capture_config);
    });

    {
        let mut state = RECORDING_STATE.lock().unwrap();
        state.capture_thread = Some(handle);
    }

    tracing::info!("Recording started: {}x{} @ {}fps", width, height, fps);
    Ok(())
}

#[cfg(windows)]
fn capture_loop(config: RecordingConfig) {
    use windows::Win32::Graphics::Gdi::{
        BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject,
        GetDC, GetDIBits, ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER,
        BI_RGB, DIB_RGB_COLORS, SRCCOPY,
    };

    let frame_duration = std::time::Duration::from_secs_f64(1.0 / config.fps as f64);
    let frame_size = (config.width * config.height * 4) as usize;

    unsafe {
        let hdc_screen = GetDC(None);
        let hdc_mem = CreateCompatibleDC(Some(hdc_screen));
        let hbm = CreateCompatibleBitmap(hdc_screen, config.width, config.height);
        let old = SelectObject(hdc_mem, hbm.into());

        let mut bmi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: config.width,
                biHeight: -config.height, // top-down
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0 as u32,
                ..Default::default()
            },
            ..Default::default()
        };

        let mut frame_data = vec![0u8; frame_size];

        while RECORDING.load(Ordering::SeqCst) {
            let frame_start = Instant::now();

            if PAUSED.load(Ordering::SeqCst) {
                std::thread::sleep(std::time::Duration::from_millis(50));
                continue;
            }

            // Capture frame
            let _ = BitBlt(
                hdc_mem, 0, 0, config.width, config.height,
                Some(hdc_screen), config.x, config.y, SRCCOPY,
            );

            GetDIBits(
                hdc_mem,
                hbm,
                0,
                config.height as u32,
                Some(frame_data.as_mut_ptr() as *mut _),
                &mut bmi,
                DIB_RGB_COLORS,
            );

            // Write to ffmpeg stdin
            let mut state = RECORDING_STATE.lock().unwrap();
            if let Some(ref mut process) = state.ffmpeg_process {
                if let Some(ref mut stdin) = process.stdin {
                    if let Err(e) = stdin.write_all(&frame_data) {
                        tracing::error!("FFmpeg stdin write error: {}", e);
                        drop(state);
                        break;
                    }
                }
            }
            state.frame_count += 1;
            drop(state);

            // Frame rate limiting
            let elapsed = frame_start.elapsed();
            if elapsed < frame_duration {
                std::thread::sleep(frame_duration - elapsed);
            }
        }

        SelectObject(hdc_mem, old);
        let _ = DeleteObject(hbm.into());
        let _ = DeleteDC(hdc_mem);
        ReleaseDC(None, hdc_screen);
    }
}

#[cfg(not(windows))]
fn capture_loop(_config: RecordingConfig) {
    while RECORDING.load(Ordering::SeqCst) {
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
}

#[tauri::command]
pub fn stop_recording() -> Result<String, String> {
    if !RECORDING.load(Ordering::SeqCst) {
        return Err("Not recording".to_string());
    }

    RECORDING.store(false, Ordering::SeqCst);
    PAUSED.store(false, Ordering::SeqCst);

    let output_path;
    let capture_handle;
    {
        let mut state = RECORDING_STATE.lock().unwrap();

        // Close ffmpeg stdin to signal end of input
        if let Some(ref mut process) = state.ffmpeg_process {
            if let Some(stdin) = process.stdin.take() {
                drop(stdin);
            }
            // Wait for ffmpeg to finish
            match process.wait() {
                Ok(status) => {
                    if !status.success() {
                        tracing::error!("FFmpeg exited with status: {}", status);
                    }
                }
                Err(e) => tracing::error!("FFmpeg wait failed: {}", e),
            }
        }
        state.ffmpeg_process = None;

        // Take capture thread handle out of the lock — join it outside to avoid deadlock
        capture_handle = state.capture_thread.take();

        output_path = state
            .config
            .as_ref()
            .map(|c| c.output_path.clone())
            .unwrap_or_default();

        // Log frame count for diagnostics
        tracing::info!("Recording frames captured: {}", state.frame_count);

        state.config = None;
        state.start_time = None;
    }

    // Wait for capture thread outside the lock to avoid deadlock
    if let Some(handle) = capture_handle {
        let _ = handle.join();
    }

    tracing::info!("Recording stopped: {}", output_path);
    Ok(output_path)
}

#[tauri::command]
pub fn pause_recording() -> Result<(), String> {
    if !RECORDING.load(Ordering::SeqCst) {
        return Err("Not recording".to_string());
    }
    if PAUSED.load(Ordering::SeqCst) {
        return Ok(());
    }

    PAUSED.store(true, Ordering::SeqCst);

    let mut state = RECORDING_STATE.lock().unwrap();
    state.last_pause_time = Some(Instant::now());

    tracing::info!("Recording paused");
    Ok(())
}

#[tauri::command]
pub fn resume_recording() -> Result<(), String> {
    if !RECORDING.load(Ordering::SeqCst) {
        return Err("Not recording".to_string());
    }
    if !PAUSED.load(Ordering::SeqCst) {
        return Ok(());
    }

    PAUSED.store(false, Ordering::SeqCst);

    let mut state = RECORDING_STATE.lock().unwrap();
    if let Some(pause_start) = state.last_pause_time.take() {
        state.pause_duration += pause_start.elapsed().as_secs_f64();
    }

    tracing::info!("Recording resumed");
    Ok(())
}

#[tauri::command]
pub fn get_recording_status() -> RecordingStatus {
    let state = RECORDING_STATE.lock().unwrap();
    let is_recording = RECORDING.load(Ordering::SeqCst);
    let is_paused = PAUSED.load(Ordering::SeqCst);

    let duration = if let Some(start) = state.start_time {
        let elapsed = start.elapsed().as_secs_f64() - state.pause_duration;
        if is_paused {
            if let Some(pause_start) = state.last_pause_time {
                elapsed - pause_start.elapsed().as_secs_f64()
            } else {
                elapsed
            }
        } else {
            elapsed
        }
    } else {
        0.0
    };

    let fps = if duration > 0.0 {
        state.frame_count as f64 / duration
    } else {
        0.0
    };

    RecordingStatus {
        is_recording,
        is_paused,
        duration_secs: duration,
        frame_count: state.frame_count,
        fps,
    }
}
