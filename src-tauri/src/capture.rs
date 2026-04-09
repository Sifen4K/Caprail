use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::RwLock;
use tauri::ipc::Response;
use tracing::info;

/// Per-window original window procedures, stored for call-forwarding.
/// Key is the HWND as isize, value is the original WNDPROC.
#[cfg(windows)]
static ORIG_WNDPROCS: once_cell::sync::Lazy<std::sync::Mutex<HashMap<isize, isize>>> =
    once_cell::sync::Lazy::new(|| std::sync::Mutex::new(HashMap::new()));

/// Replacement window procedure: returns HTCLIENT for WM_NCHITTEST and blocks SC_MOVE.
#[cfg(windows)]
unsafe extern "system" fn overlay_wndproc(
    hwnd: windows::Win32::Foundation::HWND,
    msg: u32,
    wparam: windows::Win32::Foundation::WPARAM,
    lparam: windows::Win32::Foundation::LPARAM,
) -> windows::Win32::Foundation::LRESULT {
    use windows::Win32::Foundation::LRESULT;
    use windows::Win32::UI::WindowsAndMessaging::*;

    if msg == WM_NCHITTEST {
        return LRESULT(1); // HTCLIENT
    }
    if msg == WM_SYSCOMMAND && (wparam.0 & 0xFFF0) == SC_MOVE as usize {
        return LRESULT(0);
    }

    // Look up the original WndProc for this specific window
    let orig = ORIG_WNDPROCS
        .lock()
        .ok()
        .and_then(|map| map.get(&(hwnd.0 as isize)).copied())
        .unwrap_or(0);

    if orig != 0 {
        let proc: WNDPROC = std::mem::transmute(orig);
        CallWindowProcW(proc, hwnd, msg, wparam, lparam)
    } else {
        DefWindowProcW(hwnd, msg, wparam, lparam)
    }
}

