use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::{
    io::{BufRead, BufReader, Write},
    process::{Child, ChildStdin, ChildStdout, Command, Stdio},
    sync::Mutex,
};

use crate::capture::SCREENSHOT_STORE;

static OCR_WORKER: Lazy<Mutex<Option<PaddleOcrWorker>>> = Lazy::new(|| Mutex::new(None));
const OCR_READY_PREFIX: &str = "__CAPRAIL_OCR_READY__";
const OCR_RESULT_PREFIX: &str = "__CAPRAIL_OCR_RESULT__";

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
pub async fn ocr_recognize(
    image_data: Vec<u8>,
    width: u32,
    height: u32,
) -> Result<OcrResult, String> {
    tauri::async_runtime::spawn_blocking(move || ocr_recognize_rgba(image_data, width, height))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn ocr_recognize_screenshot(id: u32) -> Result<OcrResult, String> {
    let (mut rgba, width, height) = {
        let store = SCREENSHOT_STORE.read().unwrap();
        let screenshot = store
            .get(&id)
            .ok_or_else(|| format!("No screenshot with id {}", id))?;
        (screenshot.data.clone(), screenshot.width, screenshot.height)
    };

    for pixel in rgba.chunks_exact_mut(4) {
        pixel.swap(0, 2);
    }

    tauri::async_runtime::spawn_blocking(move || ocr_recognize_rgba(rgba, width, height))
        .await
        .map_err(|e| e.to_string())?
}

fn ocr_recognize_rgba(
    image_data: Vec<u8>,
    width: u32,
    height: u32,
) -> Result<OcrResult, String> {
    // Save image to temp file
    let temp_dir = std::env::temp_dir().join("caprail-ocr");
    std::fs::create_dir_all(&temp_dir).map_err(|e| e.to_string())?;
    let temp_path = temp_dir.join(format!(
        "ocr_input_{}.png",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_nanos()
    ));

    // Convert RGBA to PNG
    let img = image::RgbaImage::from_raw(width, height, image_data)
        .ok_or("Invalid image data")?;
    img.save(&temp_path).map_err(|e| e.to_string())?;

    let mut errors = Vec::new();

    // Try PaddleOCR first
    match run_paddleocr(&temp_path) {
        Ok(result) => {
            let _ = std::fs::remove_file(&temp_path);
            return Ok(result);
        }
        Err(err) => errors.push(err),
    }

    // Fallback: try Tesseract
    let result = match run_tesseract(&temp_path) {
        Ok(result) => Ok(result),
        Err(err) => {
            errors.push(err);
            Err(format!(
                "OCR unavailable. {}",
                errors.join(" | ")
            ))
        }
    };
    let _ = std::fs::remove_file(&temp_path);
    result
}

fn run_paddleocr(image_path: &std::path::Path) -> Result<OcrResult, String> {
    let image_path_str = image_path
        .to_str()
        .ok_or_else(|| "Invalid OCR image path".to_string())?;
    let mut errors = Vec::new();

    for _ in 0..2 {
        let mut worker = OCR_WORKER.lock().unwrap();
        if worker.is_none() {
            match PaddleOcrWorker::spawn() {
                Ok(instance) => *worker = Some(instance),
                Err(err) => {
                    errors.push(err);
                    break;
                }
            }
        }

        if let Some(instance) = worker.as_mut() {
            match instance.recognize(image_path_str) {
                Ok(result) => return Ok(result),
                Err(err) => {
                    errors.push(err);
                    *worker = None;
                }
            }
        }
    }

    let cli_args_v3 = [
        "ocr",
        "-i",
        image_path_str,
        "--lang",
        "ch",
        "--use_doc_orientation_classify",
        "False",
        "--use_doc_unwarping",
        "False",
        "--use_textline_orientation",
        "False",
        "--enable_mkldnn",
        "False",
        "--device",
        "cpu",
    ];

    if let Some(output) = try_command("paddleocr", &cli_args_v3, &mut errors) {
        return parse_paddleocr_output(&String::from_utf8_lossy(&output.stdout));
    }

    let cli_args_legacy = [
        "--image_dir",
        image_path_str,
        "--use_angle_cls",
        "true",
        "--lang",
        "ch",
        "--enable_mkldnn",
        "False",
        "--device",
        "cpu",
    ];

    if let Some(output) = try_command("paddleocr", &cli_args_legacy, &mut errors) {
        return parse_paddleocr_output(&String::from_utf8_lossy(&output.stdout));
    }

    Err(format!("PaddleOCR unavailable: {}", errors.join(" | ")))
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
    let image_path_str = image_path
        .to_str()
        .ok_or_else(|| "Invalid OCR image path".to_string())?;
    let output = hidden_command("tesseract")
        .args([
            image_path_str,
            "stdout",
            "-l", "chi_sim+eng",
        ])
        .output()
        .map_err(|e| format!("Tesseract unavailable: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let message = if stderr.is_empty() {
            "Tesseract failed".to_string()
        } else {
            format!("Tesseract failed: {}", stderr)
        };
        return Err(message);
    }

    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Ok(OcrResult {
        text,
        regions: vec![],
    })
}

fn try_command(
    program: &str,
    args: &[&str],
    errors: &mut Vec<String>,
) -> Option<std::process::Output> {
    match hidden_command(program)
        .env("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")
        .env("FLAGS_enable_pir_api", "0")
        .args(args)
        .output()
    {
        Ok(output) if output.status.success() => Some(output),
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let message = if stderr.is_empty() {
                format!("{program} exited with status {}", output.status)
            } else {
                format!("{program} failed: {stderr}")
            };
            errors.push(message);
            None
        }
        Err(err) => {
            errors.push(format!("{program} not found: {err}"));
            None
        }
    }
}

