// MemorySidebar — right-hand drawer inside KnowledgePanel listing every
// memory entry (nodes / edges / notes) of the current ego view, grouped by
// the DB they came from (公共常识 → memory.db, ego → memory_{ego}.db).
//
// All mutations go through the callbacks; KnowledgePanel forwards them over
// the WS bridge and re-fetches the graph on success, keeping list + graph
// in sync from one data source.

import React, { useMemo, useRef, useState, useEffect } from 'react';
import type { SidebarNode, SidebarEdge, SidebarNote, EntryCategory } from './types.js';
import { dbNameOf } from './types.js';
import { MemoryEntryRow } from './MemoryEntryRow.js';
import { MemoryAddForm } from './MemoryAddForm.js';
import { downloadJson, readFileText, validateImportJson } from './memory-io.js';

interface Props {
  isOpen: boolean;
  nodes: SidebarNode[];
  edges: SidebarEdge[];
  notes: SidebarNote[];
  /** dbName for new entries in each group: roleLabel → "memory_x.db". */
  dbNameByRole: Map<string, string>;
  onUpdate: (category: EntryCategory, scopedId: string, fields: any) => void;
  onDelete: (scopedId: string) => void;
  onAdd: (dbName: string, entry: any) => void;
  onImport: (json: string) => void;
  onRequestExport: () => void;   // asks server; result arrives via ontology_export event
  isMobile: boolean;
  onClose: () => void;
}

/** Wire the pending export through KnowledgePanel — set from App-level listener. */
export interface ExportPayload { egoName: string; data?: string; error?: string }

interface Group {
  role: string;
  dbName: string;
  nodes: SidebarNode[];
  edges: SidebarEdge[];
  notes: SidebarNote[];
}

