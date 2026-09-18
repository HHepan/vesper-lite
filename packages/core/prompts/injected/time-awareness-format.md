<!--
key: timeAwarenessFormat
category: embedded
description: Format string for time awareness injection. Variables are substituted at runtime.
variables:
  - dateStr: Current date (YYYY-MM-DD)
  - timeStr: Current time (HH:MM:SS)
  - tz: Timezone (e.g., UTC+8)
-->
Current time: {{dateStr}} {{timeStr}} {{tz}}