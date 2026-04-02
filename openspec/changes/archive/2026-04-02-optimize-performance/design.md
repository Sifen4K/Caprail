## Context

当前截图工具的性能瓶颈分布在捕获和编辑两个阶段：

**捕获阶段**：`capture.rs` 通过 GDI BitBlt 捕获屏幕像素（~10-30ms），然后调用 `save_capture_as_png` 将 BGRA 数据编码为 PNG 文件（~50ms for 1920x1080）。PNG 编码占据了捕获延迟的 60%+，但这些临时文件仅用于编辑器加载，之后即删除，无需压缩。另外 `ImageBuffer::from_fn` 逐像素构造图像做 BGRA→RGBA 转换，有较大优化空间。

**编辑阶段**：`editor-canvas.ts` 的 `redrawAll()` 在每次鼠标移动时执行 `putImageData(baseImageData)` 恢复原图 + 遍历所有已完成标注重绘。对于 4K 图像 + 20+ 标注，每帧重绘代价很高。`editor-tools.ts` 的 `applyMosaic` 在 JS 中逐像素迭代计算平均色值，对大区域尤其慢。

## Goals / Non-Goals

**Goals:**
- 将截图捕获到编辑器打开的延迟降低 40%+（消除 PNG 编码开销）
- 编辑器在 20+ 标注场景下保持 60fps 流畅拖拽（分层渲染）
- 马赛克工具在大区域上响应时间降低 5x+（canvas 原生操作替代 JS 像素迭代）

**Non-Goals:**
- 不迁移到 DXGI Desktop Duplication API（GDI 对静态截图足够，复杂度不值得）
- 不引入 WebGL/OffscreenCanvas（浏览器兼容性和代码复杂度）
- 不优化录屏流水线（本次仅关注截图和编辑器）
- 不改变用户可见行为或导出格式

## Decisions

### Decision 1: 临时文件使用 BMP 格式

**选择**：内部传输使用无压缩 BMP，仅在用户导出时编码 PNG。

**替代方案**：
- 保持 PNG 但降低压缩级别 → 仍有编码开销，只是减少
- 使用共享内存传输原始像素 → Tauri WebView 不直接支持，需要复杂的 IPC 机制
- 使用 `image` crate 的 BMP encoder → 引入不必要的依赖

**方案**：直接手写 BMP 文件头（54 bytes header），将 BGRA 像素数据直接写入文件体。BMP 格式天然支持 BGRA 像素序（BI_BITFIELDS），无需 BGRA→RGBA 转换。文件变大（1920x1080: ~8MB vs PNG ~2MB），但在 SSD 上顺序写入 8MB 仍快于 CPU 密集的 PNG 压缩。

**理由**：BMP 写入仅为 memcpy + 磁盘 I/O，消除了 PNG 的 zlib 压缩和滤波器计算。临时文件生命周期短（用完即删），不需要压缩。

### Decision 2: 编辑器分层渲染（Buffer Canvas）

**选择**：引入离屏 canvas 作为已完成标注的缓冲层。

**架构**：
```
baseImageData (原图)
    ↓ putImageData
bufferCanvas (离屏) ← 烘焙已完成标注
    ↓ drawImage
mainCanvas (可见) ← 仅绘制当前拖拽中的标注
```

**触发烘焙时机**：每当 `annotations` 数组变更（mouseup 提交标注、undo/redo），将 `baseImageData` + 所有已完成标注渲染到 `bufferCanvas`，然后缓存。拖拽过程中 `redrawAll` 只需 `drawImage(bufferCanvas)` + 绘制 `currentAnnotation`。

**替代方案**：
- Dirty rectangle 局部重绘 → 实现复杂，且标注可能重叠，脏区计算不可靠
- 多层 canvas 叠加（CSS positioned） → 马赛克/模糊需要读取底层像素，多层方案下跨层读取复杂

**理由**：bufferCanvas 方案实现简单，将 O(n) 标注重绘降为 O(1) drawImage，对拖拽帧率提升最直接。

### Decision 3: 马赛克使用 Canvas 缩放技巧

**选择**：用 `drawImage` 先缩小到 blockSize 分辨率再放大回来，利用浏览器原生像素化。

**方案**：
```typescript
// 替代逐像素迭代
ctx.imageSmoothingEnabled = false;
ctx.drawImage(canvas, sx, sy, sw, sh, sx, sy, sw/blockSize, sh/blockSize); // 缩小
ctx.drawImage(canvas, sx, sy, sw/blockSize, sh/blockSize, sx, sy, sw, sh); // 放大
```

**替代方案**：
- WebGL shader → 性能最好但引入 WebGL 上下文管理，过重
- 使用 `createImageBitmap` + `ImageBitmapRenderingContext` → 兼容性不确定

**理由**：canvas 原生操作利用浏览器 GPU 加速路径，无需 JS 逐像素遍历，代码量减少且速度提升数量级。

## Risks / Trade-offs

- **BMP 文件体积大** → 4K 截图约 33MB BMP vs ~4MB PNG。磁盘空间临时占用增大，但 SSD 上写入仍优于 PNG 编码。Mitigation: 临时文件在编辑器关闭时立即清理。
- **Buffer canvas 内存翻倍** → 每个编辑器多一个离屏 canvas（1920x1080 约 8MB RGBA）。Mitigation: 相比现代系统 16GB+ 内存可忽略不计；且多编辑器实例场景本身少见。
- **马赛克 canvas 缩放精度** → 缩放方式的马赛克块大小不完全均匀（边缘像素），但视觉效果几乎等价。Mitigation: 视觉差异极小，用户难以察觉。
- **BMP 在编辑器中通过 convertFileSrc 加载** → 需确认 WebView2 的 `<img>` 标签支持 BMP 格式。已知 Chromium 内核支持 BMP 解码，WebView2 基于 Chromium，应无问题。
