<!--
key: list_profiles
category: tool-description
description: List all available provider profiles with their indices.
variables: []
-->
List all available provider profiles with their indices (starting from 0). Returns each profile's name, model, and baseURL.

Use this to determine the `profile_idx` parameter for `session_create`.

**Most of the time you don't need this** — `session_create` without `profile_idx` automatically inherits the current session's profile.

**Example output:**
```
Available profiles:

  [0] default  →  gpt-4o
  [1] deepseek  →  deepseek-chat
  [2] claude  →  claude-sonnet-4-20250514

Current session profile: default
```
