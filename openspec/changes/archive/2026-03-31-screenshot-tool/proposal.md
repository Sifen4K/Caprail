## Why

日常工作中频繁需要截图标注、录屏演示，现有工具（如 PixPin）为闭源商业软件且功能更新受限。需要一款自研的高性能截图录屏工具，满足团队日常的截图标注、屏幕录制、文字提取等需求，可自由分发给同事使用。

## What Changes

这是一个从零开始的新项目，基于 Tauri v2 + Rust 构建 Windows 桌面应用：

- 新增区域/窗口/全屏截图能力，支持全局快捷键触发
- 新增图形标注编辑器（矩形、圆形、箭头、线条、文字、马赛克/模糊、记号/印章）
- 新增截图钉在屏幕上功能（always-on-top 浮窗，可拖动、缩放、调透明度）
- 新增 OCR 文字提取（基于 PaddleOCR，中英文支持）
- 新增屏幕录制能力（基于 DXGI Desktop Duplication + ffmpeg）
- 新增录屏导出为 MP4 / GIF 格式
- 新增录屏简单剪辑（时间轴裁剪首尾、播放倍率调整）
- 新增系统托盘常驻 + 全局快捷键管理
- 新增用户设置界面（快捷键、保存路径、默认格式等）
- 提供安装包（NSIS/MSI）和自动更新能力

## Capabilities

### New Capabilities

- `screen-capture`: 屏幕截图核心能力 — 区域选择、窗口识别、全屏截图，基于 DXGI 实现
- `annotation-editor`: 图形标注编辑器 — 矩形/圆/箭头/线条/文字/马赛克/记号等标注工具，基于 HTML Canvas
- `pin-to-screen`: 截图钉在屏幕上 — always-on-top 浮窗，支持拖动、缩放、透明度调节
- `ocr-extraction`: OCR 文字提取 — 从截图中识别并提取文字，基于 PaddleOCR
- `screen-recording`: 屏幕录制 — 区域/全屏录制，基于 DXGI + ffmpeg 编码
- `recording-export`: 录屏导出 — 支持 MP4、GIF 格式输出，含编码参数配置
- `recording-editor`: 录屏简单剪辑 — 时间轴裁剪首尾、播放倍率调整，录完即编辑
- `app-shell`: 应用骨架 — 系统托盘、全局快捷键、设置界面、安装包、自动更新

## Impact

- **技术栈**: Tauri v2 (框架) + Rust (后端) + HTML/CSS/JS (前端 UI)
- **系统依赖**: Windows 10+ (DXGI Desktop Duplication API)
- **外部依赖**: ffmpeg (视频编解码)、PaddleOCR (文字识别)
- **分发方式**: NSIS/MSI 安装包 + Tauri 自动更新插件
- **开发顺序**:
  1. `app-shell` — 项目骨架 + 托盘 + 全局快捷键
  2. `screen-capture` + `annotation-editor` — 截图 + 标注
  3. `pin-to-screen` — 钉在屏幕上
  4. `screen-recording` + `recording-export` (MP4) — 录屏
  5. `recording-export` (GIF) + `recording-editor` — GIF + 剪辑
  6. `ocr-extraction` — OCR
  7. `app-shell` 完善 — 设置界面 + 安装包 + 自动更新
