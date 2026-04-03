## Context

### 问题背景
截图功能使用三层坐标系统：
1. **Tauri WebviewWindow 坐标** - 使用逻辑坐标（DPI 缩放后的坐标）
2. **Canvas clientX/clientY** - 相对于窗口的逻辑坐标
3. **Windows GDI/GetWindowRect 坐标** - 使用物理像素坐标

当 DPI != 100% 时，这些坐标系统之间的转换缺失导致问题：
- 框选区域使用逻辑坐标，但 capture_region 使用物理坐标 → 截图范围错误
- get_windows 返回物理坐标，但 overlay 窗口用逻辑坐标绘制 → 窗口高亮偏移
- 截图时 overlay 内容仍在显示 → 绿色标线残留

### 当前代码分析
- `lib.rs` 已设置 `PROCESS_PER_MONITOR_DPI_AWARE`
- `screenshots.ts` 使用 `availableMonitors()` 获取显示器信息，返回逻辑坐标
- `overlay.ts` 使用 `clientX/clientY` 直接传递给 `capture_region`
- `capture.rs` 的 `get_windows()` 返回物理坐标，`gdi_capture()` 使用物理坐标

## Goals / Non-Goals

**Goals:**
- 单显示器高 DPI 环境下截图范围正确
- 窗口高亮位置与实际窗口对齐
- 截图中不包含绿色标线
- 保持双屏环境正常工作

**Non-Goals:**
- 不改变现有截图 API 接口
- 不重构整体架构
- 不处理跨 DPI 显示器截图（超出当前 scope）

## Decisions

### Decision 1: 前端统一使用物理坐标

**选择:** 在 overlay.ts 中将所有坐标转换为物理像素后再传递给后端

**理由:**
- 后端 GDI capture 和 get_windows 都使用物理坐标
- 前端 overlay 窗口需要知道当前 DPI 缩放因子
- 通过 `window.devicePixelRatio` 或 Tauri API 获取缩放因子

**替代方案:**
- 后端接收逻辑坐标并转换 → 需要额外传递 DPI 信息，API 变更较大
- 全部使用逻辑坐标 → 需要后端大量改动

### Decision 2: 截图前隐藏 overlay 内容

**选择:** 在调用 capture_region 前先隐藏 canvas 或设置透明

**理由:**
- 最简单有效的方案
- 绿色标线是 canvas 绘制的内容
- 需要在 mouseup 后立即清除或隐藏

**实现方式:**
```javascript
// 在 capture_region 调用前
ctx.clearRect(0, 0, canvas.width, canvas.height);
// 或设置 canvas visibility: hidden
```

### Decision 3: 窗口坐标映射使用 monitor 原点偏移

**选择:** 计算当前显示器原点偏移，将窗口物理坐标转换为 overlay 窗口相对坐标

**理由:**
- overlay 窗口覆盖所有显示器，从 (minX, minY) 开始
- get_windows 返回的是屏幕绝对物理坐标
- 需要转换为 overlay 窗口的相对坐标并考虑 DPI

**公式:**
```
overlayRelativeX = (windowPhysicalX - monitorPhysicalOriginX) / dpiScale
overlayRelativeY = (windowPhysicalY - monitorPhysicalOriginY) / dpiScale
```

## Risks / Trade-offs

### Risk: DPI 缩放因子获取时机
- **问题:** Tauri API 返回的 scaleFactor 可能与实际不一致
- **缓解:** 使用 `window.devicePixelRatio` 作为备用方案

### Risk: 跨显示器窗口高亮
- **问题:** 窗口跨越两个不同 DPI 的显示器时，坐标转换复杂
- **缓解:** 当前 scope 不处理，使用窗口主要显示器 DPI

### Risk: 性能影响
- **问题:** 每次截图都要计算坐标转换
- **缓解:** 计算量很小，对性能影响可忽略