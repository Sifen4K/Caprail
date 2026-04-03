## 1. capture.rs 重构 — 提取公共 GDI 逻辑 & PNG 输出

- [x] 1.1 提取 `gdi_capture(x, y, width, height) -> Result<Vec<u8>, String>` 公共函数，封装 GetDC/CreateCompatibleDC/BitBlt/GetDIBits/资源清理的完整流程
- [x] 1.2 将 `capture_screen`、`capture_region`、`capture_window` 重构为调用 `gdi_capture`，删除重复代码
- [x] 1.3 添加 `save_capture_as_png(data: &[u8], width: u32, height: u32) -> Result<String, String>` 函数，将 BGRA 像素数据编码为 PNG 并保存到临时目录，返回文件路径
- [x] 1.4 修改 `CaptureResult` 结构体为 `{ path: String, width: u32, height: u32 }`，移除 `data: Vec<u8>` 字段
- [x] 1.5 删除所有 BGRA→RGBA 手动字节交换循环

## 2. 编辑器启动流程优化 — 消除延迟

- [x] 2.1 修改 `main.ts::openEditorWindow` 使用 URL 查询参数传递文件路径（`editor.html?path=<encoded>`），删除 `setTimeout(300)` 和 `emit("load-screenshot")` 逻辑
- [x] 2.2 修改 `editor.ts::loadScreenshot` 为从 URL 参数读取文件路径，通过 `convertFileSrc` 转换后用 `Image` 对象加载 PNG 到画布
- [x] 2.3 同步修改 `overlay.ts` 的 `screenshot-captured` 事件载荷为 `{ path, width, height }` 格式
- [x] 2.4 修改 `openPinWindow` 同样使用 URL 查询参数传递文件路径，删除 `setTimeout(300)` 和 `emit("load-pin-image")`

## 3. 临时文件清理机制

- [x] 3.1 在 Rust 后端添加 `cleanup_temp_file(path: String)` 命令，用于删除指定临时文件
- [x] 3.2 在 `editor.ts` 中注册 `beforeunload` 事件，关闭时调用 `cleanup_temp_file` 清理临时 PNG
- [x] 3.3 在应用启动时（`lib.rs::run`）清理 temp 目录中上次残留的截图临时文件

## 4. recording.rs 状态管理重构

- [x] 4.1 定义 `RecordingSession` 结构体，包含 ffmpeg_process、config、start_time、pause_duration、last_pause_time、frame_count、capture_thread、paused (bool)、stop_signal (`Arc<AtomicBool>`)
- [x] 4.2 替换全局 `RECORDING`/`PAUSED` AtomicBool 和 `RECORDING_STATE` 为单一 `static SESSION: Lazy<Mutex<Option<RecordingSession>>>`
- [x] 4.3 重构 `start_recording`：创建 `RecordingSession`，将 `stop_signal` clone 传入 capture_loop
- [x] 4.4 重构 `stop_recording`：通过 `stop_signal` 通知停止，take `Option` 设为 None
- [x] 4.5 重构 `pause_recording`/`resume_recording`：操作 session 内的 `paused` 字段
- [x] 4.6 重构 `get_recording_status`：从 `Option<RecordingSession>` 读取状态
- [x] 4.7 重构 `capture_loop`：接收 `Arc<AtomicBool>` stop_signal 参数替代读取全局 RECORDING

## 5. editor.ts 模块拆分

- [x] 5.1 创建 `editor-types.ts`，提取 `ToolType`、`StampType`、`Annotation` 等类型定义
- [x] 5.2 创建 `editor-tools.ts`，迁移 `drawAnnotation`、`drawArrow`、`applyMosaic`、`applyBlur`、`drawStamp` 函数
- [x] 5.3 创建 `editor-history.ts`，迁移 undo/redo 逻辑和 annotations/redoStack 管理（导出 addAnnotation、undo、redo、getAnnotations）
- [x] 5.4 创建 `editor-canvas.ts`，迁移 `getCanvasPos`、`redrawAll`、鼠标事件处理器
- [x] 5.5 创建 `editor-output.ts`，迁移 `copyToClipboard`、`saveToFile`、`canvasToBlob`、`pinToScreen`、`performOcr`
- [x] 5.6 重构 `editor.ts` 为入口文件，仅负责 import 子模块、初始化画布、绑定工具栏事件

## 6. 事件命名统一

- [x] 6.1 盘点所有 emit/listen 调用，列出当前使用的事件名
- [x] 6.2 将所有事件名统一为 kebab-case 格式（前后端同步修改）
- [x] 6.3 验证 Rust 后端 `lib.rs` 中 tray 菜单事件名与前端一致

## 7. 验证与测试

- [x] 7.1 构建项目验证编译通过（`cargo build` + `npm run build`）
- [ ] 7.2 手动验证截图→编辑器流程无卡顿
- [ ] 7.3 手动验证录屏→停止→剪辑编辑器流程正常
- [ ] 7.4 验证编辑器所有标注工具（矩形、椭圆、箭头、画笔、文字、马赛克、模糊、印章）功能正常
- [ ] 7.5 验证 undo/redo、复制、保存、钉屏、OCR 功能正常
