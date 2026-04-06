## MODIFIED Requirements

### Requirement: 系统托盘
The system tray menu items SHALL display labels loaded from `AppConfig` fields `tray_menu_screenshot`, `tray_menu_record`, `tray_menu_settings`, `tray_menu_quit`. English defaults are hardcoded in Rust `lib.rs`.

#### Scenario: Tray menu displays localized labels
- **WHEN** the application starts and builds the system tray menu
- **THEN** each menu item label is read from `AppConfig`; if a field is absent, the English default is used

### Requirement: 设置界面
The settings window SHALL display all labels and button text loaded from the i18n locale file under the `settings.*` key scope.

#### Scenario: Settings labels are loaded from locale
- **WHEN** the settings window opens
- **THEN** all label text and button text is loaded from the i18n locale file for keys such as `settings.title`, `settings.screenshotShortcut`, `settings.recordShortcut`, `settings.savePath`, `settings.defaultFormat`, `settings.autoStart`, and `settings.save`
