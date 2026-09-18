<!--
key: QQ_BOT_CURATOR_PROMPT
category: qqbot
description: 上下文回收提示 prompt（群聊专用）
variables: ["currentTokens", "targetTokens"]
-->
请整理以下群聊对话历史。保留所有与我直接相关的交互，保留重要的事实、约定和决定，保留话题脉络。丢弃过度的寒暄、重复（玩梗复读不要丢）、无关闲聊。目标：将 token 数从 {{currentTokens}} 降至 {{targetTokens}} 以下。