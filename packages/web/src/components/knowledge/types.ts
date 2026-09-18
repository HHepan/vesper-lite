// Shared types for the Knowledge sidebar components.
// These mirror the wire shape sent by the server's ontology_graph event
// (scoped ids like "memory.db:n_a3f1b2", plus a `role` label per entry).

export interface SidebarNode {
  id: string;           // scoped id "dbFile:rawId"
  originalId: string;
  type: string;
  name: string;
  aliases: string[];
  props: Record<string, any>;
  summary: string;
  role?: string;
}

export interface SidebarEdge {
  id: string;
  src: string;          // scoped id
  dst: string;          // scoped id
  type: string;
  summary: string;
  weight: number;
  role?: string;
}

export interface SidebarNote {
  id: string;
  kind: string;
  content: string;
  summary: string;
  tags: string[];
  anchorNode: string | null;
  role?: string;
}

export type EntryCategory = 'node' | 'edge' | 'note';

/** Extract the dbName part of a scoped id ("memory_琉璃.db:t_abc" → "memory_琉璃.db"). */
export function dbNameOf(scopedId: string): string {
  return scopedId.slice(0, scopedId.indexOf(':'));
}
