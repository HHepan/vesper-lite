// ═══════════════════════════════════════════════════════════════════════════
// Vesper WebUI — PermissionDialog (TUI style: bordered box + keyboard shortcuts)
// Supports deny_once and deny_always, both with optional reason via [d] detail mode.
// Includes "View Details" button for diff preview (write/edit) or full args.
// ═══════════════════════════════════════════════════════════════════════════

import React, { memo, useState, useRef, useEffect, useCallback } from 'react';
import { theme } from '../theme.js';
import { useKeyboard } from '../hooks/useKeyboard.js';
import type { PendingPermission, PermissionDecision, ToolResultMeta } from '../store.js';
import { DiffView } from './DiffView.js';

interface PermissionDialogProps {
  permission: PendingPermission;
  onRespond: (decision: PermissionDecision, denyReason?: string) => void;
}

export const PermissionDialog = memo(function PermissionDialog({
  permission,
  onRespond,
}: PermissionDialogProps) {
  const [mode, setMode] = useState<'choose' | 'deny_detail' | 'view_detail'>('choose');
  const [reason, setReason] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useKeyboard((input, key) => {
    if (mode !== 'choose') return;
    if (input === 'y' || input === 'Y') {
      onRespond('allow_once');
    } else if (input === 'a' || input === 'A') {
      onRespond('allow_always');
    } else if (input === 'n' || input === 'N' || key.escape) {
      onRespond('deny_once');
    } else if (input === 'd' || input === 'D') {
      setMode('deny_detail');
    } else if (input === 'v' || input === 'V') {
      if (permission.previewMeta || permission.args) {
        setMode('view_detail');
      }
    }
  });

  // Auto-focus the reason input when entering deny detail mode
  useEffect(() => {
    if (mode === 'deny_detail' && inputRef.current) {
      inputRef.current.focus();
    }
  }, [mode]);

  const handleReasonKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setMode('choose');
      setReason('');
    }
    // Enter is NOT intercepted here — use the buttons to choose once/always
  }, []);

  // Determine if we have diff preview
  const hasDiff = permission.previewMeta?.type === 'file_write' || permission.previewMeta?.type === 'file_edit';

  // View detail modal
  if (mode === 'view_detail') {
    return (
      <div style={styles.box}>
        <div style={{ color: theme.permissionHeader, fontWeight: 'bold', marginBottom: '0.5em' }}>
          📋 Operation Details
        </div>
        
        <div style={styles.detailContent}>
          {/* Tool name and args preview */}
          <div style={{ marginBottom: '0.5em' }}>
            <span style={{ color: theme.permissionTool, fontWeight: 'bold' }}>{permission.toolName}</span>
            <span style={{ color: theme.toolArgs }}> {permission.argsPreview}</span>
          </div>

          {/* Diff preview for write/edit */}
          {hasDiff && permission.previewMeta && (
            <div style={styles.diffSection}>
              <DiffView meta={permission.previewMeta as any} />
            </div>
          )}

          {/* Full args for non-diff operations */}
          {!hasDiff && permission.args && (
            <div style={styles.argsSection}>
              <div style={{ color: theme.dimText, marginBottom: '0.25em' }}>Arguments:</div>
              <pre style={styles.argsPre}>
                {JSON.stringify(permission.args, null, 2)}
              </pre>
            </div>
          )}
        </div>

        <div style={styles.keys}>
          <button
            style={{ ...styles.btn, color: theme.permissionAllowOnce }}
            onClick={() => onRespond('allow_once')}
          >
            [y] Allow once
          </button>
          <button
            style={{ ...styles.btn, color: theme.permissionAllowAlways }}
            onClick={() => onRespond('allow_always')}
          >
            [a] Allow always
          </button>
          <button
            style={{ ...styles.btn, color: theme.permissionDeny }}
            onClick={() => onRespond('deny_once')}
          >
            [n] Deny once
          </button>
          <button
            style={{ ...styles.btn, color: 'var(--text-muted)' }}
            onClick={() => setMode('choose')}
          >
            [Esc] Back
          </button>
        </div>
      </div>
    );
  }

  if (mode === 'deny_detail') {
    return (
      <div style={styles.box}>
        <div style={{ color: theme.permissionHeader, fontWeight: 'bold' }}>
          ⚠ Deny — optional reason
        </div>
        <div style={{ marginTop: '0.25em' }}>
          <span style={{ color: theme.permissionTool, fontWeight: 'bold' }}>{permission.toolName}</span>
          <span style={{ color: theme.toolArgs }}> {permission.argsPreview}</span>
        </div>
        <div style={{ marginTop: '0.5em', color: theme.permissionDeny }}>
          Reason (Esc to go back):
        </div>
        <div style={{ marginTop: '0.25em' }}>
          <input
            ref={inputRef}
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onKeyDown={handleReasonKeyDown}
            placeholder="Optional reason..."
            style={styles.input}
          />
        </div>
        <div style={{ ...styles.keys, marginTop: '0.5em' }}>
          <button
            style={{ ...styles.btn, color: theme.permissionDeny }}
            onClick={() => onRespond('deny_once', reason.trim() || undefined)}
          >
            [n] Deny once
          </button>
          <button
            style={{ ...styles.btn, color: theme.permissionDeny }}
            onClick={() => onRespond('deny_always', reason.trim() || undefined)}
          >
            [d] Deny always
          </button>
          <button
            style={{ ...styles.btn, color: 'var(--text-muted)' }}
            onClick={() => { setMode('choose'); setReason(''); }}
          >
            [Esc] Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.box}>
      <div style={{ color: theme.permissionHeader, fontWeight: 'bold' }}>
        ⚠ Permission Required
      </div>
      <div style={{ marginTop: '0.25em' }}>
        <span style={{ color: theme.permissionTool, fontWeight: 'bold' }}>{permission.toolName}</span>
        <span style={{ color: theme.toolArgs }}> {permission.argsPreview}</span>
        {hasDiff && (
          <span style={{ color: theme.dimText, marginLeft: '0.5em' }}>
            ({(permission.previewMeta as any)?.linesAdded ?? 0}+ / {(permission.previewMeta as any)?.linesRemoved ?? 0}-)
          </span>
        )}
      </div>
      <div style={styles.keys}>
        <button
          style={{ ...styles.btn, color: theme.permissionAllowOnce }}
          onClick={() => onRespond('allow_once')}
        >
          [y] Allow once
        </button>
        <button
          style={{ ...styles.btn, color: theme.permissionAllowAlways }}
          onClick={() => onRespond('allow_always')}
        >
          [a] Allow always
        </button>
        <button
          style={{ ...styles.btn, color: theme.permissionDeny }}
          onClick={() => onRespond('deny_once')}
        >
          [n] Deny once
        </button>
        <button
          style={{ ...styles.btn, color: theme.permissionDeny }}
          onClick={() => setMode('deny_detail')}
        >
          [d] Deny…
        </button>
        {/* View Details button - always visible if there's something to show */}
        {(permission.previewMeta || permission.args) && (
          <button
            style={{ ...styles.btn, color: 'var(--text-muted)' }}
            onClick={() => setMode('view_detail')}
          >
            [v] Details
          </button>
        )}
      </div>
    </div>
  );
});

