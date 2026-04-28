use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::Instant;
use tauri::ipc::Response;
use tauri::{Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder};
use tracing::{info, warn};

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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingEditorSession {
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub frame_count: u32,
    pub duration_secs: f64,
    pub trim_start_frame: u32,
    pub trim_end_frame: u32,
    pub terminal_frame: u32,
    pub system_audio_available: bool,
    pub mic_available: bool,
}

pub struct CompletedRecording {
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub frames: Vec<Vec<u8>>, // BGRA pixel data per frame
    pub audio_tracks: Vec<crate::audio::CompletedAudioTrack>,
}

pub static COMPLETED_RECORDING: once_cell::sync::Lazy<RwLock<Option<CompletedRecording>>> =
    once_cell::sync::Lazy::new(|| RwLock::new(None));

fn build_recording_editor_session(rec: &CompletedRecording) -> RecordingEditorSession {
    let frame_count = rec.frames.len() as u32;
    let duration_secs = if rec.fps == 0 {
        0.0
    } else {
        frame_count as f64 / rec.fps as f64
    };

    RecordingEditorSession {
        width: rec.width,
        height: rec.height,
        fps: rec.fps,
        frame_count,
        duration_secs,
        trim_start_frame: 0,
        trim_end_frame: frame_count,
        terminal_frame: frame_count.saturating_sub(1),
        system_audio_available: has_audio_track(rec, crate::audio::AudioTrackKind::System),
        mic_available: has_audio_track(rec, crate::audio::AudioTrackKind::Mic),
    }
}

fn has_audio_track(rec: &CompletedRecording, kind: crate::audio::AudioTrackKind) -> bool {
    rec.audio_tracks
        .iter()
        .any(|track| track.kind == kind && track.available && track.path.exists())
}

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

