<!--
key: session_create
category: tool-description
description: Create a child sub-session attached to the current session.
variables: []
params:
  session_name: Display name for the new session (required).
  persona_name: Target persona name for the new session (optional, defaults to current persona).
  profile_idx: Optional profile index (from list_profiles). Defaults to current session's profile.
-->
Create a child sub-session attached to the current session. The new session is a full session — it appears in the sidebar, can be switched to, and supports all operations.

**Limitation:** A sub-session cannot create further sub-sessions (no nesting).

**Parameters:**
- `session_name` (required): Display name for the new session.
- `persona_name` (optional): Target persona name for the new session. If omitted, inherits the current session's persona.
- `profile_idx` (optional): Provider profile index from `list_profiles`. Defaults to inheriting the current session's profile.

**Examples:**
```
session_create(session_name="Research Assistant")                    // inherits current persona
session_create(session_name="Data Task", persona_name="analyst")    // explicit persona
session_create(session_name="分身", persona_name="developer", profile_idx=1)
```
