## Why

截图工具的核心路径存在性能瓶颈：截图捕获后 PNG 编码耗时约 50ms（1920x1080），编辑器每次鼠标移动都全量重绘所有标注，马赛克工具逐像素迭代效率低。这些问题在高分辨率屏幕和大量标注场景下尤为明显，需要优化以提供更流畅的用户体验。

## What Changes

- **临时文件改用 BMP 格式**：内部传输用无压缩 BMP 代替 PNG，消除 ~50ms 编码开销；仅在用户导出保存时才编码为 PNG
- **编辑器画布分层渲染**：引入离屏缓冲画布（buffer canvas），已完成的标注烘焙到缓冲层，鼠标拖拽时只需重绘当前标注，避免全量 putImageData + 遍历所有标注
- **马赛克工具优化**：使用 canvas 缩放技巧替代逐像素迭代——先缩小再放大实现像素化效果，利用浏览器原生渲染加速
- **BGRA→RGBA 转换优化**：用批量内存操作替代 `ImageBuffer::from_fn` 的逐像素构造

## Capabilities

### New Capabilities
- `capture-fast-encoding`: 截图捕获的快速编码流水线——BMP 临时文件 + 延迟 PNG 编码
- `editor-layered-rendering`: 编辑器画布分层渲染系统——缓冲画布 + 增量重绘

### Modified Capabilities
- `screen-capture`: capture.rs 中的图像保存格式从 PNG 改为 BMP，BGRA→RGBA 转换优化
- `annotation-editor`: 编辑器重绘逻辑从全量重绘改为分层增量重绘，马赛克工具算法优化

## Impact

- **后端 (Rust)**：`capture.rs` — `save_capture_as_png` 重构为 `save_capture_as_bmp`，移除 `image` crate 的 PNG 编码依赖（仅用于导出）；BGRA→RGBA 转换改为批量 swap
- **前端 (TypeScript)**：`editor-canvas.ts` — `redrawAll()` 重构为分层渲染；`editor-tools.ts` — `applyMosaic()` 改用 canvas 缩放方案
- **临时文件**：格式从 `.png` 改为 `.bmp`，文件体积增大但 I/O 速度更快（SSD 上 BMP 写入比 PNG 编码快 10x+）
- **用户可见行为不变**：所有导出和剪贴板操作仍输出 PNG
