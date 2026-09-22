// ═══════════════════════════════════════════════════════════════════════════
// Vesper WebUI — TODO Panel (floating overlay)
//
// Simple TODO list: add items, edit text, toggle done, delete.
// Data lives on the server at ~/.vesper-lite/todo.json, synced via WebSocket.
// ═══════════════════════════════════════════════════════════════════════════

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { theme } from '../theme.js';
import type { Bridge } from '../bridge.js';
import { useModalAnimation } from '../hooks/useModalAnimation.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TodoItem {
  id: string;
  text: string;
  done: boolean;
  createdAt: number;
}

interface TodoPanelProps {
  bridge: Bridge;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TodoPanel({ bridge, onClose }: TodoPanelProps) {
  const { isClosing, handleClose, handleOverlayClick, overlayAnimation, panelAnimation } = useModalAnimation(onClose);

  const [items, setItems] = useState<TodoItem[]>([]);
  const [newText, setNewText] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [loading, setLoading] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const editRef = useRef<HTMLInputElement>(null);

  // ── Listen for TODO events ─────────────────────────────────────────
  useEffect(() => {
    const unsub = bridge.onMetaEvent((ev) => {
      if (ev.type === 'todo_list_result') {
        setItems(ev.items || []);
        setLoading(false);
      }
      if (ev.type === 'todo_update_result') {
        if (ev.success && ev.item) {
          setItems((prev: TodoItem[]) => {
            const exists = prev.find((i: TodoItem) => i.id === ev.item.id);
            if (!exists) {
              // New item — refresh full list
              bridge.todoList();
              return prev;
            }
            return prev.map((i: TodoItem) => i.id === ev.item.id ? ev.item : i);
          });
        }
      }
      if (ev.type === 'todo_delete_result') {
        if (ev.success) {
          setItems(prev => prev.filter(i => i.id !== ev.id));
        }
      }
    });

    // Initial load
    bridge.todoList();

    return unsub;
  }, [bridge]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Focus edit input when editing starts
  useEffect(() => {
    if (editingId) editRef.current?.focus();
  }, [editingId]);

  // ── Handlers ───────────────────────────────────────────────────────
  const handleAdd = useCallback(() => {
    const text = newText.trim();
    if (!text) return;
    bridge.todoAdd(text);
    setNewText('');
    // Optimistic add
    setItems(prev => [...prev, { id: `temp-${Date.now()}`, text, done: false, createdAt: Date.now() }]);
    // Refresh after a short delay to get the real item from server
    setTimeout(() => bridge.todoList(), 200);
  }, [bridge, newText]);

  const handleToggle = useCallback((id: string, currentDone: boolean) => {
    bridge.todoUpdate(id, { done: !currentDone });
    setItems(prev => prev.map(i => i.id === id ? { ...i, done: !currentDone } : i));
  }, [bridge]);

  const handleDelete = useCallback((id: string) => {
    bridge.todoDelete(id);
    setItems(prev => prev.filter(i => i.id !== id));
  }, [bridge]);

  const handleStartEdit = useCallback((item: TodoItem) => {
    setEditingId(item.id);
    setEditText(item.text);
  }, []);

  const handleCommitEdit = useCallback(() => {
    if (!editingId) return;
    const text = editText.trim();
    if (text) {
      bridge.todoUpdate(editingId, { text });
      setItems(prev => prev.map(i => i.id === editingId ? { ...i, text } : i));
    }
    setEditingId(null);
    setEditText('');
  }, [bridge, editingId, editText]);

  const handleCancelEdit = useCallback(() => {
    setEditingId(null);
    setEditText('');
  }, []);

  // ── Render ─────────────────────────────────────────────────────────
  const pending = items.filter(i => !i.done);
  const completed = items.filter(i => i.done);

  return (
    <div style={{ ...styles.overlay, animation: overlayAnimation }} onClick={handleOverlayClick}>
      <div style={{ ...styles.panel, animation: panelAnimation }} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={styles.header}>
          <span style={styles.headerTitle}>📝 TODO</span>
          <button style={styles.closeBtn} onClick={handleClose} title="Close">✕</button>
        </div>

        {/* Add input */}
        <div style={styles.addRow}>
          <input
            ref={inputRef}
            style={styles.addInput}
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) handleAdd();
            }}
            placeholder="Add a new item..."
          />
          <button
            style={{ ...styles.addBtn, opacity: newText.trim() ? 1 : 0.4 }}
            onClick={handleAdd}
            disabled={!newText.trim()}
          >
            +
          </button>
        </div>

