// ═══════════════════════════════════════════════════════════════════════════
// Vesper WebUI — DatasetOverwriteDialog (confirmation when dataset dir exists)
// ═══════════════════════════════════════════════════════════════════════════

import React, { memo } from 'react';
import { theme } from '../theme.js';
import { useKeyboard } from '../hooks/useKeyboard.js';

interface DatasetOverwriteDialogProps {
  name: string;
  path: string;
  onRespond: (decision: 'overwrite' | 'cancel') => void;
}

export const DatasetOverwriteDialog = memo(function DatasetOverwriteDialog({
  name,
  path,
  onRespond,
}: DatasetOverwriteDialogProps) {
  useKeyboard((input, key) => {
    if (input === 'y' || input === 'Y') {
      onRespond('overwrite');
    } else if (input === 'n' || input === 'N' || key.escape) {
      onRespond('cancel');
    }
  });

  return (
    <div style={styles.box}>
      <div style={{ color: theme.permissionHeader, fontWeight: 'bold' }}>
        ⚠ 数据集目录已存在
      </div>
      <div style={{ marginTop: '0.25em', color: theme.systemText }}>
        目录 <span style={{ color: theme.permissionTool, fontWeight: 'bold' }}>{name}</span> 已存在于:
      </div>
      <div style={{ color: theme.dimText, marginTop: '0.15em', fontSize: '0.9em', wordBreak: 'break-all' }}>
        {path}
      </div>
      <div style={{ marginTop: '0.35em', color: theme.systemText }}>
        是否覆盖？现有内容将被删除。
      </div>
      <div style={styles.keys}>
        <button
          style={{ ...styles.btn, color: 'var(--status-warning)' }}
          onClick={() => onRespond('overwrite')}
        >
          [y] 覆盖
        </button>
        <button
          style={{ ...styles.btn, color: theme.permissionDeny }}
          onClick={() => onRespond('cancel')}
        >
          [n] 取消
        </button>
      </div>
    </div>
  );
});

const styles: Record<string, React.CSSProperties> = {
  box: {
    border: `1px solid ${theme.permissionBorder}`,
    borderRadius: '4px',
    padding: '0.5em 1ch',
    margin: '0.25em 1ch',
  },
  keys: {
    marginTop: '0.5em',
    display: 'flex',
    gap: '0.5em',
    flexWrap: 'wrap',
  },
  btn: {
    background: 'transparent',
    border: '1px solid var(--text-muted)',
    borderRadius: '3px',
    padding: '0.4em 1.2ch',
    fontFamily: 'inherit',
    fontSize: 'inherit',
    fontWeight: 'bold',
    cursor: 'pointer',
    minHeight: '2.2em',
    touchAction: 'manipulation',
  },
};