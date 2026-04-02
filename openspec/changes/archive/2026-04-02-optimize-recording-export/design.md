## Context

当前录屏工具的数据流为：原始 BGRA 帧 → FFmpeg 实时编码 H.264 MP4 → 编辑器 `readFile()` 全量读入 JS → 浏览器 `<video>` 解码 → 用户编辑/裁剪 → 导出时 FFmpeg 再次解码+重编码。

核心瓶颈在于停止录制时等待 FFmpeg 完成编码（`process.wait()`），以及编辑器将整个 MP4 文件读入内存再由浏览器解码。这产生了一次完全多余的编码/解码循环。

相关代码：
- `src-tauri/src/recording.rs`：录制管道，GDI 截屏 + FFmpeg 管道
- `src-tauri/src/export.rs`：导出管道，同步阻塞 FFmpeg
- `src/scripts/clip-editor.ts`：剪辑编辑器，`<video>` + `readFile()`
- `src/scripts/main.ts`：录制停止事件监听，打开剪辑编辑器窗口

## Goals / Non-Goals

**Goals:**
- 录制停止后编辑器即时可用（< 100ms）
- 消除录制过程中的 FFmpeg 编码开销
- 编辑器支持帧级精确跳转和播放
- 导出时提供实时进度反馈
- 导出支持异步执行，不阻塞 UI

**Non-Goals:**
- 不改变截图（screenshot）功能的任何行为
- 不改变录制区域选择的交互方式
- 不引入视频压缩中间格式（如 FFV1、HuffYUV）——保持原始帧以获得最大简洁性和随机访问速度
- 不优化 GDI 截屏本身的性能（如切换到 DXGI）

## Decisions

### 决策 1：中间存储格式——原始 BGRA 帧二进制文件

**选择**：自定义二进制格式，固定 32 字节头部 + 原始 BGRA 帧序列追加写入。

头部结构：
```
[0..4]   magic: b"RAWV" (4 bytes)
[4..8]   version: u32 = 1
[8..12]  width: u32
[12..16] height: u32
[16..20] fps: u32
[20..24] frame_count: u32 (录制结束时回写)
[24..32] reserved: 8 bytes
```

帧数据：每帧 `width * height * 4` 字节，紧密排列，无帧间分隔符。

**为什么不用现有容器格式（AVI rawvideo 等）**：
- 自定义格式可以精确控制随机访问，无需解析容器
- 帧 N 的偏移量 = `32 + N * frame_size`，O(1) 定位
- 无需引入额外的容器解析库

**为什么不压缩**：
- LZ4 等压缩会使帧大小可变，破坏 O(1) 随机访问
- 录制文件是临时的，导出后立即删除
- 现代 SSD 写入速度足够支撑 1080p@30fps（~237MB/s）

**文件大小预估**：
| 分辨率 | 帧率 | 每秒大小 | 30秒 | 60秒 |
|--------|------|---------|------|------|
| 1920x1080 | 30fps | 237MB | 7.1GB | 14.2GB |
| 1280x720 | 30fps | 105MB | 3.2GB | 6.3GB |
| 2560x1440 | 30fps | 422MB | 12.7GB | 25.3GB |

### 决策 2：录制管道——直接写文件，不启动 FFmpeg

**选择**：录制时完全移除 FFmpeg 进程。捕获线程将每帧直接追加写入二进制文件。

**流程变更**：
```
旧: capture_loop → frame_data → FFmpeg stdin pipe → H.264 encode → .mp4 file
新: capture_loop → frame_data → BufWriter::write_all → .rawv temp file
```

- 停止录制时只需：设置停止信号 → 等待捕获线程结束 → 回写 `frame_count` 到头部 → 关闭文件
- 无需等待 FFmpeg 进程退出，停止操作接近即时

**为什么不保留 FFmpeg 改用更快的编码**：用户的核心需求是消除编码/解码循环。即使用 `ultrafast` 编码，停止时仍有 FFmpeg 进程退出延迟，且编辑器仍需解码。

### 决策 3：编辑器播放器——Canvas + Tauri 命令读帧

**选择**：用 Canvas 2D 播放器替代 `<video>` 元素。

**架构**：
- Rust 端新增 `read_recording_frame(path, frame_index)` 命令，返回 BGRA 帧的 base64 编码
- Rust 端新增 `get_recording_info(path)` 命令，返回宽高、帧率、总帧数
- 前端通过 `requestAnimationFrame` 循环驱动播放
- 每帧通过 Tauri invoke 获取 → 解码 base64 → 写入 `ImageData` → `putImageData` 到 Canvas

**为什么用 base64 而不是二进制传输**：Tauri 的 invoke 机制对二进制数据的支持需要额外处理，base64 虽有 33% 膨胀但实现简单可靠。后续可优化为直接传输 `Vec<u8>`。

**为什么不用 `<video>` + 转码中间格式**：这又回到了编码/解码的老路。Canvas 方案虽然需要更多代码，但完全消除了视频编解码。

### 决策 4：导出管道——异步 + 进度事件

**选择**：在 Tokio 线程中运行 FFmpeg 导出，通过 Tauri 事件通道发送进度。

**流程**：
1. 前端调用 `export_video` → 立即返回
2. Rust 端在 `tokio::spawn` 中：
   - 启动 FFmpeg 进程（`-f rawvideo -pixel_format bgra` 作为输入）
   - 从 `.rawv` 文件逐帧读取，写入 FFmpeg stdin
   - 根据已发送帧数 / 总帧数计算进度
   - 通过 `app.emit("export-progress", progress)` 发送进度
   - 完成后发送 `app.emit("export-complete", result)`
3. 前端监听事件更新进度条

**GIF 导出优化**：保持现有的两步调色板方案（palettegen + paletteuse），但改为从 rawv 文件读取输入。

## Risks / Trade-offs

**[大文件占用磁盘空间]** → 在录制开始前检查可用空间（至少需要 `预估时长 * 每秒大小` 的空间）。录制界面显示实时文件大小。导出完成后自动删除 rawv 文件。

**[SSD 写入带宽瓶颈]** → 1080p@30fps 需要 ~237MB/s 持续写入。大多数现代 NVMe SSD 可以轻松应对。对于 HDD 或低速存储，可能需要降低帧率或分辨率。在后续迭代中可考虑引入 LZ4 帧压缩（使用固定压缩块大小保持随机访问）。

**[Canvas 播放性能]** → 每帧通过 Tauri invoke 传输有延迟。可通过预加载缓冲区（提前读取后续 N 帧）缓解。30fps 下每帧预算 33ms，base64 解码 + putImageData 在现代硬件上可在 5-10ms 内完成。

**[base64 传输开销]** → 1080p 帧 base64 编码后约 11MB。考虑批量传输（一次请求多帧）或后续切换到 Tauri 的二进制传输通道来优化。
