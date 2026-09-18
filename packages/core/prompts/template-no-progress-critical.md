<!--
key: noProgressCriticalMessage
category: template
description: Critical alert when a tool is called repeatedly with no progress
variables:
  - toolName
  - count
-->
严重：{{toolName}} 已经用相同的参数调用了 {{count}} 次，完全没有进展——执行被阻断。现在必须立刻停下来，彻底重新评估方案。一定有其他路可以走。
