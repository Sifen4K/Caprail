## ADDED Requirements

### Requirement: 截图文字提取
系统 SHALL 支持从截图中识别并提取文字内容，基于 PaddleOCR 离线引擎。

#### Scenario: OCR 提取文字
- **WHEN** 用户在标注编辑器中点击"提取文字"按钮
- **THEN** 系统对截图进行 OCR 识别，在弹出面板中显示识别出的文字内容

#### Scenario: 复制识别文字
- **WHEN** OCR 识别完成后用户点击"复制文字"
- **THEN** 识别出的文字被复制到系统剪贴板

### Requirement: 中英文识别
OCR 引擎 SHALL 支持中文和英文混合文字的识别。

#### Scenario: 中英文混合识别
- **WHEN** 截图中包含中英文混合内容（如 "用户ID: 12345"）
- **THEN** 系统正确识别中英文内容，保持合理的阅读顺序

### Requirement: 离线运行
OCR 功能 SHALL 完全离线运行，不依赖网络连接。

#### Scenario: 无网络环境使用
- **WHEN** 用户在无网络环境下使用 OCR 功能
- **THEN** OCR 正常工作，不报错或降级
