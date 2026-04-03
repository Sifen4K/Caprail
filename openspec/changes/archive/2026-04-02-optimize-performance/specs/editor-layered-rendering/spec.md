## ADDED Requirements

### Requirement: 离屏缓冲画布
编辑器 SHALL 维护一个与主画布同尺寸的离屏 canvas（bufferCanvas），用于缓存底图 + 已完成标注的合成结果。

#### Scenario: 创建缓冲画布
- **WHEN** 编辑器加载截图并初始化画布
- **THEN** 系统 SHALL 创建与主画布同尺寸的离屏 OffscreenCanvas 或隐藏 canvas 元素

#### Scenario: 缓冲画布尺寸同步
- **WHEN** 主画布尺寸确定（根据截图大小设置）
- **THEN** 缓冲画布的 width 和 height SHALL 与主画布一致

### Requirement: 标注烘焙到缓冲层
每当已完成标注列表（annotations 数组）发生变更时，系统 SHALL 将 baseImageData + 所有已完成标注重新渲染到 bufferCanvas 并缓存。

#### Scenario: 新标注提交时烘焙
- **WHEN** 用户完成一次标注（mouseup 提交标注到 annotations 数组）
- **THEN** 系统 SHALL 将 baseImageData 和全部 annotations 渲染到 bufferCanvas

#### Scenario: 撤销操作时烘焙
- **WHEN** 用户执行撤销（Ctrl+Z）导致 annotations 数组变更
- **THEN** 系统 SHALL 重新烘焙 bufferCanvas

#### Scenario: 重做操作时烘焙
- **WHEN** 用户执行重做（Ctrl+Y）导致 annotations 数组变更
- **THEN** 系统 SHALL 重新烘焙 bufferCanvas

### Requirement: 增量重绘
鼠标拖拽过程中，`redrawAll` SHALL 仅执行 `drawImage(bufferCanvas)` 复制缓冲层到主画布，然后绘制当前正在拖拽的标注（currentAnnotation）。不再遍历 annotations 数组。

#### Scenario: 拖拽时增量重绘
- **WHEN** 用户正在拖拽绘制标注（mousemove 事件触发 redrawAll）
- **THEN** 系统 SHALL 通过 `drawImage(bufferCanvas, 0, 0)` 恢复画面，然后仅绘制 currentAnnotation
- **THEN** 系统 SHALL 不遍历 annotations 数组

#### Scenario: 无标注时的初始状态
- **WHEN** 编辑器刚加载截图，尚无任何标注
- **THEN** bufferCanvas 内容 SHALL 等于 baseImageData，redrawAll 直接绘制 bufferCanvas
