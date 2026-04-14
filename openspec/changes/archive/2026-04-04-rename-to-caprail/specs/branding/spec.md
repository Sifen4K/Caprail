## ADDED Requirements

### Requirement: 项目品牌标识统一

系统 SHALL 在所有公开可见位置使用统一的品牌名 "Caprail"。

#### Scenario: npm 包名正确
- **WHEN** 查看 package.json
- **THEN** name 字段为 "caprail"

#### Scenario: Cargo 包名正确
- **WHEN** 查看 Cargo.toml
- **THEN** package.name 为 "caprail"，lib.name 为 "caprail_lib"

#### Scenario: Tauri 配置正确
- **WHEN** 查看 tauri.conf.json
- **THEN** productName 为 "Caprail"，identifier 为 "com.caprail.desktop"，window title 为 "Caprail"

### Requirement: 内部路径使用新名称

系统 SHALL 在日志、配置、临时文件路径中使用 Caprail 命名。

#### Scenario: 日志目录正确
- **WHEN** 应用启动
- **THEN** 日志写入 `%LOCALAPPDATA%/Caprail/logs/caprail.log`

#### Scenario: 用户配置目录正确
- **WHEN** 应用读写配置
- **THEN** 配置存储于 `%APPDATA%/Caprail/config.json`

#### Scenario: 临时目录正确
- **WHEN** 截图/录屏使用临时存储
- **THEN** 临时目录为 `%TEMP%/caprail-captures/` 或 `%TEMP%/caprail-ocr/`

#### Scenario: 注册表自启动值正确
- **WHEN** 用户启用开机自启动
- **THEN** 注册表值名为 "Caprail"

### Requirement: 文档更新

README.md SHALL 使用 Caprail 作为项目名称，并更新所有路径说明。

#### Scenario: README 标题正确
- **WHEN** 查看 README.md
- **THEN** 标题为 "# Caprail"，配置路径说明使用 Caprail 目录名
