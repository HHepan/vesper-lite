// =============================================================================
// Vesper WebUI -- Session Create Dialog
//
// Minimal dialog shown when creating a new session.
// Fetches available profiles from config.json via server and lets the user
// pick which profile to use for the new session.
// =============================================================================

import React, { useState, useEffect } from 'react';
import { theme } from '../theme.js';
import type { Bridge } from '../bridge.js';
import { useModalAnimation } from '../hooks/useModalAnimation.js';

interface ProfileInfo {
  name: string;
  model?: string;
  baseURL?: string;
}

let sessionCounter = 0;
export function bumpSessionCounter(n: number): void {
  if (n > sessionCounter) sessionCounter = n;
}
function defaultSessionName(): string {
  return `Session ${++sessionCounter}`;
}

interface SessionCreateDialogProps {
  bridge: Bridge;
  onClose: () => void;
  onCreate: (profile?: string, name?: string) => void;
  existingNames: string[];
}

export function SessionCreateDialog({ bridge, onClose, onCreate, existingNames }: SessionCreateDialogProps) {
  const { isClosing, handleClose, handleOverlayClick, overlayAnimation, panelAnimation } = useModalAnimation(onClose);

  const [profiles, setProfiles] = useState<ProfileInfo[]>([]);
  const [defaultProfile, setDefaultProfile] = useState<string | undefined>();
  const [selected, setSelected] = useState<string>('');
  const [sessionName, setSessionName] = useState(defaultSessionName);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch profiles on mount
  useEffect(() => {
    const unsub = bridge.onMetaEvent((event) => {
      if (event.type === 'profile_list') {
        setProfiles(event.profiles ?? []);
        setDefaultProfile(event.defaultProfile);
        setSelected(event.defaultProfile ?? '');
        setLoading(false);
      }
    });
    bridge.listProfiles();
    return unsub;
  }, [bridge]);

  // Escape to close (with animation)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleClose]);

  const handleCreate = () => {
    const name = sessionName.trim();
    if (!name) {
      setError('Session name cannot be empty');
      return;
    }
    if (existingNames.includes(name)) {
      setError(`Session "${name}" already exists. Please choose a different name.`);
      return;
    }
    onCreate(selected || undefined, name || undefined);
  };

  const formatProfile = (p: ProfileInfo) => {
    const parts = [p.name];
    if (p.model) parts.push(p.model);
    if (p.baseURL) {
      try {
        const host = new URL(p.baseURL).host;
        parts.push(`@ ${host}`);
      } catch {
        parts.push(`@ ${p.baseURL}`);
      }
    }
    return parts.join(' \u2014 ');
  };

  return (
    <div style={{ ...styles.overlay, animation: overlayAnimation }} onClick={handleOverlayClick}>
      <div style={{ ...styles.dialog, animation: panelAnimation }}>
        <div style={styles.header}>
          <span style={{ color: theme.bannerTitle, fontWeight: 'bold' }}>New Session</span>
        </div>

        <div style={styles.body}>
          <label style={styles.label}>Name:</label>
          <input
            style={styles.input}
            value={sessionName}
            onChange={(e) => {
              setSessionName(e.target.value);
              setError(null);
            }}
            placeholder="Session name"
            autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) handleCreate(); }}
          />
          {error && <span style={styles.error}>{error}</span>}

          <label style={styles.label}>Profile:</label>
          {loading ? (
            <span style={styles.hint}>Loading profiles...</span>
          ) : (
            <select
              style={styles.select}
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              <option value="">(default{defaultProfile ? `: ${defaultProfile}` : ''})</option>
              {profiles.map((p) => (
                <option key={p.name} value={p.name}>
                  {formatProfile(p)}
                </option>
              ))}
            </select>
          )}
          {profiles.length === 0 && !loading && (
            <span style={styles.hint}>No profiles defined in config.json. Using default settings.</span>
          )}
        </div>

        <div style={styles.footer}>
          <button style={styles.cancelBtn} onClick={handleClose}>Cancel</button>
          <button style={styles.createBtn} onClick={handleCreate}>Create</button>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.7)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 200,
    padding: '2em',
    animation: 'fade-in 0.2s ease-out',
  },
  dialog: {
    background: 'var(--bg-primary)',
    border: '1px solid var(--border-color)',
    borderRadius: '4px',
    width: '100%',
    maxWidth: '40ch',
    animation: 'scale-in 0.2s ease-out',
  },
  header: {
    padding: '0.6em 1ch',
    borderBottom: '1px solid var(--border-color)',
  },
  body: {
    padding: '1em 1ch',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5em',
  },
  label: {
    color: theme.dimText,
  },
  input: {
    padding: '0.3em 0.5ch',
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border-color)',
    borderRadius: '2px',
    color: 'var(--text-primary)',
    fontFamily: 'inherit',
    fontSize: 'inherit',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
  },
  select: {
    padding: '0.3em 0.5ch',
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border-color)',
    borderRadius: '2px',
    color: 'var(--text-primary)',
    fontFamily: 'inherit',
    fontSize: 'inherit',
    outline: 'none',
    width: '100%',
  },
  hint: {
    color: theme.dimText,
    fontSize: '0.85em',
  },
  footer: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '1ch',
    padding: '0.5em 1ch',
    borderTop: '1px solid var(--border-color)',
  },
  cancelBtn: {
    padding: '0.25em 1.5ch',
    background: 'transparent',
    border: '1px solid var(--border-color)',
    borderRadius: '2px',
    color: 'var(--text-secondary)',
    fontFamily: 'inherit',
    fontSize: 'inherit',
    cursor: 'pointer',
  },
  createBtn: {
    padding: '0.25em 2ch',
    background: 'var(--accent-blue)',
    border: 'none',
    borderRadius: '2px',
    color: 'var(--btn-primary-text, #FFFFFF)',
    fontFamily: 'inherit',
    fontSize: 'inherit',
    fontWeight: 'bold',
    cursor: 'pointer',
  },
  error: {
    color: 'var(--status-error)',
    fontSize: '0.85em',
  },
};
