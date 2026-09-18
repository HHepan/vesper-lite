// ═══════════════════════════════════════════════════════════════════════════
// Vesper TUI — Ask User Dialog Component
//
// Steps through questions one at a time, allowing single-select or
// multi-select with an auto-added "Other" freetext option.
// ═══════════════════════════════════════════════════════════════════════════

import React, { useState, memo } from 'react';
import { Box, Text, useInput } from 'ink';
import type { PendingAskUser } from '../store.js';
import type { AskUserAnswers } from '@vesper/shared';
import { theme } from '../theme.js';

interface AskUserDialogProps {
  pending: PendingAskUser;
  onRespond: (answers: AskUserAnswers) => void;
}

export const AskUserDialog = memo(function AskUserDialog({
  pending,
  onRespond,
}: AskUserDialogProps): React.JSX.Element {
  const { questions } = pending;

  // State: current question index, cursor position, selections, "Other" mode, answers
  const [questionIndex, setQuestionIndex] = useState(0);
  const [cursor, setCursor] = useState(0);
  const [multiSelections, setMultiSelections] = useState<Set<number>>(new Set());
  const [otherMode, setOtherMode] = useState(false);
  const [otherText, setOtherText] = useState('');
  const [answers, setAnswers] = useState<AskUserAnswers>({});

  const q = questions[questionIndex];
  // Options: original options + "Other" appended
  const optionCount = q.options.length + 1; // +1 for "Other"
  const isOtherSelected = cursor === q.options.length;

  useInput((input, key) => {
    if (otherMode) {
      // Freetext input mode
      if (key.return) {
        const text = otherText.trim() || '(no response)';
        advanceWithAnswer(text);
        return;
      }
      if (key.escape) {
        setOtherMode(false);
        setOtherText('');
        return;
      }
      if (key.backspace || key.delete) {
        setOtherText((prev) => prev.slice(0, -1));
        return;
      }
      if (!key.ctrl && !key.meta && input) {
        setOtherText((prev) => prev + input);
      }
      return;
    }

    // Normal navigation mode
    if (key.escape) {
      // Cancel — submit empty
      onRespond({});
      return;
    }

    if (key.upArrow) {
      setCursor((prev) => (prev > 0 ? prev - 1 : optionCount - 1));
      return;
    }

    if (key.downArrow) {
      setCursor((prev) => (prev < optionCount - 1 ? prev + 1 : 0));
      return;
    }

    if (input === ' ' && q.multiSelect) {
      // Toggle multi-select
      if (!isOtherSelected) {
        setMultiSelections((prev) => {
          const next = new Set(prev);
          if (next.has(cursor)) {
            next.delete(cursor);
          } else {
            next.add(cursor);
          }
          return next;
        });
      }
      return;
    }

    if (key.return) {
      if (isOtherSelected) {
        // Enter "Other" freetext mode
        setOtherMode(true);
        setOtherText('');
        return;
      }

      if (q.multiSelect) {
        // Confirm multi-selection
        const selected = Array.from(multiSelections).map((i) => q.options[i].label);
        // If nothing selected, treat current cursor as single select
        if (selected.length === 0) {
          selected.push(q.options[cursor].label);
        }
        advanceWithAnswer(selected);
      } else {
        // Single-select
        advanceWithAnswer(q.options[cursor].label);
      }
    }
  });

  function advanceWithAnswer(answer: string | string[]): void {
    const newAnswers = { ...answers, [q.header]: answer };
    if (questionIndex < questions.length - 1) {
      // More questions
      setAnswers(newAnswers);
      setQuestionIndex(questionIndex + 1);
      setCursor(0);
      setMultiSelections(new Set());
      setOtherMode(false);
      setOtherText('');
    } else {
      // All questions answered
      onRespond(newAnswers);
    }
  }

  // Check if focused option has markdown for preview
  const focusedOption = !isOtherSelected ? q.options[cursor] : null;
  const hasPreview = focusedOption?.markdown;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.askUserBorder}
      paddingLeft={1.5}
      paddingRight={1.5}
      paddingTop={0.5}
      paddingBottom={0.5}
    >
      {/* Header */}
      <Box>
        <Text color={theme.askUserHeader} bold>{' ? Ask User '}</Text>
        {questions.length > 1 && (
          <Text color={theme.dimText}>{` (${questionIndex + 1}/${questions.length})`}</Text>
        )}
      </Box>

      {/* Chip + Question */}
      <Box marginTop={0}>
        <Text color={theme.askUserChip} bold>{`[${q.header}]`}</Text>
        <Text color={theme.askUserQuestion}>{` ${q.question}`}</Text>
      </Box>

      {/* Options list + optional preview */}
      <Box flexDirection="row" marginTop={1}>
        {/* Options column */}
        <Box flexDirection="column" flexShrink={0}>
          {q.options.map((opt, i) => {
            const isFocused = cursor === i;
            const isChecked = q.multiSelect ? multiSelections.has(i) : isFocused;
            const indicator = q.multiSelect
              ? (isChecked ? '  ' : '  ')
              : (isFocused ? '  ' : '  ');

            return (
              <Box key={i}>
                <Text color={isFocused ? theme.askUserSelected : undefined}>
                  {indicator}
                </Text>
                <Text color={isFocused ? theme.askUserOptionLabel : theme.askUserOptionLabel} bold={isFocused}>
                  {opt.label}
                </Text>
                <Text color={theme.askUserOptionDesc}>{`  ${opt.description}`}</Text>
              </Box>
            );
          })}
          {/* "Other" option */}
          <Box>
            <Text color={isOtherSelected ? theme.askUserSelected : undefined}>
              {isOtherSelected ? '  ' : '  '}
            </Text>
            <Text color={theme.askUserOther} bold={isOtherSelected}>Other</Text>
            <Text color={theme.askUserOptionDesc}>  Provide custom text input</Text>
          </Box>
        </Box>

        {/* Preview column (markdown) */}
        {hasPreview && (
          <Box flexDirection="column" marginLeft={2} borderStyle="single" borderColor={theme.dimText} paddingLeft={1} paddingRight={1}>
            <Text color={theme.dimText} bold>Preview</Text>
            <Text>{focusedOption!.markdown}</Text>
          </Box>
        )}
      </Box>

      {/* Freetext input for "Other" */}
      {otherMode && (
        <Box marginTop={1}>
          <Text color={theme.askUserOther}>{'> '}</Text>
          <Text>{otherText}</Text>
          <Text color={theme.streamingCursor}>{'_'}</Text>
        </Box>
      )}

      {/* Hints */}
      <Box marginTop={1}>
        {q.multiSelect ? (
          <Text color={theme.dimText}>{'[Space] toggle  [Enter] confirm  [Esc] cancel'}</Text>
        ) : (
          <Text color={theme.dimText}>{'[Enter] select  [Esc] cancel'}</Text>
        )}
      </Box>
    </Box>
  );
});
