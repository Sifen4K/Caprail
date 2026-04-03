## ADDED Requirements

### Requirement: Canvas 帧渲染
剪辑编辑器 SHALL 使用 HTML Canvas 2D 上下文渲染录制帧，替代 `<video>` 元素。

#### Scenario: 显示单帧
- **WHEN** 编辑器需要显示帧索引 N
- **THEN** 系统 SHALL 通过 Tauri invoke 调用 `read_recording_frame(path, N)` 获取 BGRA 数据，转换为 `ImageData` 并通过 `putImageData` 渲染到 Canvas

### Requirement: 播放控制
编辑器 SHALL 支持播放、暂停、跳转操作。

#### Scenario: 播放
- **WHEN** 用户点击播放按钮
- **THEN** 系统 SHALL 以录制帧率通过 `requestAnimationFrame` 循环逐帧读取并渲染，从当前帧位置开始

#### Scenario: 暂停
- **WHEN** 用户点击暂停按钮
- **THEN** 系统 SHALL 停止帧推进，保持当前帧显示

#### Scenario: 时间轴跳转
- **WHEN** 用户点击时间轴上的某个位置
- **THEN** 系统 SHALL 计算对应的帧索引并立即渲染该帧

### Requirement: 裁剪区间
编辑器 SHALL 支持设置裁剪起止点，播放时 SHALL 限制在裁剪区间内。

#### Scenario: 设置裁剪区间
- **WHEN** 用户拖动裁剪手柄
- **THEN** 系统 SHALL 更新 trimStart 和 trimEnd 帧索引，并在时间轴上高亮裁剪区间

#### Scenario: 裁剪区间内播放
- **WHEN** 播放到达 trimEnd 帧
- **THEN** 系统 SHALL 暂停播放并将位置重置到 trimStart 帧

### Requirement: 速度控制
编辑器 SHALL 支持调节播放速度（0.25x - 2.0x），影响帧推进间隔。

#### Scenario: 调节速度
- **WHEN** 用户选择 2.0x 速度
- **THEN** 系统 SHALL 以原始帧率的 2 倍速度推进帧索引（每次跳 2 帧或将帧间隔减半）

### Requirement: 帧预加载缓冲
播放器 SHALL 预加载后续帧以避免播放卡顿。

#### Scenario: 预加载缓冲
- **WHEN** 播放正在进行
- **THEN** 系统 SHALL 提前请求后续 N 帧数据（N 由帧率决定），缓存在内存中以确保播放流畅
