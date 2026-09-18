// ═══════════════════════════════════════════════════════════════════════════
// Vesper WebUI — AskUserDialog (TUI style: multi-step question wizard)
// ═══════════════════════════════════════════════════════════════════════════

import React, { memo, useState, useRef, useEffect } from 'react';
import { theme } from '../theme.js';
import { useKeyboard } from '../hooks/useKeyboard.js';
import type { PendingAskUser, AskUserAnswers } from '../store.js';

interface AskUserDialogProps {
  pending: PendingAskUser;
  onRespond: (answers: AskUserAnswers) => void;
}

export const AskUserDialog = memo(function AskUserDialog({
  pending,
  onRespond,
}: AskUserDialogProps) {
  const { questions } = pending;

  const [questionIndex, setQuestionIndex] = useState(0);
  const [cursor, setCursor] = useState(0);
  const [multiSelections, setMultiSelections] = useState<Set<number>>(new Set());
  const [otherMode, setOtherMode] = useState(false);
  const [otherText, setOtherText] = useState('');
  const [answers, setAnswers] = useState<AskUserAnswers>({});
  const otherInputRef = useRef<HTMLInputElement>(null);

  const q = questions[questionIndex];
  if (!q) return null;

  const optionCount = q.options.length + 1; // +1 for "Other"
  const isOtherSelected = cursor === q.options.length;

  // Focus "Other" input when entering other mode
  useEffect(() => {
    if (otherMode && otherInputRef.current) {
      otherInputRef.current.focus();
    }
  }, [otherMode]);

  function advanceWithAnswer(answer: string | string[]): void {
    const key = q.header || q.question;
    const newAnswers = { ...answers, [key]: Array.isArray(answer) ? answer.join(', ') : answer };
    if (questionIndex < questions.length - 1) {
      setAnswers(newAnswers);
      setQuestionIndex(questionIndex + 1);
      setCursor(0);
      setMultiSelections(new Set());
      setOtherMode(false);
      setOtherText('');
    } else {
      onRespond(newAnswers);
    }
  }

  // Keyboard navigation (active when not in other-text mode)
  useKeyboard((input, key) => {
    if (otherMode) return; // Input handles its own keys

    if (key.escape) {
      onRespond({});
      return;
    }

    if (key.upArrow) {
      setCursor(prev => (prev > 0 ? prev - 1 : optionCount - 1));
      return;
    }

    if (key.downArrow) {
      setCursor(prev => (prev < optionCount - 1 ? prev + 1 : 0));
      return;
    }

    if (input === ' ' && q.multiSelect) {
      if (!isOtherSelected) {
        setMultiSelections(prev => {
          const next = new Set(prev);
          if (next.has(cursor)) next.delete(cursor);
          else next.add(cursor);
          return next;
        });
      }
      return;
    }

    if (key.return) {
      if (isOtherSelected) {
        setOtherMode(true);
        setOtherText('');
        return;
      }

      if (q.multiSelect) {
        const selected = Array.from(multiSelections).map(i => q.options[i].label);
        if (selected.length === 0) {
          selected.push(q.options[cursor].label);
        }
        advanceWithAnswer(selected);
      } else {
        advanceWithAnswer(q.options[cursor].label);
      }
    }
  }, { isActive: !otherMode });

  return (
    <div style={styles.box}>
      {/* Header */}
      <div>
        <span style={{ color: theme.askUserHeader, fontWeight: 'bold' }}>? Ask User</span>
        {questions.length > 1 && (
          <span style={{ color: theme.dimText }}> ({questionIndex + 1}/{questions.length})</span>
        )}
      </div>

      {/* Chip + Question */}
      <div style={{ marginTop: '0.25em' }}>
        {q.header && (
          <span style={{ color: theme.askUserChip, fontWeight: 'bold' }}>[{q.header}] </span>
        )}
        <span style={{ color: theme.askUserQuestion }}>{q.question}</span>
      </div>

      {/* Options list */}
      <div style={{ marginTop: '0.5em' }}>
        {q.options.map((opt, i) => {
          const isFocused = cursor === i;
          const isChecked = q.multiSelect ? multiSelections.has(i) : isFocused;
          const indicator = q.multiSelect
            ? (isChecked ? '◉ ' : '○ ')
            : (isFocused ? '❯ ' : '  ');

          return (
            <div
              key={i}
              style={{
                ...styles.option,
                background: isFocused ? theme.autocompleteHighlight : 'transparent',
              }}
              onClick={() => {
                setCursor(i);
                if (q.multiSelect) {
                  setMultiSelections(prev => {
                    const next = new Set(prev);
                    if (next.has(i)) next.delete(i);
                    else next.add(i);
                    return next;
                  });
                } else {
                  advanceWithAnswer(opt.label);
                }
              }}
            >
              <span style={{ color: isFocused ? theme.askUserSelected : theme.dimText }}>{indicator}</span>
              <span style={{ color: theme.askUserOptionLabel, fontWeight: isFocused ? 'bold' : 'normal' }}>
                {opt.label}
              </span>
              {opt.description && (
                <span style={{ color: theme.askUserOptionDesc }}>  {opt.description}</span>
              )}
            </div>
          );
        })}

        {/* "Other" option */}
        <div
          style={{
            ...styles.option,
            background: isOtherSelected ? theme.autocompleteHighlight : 'transparent',
          }}
          onClick={() => {
            setCursor(q.options.length);
            setOtherMode(true);
            setOtherText('');
          }}
        >
          <span style={{ color: isOtherSelected ? theme.askUserSelected : theme.dimText }}>
            {isOtherSelected ? '❯ ' : '  '}
          </span>
          <span style={{ color: theme.askUserOther, fontWeight: isOtherSelected ? 'bold' : 'normal' }}>
            Other
          </span>
          <span style={{ color: theme.askUserOptionDesc }}>  Provide custom text input</span>
        </div>
      </div>

      {/* Freetext input for "Other" */}
      {otherMode && (
        <div style={{ marginTop: '0.5em', display: 'flex', alignItems: 'center', gap: '0.5em' }}>
          <span style={{ color: theme.askUserOther }}>{'> '}</span>
          <input
            ref={otherInputRef}
            style={styles.otherInput}
            value={otherText}
            onChange={(e) => setOtherText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                advanceWithAnswer(otherText.trim() || '(no response)');
              } else if (e.key === 'Escape') {
                setOtherMode(false);
                setOtherText('');
              }
            }}
            spellCheck={false}
          />
          <button
            style={styles.actionBtn}
            onClick={() => advanceWithAnswer(otherText.trim() || '(no response)')}
          >
            Submit
          </button>
          <button
            style={styles.actionBtn}
            onClick={() => { setOtherMode(false); setOtherText(''); }}
          >
            Back
          </button>
        </div>
      )}

      {/* Action buttons + hints */}
      <div style={styles.actions}>
        {q.multiSelect && !otherMode && (
          <>
            <button
              style={styles.actionBtn}
              onClick={() => {
                const selected = Array.from(multiSelections).map(i => q.options[i].label);
                if (selected.length === 0 && cursor < q.options.length) {
                  selected.push(q.options[cursor].label);
                }
                advanceWithAnswer(selected);
              }}
            >
              Confirm
            </button>
            <button
              style={styles.actionBtn}
              onClick={() => onRespond({})}
            >
              Cancel
            </button>
          </>
        )}
        {!q.multiSelect && !otherMode && (
          <button
            style={styles.actionBtn}
            onClick={() => onRespond({})}
          >
            Cancel
          </button>
        )}
        <span style={{ color: theme.dimText, marginLeft: '0.5em' }}>
          {q.multiSelect
            ? 'Tap to toggle'
            : 'Tap to select'
          }
        </span>
      </div>
    </div>
  );
});

