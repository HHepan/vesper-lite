<!--
key: subagentCompletedContent
category: embedded
description: Reminder injected when a subagent completes while the main flow is running
variables:
  - taskIds: Comma-separated list of completed subagent task IDs
-->
[子代理完成] 以下子代理任务已完成：{{taskIds}}。我可以使用 subagent_output 或 subagent_wait 来获取它们的结果。