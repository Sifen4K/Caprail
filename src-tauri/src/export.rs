use serde::{Deserialize, Serialize};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};

static EXPORTING: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportConfig {
    pub input_path: String,
    pub output_path: String,
    pub start_time: f64,
    pub end_time: f64,
    pub speed: f64,
    pub format: String, // "mp4" or "gif"
    pub gif_fps: Option<u32>,
    pub gif_max_width: Option<u32>,
}

#[tauri::command]
pub fn export_video(config: ExportConfig) -> Result<(), String> {
    if EXPORTING.load(Ordering::SeqCst) {
        return Err("Already exporting".to_string());
    }
    EXPORTING.store(true, Ordering::SeqCst);

    let result = match config.format.as_str() {
        "gif" => export_gif(&config),
        _ => export_mp4(&config),
    };

    EXPORTING.store(false, Ordering::SeqCst);
    result
}

fn export_mp4(config: &ExportConfig) -> Result<(), String> {
    let duration = config.end_time - config.start_time;
    let pts_filter = if (config.speed - 1.0).abs() > 0.01 {
        format!("setpts={}*PTS", 1.0 / config.speed)
    } else {
        String::new()
    };

    let mut args = vec![
        "-y".to_string(),
        "-ss".to_string(),
        config.start_time.to_string(),
        "-t".to_string(),
        duration.to_string(),
        "-i".to_string(),
        config.input_path.clone(),
    ];

    if !pts_filter.is_empty() {
        args.extend(["-vf".to_string(), pts_filter]);
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

    run_ffmpeg(&args)
}

fn export_gif(config: &ExportConfig) -> Result<(), String> {
    let duration = config.end_time - config.start_time;
    let fps = config.gif_fps.unwrap_or(15);
    let max_width = config.gif_max_width.unwrap_or(640);

    // GIF export using palettegen + paletteuse for quality
    let palette_path = format!("{}.palette.png", config.output_path);

    let mut filter = format!(
        "fps={},scale='min({},iw)':-1:flags=lanczos",
        fps, max_width
    );

    if (config.speed - 1.0).abs() > 0.01 {
        filter = format!("setpts={}*PTS,{}", 1.0 / config.speed, filter);
    }

    // Step 1: Generate palette
    let palette_args = [
        "-y",
        "-ss", &config.start_time.to_string(),
        "-t", &duration.to_string(),
        "-i", &config.input_path,
        "-vf", &format!("{},palettegen", filter),
        &palette_path,
    ];
    run_ffmpeg(&palette_args.iter().map(|s| s.to_string()).collect::<Vec<_>>())?;

    // Step 2: Generate GIF using palette
    let gif_args = [
        "-y",
        "-ss", &config.start_time.to_string(),
        "-t", &duration.to_string(),
        "-i", &config.input_path,
        "-i", &palette_path,
        "-lavfi", &format!("{} [x]; [x][1:v] paletteuse", filter),
        &config.output_path,
    ];
    let result = run_ffmpeg(&gif_args.iter().map(|s| s.to_string()).collect::<Vec<_>>());

    // Clean up palette file
    let _ = std::fs::remove_file(&palette_path);

    result
}

fn run_ffmpeg(args: &[String]) -> Result<(), String> {
    let output = Command::new("ffmpeg")
        .args(args)
        .output()
        .map_err(|e| format!("Failed to run ffmpeg: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ffmpeg failed: {}", stderr));
    }

    Ok(())
}

#[tauri::command]
pub fn get_video_duration(path: String) -> Result<f64, String> {
    let output = Command::new("ffprobe")
        .args([
            "-v", "error",
            "-show_entries", "format=duration",
            "-of", "csv=p=0",
            &path,
        ])
        .output()
        .map_err(|e| format!("Failed to run ffprobe: {}", e))?;

    if !output.status.success() {
        return Err("ffprobe failed".to_string());
    }

    let duration_str = String::from_utf8_lossy(&output.stdout);
    duration_str
        .trim()
        .parse::<f64>()
        .map_err(|e| format!("Failed to parse duration: {}", e))
}
