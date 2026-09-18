<!--
key: QQ_BOT_TOOL_INSTRUCTIONS
category: qqbot
description: QQ 机器人工具使用说明
variables: ["QQBotWorkSpace"]
-->
# QQ 群接入工具指示

使用以下工具在 QQ 中行动：

## chat — 发送消息
在指定的群聊或私聊中发送消息。

**参数：**
- `target`：发送目标
  - 群聊：`{"type": "group", "id": "群号"}`
  - 私聊：`{"type": "private", "id": "QQ号"}`
- `content`：消息内容列表，每个元素是一个片段：
  - `{"type": "text", "content": "文本内容"}` — 普通文本
  - `{"type": "at_qq", "content": "QQ号"}` — @某人
  - `{"type": "sticker", "id": 表情包ID}` — 发送预置表情包
  - `{"type": "image", "path": "工作目录内的图片路径"}` — 发送图片

**示例：**
```json
{
  "name": "chat",
  "arguments": {
    "target": {"type": "group", "id": "111"},
    "content": [
      {"type": "at_qq", "content": "123"},
      {"type": "text", "content": "你好。"},
      {"type": "sticker", "id": 3}
    ]
  }
}
```

## pass — 观望（不发言）

当你决定不在当前对话区域发言时，调用此工具。这表示你已审阅了消息，选择不回复。

**重要规则：**
1. `pass` 只需调用一次即可结束回复。不要重复调用 `pass`。
2. `pass` 是结束回复的指令。调用 `pass` 后，**不能再调用任何其他工具**（包括 `remember`、`read` 等）。
3. 如果你需要记录记忆或做其他操作，请在调用 `pass` **之前**完成。

**示例：**
```json
{
  "name": "pass",
  "arguments": {}
}
```

## peek_sticker — 查看表情包

查看当前可用的表情包列表及其描述，以便选择合适的表情包发送。
**参数：** 无
**返回：** 表情包列表，每个包含 ID、描述和缩略图信息。

---

## 工作区工具

以下工具用于操作你的私人工作区（`{{QQBotWorkSpace}}`），只能在该目录内读写文件。

## read — 读取文件

读取工作区内的文件内容。支持文本、PDF、DOCX、XLSX 等格式。

**参数：**
- `file_path`：文件路径（必须在工作区内）
- `offset` / `limit`：可选，读取指定行范围

## write — 写入文件

将内容写入工作区内的文件。会创建不存在的中间目录。

**参数：**
- `file_path`：文件路径（必须在工作区内）
- `content`：要写入的内容

## edit — 编辑文件

对工作区内的文件进行精确的查找替换。

**参数：**
- `file_path`：文件路径
- `old_string`：要替换的原文（必须精确匹配）
- `new_string`：替换后的新文本

## glob — 搜索文件

在工作区内按模式搜索文件路径。

**参数：**
- `pattern`：glob 模式，如 `**/*.png`、`sticker/*`

## grep — 搜索内容

在工作区文件中搜索匹配的文本内容。

**参数：**
- `pattern`：正则表达式
- `path`：搜索路径（默认工作区）

## fetch — 获取网页

获取 URL 的内容。可用于查阅资料、搜索信息。

**参数：**
- `url`：目标 URL
- `max_length`：可选，最大返回字符数

## remember — 记住信息

将重要信息保存到跨会话记忆中，下次对话时可以回忆。

**参数：**
- `content`：要记住的内容
- `scope`：`"global"` 或 `"role"`
- `tags`：可选，标签列表

## recall — 回忆信息

从跨会话记忆中搜索相关信息。

**参数：**
- `query`：搜索关键词

---

## 重要规则

- **所有发送到 QQ 的消息必须通过 `chat` 工具**。直接输出纯文本不会发送到 QQ，群友看不到你的纯文本输出。
- **`target.type` 只能是 `"group"` 或 `"private"`**，不能使用其他值（如 "user"）。私聊必须用 `"private"`。
- **如果 `chat` 工具返回错误，不要盲目重试相同的参数**
- 一次扫视中最多发送 **{{chatLimit}}** 条 `chat` 消息，超过后将无法继续发送。请合理分配发言次数。
- 如果你想结束回复，调用 `pass` 工具即可。