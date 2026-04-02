### Requirement: 原始帧文件格式
系统 SHALL 使用自定义二进制格式（`.rawv`）存储录制的原始 BGRA 帧数据。文件由固定 32 字节头部和紧密排列的帧数据组成。

#### Scenario: 文件头部结构
- **WHEN** 系统创建新的录制文件
- **THEN** 文件头部 SHALL 包含：magic 标识 `b"RAWV"`（4字节）、版本号 `u32`（4字节）、宽度 `u32`（4字节）、高度 `u32`（4字节）、帧率 `u32`（4字节）、帧计数 `u32`（4字节）、保留字段（8字节），共 32 字节

#### Scenario: 帧数据布局
- **WHEN** 系统追加写入一帧
- **THEN** 帧数据 SHALL 为 `width * height * 4` 字节的原始 BGRA 像素，紧跟在上一帧之后，无分隔符

### Requirement: 随机访问帧读取
系统 SHALL 支持通过帧索引 O(1) 时间随机访问任意帧。

#### Scenario: 按索引读取帧
- **WHEN** 请求读取帧索引 N
- **THEN** 系统 SHALL 通过偏移量 `32 + N * (width * height * 4)` 直接定位并读取该帧数据

#### Scenario: 越界帧索引
- **WHEN** 请求的帧索引 >= frame_count
- **THEN** 系统 SHALL 返回错误

### Requirement: 录制结束时回写帧计数
系统 SHALL 在录制结束时将实际帧数回写到文件头部的 frame_count 字段。

#### Scenario: 回写帧计数
- **WHEN** 录制停止
- **THEN** 系统 SHALL 将捕获线程累计的帧数写入文件头部偏移 20-24 字节处

### Requirement: 录制信息查询
系统 SHALL 提供 `get_recording_info` 命令，读取 rawv 文件头部返回元数据。

#### Scenario: 查询录制信息
- **WHEN** 前端调用 `get_recording_info(path)`
- **THEN** 系统 SHALL 返回 `{ width, height, fps, frameCount }` 结构
