use serde::{Deserialize, Serialize};
use std::io::{Read, Seek, SeekFrom, Write};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter};

use crate::recording::{read_rawv_header, RAWV_HEADER_SIZE};

static EXPORTING: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportConfig {
    pub input_path: String,   // path to .rawv file
    pub output_path: String,
    pub start_frame: u32,
    pub end_frame: u32,
    pub speed: f64,
    pub format: String, // "mp4" or "gif"
    pub gif_fps: Option<u32>,
    pub gif_max_width: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportProgress {
    progress: f64,
    current_frame: u64,
    total_frames: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportComplete {
    success: bool,
    output_path: Option<String>,
    error: Option<String>,
}

#[tauri::command]
pub fn export_video(app: AppHandle, config: ExportConfig) -> Result<(), String> {
    // Atomic compare_exchange to prevent TOCTOU race
    if EXPORTING.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst).is_err() {
        return Err("Already exporting".to_string());
    }

    // Spawn async export in background
    std::thread::spawn(move || {
        let result = match config.format.as_str() {
            "gif" => export_gif_from_rawv(&app, &config),
            _ => export_mp4_from_rawv(&app, &config),
        };

        let complete = match result {
            Ok(()) => ExportComplete {
                success: true,
                output_path: Some(config.output_path.clone()),
                error: None,
            },
            Err(e) => ExportComplete {
                success: false,
                output_path: None,
                error: Some(e),
            },
        };

        let _ = app.emit("export-complete", &complete);
        EXPORTING.store(false, Ordering::SeqCst);
    });

    Ok(())
}

fn export_mp4_from_rawv(app: &AppHandle, config: &ExportConfig) -> Result<(), String> {
    let info = read_rawv_header(&config.input_path)?;
    let frame_size = (info.width * info.height * 4) as usize;
    let total_frames = (config.end_frame - config.start_frame) as u64;

    let mut vf_filters: Vec<String> = Vec::new();
    if (config.speed - 1.0).abs() > 0.01 {
        vf_filters.push(format!("setpts={}*PTS", 1.0 / config.speed));
    }

    let mut args = vec![
        "-y".to_string(),
        "-f".to_string(), "rawvideo".to_string(),
        "-pixel_format".to_string(), "bgra".to_string(),
        "-video_size".to_string(), format!("{}x{}", info.width, info.height),
        "-framerate".to_string(), info.fps.to_string(),
        "-i".to_string(), "pipe:0".to_string(),
    ];

    if !vf_filters.is_empty() {
        args.extend(["-vf".to_string(), vf_filters.join(",")]);
    }

    args.extend([
        "-c:v".to_string(), "libx264".to_string(),
        "-preset".to_string(), "medium".to_string(),
        "-crf".to_string(), "23".to_string(),
        "-pix_fmt".to_string(), "yuv420p".to_string(),
        config.output_path.clone(),
    ]);

    pipe_rawv_to_ffmpeg(app, config, frame_size, total_frames, &args)
}

fn export_gif_from_rawv(app: &AppHandle, config: &ExportConfig) -> Result<(), String> {
    let info = read_rawv_header(&config.input_path)?;
    let frame_size = (info.width * info.height * 4) as usize;
    let total_frames = (config.end_frame - config.start_frame) as u64;
    let gif_fps = config.gif_fps.unwrap_or(15);
    let max_width = config.gif_max_width.unwrap_or(640);

    let palette_path = format!("{}.palette.png", config.output_path);

    let mut filter = format!(
        "fps={},scale='min({},iw)':-1:flags=lanczos",
        gif_fps, max_width
    );
    if (config.speed - 1.0).abs() > 0.01 {
        filter = format!("setpts={}*PTS,{}", 1.0 / config.speed, filter);
    }

    // Step 1: Generate palette
    let palette_args = vec![
        "-y".to_string(),
        "-f".to_string(), "rawvideo".to_string(),
        "-pixel_format".to_string(), "bgra".to_string(),
        "-video_size".to_string(), format!("{}x{}", info.width, info.height),
        "-framerate".to_string(), info.fps.to_string(),
        "-i".to_string(), "pipe:0".to_string(),
        "-vf".to_string(), format!("{},palettegen", filter),
        palette_path.clone(),
    ];

    // Use half progress for palette generation
    pipe_rawv_to_ffmpeg_with_progress_range(
        app, config, frame_size, total_frames, &palette_args, 0.0, 0.5,
    )?;

    // Step 2: Generate GIF using palette
    let gif_args = vec![
        "-y".to_string(),
        "-f".to_string(), "rawvideo".to_string(),
        "-pixel_format".to_string(), "bgra".to_string(),
        "-video_size".to_string(), format!("{}x{}", info.width, info.height),
        "-framerate".to_string(), info.fps.to_string(),
        "-i".to_string(), "pipe:0".to_string(),
        "-i".to_string(), palette_path.clone(),
        "-lavfi".to_string(), format!("{} [x]; [x][1:v] paletteuse", filter),
        config.output_path.clone(),
    ];

    pipe_rawv_to_ffmpeg_with_progress_range(
        app, config, frame_size, total_frames, &gif_args, 0.5, 1.0,
    )?;

    // Clean up palette file
    let _ = std::fs::remove_file(&palette_path);

    Ok(())
}

fn pipe_rawv_to_ffmpeg(
    app: &AppHandle,
    config: &ExportConfig,
    frame_size: usize,
    total_frames: u64,
    args: &[String],
) -> Result<(), String> {
    pipe_rawv_to_ffmpeg_with_progress_range(app, config, frame_size, total_frames, args, 0.0, 1.0)
}

fn pipe_rawv_to_ffmpeg_with_progress_range(
    app: &AppHandle,
    config: &ExportConfig,
    frame_size: usize,
    total_frames: u64,
    args: &[String],
    progress_start: f64,
    progress_end: f64,
) -> Result<(), String> {
    let mut cmd = Command::new("ffmpeg");
    cmd.args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let mut child = cmd.spawn()
        .map_err(|e| format!("Failed to start ffmpeg: {}", e))?;

    let mut stdin = child.stdin.take()
        .ok_or("Failed to open ffmpeg stdin")?;

    // Open rawv file and seek to start frame
    let mut file = std::fs::File::open(&config.input_path)
        .map_err(|e| format!("Failed to open rawv file: {}", e))?;

    let start_offset = RAWV_HEADER_SIZE + config.start_frame as u64 * frame_size as u64;
    file.seek(SeekFrom::Start(start_offset))
        .map_err(|e| format!("Failed to seek: {}", e))?;

    let mut frame_buf = vec![0u8; frame_size];
    let progress_range = progress_end - progress_start;
    let mut write_error: Option<String> = None;

    for i in 0..total_frames {
        if let Err(e) = file.read_exact(&mut frame_buf) {
            write_error = Some(format!("Failed to read frame {}: {}", i, e));
            break;
        }
        if let Err(e) = stdin.write_all(&frame_buf) {
            write_error = Some(format!("FFmpeg stdin write error at frame {}: {}", i, e));
            break;
        }

        // Emit progress every 10 frames
        if i % 10 == 0 || i == total_frames - 1 {
            let ratio = (i + 1) as f64 / total_frames as f64;
            let progress = progress_start + ratio * progress_range;
            let _ = app.emit(
                "export-progress",
                ExportProgress {
                    progress,
                    current_frame: i + 1,
                    total_frames,
                },
            );
        }
    }

    // Close stdin to signal end of input
    drop(stdin);

    let output = child.wait_with_output()
        .map_err(|e| format!("FFmpeg wait failed: {}", e))?;

    // Report write errors
    if let Some(e) = write_error {
        return Err(e);
    }

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("FFmpeg failed: {}", stderr));
    }

    Ok(())
}
