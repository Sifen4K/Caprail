## 1. 修复 stop_recording 死锁

- [x] 1.1 重构 `src-tauri/src/recording.rs` 中的 `stop_recording` 函数：将 `capture_thread.take()` 和 `handle.join()` 移到互斥锁作用域外，先释放锁再等待线程

## 2. 修复 clip-editor 视频加载

- [x] 2.1 修改 `src/scripts/main.ts` 中的 `openClipEditor` 函数：将视频路径通过 `encodeURIComponent` 编码后作为查询参数 `?path=` 附加到 clip-editor 的 URL 中，移除 `setTimeout` + `emit("load-video")` 逻辑
- [x] 2.2 修改 `src/scripts/clip-editor.ts`：从 `window.location.search` 解析 `path` 参数获取视频路径，替代 `listen("load-video")` 事件监听
- [x] 2.3 修改 `src/scripts/clip-editor.ts`：使用 `convertFileSrc` 从 `@tauri-apps/api/core` 替代手动拼接 `file:///` URL 来设置 `video.src`

## 3. 验证

- [x] 3.1 录制一段视频，确认 clip-editor 打开后视频正常显示且时长正确
- [x] 3.2 录制路径包含中文或空格时，确认视频仍能正确加载
