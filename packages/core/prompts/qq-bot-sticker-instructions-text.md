<!--
key: QQ_BOT_STICKER_INSTRUCTIONS_TEXT
category: qqbot
description: 表情包工具使用说明（无视觉版）
variables: []
-->
# 表情包工具说明

你可以通过 `chat` 工具发送表情包。

## 使用流程

1. 调用 `list_sticker` 查看所有可用表情包的 ID 和描述
2. 在 `chat` 工具中使用 `type: "sticker"` 发送表情包

## 示例

```json
{
  "target": { "type": "group", "id": "123456" },
  "content": [
    { "type": "sticker", "id": 1 }
  ]
}
```

## 注意事项

- 表情包 ID 来自 `list_sticker` 的结果
- 选择与当前对话氛围相符的表情包
