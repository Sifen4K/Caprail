use serde::{Deserialize, Serialize};
use std::io::{BufWriter, Read as _, Seek, SeekFrom, Write as _};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

// ── RAWV file format ──────────────────────────────────────────────────
// 32-byte header + raw BGRA frames (width * height * 4 bytes each)

const RAWV_MAGIC: &[u8; 4] = b"RAWV";
const RAWV_VERSION: u32 = 1;
pub const RAWV_HEADER_SIZE: u64 = 32;

#[repr(C)]
#[allow(dead_code)]
struct RawvHeader {
    magic: [u8; 4],
    version: u32,
    width: u32,
    height: u32,
    fps: u32,
    frame_count: u32,
    _reserved: [u8; 8],
}

fn create_rawv_file(
    path: &str,
    width: u32,
    height: u32,
    fps: u32,
) -> Result<BufWriter<std::fs::File>, String> {
    let file = std::fs::File::create(path)
        .map_err(|e| format!("Failed to create rawv file: {}", e))?;
    let mut writer = BufWriter::with_capacity(1024 * 1024, file); // 1MB buffer

    // Write header (frame_count = 0, will be updated on finalize)
    writer.write_all(RAWV_MAGIC).map_err(|e| e.to_string())?;
    writer.write_all(&RAWV_VERSION.to_le_bytes()).map_err(|e| e.to_string())?;
    writer.write_all(&width.to_le_bytes()).map_err(|e| e.to_string())?;
    writer.write_all(&height.to_le_bytes()).map_err(|e| e.to_string())?;
    writer.write_all(&fps.to_le_bytes()).map_err(|e| e.to_string())?;
    writer.write_all(&0u32.to_le_bytes()).map_err(|e| e.to_string())?; // frame_count placeholder
    writer.write_all(&[0u8; 8]).map_err(|e| e.to_string())?; // reserved

    Ok(writer)
}

fn finalize_rawv_file(path: &str, frame_count: u32) -> Result<(), String> {
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .open(path)
        .map_err(|e| format!("Failed to open rawv file for finalization: {}", e))?;

    // Seek to frame_count field (offset 20)
    file.seek(SeekFrom::Start(20))
        .map_err(|e| format!("Failed to seek: {}", e))?;
    file.write_all(&frame_count.to_le_bytes())
        .map_err(|e| format!("Failed to write frame_count: {}", e))?;

    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingInfo {
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub frame_count: u32,
}

pub fn read_rawv_header(path: &str) -> Result<RecordingInfo, String> {
    let mut file = std::fs::File::open(path)
        .map_err(|e| format!("Failed to open rawv file: {}", e))?;

    let mut header = [0u8; 32];
    file.read_exact(&mut header)
        .map_err(|e| format!("Failed to read header: {}", e))?;

    if &header[0..4] != RAWV_MAGIC {
        return Err("Invalid RAWV file: bad magic".to_string());
    }

    let version = u32::from_le_bytes(header[4..8].try_into().unwrap());
    if version != RAWV_VERSION {
        return Err(format!("Unsupported RAWV version: {}", version));
    }

    Ok(RecordingInfo {
        width: u32::from_le_bytes(header[8..12].try_into().unwrap()),
        height: u32::from_le_bytes(header[12..16].try_into().unwrap()),
        fps: u32::from_le_bytes(header[16..20].try_into().unwrap()),
        frame_count: u32::from_le_bytes(header[20..24].try_into().unwrap()),
    })
}

#[tauri::command]
pub fn get_recording_info(path: String) -> Result<RecordingInfo, String> {
    read_rawv_header(&path)
}

#[tauri::command]
pub fn read_recording_frame(path: String, frame_index: u32) -> Result<Vec<u8>, String> {
    // Single file open: read header + seek to frame in one pass
    let mut file = std::fs::File::open(&path)
        .map_err(|e| format!("Failed to open rawv file: {}", e))?;

    let mut header = [0u8; 32];
    file.read_exact(&mut header)
        .map_err(|e| format!("Failed to read header: {}", e))?;

    if &header[0..4] != RAWV_MAGIC {
        return Err("Invalid RAWV file: bad magic".to_string());
    }

    let width = u32::from_le_bytes(header[8..12].try_into().unwrap());
    let height = u32::from_le_bytes(header[12..16].try_into().unwrap());
    let frame_count = u32::from_le_bytes(header[20..24].try_into().unwrap());

    if frame_index >= frame_count {
        return Err(format!(
            "Frame index {} out of range (total: {})",
            frame_index, frame_count
        ));
    }

    let frame_size = (width * height * 4) as u64;
    let offset = RAWV_HEADER_SIZE + frame_index as u64 * frame_size;

    file.seek(SeekFrom::Start(offset))
        .map_err(|e| format!("Failed to seek to frame: {}", e))?;

    let mut frame_data = vec![0u8; frame_size as usize];
    file.read_exact(&mut frame_data)
        .map_err(|e| format!("Failed to read frame data: {}", e))?;

    // Convert BGRA → RGBA in-place
    for pixel in frame_data.chunks_exact_mut(4) {
        pixel.swap(0, 2); // swap B and R
    }

    Ok(frame_data)
}

// ── Recording session ─────────────────────────────────────────────────

/// Returns a temp directory for rawv recording files
#[tauri::command]
pub fn get_temp_recording_dir() -> Result<String, String> {
    let dir = std::env::temp_dir().join("ScreenshotTool").join("recordings");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().to_string())
}

