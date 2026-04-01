use serde::{Deserialize, Serialize};
use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OcrResult {
    pub text: String,
    pub regions: Vec<OcrRegion>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OcrRegion {
    pub text: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub confidence: f64,
}

/// Performs OCR on an image.
/// Expects RGBA pixel data. Saves to a temp PNG, runs PaddleOCR CLI, parses results.
/// If PaddleOCR CLI is not available, falls back to Windows OCR (WinRT).
#[tauri::command]
pub fn ocr_recognize(
    image_data: Vec<u8>,
    width: u32,
    height: u32,
) -> Result<OcrResult, String> {
    // Save image to temp file
    let temp_dir = std::env::temp_dir().join("screenshot-tool-ocr");
    std::fs::create_dir_all(&temp_dir).map_err(|e| e.to_string())?;
    let temp_path = temp_dir.join("ocr_input.png");

    // Convert RGBA to PNG
    let img = image::RgbaImage::from_raw(width, height, image_data)
        .ok_or("Invalid image data")?;
    img.save(&temp_path).map_err(|e| e.to_string())?;

    // Try PaddleOCR CLI first
    let result = run_paddleocr(&temp_path);
    if let Ok(r) = result {
        let _ = std::fs::remove_file(&temp_path);
        return Ok(r);
    }

    // Fallback: try Tesseract
    let result = run_tesseract(&temp_path);
    let _ = std::fs::remove_file(&temp_path);
    result
}

fn run_paddleocr(image_path: &std::path::Path) -> Result<OcrResult, String> {
    // Look for PaddleOCR CLI or Python script
    let output = Command::new("paddleocr")
        .args([
            "--image_dir",
            image_path.to_str().unwrap(),
            "--use_angle_cls", "true",
            "--lang", "ch",
        ])
        .output()
        .map_err(|e| format!("PaddleOCR not found: {}", e))?;

    if !output.status.success() {
        return Err("PaddleOCR failed".to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    parse_paddleocr_output(&stdout)
}

fn parse_paddleocr_output(output: &str) -> Result<OcrResult, String> {
    let mut regions = Vec::new();
    let mut full_text = String::new();

    for line in output.lines() {
        let line = line.trim();
        // PaddleOCR output format: [[[x1,y1],[x2,y2],[x3,y3],[x4,y4]], ('text', confidence)]
        if let Some(text_start) = line.find("('") {
            if let Some(text_end) = line.rfind("',") {
                let text = &line[text_start + 2..text_end];
                if !text.is_empty() {
                    if !full_text.is_empty() {
                        full_text.push('\n');
                    }
                    full_text.push_str(text);

                    regions.push(OcrRegion {
                        text: text.to_string(),
                        x: 0.0,
                        y: 0.0,
                        width: 0.0,
                        height: 0.0,
                        confidence: 0.9,
                    });
                }
            }
        }
    }

    Ok(OcrResult {
        text: full_text,
        regions,
    })
}

fn run_tesseract(image_path: &std::path::Path) -> Result<OcrResult, String> {
    let output = Command::new("tesseract")
        .args([
            image_path.to_str().unwrap(),
            "stdout",
            "-l", "chi_sim+eng",
        ])
        .output()
        .map_err(|e| format!("Tesseract not found: {}. Install PaddleOCR or Tesseract for OCR.", e))?;

    if !output.status.success() {
        return Err("Tesseract failed".to_string());
    }

    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Ok(OcrResult {
        text,
        regions: vec![],
    })
}
