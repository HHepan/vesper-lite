import React, { useState } from 'react';
import { theme } from '../../theme.js';

interface KeyValueEditorProps {
  value: Record<string, string>;
  onChange: (value: Record<string, string>) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
}

export function KeyValueEditor({ value, onChange, keyPlaceholder = 'key', valuePlaceholder = 'value' }: KeyValueEditorProps) {
  const [newKey, setNewKey] = useState('');
  const [newVal, setNewVal] = useState('');

  const entries = Object.entries(value);

  const addEntry = () => {
    const k = newKey.trim();
    if (!k) return;
    onChange({ ...value, [k]: newVal });
    setNewKey('');
    setNewVal('');
  };

  const removeEntry = (key: string) => {
    const copy = { ...value };
    delete copy[key];
    onChange(copy);
  };

  const updateValue = (key: string, val: string) => {
    onChange({ ...value, [key]: val });
  };

  return (
    <div style={styles.container}>
      {entries.map(([k, v]) => (
        <div key={k} style={styles.row}>
          <span style={styles.key}>{k}</span>
          <input
            style={styles.valInput}
            value={v}
            onChange={(e) => updateValue(k, e.target.value)}
          />
          <button style={styles.removeBtn} onClick={() => removeEntry(k)}>&times;</button>
        </div>
      ))}
      <div style={styles.row}>
        <input
          style={styles.keyInput}
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          placeholder={keyPlaceholder}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) addEntry(); }}
        />
        <input
          style={styles.valInput}
          value={newVal}
          onChange={(e) => setNewVal(e.target.value)}
          placeholder={valuePlaceholder}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) addEntry(); }}
        />
        <button style={styles.addBtn} onClick={addEntry}>+</button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.3em',
  },
  row: {
    display: 'flex',
    gap: '0.5ch',
    alignItems: 'center',
  },
  key: {
    color: theme.toolName,
    minWidth: '10ch',
    fontSize: '0.9em',
  },
  keyInput: {
    minWidth: '10ch',
    flex: '0 0 10ch',
    padding: '0.2em 0.5ch',
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border-color)',
    borderRadius: '2px',
    color: 'var(--text-primary)',
    fontFamily: 'inherit',
    fontSize: 'inherit',
    outline: 'none',
  },
  valInput: {
    flex: 1,
    padding: '0.2em 0.5ch',
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border-color)',
    borderRadius: '2px',
    color: 'var(--text-primary)',
    fontFamily: 'inherit',
    fontSize: 'inherit',
    outline: 'none',
  },
  removeBtn: {
    background: 'transparent',
    border: 'none',
    color: theme.errorText,
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: '1.1em',
    padding: '0 0.3ch',
  },
  addBtn: {
    background: 'var(--accent-blue)',
    border: 'none',
    borderRadius: '2px',
    color: 'var(--btn-primary-text, #FFFFFF)',
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: 'inherit',
    padding: '0.2em 0.8ch',
  },
};
