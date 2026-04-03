## Why

截图功能在单显示器高 DPI 缩放环境下存在三个关键问题，影响用户体验和功能可用性。这些问题在双屏环境下正常，但在单屏（特别是 DPI != 100% 时）会出现：
1. 截图范围与框选区域不一致，editor 显示错误的区域
2. 截图中包含自动捕获窗口的绿色标线
3. 自动捕获窗口高亮位置与实际窗口位置偏移

根本原因是坐标系统不一致：Tauri WebviewWindow 使用逻辑坐标，而 Windows GDI 和窗口枚举使用物理像素坐标。

## What Changes

- 修复 overlay 窗口坐标系统，使其与物理像素坐标一致
- 在截图前隐藏 overlay 内容，避免截取绿色标线
- 统一窗口枚举坐标与 overlay 坐标的映射关系
- 添加 DPI 缩放因子转换逻辑

## Capabilities

### Modified Capabilities

- `screen-capture`: 修改多显示器支持的行为，确保单显示器高 DPI 环境下坐标转换正确，绿色标线不残留，窗口高亮位置准确

## Impact

- `src/scripts/screenshots.ts` - overlay 窗口创建时的坐标计算
- `src/scripts/overlay.ts` - 选区坐标转换、窗口高亮坐标映射
- `src-tauri/src/capture.rs` - 可能需要调整 get_windows 返回的坐标格式或添加 DPI 转换函数
- `openspec/specs/screen-capture/spec.md` - 更新验收标准