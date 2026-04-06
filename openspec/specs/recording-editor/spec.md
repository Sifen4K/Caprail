## Purpose

This specification defines the recording clip editor for Caprail, covering clip preview playback, timeline-based trimming, playback speed adjustment, and timeline navigation with frame thumbnails.

## Requirements

### Requirement: 录屏预览
The clip editor page title and all visible control labels SHALL be loaded from the i18n locale file under the `clipEditor.*` key scope.

#### Scenario: Clip editor labels loaded from i18n
- **WHEN** the clip editor opens
- **THEN** the page title, play button, speed label, Export MP4 button, and Export GIF button labels are loaded from `clipEditor.title`, `clipEditor.play`, `clipEditor.speed`, `clipEditor.exportMp4`, and `clipEditor.exportGif` respectively

### Requirement: 时间轴裁剪
剪辑窗口 SHALL 提供时间轴控件，用户可拖动起点和终点手柄裁剪视频首尾。

#### Scenario: 裁剪视频首部
- **WHEN** 用户将起点手柄从 0s 拖到 3s
- **THEN** 导出时视频从第 3 秒开始，前 3 秒被裁剪

#### Scenario: 裁剪视频尾部
- **WHEN** 用户将终点手柄从 30s 拖到 25s
- **THEN** 导出时视频在第 25 秒结束，后 5 秒被裁剪

#### Scenario: 预览裁剪效果
- **WHEN** 用户调整裁剪手柄后点击播放
- **THEN** 预览仅播放裁剪后的片段

### Requirement: 播放倍率调整
剪辑窗口 SHALL 支持调整播放/导出倍率（快放/慢放）。

#### Scenario: 设置快放倍率
- **WHEN** 用户将倍率从 1x 调整为 2x
- **THEN** 预览以 2 倍速播放，导出的视频时长为原始的一半

#### Scenario: 可选倍率
- **WHEN** 用户点击倍率选择器
- **THEN** 系统提供 0.5x、1x、1.5x、2x、4x 等预设倍率选项

### Requirement: 剪辑时间轴交互
时间轴 SHALL 显示视频帧缩略图，支持点击定位到对应时间点。

#### Scenario: 点击时间轴定位
- **WHEN** 用户点击时间轴上某个位置
- **THEN** 视频跳转到该时间点并显示对应帧画面
