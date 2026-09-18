// ═══════════════════════════════════════════════════════════════════════════
// Vesper WebUI — WelcomeBanner (Vesper Mascot + Modern Warm Studio Style)
// ═══════════════════════════════════════════════════════════════════════════

import React, { memo } from 'react';
import { theme } from '../theme.js';

const MASCOT = [
  '  /|___|\\  ',
  ' ( (O,O) ) ',
  '    " "    ',
];

export const WelcomeBanner = memo(function WelcomeBanner() {
  return (
    <div style={styles.banner}>
      {/* Left: Vesper Fox Mascot Card */}
      <div style={styles.mascotContainer}>
        <pre style={styles.mascot}>{MASCOT.join('\n')}</pre>
      </div>

      {/* Subtle Hairline Divider */}
      <div style={styles.divider} />

      {/* Right: Info & Tagline */}
      <div style={styles.content}>
        <div style={styles.headerRow}>
          <span style={styles.title}>Vesper</span>
          <span style={styles.badge}>Agent Workspace</span>
        </div>
        <div style={styles.tagline}>
          Type a message to start. <kbd style={styles.kbd}>Esc</kbd> to interrupt.
        </div>
      </div>
    </div>
  );
});

const styles: Record<string, React.CSSProperties> = {
  banner: {
    display: 'inline-flex',
    flexDirection: 'row',
    alignItems: 'center',
    background: 'var(--bg-primary)',
    border: '1px solid var(--border-color)',
    borderRadius: 'var(--radius-lg)',
    boxShadow: 'var(--shadow-sm)',
    padding: '0.85rem 1.4rem',
    margin: '1.2rem auto',
    maxWidth: '560px',
    userSelect: 'none',
    transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
  },
  mascotContainer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0.3rem 0.6rem',
    borderRadius: 'var(--radius-md)',
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border-color)',
    flexShrink: 0,
  },
  mascot: {
    color: 'var(--accent-teal, var(--tool-name, #1B4D44))',
    fontFamily: 'var(--font-code)',
    fontSize: '13px',
    fontWeight: 600,
    margin: 0,
    lineHeight: 1.25,
    letterSpacing: '0.02em',
  },
  divider: {
    width: '1px',
    height: '42px',
    background: 'var(--border-color)',
    margin: '0 1.2rem',
    flexShrink: 0,
  },
  content: {
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    gap: '4px',
    minWidth: 0,
  },
  headerRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  title: {
    fontSize: '1.15rem',
    fontWeight: 700,
    letterSpacing: '-0.01em',
    color: 'var(--text-primary)',
    lineHeight: 1.2,
  },
  badge: {
    fontSize: '11px',
    fontWeight: 500,
    color: 'var(--text-muted)',
    background: 'var(--bg-tertiary)',
    padding: '1px 6px',
    borderRadius: '4px',
    letterSpacing: '0.02em',
  },
  tagline: {
    fontSize: '0.85rem',
    color: 'var(--text-secondary)',
    lineHeight: 1.4,
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
  },
  kbd: {
    padding: '1px 5px',
    fontSize: '10px',
    fontFamily: 'var(--font-code)',
    background: 'var(--bg-tertiary)',
    border: '1px solid var(--border-color)',
    borderRadius: '3px',
    color: 'var(--text-secondary)',
  },
};
