<!--
key: circuitBreakerMessage
category: template
description: Critical message when circuit breaker triggers on repeated no-progress tool calls
variables:
  - toolName
  - count
-->
严重：{{toolName}} 已经重复了 {{count}} 次相同的无进展调用——熔断器触发。在同一条死路上反复碰壁是不可接受的。必须立刻彻底改变策略，换一个完全不同的方案。一定有其他路。
