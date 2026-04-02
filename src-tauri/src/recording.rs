use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::Instant;
use tauri::ipc::Response;

// ── In-memory recording store ────────────────────────────────────────
// Frames live in RAM until the user exports or closes the editor.

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingInfo {
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub frame_count: u32,
}

pub struct CompletedRecording {
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub frames: Vec<Vec<u8>>, // BGRA pixel data per frame
}

pub static COMPLETED_RECORDING: once_cell::sync::Lazy<RwLock<Option<CompletedRecording>>> =
    once_cell::sync::Lazy::new(|| RwLock::new(None));

#[tauri::command]
pub fn get_recording_info() -> Result<RecordingInfo, String> {
    let store = COMPLETED_RECORDING.read().unwrap();
    let rec = store.as_ref().ok_or("No recording available")?;
    Ok(RecordingInfo {
        width: rec.width,
        height: rec.height,
        fps: rec.fps,
        frame_count: rec.frames.len() as u32,
    })
}

/// Returns frame pixel data as raw binary (RGBA) via Tauri binary IPC.
#[tauri::command]
pub fn read_recording_frame(frame_index: u32) -> Result<Response, String> {
    let store = COMPLETED_RECORDING.read().unwrap();
    let rec = store.as_ref().ok_or("No recording available")?;

    let idx = frame_index as usize;
    if idx >= rec.frames.len() {
        return Err(format!(
            "Frame index {} out of range (total: {})",
            frame_index,
            rec.frames.len()
        ));
    }

    // Clone frame and convert BGRA → RGBA
    let mut frame_data = rec.frames[idx].clone();
    for pixel in frame_data.chunks_exact_mut(4) {
        pixel.swap(0, 2);
    }

    Ok(Response::new(frame_data))
}

/// Frees the in-memory recording frames.
#[tauri::command]
pub fn cleanup_recording() -> Result<(), String> {
    let mut store = COMPLETED_RECORDING.write().unwrap();
    if store.is_some() {
        *store = None;
        tracing::info!("Recording frames cleared from memory");
    }
    Ok(())
}

// ── Recording session ────────────────────────────────────────────────

