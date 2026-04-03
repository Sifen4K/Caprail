## MODIFIED Requirements

### Requirement: 标注工具栏
系统 SHALL 在标注编辑器中显示工具栏，包含所有标注工具、颜色选择器、线宽控制。工具栏位置 SHALL 跟随截图区域，不遮挡截图内容。编辑器代码 SHALL 按职责拆分为独立模块。

#### Scenario: 工具栏显示
- **WHEN** 标注编辑器打开
- **THEN** 工具栏显示在截图区域下方或上方，包含所有标注工具按钮

#### Scenario: 编辑器从 URL 参数加载图像
- **WHEN** 标注编辑器窗口被创建
- **THEN** 编辑器 SHALL 从 URL 查询参数中读取截图文件路径，通过 `convertFileSrc` 转换后加载图像到画布，不使用 IPC 事件传输像素数据

#### Scenario: 编辑器模块化组织
- **WHEN** 编辑器代码被加载
- **THEN** 绘图工具、画布交互、历史管理、输出操作 SHALL 分别位于独立的 TypeScript 模块中
