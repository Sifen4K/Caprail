## MODIFIED Requirements

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