fn hidden_command(program: &str) -> Command {
    let mut command = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

#[derive(Serialize)]
struct WorkerRequest<'a> {
    image_path: &'a str,
}

#[derive(Deserialize)]
struct WorkerResponse {
    ok: bool,
    text: Option<String>,
    regions: Option<Vec<OcrRegion>>,
    error: Option<String>,
}

struct PaddleOcrWorker {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

impl PaddleOcrWorker {
    fn spawn() -> Result<Self, String> {
        let mut errors = Vec::new();

        if let Ok(worker) = Self::spawn_with("python", &["-u", "-c", PYTHON_OCR_WORKER_SCRIPT]) {
            return Ok(worker);
        }
        errors.push("python worker launch failed".to_string());

        for args in [
            vec!["-3", "-u", "-c", PYTHON_OCR_WORKER_SCRIPT],
            vec!["-u", "-c", PYTHON_OCR_WORKER_SCRIPT],
        ] {
            match Self::spawn_with("py", &args) {
                Ok(worker) => return Ok(worker),
                Err(err) => errors.push(err),
            }
        }

        Err(format!("PaddleOCR worker unavailable: {}", errors.join(" | ")))
    }

    fn spawn_with(program: &str, args: &[&str]) -> Result<Self, String> {
        let mut child = hidden_command(program)
            .env("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")
            .env("FLAGS_enable_pir_api", "0")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .args(args)
            .spawn()
            .map_err(|e| format!("{program} not found: {e}"))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| format!("{program} worker stdin unavailable"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| format!("{program} worker stdout unavailable"))?;
        let mut worker = Self {
            child,
            stdin,
            stdout: BufReader::new(stdout),
        };
        worker.wait_until_ready()?;
        Ok(worker)
    }

