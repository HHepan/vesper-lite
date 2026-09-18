<!--
key: script
category: tool-description
description: I execute a Node.js script
variables: []
params:
  code: The Node.js script to execute. Runs as an ES module with top-level await. Use console.log() for output.
  timeout: Timeout in milliseconds. Defaults to 30000 (30 seconds).
-->
I execute a Node.js script and return the output. Use this for programmatic tasks — data transformation, JSON manipulation, complex string processing, math computation, regex extraction, date calculation, or any logic that benefits from a real programming language. The script runs as an ES module (top-level await is supported). Use console.log() to produce output. This is preferred over `bash node -e` for multi-line logic.

**This is the preferred programming tool.** Any scenario requiring programming logic (computation, data processing, text parsing, format conversion, API calls, file content analysis) should use script instead of invoking python/node via bash. Node.js standard library (fs, path, crypto, url, Buffer, child_process) is fully available. fetch() is globally available.
