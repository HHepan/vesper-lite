<!--
key: session_peek
category: tool-description
description: Observe what another AI session is doing on this server.
variables: []
params:
  target: Session ID or name.
  max_tokens: Maximum output tokens. Default: 5000. Earlier content truncated to "..." if exceeded.
  n_turns: Number of recent turns to show. Default: all.
  include_tools: Show tool call details (name, args preview, result). Default: true. Set false for compact view (tool name + status only).
-->
Observe what another AI session is doing. Shows status, canvas tokens, recent turns with full content, and tool call details.

- `max_tokens=5000` (default) — output truncated if exceeded, keeping newest content
- `n_turns` — limit to last N turns (omit for all)
- `include_tools=true` (default) — show tool name, args preview, and result for each tool call
- `include_tools=false` — compact mode: only show tool name and status (✓/❌/⏳)

Cannot peek yourself.