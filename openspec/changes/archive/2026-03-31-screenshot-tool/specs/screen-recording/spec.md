## ADDED Requirements

### Requirement: 区域录屏
系统 SHALL 支持用户选择屏幕矩形区域进行录制。

#### Scenario: 选择录屏区域
- **WHEN** 用户按下录屏快捷键
- **THEN** 系统显示全屏覆盖层，用户拖拽选择录制区域

#### Scenario: 开始录制
- **WHEN** 用户确认录制区域
- **THEN** 系统开始录制选定区域的屏幕内容，显示录制状态指示器（录制时长、停止按钮）

#### Scenario: 停止录制
- **WHEN** 用户点击停止按钮或按下停止快捷键
- **THEN** 系统停止录制，将录制内容保存为临时文件，打开剪辑预览窗口

### Requirement: 全屏录制
系统 SHALL 支持录制当前显示器的全屏画面。

#### Scenario: 全屏录制
- **WHEN** 用户在录屏选区界面选择全屏模式
- **THEN** 系统录制鼠标所在显示器的完整画面

### Requirement: 高性能录制
录制引擎 SHALL 基于 DXGI Desktop Duplication API，支持 60fps 录制，CPU 占用 SHALL 低于 15%（正常负载下）。

#### Scenario: 60fps 录制
- **WHEN** 用户以默认设置录制 1920x1080 区域
- **THEN** 输出视频帧率达到 60fps，录制过程中系统无明显卡顿

### Requirement: 录制状态指示
录制过程中系统 SHALL 显示录制状态指示器，包含录制时长和控制按钮。

#### Scenario: 显示录制指示器
- **WHEN** 录制正在进行
- **THEN** 屏幕边缘显示一个小型状态栏，显示录制时长（mm:ss），提供暂停和停止按钮

#### Scenario: 暂停和恢复录制
- **WHEN** 用户点击暂停按钮
- **THEN** 录制暂停，指示器显示暂停状态；再次点击恢复录制
