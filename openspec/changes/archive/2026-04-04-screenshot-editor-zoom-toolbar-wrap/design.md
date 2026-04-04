## Context

截图编辑器（editor.html/editor.ts）当前不支持画布缩放，用户无法放大查看细节。工具栏使用固定 `display: flex` 布局，窗口宽度不足时工具被截断无法访问。

画布渲染使用分层架构（bufferCanvas + mainCanvas），标注操作通过 `EditorState` 状态管理。坐标转换已处理 DPI 缩放（`getCanvasPos`）。

## Goals / Non-Goals

**Goals:**
- 实现鼠标滚轮缩放，以鼠标位置为中心缩放
- 缩放后支持拖拽平移浏览大图
- 工具栏自动换行，确保所有工具在小窗口下可访问
- 保持现有标注功能的坐标正确性

**Non-Goals:**
- 不改变标注数据结构或存储格式
- 不实现缩放状态的持久化（跨会话保存）
- 不支持触屏手势缩放

## Decisions

### 1. 缩放实现方式：CSS transform vs Canvas 重绘

**决策：使用 CSS transform 缩放画布容器**

- **理由**：
  - CSS transform 性能更好（GPU 加速）
  - 不需要重绘 canvas 内容
  - 标注坐标保持原始物理像素，不受缩放影响
  
- **坐标转换**：`getCanvasPos` 需要考虑缩放因子，将逻辑坐标转为物理像素坐标

- **备选方案**：Canvas 重绘缩放——每次缩放重绘整个画布，性能差，坐标需要额外处理

### 2. 工具栏换行方式：flex-wrap

**决策：添加 `flex-wrap: wrap` 和适当间距**

- **理由**：
  - 最小改动，一行 CSS 即可
  - flex 容器自动处理换行布局
  - 工具组（tool-group）保持相对位置

- **细节**：
  - 工具栏高度需动态适应（可能变为两行）
  - 添加 `min-height` 防止挤压
  - 调整 `tool-group` 间距确保换行后视觉清晰

### 3. 平移拖拽实现

**决策：使用 pointer events 在 wrapper 上监听**

- **理由**：
  - wrapper 作为容器更易控制
  - 与现有 canvas mousedown/mouseup 不冲突
  - 需要区分标注绘制模式（工具激活）和浏览模式（无工具或按住特定键）

- **触发条件**：
  - 缩放比例 > 100% 时启用拖拽
  - 或按住空格键进入浏览模式

## Risks / Trade-offs

1. **坐标转换精度** → 使用浮点运算，确保精度；测试极端缩放比例
2. **文字输入框定位** → 缩放后需要重新计算 overlay 位置（使用 viewport 坐标而非 canvas 坐标）
3. **工具栏换行后 OCR 面板位置** → OCR 面板 top 值需动态获取工具栏实际高度