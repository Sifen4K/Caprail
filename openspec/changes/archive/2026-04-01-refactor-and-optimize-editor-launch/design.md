## Context

这是一个基于 Tauri 2.5 (Rust + TypeScript) 的 Windows 桌面截图/录屏工具。当前截图后进入编辑器有明显卡顿，主要原因：

1. **IPC 传输瓶颈**：截图数据（RGBA 原始像素，1920×1080 = ~8MB）通过 Tauri 事件系统以 `number[]` 形式传输，JSON 序列化/反序列化开销巨大
2. **硬编码 300ms 延迟**：`setTimeout(300)` 等待编辑器窗口就绪，不够可靠且引入固定延迟
3. **同步 BGRA→RGBA 转换**：逐像素 swap 循环在大图上耗时明显
4. **代码重复严重**：`capture_screen`/`capture_region`/`capture_window` 三个函数包含几乎相同的 GDI 调用代码

## Goals / Non-Goals

**Goals:**
- 将截图→编辑器打开时间降低到 100ms 以内（感知无卡顿）
- 消除 capture.rs 中 3 处重复的 GDI 捕获代码
- 将 recording.rs 全局状态收敛为结构化管理
- 将 editor.ts (654行) 拆分为可维护的模块
- 统一所有事件命名为 kebab-case

**Non-Goals:**
- 不升级 GDI 到 DXGI Desktop Duplication（这是独立优化，范围太大）
- 不重写 UI 框架（保持 Vanilla TS）
- 不修改 FFmpeg 录制管线的核心逻辑
- 不增加新功能

## Decisions

### 1. 图像数据传输：临时 PNG 文件替代 IPC 事件载荷

**选择**：Rust 端将截图编码为 PNG 写入临时文件，前端通过 `convertFileSrc` 读取。

**替代方案**：
- A) 保持 IPC 事件但使用 `Uint8Array`：Tauri IPC 仍需 JSON 序列化，`number[]` 与 `Uint8Array` 在传输层无本质区别
- B) 共享内存 (mmap)：需要额外依赖，复杂度高，跨进程管理困难
- C) Rust 端直接返回 base64 编码的 PNG：编码开销小于原始像素传输，但字符串仍需 JSON 传输

**决策理由**：PNG 文件方案最简单——Rust `image` crate 已在依赖中，编码 1920×1080 PNG 约 50ms；前端 `<img>` 加载 PNG 比 `putImageData` 8MB 原始像素更快；临时文件在编辑器关闭时清理。

### 2. 编辑器就绪信号：替换 300ms setTimeout

**选择**：编辑器窗口初始化完成后主动 emit `"editor-ready"` 事件，main.ts 收到后再发送文件路径。

**替代方案**：
- A) 使用 URL 查询参数传递文件路径（类似 clip-editor 的做法）：最简单，编辑器自行读取文件
- B) 增加 setTimeout 到 500ms 以增加可靠性：治标不治本

**决策理由**：采用方案 A（URL 查询参数），与 clip-editor 保持一致。编辑器页面加载时从 URL 读取文件路径，无需事件协调，彻底消除延迟。

### 3. BGRA→RGBA 转换：移至编码阶段消除

**选择**：不再做 BGRA→RGBA swap。直接将 BGRA 数据编码为 PNG（image crate 支持 BGRA→RGB 转换），输出为标准 PNG 文件。

**决策理由**：当数据以文件形式传输时，颜色格式转换由 PNG 编码器内部处理，无需手动 swap。

### 4. capture.rs 重构：提取公共 GDI 辅助函数

**选择**：提取 `fn gdi_capture(x, y, width, height) -> Result<Vec<u8>, String>` 公共函数，三个 `capture_*` 命令调用它。

### 5. recording.rs 状态管理：封装为 RecordingSession

**选择**：将 `RECORDING`、`PAUSED` AtomicBool 和 `RECORDING_STATE` Mutex 合并为一个 `Mutex<Option<RecordingSession>>`，其中 `RecordingSession` 持有所有录制状态。`None` 表示未录制。

### 6. editor.ts 模块拆分

**选择**：拆分为：
- `editor.ts`：入口，初始化画布和工具栏
- `editor-tools.ts`：绘图工具（drawAnnotation, drawArrow, applyMosaic, applyBlur, drawStamp）
- `editor-canvas.ts`：画布操作（鼠标事件、redrawAll、getCanvasPos）
- `editor-history.ts`：undo/redo 管理
- `editor-output.ts`：复制/保存/OCR/钉屏

## Risks / Trade-offs

- **[临时文件残留]** → 编辑器 `beforeunload` 时调用 Rust 命令清理临时文件；若进程崩溃则下次启动时清理 temp 目录
- **[PNG 编码耗时]** → 1920×1080 PNG 编码约 50ms，可接受；若需更快可用 BMP 或直接传 raw + metadata
- **[模块拆分破坏性]** → 所有状态通过参数/模块导出传递，避免循环依赖；分步拆分，每步验证功能正常
- **[事件名变更]** → 一次性全局替换，前后端同步修改，风险低
