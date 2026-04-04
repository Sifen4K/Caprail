## 1. 工具栏自动换行

- [x] 1.1 修改 editor.css：#toolbar 添加 `flex-wrap: wrap` 和 `min-height: 44px`
- [x] 1.2 修改 editor.css：调整 .tool-group 间距确保换行后视觉清晰
- [x] 1.3 测试窄窗口下工具栏换行效果

## 2. 缩放状态管理

- [x] 2.1 在 editor-types.ts 添加缩放相关状态字段（zoom, panX, panY, isPanning）
- [x] 2.2 在 editor.ts 初始化缩放状态（默认 100%）
- [x] 2.3 创建 editor-zoom.ts 模块，包含缩放逻辑函数

## 3. 鼠标滚轮缩放

- [x] 3.1 在 editor-zoom.ts 实现 `handleWheel` 函数：计算缩放比例和偏移
- [x] 3.2 在 editor.ts 为 canvas-wrapper 添加 wheel 事件监听
- [x] 3.3 实现 CSS transform 缩放：修改 canvas-wrapper 的 transform 属性
- [x] 3.4 测试以鼠标位置为中心的缩放效果

## 4. 缩放后平移浏览

- [x] 4.1 在 editor-zoom.ts 实现平移逻辑：处理 pointer events
- [x] 4.2 添加空格键切换浏览模式的功能
- [x] 4.3 实现平移边界限制：防止超出画布范围
- [x] 4.4 测试缩放后拖拽平移效果

## 5. 坐标转换适配

- [x] 5.1 修改 editor-canvas.ts 的 `getCanvasPos` 函数：考虑缩放因子
- [x] 5.2 修改文字输入 overlay 定位逻辑：使用 viewport 坐标
- [x] 5.3 测试缩放状态下绘制各种标注（矩形、箭头、画笔、文字等）

## 6. OCR 面板位置适配

- [x] 6.1 修改 editor.css：OCR 面板 top 值动态获取工具栏高度
- [x] 6.2 测试工具栏换行后 OCR 面板位置正确

## 7. 最终测试

- [x] 7.1 测试缩放范围限制（10% - 500%）
- [x] 7.2 测试极端 DPI 和缩放组合
- [x] 7.3 测试窄窗口下所有工具按钮可访问