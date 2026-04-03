## Why

截图/录屏完成后进入编辑器（editor）存在明显卡顿，用户体验差。同时，代码库中存在大量重复逻辑、全局状态管理混乱、魔法数字、不一致的命名规范等问题，需要系统性重构以提升代码质量和可维护性。

## What Changes

- **优化编辑器启动流程**：消除截图后进入 editor 的 300ms 硬编码延迟，改用事件驱动的就绪信号机制，确保数据在编辑器准备好后立即传输
- **优化图像数据传输**：将大尺寸 RGBA 原始像素数据改为文件/共享内存传输，避免通过 IPC 事件传送数 MB 的原始字节数组
- **优化 BGRA→RGBA 色彩转换**：当前逐像素 swap 循环效率低下，改用批量/SIMD 优化或在前端直接处理 BGRA 格式
- **重构 capture.rs 重复代码**：`capture_screen`、`capture_region`、`capture_window` 三个函数存在大量重复的 unsafe Win32 调用，提取公共逻辑
- **重构 recording.rs 全局状态**：将 `RECORDING`、`PAUSED` 等 AtomicBool 和全局 Mutex 收敛为结构化的录制会话管理
- **统一事件命名规范**：混合使用 kebab-case 和 camelCase 的事件名统一为 kebab-case
- **补全错误处理**：Win32 API 调用缺少返回值校验，FFmpeg 进程缺少异常处理
- **清理 editor.ts 大文件**：654 行的编辑器脚本拆分为工具管理、画布操作、历史记录等模块

## Capabilities

### New Capabilities
- `editor-launch-optimization`: 编辑器启动流程优化，包括就绪信号机制和高效图像数据传输
- `capture-refactor`: 屏幕捕获模块重构，提取公共 Win32 调用逻辑并优化色彩转换
- `recording-state-management`: 录制状态管理重构，用结构化会话替代全局原子变量
- `editor-module-split`: 编辑器脚本模块化拆分

### Modified Capabilities
- `screen-capture`: 捕获后的数据传输方式变更（IPC 事件 → 临时文件），色彩转换优化
- `annotation-editor`: 编辑器加载方式变更（事件监听 → 就绪信号 + 文件读取），模块化拆分
- `screen-recording`: 录制状态管理重构，全局变量收敛为结构化状态

## Impact

- **前端**：`main.ts`、`editor.ts`、`overlay.ts`、`recording.ts` 均需修改
- **后端**：`capture.rs`、`recording.rs`、`lib.rs` 需重构
- **IPC 协议**：`screenshot-captured` 事件载荷从原始像素数组变为文件路径，影响前后端通信约定
- **事件名称**：全部统一为 kebab-case，需同步修改所有 emit/listen 调用
- **无外部依赖变更**：不引入新 crate 或 npm 包