static SESSION: once_cell::sync::Lazy<Mutex<Option<RecordingSession>>> =
    once_cell::sync::Lazy::new(|| Mutex::new(None));

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingConfig {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
    pub fps: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecordingStatus {
    pub is_recording: bool,
    pub is_paused: bool,
    pub duration_secs: f64,
    pub frame_count: u64,
    pub fps: f64,
}

struct RecordingSession {
    width: u32,
    height: u32,
    fps: u32,
    start_time: Instant,
    pause_duration: f64,
    last_pause_time: Option<Instant>,
    frame_count: Arc<AtomicU64>,
    #[allow(dead_code)]
    config: RecordingConfig,
    capture_thread: Option<std::thread::JoinHandle<()>>,
    paused: Arc<AtomicBool>,
    stop_signal: Arc<AtomicBool>,
    frames: Arc<Mutex<Vec<Vec<u8>>>>,
}

#[tauri::command]
pub fn start_recording(config: RecordingConfig) -> Result<(), String> {
    let mut session_guard = SESSION.lock().unwrap();
    if session_guard.is_some() {
        return Err("Already recording".to_string());
    }

    // Round to even dimensions (required for H.264 export later)
    let width = ((config.width + 1) & !1) as u32;
    let height = ((config.height + 1) & !1) as u32;
    let fps = config.fps;

    let stop_signal = Arc::new(AtomicBool::new(false));
    let paused = Arc::new(AtomicBool::new(false));
    let frame_count = Arc::new(AtomicU64::new(0));
    let frames: Arc<Mutex<Vec<Vec<u8>>>> = Arc::new(Mutex::new(Vec::new()));

    let mut capture_config = config.clone();
    capture_config.width = width as i32;
    capture_config.height = height as i32;
    let thread_stop = stop_signal.clone();
    let thread_paused = paused.clone();
    let thread_frame_count = frame_count.clone();
    let thread_frames = frames.clone();

    let handle = std::thread::spawn(move || {
        capture_loop(
            capture_config,
            thread_stop,
            thread_paused,
            thread_frame_count,
            thread_frames,
        );
    });

    let session = RecordingSession {
        width,
        height,
        fps,
        start_time: Instant::now(),
        pause_duration: 0.0,
        last_pause_time: None,
        frame_count,
        config,
        capture_thread: Some(handle),
        paused,
        stop_signal,
        frames,
    };

    *session_guard = Some(session);

    tracing::info!("Recording started (in-memory): {}x{} @ {}fps", width, height, fps);
    Ok(())
}

#[cfg(windows)]
fn capture_loop(
    config: RecordingConfig,
    stop_signal: Arc<AtomicBool>,
    paused: Arc<AtomicBool>,
    frame_count: Arc<AtomicU64>,
    frames: Arc<Mutex<Vec<Vec<u8>>>>,
) {
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

        while !stop_signal.load(Ordering::SeqCst) {
            let frame_start = Instant::now();

            if paused.load(Ordering::SeqCst) {
                std::thread::sleep(std::time::Duration::from_millis(50));
                continue;
            }

            // Allocate new frame buffer (moved into storage, no copy)
            let mut frame = vec![0u8; frame_size];

            let _ = BitBlt(
                hdc_mem, 0, 0, config.width, config.height,
                Some(hdc_screen), config.x, config.y, SRCCOPY,
            );

            GetDIBits(
                hdc_mem,
                hbm,
                0,
                config.height as u32,
                Some(frame.as_mut_ptr() as *mut _),
                &mut bmi,
                DIB_RGB_COLORS,
            );

            // Move frame into shared storage
            frames.lock().unwrap().push(frame);
            frame_count.fetch_add(1, Ordering::SeqCst);

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
fn capture_loop(
    _config: RecordingConfig,
    stop_signal: Arc<AtomicBool>,
    _paused: Arc<AtomicBool>,
    _frame_count: Arc<AtomicU64>,
    _frames: Arc<Mutex<Vec<Vec<u8>>>>,
) {
    while !stop_signal.load(Ordering::SeqCst) {
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
}

#[tauri::command]
pub fn stop_recording() -> Result<(), String> {
    let mut session_guard = SESSION.lock().unwrap();
    let mut session = session_guard.take().ok_or("Not recording".to_string())?;

    session.stop_signal.store(true, Ordering::SeqCst);
    let capture_handle = session.capture_thread.take();

    // Drop session guard before joining thread to avoid deadlock
    drop(session_guard);

    if let Some(handle) = capture_handle {
        let _ = handle.join();
    }

    // Capture thread dropped its Arc clone on exit — lock and take frames
    let completed_frames = std::mem::take(&mut *session.frames.lock().unwrap());
    let frame_count = completed_frames.len();

    *COMPLETED_RECORDING.write().unwrap() = Some(CompletedRecording {
        width: session.width,
        height: session.height,
        fps: session.fps,
        frames: completed_frames,
    });

    tracing::info!(
        "Recording stopped: {}x{} ({} frames, in-memory)",
        session.width, session.height, frame_count
    );
    Ok(())
}

#[tauri::command]
pub fn pause_recording() -> Result<(), String> {
    let mut session_guard = SESSION.lock().unwrap();
    let session = session_guard.as_mut().ok_or("Not recording".to_string())?;

    if session.paused.load(Ordering::SeqCst) {
        return Ok(());
    }

    session.paused.store(true, Ordering::SeqCst);
    session.last_pause_time = Some(Instant::now());

    tracing::info!("Recording paused");
    Ok(())
}

#[tauri::command]
pub fn resume_recording() -> Result<(), String> {
    let mut session_guard = SESSION.lock().unwrap();
    let session = session_guard.as_mut().ok_or("Not recording".to_string())?;

    if !session.paused.load(Ordering::SeqCst) {
        return Ok(());
    }

    session.paused.store(false, Ordering::SeqCst);
    if let Some(pause_start) = session.last_pause_time.take() {
        session.pause_duration += pause_start.elapsed().as_secs_f64();
    }

    tracing::info!("Recording resumed");
    Ok(())
}

#[tauri::command]
pub fn get_recording_status() -> RecordingStatus {
    let session_guard = SESSION.lock().unwrap();

    match session_guard.as_ref() {
        None => RecordingStatus {
            is_recording: false,
            is_paused: false,
            duration_secs: 0.0,
            frame_count: 0,
            fps: 0.0,
        },
        Some(session) => {
            let is_paused = session.paused.load(Ordering::SeqCst);
            let elapsed = session.start_time.elapsed().as_secs_f64() - session.pause_duration;
            let duration = if is_paused {
                if let Some(pause_start) = session.last_pause_time {
                    elapsed - pause_start.elapsed().as_secs_f64()
                } else {
                    elapsed
                }
            } else {
                elapsed
            };

            let frame_count = session.frame_count.load(Ordering::SeqCst);
            let fps = if duration > 0.0 {
                frame_count as f64 / duration
            } else {
                0.0
            };

            RecordingStatus {
                is_recording: true,
                is_paused,
                duration_secs: duration,
                frame_count,
                fps,
            }
        }
    }
}
