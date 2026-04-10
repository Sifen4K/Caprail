use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub screenshot_shortcut: String,
    pub record_shortcut: String,
    pub save_path: String,
    pub default_image_format: String,
    pub auto_start: bool,
    #[serde(default)]
    pub language: String,
    #[serde(default)]
    pub tray_menu_screenshot: String,
    #[serde(default)]
    pub tray_menu_record: String,
    #[serde(default)]
    pub tray_menu_settings: String,
    #[serde(default)]
    pub tray_menu_quit: String,
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
            language: "en".to_string(),
            tray_menu_screenshot: "Screenshot".to_string(),
            tray_menu_record: "Record".to_string(),
            tray_menu_settings: "Settings".to_string(),
            tray_menu_quit: "Quit".to_string(),
        }
    }
}

fn config_path() -> std::path::PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("Caprail")
        .join("config.json")
}

/// Synchronous config loader for use inside Tauri setup (not a command)
pub fn load_config_sync() -> AppConfig {
    let path = config_path();
    if path.exists() {
        if let Ok(content) = std::fs::read_to_string(&path) {
            if let Ok(mut config) = serde_json::from_str::<AppConfig>(&content) {
                apply_defaults(&mut config);
                return config;
            }
        }
    }
    AppConfig::default()
}

fn apply_defaults(cfg: &mut AppConfig) -> bool {
    let mut changed = false;
    if cfg.save_path.is_empty() {
        cfg.save_path = dirs::picture_dir()
            .unwrap_or_else(|| std::path::PathBuf::from("."))
            .join("Caprail")
            .to_string_lossy()
            .to_string();
        changed = true;
    }
    changed
}

#[tauri::command]
pub fn load_config() -> Result<AppConfig, String> {
    let path = config_path();
    if path.exists() {
        let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let mut config: AppConfig = serde_json::from_str(&content).map_err(|e| e.to_string())?;
        if apply_defaults(&mut config) {
            // Empty field detected, persist default back to disk
            std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
            let content = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
            std::fs::write(&path, content).map_err(|e| e.to_string())?;
        }
        Ok(config)
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

#[cfg(test)]
mod tests {
    use super::{apply_defaults, AppConfig};

    #[test]
    fn apply_defaults_preserves_existing_localized_fields() {
        let mut config = AppConfig {
            screenshot_shortcut: "Ctrl+Shift+A".to_string(),
            record_shortcut: "Ctrl+Shift+R".to_string(),
            save_path: String::new(),
            default_image_format: "png".to_string(),
            auto_start: false,
            language: "zh".to_string(),
            tray_menu_screenshot: "截图".to_string(),
            tray_menu_record: "录屏".to_string(),
            tray_menu_settings: "设置".to_string(),
            tray_menu_quit: "退出".to_string(),
        };

        let changed = apply_defaults(&mut config);

        assert!(changed);
        assert!(!config.save_path.is_empty());
        assert_eq!(config.language, "zh");
        assert_eq!(config.tray_menu_screenshot, "截图");
        assert_eq!(config.tray_menu_record, "录屏");
        assert_eq!(config.tray_menu_settings, "设置");
        assert_eq!(config.tray_menu_quit, "退出");
    }

    #[test]
    fn deserialize_round_trip_keeps_localized_config_fields() {
        let json = r#"{
            "screenshot_shortcut": "Ctrl+Shift+A",
            "record_shortcut": "Ctrl+Shift+R",
            "save_path": "D:/Captures",
            "default_image_format": "png",
            "auto_start": false,
            "language": "zh",
            "tray_menu_screenshot": "截图",
            "tray_menu_record": "录屏",
            "tray_menu_settings": "设置",
            "tray_menu_quit": "退出"
        }"#;

        let config: AppConfig = serde_json::from_str(json).expect("config should deserialize");

        assert_eq!(config.language, "zh");
        assert_eq!(config.tray_menu_screenshot, "截图");
        assert_eq!(config.tray_menu_record, "录屏");
        assert_eq!(config.tray_menu_settings, "设置");
        assert_eq!(config.tray_menu_quit, "退出");
    }
}
