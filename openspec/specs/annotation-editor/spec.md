## Purpose

This specification defines the annotation editor for Caprail, providing tools to annotate screenshots with shapes, text, blur, and stamps. Requirements cover the annotation toolbar, drawing tools, undo/redo, layered canvas rendering, and module organization.

## Requirements

### Requirement: 矩形标注
系统 SHALL 支持在截图上绘制矩形标注，可自定义边框颜色、线宽。

#### Scenario: 绘制矩形
- **WHEN** 用户选择矩形工具并在画布上拖拽
- **THEN** 系统在截图上绘制对应大小的矩形边框

#### Scenario: 自定义矩形样式
- **WHEN** 用户修改颜色选择器和线宽滑块
- **THEN** 后续绘制的矩形使用新的颜色和线宽

### Requirement: 圆形/椭圆标注
系统 SHALL 支持在截图上绘制圆形或椭圆标注。

#### Scenario: 绘制椭圆
- **WHEN** 用户选择椭圆工具并在画布上拖拽
- **THEN** 系统在截图上绘制对应大小的椭圆边框

### Requirement: 箭头标注
系统 SHALL 支持在截图上绘制箭头标注，箭头指向拖拽终点方向。

#### Scenario: 绘制箭头
- **WHEN** 用户选择箭头工具并在画布上从 A 点拖拽到 B 点
- **THEN** 系统绘制从 A 指向 B 的箭头

### Requirement: 线条标注
系统 SHALL 支持在截图上绘制自由线条（画笔）。

#### Scenario: 自由绘制
- **WHEN** 用户选择画笔工具并在画布上拖拽
- **THEN** 系统沿鼠标轨迹绘制平滑线条

### Requirement: 文字标注
系统 SHALL 支持在截图上添加文字标注，可自定义字体大小和颜色。

#### Scenario: 添加文字
- **WHEN** 用户选择文字工具并点击画布某位置
- **THEN** 系统在该位置显示文字输入框，用户输入文字后渲染到画布上

### Requirement: 马赛克/模糊
系统 SHALL 支持对截图的指定区域施加马赛克或高斯模糊效果，用于遮挡敏感信息。马赛克效果 SHALL 使用 canvas 缩放技巧（先缩小再放大）实现像素化，替代逐像素迭代计算。

#### Scenario: 涂抹马赛克
- **WHEN** 用户选择马赛克工具并在画布上拖拽选择区域
- **THEN** 系统 SHALL 使用 canvas `drawImage` 缩放方式对选中区域施加马赛克像素化效果，不使用 JS 逐像素迭代

#### Scenario: 涂抹模糊
- **WHEN** 用户选择模糊工具并在画布上拖拽选择区域
- **THEN** 系统对选中区域施加高斯模糊效果

### Requirement: 记号/印章标注
系统 SHALL 支持在截图上放置预设的记号标记（如数字序号、对勾、叉号、星号等）。

#### Scenario: 放置序号标记
- **WHEN** 用户选择序号工具并依次点击画布上多个位置
- **THEN** 系统在每个点击位置依次放置 ①②③... 等序号标记

#### Scenario: 放置图标标记
- **WHEN** 用户选择图标标记工具（对勾/叉号/星号等）并点击画布
- **THEN** 系统在点击位置放置对应的图标标记

### Requirement: 标注撤销/重做
All action button `title` attributes in the annotation editor (undo, redo, copy, save, pin, ocr) SHALL be loaded from the i18n locale file under the `editor.action.*` key scope.

#### Scenario: Action button tooltips loaded from i18n
- **WHEN** the annotation editor opens
- **THEN** the undo, redo, copy, save, pin, and ocr button `title` attributes are loaded from `editor.action.undo`, `editor.action.redo`, `editor.action.copy`, `editor.action.save`, `editor.action.pin`, and `editor.action.ocr` respectively

### Requirement: 标注工具栏
All tool button `title` attributes in the annotation editor toolbar SHALL be loaded from the i18n locale file under the `editor.tool.*` key scope.

#### Scenario: Toolbar tooltips loaded from i18n
- **WHEN** the annotation editor opens
- **THEN** all tool button `title` attributes (rect, ellipse, arrow, pen, text, mosaic, blur, stamp) are loaded from i18n locale keys `editor.tool.*`

#### Scenario: 编辑器从 URL 参数加载图像
- **WHEN** 标注编辑器窗口被创建
- **THEN** 编辑器 SHALL 从 URL 查询参数中读取截图文件路径，通过 `convertFileSrc` 转换后加载图像到画布，不使用 IPC 事件传输像素数据

#### Scenario: 编辑器模块化组织
- **WHEN** 编辑器代码被加载
- **THEN** 绘图工具、画布交互、历史管理、输出操作 SHALL 分别位于独立的 TypeScript 模块中

#### Scenario: 编辑器使用分层渲染
- **WHEN** 编辑器初始化画布
- **THEN** 系统 SHALL 创建离屏缓冲画布用于缓存已完成标注，拖拽时仅增量重绘当前标注

#### Scenario: 工具栏窄窗口换行
- **WHEN** 编辑器窗口宽度小于工具栏最小单行宽度
- **THEN** 工具栏 SHALL 自动换行显示，确保所有工具按钮可访问
