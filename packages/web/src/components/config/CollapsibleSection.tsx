import React, { useState, type ReactNode } from 'react';
import { theme } from '../../theme.js';

interface CollapsibleSectionProps {
  title: string;
  badge?: number | string;
  defaultOpen?: boolean;
  children: ReactNode;
}

export function CollapsibleSection({ title, badge, defaultOpen = false, children }: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div style={styles.section}>
      <button style={styles.header} onClick={() => setOpen(!open)}>
        <span style={styles.arrow}>{open ? '\u25BE' : '\u25B8'}</span>
        <span style={styles.title}>{title}</span>
        {badge != null && <span style={styles.badge}>{badge}</span>}
      </button>
      {open && <div style={styles.body}>{children}</div>}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  section: {
    borderBottom: '1px solid var(--border-color)',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5ch',
    width: '100%',
    padding: '0.5em 1ch',
    background: 'transparent',
    border: 'none',
    color: theme.bannerTitle,
    fontFamily: 'inherit',
    fontSize: 'inherit',
    fontWeight: 'bold',
    cursor: 'pointer',
    textAlign: 'left',
  },
  arrow: {
    color: theme.dimText,
    width: '1.5ch',
    display: 'inline-block',
  },
  title: {
    flex: 1,
  },
  badge: {
    background: 'var(--accent-blue)',
    color: 'var(--btn-primary-text, #FFFFFF)',
    padding: '0 0.6ch',
    borderRadius: '2px',
    fontSize: '0.85em',
  },
  body: {
    padding: '0.5em 1ch 1em 1ch',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75em',
  },
};
