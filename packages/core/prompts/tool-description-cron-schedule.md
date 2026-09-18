<!--
key: cron_schedule
category: tool-description
description: Schedule a delayed or repeating message.
variables: []
params:
  delay: Time until first fire. E.g. "30m", "1h", "2h30m", "1d".
  message: Message to send when the timer fires. Should clearly describe what to do.
  repeat: Optional. Repeat interval after first fire. Same format as delay. Omit for one-shot.
  target: Optional. Target session name. Omit = send to self. Use "*" to broadcast to all sessions.
  tag: Optional. Human-readable tag for easy cancellation later.
  description: Optional. Human-readable description of this task for UI display.
-->
Schedule a delayed or repeating message. Fires by sending a message to the target session (like a timed link_post). Omit target to message yourself. Use target="*" to broadcast to all sessions.

Use cases:
- Remind yourself to check on something later
- Periodically monitor a service or task
- Send a scheduled message to another session

Duration format: "30m", "1h", "2h30m", "1d", "1d6h" (d=days, h=hours, m=minutes, s=seconds).