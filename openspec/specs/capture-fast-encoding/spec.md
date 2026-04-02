## ADDED Requirements

### Requirement: BMP 格式临时文件保存
截图捕获后，系统 SHALL 将原始像素数据保存为无压缩 BMP 格式的临时文件，而非 PNG 格式。BMP 文件 SHALL 使用 BITMAPFILEHEADER + BITMAPINFOHEADER（54 字节头），像素数据以 BGRA 格式直接写入文件体，无需 BGRA→RGBA 转换。

#### Scenario: 截图保存为 BMP 临时文件
- **WHEN** 系统完成 GDI BitBlt 捕获并获得 BGRA 像素数据
- **THEN** 系统 SHALL 将数据保存为 `.bmp` 文件到临时目录 `%TEMP%/screenshot-tool-captures/`，文件名格式为 `capture-{timestamp}.bmp`

#### Scenario: BMP 文件无需像素格式转换
- **WHEN** BGRA 像素数据需要写入临时文件
- **THEN** 系统 SHALL 直接写入 BGRA 数据到 BMP 文件体，不执行 BGRA→RGBA 通道交换

#### Scenario: BMP 文件可被编辑器加载
- **WHEN** 编辑器通过 `convertFileSrc()` 加载 BMP 临时文件
- **THEN** WebView2 的 `<img>` 标签 SHALL 正确解码并显示 BMP 图像

### Requirement: CaptureResult 返回 BMP 路径
`capture_region`、`capture_screen`、`capture_window` 命令 SHALL 返回 BMP 文件路径。返回的 `CaptureResult` 结构不变（path, width, height），仅 path 后缀从 `.png` 变为 `.bmp`。

#### Scenario: capture_region 返回 BMP 路径
- **WHEN** 调用 `capture_region(x, y, width, height)`
- **THEN** 返回的 `CaptureResult.path` SHALL 以 `.bmp` 结尾

#### Scenario: capture_screen 返回 BMP 路径
- **WHEN** 调用 `capture_screen(monitor_index)`
- **THEN** 返回的 `CaptureResult.path` SHALL 以 `.bmp` 结尾

### Requirement: 导出时使用 PNG 编码
用户通过编辑器导出截图（复制到剪贴板、保存文件）时，系统 SHALL 将画布内容编码为 PNG 格式。BMP 格式仅用于内部临时传输。

#### Scenario: 导出不受内部格式影响
- **WHEN** 用户在编辑器中点击"保存"或"复制"
- **THEN** 导出的图像 SHALL 为 PNG 格式，与内部使用 BMP 无关
