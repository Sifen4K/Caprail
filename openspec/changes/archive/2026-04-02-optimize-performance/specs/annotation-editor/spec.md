## MODIFIED Requirements

### Requirement: 马赛克/模糊
系统 SHALL 支持对截图的指定区域施加马赛克或高斯模糊效果，用于遮挡敏感信息。马赛克效果 SHALL 使用 canvas 缩放技巧（先缩小再放大）实现像素化，替代逐像素迭代计算。

#### Scenario: 涂抹马赛克
- **WHEN** 用户选择马赛克工具并在画布上拖拽选择区域
- **THEN** 系统 SHALL 使用 canvas `drawImage` 缩放方式对选中区域施加马赛克像素化效果，不使用 JS 逐像素迭代

#### Scenario: 涂抹模糊
- **WHEN** 用户选择模糊工具并在画布上拖拽选择区域
- **THEN** 系统对选中区域施加高斯模糊效果

### Requirement: 标注工具栏
系统 SHALL 在标注编辑器中显示工具栏，包含所有标注工具、颜色选择器、线宽控制。工具栏位置 SHALL 跟随截图区域，不遮挡截图内容。编辑器代码 SHALL 按职责拆分为独立模块。编辑器 SHALL 使用分层渲染架构（bufferCanvas + mainCanvas）提升重绘性能。

#### Scenario: 工具栏显示
- **WHEN** 标注编辑器打开
- **THEN** 工具栏显示在截图区域下方或上方，包含所有标注工具按钮

#### Scenario: 编辑器从 URL 参数加载图像
- **WHEN** 标注编辑器窗口被创建
- **THEN** 编辑器 SHALL 从 URL 查询参数中读取截图文件路径，通过 `convertFileSrc` 转换后加载图像到画布，不使用 IPC 事件传输像素数据

#### Scenario: 编辑器模块化组织
- **WHEN** 编辑器代码被加载
- **THEN** 绘图工具、画布交互、历史管理、输出操作 SHALL 分别位于独立的 TypeScript 模块中

#### Scenario: 编辑器使用分层渲染
- **WHEN** 编辑器初始化画布
- **THEN** 系统 SHALL 创建离屏缓冲画布用于缓存已完成标注，拖拽时仅增量重绘当前标注
