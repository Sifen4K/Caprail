# Caprail

Windows 平台的截图与录屏工具，基于 Tauri 2 + TypeScript + Rust 构建。

## 功能

- **区域截图** — 框选屏幕任意区域，支持窗口智能识别
- **截图标注** — 矩形、椭圆、箭头、画笔、文字、马赛克、模糊、印章
- **撤销/重做** — 完整的编辑历史管理
- **钉图** — 将截图钉在桌面最上层，支持拖拽、缩放、透明度调节
- **屏幕录制** — 自定义区域录屏，支持暂停/继续
- **录屏编辑** — 时间线裁剪、速度调节、逐帧预览
- **导出** — MP4 / GIF 格式导出，异步进度显示
- **OCR 文字识别** — 提取截图中的文字（需安装 OCR 引擎）
- **全局快捷键** — 随时呼出截图/录屏
- **开机自启** — 可选注册表自启动
- **系统托盘** — 最小化到托盘运行

## 环境要求

| 依赖 | 版本 | 说明 |
|------|------|------|
| [Node.js](https://nodejs.org/) | >= 18 | 前端构建 |
| [Rust](https://rustup.rs/) | >= 1.75 | 后端编译 |
| [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) | 2022 | 勾选「使用 C++ 的桌面开发」工作负载 |

### 安装环境依赖

**Node.js：**

```bash
# 使用 winget 安装
winget install OpenJS.NodeJS.LTS

# 或使用 fnm (推荐)
winget install Schniz.fnm
fnm install --lts
```

**Rust：**

```bash
# 使用官方安装器
winget install Rustlang.Rustup

# 安装后确认
rustup default stable
rustc --version
```

**Visual Studio Build Tools：**

```bash
winget install Microsoft.VisualStudio.2022.BuildTools
```

安装时勾选「使用 C++ 的桌面开发」工作负载（包含 MSVC 编译器和 Windows SDK）。

### 可选依赖

**FFmpeg**（录屏导出 MP4/GIF 必需）：

```bash
winget install Gyan.FFmpeg

# 确认已加入 PATH
ffmpeg -version
```

**OCR 引擎**（文字识别功能必需，二选一）：

```bash
# 方案一：PaddleOCR（推荐，中文识别效果好）
pip install paddlepaddle paddleocr

# 方案二：Tesseract
winget install UB-Mannheim.TesseractOCR
# 安装后需下载中文语言包 chi_sim 到 tessdata 目录
```

## 快速开始

```bash
# 克隆项目
git clone <repo-url>
cd Screenshot

# 安装前端依赖
npm install

# 开发模式运行（自动热重载）
npm run tauri dev

# 构建安装包
npm run tauri build
```

## 常用命令

| 命令 | 说明 |
|------|------|
| `npm run dev` | 仅启动前端 Vite 开发服务器 |
| `npm run build` | 仅构建前端产物到 `dist/` |
| `npm run tauri dev` | 启动完整的 Tauri 开发环境 |
| `npm run tauri build` | 构建 NSIS 安装包到 `src-tauri/target/release/bundle/` |

## 默认快捷键

| 操作 | 快捷键 |
|------|--------|
| 截图 | `Ctrl+Shift+A` |
| 录屏 | `Ctrl+Shift+R` |

快捷键可在设置页面自定义。

## 项目结构

```
Screenshot/
├── src/                        # 前端源码 (TypeScript + HTML + CSS)
│   ├── index.html              # 主窗口（托盘入口）
│   ├── screenshot-overlay.html # 截图选区覆盖层
│   ├── record-overlay.html     # 录屏选区覆盖层
│   ├── record-control.html     # 录屏控制条
│   ├── editor.html             # 截图标注编辑器
│   ├── clip-editor.html        # 录屏编辑器
│   ├── pin.html                # 钉图窗口
│   ├── settings.html           # 设置页面
│   ├── scripts/                # TypeScript 模块
│   │   ├── main.ts             # 应用入口，窗口/快捷键/事件管理
│   │   ├── overlay.ts          # 截图选区画布（十字线、框选、窗口高亮）
│   │   ├── screenshots.ts      # 截图窗口创建与显示器布局
│   │   ├── recording.ts        # 录屏选区窗口创建
│   │   ├── record-overlay.ts   # 录屏区域选择 UI
│   │   ├── record-control.ts   # 录屏暂停/停止/时长显示
│   │   ├── editor.ts           # 标注编辑器状态与工具栏
│   │   ├── editor-types.ts     # 编辑器类型定义
│   │   ├── editor-tools.ts     # 标注绘制函数
│   │   ├── editor-canvas.ts    # 画布事件与分层渲染
│   │   ├── editor-history.ts   # 撤销/重做
│   │   ├── editor-output.ts    # 复制/保存/钉图/OCR
│   │   ├── clip-editor.ts      # 录屏播放、时间线、裁剪、导出
│   │   ├── pin.ts              # 钉图拖拽/缩放/透明度
│   │   ├── settings.ts         # 设置窗口打开
│   │   └── settings-page.ts    # 设置 UI 与快捷键捕获
│   └── styles/
│       ├── main.css            # 主窗口样式
│       └── editor.css          # 编辑器样式
├── src-tauri/                  # Rust 后端
│   ├── Cargo.toml              # Rust 依赖配置
│   ├── tauri.conf.json         # Tauri 应用配置
│   ├── capabilities/           # Tauri 权限声明
│   ├── icons/                  # 应用图标（托盘 + 安装包）
│   ├── resources/              # 运行时资源（ffmpeg 等）
│   └── src/
│       ├── main.rs             # 入口
│       ├── lib.rs              # 应用初始化、托盘菜单、命令注册
│       ├── capture.rs          # GDI 截图（全屏/区域/窗口）
│       ├── recording.rs        # 内存帧捕获线程
│       ├── export.rs           # FFmpeg 管道导出 MP4/GIF
│       ├── config.rs           # 配置读写 + 注册表自启
│       └── ocr.rs              # PaddleOCR / Tesseract 调用
├── package.json
├── tsconfig.json
├── vite.config.ts              # Vite 多入口构建配置
└── openspec/                   # 功能规格文档
```

## 技术细节

- **截图捕获**：通过 Windows GDI API（BitBlt + GetDIBits）获取 BGRA 原始像素，保存为无压缩 BMP 以避免编解码延迟
- **录屏存储**：帧数据全程保留在内存中（BGRA 格式），停止录制后即时打开编辑器，无需等待文件写入
- **视频导出**：通过管道将内存中的原始帧流式传输给 FFmpeg 进程，支持实时进度回调
- **标注渲染**：采用多层 Canvas 分离策略 — 背景层（截图）+ 标注层（已确认）+ 交互层（正在绘制），避免全量重绘
- **DPI 感知**：启用 Per-Monitor DPI Awareness，正确处理多显示器不同缩放的场景

## 配置文件位置

| 文件 | 路径 |
|------|------|
| 应用配置 | `%APPDATA%/Caprail/config.json` |
| 运行日志 | `%LOCALAPPDATA%/Caprail/logs/` |
| 临时截图 | `%TEMP%/caprail-captures/` |

## License

Private
