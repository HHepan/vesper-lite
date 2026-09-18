import React, { useState, type ReactNode } from 'react';
import { theme } from '../../theme.js';

interface MapEditorProps<T> {
  value: Record<string, T>;
  onChange: (value: Record<string, T>) => void;
  renderItem: (key: string, item: T, onChange: (item: T) => void) => ReactNode;
  createDefault: () => T;
  addLabel?: string;
}

export function MapEditor<T>({ value, onChange, renderItem, createDefault, addLabel = 'Add entry' }: MapEditorProps<T>) {
  const [newKey, setNewKey] = useState('');

  const entries = Object.entries(value);

  const addEntry = () => {
    const k = newKey.trim();
    if (!k || k in value) return;
    onChange({ ...value, [k]: createDefault() });
    setNewKey('');
  };

  const removeEntry = (key: string) => {
    const copy = { ...value };
    delete copy[key];
    onChange(copy);
  };

  const updateEntry = (key: string, item: T) => {
    onChange({ ...value, [key]: item });
  };

  return (
    <div style={styles.container}>
      {entries.map(([k, item]) => (
        <div key={k} style={styles.entry}>
          <div style={styles.entryHeader}>
            <span style={styles.entryKey}>{k}</span>
            <button style={styles.removeBtn} onClick={() => removeEntry(k)}>&times; remove</button>
          </div>
          <div style={styles.entryBody}>
            {renderItem(k, item, (updated) => updateEntry(k, updated))}
          </div>
        </div>
      ))}
      <div style={styles.addRow}>
        <input
          style={styles.addInput}
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          placeholder="name"
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) addEntry(); }}
        />
        <button style={styles.addBtn} onClick={addEntry}>+ {addLabel}</button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75em',
  },
  entry: {
    border: '1px solid var(--border-color)',
    borderRadius: '3px',
    overflow: 'hidden',
  },
  entryHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0.3em 0.8ch',
    background: 'var(--bg-secondary)',
    borderBottom: '1px solid var(--border-color)',
  },
  entryKey: {
    color: theme.toolName,
    fontWeight: 'bold',
  },
  removeBtn: {
    background: 'transparent',
    border: 'none',
    color: theme.errorText,
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: '0.85em',
  },
  entryBody: {
    padding: '0.5em 0.8ch',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5em',
  },
  addRow: {
    display: 'flex',
    gap: '0.5ch',
  },
  addInput: {
    flex: 1,
    padding: '0.25em 0.5ch',
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border-color)',
    borderRadius: '2px',
    color: 'var(--text-primary)',
    fontFamily: 'inherit',
    fontSize: 'inherit',
    outline: 'none',
  },
  addBtn: {
    padding: '0.25em 1ch',
    background: 'var(--accent-blue)',
    border: 'none',
    borderRadius: '2px',
    color: 'var(--btn-primary-text, #FFFFFF)',
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: 'inherit',
  },
};
