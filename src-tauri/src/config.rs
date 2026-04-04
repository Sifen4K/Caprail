use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub screenshot_shortcut: String,
    pub record_shortcut: String,
    pub save_path: String,
    pub default_image_format: String,
    pub auto_start: bool,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            screenshot_shortcut: "Ctrl+Shift+A".to_string(),
            record_shortcut: "Ctrl+Shift+R".to_string(),
            save_path: dirs::picture_dir()
                .unwrap_or_else(|| std::path::PathBuf::from("."))
                .join("Caprail")
                .to_string_lossy()
                .to_string(),
            default_image_format: "png".to_string(),
            auto_start: false,
        }
    }
}

fn config_path() -> std::path::PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("Caprail")
        .join("config.json")
}

#[tauri::command]
pub fn load_config() -> Result<AppConfig, String> {
    let path = config_path();
    if path.exists() {
        let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).map_err(|e| e.to_string())
    } else {
        Ok(AppConfig::default())
    }
}

#[tauri::command]
pub fn save_config(config: AppConfig) -> Result<(), String> {
    let path = config_path();
    std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    let content = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    std::fs::write(&path, content).map_err(|e| e.to_string())?;

    // Apply auto-start setting
    set_auto_start(config.auto_start).map_err(|e| e.to_string())?;

    Ok(())
}

#[cfg(windows)]
fn set_auto_start(enabled: bool) -> Result<(), String> {
    use windows::Win32::System::Registry::{
        RegDeleteValueW, RegOpenKeyExW, RegSetValueExW,
        HKEY_CURRENT_USER, KEY_SET_VALUE, REG_SZ,
    };
    use windows::core::PCWSTR;

    let key_path: Vec<u16> = "Software\\Microsoft\\Windows\\CurrentVersion\\Run\0"
        .encode_utf16()
        .collect();
    let value_name: Vec<u16> = "Caprail\0".encode_utf16().collect();

    unsafe {
        let mut hkey = windows::Win32::System::Registry::HKEY::default();
        let status = RegOpenKeyExW(
            HKEY_CURRENT_USER,
            PCWSTR(key_path.as_ptr()),
            None,
            KEY_SET_VALUE,
            &mut hkey,
        );
        if status.is_err() {
            return Err(format!("Failed to open registry key: {:?}", status));
        }

        if enabled {
            let exe_path = std::env::current_exe()
                .map_err(|e| e.to_string())?;
            let exe_str = exe_path.to_string_lossy();
            let exe_wide: Vec<u16> = format!("\"{}\"\0", exe_str).encode_utf16().collect();
            let result = RegSetValueExW(
                hkey,
                PCWSTR(value_name.as_ptr()),
                None,
                REG_SZ,
                Some(std::slice::from_raw_parts(
                    exe_wide.as_ptr() as *const u8,
                    exe_wide.len() * 2,
                )),
            );
            if result.is_err() {
                return Err(format!("Failed to set registry value: {:?}", result));
            }
        } else {
            let _ = RegDeleteValueW(hkey, PCWSTR(value_name.as_ptr()));
        }
    }

    Ok(())
}

#[cfg(not(windows))]
fn set_auto_start(_enabled: bool) -> Result<(), String> {
    Ok(())
}
