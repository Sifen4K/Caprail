# Caprail

A screenshot and screen recording tool for Windows. / [中文](#用户手册) / [English](#user-guide)

---

## User Guide

### Features

| Feature | Description |
|---------|-------------|
| Region screenshot | Drag to select any area; automatic window detection |
| Annotation | Rectangle, ellipse, arrow, pen, text, mosaic, blur, stamp |
| Pin to screen | Pin screenshot on top; supports drag, zoom, opacity |
| Screen recording | Custom region; pause/resume |
| Recording editor | Timeline trim, speed control, frame preview |
| Export | MP4 / GIF |
| OCR | Extract text from screenshot (requires OCR engine) |

### Shortcuts

| Action | Default |
|--------|---------|
| Screenshot | `Ctrl+Shift+A` |
| Record | `Ctrl+Shift+R` |

Customizable in Settings.

### Screenshot Controls

- Left click and drag to select a capture region
- Release the left button to confirm the region capture
- Double-click to capture the full monitor under the cursor
- Press `Esc` to cancel
- While dragging with the left button still held, press the right button to cancel the current screenshot

### Installation

#### Required

**FFmpeg** — required for MP4/GIF export

```bash
winget install Gyan.FFmpeg
```

Restart terminal and verify:

```bash
ffmpeg -version
```

#### Optional

**OCR Engine** — required for text extraction, choose one:

**Option 1: PaddleOCR (recommended, better Chinese OCR)**

```bash
pip install paddlepaddle paddleocr
```

**Option 2: Tesseract**

```bash
winget install UB-Mannheim.TesseractOCR
```

After installing Tesseract, download `chi_sim.traineddata` to the tessdata directory (typically `C:\Program Files\Tesseract-OCR\tessdata\`).

### FAQ

**Q: Recording export fails?**
Make sure FFmpeg is installed and in PATH. Run `ffmpeg -version` to verify.

**Q: OCR recognition fails?**
Make sure PaddleOCR or Tesseract is installed. PaddleOCR downloads models automatically on first run.

**Q: Shortcuts not working?**
Check if another app is using the same shortcut. You can rebind shortcuts in Settings.

---

## Developer Guide

### Tech Stack

- **Frontend**: TypeScript + Vite
- **Backend**: Rust + Tauri 2
- **Screenshot**: Windows GDI API
- **Recording**: In-memory frame capture + FFmpeg pipeline export

### Requirements

| Dependency | Version | Notes |
|-----------|---------|-------|
| Node.js | >= 18 | Frontend build |
| Rust | >= 1.75 | Backend compilation |
| Visual Studio Build Tools | 2022 | Select "Desktop development with C++" |

### Quick Start

```bash
npm install
npm run tauri dev   # Development mode
npm run tauri build  # Build installer
```

Output: `src-tauri/target/release/bundle/nsis/`

### Project Structure

```
Caprail/
├── src/                    # Frontend source
│   ├── index.html          # Main window (tray entry)
│   ├── editor.html         # Screenshot annotation editor
│   ├── clip-editor.html    # Recording editor
│   ├── pin.html            # Pin window
│   ├── settings.html       # Settings page
│   └── scripts/            # TypeScript modules
│
├── src-tauri/              # Rust backend
│   ├── src/
│   │   ├── lib.rs          # App init, tray menu
│   │   ├── capture.rs      # GDI screenshot
│   │   ├── recording.rs    # In-memory frame capture
│   │   ├── export.rs       # FFmpeg pipeline export
│   │   ├── config.rs       # Config I/O, registry auto-start
│   │   └── ocr.rs          # PaddleOCR / Tesseract invocation
│   ├── Cargo.toml
│   └── tauri.conf.json
│
└── openspec/               # Feature specifications
```

### Core Implementation

**Screenshot Capture**: Uses Windows GDI API (BitBlt + GetDIBits) to capture BGRA raw pixels, stored uncompressed in memory.

**Recording Storage**: Frame data stays in memory (BGRA format). Editor opens immediately when recording stops.

**Video Export**: Streams raw frames from memory to FFmpeg via pipe, with real-time progress callbacks.

**Annotation Rendering**: Multi-layer Canvas strategy — background (screenshot) + annotation layer (confirmed) + interaction layer (in-progress drawing).

**DPI Awareness**: Per-Monitor DPI Awareness enabled for correct multi-monitor handling with different scaling.

### Config & Logs

| Type | Path |
|------|------|
| App config | `%APPDATA%/Caprail/config.json` |
| Runtime logs | `%LOCALAPPDATA%/Caprail/logs/` |
| Temp files | `%TEMP%/caprail-captures/` |

---

## 用户手册

### 功能概览

| 功能 | 说明 |
|------|------|
| 区域截图 | 框选屏幕任意区域，支持窗口智能识别 |
| 截图标注 | 矩形、椭圆、箭头、画笔、文字、马赛克、模糊、印章 |
| 钉图 | 将截图钉在桌面最上层，支持拖拽、缩放、透明度调节 |
| 屏幕录制 | 自定义区域录屏，支持暂停/继续 |
| 录屏编辑 | 时间线裁剪、速度调节、逐帧预览 |
| 导出 | MP4 / GIF 格式导出 |
| OCR 文字识别 | 提取截图中的文字（需安装 OCR 引擎） |

### 快捷键

| 操作 | 默认快捷键 |
|------|-----------|
| 截图 | `Ctrl+Shift+A` |
| 录屏 | `Ctrl+Shift+R` |

可在设置页面自定义。

### 截图操作

- 按住左键拖动以框选截图区域
- 松开左键后确认区域截图
- 双击可截取鼠标所在显示器的整屏
- 按 `Esc` 取消截图
- 在按住左键拖动框选时按下右键，可取消当前这次截图

### 安装依赖

#### 必需依赖

**FFmpeg** — 录屏导出 MP4/GIF 必需

```bash
winget install Gyan.FFmpeg
```

安装后重启终端，确认生效：

```bash
ffmpeg -version
```

#### 可选依赖

**OCR 引擎** — 文字识别功能必需，二选一：

**方案一：PaddleOCR（推荐，中文识别效果好）**

```bash
pip install paddlepaddle paddleocr
```

**方案二：Tesseract**

```bash
winget install UB-Mannheim.TesseractOCR
```

安装后需下载中文语言包 `chi_sim.traineddata` 到 tessdata 目录（通常在 `C:\Program Files\Tesseract-OCR\tessdata\`）。

### 常见问题

**Q: 录屏导出失败？**
确保 FFmpeg 已安装并加入 PATH。终端运行 `ffmpeg -version` 检查。

**Q: OCR 识别失败？**
确保已安装 PaddleOCR 或 Tesseract。PaddleOCR 首次运行会自动下载模型文件。

**Q: 快捷键不生效？**
检查是否有其他软件占用了相同快捷键。可在设置页面重新绑定。

---

## 开发指南

### 技术栈

- **前端**: TypeScript + Vite
- **后端**: Rust + Tauri 2
- **截图**: Windows GDI API
- **录屏**: 内存帧捕获 + FFmpeg 管道导出

### 环境要求

| 依赖 | 版本 | 说明 |
|------|------|------|
| Node.js | >= 18 | 前端构建 |
| Rust | >= 1.75 | 后端编译 |
| Visual Studio Build Tools | 2022 | 勾选「使用 C++ 的桌面开发」 |

### 快速开始

```bash
npm install
npm run tauri dev   # 开发模式
npm run tauri build  # 构建安装包
```

构建产物位于 `src-tauri/target/release/bundle/nsis/`。

### 项目结构

```
Caprail/
├── src/                    # 前端源码
│   ├── index.html          # 主窗口（托盘入口）
│   ├── editor.html         # 截图标注编辑器
│   ├── clip-editor.html    # 录屏编辑器
│   ├── pin.html            # 钉图窗口
│   ├── settings.html       # 设置页面
│   └── scripts/            # TypeScript 模块
│
├── src-tauri/              # Rust 后端
│   ├── src/
│   │   ├── lib.rs          # 应用初始化、托盘菜单
│   │   ├── capture.rs      # GDI 截图
│   │   ├── recording.rs    # 内存帧捕获
│   │   ├── export.rs       # FFmpeg 管道导出
│   │   ├── config.rs       # 配置读写、注册表自启
│   │   └── ocr.rs          # PaddleOCR / Tesseract 调用
│   ├── Cargo.toml
│   └── tauri.conf.json
│
└── openspec/               # 功能规格文档
```

### 核心实现

**截图捕获**: 通过 Windows GDI API（BitBlt + GetDIBits）获取 BGRA 原始像素，无压缩存储到内存。

**录屏存储**: 帧数据全程保留在内存中（BGRA 格式），停止录制后即时打开编辑器。

**视频导出**: 通过管道将内存中的原始帧流式传输给 FFmpeg 进程，支持实时进度回调。

**标注渲染**: 多层 Canvas 分离策略——背景层（截图）+ 标注层（已确认）+ 交互层（正在绘制）。

**DPI 感知**: 启用 Per-Monitor DPI Awareness，正确处理多显示器不同缩放的场景。

### 配置与日志

| 类型 | 路径 |
|------|------|
| 应用配置 | `%APPDATA%/Caprail/config.json` |
| 运行日志 | `%LOCALAPPDATA%/Caprail/logs/` |
| 临时文件 | `%TEMP%/caprail-captures/` |

## License

MIT
