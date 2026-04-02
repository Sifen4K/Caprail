## MODIFIED Requirements

### Requirement: MP4 导出
系统 SHALL 从 `.rawv` 原始帧文件读取帧数据，通过管道传给 FFmpeg 编码为 H.264 MP4 文件。导出 SHALL 异步执行。

#### Scenario: 导出 MP4
- **WHEN** 用户在剪辑窗口中点击"导出 MP4"
- **THEN** 系统 SHALL 从 rawv 文件中按裁剪区间读取帧，以 `-f rawvideo -pixel_format bgra` 格式写入 FFmpeg stdin，编码为 H.264 MP4

#### Scenario: 带速度调节的导出
- **WHEN** 用户设置了非 1.0x 的播放速度
- **THEN** 系统 SHALL 在 FFmpeg 参数中添加 `setpts` 滤镜调整播放速度

### Requirement: GIF 导出
系统 SHALL 从 `.rawv` 原始帧文件读取帧数据，通过 FFmpeg 两步流程（palettegen + paletteuse）转换为高质量 GIF。

#### Scenario: 导出 GIF
- **WHEN** 用户在剪辑窗口中点击"导出 GIF"
- **THEN** 系统 SHALL 从 rawv 文件读取裁剪区间内的帧，先生成调色板，再使用调色板生成 GIF

### Requirement: GIF 质量控制
GIF 导出 SHALL 支持配置帧率和最大宽度以控制文件大小。

#### Scenario: 调整 GIF 参数
- **WHEN** 用户在 GIF 导出选项中设置帧率为 15fps、最大宽度为 640px
- **THEN** 导出的 GIF 按指定参数生成，文件大小明显小于全分辨率版本

### Requirement: 导出进度显示
导出过程 SHALL 通过 Tauri 事件发送实时进度，前端显示进度条。

#### Scenario: 显示导出进度
- **WHEN** 导出正在进行
- **THEN** 系统 SHALL 每发送一批帧后发送 `export-progress` 事件，前端据此更新进度条

#### Scenario: 取消导出
- **WHEN** 用户在导出过程中点击"取消"
- **THEN** 系统 SHALL 终止 FFmpeg 进程，清理临时文件

### Requirement: 临时文件清理
导出完成后系统 SHALL 自动清理 `.rawv` 临时文件。

#### Scenario: 导出后清理
- **WHEN** 导出成功完成
- **THEN** 系统 SHALL 删除对应的 `.rawv` 原始帧文件

#### Scenario: 编辑器关闭时清理
- **WHEN** 用户关闭剪辑编辑器且未导出
- **THEN** 系统 SHALL 提示用户是否删除临时文件
