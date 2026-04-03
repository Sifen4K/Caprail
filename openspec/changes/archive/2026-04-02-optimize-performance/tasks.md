## 1. 截图捕获 BMP 优化（Rust 后端）

- [x] 1.1 在 `capture.rs` 中实现 `save_capture_as_bmp` 函数：手写 54 字节 BMP 头（BITMAPFILEHEADER + BITMAPINFOHEADER），BGRA 像素数据直接写入文件体，无需 BGRA→RGBA 转换
- [x] 1.2 将 `capture_region`、`capture_screen`、`capture_window` 中的 `save_capture_as_png` 调用替换为 `save_capture_as_bmp`
- [x] 1.3 更新 `save_pin_image` 如果其依赖 PNG 格式则保持不变（pin 图像来自前端 canvas 导出，仍为 PNG）
- [x] 1.4 删除不再使用的 `save_capture_as_png` 函数（如果仅用于临时文件）
- [x] 1.5 更新 `cleanup_temp_file` 确保可清理 `.bmp` 文件（已有的路径检查逻辑不限制后缀，应无需修改）

## 2. 编辑器分层渲染（TypeScript 前端）

- [x] 2.1 在 `editor.ts` 初始化时创建离屏缓冲 canvas（bufferCanvas），尺寸与主画布一致
- [x] 2.2 在 `editor-types.ts` 的 `EditorState` 中添加 `bufferCanvas` 和 `bufferCtx` 字段
- [x] 2.3 实现 `bakeBuffer(state)` 函数：将 baseImageData + 所有 annotations 渲染到 bufferCanvas
- [x] 2.4 重构 `redrawAll(state)`：改为 `drawImage(bufferCanvas)` + 仅绘制 `currentAnnotation`
- [x] 2.5 在标注提交（mouseup）、撤销、重做时调用 `bakeBuffer` 更新缓冲层
- [x] 2.6 在初始图像加载完成后调用 `bakeBuffer` 初始化缓冲层

## 3. 马赛克工具优化（TypeScript 前端）

- [x] 3.1 重写 `editor-tools.ts` 中的 `applyMosaic` 函数：使用 canvas `drawImage` 缩放技巧（先缩小再放大）替代逐像素迭代
- [x] 3.2 确保马赛克效果在分层渲染下正确工作：烘焙时从 baseImageData 读取源像素，而非从主画布

## 4. 验证与清理

- [x] 4.1 验证 BMP 临时文件可通过 `convertFileSrc()` 在 WebView2 中正确加载
- [x] 4.2 验证编辑器在 10+ 标注下拖拽流畅度明显改善
- [x] 4.3 验证导出功能（复制、保存、钉图、OCR）在 BMP 输入下仍正常工作
- [x] 4.4 清理 `capture.rs` 中不再需要的 `image` crate PNG 编码相关 import（如 `ImageBuffer`, `Rgba`）
