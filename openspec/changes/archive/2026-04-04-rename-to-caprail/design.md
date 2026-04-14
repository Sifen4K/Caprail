## Context

当前项目使用分散的命名约定：
- npm 包名：`screenshot-tool`
- Cargo 包名：`screenshot-tool`
- 产品名：`ScreenshotTool`
- 标识符：`com.screenshot.tool`
- 内部目录/日志/注册表值均使用 `ScreenshotTool` 或 `screenshot-tool-*`

新品牌名 **Caprail** 需要统一应用到所有这些位置。

## Goals / Non-Goals

**Goals:**
- 统一品牌命名为 Caprail
- 更新所有配置文件和源码中的硬编码引用
- 保持功能完全不变

**Non-Goals:**
- 不迁移用户旧配置数据
- 不更新开源许可证文件（另独立处理）
- 不设计新 logo/图标（现有图标暂时保留）

## Decisions

| 决策 | 选择 | 理由 |
|------|------|------|
| identifier 格式 | `com.caprail.desktop` | 标准 reverse-DNS 格式，并避免与 macOS `.app` 扩展冲突 |
| Cargo lib 名 | `caprail_lib` | 与包名一致，符合 Rust snake_case 约定 |
| 用户配置迁移 | 不处理 | 开源首发，无历史用户负担；简化实现 |
| UI 状态消息 | 保持功能性描述 | 如 "Caprail: capturing..." 而非纯品牌名 |

## Risks / Trade-offs

| 风险 | 缓解措施 |
|------|----------|
| 现有测试用户配置丢失 | 开源前清空本地测试环境即可；正式发布无历史用户 |
| 注册表自启动失效 | 用户需重新在设置中启用自启动 |
| 搜索引擎索引延迟 | README 中注明项目曾用名 ScreenshotTool |