export function MemorySidebar({
  isOpen, nodes, edges, notes, dbNameByRole,
  onUpdate, onDelete, onAdd, onImport, onRequestExport, isMobile, onClose,
}: Props) {
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Keep mounted during close transition, unmount after transition ends.
  // We track `animatingOpen` so the element mounts first with closed styles,
  // then triggers the transition on the next frame (browser needs an initial state).
  const [mounted, setMounted] = useState(isOpen);
  const [active, setActive] = useState(isOpen);

  useEffect(() => {
    if (isOpen) {
      setMounted(true);
      // Let the browser paint the initial closed state before applying open styles
      const raf = requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setActive(true);
        });
      });
      return () => cancelAnimationFrame(raf);
    } else {
      setActive(false);
      const timer = setTimeout(() => setMounted(false), 240);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  const nodeNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of nodes) m.set(n.id, n.name);
    return m;
  }, [nodes]);

  const groups = useMemo<Group[]>(() => {
    const map = new Map<string, Group>();
    const ensure = (role: string, dbName: string): Group => {
      if (!map.has(role)) map.set(role, { role, dbName, nodes: [], edges: [], notes: [] });
      return map.get(role)!;
    };
    const q = query.trim().toLowerCase();
    const match = (text: string | undefined) => !q || (text ?? '').toLowerCase().includes(q);

    for (const n of nodes) {
      const role = n.role ?? '公共常识';
      if (!match(n.name) && !match(n.summary) && !match(n.type)) continue;
      ensure(role, dbNameOf(n.id)).nodes.push(n);
    }
    for (const e of edges) {
      const role = e.role ?? '公共常识';
      if (!match(e.type) && !match(e.summary)) continue;
      ensure(role, dbNameOf(e.id)).edges.push(e);
    }
    for (const t of notes) {
      const role = t.role ?? '公共常识';
      if (!match(t.summary) && !match(t.content) && !match(t.kind)) continue;
      ensure(role, dbNameOf(t.id)).notes.push(t);
    }
    return Array.from(map.values());
  }, [nodes, edges, notes, query]);

  const handleFilePick = async (file: File | undefined) => {
    if (!file) return;
    const text = await readFileText(file);
    const err = validateImportJson(text);
    if (err) { window.alert(`导入失败：${err}`); return; }
    onImport(text);
  };

  if (!mounted) return null;

  return (
    <div style={{
      ...s.sidebar,
      ...(isMobile ? s.sidebarMobile : {}),
      ...(active ? s.sidebarOpen : s.sidebarClosed),
    }}>
      <div style={{
        ...s.contentWrapper,
        ...(active ? s.contentOpen : s.contentClosed),
      }}>
        <div style={s.header}>
        <input
          style={s.search}
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="搜索记忆…"
        />
        <button style={s.toolBtn} title="添加记忆" onClick={() => setAdding(v => !v)}>＋</button>
        <button style={s.toolBtn} title="从 JSON 导入" onClick={() => fileRef.current?.click()}>⇪</button>
        <button style={s.toolBtn} title="导出为 JSON" onClick={onRequestExport}>⇓</button>
        {isMobile && <button style={s.toolBtn} title="收起" onClick={onClose}>✕</button>}
        <input ref={fileRef} type="file" accept=".json,application/json" style={{ display: 'none' }}
          onChange={e => { void handleFilePick(e.target.files?.[0]); e.target.value = ''; }} />
      </div>

      {adding && (
        <MemoryAddForm
          nodes={nodes}
          onCancel={() => setAdding(false)}
          onAdd={(entry) => {
            const targetDb = (entry.targetDb as string | undefined) ?? dbNameByRole.get(groups[0]?.role ?? '') ?? 'memory.db';
            const { targetDb: _drop, ...rest } = entry;
            onAdd(targetDb, rest);
            setAdding(false);
          }}
        />
      )}

      <div style={s.list}>
        {groups.length === 0 && <div style={s.empty}>{query ? '没有匹配的记忆' : '暂无记忆'}</div>}
        {groups.map(g => (
          <div key={g.role}>
            <div style={s.groupHeader}>
              <span>{g.role}</span>
              <span style={s.groupCount}>{g.nodes.length + g.edges.length + g.notes.length}</span>
            </div>
            {g.nodes.map(n => (
              <MemoryEntryRow key={n.id} category="node" entry={n} nodeNameById={nodeNameById}
                onSave={f => onUpdate('node', n.id, f)} onDelete={() => onDelete(n.id)} />
            ))}
            {g.edges.map(e => (
              <MemoryEntryRow key={e.id} category="edge" entry={e} nodeNameById={nodeNameById}
                onSave={f => onUpdate('edge', e.id, f)} onDelete={() => onDelete(e.id)} />
            ))}
            {g.notes.map(t => (
              <MemoryEntryRow key={t.id} category="note" entry={t} nodeNameById={nodeNameById}
                onSave={f => onUpdate('note', t.id, f)} onDelete={() => onDelete(t.id)} />
            ))}
          </div>
        ))}
        </div>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  sidebar: {
    width: '320px',
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    position: 'relative',
    zIndex: 2,
    backgroundColor: 'var(--bg-secondary)',
    overflow: 'hidden',
    transition: 'width 0.22s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.22s cubic-bezier(0.4, 0, 0.2, 1), border-color 0.22s ease',
  },
  sidebarOpen: {
    width: '320px',
    borderLeft: '1px solid var(--border-color)',
    boxShadow: '-6px 0 24px rgba(0, 0, 0, 0.22), -2px 0 6px rgba(0, 0, 0, 0.1)',
  },
  sidebarClosed: {
    width: 0,
    borderLeft: '1px solid transparent',
    boxShadow: 'none',
    pointerEvents: 'none',
  },
  contentWrapper: {
    width: '320px',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    transition: 'transform 0.22s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.2s ease',
  },
  contentOpen: {
    transform: 'translateX(0)',
    opacity: 1,
  },
  contentClosed: {
    transform: 'translateX(24px)',
    opacity: 0,
  },
  sidebarMobile: {
    position: 'absolute',
    inset: '0 0 0 auto',
    width: '85vw',
    maxWidth: '360px',
    zIndex: 5,
    boxShadow: '-4px 0 16px rgba(0,0,0,0.3)',
  },
  header: { display: 'flex', gap: '4px', padding: '6px 8px', borderBottom: '1px solid var(--border-color)', alignItems: 'center' },
  search: { flex: 1, minWidth: 0, background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'var(--text-primary)', padding: '4px 8px', fontSize: '0.85em' },
  toolBtn: { background: 'none', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'var(--text-secondary)', cursor: 'pointer', padding: '3px 7px', fontSize: '0.85em' },
  list: { flex: 1, overflowY: 'auto', padding: '4px' },
  empty: { color: 'var(--text-muted)', textAlign: 'center', padding: '2em 0', fontSize: '0.85em' },
  groupHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: 'var(--ansi-magenta)', fontSize: '0.78em', fontWeight: 'bold', padding: '8px 8px 3px', borderBottom: '1px solid var(--border-color)', marginBottom: '2px' },
  groupCount: { color: 'var(--text-muted)', fontWeight: 'normal' },
};
