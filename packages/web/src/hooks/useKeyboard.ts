// =============================================================================
// Vesper WebUI — useKeyboard hook (replaces Ink's useInput)
//
// Listens to document keydown events and maps to Ink-compatible KeyEvent.
// Skips when an <input>/<textarea> has focus (let them handle their own keys).
// =============================================================================

import { useEffect, useRef } from 'react';

export interface KeyEvent {
  key: string;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  escape: boolean;
  return: boolean;
  tab: boolean;
  upArrow: boolean;
  downArrow: boolean;
  leftArrow: boolean;
  rightArrow: boolean;
  backspace: boolean;
  delete: boolean;
}

export type KeyHandler = (input: string, key: KeyEvent) => void;

export function useKeyboard(
  handler: KeyHandler,
  opts?: { isActive?: boolean },
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  const isActive = opts?.isActive ?? true;

  useEffect(() => {
    if (!isActive) return;

    function onKeyDown(e: globalThis.KeyboardEvent): void {
      // Don't intercept when input/textarea has focus
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      const key: KeyEvent = {
        key: e.key,
        ctrl: e.ctrlKey,
        meta: e.metaKey,
        shift: e.shiftKey,
        escape: e.key === 'Escape',
        return: e.key === 'Enter',
        tab: e.key === 'Tab',
        upArrow: e.key === 'ArrowUp',
        downArrow: e.key === 'ArrowDown',
        leftArrow: e.key === 'ArrowLeft',
        rightArrow: e.key === 'ArrowRight',
        backspace: e.key === 'Backspace',
        delete: e.key === 'Delete',
      };

      // Derive a printable character string (single char or empty)
      let input = '';
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
        input = e.key;
      }

      handlerRef.current(input, key);
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isActive]);
}
