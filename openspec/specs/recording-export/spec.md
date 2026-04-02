## ADDED Requirements

### Requirement: MP4 导出
系统 SHALL 支持将录屏导出为 MP4 格式（H.264 编码）。

#### Scenario: 导出 MP4
- **WHEN** 用户在剪辑窗口中点击"导出 MP4"
- **THEN** 系统使用 ffmpeg 将录屏编码为 H.264 MP4 文件，显示导出进度

### Requirement: GIF 导出
系统 SHALL 支持将录屏导出为 GIF 格式。

#### Scenario: 导出 GIF
- **WHEN** 用户在剪辑窗口中点击"导出 GIF"
- **THEN** 系统使用 ffmpeg 将录屏转换为 GIF 文件（使用调色板优化），显示导出进度

### Requirement: GIF 质量控制
GIF 导出 SHALL 支持配置帧率和最大宽度以控制文件大小。

#### Scenario: 调整 GIF 参数
- **WHEN** 用户在 GIF 导出选项中设置帧率为 15fps、最大宽度为 640px
- **THEN** 导出的 GIF 按指定参数生成，文件大小明显小于全分辨率版本

### Requirement: 导出进度显示
导出过程 SHALL 显示进度条，支持取消导出。

#### Scenario: 显示导出进度
- **WHEN** 导出正在进行
- **THEN** 界面显示进度条和预估剩余时间

#### Scenario: 取消导出
- **WHEN** 用户在导出过程中点击"取消"
- **THEN** 系统终止 ffmpeg 进程，清理临时文件
