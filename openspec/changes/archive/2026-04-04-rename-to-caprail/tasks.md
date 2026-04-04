## 1. 前端配置文件

- [x] 1.1 更新 package.json：name 改为 "caprail"
- [x] 1.2 更新 package-lock.json：name 改为 "caprail"

## 2. Tauri 配置文件

- [x] 2.1 更新 tauri.conf.json：productName 改为 "Caprail"
- [x] 2.2 更新 tauri.conf.json：identifier 改为 "com.caprail.app"
- [x] 2.3 更新 tauri.conf.json：window title 改为 "Caprail"

## 3. Rust 配置与源码

- [x] 3.1 更新 Cargo.toml：package.name 改为 "caprail"
- [x] 3.2 更新 Cargo.toml：lib.name 改为 "caprail_lib"
- [x] 3.3 更新 lib.rs：日志目录 "ScreenshotTool" → "Caprail"
- [x] 3.4 更新 lib.rs：日志文件名 "screenshot-tool.log" → "caprail.log"
- [x] 3.5 更新 lib.rs：启动消息 "ScreenshotTool" → "Caprail"
- [x] 3.6 更新 config.rs：数据目录 "ScreenshotTool" → "Caprail"
- [x] 3.7 更新 config.rs：注册表值名 "ScreenshotTool" → "Caprail"
- [x] 3.8 更新 capture.rs：临时目录 "screenshot-tool-captures" → "caprail-captures"
- [x] 3.9 更新 ocr.rs：临时目录 "screenshot-tool-ocr" → "caprail-ocr"
- [x] 3.10 更新 main.rs：lib 引用 "screenshot_tool_lib" → "caprail_lib"

## 4. 文档更新

- [x] 4.1 更新 README.md：标题改为 "# Caprail"
- [x] 4.2 更新 README.md：所有路径说明改为 Caprail 目录名
- [x] 4.3 更新 README.md：项目描述中名称改为 Caprail

## 5. TypeScript 源码（可选清理）

- [x] 5.1 检查并更新 main.ts 中的状态栏消息文本
- [x] 5.2 检查并更新 editor.ts 中的注释文本（如有品牌名引用）

## 6. 验证

- [x] 6.1 运行 `npm run tauri build` 验证应用正常编译
- [x] 6.2 验证输出文件名为 Caprail.exe
- [x] 6.3 验证安装包名为 Caprail_0.1.0_x64-setup.exe