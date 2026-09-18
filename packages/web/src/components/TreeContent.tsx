// ═══════════════════════════════════════════════════════════════════════════
// Vesper WebUI — TreeContent (border-left tree wrapper with short bottom cap)
//
// Layout:
//   │ content line 1
//   │ content line 2
//   ╰── (short rounded bottom stub)
// ═══════════════════════════════════════════════════════════════════════════

import React, { memo } from 'react';
import { theme } from '../theme.js';

interface TreeContentProps {
  color?: string;
  children: React.ReactNode;
}

export const TreeContent = memo(function TreeContent({ color, children }: TreeContentProps) {
  const borderColor = color || theme.treeBorder;
  return (
    <div style={{ marginLeft: '1ch' }}>
      {/* Main content with left border (no bottom) */}
      <div style={{
        borderLeft: `1px solid ${borderColor}`,
        paddingLeft: '1ch',
      }}>
        {children}
      </div>
      {/* Short bottom cap: ╰── with its own border-left + border-bottom + radius */}
      <div style={{
        width: '1.5ch',
        height: '6px',
        borderLeft: `1px solid ${borderColor}`,
        borderBottom: `1px solid ${borderColor}`,
        borderBottomLeftRadius: '6px',
      }} />
    </div>
  );
});
