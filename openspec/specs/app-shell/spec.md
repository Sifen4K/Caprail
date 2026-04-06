## Purpose

This specification defines the application shell for Caprail, covering system tray integration, global hotkeys, settings persistence, auto-start, and installer/uninstaller behavior.

## Requirements

### Requirement: 系统托盘
The system tray menu items SHALL display labels loaded from `AppConfig` fields `tray_menu_screenshot`, `tray_menu_record`, `tray_menu_settings`, `tray_menu_quit`. English defaults are hardcoded in Rust `lib.rs`.

#### Scenario: Tray menu displays localized labels
- **WHEN** the application starts and builds the system tray menu
- **THEN** each menu item label is read from `AppConfig`; if a field is absent, the English default is used

#### Scenario: 最小化到托盘
- **WHEN** 用户关闭主窗口
- **THEN** 应用最小化到托盘而非退出

### Requirement: 全局快捷键
系统 SHALL 注册全局快捷键，在任何应用中均可触发截图和录屏。

#### Scenario: 截图快捷键
- **WHEN** 用户在任何应用中按下截图快捷键（默认 Ctrl+Shift+A）
- **THEN** 系统进入截图选区模式

#### Scenario: 录屏快捷键
- **WHEN** 用户在任何应用中按下录屏快捷键（默认 Ctrl+Shift+R）
- **THEN** 系统进入录屏选区模式

#### Scenario: 快捷键冲突
- **WHEN** 用户设置的快捷键与其他应用冲突
- **THEN** 系统提示快捷键注册失败，引导用户修改

### Requirement: 设置界面
The settings window SHALL display all labels and button text loaded from the i18n locale file under the `settings.*` key scope.

#### Scenario: Settings labels are loaded from locale
- **WHEN** the settings window opens
- **THEN** all label text and button text is loaded from the i18n locale file for keys such as `settings.title`, `settings.screenshotShortcut`, `settings.recordShortcut`, `settings.savePath`, `settings.defaultFormat`, `settings.autoStart`, and `settings.save`

### Requirement: 安装包
系统 SHALL 提供 Windows 安装包（NSIS 或 MSI），支持一键安装和卸载。

#### Scenario: 安装应用
- **WHEN** 用户双击安装包
- **THEN** 安装向导引导用户完成安装，可选择安装路径，创建桌面快捷方式

#### Scenario: 卸载应用
- **WHEN** 用户通过控制面板卸载应用
- **THEN** 应用完全卸载，清理注册表和快捷方式

### Requirement: 自动更新
系统 SHALL 支持自动检查更新并提示用户升级。

#### Scenario: 检查更新
- **WHEN** 应用启动时或用户手动检查更新
- **THEN** 系统向更新服务器查询最新版本

#### Scenario: 提示更新
- **WHEN** 检测到新版本
- **THEN** 系统通过托盘通知提示用户，用户确认后自动下载并安装

### Requirement: 开机自启
系统 SHALL 支持设置开机自动启动。

#### Scenario: 启用开机自启
- **WHEN** 用户在设置中开启"开机自动启动"
- **THEN** 系统将应用添加到 Windows 启动项，下次开机自动运行
