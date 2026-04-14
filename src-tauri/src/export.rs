use serde::{Deserialize, Serialize};
use std::io::Write;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter};

use crate::recording::COMPLETED_RECORDING;

static EXPORTING: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportConfig {
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
pub struct PreparedExportConfig {
    pub config: ExportConfig,
    pub selected_frame_count: u64,
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
    let config = normalize_export_config(config)?;

    if EXPORTING
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("Already exporting".to_string());
    }

    std::thread::spawn(move || {
        let result = match config.format.as_str() {
            "gif" => export_gif(&app, &config),
            _ => export_mp4(&app, &config),
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

#[tauri::command]
pub fn prepare_export_video(config: ExportConfig) -> Result<PreparedExportConfig, String> {
    let config = normalize_export_config(config)?;
    let selected_frame_count = selected_frame_count(&config);

    Ok(PreparedExportConfig {
        config,
        selected_frame_count,
    })
}

/// Read recording metadata from the in-memory store.
fn read_recording_meta() -> Result<(u32, u32, u32, usize), String> {
    let store = COMPLETED_RECORDING.read().unwrap();
    let rec = store.as_ref().ok_or("No recording available")?;
    Ok((rec.width, rec.height, rec.fps, rec.frames.len()))
}

fn selected_frame_count(config: &ExportConfig) -> u64 {
    (config.end_frame - config.start_frame) as u64
}

fn normalize_export_config(config: ExportConfig) -> Result<ExportConfig, String> {
    let (_, _, _, total_frames) = read_recording_meta()?;
    validate_export_config(config, total_frames as u32)
}

fn validate_export_config(
    mut config: ExportConfig,
    total_frames: u32,
) -> Result<ExportConfig, String> {
    if total_frames == 0 {
        return Err("No recording frames available for export".to_string());
    }

    if config.output_path.trim().is_empty() {
        return Err("Output path is required".to_string());
    }

    if !config.speed.is_finite() || config.speed <= 0.0 {
        return Err("Playback speed must be greater than 0".to_string());
    }

    match config.format.as_str() {
        "mp4" => {
            config.gif_fps = None;
            config.gif_max_width = None;
        }
        "gif" => {
            config.gif_fps = Some(config.gif_fps.unwrap_or(15).max(1));
            config.gif_max_width = Some(config.gif_max_width.unwrap_or(640).max(1));
        }
        other => return Err(format!("Unsupported export format: {}", other)),
    }

    if config.start_frame >= total_frames {
        return Err(format!(
            "Start frame {} is out of range for {} total frames",
            config.start_frame, total_frames
        ));
    }

    if config.end_frame == 0 || config.end_frame > total_frames {
        return Err(format!(
            "End frame {} is out of range for {} total frames",
            config.end_frame, total_frames
        ));
    }

    if config.end_frame <= config.start_frame {
        return Err(format!(
            "End frame {} must be greater than start frame {}",
            config.end_frame, config.start_frame
        ));
    }

    Ok(config)
}

fn export_mp4(app: &AppHandle, config: &ExportConfig) -> Result<(), String> {
    let (width, height, fps, _total) = read_recording_meta()?;
    let total_frames = selected_frame_count(config);

    let mut vf_filters: Vec<String> = Vec::new();
    if (config.speed - 1.0).abs() > 0.01 {
        vf_filters.push(format!("setpts={}*PTS", 1.0 / config.speed));
    }

    let mut args = vec![
        "-y".to_string(),
        "-f".to_string(),
        "rawvideo".to_string(),
        "-pixel_format".to_string(),
        "bgra".to_string(),
        "-video_size".to_string(),
        format!("{}x{}", width, height),
        "-framerate".to_string(),
        fps.to_string(),
        "-i".to_string(),
        "pipe:0".to_string(),
    ];

    if !vf_filters.is_empty() {
        args.extend(["-vf".to_string(), vf_filters.join(",")]);
    }

    args.extend([
        "-c:v".to_string(),
        "libx264".to_string(),
        "-preset".to_string(),
        "medium".to_string(),
        "-crf".to_string(),
        "23".to_string(),
        "-pix_fmt".to_string(),
        "yuv420p".to_string(),
        config.output_path.clone(),
    ]);

    pipe_frames_to_ffmpeg(app, config, total_frames, &args, 0.0, 1.0)
}

fn export_gif(app: &AppHandle, config: &ExportConfig) -> Result<(), String> {
    let (width, height, fps, _total) = read_recording_meta()?;
    let total_frames = selected_frame_count(config);
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
        "-f".to_string(),
        "rawvideo".to_string(),
        "-pixel_format".to_string(),
        "bgra".to_string(),
        "-video_size".to_string(),
        format!("{}x{}", width, height),
        "-framerate".to_string(),
        fps.to_string(),
        "-i".to_string(),
        "pipe:0".to_string(),
        "-vf".to_string(),
        format!("{},palettegen", filter),
        palette_path.clone(),
    ];

    pipe_frames_to_ffmpeg(app, config, total_frames, &palette_args, 0.0, 0.5)?;

    // Step 2: Generate GIF using palette
    let gif_args = vec![
        "-y".to_string(),
        "-f".to_string(),
        "rawvideo".to_string(),
        "-pixel_format".to_string(),
        "bgra".to_string(),
        "-video_size".to_string(),
        format!("{}x{}", width, height),
        "-framerate".to_string(),
        fps.to_string(),
        "-i".to_string(),
        "pipe:0".to_string(),
        "-i".to_string(),
        palette_path.clone(),
        "-lavfi".to_string(),
        format!("{} [x]; [x][1:v] paletteuse", filter),
        config.output_path.clone(),
    ];

    pipe_frames_to_ffmpeg(app, config, total_frames, &gif_args, 0.5, 1.0)?;

    let _ = std::fs::remove_file(&palette_path);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{selected_frame_count, validate_export_config, ExportConfig};

    fn make_config(start_frame: u32, end_frame: u32) -> ExportConfig {
        ExportConfig {
            output_path: "out.mp4".to_string(),
            start_frame,
            end_frame,
            speed: 1.0,
            format: "mp4".to_string(),
            gif_fps: None,
            gif_max_width: None,
        }
    }

    #[test]
    fn full_selection_should_count_the_last_frame() {
        let config = make_config(0, 10);

        assert_eq!(selected_frame_count(&config), 10);
    }

    #[test]
    fn single_frame_selection_should_export_one_frame() {
        let config = make_config(0, 1);

        assert_eq!(selected_frame_count(&config), 1);
    }

    #[test]
    fn validate_export_config_applies_gif_defaults() {
        let config = ExportConfig {
            output_path: "out.gif".to_string(),
            start_frame: 0,
            end_frame: 10,
            speed: 1.0,
            format: "gif".to_string(),
            gif_fps: None,
            gif_max_width: None,
        };

        let validated = validate_export_config(config, 10).expect("gif config should validate");

        assert_eq!(validated.gif_fps, Some(15));
        assert_eq!(validated.gif_max_width, Some(640));
    }

    #[test]
    fn validate_export_config_rejects_exclusive_end_out_of_range() {
        let err = validate_export_config(make_config(0, 11), 10)
            .expect_err("end frame beyond frame_count should fail");

        assert!(err.contains("End frame 11 is out of range"));
    }

    #[test]
    fn validate_export_config_rejects_non_positive_speed() {
        let mut config = make_config(0, 10);
        config.speed = 0.0;

        let err =
            validate_export_config(config, 10).expect_err("zero speed should fail validation");

        assert!(err.contains("Playback speed must be greater than 0"));
    }
}

fn pipe_frames_to_ffmpeg(
    app: &AppHandle,
    config: &ExportConfig,
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

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to start ffmpeg: {}", e))?;

    let mut stdin = child.stdin.take().ok_or("Failed to open ffmpeg stdin")?;

    let progress_range = progress_end - progress_start;
    let mut write_error: Option<String> = None;

    // Read frames from the in-memory store
    let store = COMPLETED_RECORDING.read().unwrap();
    let rec = store.as_ref().ok_or("No recording available")?;

    for i in 0..total_frames {
        let frame_idx = (config.start_frame as u64 + i) as usize;
        if frame_idx >= rec.frames.len() {
            write_error = Some(format!("Frame index {} out of range", frame_idx));
            break;
        }

        // Write raw BGRA frame directly to FFmpeg (no conversion needed)
        if let Err(e) = stdin.write_all(&rec.frames[frame_idx]) {
            write_error = Some(format!("FFmpeg stdin write error at frame {}: {}", i, e));
            break;
        }

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

    drop(stdin);
    drop(store); // Release read lock

    let output = child
        .wait_with_output()
        .map_err(|e| format!("FFmpeg wait failed: {}", e))?;

    if let Some(e) = write_error {
        return Err(e);
    }

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("FFmpeg failed: {}", stderr));
    }

    Ok(())
}
