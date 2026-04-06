use tauri::Emitter;
use tracing::{error, info};

mod capture;
mod config;
mod export;
mod ocr;
mod recording;

pub use capture::*;
pub use config::*;
pub use export::*;
pub use ocr::*;
pub use recording::*;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Set per-monitor DPI awareness
    #[cfg(windows)]
    {
        use windows::Win32::UI::HiDpi::{SetProcessDpiAwareness, PROCESS_PER_MONITOR_DPI_AWARE};
        unsafe {
            let _ = SetProcessDpiAwareness(PROCESS_PER_MONITOR_DPI_AWARE);
        }
    }

    // Initialize logging
    let log_dir = dirs::data_local_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("Caprail")
        .join("logs");
    std::fs::create_dir_all(&log_dir).ok();

    let file_appender = tracing_appender::rolling::daily(&log_dir, "caprail.log");
    let (non_blocking, _guard) = tracing_appender::non_blocking(file_appender);

    tracing_subscriber::fmt()
        .with_writer(non_blocking)
        .with_ansi(false)
        .with_env_filter(tracing_subscriber::EnvFilter::new("info"))
        .init();

    info!("Starting Caprail v{}", env!("CARGO_PKG_VERSION"));

    // Clean up stale temp files from previous sessions
    let temp_dir = capture::screenshot_temp_dir();
    if temp_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(&temp_dir) {
            for entry in entries.flatten() {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init());

    // Only add updater if configured
    // builder = builder.plugin(tauri_plugin_updater::Builder::new().build());

    builder = builder
        .setup(|app| {
            info!("Tauri app setup starting...");

            // Set up system tray
            match app.tray_by_id("main-tray") {
                Some(tray) => {
                    info!("Tray icon found, setting up menu...");
                    let cfg = config::load_config_sync();
                    let menu = tauri::menu::Menu::with_items(
                        app,
                        &[
                            &tauri::menu::MenuItem::with_id(app, "screenshot", &cfg.tray_menu_screenshot, true, None::<&str>)?,
                            &tauri::menu::MenuItem::with_id(app, "record", &cfg.tray_menu_record, true, None::<&str>)?,
                            &tauri::menu::MenuItem::with_id(app, "settings", &cfg.tray_menu_settings, true, None::<&str>)?,
                            &tauri::menu::MenuItem::with_id(app, "quit", &cfg.tray_menu_quit, true, None::<&str>)?,
                        ],
                    )?;
                    let _ = tray.set_menu(Some(menu));

                    tray.on_menu_event(move |app, event| {
                        match event.id.as_ref() {
                            "screenshot" => {
                                info!("Tray: screenshot clicked");
                                let _ = app.emit("tray-screenshot", ());
                            }
                            "record" => {
                                info!("Tray: record clicked");
                                let _ = app.emit("tray-record", ());
                            }
                            "settings" => {
                                info!("Tray: settings clicked");
                                let _ = app.emit("tray-settings", ());
                            }
                            "quit" => {
                                info!("Tray: quit clicked");
                                // Emit quit event to frontend for cleanup, then exit after a short delay
                                let _ = app.emit("tray-quit", ());
                                // Give frontend time to cleanup, then exit
                                std::thread::sleep(std::time::Duration::from_millis(100));
                                app.exit(0);
                            }
                            _ => {}
                        }
                    });
                    info!("Tray menu setup complete");
                }
                None => {
                    error!("Tray icon 'main-tray' not found! Check tauri.conf.json trayIcon config.");
                }
            }

            info!("Tauri app setup complete");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            config::load_config,
            config::save_config,
            capture::capture_screen,
            capture::capture_region,
            capture::capture_window,
            capture::get_windows,
            capture::get_monitors,
            capture::read_screenshot,
            capture::cleanup_screenshot,
            capture::save_pin_image,
            capture::read_pin_image,
            capture::cleanup_pin_image,
            recording::start_recording,
            recording::stop_recording,
            recording::pause_recording,
            recording::resume_recording,
            recording::get_recording_status,
            recording::get_recording_info,
            recording::read_recording_frame,
            recording::cleanup_recording,
            export::export_video,
            ocr::ocr_recognize,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    window.hide().ok();
                    api.prevent_close();
                }
            }
        });

    info!("Running Tauri app...");
    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
