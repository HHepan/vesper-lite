// ═══════════════════════════════════════════════════════════════════════════
// Vesper Core — Safe State Cloner
// ToolDefinitions are fully serializable (no execute function).
// ProviderConfig contains only plain data fields.
// structuredClone handles everything.
// ═══════════════════════════════════════════════════════════════════════════

import type { AgentState } from '@vesper/shared';

/**
 * Deep-clone an AgentState.
 *
 * AgentState is fully serializable — ToolDefinition has no `execute`,
 * ProviderConfig is plain data. structuredClone handles everything.
 */
export function cloneState<S extends AgentState>(state: S): S {
  return structuredClone(state);
}
