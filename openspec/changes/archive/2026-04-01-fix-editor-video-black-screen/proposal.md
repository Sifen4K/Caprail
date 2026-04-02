## Why

录制视频结束后打开 clip-editor 页面时，视频显示黑屏且底部时长显示为 0。根本原因有两个：(1) `load-video` 事件存在竞态条件——`main.ts` 在窗口创建 300ms 后发出事件，但 WebView2 可能尚未完成脚本加载，导致事件丢失；(2) `stop_recording` 函数在持有互斥锁的同时等待捕获线程结束，可能导致死锁。

## What Changes

- **修复事件竞态**：将视频路径通过 URL 查询参数传递给 clip-editor 窗口，替代不可靠的 `load-video` 事件机制。clip-editor 启动时直接从 URL 参数中读取路径并加载视频。
- **修复潜在死锁**：重构 `stop_recording` 函数，将 `handle.join()` 调用移到互斥锁作用域之外，避免持锁等待线程。
- **修复视频加载协议**：使用 Tauri 的 `convertFileSrc` 替代手动拼接 `file:///` URL，确保视频在 WebView2 中正确加载。

## Capabilities

### New Capabilities

_无新增功能_

### Modified Capabilities

_无规格级别的行为变更，仅修复实现层面的 bug_

## Impact

- `src/scripts/main.ts`：`openClipEditor` 函数将通过 URL 参数传递视频路径，移除 `load-video` 事件发送逻辑
- `src/scripts/clip-editor.ts`：从 URL 参数读取视频路径，使用 `convertFileSrc` 加载视频，移除 `load-video` 事件监听
- `src-tauri/src/recording.rs`：`stop_recording` 函数重构锁的作用域，将 `handle.join()` 移到锁外
