// ═══════════════════════════════════════════════════════════════════════════
// Vesper WebUI — Shared subflow styles (supervisor / curator badge + indent)
// ═══════════════════════════════════════════════════════════════════════════

import type { CSSProperties } from 'react';
import { theme } from '../theme.js';

/** Container modifier for sub-flow entries (reduced opacity + indent). */
export const subflowContainerStyle: CSSProperties = {
  opacity: 0.65,
  paddingLeft: '2ch',
};

/** Small badge showing the sub-flow label (e.g. "Supervisor", "Curator"). */
export const subflowBadgeStyle: CSSProperties = {
  fontSize: '0.8em',
  color: theme.dimText,
  border: `1px solid ${theme.dimText}`,
  borderRadius: '3px',
  padding: '0 0.5ch',
  marginRight: '0.5ch',
  verticalAlign: 'middle',
};
