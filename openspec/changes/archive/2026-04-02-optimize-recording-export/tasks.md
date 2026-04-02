## 1. 原始帧存储格式（raw-frame-storage）

- [x] 1.1 在 `recording.rs` 中定义 RAWV 文件头部结构体（32 字节：magic、version、width、height、fps、frame_count、reserved）
- [x] 1.2 实现 `create_rawv_file(path, width, height, fps)` 函数：创建文件、写入头部、返回 BufWriter
- [x] 1.3 实现 `finalize_rawv_file(path, frame_count)` 函数：打开文件、回写 frame_count 到偏移 20-24
- [x] 1.4 实现 `get_recording_info(path)` Tauri 命令：读取 rawv 头部返回 `{ width, height, fps, frameCount }`
- [x] 1.5 实现 `read_recording_frame(path, frame_index)` Tauri 命令：按索引读取单帧 BGRA 数据，返回 base64 编码字符串

## 2. 录制管道改造（screen-recording）

- [x] 2.1 修改 `RecordingSession` 结构体：移除 `ffmpeg_process` 字段，新增 `rawv_path: String` 字段
- [x] 2.2 修改 `start_recording`：不启动 FFmpeg，改为调用 `create_rawv_file` 创建临时 rawv 文件
- [x] 2.3 修改 `capture_loop`：将帧数据通过 `BufWriter::write_all` 写入 rawv 文件（替代写入 FFmpeg stdin）；移除对 SESSION 锁的帧写入依赖，将 BufWriter 保持在捕获线程局部
- [x] 2.4 修改 `stop_recording`：设置停止信号 → 等待捕获线程 → 调用 `finalize_rawv_file` 回写帧数 → 返回 rawv 文件路径
- [x] 2.5 将帧计数从 `RecordingSession.frame_count` 改为捕获线程局部变量，通过 `Arc<AtomicU64>` 共享给状态查询
- [x] 2.6 修改 `main.ts` 中 `recording-area-selected` 事件处理：outputPath 改为 `.rawv` 后缀，存入临时目录

## 3. Canvas 剪辑播放器（canvas-clip-player）

- [x] 3.1 修改 `clip-editor.html`：将 `<video>` 元素替换为 `<canvas>` 元素
- [x] 3.2 重写 `clip-editor.ts` 初始化逻辑：调用 `get_recording_info` 获取元数据，设置 Canvas 尺寸
- [x] 3.3 实现 `renderFrame(frameIndex)` 函数：调用 `read_recording_frame` → base64 解码 → 构造 ImageData → putImageData 到 Canvas
- [x] 3.4 实现播放引擎：使用 `requestAnimationFrame` 循环，根据帧率和速度计算当前帧索引，调用 `renderFrame`
- [x] 3.5 实现帧预加载缓冲：播放时提前请求后续 5-10 帧，缓存在 Map 中
- [x] 3.6 实现播放/暂停按钮交互：更新播放状态，控制 rAF 循环启停
- [x] 3.7 实现时间轴点击跳转：将点击位置映射为帧索引，调用 `renderFrame`
- [x] 3.8 实现裁剪手柄交互：拖动设置 trimStart/trimEnd 帧索引，播放到 trimEnd 时暂停并回到 trimStart
- [x] 3.9 实现速度选择器：调节帧推进间隔
- [x] 3.10 更新时间显示：基于当前帧索引和帧率计算显示时间

## 4. 导出管道改造（recording-export + async-export-progress）

- [x] 4.1 修改 `export_video` 命令：接受 `AppHandle` 参数，改为异步执行（`tokio::spawn`），立即返回
- [x] 4.2 实现 `export_from_rawv` 核心函数：从 rawv 文件逐帧读取、按裁剪区间筛选、写入 FFmpeg stdin（`-f rawvideo -pixel_format bgra`）
- [x] 4.3 在 `export_from_rawv` 中发送进度事件：每写入一批帧后通过 `app.emit("export-progress", ...)` 发送进度
- [x] 4.4 导出完成/失败时发送 `export-complete` 事件
- [x] 4.5 修改 GIF 导出：两步流程（palettegen + paletteuse）改为从 rawv 文件读取输入
- [x] 4.6 修改 `ExportConfig`：新增 `rawv_path` 字段替代 `input_path`（或复用 input_path 指向 rawv 文件）
- [x] 4.7 在 `lib.rs` 中注册新增的 Tauri 命令（`get_recording_info`、`read_recording_frame`）

## 5. 前端集成与清理

- [x] 5.1 修改 `clip-editor.ts` 导出逻辑：调用导出后监听 `export-progress` 和 `export-complete` 事件更新进度条
- [x] 5.2 修改 `main.ts` 中 `recording-stopped` 事件处理：传递 rawv 路径给剪辑编辑器
- [x] 5.3 实现临时文件清理：导出成功后删除 rawv 文件；编辑器关闭时如未导出则提示用户
- [x] 5.4 移除 `clip-editor.ts` 中对 `readFile` 和 `get_video_duration` 的调用
- [x] 5.5 端到端测试：录制 → 即时打开编辑器 → 播放/跳转/裁剪 → 导出 MP4 和 GIF → 验证输出文件正确
