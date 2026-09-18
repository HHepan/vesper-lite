import React, { useState, useRef, useCallback } from 'react';
import { theme } from '../../theme.js';

export interface LabeledTag {
  id: string;
  label: string;
}

interface LabeledTagListProps {
  value: LabeledTag[];
  onChange: (value: LabeledTag[]) => void;
  placeholder?: string;
  labelPlaceholder?: string;
}

export function LabeledTagList({ value, onChange, placeholder = '输入 ID 后回车', labelPlaceholder = '备注' }: LabeledTagListProps) {
  const [input, setInput] = useState('');
  // Local buffer for labels being edited (index -> local value).
  // This prevents IME composition from being broken by parent re-renders.
  const [localLabels, setLocalLabels] = useState<Record<number, string>>({});
  const inputRef = useRef<HTMLInputElement>(null);

  const addTag = () => {
    const trimmed = input.trim();
    if (trimmed && !value.some(t => t.id === trimmed)) {
      onChange([...value, { id: trimmed, label: '' }]);
      setInput('');
    }
  };

  const removeTag = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
  };

  const handleLabelChange = useCallback((index: number, label: string) => {
    // Only update local buffer during editing — don't propagate to parent
    setLocalLabels(prev => ({ ...prev, [index]: label }));
  }, []);

  const handleLabelBlur = useCallback((index: number) => {
    // On blur, commit the local value to parent
    const localValue = localLabels[index];
    if (localValue !== undefined) {
      const updated = [...value];
      updated[index] = { ...updated[index], label: localValue };
      onChange(updated);
      // Clear local buffer for this index
      setLocalLabels(prev => {
        const next = { ...prev };
        delete next[index];
        return next;
      });
    }
  }, [value, onChange, localLabels]);

  return (
    <div style={styles.container} onClick={() => inputRef.current?.focus()}>
      {value.map((tag, i) => {
        // Use local buffer if editing, otherwise use prop value
        const displayLabel = localLabels[i] !== undefined ? localLabels[i] : tag.label;
        return (
          <div key={i} style={styles.row}>
            <span style={styles.id}>{tag.id}</span>
            <input
              style={styles.labelInput}
              className="labeled-tag-label-input"
              value={displayLabel}
              onChange={e => handleLabelChange(i, e.target.value)}
              onBlur={() => handleLabelBlur(i)}
              placeholder={labelPlaceholder}
              onClick={e => e.stopPropagation()}
            />
            <button style={styles.removeBtn} onClick={(e) => { e.stopPropagation(); removeTag(i); }}>&times;</button>
          </div>
        );
      })}
      <input
        ref={inputRef}
        style={styles.input}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); addTag(); }
          if (e.key === 'Backspace' && !input && value.length > 0) {
            removeTag(value.length - 1);
          }
        }}
        placeholder={placeholder}
      />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '0.3em',
    padding: '0.4em 0.5ch',
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border-color)',
    borderRadius: '2px',
    minHeight: '2em',
    cursor: 'text',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.4ch',
    padding: '0.1em 0.3ch',
    background: 'var(--accent-blue)',
    borderRadius: '2px',
    fontSize: '0.9em',
    width: '100%',
  },
  id: {
    color: 'var(--btn-primary-text, #FFFFFF)',
    fontWeight: 600,
    minWidth: '7em',
  },
  labelInput: {
    flex: 1,
    background: 'transparent',
    border: 'none',
    color: 'var(--btn-primary-text, #FFFFFF)',
    fontFamily: 'inherit',
    fontSize: '0.9em',
    outline: 'none',
    padding: 0,
    minWidth: '4ch',
  },
  removeBtn: {
    background: 'transparent',
    border: 'none',
    color: 'rgba(255, 255, 255, 0.85)',
    cursor: 'pointer',
    padding: 0,
    fontFamily: 'inherit',
    fontSize: 'inherit',
    lineHeight: 1,
  },
  input: {
    flex: 1,
    minWidth: '12ch',
    background: 'transparent',
    border: 'none',
    color: 'var(--text-primary)',
    fontFamily: 'inherit',
    fontSize: 'inherit',
    outline: 'none',
    padding: '0.2em 0.3ch',
  },
};