## Why

录屏结束后，剪辑编辑器加载视频异常缓慢。根本原因是存在一次多余的编码-解码循环：

1. **录制中**：原始 BGRA 帧通过管道传给 FFmpeg，实时编码为 H.264 MP4
2. **停止录制**：`process.wait()` 阻塞等待 FFmpeg 刷新缓冲区并写入 moov atom 完成 MP4 封装
3. **编辑器加载**：`readFile()` 将整个 MP4 读入 JS 内存，创建 Blob URL，浏览器 `<video>` 再将 H.264 解码回帧
4. **导出**：FFmpeg 再次解码该 MP4，应用滤镜后重新编码为最终格式

这是 **编码 → 解码 → 再编码**，中间浪费了一整个编码/解码循环。通过在录制时直接写入原始帧到中间文件、将编码推迟到导出时执行，可以完全消除这个多余的循环。

## What Changes

- **录制时用原始帧文件替代 FFmpeg 管道**：录制过程中将原始 BGRA 帧直接追加写入临时二进制文件（带简单头部：宽、高、帧率）。录制期间完全不启动 FFmpeg 进程。
- **即时停止**：停止录制只需关闭文件句柄，无需等待 FFmpeg 完成编码。
- **基于 Canvas 的剪辑播放器**：用 Canvas 播放器替代 `<video>` 元素，通过 Tauri 命令直接从原始帧文件中按需读取帧。随机访问极为简单（帧 N 位于字节偏移 `header + N * frame_size`）。
- **仅在导出时编码**：用户点击导出时，才将原始帧通过管道传给 FFmpeg 进行 H.264/GIF 编码，同时应用裁剪和速度滤镜。
- **异步导出与进度报告**：在后台线程运行 FFmpeg 导出，通过 Tauri 事件向前端发送进度。

## Capabilities

### New Capabilities
- `raw-frame-storage`：录制原始 BGRA 帧的中间二进制格式，带元数据头部，支持随机访问帧读取
- `canvas-clip-player`：剪辑编辑器的 Canvas 视频播放器，通过 Tauri 命令读取原始帧，替代 `<video>` 元素
- `async-export-progress`：非阻塞的视频/GIF 导出，带实时进度事件

### Modified Capabilities
- `screen-recording`：从录制管道中移除 FFmpeg；改为将原始帧写入中间文件
- `recording-export`：以原始帧文件为输入；仅在导出时才将帧通过管道传给 FFmpeg 编码

## Impact

- **代码**：`src-tauri/src/recording.rs`（移除 FFmpeg，写入原始帧）、`src-tauri/src/export.rs`（读取原始帧，传给 FFmpeg，异步带进度）、`src/scripts/clip-editor.ts`（Canvas 播放器替代 `<video>`）
- **API**：新增命令 `read_recording_frame`、`get_recording_info`；修改 `export_video` 接受原始帧文件并发送进度事件
- **临时存储**：原始帧文件比 MP4 大得多（1080p 下约 8MB/帧）。30 秒 30fps 录制约 7GB。文件为临时文件，导出后清理。
- **依赖**：无需新增 crate 依赖