/// Subclass a window to prevent dragging/resizing and remove the thick frame border.
#[tauri::command]
pub fn lock_window_position(app: tauri::AppHandle, label: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        use tauri::Manager;
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::WindowsAndMessaging::*;

        let window = app
            .get_webview_window(&label)
            .ok_or_else(|| format!("Window '{}' not found", label))?;

        let raw = window.hwnd().map_err(|e| e.to_string())?;
        let hwnd = HWND(raw.0);

        unsafe {
            // Subclass the window procedure to block drag/resize
            let old = SetWindowLongPtrW(hwnd, GWLP_WNDPROC, overlay_wndproc as *const () as isize);
            if let Ok(mut map) = ORIG_WNDPROCS.lock() {
                map.insert(hwnd.0 as isize, old);
            }

            // Shift the window so the client area starts at the original window position.
            // The non-client frame (WS_CAPTION border) pushes the client area inward;
            // compensate by moving the window by the frame offset so the border
            // falls off-screen and the client area covers the full screen.
            let mut wr = windows::Win32::Foundation::RECT::default();
            let _ = GetWindowRect(hwnd, &mut wr);
            let mut client_origin = windows::Win32::Foundation::POINT { x: 0, y: 0 };
            let _ = windows::Win32::Graphics::Gdi::ClientToScreen(hwnd, &mut client_origin);

            let frame_left = client_origin.x - wr.left;
            let frame_top = client_origin.y - wr.top;
            if frame_left > 0 || frame_top > 0 {
                let _ = SetWindowPos(
                    hwnd,
                    None,
                    wr.left - frame_left,
                    wr.top - frame_top,
                    0, 0,
                    SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE,
                );
            }
        }

        info!("lock_window_position: locked {:?}", hwnd.0);
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowInfo {
    pub title: String,
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
    pub hwnd: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CaptureResult {
    pub id: u32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VirtualScreenInfo {
    pub id: u32,
    pub origin_x: i32,
    pub origin_y: i32,
    pub width: u32,
    pub height: u32,
}

pub struct CapturedScreenshot {
    pub data: Vec<u8>, // BGRA with alpha fixed to 0xFF
    pub width: u32,
    pub height: u32,
}

static NEXT_SCREENSHOT_ID: AtomicU32 = AtomicU32::new(1);
static NEXT_PIN_ID: AtomicU32 = AtomicU32::new(1);

pub static SCREENSHOT_STORE: once_cell::sync::Lazy<RwLock<HashMap<u32, CapturedScreenshot>>> =
    once_cell::sync::Lazy::new(|| RwLock::new(HashMap::new()));

pub static PIN_STORE: once_cell::sync::Lazy<RwLock<HashMap<u32, Vec<u8>>>> =
    once_cell::sync::Lazy::new(|| RwLock::new(HashMap::new()));

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonitorInfo {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
    pub scale_factor: f64,
    pub is_primary: bool,
}

/// Get the temp directory for screenshot files.
pub fn screenshot_temp_dir() -> std::path::PathBuf {
    std::env::temp_dir().join("caprail-captures")
}

/// Fix alpha channel in BGRA data. GDI BitBlt leaves alpha as 0x00.
fn fix_alpha(data: &mut [u8]) {
    for pixel in data.chunks_exact_mut(4) {
        pixel[3] = 0xFF;
    }
}

/// Fix alpha, store in memory, return an ID for retrieval.
fn store_screenshot(mut data: Vec<u8>, width: u32, height: u32) -> u32 {
    fix_alpha(&mut data);
    let id = NEXT_SCREENSHOT_ID.fetch_add(1, Ordering::Relaxed);
    let mut store = SCREENSHOT_STORE.write().unwrap();
    store.insert(id, CapturedScreenshot { data, width, height });
    id
}

/// Read screenshot as RGBA binary data for the frontend.
#[tauri::command]
pub fn read_screenshot(id: u32) -> Result<Response, String> {
    let store = SCREENSHOT_STORE.read().unwrap();
    let screenshot = store
        .get(&id)
        .ok_or_else(|| format!("No screenshot with id {}", id))?;

    // BGRA → RGBA
    let mut rgba = screenshot.data.clone();
    for pixel in rgba.chunks_exact_mut(4) {
        pixel.swap(0, 2);
    }

    Ok(Response::new(rgba))
}

/// Free screenshot memory.
#[tauri::command]
pub fn cleanup_screenshot(id: u32) {
    let mut store = SCREENSHOT_STORE.write().unwrap();
    store.remove(&id);
}

#[tauri::command]
pub fn get_monitors() -> Result<Vec<MonitorInfo>, String> {
    #[cfg(windows)]
    {
        use windows::Win32::Foundation::{LPARAM, RECT};
        use windows::Win32::Graphics::Gdi::{
            EnumDisplayMonitors, GetMonitorInfoW, HDC, HMONITOR, MONITORINFOEXW,
        };
        use windows::Win32::UI::HiDpi::GetDpiForMonitor;
        use windows::Win32::UI::HiDpi::MDT_EFFECTIVE_DPI;
        use windows::core::BOOL;

        struct MonitorData {
            monitors: Vec<MonitorInfo>,
        }

        let mut data = MonitorData {
            monitors: Vec::new(),
        };

        unsafe extern "system" fn callback(
            hmon: HMONITOR,
            _hdc: HDC,
            _rect: *mut RECT,
            lparam: LPARAM,
        ) -> BOOL {
            let data = &mut *(lparam.0 as *mut MonitorData);
            let mut info = MONITORINFOEXW::default();
            info.monitorInfo.cbSize = std::mem::size_of::<MONITORINFOEXW>() as u32;
            let _ = GetMonitorInfoW(hmon, &mut info as *mut _ as *mut _);

            let mut dpi_x = 96u32;
            let mut dpi_y = 96u32;
            let _ = GetDpiForMonitor(hmon, MDT_EFFECTIVE_DPI, &mut dpi_x, &mut dpi_y);

            let rect = info.monitorInfo.rcMonitor;
            data.monitors.push(MonitorInfo {
                x: rect.left,
                y: rect.top,
                width: rect.right - rect.left,
                height: rect.bottom - rect.top,
                scale_factor: dpi_x as f64 / 96.0,
                is_primary: (info.monitorInfo.dwFlags & 1) != 0,
            });
            BOOL(1)
        }

        unsafe {
            let _ = EnumDisplayMonitors(
                None,
                None,
                Some(callback),
                LPARAM(&mut data as *mut _ as isize),
            );
        }

        Ok(data.monitors)
    }

    #[cfg(not(windows))]
    {
        Ok(vec![])
    }
}

#[tauri::command]
pub fn capture_virtual_screen() -> Result<VirtualScreenInfo, String> {
    #[cfg(windows)]
    {
        use windows::Win32::UI::WindowsAndMessaging::{
            GetSystemMetrics, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN,
            SM_YVIRTUALSCREEN,
        };

        let (x, y, width, height) = unsafe {
            (
                GetSystemMetrics(SM_XVIRTUALSCREEN),
                GetSystemMetrics(SM_YVIRTUALSCREEN),
                GetSystemMetrics(SM_CXVIRTUALSCREEN),
                GetSystemMetrics(SM_CYVIRTUALSCREEN),
            )
        };

        if width <= 0 || height <= 0 {
            return Err("Failed to get virtual screen dimensions".to_string());
        }

        let bgra_data = gdi_capture(x, y, width, height)?;
        let id = store_screenshot(bgra_data, width as u32, height as u32);

        Ok(VirtualScreenInfo {
            id,
            origin_x: x,
            origin_y: y,
            width: width as u32,
            height: height as u32,
        })
    }

    #[cfg(not(windows))]
    {
        Err("Not supported on this platform".to_string())
    }
}

#[tauri::command]
pub fn crop_precapture(
    precapture_id: u32,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    origin_x: i32,
    origin_y: i32,
) -> Result<CaptureResult, String> {
    if width <= 0 || height <= 0 {
        return Err("Invalid crop dimensions".to_string());
    }

    let store = SCREENSHOT_STORE.read().unwrap();
    let precapture = store
        .get(&precapture_id)
        .ok_or_else(|| format!("No precapture with id {}", precapture_id))?;

    let src_w = precapture.width as i32;
    let src_h = precapture.height as i32;

    // Convert screen coordinates to buffer-relative
    let buf_x = (x - origin_x).max(0);
    let buf_y = (y - origin_y).max(0);

    // Clamp to buffer bounds
    let crop_w = width.min(src_w - buf_x).max(0);
    let crop_h = height.min(src_h - buf_y).max(0);

    if crop_w <= 0 || crop_h <= 0 {
        return Err("Crop region is outside the precapture bounds".to_string());
    }

    let src_stride = (src_w * 4) as usize;
    let dst_stride = (crop_w * 4) as usize;
    let mut cropped = vec![0u8; (crop_w * crop_h * 4) as usize];

    for row in 0..crop_h {
        let src_offset = ((buf_y + row) as usize) * src_stride + (buf_x as usize) * 4;
        let dst_offset = (row as usize) * dst_stride;
        cropped[dst_offset..dst_offset + dst_stride]
            .copy_from_slice(&precapture.data[src_offset..src_offset + dst_stride]);
    }

    // Data already has alpha fixed from store_screenshot, insert directly
    let id = NEXT_SCREENSHOT_ID.fetch_add(1, Ordering::Relaxed);
    drop(store);

    let mut store = SCREENSHOT_STORE.write().unwrap();
    store.insert(
        id,
        CapturedScreenshot {
            data: cropped,
            width: crop_w as u32,
            height: crop_h as u32,
        },
    );

    Ok(CaptureResult {
        id,
        width: crop_w as u32,
        height: crop_h as u32,
    })
}

#[tauri::command]
pub fn get_windows() -> Result<Vec<WindowInfo>, String> {
    #[cfg(windows)]
    {
        use windows::Win32::Foundation::{HWND, LPARAM};
        use windows::Win32::UI::WindowsAndMessaging::{
            EnumWindows, GetWindowRect, GetWindowTextW, IsWindowVisible,
        };
        use windows::core::BOOL;

        let mut windows_list: Vec<WindowInfo> = Vec::new();

        unsafe extern "system" fn enum_callback(hwnd: HWND, lparam: LPARAM) -> BOOL {
            let windows_vec = &mut *(lparam.0 as *mut Vec<WindowInfo>);

            if !IsWindowVisible(hwnd).as_bool() {
                return BOOL(1);
            }

            let mut title = [0u16; 256];
            let len = GetWindowTextW(hwnd, &mut title);
            if len == 0 {
                return BOOL(1);
            }

            let title_str = String::from_utf16_lossy(&title[..len as usize]);
            if title_str.is_empty() || title_str == "Program Manager" {
                return BOOL(1);
            }

            let mut rect = windows::Win32::Foundation::RECT::default();
            let _ = GetWindowRect(hwnd, &mut rect);

            windows_vec.push(WindowInfo {
                title: title_str,
                x: rect.left,
                y: rect.top,
                width: rect.right - rect.left,
                height: rect.bottom - rect.top,
                hwnd: hwnd.0 as usize,
            });

            BOOL(1)
        }

        unsafe {
            let _ = EnumWindows(
                Some(enum_callback),
                LPARAM(&mut windows_list as *mut _ as isize),
            );
        }

        Ok(windows_list)
    }

    #[cfg(not(windows))]
    {
        Ok(vec![])
    }
}

/// Common GDI BitBlt capture helper. Returns raw BGRA pixel data.
#[cfg(windows)]
fn gdi_capture(x: i32, y: i32, width: i32, height: i32) -> Result<Vec<u8>, String> {
    use windows::Win32::Graphics::Gdi::{
        BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject,
        GetDIBits, GetDC, ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER,
        BI_RGB, DIB_RGB_COLORS, SRCCOPY,
    };

    if width <= 0 || height <= 0 {
        return Err("Invalid capture dimensions".to_string());
    }

    unsafe {
        let hdc_screen = GetDC(None);
        let hdc_mem = CreateCompatibleDC(Some(hdc_screen));
        let hbm = CreateCompatibleBitmap(hdc_screen, width, height);
        let old = SelectObject(hdc_mem, hbm.into());

        let _ = BitBlt(hdc_mem, 0, 0, width, height, Some(hdc_screen), x, y, SRCCOPY);

        let mut bmi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: width,
                biHeight: -height, // top-down
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0 as u32,
                ..Default::default()
            },
            ..Default::default()
        };

        let mut data = vec![0u8; (width * height * 4) as usize];
        GetDIBits(
            hdc_mem,
            hbm,
            0,
            height as u32,
            Some(data.as_mut_ptr() as *mut _),
            &mut bmi,
            DIB_RGB_COLORS,
        );

        SelectObject(hdc_mem, old);
        let _ = DeleteObject(hbm.into());
        let _ = DeleteDC(hdc_mem);
        ReleaseDC(None, hdc_screen);

        Ok(data)
    }
}

#[tauri::command]
pub fn capture_screen(monitor_index: usize) -> Result<CaptureResult, String> {
    #[cfg(windows)]
    {
        use windows::Win32::Foundation::{LPARAM, RECT};
        use windows::Win32::Graphics::Gdi::{
            EnumDisplayMonitors, GetMonitorInfoW, HDC, HMONITOR, MONITORINFOEXW,
        };
        use windows::core::BOOL;

        let mut monitor_handles: Vec<HMONITOR> = Vec::new();

        unsafe extern "system" fn monitor_callback(
            hmon: HMONITOR,
            _hdc: HDC,
            _rect: *mut RECT,
            lparam: LPARAM,
        ) -> BOOL {
            let handles = &mut *(lparam.0 as *mut Vec<HMONITOR>);
            handles.push(hmon);
            BOOL(1)
        }

        unsafe {
            let _ = EnumDisplayMonitors(
                None,
                None,
                Some(monitor_callback),
                LPARAM(&mut monitor_handles as *mut _ as isize),
            );
        }

        if monitor_index >= monitor_handles.len() {
            return Err("Invalid monitor index".to_string());
        }

        let hmon = monitor_handles[monitor_index];
        let mut info = MONITORINFOEXW::default();
        info.monitorInfo.cbSize = std::mem::size_of::<MONITORINFOEXW>() as u32;
        unsafe {
            let _ = GetMonitorInfoW(hmon, &mut info as *mut _ as *mut _);
        }

        let x = info.monitorInfo.rcMonitor.left;
        let y = info.monitorInfo.rcMonitor.top;
        let width = info.monitorInfo.rcMonitor.right - x;
        let height = info.monitorInfo.rcMonitor.bottom - y;

        let bgra_data = gdi_capture(x, y, width, height)?;
        let id = store_screenshot(bgra_data, width as u32, height as u32);

        Ok(CaptureResult {
            id,
            width: width as u32,
            height: height as u32,
        })
    }

    #[cfg(not(windows))]
    {
        Err("Not supported on this platform".to_string())
    }
}

#[tauri::command]
pub fn capture_region(x: i32, y: i32, width: i32, height: i32) -> Result<CaptureResult, String> {
    #[cfg(windows)]
    {
        let bgra_data = gdi_capture(x, y, width, height)?;
        let id = store_screenshot(bgra_data, width as u32, height as u32);

        Ok(CaptureResult {
            id,
            width: width as u32,
            height: height as u32,
        })
    }

    #[cfg(not(windows))]
    {
        Err("Not supported on this platform".to_string())
    }
}

#[tauri::command]
pub fn capture_window(hwnd: usize) -> Result<CaptureResult, String> {
    #[cfg(windows)]
    {
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::WindowsAndMessaging::GetWindowRect;

        let hwnd_handle = HWND(hwnd as *mut _);
        let mut rect = windows::Win32::Foundation::RECT::default();
        unsafe {
            let _ = GetWindowRect(hwnd_handle, &mut rect);
        }

        let x = rect.left;
        let y = rect.top;
        let width = rect.right - x;
        let height = rect.bottom - y;

        let bgra_data = gdi_capture(x, y, width, height)?;
        let id = store_screenshot(bgra_data, width as u32, height as u32);

        Ok(CaptureResult {
            id,
            width: width as u32,
            height: height as u32,
        })
    }

    #[cfg(not(windows))]
    {
        Err("Not supported on this platform".to_string())
    }
}

/// Exclude a window from screen capture (GDI BitBlt, etc.) using
/// SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE).
/// Available on Windows 10 version 2004 and later.
///
/// This version includes robust handling for transparent/layered windows:
/// 1. If the window has WS_EX_LAYERED, temporarily remove it before setting affinity
/// 2. Verify with GetWindowDisplayAffinity that the setting actually took effect
/// 3. Retry up to 5 times with increasing delays if verification fails
#[tauri::command]
pub fn set_window_exclude_from_capture(app: tauri::AppHandle, label: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        use tauri::Manager;
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::WindowsAndMessaging::{
            GetWindowDisplayAffinity, GetWindowLongW, SetWindowDisplayAffinity, SetWindowLongW,
            GWL_EXSTYLE, WINDOW_DISPLAY_AFFINITY, WS_EX_LAYERED,
        };

        let window = app
            .get_webview_window(&label)
            .ok_or_else(|| format!("Window '{}' not found", label))?;

        let raw = window.hwnd().map_err(|e| e.to_string())?;
        let hwnd = HWND(raw.0);

        // WDA_EXCLUDEFROMCAPTURE = 0x00000011
        let wda_exclude = WINDOW_DISPLAY_AFFINITY(0x00000011);

        unsafe {
            // Check if window has WS_EX_LAYERED style
            let ex_style = GetWindowLongW(hwnd, GWL_EXSTYLE);
            let is_layered = (ex_style & WS_EX_LAYERED.0 as i32) != 0;

            if is_layered {
                info!(
                    "set_window_exclude_from_capture: '{}' has WS_EX_LAYERED, temporarily removing",
                    label
                );
                // Remove WS_EX_LAYERED before setting display affinity
                SetWindowLongW(hwnd, GWL_EXSTYLE, ex_style & !(WS_EX_LAYERED.0 as i32));
            }

            // Retry loop: attempt to set and verify display affinity
            let max_retries = 5;
            let mut success = false;
            for attempt in 0..max_retries {
                if attempt > 0 {
                    std::thread::sleep(std::time::Duration::from_millis(50 * attempt as u64));
                }

                match SetWindowDisplayAffinity(hwnd, wda_exclude) {
                    Ok(_) => {
                        // Verify the setting took effect
                        let mut current_affinity: u32 = 0;
                        if GetWindowDisplayAffinity(hwnd, &mut current_affinity).is_ok() {
                            if current_affinity == wda_exclude.0 {
                                info!(
                                    "set_window_exclude_from_capture: verified '{}' (attempt {})",
                                    label,
                                    attempt + 1
                                );
                                success = true;
                                break;
                            } else {
                                info!(
                                    "set_window_exclude_from_capture: affinity mismatch for '{}' \
                                     (got 0x{:x}, want 0x{:x}), retrying...",
                                    label, current_affinity, wda_exclude.0
                                );
                            }
                        } else {
                            info!(
                                "set_window_exclude_from_capture: GetWindowDisplayAffinity failed \
                                 for '{}', assuming set succeeded",
                                label
                            );
                            success = true;
                            break;
                        }
                    }
                    Err(e) => {
                        info!(
                            "set_window_exclude_from_capture: attempt {} failed for '{}': {}",
                            attempt + 1,
                            label,
                            e
                        );
                    }
                }
            }

            // Restore WS_EX_LAYERED if we removed it
            if is_layered {
                // Re-read the current extended style (may have been modified)
                let current_ex_style = GetWindowLongW(hwnd, GWL_EXSTYLE);
                SetWindowLongW(
                    hwnd,
                    GWL_EXSTYLE,
                    current_ex_style | WS_EX_LAYERED.0 as i32,
                );
                info!(
                    "set_window_exclude_from_capture: restored WS_EX_LAYERED for '{}'",
                    label
                );
            }

            if !success {
                return Err(format!(
                    "Failed to set WDA_EXCLUDEFROMCAPTURE for '{}' after {} retries",
                    label, max_retries
                ));
            }
        }

        info!(
            "set_window_exclude_from_capture: excluded '{}' ({:?})",
            label, hwnd.0
        );
    }

    #[cfg(not(windows))]
    {
        let _ = (app, label);
    }

    Ok(())
}

#[tauri::command]
pub fn save_pin_image(data: Vec<u8>) -> Result<u32, String> {
    let id = NEXT_PIN_ID.fetch_add(1, Ordering::Relaxed);
    let mut store = PIN_STORE.write().unwrap();
    store.insert(id, data);
    Ok(id)
}

#[tauri::command]
pub fn read_pin_image(id: u32) -> Result<Response, String> {
    let store = PIN_STORE.read().unwrap();
    let data = store
        .get(&id)
        .ok_or_else(|| format!("No pin image with id {}", id))?;
    Ok(Response::new(data.clone()))
}

#[tauri::command]
pub fn cleanup_pin_image(id: u32) -> Result<(), String> {
    let mut store = PIN_STORE.write().unwrap();
    store.remove(&id);
    Ok(())
}
