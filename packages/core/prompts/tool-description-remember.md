<!--
key: remember
category: tool-description
description: Save a memory entry (fact or episode).
variables: []
params:
  content: Free-text content to remember
  scope: Storage destination. Default: role
  tags: Optional 2-5 search tags
  kind: Note kind. Default: observation
  ego: Ego label to route memory to (e.g. "Liuli", "Xijin"). Routes to that ego's store. Falls back to current store if not found.
-->
Save a memory entry (fact or episode). Use scope="global" for common facts (e.g. "Water boils at 100C") or scope="role" for professional/persona experience (e.g. "I prefer Rust for this project"). Use ego to route the memory to a specific persona's store (e.g. ego="Liuli"). When ego is specified, the memory is written from that persona's perspective and stored in their ego-partitioned database.