## MODIFIED Requirements

### Requirement: 区域录屏
系统 SHALL 支持用户选择屏幕矩形区域进行录制。录制过程 SHALL 将原始 BGRA 帧直接写入临时 `.rawv` 文件，不启动 FFmpeg 进程。录制状态 SHALL 通过结构化的 `RecordingSession` 管理。

#### Scenario: 开始录制
- **WHEN** 用户确认录制区域
- **THEN** 系统 SHALL 创建 `.rawv` 临时文件，写入 32 字节头部（宽高、帧率），创建 `RecordingSession` 实例，启动捕获线程将原始帧追加写入文件

#### Scenario: 停止录制
- **WHEN** 用户点击停止按钮
- **THEN** 系统 SHALL 设置停止信号 → 等待捕获线程结束 → 回写帧计数到文件头部 → 关闭文件句柄 → 返回 `.rawv` 文件路径。整个停止过程 SHALL 在 100ms 内完成（不包含捕获线程的最后一帧）

#### Scenario: 选择录屏区域
- **WHEN** 用户按下录屏快捷键
- **THEN** 系统显示全屏覆盖层，用户拖拽选择录制区域

#### Scenario: 录制状态查询
- **WHEN** 系统需要判断是否正在录制
- **THEN** SHALL 通过检查 `Option<RecordingSession>` 是否为 `Some` 来判断

### Requirement: 高性能录制
录制引擎 SHALL 将原始 BGRA 帧通过 `BufWriter` 写入磁盘，写入带宽需求约为 `width * height * 4 * fps` 字节/秒。

#### Scenario: 30fps 录制写入
- **WHEN** 用户录制 1920x1080 区域，帧率 30fps
- **THEN** 系统 SHALL 以约 237MB/s 速率持续写入原始帧，捕获线程不因 I/O 阻塞丢帧

#### Scenario: 帧率控制
- **WHEN** 捕获线程完成一帧的截取和写入
- **THEN** SHALL 通过精确计时控制帧间隔，保持帧率稳定

### Requirement: 录制状态指示
录制过程中系统 SHALL 显示录制状态指示器，包含录制时长和控制按钮。

#### Scenario: 显示录制指示器
- **WHEN** 录制正在进行
- **THEN** 屏幕边缘显示一个小型状态栏，显示录制时长（mm:ss），提供暂停和停止按钮

#### Scenario: 暂停和恢复录制
- **WHEN** 用户点击暂停按钮
- **THEN** 录制暂停，指示器显示暂停状态；再次点击恢复录制