const styles: Record<string, React.CSSProperties> = {
  box: {
    border: `1px solid ${theme.permissionBorder}`,
    borderRadius: 'var(--radius-md)',
    padding: '0.5em 1ch',
    margin: '0.25em 1ch',
    boxShadow: 'var(--shadow-md)',
  },
  keys: {
    marginTop: '0.5em',
    display: 'flex',
    gap: '0.5em',
    flexWrap: 'wrap',
  },
  btn: {
    background: 'transparent',
    border: '1px solid var(--border-color)',
    borderRadius: 'var(--radius-sm)',
    padding: '0.4em 1.2ch',
    fontFamily: 'inherit',
    fontSize: 'inherit',
    fontWeight: 'bold',
    cursor: 'pointer',
    minHeight: '2.2em',
    touchAction: 'manipulation',
  },
  input: {
    width: '100%',
    background: 'transparent',
    border: '1px solid var(--border-color)',
    borderRadius: 'var(--radius-sm)',
    padding: '0.4em 0.8ch',
    fontFamily: 'inherit',
    fontSize: 'inherit',
    color: 'inherit',
    outline: 'none',
    minHeight: '2.2em',
    boxSizing: 'border-box' as const,
  },
  detailContent: {
    maxHeight: '300px',
    overflow: 'auto',
    marginBottom: '0.5em',
  },
  diffSection: {
    marginTop: '0.5em',
    padding: '0.5em',
    background: 'rgba(0,0,0,0.2)',
    borderRadius: 'var(--radius-sm)',
  },
  argsSection: {
    marginTop: '0.5em',
  },
  argsPre: {
    margin: 0,
    padding: '0.5em',
    background: 'rgba(0,0,0,0.2)',
    borderRadius: 'var(--radius-sm)',
    fontSize: '0.9em',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    maxHeight: '200px',
    overflow: 'auto',
  },
};