#[tauri::command]
pub fn get_recording_editor_session() -> Result<RecordingEditorSession, String> {
    let store = COMPLETED_RECORDING.read().unwrap();
    let rec = store.as_ref().ok_or("No recording available")?;
    Ok(build_recording_editor_session(rec))
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

#[tauri::command]
pub fn get_recording_audio_track_path(kind: String) -> Result<String, String> {
    let track_kind = match kind.as_str() {
        "system" => crate::audio::AudioTrackKind::System,
        "mic" => crate::audio::AudioTrackKind::Mic,
        other => return Err(format!("Unsupported audio track kind: {}", other)),
    };

    let store = COMPLETED_RECORDING.read().unwrap();
    let rec = store.as_ref().ok_or("No recording available")?;
    let track = rec
        .audio_tracks
        .iter()
        .find(|track| track.kind == track_kind && track.available && track.path.exists())
        .ok_or_else(|| format!("Audio track not available: {}", kind))?;

    Ok(track.path.to_string_lossy().to_string())
}

/// Frees the in-memory recording frames.
#[tauri::command]
pub fn cleanup_recording() -> Result<(), String> {
    let mut store = COMPLETED_RECORDING.write().unwrap();
    if let Some(recording) = store.take() {
        crate::audio::cleanup_audio_track_files(&recording.audio_tracks);
        tracing::info!("Recording frames cleared from memory");
    }
    Ok(())
}

fn clear_completed_recording(reason: &str) {
    let mut store = COMPLETED_RECORDING.write().unwrap();
    if let Some(recording) = store.take() {
        crate::audio::cleanup_audio_track_files(&recording.audio_tracks);
        info!("Cleared previous completed recording {}", reason);
    }
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
#[serde(rename_all = "camelCase")]
pub struct ControlWindowGeometry {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingWorkflowConfig {
    pub recording: RecordingConfig,
    pub control: ControlWindowGeometry,
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
    audio_session: Option<crate::audio::AudioCaptureSession>,
    paused: Arc<AtomicBool>,
    stop_signal: Arc<AtomicBool>,
    frames: Arc<Mutex<Vec<Vec<u8>>>>,
}

fn shutdown_recording_session(
    store_completed: bool,
) -> Result<Option<RecordingEditorSession>, String> {
    let mut session_guard = SESSION.lock().unwrap();
    let mut session = match session_guard.take() {
        Some(session) => session,
        None => return Ok(None),
    };

    session.stop_signal.store(true, Ordering::SeqCst);
    let capture_handle = session.capture_thread.take();
    let audio_session = session.audio_session.take();

    // Drop session guard before joining thread to avoid deadlock
    drop(session_guard);

    if let Some(handle) = capture_handle {
        let _ = handle.join();
    }
    let audio_tracks = audio_session
        .map(|session| session.stop().into_iter().collect::<Vec<_>>())
        .unwrap_or_default();

    let completed_frames = std::mem::take(&mut *session.frames.lock().unwrap());
    let frame_count = completed_frames.len();

    if store_completed {
        if completed_frames.is_empty() {
            crate::audio::cleanup_audio_track_files(&audio_tracks);
            *COMPLETED_RECORDING.write().unwrap() = None;
            warn!("Recording stopped without any captured frames");
            return Err(
                "No frames were captured. Another recorder may be blocking screen capture."
                    .to_string(),
            );
        }

        let completed = CompletedRecording {
            width: session.width,
            height: session.height,
            fps: session.fps,
            frames: completed_frames,
            audio_tracks,
        };
        let editor_session = build_recording_editor_session(&completed);

        *COMPLETED_RECORDING.write().unwrap() = Some(completed);

        tracing::info!(
            "Recording stopped: {}x{} ({} frames, in-memory)",
            session.width,
            session.height,
            frame_count
        );

        Ok(Some(editor_session))
    } else {
        crate::audio::cleanup_audio_track_files(&audio_tracks);
        *COMPLETED_RECORDING.write().unwrap() = None;

        tracing::info!(
            "Recording aborted: {}x{} (discarded {} frames)",
            session.width,
            session.height,
            frame_count
        );

        Ok(None)
    }
}

async fn close_window_if_exists(app: &tauri::AppHandle, label: &str) {
    if let Some(window) = app.get_webview_window(label) {
        let _ = window.close();
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
}

fn try_exclude_window_from_capture(app: &tauri::AppHandle, label: &str) {
    if let Err(err) =
        crate::capture::set_window_exclude_from_capture(app.clone(), label.to_string())
    {
        warn!(
            "Failed to exclude '{}' from capture; continuing without exclusion: {}",
            label, err
        );
    }
}

fn build_recording_window(
    app: &tauri::AppHandle,
    label: &str,
    url: &str,
    title: &str,
    visible: bool,
) -> Result<tauri::WebviewWindow, String> {
    WebviewWindowBuilder::new(app, label, WebviewUrl::App(url.into()))
        .title(title)
        .inner_size(100.0, 100.0)
        .position(0.0, 0.0)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .visible(visible)
        .build()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn start_recording_workflow(
    app: tauri::AppHandle,
    workflow: RecordingWorkflowConfig,
) -> Result<(), String> {
    info!(
        "Starting recording workflow: area=({}, {}) {}x{}, control=({}, {}) {}x{}",
        workflow.recording.x,
        workflow.recording.y,
        workflow.recording.width,
        workflow.recording.height,
        workflow.control.x,
        workflow.control.y,
        workflow.control.width,
        workflow.control.height
    );

    close_window_if_exists(&app, "record-indicator").await;
    close_window_if_exists(&app, "record-control").await;
    if let Some(window) = app.get_webview_window("clip-editor") {
        if window.is_visible().map_err(|e| e.to_string())? {
            return Err("Recording editor is already open".to_string());
        }
        let _ = window.close();
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }

    clear_completed_recording("before opening the recording editor placeholder");

    let clip_editor = WebviewWindowBuilder::new(
        &app,
        "clip-editor",
        WebviewUrl::App("src/clip-editor.html".into()),
    )
    .title("Recording Editor")
    .inner_size(900.0, 650.0)
    .center()
    .resizable(true)
    .visible(false)
    .build()
    .map_err(|e| e.to_string())?;

    let indicator = match build_recording_window(
        &app,
        "record-indicator",
        "src/record-indicator.html",
        "Recording Indicator",
        true,
    ) {
        Ok(window) => window,
        Err(err) => {
            warn!("Failed to create record-indicator window: {}", err);
            let _ = clip_editor.close();
            return Err(err);
        }
    };

    info!("Created record-indicator window");

    let mut recording_started = false;
    let setup_result = async {
        indicator
            .set_size(PhysicalSize::new(
                workflow.recording.width.max(1) as u32,
                workflow.recording.height.max(1) as u32,
            ))
            .map_err(|e| e.to_string())?;
        indicator
            .set_position(PhysicalPosition::new(
                workflow.recording.x,
                workflow.recording.y,
            ))
            .map_err(|e| e.to_string())?;
        info!(
            "Applied record-indicator geometry: pos=({}, {}), size={}x{}",
            workflow.recording.x,
            workflow.recording.y,
            workflow.recording.width.max(1),
            workflow.recording.height.max(1)
        );
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        crate::capture::lock_window_position(app.clone(), "record-indicator".to_string())?;
        info!("Locked record-indicator window position");
        try_exclude_window_from_capture(&app, "record-indicator");
        indicator
            .set_ignore_cursor_events(true)
            .map_err(|e| e.to_string())?;
        info!("Set record-indicator to ignore cursor events");

        start_recording(workflow.recording.clone())?;
        recording_started = true;
        info!("Recording session started");

        let control = build_recording_window(
            &app,
            "record-control",
            "src/record-control.html",
            "Recording",
            true,
        )?;
        info!("Created record-control window");
        control
            .set_size(PhysicalSize::new(
                workflow.control.width.max(1),
                workflow.control.height.max(1),
            ))
            .map_err(|e| e.to_string())?;
        control
            .set_position(PhysicalPosition::new(
                workflow.control.x,
                workflow.control.y,
            ))
            .map_err(|e| e.to_string())?;
        info!(
            "Applied record-control geometry: pos=({}, {}), size={}x{}",
            workflow.control.x,
            workflow.control.y,
            workflow.control.width.max(1),
            workflow.control.height.max(1)
        );
        try_exclude_window_from_capture(&app, "record-control");
        info!("Recording workflow setup complete");

        Ok::<(), String>(())
    }
    .await;

    if let Err(err) = setup_result {
        warn!("Recording workflow failed during setup: {}", err);
        let _ = app.emit("recording-cancelled", ());
        let _ = app
            .get_webview_window("record-control")
            .map(|window| window.close());
        let _ = indicator.close();
        let _ = clip_editor.close();
        if recording_started {
            let _ = shutdown_recording_session(false);
        } else {
            let _ = cleanup_recording();
        }
        return Err(err);
    }

    Ok(())
}

#[tauri::command]
pub fn start_recording(config: RecordingConfig) -> Result<(), String> {
    let mut session_guard = SESSION.lock().unwrap();
    if session_guard.is_some() {
        return Err("Already recording".to_string());
    }

    clear_completed_recording("before starting a new session");

    // Round to even dimensions (required for H.264 export later)
    let width = ((config.width + 1) & !1) as u32;
    let height = ((config.height + 1) & !1) as u32;
    let fps = config.fps;
    let origin_x = config.x;
    let origin_y = config.y;

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
    let audio_session = Some(crate::audio::start_default_audio_capture(paused.clone()));

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
        audio_session,
        paused,
        stop_signal,
        frames,
    };

    *session_guard = Some(session);

    tracing::info!(
        "Recording started (in-memory): origin=({}, {}), {}x{} @ {}fps",
        origin_x,
        origin_y,
        width,
        height,
        fps
    );
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
        BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC,
        GetDIBits, ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
        SRCCOPY,
    };

    let frame_duration = std::time::Duration::from_secs_f64(1.0 / config.fps as f64);
    let frame_size = (config.width * config.height * 4) as usize;

    info!(
        "Capture loop starting: origin=({}, {}), {}x{}, target_fps={}",
        config.x, config.y, config.width, config.height, config.fps
    );

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
                hdc_mem,
                0,
                0,
                config.width,
                config.height,
                Some(hdc_screen),
                config.x,
                config.y,
                SRCCOPY,
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

    info!(
        "Capture loop exited: origin=({}, {}), captured_frames={}",
        config.x,
        config.y,
        frame_count.load(Ordering::SeqCst)
    );
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
pub fn stop_recording(app: tauri::AppHandle) -> Result<RecordingEditorSession, String> {
    let editor_session = shutdown_recording_session(true)?.ok_or("Not recording".to_string())?;
    info!(
        "Emitting recording-stopped: frames={}, duration_secs={:.2}",
        editor_session.frame_count, editor_session.duration_secs
    );
    let _ = app.emit("recording-stopped", &editor_session);
    Ok(editor_session)
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

#[cfg(test)]
mod tests {
    use super::{build_recording_editor_session, CompletedRecording};

    #[test]
    fn recording_editor_session_uses_exclusive_trim_end() {
        let recording = CompletedRecording {
            width: 1920,
            height: 1080,
            fps: 30,
            frames: vec![vec![0; 4]; 10],
            audio_tracks: Vec::new(),
        };

        let session = build_recording_editor_session(&recording);

        assert_eq!(session.trim_start_frame, 0);
        assert_eq!(session.trim_end_frame, 10);
        assert_eq!(session.terminal_frame, 9);
        assert!((session.duration_secs - (10.0 / 30.0)).abs() < f64::EPSILON);
    }

    #[test]
    fn empty_recording_session_clamps_terminal_frame() {
        let recording = CompletedRecording {
            width: 1,
            height: 1,
            fps: 30,
            frames: Vec::new(),
            audio_tracks: Vec::new(),
        };

        let session = build_recording_editor_session(&recording);

        assert_eq!(session.trim_end_frame, 0);
        assert_eq!(session.terminal_frame, 0);
        assert_eq!(session.duration_secs, 0.0);
    }
}