        {/* List */}
        <div style={styles.list}>
          {loading ? (
            <div style={styles.empty}>Loading...</div>
          ) : items.length === 0 ? (
            <div style={styles.empty}>No items yet. Add one above!</div>
          ) : (
            <>
              {pending.length > 0 && (
                <>
                  {pending.map(item => (
                    <TodoRow
                      key={item.id}
                      item={item}
                      editing={editingId === item.id}
                      editText={editText}
                      onToggle={() => handleToggle(item.id, item.done)}
                      onDelete={() => handleDelete(item.id)}
                      onStartEdit={() => handleStartEdit(item)}
                      onCommitEdit={handleCommitEdit}
                      onCancelEdit={handleCancelEdit}
                      onEditTextChange={setEditText}
                      editRef={editRef}
                    />
                  ))}
                </>
              )}
              {completed.length > 0 && (
                <>
                  <div style={styles.sectionDivider}>
                    <span style={styles.sectionLabel}>Done ({completed.length})</span>
                  </div>
                  {completed.map(item => (
                    <TodoRow
                      key={item.id}
                      item={item}
                      editing={editingId === item.id}
                      editText={editText}
                      onToggle={() => handleToggle(item.id, item.done)}
                      onDelete={() => handleDelete(item.id)}
                      onStartEdit={() => handleStartEdit(item)}
                      onCommitEdit={handleCommitEdit}
                      onCancelEdit={handleCancelEdit}
                      onEditTextChange={setEditText}
                      editRef={editRef}
                    />
                  ))}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TodoRow
// ---------------------------------------------------------------------------

interface TodoRowProps {
  item: TodoItem;
  editing: boolean;
  editText: string;
  onToggle: () => void;
  onDelete: () => void;
  onStartEdit: () => void;
  onCommitEdit: () => void;
  onCancelEdit: () => void;
  onEditTextChange: (text: string) => void;
  editRef: React.RefObject<HTMLInputElement | null>;
}

function TodoRow({ item, editing, editText, onToggle, onDelete, onStartEdit, onCommitEdit, onCancelEdit, onEditTextChange, editRef }: TodoRowProps) {
  return (
    <div
      style={{
        ...styles.row,
        opacity: item.done ? 0.55 : 1,
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-tertiary)';
        const del = e.currentTarget.querySelector('.todo-delete-btn') as HTMLButtonElement;
        if (del) del.style.opacity = '1';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.background = '';
        const del = e.currentTarget.querySelector('.todo-delete-btn') as HTMLButtonElement;
        if (del) del.style.opacity = '0';
      }}
    >
      {/* Checkbox */}
      <button
        style={{
          ...styles.checkbox,
          borderColor: item.done ? theme.toolSuccess : 'var(--text-muted)',
          color: item.done ? theme.toolSuccess : 'transparent',
        }}
        onClick={onToggle}
        title={item.done ? 'Mark as not done' : 'Mark as done'}
      >
        {item.done ? '✓' : ''}
      </button>

      {/* Text */}
      {editing ? (
        <input
          ref={editRef}
          style={styles.editInput}
          value={editText}
          onChange={(e) => onEditTextChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) onCommitEdit();
            if (e.key === 'Escape') onCancelEdit();
          }}
          onBlur={onCommitEdit}
        />
      ) : (
        <span
          style={{
            ...styles.itemText,
            textDecoration: item.done ? 'line-through' : 'none',
          }}
          onDoubleClick={onStartEdit}
          title="Double-click to edit"
        >
          {item.text}
        </span>
      )}

      {/* Delete */}
      <button
        className="todo-delete-btn"
        style={styles.deleteBtn}
        onClick={onDelete}
        title="Delete"
      >
        ×
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0, 0, 0, 0.4)',
    zIndex: 1000,
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'flex-start',
    padding: '2.5em 0 0 0.75ch',
    animation: 'fade-in 0.2s ease-out',
  },
  panel: {
    width: '320px',
    maxHeight: '70vh',
    background: 'var(--bg-primary)',
    border: '1px solid var(--text-muted)',
    borderRadius: '8px',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
    overflow: 'hidden',
    animation: 'scale-in 0.2s ease-out',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0.5em 0.75em',
    borderBottom: '1px solid var(--border-color)',
  },
  headerTitle: {
    color: 'var(--text-primary)',
    fontSize: '0.95em',
    fontWeight: 'bold',
  },
  closeBtn: {
    background: 'transparent',
    border: 'none',
    color: 'var(--text-muted)',
    fontSize: '1em',
    cursor: 'pointer',
    padding: '0 0.25em',
    lineHeight: 1,
  },
  addRow: {
    display: 'flex',
    alignItems: 'center',
    padding: '0.75em 1em',
    borderBottom: '1px solid var(--border-color)',
    gap: '0.75em',
  },
  addInput: {
    flex: 1,
    background: 'var(--bg-tertiary)',
    border: '1px solid var(--text-muted)',
    borderRadius: '4px',
    color: 'var(--text-primary)',
    fontFamily: 'inherit',
    fontSize: '0.85em',
    padding: '0.35em 0.5em',
    outline: 'none',
  },
  addBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '2ch',
    height: '1.8em',
    border: 'none',
    borderRadius: '4px',
    background: theme.streamingCursor,
    color: 'var(--bg-primary)',
    fontWeight: 'bold',
    fontSize: '0.9em',
    cursor: 'pointer',
  },
  list: {
    flex: 1,
    overflowY: 'auto',
    padding: '0.25em 0',
    scrollbarWidth: 'thin' as const,
  },
  empty: {
    color: 'var(--text-muted)',
    fontSize: '0.85em',
    padding: '1.5em 0.75em',
    textAlign: 'center' as const,
  },
  sectionDivider: {
    padding: '0.35em 0.75em 0.2em',
    borderTop: '1px solid var(--border-color)',
  },
  sectionLabel: {
    color: 'var(--text-muted)',
    fontSize: '0.75em',
    fontWeight: 'bold',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75em',
    padding: '0.5em 1em',
    transition: 'background 0.15s',
    position: 'relative' as const,
  },
  checkbox: {
    width: '1.2em',
    height: '1.2em',
    borderRadius: 'var(--radius-sm)',
    border: '1.5px solid',
    background: 'transparent',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '0.7em',
    flexShrink: 0,
    padding: 0,
    lineHeight: 1,
  },
  itemText: {
    flex: 1,
    color: 'var(--text-secondary)',
    fontSize: '0.85em',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    cursor: 'default',
  },
  editInput: {
    flex: 1,
    background: 'var(--bg-tertiary)',
    border: `1px solid ${theme.streamingCursor}`,
    borderRadius: '3px',
    color: 'var(--text-primary)',
    fontFamily: 'inherit',
    fontSize: '0.85em',
    padding: '0.15em 0.4em',
    outline: 'none',
  },
  deleteBtn: {
    background: 'transparent',
    border: 'none',
    color: 'var(--text-muted)',
    fontSize: '1.1em',
    cursor: 'pointer',
    padding: '0 0.15em',
    opacity: 0,
    transition: 'opacity 0.15s',
    lineHeight: 1,
  },
};