const styles: Record<string, React.CSSProperties> = {
  box: {
    border: `1px solid ${theme.askUserBorder}`,
    borderRadius: 'var(--radius-md)',
    padding: '0.5em 1ch',
    margin: '0.25em 1ch',
    boxShadow: 'var(--shadow-md)',
  },
  option: {
    padding: '0.3em 1ch',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    minHeight: '2em',
    display: 'flex',
    alignItems: 'center',
    touchAction: 'manipulation',
  },
  otherInput: {
    flex: 1,
    background: 'transparent',
    border: 'none',
    outline: 'none',
    color: 'var(--text-primary)',
    fontFamily: 'inherit',
    fontSize: 'inherit',
    padding: 0,
    margin: 0,
  },
  actions: {
    marginTop: '0.5em',
    display: 'flex',
    alignItems: 'center',
    gap: '0.5em',
    flexWrap: 'wrap',
  },
  actionBtn: {
    background: 'transparent',
    border: `1px solid ${theme.border}`,
    borderRadius: 'var(--radius-sm)',
    padding: '0.3em 1.2ch',
    color: theme.promptText,
    fontFamily: 'inherit',
    fontSize: 'inherit',
    cursor: 'pointer',
    minHeight: '2em',
    touchAction: 'manipulation',
  },
};
