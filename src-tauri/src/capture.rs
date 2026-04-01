use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

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
    pub path: String,
    pub width: u32,
    pub height: u32,
}

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
    std::env::temp_dir().join("screenshot-tool-captures")
}

/// Save BGRA pixel data as a PNG file in the temp directory. Returns the file path.
fn save_capture_as_png(data: &[u8], width: u32, height: u32) -> Result<String, String> {
    use image::{ImageBuffer, Rgba};

    let temp_dir = screenshot_temp_dir();
    std::fs::create_dir_all(&temp_dir).map_err(|e| format!("Failed to create temp dir: {}", e))?;

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let path = temp_dir.join(format!("capture-{}.png", timestamp));

    // Convert BGRA to RGBA in-place during ImageBuffer construction
    let img: ImageBuffer<Rgba<u8>, Vec<u8>> = ImageBuffer::from_fn(width, height, |x, y| {
        let i = ((y * width + x) * 4) as usize;
        Rgba([data[i + 2], data[i + 1], data[i], data[i + 3]]) // BGRA → RGBA
    });

    img.save(&path).map_err(|e| format!("Failed to save PNG: {}", e))?;

    Ok(path.to_string_lossy().to_string())
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
        let path = save_capture_as_png(&bgra_data, width as u32, height as u32)?;

        Ok(CaptureResult {
            path,
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
        let path = save_capture_as_png(&bgra_data, width as u32, height as u32)?;

        Ok(CaptureResult {
            path,
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
        let path = save_capture_as_png(&bgra_data, width as u32, height as u32)?;

        Ok(CaptureResult {
            path,
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
pub fn cleanup_temp_file(path: String) -> Result<(), String> {
    let path = std::path::Path::new(&path);
    // Only allow deleting files in our temp directory
    let temp_dir = screenshot_temp_dir();
    if path.starts_with(&temp_dir) {
        std::fs::remove_file(path).map_err(|e| format!("Failed to delete temp file: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
pub fn save_pin_image(data: Vec<u8>) -> Result<String, String> {
    let temp_dir = screenshot_temp_dir();
    std::fs::create_dir_all(&temp_dir).map_err(|e| format!("Failed to create temp dir: {}", e))?;

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let path = temp_dir.join(format!("pin-{}.png", timestamp));

    std::fs::write(&path, &data).map_err(|e| format!("Failed to save pin image: {}", e))?;

    Ok(path.to_string_lossy().to_string())
}
