## Context

clip-editor 窗口用于在录制结束后编辑视频。当前实现通过以下流程传递视频文件：

1. `record-control.ts` 调用 `stop_recording` 获取文件路径
2. 通过 `emit("recording-stopped", { path })` 通知 `main.ts`
3. `main.ts` 创建 clip-editor 窗口，300ms 后通过 `emit("load-video", { path })` 发送路径
4. `clip-editor.ts` 监听 `load-video` 事件，使用 `file:///` 协议加载视频

存在三个问题：
- **事件竞态**：WebView2 可能在 300ms 内未完成脚本初始化，导致 `load-video` 事件丢失
- **协议问题**：`file:///` URL 在 Tauri WebView2 中可能被阻止
- **死锁风险**：`stop_recording` 在持有 `RECORDING_STATE` 互斥锁时调用 `handle.join()`

## Goals / Non-Goals

**Goals:**
- 确保 clip-editor 窗口始终能正确加载并显示录制的视频
- 确保视频时长正确显示
- 消除 `stop_recording` 的死锁风险

**Non-Goals:**
- 不改变录制功能本身的行为
- 不改变导出功能
- 不改变 UI 布局或样式

## Decisions

### 1. 使用 URL 查询参数传递视频路径（替代事件机制）

**选择**：将视频路径编码为 clip-editor 窗口 URL 的查询参数

**原因**：URL 查询参数在页面加载时就可用，不存在时序问题。clip-editor 脚本在初始化时即可从 `window.location.search` 读取路径，无需等待事件。

**替代方案**：
- 增加 `setTimeout` 延迟 → 不可靠，不同机器性能差异大
- 使用 `emitTo` + 重试机制 → 复杂，仍有竞态窗口
- clip-editor 主动通过 `invoke` 请求路径 → 需要额外的全局状态管理

### 2. 使用 `convertFileSrc` 加载视频

**选择**：使用 `@tauri-apps/api/core` 的 `convertFileSrc` 函数

**原因**：`convertFileSrc` 返回 `http://asset.localhost/` 格式的 URL，是 Tauri 推荐的本地文件加载方式，兼容 WebView2 的安全策略。

### 3. 重构互斥锁作用域

**选择**：将 `handle.join()` 移到互斥锁块之外

**原因**：capture 线程在循环中需要获取锁写入帧数据。如果 `stop_recording` 持锁等待线程结束，而线程正在等待锁，就会死锁。将 join 移到锁外，先释放锁让线程完成最后一次迭代，再等待线程退出。

## Risks / Trade-offs

- **URL 编码特殊字符**：文件路径可能包含中文或特殊字符 → 使用 `encodeURIComponent` / `decodeURIComponent` 处理
- **`convertFileSrc` 可用性**：需要 Tauri 的 asset 协议支持 → Tauri v2 默认启用，如果失败则回退到 `file:///`
