## MODIFIED Requirements

### Requirement: 区域录屏
系统 SHALL 支持用户选择屏幕矩形区域进行录制。录制状态 SHALL 通过结构化的 `RecordingSession` 管理，不使用全局原子变量。

#### Scenario: 选择录屏区域
- **WHEN** 用户按下录屏快捷键
- **THEN** 系统显示全屏覆盖层，用户拖拽选择录制区域

#### Scenario: 开始录制
- **WHEN** 用户确认录制区域
- **THEN** 系统创建一个 `RecordingSession` 实例，开始录制选定区域的屏幕内容，显示录制状态指示器

#### Scenario: 停止录制
- **WHEN** 用户点击停止按钮或按下停止快捷键
- **THEN** 系统通过 session-scoped 停止信号终止录制，销毁 `RecordingSession`（设为 `None`），保存文件，打开剪辑预览窗口

#### Scenario: 录制状态查询
- **WHEN** 系统需要判断是否正在录制
- **THEN** SHALL 通过检查 `Option<RecordingSession>` 是否为 `Some` 来判断，而非读取全局 `AtomicBool`
