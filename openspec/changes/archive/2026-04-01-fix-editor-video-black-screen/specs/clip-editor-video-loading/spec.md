## ADDED Requirements

### Requirement: clip-editor 通过 URL 参数接收视频路径

clip-editor 窗口 SHALL 从 URL 查询参数 `path` 中读取视频文件路径，不再依赖 `load-video` 事件。

#### Scenario: 正常加载视频
- **WHEN** clip-editor 窗口打开且 URL 包含 `?path=<编码后的视频路径>`
- **THEN** clip-editor SHALL 解码路径，通过 ffprobe 获取时长，并使用 `convertFileSrc` 在视频元素中正确显示视频

#### Scenario: 缺少路径参数
- **WHEN** clip-editor 窗口打开且 URL 不包含 `path` 参数
- **THEN** clip-editor SHALL 在控制台输出错误日志，不尝试加载视频

### Requirement: 视频使用 convertFileSrc 加载

clip-editor SHALL 使用 Tauri 的 `convertFileSrc` 函数将本地文件路径转换为 WebView 可访问的 URL，而非手动拼接 `file:///` URL。

#### Scenario: 视频正确加载
- **WHEN** 使用 `convertFileSrc` 转换后的 URL 设置到 video 元素的 src
- **THEN** 视频 SHALL 在 WebView2 中正确渲染，不出现黑屏

### Requirement: stop_recording 不产生死锁

`stop_recording` 函数 SHALL 在释放 `RECORDING_STATE` 互斥锁之后再调用 `handle.join()` 等待捕获线程结束。

#### Scenario: 捕获线程正在写入帧数据时停止录制
- **WHEN** 用户点击停止录制，且捕获线程正在持有互斥锁写入帧数据
- **THEN** `stop_recording` SHALL 等待互斥锁可用，关闭 ffmpeg stdin，释放锁，然后等待线程结束，不产生死锁
