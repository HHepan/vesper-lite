import React, { useState, useRef } from 'react';
import { theme } from '../../theme.js';

interface TagListInputProps {
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
}

export function TagListInput({ value, onChange, placeholder = 'Type and press Enter' }: TagListInputProps) {
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const addTag = () => {
    const trimmed = input.trim();
    if (trimmed && !value.includes(trimmed)) {
      onChange([...value, trimmed]);
      setInput('');
    }
  };

  const removeTag = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
  };

  return (
    <div style={styles.container} onClick={() => inputRef.current?.focus()}>
      {value.map((tag, i) => (
        <span key={i} style={styles.tag}>
          {tag}
          <button style={styles.removeBtn} onClick={(e) => { e.stopPropagation(); removeTag(i); }}>&times;</button>
        </span>
      ))}
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
        placeholder={value.length === 0 ? placeholder : ''}
      />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '0.3em',
    padding: '0.25em 0.5ch',
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border-color)',
    borderRadius: '2px',
    minHeight: '2em',
    cursor: 'text',
  },
  tag: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.3ch',
    padding: '0 0.5ch',
    background: 'var(--accent-blue)',
    color: 'var(--btn-primary-text, #FFFFFF)',
    borderRadius: '2px',
    fontSize: '0.9em',
  },
  removeBtn: {
    background: 'transparent',
    border: 'none',
    color: theme.dimText,
    cursor: 'pointer',
    padding: 0,
    fontFamily: 'inherit',
    fontSize: 'inherit',
    lineHeight: 1,
  },
  input: {
    flex: 1,
    minWidth: '8ch',
    background: 'transparent',
    border: 'none',
    color: 'var(--text-primary)',
    fontFamily: 'inherit',
    fontSize: 'inherit',
    outline: 'none',
    padding: 0,
  },
};
