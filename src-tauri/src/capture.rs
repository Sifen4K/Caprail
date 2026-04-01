use serde::{Deserialize, Serialize};

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
    pub width: u32,
    pub height: u32,
    pub data: Vec<u8>,
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
                is_primary: (info.monitorInfo.dwFlags & 1) != 0, // MONITORINFOF_PRIMARY = 1
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

        let width = info.monitorInfo.rcMonitor.right - info.monitorInfo.rcMonitor.left;
        let height = info.monitorInfo.rcMonitor.bottom - info.monitorInfo.rcMonitor.top;

        // GDI BitBlt capture (will be upgraded to DXGI in task 2.1)
        use windows::Win32::Graphics::Gdi::{
            BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject,
            GetDIBits, GetDC, ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER,
            BI_RGB, DIB_RGB_COLORS, SRCCOPY,
        };

        unsafe {
            let hdc_screen = GetDC(None);
            let hdc_mem = CreateCompatibleDC(Some(hdc_screen));
            let hbm = CreateCompatibleBitmap(hdc_screen, width, height);
            let old = SelectObject(hdc_mem, hbm.into());

            let src_x = info.monitorInfo.rcMonitor.left;
            let src_y = info.monitorInfo.rcMonitor.top;
            let _ = BitBlt(hdc_mem, 0, 0, width, height, Some(hdc_screen), src_x, src_y, SRCCOPY);

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

            // BGRA -> RGBA
            for i in 0..(width * height) as usize {
                data.swap(i * 4, i * 4 + 2);
            }

            SelectObject(hdc_mem, old);
            let _ = DeleteObject(hbm.into());
            let _ = DeleteDC(hdc_mem);
            ReleaseDC(None, hdc_screen);

            Ok(CaptureResult {
                width: width as u32,
                height: height as u32,
                data,
            })
        }
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
        use windows::Win32::Graphics::Gdi::{
            BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject,
            GetDIBits, GetDC, ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER,
            BI_RGB, DIB_RGB_COLORS, SRCCOPY,
        };

        if width <= 0 || height <= 0 {
            return Err("Invalid region dimensions".to_string());
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
                    biHeight: -height,
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

            // BGRA -> RGBA
            for i in 0..(width * height) as usize {
                data.swap(i * 4, i * 4 + 2);
            }

            SelectObject(hdc_mem, old);
            let _ = DeleteObject(hbm.into());
            let _ = DeleteDC(hdc_mem);
            ReleaseDC(None, hdc_screen);

            Ok(CaptureResult {
                width: width as u32,
                height: height as u32,
                data,
            })
        }
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
        use windows::Win32::Graphics::Gdi::{
            BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject,
            GetDIBits, GetDC, ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER,
            BI_RGB, DIB_RGB_COLORS, SRCCOPY,
        };
        use windows::Win32::UI::WindowsAndMessaging::GetWindowRect;

        let hwnd_handle = HWND(hwnd as *mut _);
        let mut rect = windows::Win32::Foundation::RECT::default();
        unsafe {
            let _ = GetWindowRect(hwnd_handle, &mut rect);
        }

        let width = rect.right - rect.left;
        let height = rect.bottom - rect.top;
        if width <= 0 || height <= 0 {
            return Err("Invalid window dimensions".to_string());
        }

        unsafe {
            let hdc_screen = GetDC(None);
            let hdc_mem = CreateCompatibleDC(Some(hdc_screen));
            let hbm = CreateCompatibleBitmap(hdc_screen, width, height);
            let old = SelectObject(hdc_mem, hbm.into());

            let _ = BitBlt(
                hdc_mem, 0, 0, width, height,
                Some(hdc_screen), rect.left, rect.top, SRCCOPY,
            );

            let mut bmi = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: width,
                    biHeight: -height,
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

            // BGRA -> RGBA
            for i in 0..(width * height) as usize {
                data.swap(i * 4, i * 4 + 2);
            }

            SelectObject(hdc_mem, old);
            let _ = DeleteObject(hbm.into());
            let _ = DeleteDC(hdc_mem);
            ReleaseDC(None, hdc_screen);

            Ok(CaptureResult {
                width: width as u32,
                height: height as u32,
                data,
            })
        }
    }

    #[cfg(not(windows))]
    {
        Err("Not supported on this platform".to_string())
    }
}