/// Cleans up a rawv temp file
#[tauri::command]
pub fn cleanup_rawv_file(path: String) -> Result<(), String> {
    if path.ends_with(".rawv") && std::path::Path::new(&path).exists() {
        std::fs::remove_file(&path).map_err(|e| e.to_string())?;
        tracing::info!("Cleaned up rawv file: {}", path);
    }
    Ok(())
}

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

struct RecordingSession {
    rawv_path: String,
    start_time: Instant,
    pause_duration: f64,
    last_pause_time: Option<Instant>,
    frame_count: Arc<AtomicU64>,
    #[allow(dead_code)]
    config: RecordingConfig,
    capture_thread: Option<std::thread::JoinHandle<()>>,
    paused: Arc<AtomicBool>,
    stop_signal: Arc<AtomicBool>,
}

#[tauri::command]
pub fn start_recording(config: RecordingConfig) -> Result<(), String> {
    let mut session_guard = SESSION.lock().unwrap();
    if session_guard.is_some() {
        return Err("Already recording".to_string());
    }

    // Round to even dimensions (required for H.264 export later)
    let width = (config.width + 1) & !1;
    let height = (config.height + 1) & !1;
    let fps = config.fps;
    let rawv_path = config.output_path.clone();

    // Ensure output directory exists
    if let Some(parent) = std::path::Path::new(&rawv_path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    // Create rawv file with header
    let rawv_writer = create_rawv_file(&rawv_path, width as u32, height as u32, fps)?;

    let stop_signal = Arc::new(AtomicBool::new(false));
    let paused = Arc::new(AtomicBool::new(false));
    let frame_count = Arc::new(AtomicU64::new(0));

    // Spawn capture thread with rounded dimensions
    let mut capture_config = config.clone();
    capture_config.width = width;
    capture_config.height = height;
    let thread_stop = stop_signal.clone();
    let thread_paused = paused.clone();
    let thread_frame_count = frame_count.clone();

    let handle = std::thread::spawn(move || {
        capture_loop(capture_config, thread_stop, thread_paused, thread_frame_count, rawv_writer);
    });

    let session = RecordingSession {
        rawv_path: rawv_path.clone(),
        start_time: Instant::now(),
        pause_duration: 0.0,
        last_pause_time: None,
        frame_count,
        config,
        capture_thread: Some(handle),
        paused,
        stop_signal,
    };

    *session_guard = Some(session);

    tracing::info!("Recording started (rawv): {}x{} @ {}fps → {}", width, height, fps, rawv_path);
    Ok(())
}

#[cfg(windows)]
fn capture_loop(
    config: RecordingConfig,
    stop_signal: Arc<AtomicBool>,
    paused: Arc<AtomicBool>,
    frame_count: Arc<AtomicU64>,
    mut writer: BufWriter<std::fs::File>,
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

        let mut frame_data = vec![0u8; frame_size];

        while !stop_signal.load(Ordering::SeqCst) {
            let frame_start = Instant::now();

            // Check if paused (no mutex needed — atomic read)
            if paused.load(Ordering::SeqCst) {
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

            // Write frame directly to rawv file (no mutex needed)
            if let Err(e) = writer.write_all(&frame_data) {
                tracing::error!("Rawv write error: {}", e);
                break;
            }
            frame_count.fetch_add(1, Ordering::SeqCst);

            // Frame rate limiting
            let elapsed = frame_start.elapsed();
            if elapsed < frame_duration {
                std::thread::sleep(frame_duration - elapsed);
            }
        }

        // Flush remaining buffered data
        if let Err(e) = writer.flush() {
            tracing::error!("Rawv flush error: {}", e);
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
    _writer: BufWriter<std::fs::File>,
) {
    while !stop_signal.load(Ordering::SeqCst) {
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
}

#[tauri::command]
pub fn stop_recording() -> Result<String, String> {
    let mut session_guard = SESSION.lock().unwrap();
    let mut session = session_guard.take().ok_or("Not recording".to_string())?;

    // Signal the capture thread to stop
    session.stop_signal.store(true, Ordering::SeqCst);

    let capture_handle = session.capture_thread.take();
    let rawv_path = session.rawv_path.clone();
    let frame_count_arc = session.frame_count.clone();

    // Drop the session guard before joining thread to avoid deadlock
    drop(session_guard);

    // Wait for capture thread to finish and flush
    if let Some(handle) = capture_handle {
        let _ = handle.join();
    }

    // Read frame count AFTER thread has joined — no more writes possible
    let final_frame_count = frame_count_arc.load(Ordering::SeqCst) as u32;

    // Write final frame count back to header
    finalize_rawv_file(&rawv_path, final_frame_count)?;

    tracing::info!(
        "Recording stopped: {} ({} frames)",
        rawv_path, final_frame_count
    );
    Ok(rawv_path)
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
