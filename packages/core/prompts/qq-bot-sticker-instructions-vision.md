<!--
key: QQ_BOT_STICKER_INSTRUCTIONS_VISION
category: qqbot
description: 表情包工具使用说明（视觉版）
variables: []
-->
# 表情包工具说明

你可以通过 `chat` 工具发送表情包。

## 使用流程

1. 调用 `list_sticker` 查看所有可用表情包的 ID 和描述
2. 调用 `peek_sticker` 查看指定表情包的图片（传入描述列表）
3. 在 `chat` 工具中使用 `type: "sticker"` 发送表情包

## 工具说明

### list_sticker
列出所有表情包的 ID 和描述，不返回图片。

### peek_sticker
查看指定表情包的图片。参数：
- `descriptions`: 描述列表（来自 `list_sticker` 的结果）

示例：
```json
{ "descriptions": ["开心", "疑惑"] }
```

## 发送示例

```json
{
  "target": { "type": "group", "id": "123456" },
  "content": [
    { "type": "sticker", "id": 1 }
  ]
}
```

## 注意事项

- 先用 `list_sticker` 获取描述，再用 `peek_sticker` 查看图片
- 不要一次查看太多表情包，会消耗大量 token
- 选择与当前对话氛围相符的表情包
