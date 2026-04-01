## ADDED Requirements

### Requirement: 钉图浮窗
系统 SHALL 支持将截图钉在屏幕上，显示为 always-on-top 的浮动窗口。

#### Scenario: 钉在屏幕上
- **WHEN** 用户在标注编辑器中点击"钉在屏幕上"按钮
- **THEN** 系统创建一个 always-on-top 无边框窗口显示该截图，关闭标注编辑器

### Requirement: 浮窗拖动
钉图浮窗 SHALL 支持鼠标拖动移动位置。

#### Scenario: 拖动浮窗
- **WHEN** 用户在浮窗上按住鼠标左键拖拽
- **THEN** 浮窗跟随鼠标移动

### Requirement: 浮窗缩放
钉图浮窗 SHALL 支持鼠标滚轮缩放大小。

#### Scenario: 滚轮缩放
- **WHEN** 用户在浮窗上滚动鼠标滚轮
- **THEN** 浮窗按比例放大或缩小，最小不低于 50x50 像素

### Requirement: 浮窗透明度调节
钉图浮窗 SHALL 支持调节窗口透明度。

#### Scenario: 调节透明度
- **WHEN** 用户在浮窗上按住 Ctrl 并滚动鼠标滚轮
- **THEN** 浮窗透明度在 20%~100% 之间调节

### Requirement: 浮窗关闭
钉图浮窗 SHALL 支持关闭。

#### Scenario: 关闭浮窗
- **WHEN** 用户在浮窗上双击鼠标或按下 Esc
- **THEN** 浮窗关闭并释放资源

### Requirement: 多实例浮窗
系统 SHALL 支持同时存在多个钉图浮窗，互不影响。

#### Scenario: 多个浮窗共存
- **WHEN** 用户先后钉了 3 张截图
- **THEN** 屏幕上同时显示 3 个独立的浮窗，各自可独立移动、缩放、关闭
