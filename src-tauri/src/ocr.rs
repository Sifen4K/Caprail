use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::{
    io::{BufRead, BufReader, Write},
    process::{Child, ChildStdin, ChildStdout, Command, Stdio},
    sync::Mutex,
};

use crate::{capture::SCREENSHOT_STORE, config::load_config_sync};

static OCR_WORKER: Lazy<Mutex<Option<PaddleSidecar>>> = Lazy::new(|| Mutex::new(None));
const OCR_READY_PREFIX: &str = "__CAPRAIL_OCR_READY__";
const OCR_RESULT_PREFIX: &str = "__CAPRAIL_OCR_RESULT__";
const OCR_ENGINE_WINDOWS: &str = "windows";
const OCR_ENGINE_PADDLE: &str = "paddle";
const OCR_ENGINE_TESSERACT: &str = "tesseract";
const PADDLE_SIDECAR_ARG: &str = "--paddle-sidecar";

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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupDiagnostics {
    pub arch: String,
    pub selected_ocr_engine: String,
    pub ocr_available: bool,
    pub ffmpeg_available: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrEngineAvailability {
    pub id: String,
    pub available: bool,
}

/// Performs OCR on an image.
/// Expects RGBA pixel data. Uses the OCR engine chosen in settings.
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

#[tauri::command]
pub async fn startup_diagnostics() -> Result<StartupDiagnostics, String> {
    tauri::async_runtime::spawn_blocking(run_startup_diagnostics)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn list_ocr_engines() -> Result<Vec<OcrEngineAvailability>, String> {
    tauri::async_runtime::spawn_blocking(available_ocr_engines)
        .await
        .map_err(|e| e.to_string())
}

fn run_startup_diagnostics() -> Result<StartupDiagnostics, String> {
    let config = load_config_sync();
    let selected_ocr_engine = normalize_ocr_engine(&config.ocr_engine).to_string();
    let ocr_available = selected_ocr_engine_available(&selected_ocr_engine);
    let ffmpeg_available = command_available("ffmpeg", &["-version"]);

    Ok(StartupDiagnostics {
        arch: current_arch_label(),
        selected_ocr_engine,
        ocr_available,
        ffmpeg_available,
    })
}

fn ocr_recognize_rgba(
    image_data: Vec<u8>,
    width: u32,
    height: u32,
) -> Result<OcrResult, String> {
    let config = load_config_sync();
    let selected_engine = normalize_ocr_engine(&config.ocr_engine);

    match selected_engine {
        OCR_ENGINE_WINDOWS => run_windows_ocr(&image_data, width, height),
        OCR_ENGINE_PADDLE => run_file_based_ocr(image_data, width, height, run_paddleocr),
        OCR_ENGINE_TESSERACT => run_file_based_ocr(image_data, width, height, run_tesseract),
        _ => run_windows_ocr(&image_data, width, height),
    }
}

fn run_file_based_ocr(
    image_data: Vec<u8>,
    width: u32,
    height: u32,
    runner: fn(&std::path::Path) -> Result<OcrResult, String>,
) -> Result<OcrResult, String> {
    let temp_dir = std::env::temp_dir().join("caprail-ocr");
    std::fs::create_dir_all(&temp_dir).map_err(|e| e.to_string())?;
    let temp_path = temp_dir.join(format!(
        "ocr_input_{}.png",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_nanos()
    ));

    let img = image::RgbaImage::from_raw(width, height, image_data).ok_or("Invalid image data")?;
    img.save(&temp_path).map_err(|e| e.to_string())?;

    let result = runner(&temp_path);
    let _ = std::fs::remove_file(&temp_path);
    result
}

fn run_paddleocr(image_path: &std::path::Path) -> Result<OcrResult, String> {
    let image_path_str = image_path
        .to_str()
        .ok_or_else(|| "Invalid OCR image path".to_string())?;
    let mut errors = Vec::new();

    for _ in 0..2 {
        match recognize_with_worker(image_path_str) {
            Ok(result) => return Ok(result),
            Err(err) => errors.push(err),
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

fn recognize_with_worker(image_path: &str) -> Result<OcrResult, String> {
    let mut worker = OCR_WORKER.lock().unwrap();
    if worker.is_none() {
        *worker = Some(PaddleSidecar::spawn()?);
    }

    if let Some(instance) = worker.as_mut() {
        match instance.recognize(image_path) {
            Ok(result) => Ok(result),
            Err(err) => {
                *worker = None;
                Err(err)
            }
        }
    } else {
        Err("OCR worker unavailable".to_string())
    }
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

fn hidden_command(program: impl AsRef<std::ffi::OsStr>) -> Command {
    let mut command = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

fn command_available(program: &str, args: &[&str]) -> bool {
    hidden_command(program)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .args(args)
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn current_arch_label() -> String {
    match std::env::consts::ARCH {
        "x86_64" => "x64".to_string(),
        "x86" => "x86".to_string(),
        "aarch64" => "arm64".to_string(),
        other => other.to_string(),
    }
}

fn normalize_ocr_engine(engine: &str) -> &str {
    match engine.trim().to_ascii_lowercase().as_str() {
        OCR_ENGINE_PADDLE => OCR_ENGINE_PADDLE,
        OCR_ENGINE_TESSERACT => OCR_ENGINE_TESSERACT,
        _ => OCR_ENGINE_WINDOWS,
    }
}

fn available_ocr_engines() -> Vec<OcrEngineAvailability> {
    vec![
        OcrEngineAvailability {
            id: OCR_ENGINE_WINDOWS.to_string(),
            available: windows_ocr_available(),
        },
        OcrEngineAvailability {
            id: OCR_ENGINE_PADDLE.to_string(),
            available: paddle_ocr_available(),
        },
        OcrEngineAvailability {
            id: OCR_ENGINE_TESSERACT.to_string(),
            available: tesseract_available(),
        },
    ]
}

fn selected_ocr_engine_available(engine: &str) -> bool {
    match normalize_ocr_engine(engine) {
        OCR_ENGINE_PADDLE => ensure_ocr_worker().is_ok(),
        OCR_ENGINE_TESSERACT => tesseract_available(),
        _ => windows_ocr_available(),
    }
}

fn windows_ocr_available() -> bool {
    #[cfg(windows)]
    {
        return create_windows_ocr_engine().is_ok();
    }

    #[allow(unreachable_code)]
    false
}

fn paddle_ocr_available() -> bool {
    command_available("paddleocr", &["--help"])
        || python_module_available("python", &["-c", PADDLEOCR_MODULE_CHECK_SCRIPT])
        || python_module_available("py", &["-3", "-c", PADDLEOCR_MODULE_CHECK_SCRIPT])
        || python_module_available("py", &["-c", PADDLEOCR_MODULE_CHECK_SCRIPT])
}

fn ensure_ocr_worker() -> Result<(), String> {
    let mut worker = OCR_WORKER.lock().unwrap();
    if worker.is_none() {
        *worker = Some(PaddleSidecar::spawn()?);
    }
    Ok(())
}

fn tesseract_available() -> bool {
    command_available("tesseract", &["--version"])
}

fn run_windows_ocr(image_data: &[u8], width: u32, height: u32) -> Result<OcrResult, String> {
    #[cfg(windows)]
    {
        use windows::Graphics::Imaging::{BitmapPixelFormat, SoftwareBitmap};
        use windows::Storage::Streams::DataWriter;

        let engine = create_windows_ocr_engine()?;

        let writer = DataWriter::new().map_err(|e| format!("Windows OCR writer failed: {e}"))?;
        writer
            .WriteBytes(image_data)
            .map_err(|e| format!("Windows OCR buffer write failed: {e}"))?;
        let buffer = writer
            .DetachBuffer()
            .map_err(|e| format!("Windows OCR buffer detach failed: {e}"))?;

        let bitmap = SoftwareBitmap::CreateCopyFromBuffer(
            &buffer,
            BitmapPixelFormat::Rgba8,
            width as i32,
            height as i32,
        )
        .map_err(|e| format!("Windows OCR bitmap conversion failed: {e}"))?;

        let result = engine
            .RecognizeAsync(&bitmap)
            .map_err(|e| format!("Windows OCR recognize failed: {e}"))?
            .get()
            .map_err(|e| format!("Windows OCR await failed: {e}"))?;

        return Ok(OcrResult {
            text: result
                .Text()
                .map_err(|e| format!("Windows OCR text extraction failed: {e}"))?
                .to_string(),
            regions: vec![],
        });
    }

    #[allow(unreachable_code)]
    Err("Windows OCR is only available on Windows".to_string())
}

#[cfg(windows)]
fn create_windows_ocr_engine() -> Result<windows::Media::Ocr::OcrEngine, String> {
    use windows::Globalization::Language;
    use windows::Media::Ocr::OcrEngine;

    for tag in [
        "zh-Hans",
        "zh-CN",
        "zh-SG",
        "zh-Hant",
        "zh-TW",
        "zh-HK",
    ] {
        let language = Language::CreateLanguage(&tag.into())
            .map_err(|e| format!("Windows OCR language creation failed for {tag}: {e}"))?;

        if OcrEngine::IsLanguageSupported(&language).unwrap_or(false) {
            return OcrEngine::TryCreateFromLanguage(&language)
                .map_err(|e| format!("Windows OCR failed to create {tag} engine: {e}"));
        }
    }

    OcrEngine::TryCreateFromUserProfileLanguages()
        .map_err(|e| format!("Windows OCR unavailable: {e}"))
}

fn python_module_available(program: &str, args: &[&str]) -> bool {
    hidden_command(program)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .args(args)
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

#[derive(Serialize, Deserialize)]
struct WorkerRequest<'a> {
    image_path: &'a str,
}

#[derive(Serialize, Deserialize)]
struct WorkerResponse {
    ok: bool,
    text: Option<String>,
    regions: Option<Vec<OcrRegion>>,
    error: Option<String>,
}

pub fn maybe_run_paddle_sidecar_from_args() -> bool {
    if std::env::args().any(|arg| arg == PADDLE_SIDECAR_ARG) {
        if let Err(error) = run_paddle_sidecar() {
            eprintln!("Paddle sidecar failed: {error}");
            std::process::exit(1);
        }
        return true;
    }

    false
}

fn run_paddle_sidecar() -> Result<(), String> {
    let mut worker = PythonPaddleWorker::spawn()?;
    println!("{OCR_READY_PREFIX}");

    let stdin = std::io::stdin();
    let mut stdin = stdin.lock();
    let mut line = String::new();

    loop {
        line.clear();
        let bytes = stdin
            .read_line(&mut line)
            .map_err(|e| format!("Failed to read sidecar request: {e}"))?;
        if bytes == 0 {
            return Ok(());
        }

        let raw = line.trim();
        if raw.is_empty() {
            continue;
        }

        let payload = match serde_json::from_str::<WorkerRequest<'_>>(raw) {
            Ok(request) => match worker.recognize(request.image_path) {
                Ok(result) => WorkerResponse {
                    ok: true,
                    text: Some(result.text),
                    regions: Some(result.regions),
                    error: None,
                },
                Err(error) => WorkerResponse {
                    ok: false,
                    text: None,
                    regions: None,
                    error: Some(error),
                },
            },
            Err(error) => WorkerResponse {
                ok: false,
                text: None,
                regions: None,
                error: Some(format!("Invalid sidecar request: {error}")),
            },
        };

        let response = serde_json::to_string(&payload)
            .map_err(|e| format!("Failed to serialize sidecar response: {e}"))?;
        println!("{OCR_RESULT_PREFIX}{response}");
    }
}

struct PaddleSidecar {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

impl PaddleSidecar {
    fn spawn() -> Result<Self, String> {
        let current_exe = std::env::current_exe()
            .map_err(|e| format!("Failed to resolve sidecar path: {e}"))?;
        let mut child = hidden_command(current_exe)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .arg(PADDLE_SIDECAR_ARG)
            .spawn()
            .map_err(|e| format!("Failed to spawn Paddle sidecar: {e}"))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Paddle sidecar stdin unavailable".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Paddle sidecar stdout unavailable".to_string())?;
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
                .map_err(|e| format!("Failed to read Paddle sidecar startup: {e}"))?;
            if bytes == 0 {
                let status = self
                    .child
                    .try_wait()
                    .ok()
                    .flatten()
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| "unknown status".to_string());
                return Err(format!("Paddle sidecar exited during startup: {status}"));
            }

            if line.trim() == OCR_READY_PREFIX {
                return Ok(());
            }
        }
    }

    fn recognize(&mut self, image_path: &str) -> Result<OcrResult, String> {
        let request = serde_json::to_string(&WorkerRequest { image_path })
            .map_err(|e| format!("Failed to serialize Paddle sidecar request: {e}"))?;
        writeln!(self.stdin, "{request}")
            .and_then(|_| self.stdin.flush())
            .map_err(|e| format!("Failed to send Paddle sidecar request: {e}"))?;

        let mut line = String::new();
        loop {
            line.clear();
            let bytes = self
                .stdout
                .read_line(&mut line)
                .map_err(|e| format!("Failed to read Paddle sidecar response: {e}"))?;
            if bytes == 0 {
                let status = self
                    .child
                    .try_wait()
                    .ok()
                    .flatten()
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| "unknown status".to_string());
                return Err(format!("Paddle sidecar exited while recognizing: {status}"));
            }

            if let Some(payload) = line.trim().strip_prefix(OCR_RESULT_PREFIX) {
                let response: WorkerResponse = serde_json::from_str(payload)
                    .map_err(|e| format!("Invalid Paddle sidecar response: {e}"))?;
                if response.ok {
                    return Ok(OcrResult {
                        text: response.text.unwrap_or_default(),
                        regions: response.regions.unwrap_or_default(),
                    });
                }
                return Err(response
                    .error
                    .unwrap_or_else(|| "Paddle sidecar failed".to_string()));
            }
        }
    }
}

impl Drop for PaddleSidecar {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

struct PythonPaddleWorker {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

impl PythonPaddleWorker {
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

impl Drop for PythonPaddleWorker {
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

const PADDLEOCR_MODULE_CHECK_SCRIPT: &str =
    "import importlib.util, sys; sys.exit(0 if importlib.util.find_spec('paddleocr') else 1)";
