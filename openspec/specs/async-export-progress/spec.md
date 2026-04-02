### Requirement: 异步导出执行
导出操作 SHALL 在后台线程中异步执行，调用后立即返回，不阻塞 UI。

#### Scenario: 启动异步导出
- **WHEN** 前端调用 `export_video(config)`
- **THEN** 系统 SHALL 立即返回成功，在后台 tokio 任务中启动 FFmpeg 进程

#### Scenario: 重复导出防护
- **WHEN** 已有导出正在进行时再次调用 `export_video`
- **THEN** 系统 SHALL 返回错误提示已有导出正在执行

### Requirement: 实时进度事件
导出过程中系统 SHALL 通过 Tauri 事件通道向前端发送进度更新。

#### Scenario: 发送进度
- **WHEN** 导出过程中每发送一批帧到 FFmpeg
- **THEN** 系统 SHALL 发送 `export-progress` 事件，包含 `{ progress: f64, currentFrame: u64, totalFrames: u64 }` 数据

#### Scenario: 导出完成
- **WHEN** FFmpeg 进程成功结束
- **THEN** 系统 SHALL 发送 `export-complete` 事件，包含 `{ success: true, outputPath: String }`

#### Scenario: 导出失败
- **WHEN** FFmpeg 进程非零退出或发生错误
- **THEN** 系统 SHALL 发送 `export-complete` 事件，包含 `{ success: false, error: String }`

### Requirement: 前端进度条
前端 SHALL 监听进度事件并显示实时进度条。

#### Scenario: 显示进度
- **WHEN** 收到 `export-progress` 事件
- **THEN** 进度条 SHALL 更新为 `progress * 100%` 宽度

#### Scenario: 导出结束
- **WHEN** 收到 `export-complete` 事件且 `success` 为 true
- **THEN** 进度条 SHALL 显示 100% 并在短暂延迟后隐藏
