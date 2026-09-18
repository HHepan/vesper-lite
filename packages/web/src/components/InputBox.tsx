// ═══════════════════════════════════════════════════════════════════════════
// Vesper WebUI — InputBox (TUI style: > prompt marker + multiline text input)
//
// Features: Shift+Enter for newline, Enter to submit, auto-resize height,
// history navigation (↑↓), slash-command autocomplete, @-mention file search,
// escape to abort.
// Image support: Alt+V paste, Alt+←/→ select, Delete/Backspace remove.
// ═══════════════════════════════════════════════════════════════════════════

import React, { memo, useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { theme } from '../theme.js';
import { filterCommands } from '../slash-commands.js';
import { SlashCommandMenu } from './SlashCommandMenu.js';
import { AtMentionMenu, type FileSearchResultItem } from './AtMentionMenu.js';

/** Image queued for submission alongside the text prompt. */
export interface PendingImage {
  id: string;
  mimeType: string;
  data: string;           // base64
  filename: string;
  width?: number;
  height?: number;
  sizeBytes: number;
  thumbnailUrl: string;   // object URL for preview
}

const MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20MB — same as read tool limit
const SUPPORTED_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

/** Callback signature for @-mention file search. */
export type FileSearchFn = (query: string, callback: (results: FileSearchResultItem[]) => void) => void;

/** A flow-control action button to render inline in the InputBox row. */
export interface FlowAction {
  label: string;
  title: string;
  onClick: () => void;
  /** If true, render with reduced opacity (e.g. secondary action in error state). */
  dimmed?: boolean;
}

interface InputBoxProps {
  onSubmit: (input: string, images?: PendingImage[]) => void;
  onEscape?: () => void;
  disabled: boolean;
  inputHistory?: string[];
  /** File search callback for @-mention autocomplete. If omitted, @-mentions are disabled. */
  onFileSearch?: FileSearchFn;
  /** Flow-control actions (pause, regenerate, etc.) rendered before the ✕ button. */
  flowActions?: FlowAction[];
  /** Optional custom extra element to place at the start of the top floating bar (e.g. mobile message timeline button). */
  floatingActionsPrefix?: React.ReactNode;
}

let nextImgId = 0;

export const InputBox = memo(function InputBox({
  onSubmit,
  onEscape,
  disabled,
  inputHistory = [],
  onFileSearch,
  flowActions,
  floatingActionsPrefix,
}: InputBoxProps) {
  const [value, setValue] = useState('');
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [images, setImages] = useState<PendingImage[]>([]);
  const [selectedImageIdx, setSelectedImageIdx] = useState(-1);
  const savedBufferRef = useRef('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── @-mention state ───────────────────────────────────────────────────
  const [atMentionResults, setAtMentionResults] = useState<FileSearchResultItem[]>([]);
  const [atMentionHighlight, setAtMentionHighlight] = useState(0);
  const [atMentionQuery, setAtMentionQuery] = useState('');
  /** Start index of the '@' in the input value. -1 = no active @-mention. */
  const [atMentionStart, setAtMentionStart] = useState(-1);
  const atSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const atSearchSeq = useRef(0);
  /** Timestamp of last compositionend — used to guard against Chrome firing
   *  a non-composing Enter immediately after IME confirmation. */
  const compositionEndTime = useRef(0);

  // Auto-focus textarea when not disabled
  useEffect(() => {
    if (!disabled && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [disabled]);

  // Cleanup object URLs on unmount or when images change
  useEffect(() => {
    return () => {
      images.forEach(img => URL.revokeObjectURL(img.thumbnailUrl));
    };
  }, [images]);

  // Auto-resize textarea height based on content
  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  useEffect(() => {
    autoResize();
  }, [value, autoResize]);

  // Menu is open when typing a slash command prefix
  const menuOpen = !disabled && value.startsWith('/') && !value.includes(' ') && historyIndex === -1;

  const filteredCommands = useMemo(() => {
    if (!menuOpen) return [];
    return filterCommands(value.slice(1));
  }, [menuOpen, value]);

  const hasMenuItems = menuOpen && filteredCommands.length > 0;

  // ── @-mention detection & search ──────────────────────────────────────

  /**
   * Find the active @-mention token around the cursor position.
   * Returns { start, query } or null if no active @-mention.
   * An @-mention starts with '@' preceded by start-of-string or whitespace,
   * and extends to the cursor position without any whitespace in between.
   */
  const findAtMention = useCallback((): { start: number; query: string } | null => {
    const el = textareaRef.current;
    if (!el || !onFileSearch) return null;
    const cursor = el.selectionStart;
    const text = value.slice(0, cursor);

    // Walk backwards from cursor to find '@'
    let i = cursor - 1;
    while (i >= 0 && !/\s/.test(text[i]) && text[i] !== '@') {
      i--;
    }
    if (i < 0 || text[i] !== '@') return null;

    // '@' must be at start of string or preceded by whitespace
    if (i > 0 && !/\s/.test(text[i - 1])) return null;

    const query = text.slice(i + 1);
    return { start: i, query };
  }, [value, onFileSearch]);

  /** Trigger debounced file search when @-mention query changes. */
  const triggerAtSearch = useCallback((query: string) => {
    if (!onFileSearch) return;
    if (atSearchTimer.current) clearTimeout(atSearchTimer.current);

    const seq = ++atSearchSeq.current;
    // Empty query (just typed '@') → send immediately with no debounce
    // to show top-level directory listing right away.
    const delay = query ? 150 : 0;
    atSearchTimer.current = setTimeout(() => {
      onFileSearch(query, (results) => {
        // Only apply if this is still the latest request
        if (seq === atSearchSeq.current) {
          setAtMentionResults(results);
          setAtMentionHighlight(0);
        }
      });
    }, delay);
  }, [onFileSearch]);

  // Clean up search timer on unmount
  useEffect(() => {
    return () => {
      if (atSearchTimer.current) clearTimeout(atSearchTimer.current);
    };
  }, []);

  const atMentionActive = atMentionStart >= 0 && !disabled && !menuOpen;
  const hasAtMentionItems = atMentionActive && atMentionResults.length > 0;

  /** Accept the highlighted @-mention result — insert the path into the text. */
  const acceptAtMention = useCallback((item: FileSearchResultItem) => {
    if (atMentionStart < 0) return;
    // Replace from '@' to cursor position with '@path '
    const el = textareaRef.current;
    const cursor = el?.selectionStart ?? value.length;
    const before = value.slice(0, atMentionStart);
    const after = value.slice(cursor);
    const inserted = `@${item.absolutePath ?? item.path} `;
    const newValue = before + inserted + after;
    setValue(newValue);
    setAtMentionStart(-1);
    setAtMentionResults([]);
    setAtMentionQuery('');
    setAtMentionHighlight(0);

    // Restore cursor position after React re-render
    const newCursor = before.length + inserted.length;
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.selectionStart = newCursor;
        textareaRef.current.selectionEnd = newCursor;
        textareaRef.current.focus();
      }
    });
  }, [atMentionStart, value]);

  /** Close the @-mention menu without accepting. */
  const dismissAtMention = useCallback(() => {
    setAtMentionStart(-1);
    setAtMentionResults([]);
    setAtMentionQuery('');
    setAtMentionHighlight(0);
    if (atSearchTimer.current) clearTimeout(atSearchTimer.current);
  }, []);

  // ── Image handling ─────────────────────────────────────────────────────

  /** Read a File/Blob into a PendingImage. Returns null if invalid. */
  const fileToImage = useCallback(async (file: File | Blob): Promise<PendingImage | null> => {
    const mimeType = file.type;
    if (!SUPPORTED_TYPES.has(mimeType)) return null;
    if (file.size > MAX_IMAGE_SIZE) return null;

    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        resolve(dataUrl.slice(dataUrl.indexOf(',') + 1));
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });

    const filename = (file instanceof File) ? file.name : `image-${Date.now()}.${mimeType.split('/')[1]}`;
    const thumbnailUrl = URL.createObjectURL(file);

    // Try to extract dimensions from an Image element
    const dims = await new Promise<{ width: number; height: number } | null>((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => resolve(null);
      img.src = thumbnailUrl;
    });

    return {
      id: `img-${++nextImgId}`,
      mimeType,
      data: base64,
      filename,
      ...(dims ?? {}),
      sizeBytes: file.size,
      thumbnailUrl,
    };
  }, []);

  /** Add images from clipboard data (Alt+V) or drag-drop. */
  const addImagesFromDataTransfer = useCallback(async (dt: DataTransfer) => {
    const pending: Promise<PendingImage | null>[] = [];
    for (let i = 0; i < dt.items.length; i++) {
      const item = dt.items[i];
      if (item.kind === 'file' && SUPPORTED_TYPES.has(item.type)) {
        const file = item.getAsFile();
        if (file) pending.push(fileToImage(file));
      }
    }
    const results = await Promise.all(pending);
    const valid = results.filter((r): r is PendingImage => r !== null);
    if (valid.length > 0) {
      setImages(prev => [...prev, ...valid]);
      setSelectedImageIdx(-1);
    }
  }, [fileToImage]);

  const removeImage = useCallback((idx: number) => {
    setImages(prev => {
      const removed = prev[idx];
      if (removed) URL.revokeObjectURL(removed.thumbnailUrl);
      const next = prev.filter((_, i) => i !== idx);
      return next;
    });
    setSelectedImageIdx(-1);
  }, []);

  // ── Clear state helper (shared between submit paths) ───────────────────

  const clearInput = useCallback(() => {
    setValue('');
    setImages(prev => { prev.forEach(img => URL.revokeObjectURL(img.thumbnailUrl)); return []; });
    setSelectedImageIdx(-1);
    setHistoryIndex(-1);
    setHighlightIndex(0);
    savedBufferRef.current = '';
    dismissAtMention();
  }, [dismissAtMention]);

  // ── Event handlers ─────────────────────────────────────────────────────

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    const cursor = e.target.selectionStart;
    setValue(newValue);
    setHistoryIndex(-1);
    setHighlightIndex(0);

    // Detect @-mention synchronously — cursor position is available right here
    if (onFileSearch) {
      const text = newValue.slice(0, cursor);

      // Walk backwards from cursor to find '@'
      let i = cursor - 1;
      while (i >= 0 && !/\s/.test(text[i]) && text[i] !== '@') {
        i--;
      }

      if (i >= 0 && text[i] === '@' && (i === 0 || /\s/.test(text[i - 1]))) {
        const query = text.slice(i + 1);
        setAtMentionStart(i);
        setAtMentionQuery(query);
        triggerAtSearch(query);
      } else {
        dismissAtMention();
      }
    }
  }, [onFileSearch, triggerAtSearch, dismissAtMention]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Escape → close @-mention menu first, then abort
    if (e.key === 'Escape') {
      if (atMentionActive) {
        e.preventDefault();
        dismissAtMention();
        return;
      }
      onEscape?.();
      return;
    }

    // Alt+V → paste image from clipboard
    if (e.altKey && e.code === 'KeyV') {
      e.preventDefault();
      navigator.clipboard.read().then(async (clipboardItems) => {
        for (const ci of clipboardItems) {
          for (const type of ci.types) {
            if (SUPPORTED_TYPES.has(type)) {
              const blob = await ci.getType(type);
              const img = await fileToImage(blob);
              if (img) setImages(prev => [...prev, img]);
            }
          }
        }
      }).catch((err) => {
        console.warn('[InputBox] Alt+V clipboard read failed:', err);
      });
      return;
    }

    // Alt+← / Alt+→ → select images
    if (e.altKey && e.key === 'ArrowLeft' && images.length > 0) {
      e.preventDefault();
      setSelectedImageIdx(prev => prev <= 0 ? images.length - 1 : prev - 1);
      return;
    }
    if (e.altKey && e.key === 'ArrowRight' && images.length > 0) {
      e.preventDefault();
      setSelectedImageIdx(prev => prev >= images.length - 1 ? 0 : prev + 1);
      return;
    }

    // Delete/Backspace → remove selected image
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedImageIdx >= 0 && selectedImageIdx < images.length) {
      e.preventDefault();
      removeImage(selectedImageIdx);
      return;
    }

    // ── @-mention menu keyboard handling ─────────────────────────────
    if (atMentionActive) {
      if (hasAtMentionItems) {
        if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing)) {
          e.preventDefault();
          const item = atMentionResults[Math.min(atMentionHighlight, atMentionResults.length - 1)];
          if (item) acceptAtMention(item);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setAtMentionHighlight(prev => prev <= 0 ? atMentionResults.length - 1 : prev - 1);
          return;
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setAtMentionHighlight(prev => prev >= atMentionResults.length - 1 ? 0 : prev + 1);
          return;
        }
      }
      // Space dismisses @-mention if query is empty (just typed '@' then space)
      if (e.key === ' ' && atMentionQuery === '') {
        dismissAtMention();
        // Let the space be typed normally
      }
    }

    // Tab → accept highlighted command
    if (e.key === 'Tab' && hasMenuItems) {
      e.preventDefault();
      const cmd = filteredCommands[highlightIndex];
      if (cmd) {
        setValue('/' + cmd.name + (cmd.argHint ? ' ' : ''));
        setHighlightIndex(0);
      }
      return;
    }

    // Enter handling
    if (e.key === 'Enter') {
      // Skip if IME is composing (e.g. typing pinyin/Japanese to select a candidate).
      // Also guard against Chrome where compositionend fires *before* the keydown,
      // making isComposing false even though the Enter was meant to confirm a candidate.
      if (e.nativeEvent.isComposing || Date.now() - compositionEndTime.current < 50) {
        return;
      }

      // Shift+Enter → insert newline (let browser handle it)
      if (e.shiftKey) {
        return;
      }

      e.preventDefault();

      // Menu open → accept menu item
      if (hasMenuItems) {
        const cmd = filteredCommands[Math.min(highlightIndex, filteredCommands.length - 1)];
        if (cmd) {
          if (cmd.argHint) {
            setValue('/' + cmd.name + ' ');
            setHighlightIndex(0);
          } else {
            onSubmit('/' + cmd.name);
            clearInput();
          }
          return;
        }
      }

      // Submit non-empty input (text or images)
      const trimmed = value.trim();
      if (trimmed || images.length > 0) {
        onSubmit(trimmed || '(images)', images.length > 0 ? images : undefined);
        clearInput();
      }
      return;
    }

    // Up arrow → navigate history or menu (only when at first line)
    if (e.key === 'ArrowUp') {
      if (hasMenuItems) {
        e.preventDefault();
        setHighlightIndex(prev => prev <= 0 ? filteredCommands.length - 1 : prev - 1);
        return;
      }

      // Only navigate history when cursor is on the first line
      const el = textareaRef.current;
      if (el) {
        const cursorPos = el.selectionStart;
        const textBeforeCursor = value.slice(0, cursorPos);
        if (textBeforeCursor.includes('\n')) {
          // Not on first line — let browser handle cursor movement
          return;
        }
      }

      e.preventDefault();
      if (inputHistory.length === 0) return;
      if (historyIndex === -1) {
        savedBufferRef.current = value;
        const newIdx = inputHistory.length - 1;
        setHistoryIndex(newIdx);
        setValue(inputHistory[newIdx]);
      } else if (historyIndex > 0) {
        const newIdx = historyIndex - 1;
        setHistoryIndex(newIdx);
        setValue(inputHistory[newIdx]);
      }
      return;
    }

    // Down arrow → navigate history or menu (only when at last line)
    if (e.key === 'ArrowDown') {
      if (hasMenuItems) {
        e.preventDefault();
        setHighlightIndex(prev => prev >= filteredCommands.length - 1 ? 0 : prev + 1);
        return;
      }

      // Only navigate history when cursor is on the last line
      const el = textareaRef.current;
      if (el) {
        const cursorPos = el.selectionStart;
        const textAfterCursor = value.slice(cursorPos);
        if (textAfterCursor.includes('\n')) {
          // Not on last line — let browser handle cursor movement
          return;
        }
      }

      e.preventDefault();
      if (historyIndex === -1) return;
      if (historyIndex < inputHistory.length - 1) {
        const newIdx = historyIndex + 1;
        setHistoryIndex(newIdx);
        setValue(inputHistory[newIdx]);
      } else {
        setHistoryIndex(-1);
        setValue(savedBufferRef.current);
        savedBufferRef.current = '';
      }
      return;
    }

    // Any other key deselects image
    if (selectedImageIdx >= 0) {
      setSelectedImageIdx(-1);
    }
  }, [value, onSubmit, onEscape, historyIndex, inputHistory, hasMenuItems, filteredCommands,
      highlightIndex, images, selectedImageIdx, removeImage, clearInput, fileToImage,
      atMentionActive, hasAtMentionItems, atMentionResults, atMentionHighlight,
      atMentionQuery, acceptAtMention, dismissAtMention]);

  // Drag-and-drop image support
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) {
      addImagesFromDataTransfer(e.dataTransfer);
    }
  }, [addImagesFromDataTransfer]);

  if (disabled) {
    return (
      <div style={styles.row}>
        <span style={{ color: theme.dimText, opacity: 0.5 }}>{'> ...'}</span>
      </div>
    );
  }

  // Height: starts at 1 line, grows with content, capped at 5 lines (maxHeight in styles)
  return (
    <div onDragOver={handleDragOver} onDrop={handleDrop} style={{ position: 'relative' }}>
      {/* Top right floating action bar: custom prefix + regenerate / pause / abort */}
      {((flowActions && flowActions.length > 0) || onEscape || floatingActionsPrefix) && (
        <div style={styles.topFloatingBar}>
          {floatingActionsPrefix}
          {flowActions && flowActions.length > 0 && flowActions.map((action, i) => (
            <button
              key={i}
              style={{ ...styles.flowBtn, ...(action.dimmed ? styles.flowBtnDimmed : {}) }}
              onClick={action.onClick}
              title={action.title}
            >
              {action.label}
            </button>
          ))}
          {onEscape && (
            <button
              style={styles.abortBtn}
              onClick={onEscape}
              title="中断当前生成 (Esc)"
            >
              ✕
            </button>
          )}
        </div>
      )}

      {/* Image preview strip */}
      {images.length > 0 && (
        <div style={styles.imageStrip}>
          {images.map((img, idx) => (
            <div
              key={img.id}
              style={{
                ...styles.imageThumbnail,
                ...(idx === selectedImageIdx ? styles.imageThumbnailSelected : {}),
              }}
              onClick={() => setSelectedImageIdx(idx === selectedImageIdx ? -1 : idx)}
              title={`${img.filename} (${Math.round(img.sizeBytes / 1024)}kB)${img.width ? ` ${img.width}×${img.height}` : ''}\nAlt+←/→ to select, Delete to remove`}
            >
              <img src={img.thumbnailUrl} alt={img.filename} style={styles.imagePreview} />
              <button
                style={styles.imageRemoveBtn}
                onClick={(e) => { e.stopPropagation(); removeImage(idx); }}
                title="Remove"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={styles.inputWrapper} className="input-box-wrapper">
        <div style={styles.row}>
          <span style={styles.prompt}>{'>'}</span>
          <textarea
            ref={textareaRef}
            className="tui-input"
            style={styles.textarea}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onCompositionEnd={() => { compositionEndTime.current = Date.now(); }}
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            rows={1}
          />
        </div>
      </div>
      {hasMenuItems && (
        <SlashCommandMenu
          commands={filteredCommands}
          highlightIndex={highlightIndex}
          onSelect={(cmd) => {
            if (cmd.argHint) {
              setValue('/' + cmd.name + ' ');
              setHighlightIndex(0);
            } else {
              onSubmit('/' + cmd.name);
              clearInput();
            }
          }}
        />
      )}
      {atMentionActive && (
        <AtMentionMenu
          results={atMentionResults}
          highlightIndex={atMentionHighlight}
          query={atMentionQuery}
          onSelect={acceptAtMention}
        />
      )}
    </div>
  );
});

const styles: Record<string, React.CSSProperties> = {
  inputWrapper: {
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--bg-primary)',
    border: '1px solid var(--border-color)',
    borderRadius: 'var(--radius-lg)',
    boxShadow: 'var(--shadow-md)',
    padding: '0.4em 0.8ch',
    transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
  },
  row: {
    display: 'flex',
    alignItems: 'flex-start',
    padding: '0.3em 0.6ch',
    minHeight: '1.8em',
  },
  prompt: {
    color: 'var(--prompt-marker)',
    marginRight: '0.8ch',
    lineHeight: '1.6em',
    fontWeight: 600,
    fontSize: '1.1em',
    flexShrink: 0,
  },
  textarea: {
    flex: 1,
    background: 'transparent',
    border: 'none',
    outline: 'none',
    color: 'var(--text-primary)',
    fontFamily: 'inherit',
    fontSize: '0.95em',
    lineHeight: '1.6em',
    padding: 0,
    margin: 0,
    resize: 'none',
    overflow: 'auto',
    minHeight: '1.8em',  // starts single-line
    maxHeight: '10em',   // grows with content
    fontWeight: 400,
  },
  buttonRow: {
    display: 'none',
  },
  topFloatingBar: {
    position: 'absolute' as const,
    top: '-2.4em',
    right: '16px',
    display: 'flex',
    alignItems: 'center',
    gap: '0.5ch',
    zIndex: 10,
    background: 'var(--bg-primary)',
    padding: '2px 6px',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border-color)',
    boxShadow: 'var(--shadow-sm)',
    backdropFilter: 'blur(8px)',
  },
  abortBtn: {
    background: 'transparent',
    border: 'none',
    borderRadius: 'var(--radius-sm)',
    padding: '2px 6px',
    color: 'var(--status-error)',
    fontFamily: 'inherit',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer',
    touchAction: 'manipulation',
    lineHeight: '1.2em',
    transition: 'all 0.15s ease',
  },
  flowBtn: {
    background: 'transparent',
    border: 'none',
    borderRadius: 'var(--radius-sm)',
    padding: '2px 8px',
    color: 'var(--text-secondary)',
    fontFamily: 'inherit',
    fontSize: '11px',
    fontWeight: 500,
    cursor: 'pointer',
    touchAction: 'manipulation',
    whiteSpace: 'nowrap' as const,
    lineHeight: '1.4em',
    transition: 'all 0.15s ease',
  },
  flowBtnDimmed: {
    opacity: 0.6,
  },
  imageStrip: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: '8px',
    padding: '6px 1ch 6px 1ch',
  },
  imageThumbnail: {
    position: 'relative' as const,
    width: '48px',
    height: '48px',
    borderRadius: 'var(--radius-sm)',
    overflow: 'hidden',
    border: '1px solid var(--border-color)',
    cursor: 'pointer',
    flexShrink: 0,
    boxShadow: 'var(--shadow-sm)',
  },
  imageThumbnailSelected: {
    border: '2px solid var(--accent-blue)',
    boxShadow: '0 0 6px rgba(27, 77, 68, 0.3)',
  },
  imagePreview: {
    width: '100%',
    height: '100%',
    objectFit: 'cover' as const,
    display: 'block',
  },
  imageRemoveBtn: {
    position: 'absolute' as const,
    top: '1px',
    right: '1px',
    width: '16px',
    height: '16px',
    borderRadius: '50%',
    border: 'none',
    background: 'rgba(0,0,0,0.7)',
    color: 'var(--text-secondary)',
    fontSize: '10px',
    lineHeight: '14px',
    textAlign: 'center' as const,
    cursor: 'pointer',
    padding: 0,
  },
};