    fn wait_until_ready(&mut self) -> Result<(), String> {
        let mut line = String::new();
        loop {
            line.clear();
            let bytes = self
                .stdout
                .read_line(&mut line)
                .map_err(|e| format!("Failed to read OCR worker startup: {e}"))?;
            if bytes == 0 {
                let status = self
                    .child
                    .try_wait()
                    .ok()
                    .flatten()
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| "unknown status".to_string());
                return Err(format!("OCR worker exited during startup: {status}"));
            }

            if line.trim() == OCR_READY_PREFIX {
                return Ok(());
            }
        }
    }

    fn recognize(&mut self, image_path: &str) -> Result<OcrResult, String> {
        let request = serde_json::to_string(&WorkerRequest { image_path })
            .map_err(|e| format!("Failed to serialize OCR request: {e}"))?;
        writeln!(self.stdin, "{request}")
            .and_then(|_| self.stdin.flush())
            .map_err(|e| format!("Failed to send OCR request: {e}"))?;

        let mut line = String::new();
        loop {
            line.clear();
            let bytes = self
                .stdout
                .read_line(&mut line)
                .map_err(|e| format!("Failed to read OCR worker response: {e}"))?;
            if bytes == 0 {
                let status = self
                    .child
                    .try_wait()
                    .ok()
                    .flatten()
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| "unknown status".to_string());
                return Err(format!("OCR worker exited while recognizing: {status}"));
            }

            if let Some(payload) = line.trim().strip_prefix(OCR_RESULT_PREFIX) {
                let response: WorkerResponse = serde_json::from_str(payload)
                    .map_err(|e| format!("Invalid OCR worker response: {e}"))?;
                if response.ok {
                    return Ok(OcrResult {
                        text: response.text.unwrap_or_default(),
                        regions: response.regions.unwrap_or_default(),
                    });
                }
                return Err(response
                    .error
                    .unwrap_or_else(|| "OCR worker failed".to_string()));
            }
        }
    }
}

impl Drop for PaddleOcrWorker {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

const PYTHON_OCR_WORKER_SCRIPT: &str = r#"
import json
import sys
from paddleocr import PaddleOCR

READY_PREFIX = "__CAPRAIL_OCR_READY__"
RESULT_PREFIX = "__CAPRAIL_OCR_RESULT__"

ocr = PaddleOCR(
    lang="ch",
    use_doc_orientation_classify=False,
    use_doc_unwarping=False,
    use_textline_orientation=False,
    enable_mkldnn=False,
    device="cpu",
)
print(READY_PREFIX, flush=True)

for raw_line in sys.stdin:
    raw_line = raw_line.strip()
    if not raw_line:
        continue

    try:
        request = json.loads(raw_line)
        result = ocr.predict(
            request["image_path"],
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_textline_orientation=False,
        )

        texts = []
        regions = []
        for item in result:
            data = item.json if hasattr(item, "json") else item
            if isinstance(data, dict) and "res" in data:
                data = data["res"]
            rec_texts = data.get("rec_texts", []) if isinstance(data, dict) else []
            rec_scores = data.get("rec_scores", []) if isinstance(data, dict) else []
            rec_polys = data.get("rec_polys", []) if isinstance(data, dict) else []

            for index, text in enumerate(rec_texts):
                if not text:
                    continue
                score = rec_scores[index] if index < len(rec_scores) else 0.0
                poly = rec_polys[index] if index < len(rec_polys) else []
                xs = [float(point[0]) for point in poly] if poly else [0.0]
                ys = [float(point[1]) for point in poly] if poly else [0.0]
                texts.append(text)
                regions.append({
                    "text": text,
                    "x": min(xs),
                    "y": min(ys),
                    "width": max(xs) - min(xs),
                    "height": max(ys) - min(ys),
                    "confidence": float(score),
                })

        payload = {
            "ok": True,
            "text": "\n".join(texts),
            "regions": regions,
        }
    except Exception as exc:
        payload = {
            "ok": False,
            "error": str(exc),
        }

    print(RESULT_PREFIX + json.dumps(payload, ensure_ascii=False), flush=True)
"#;
