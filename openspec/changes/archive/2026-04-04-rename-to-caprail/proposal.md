## Why

当前项目名 "ScreenshotTool" / "screenshot-tool" 过于通用，缺乏辨识度，且不能完整反映功能（截图 + 录屏）。开源发布需要一个独特的品牌名，提升可发现性和认知度。

## What Changes

**BREAKING** — 所有硬编码名称引用将变更：

| 位置 | 旧值 | 新值 |
|----------|-----------|-----------|
| package.json | `screenshot-tool` | `caprail` |
| Cargo.toml | `screenshot-tool` | `caprail` |
| Cargo.toml lib name | `screenshot_tool_lib` | `caprail_lib` |
| tauri.conf.json productName | `ScreenshotTool` | `Caprail` |
| tauri.conf.json identifier | `com.screenshot.tool` | `com.caprail.app` |
| tauri.conf.json window title | `ScreenshotTool` | `Caprail` |
| Rust 日志目录 | `ScreenshotTool` | `Caprail` |
| Rust 日志文件名 | `screenshot-tool.log` | `caprail.log` |
| Rust 数据目录 | `ScreenshotTool` | `Caprail` |
| Rust 注册表值 | `ScreenshotTool` | `Caprail` |
| Rust 临时目录 | `screenshot-tool-*` | `caprail-*` |
| README.md 标题与路径 | `ScreenshotTool` | `Caprail` |

用户数据迁移：**不处理**。升级用户需重新配置。配置路径从 `%APPDATA%/ScreenshotTool/` 变为 `%APPDATA%/Caprail/`。

## Capabilities

### New Capabilities

- `branding`: 项目品牌标识与命名规范，用于开源发布

### Modified Capabilities

无 — 仅命名/品牌变更，功能需求未修改。

## Impact

- 所有配置文件（package.json, Cargo.toml, tauri.conf.json）
- Rust 源文件：lib.rs, config.rs, capture.rs, ocr.rs
- README.md 文档
- TypeScript 源文件中的 UI 文本引用
- 用户配置目录位置（对现有用户为破坏性变更）
- 注册表自启动值名（对已启用自启动的用户为破坏性变更）