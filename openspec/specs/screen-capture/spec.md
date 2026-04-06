## Purpose

This specification defines the screen capture functionality for Caprail, covering area selection, window targeting, full-screen capture, multi-monitor support with DPI handling, and screenshot output methods.

## Requirements

### Requirement: 区域截图
The overlay hint text displayed during screen capture selection SHALL be loaded from the i18n locale file.

#### Scenario: Overlay hint text loaded from i18n
- **WHEN** the screenshot overlay opens
- **THEN** the area selection hint text is loaded from `screenshot.selectArea` and the ESC cancel hint is loaded from `screenshot.pressEscCancel`

#### Scenario: 确认选区
- **WHEN** 用户松开鼠标完成选区
- **THEN** 系统裁剪选区内像素，关闭覆盖层，打开标注编辑器

### Requirement: 窗口截图
The window hover highlight label SHALL format using the i18n key `screenshot.windowInfo` with substitution values `{title}`, `{width}`, and `{height}`.

#### Scenario: Window info label formatted via i18n
- **WHEN** the user hovers over a window in screenshot mode
- **THEN** the window label is formatted using `screenshot.windowInfo` key, producing text such as "Notepad (800x600)"

#### Scenario: 点击截取窗口
- **WHEN** 用户点击高亮的窗口
- **THEN** 系统截取该窗口区域的像素，打开标注编辑器

### Requirement: 全屏截图
系统 SHALL 支持一键截取当前显示器的全屏画面。

#### Scenario: 全屏截图
- **WHEN** 用户在截图模式下双击或按下指定快捷键
- **THEN** 系统截取鼠标所在显示器的全屏画面，打开标注编辑器

### Requirement: 多显示器支持
系统 SHALL 支持多显示器环境，覆盖层 SHALL 覆盖所有显示器，截图坐标 SHALL 正确处理不同 DPI 缩放。在单显示器高 DPI 环境下，截图范围 SHALL 与用户框选区域完全一致，窗口高亮位置 SHALL 与实际窗口位置对齐。

#### Scenario: 跨显示器截图
- **WHEN** 用户在多显示器环境下拖拽选区跨越两个显示器
- **THEN** 系统正确截取跨显示器区域的像素，无错位或缺失

#### Scenario: 不同 DPI 显示器
- **WHEN** 用户在 150% DPI 的显示器上截图
- **THEN** 截图像素尺寸与实际物理像素一致，不产生模糊或缩放失真

#### Scenario: 单显示器高 DPI 截图范围正确
- **WHEN** 用户在 DPI 缩放为 125%、150% 或 200% 的单显示器上框选区域截图
- **THEN** editor 中显示的截图范围与用户框选的区域完全一致，无偏移或缩放

#### Scenario: 窗口高亮位置对齐
- **WHEN** 用户在截图模式下将鼠标悬停在某个窗口上
- **THEN** 绿色高亮边框精确覆盖该窗口的实际边界，位置和尺寸与实际窗口完全对齐

#### Scenario: 截图不含绿色标线
- **WHEN** 用户完成选区截图后打开编辑器
- **THEN** 截图中不包含任何 overlay 的绿色标线、十字准线或高亮边框

### Requirement: 截图输出
截图标注完成后，系统 SHALL 支持以下输出方式：复制到剪贴板、保存为文件（PNG/JPG）、钉在屏幕上、OCR 提取文字。截图捕获结果 SHALL 以临时 BMP 文件路径形式传递给编辑器，而非临时 PNG 文件。BMP 格式用于内部传输以消除 PNG 编码开销；用户导出仍为 PNG 格式。

#### Scenario: 复制到剪贴板
- **WHEN** 用户在标注编辑器中点击"复制"或按下 Ctrl+C
- **THEN** 标注后的截图被复制到系统剪贴板

#### Scenario: 保存为文件
- **WHEN** 用户在标注编辑器中点击"保存"或按下 Ctrl+S
- **THEN** 系统弹出保存对话框或保存到默认路径，支持 PNG/JPG 格式

#### Scenario: 截图数据通过 BMP 文件传递
- **WHEN** 截图捕获完成
- **THEN** 系统 SHALL 将截图保存为临时 BMP 文件，并将文件路径传递给编辑器窗口
