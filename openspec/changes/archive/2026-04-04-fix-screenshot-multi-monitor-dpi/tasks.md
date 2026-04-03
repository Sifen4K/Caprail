## 1. 诊断与验证

- [x] 1.1 在单显示器高 DPI 环境下测试截图，记录具体的偏移量和错误行为
- [x] 1.2 添加日志输出当前 DPI 缩放因子和坐标转换值，确认问题根源

## 2. 修复截图范围错误

- [x] 2.1 在 overlay.ts 中获取当前显示器 DPI 缩放因子（使用 window.devicePixelRatio 或 Tauri API）
- [x] 2.2 将 clientX/clientY 选区坐标转换为物理像素坐标后传递给 capture_region
- [x] 2.3 测试不同 DPI 缩放级别（100%、125%、150%、200%）下的截图范围准确性

## 3. 修复窗口高亮位置偏移

- [x] 3.1 在 screenshots.ts 中获取显示器物理坐标原点偏移
- [x] 3.2 在 overlay.ts 的 findWindowAt 函数中，将 get_windows 返回的物理坐标转换为 overlay 窗口相对坐标
- [x] 3.3 应用 DPI 缩放因子转换公式：overlayRelativeX = (windowPhysicalX - monitorPhysicalOriginX) / dpiScale
- [x] 3.4 测试窗口高亮与实际窗口边界的对齐情况

## 4. 修复绿色标线残留

- [x] 4.1 在 mouseup 事件处理中，截图前先清除 canvas 内容（ctx.clearRect）
- [x] 4.2 或在截图前设置 canvas visibility: hidden，截图后恢复
- [x] 4.3 测试截图结果是否包含绿色标线

## 5. 验收测试

- [x] 5.1 在单显示器 100% DPI 下测试截图功能正常
- [x] 5.2 在单显示器 150% DPI 下测试截图功能正常
- [ ] 5.3 在双显示器环境（不同 DPI）下测试截图功能正常（无多显示器环境，代码逻辑已验证）
- [x] 5.4 窗口高亮、截图范围、绿色标线三个问题均已修复