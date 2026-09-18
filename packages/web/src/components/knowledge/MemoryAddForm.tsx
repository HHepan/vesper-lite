// "Add memory" form for the Knowledge sidebar.
// Lets the user pick a category (node / edge / note) then fill the fields.
// Edge endpoints are chosen from the nodes currently visible in the sidebar.

import React, { useState } from 'react';
import type { EntryCategory, SidebarNode } from './types.js';
import { dbNameOf } from './types.js';

interface Props {
  /** Scoped ids of every node currently shown — edge endpoints pick from these. */
  nodes: SidebarNode[];
  onAdd: (entry: { category: EntryCategory; [k: string]: any }) => void;
  onCancel: () => void;
}

const NOTE_KINDS = ['observation', 'episode', 'lesson', 'decision'] as const;

export function MemoryAddForm({ nodes, onAdd, onCancel }: Props) {
  const [category, setCategory] = useState<EntryCategory>('note');
  // node fields
  const [name, setName] = useState('');
  const [nodeType, setNodeType] = useState('concept');
  const [aliases, setAliases] = useState('');
  // edge fields
  const [src, setSrc] = useState('');
  const [dst, setDst] = useState('');
  const [edgeType, setEdgeType] = useState('related');
  // note fields
  const [kind, setKind] = useState('observation');
  const [content, setContent] = useState('');
  const [tags, setTags] = useState('');
  const [anchor, setAnchor] = useState('');
  // shared
  const [summary, setSummary] = useState('');

  // Edge endpoints + note anchor need the raw (unscoped) id — the store
  // inserts into one DB at a time, and both endpoints must live in the
  // same dbFile.
  const rawId = (scoped: string) => scoped.slice(scoped.indexOf(':') + 1);
  const srcDb = src ? dbNameOf(src) : null;
  const dstDb = dst ? dbNameOf(dst) : null;
  const crossDb = srcDb && dstDb && srcDb !== dstDb;

  const submit = () => {
    if (category === 'node') {
      if (!name.trim()) return;
      onAdd({
        category: 'node', name: name.trim(), type: nodeType.trim() || 'concept',
        aliases: aliases.split(',').map(a => a.trim()).filter(Boolean), summary,
      });
    } else if (category === 'edge') {
      if (!src || !dst || crossDb) return;
      onAdd({
        category: 'edge', src: rawId(src), dst: rawId(dst),
        type: edgeType.trim() || 'related', summary,
        // targetDb tells the sidebar which dbFile to write into
        targetDb: srcDb,
      });
    } else {
      if (!content.trim()) return;
      onAdd({
        category: 'note', kind, content: content.trim(), summary,
        tags: tags.split(',').map(t => t.trim()).filter(Boolean),
        anchorNode: anchor ? rawId(anchor) : undefined,
        targetDb: anchor ? dbNameOf(anchor) : undefined,
      });
    }
  };

  return (
    <div style={s.form}>
      <div style={s.catRow}>
        {(['node', 'edge', 'note'] as const).map(c => (
          <button key={c}
            style={{ ...s.catBtn, ...(category === c ? s.catBtnActive : {}) }}
            onClick={() => setCategory(c)}>
            {c === 'node' ? '实体' : c === 'edge' ? '关系' : '笔记'}
          </button>
        ))}
      </div>

      {category === 'node' && (
        <>
          <input style={s.input} value={name} onChange={e => setName(e.target.value)} placeholder="名称 *" />
          <input style={s.input} value={nodeType} onChange={e => setNodeType(e.target.value)} placeholder="类型 (person/project/…)" />
          <input style={s.input} value={aliases} onChange={e => setAliases(e.target.value)} placeholder="别名（逗号分隔）" />
        </>
      )}

      {category === 'edge' && (
        <>
          <select style={s.input} value={src} onChange={e => setSrc(e.target.value)}>
            <option value="">— 起点 —</option>
            {nodes.map(n => <option key={n.id} value={n.id}>{n.name} ({n.type})</option>)}
          </select>
          <select style={s.input} value={dst} onChange={e => setDst(e.target.value)}>
            <option value="">— 终点 —</option>
            {nodes.map(n => <option key={n.id} value={n.id}>{n.name} ({n.type})</option>)}
          </select>
          {crossDb && <div style={s.warn}>两端必须在同一个记忆库中</div>}
          <input style={s.input} value={edgeType} onChange={e => setEdgeType(e.target.value)} placeholder="关系类型 (knows/prefers/…)" />
        </>
      )}

      {category === 'note' && (
        <>
          <select style={s.input} value={kind} onChange={e => setKind(e.target.value)}>
            {NOTE_KINDS.map(k => <option key={k} value={k}>{k}</option>)}
          </select>
          <textarea style={{ ...s.input, minHeight: '5em', resize: 'vertical' }}
            value={content} onChange={e => setContent(e.target.value)} placeholder="内容 *" />
          <input style={s.input} value={tags} onChange={e => setTags(e.target.value)} placeholder="标签（逗号分隔）" />
          <select style={s.input} value={anchor} onChange={e => setAnchor(e.target.value)}>
            <option value="">— 锚定实体（可选）—</option>
            {nodes.map(n => <option key={n.id} value={n.id}>{n.name} ({n.type})</option>)}
          </select>
        </>
      )}

      <input style={s.input} value={summary} onChange={e => setSummary(e.target.value)} placeholder="摘要（一句话，可选）" />

      <div style={s.btns}>
        <button style={s.addBtn} onClick={submit}>添加</button>
        <button style={s.cancelBtn} onClick={onCancel}>取消</button>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  form: { display: 'flex', flexDirection: 'column', gap: '6px', padding: '8px', borderBottom: '1px solid var(--border-color)', background: 'var(--bg-tertiary)' },
  catRow: { display: 'flex', gap: '4px' },
  catBtn: { flex: 1, background: 'none', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'var(--text-secondary)', cursor: 'pointer', padding: '3px 0', fontSize: '0.8em' },
  catBtnActive: { background: 'var(--ansi-magenta)', color: 'var(--bg-primary)', borderColor: 'var(--ansi-magenta)', fontWeight: 'bold' },
  input: { background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'var(--text-primary)', padding: '4px 8px', fontSize: '0.85em', fontFamily: 'inherit' },
  warn: { color: 'var(--status-error)', fontSize: '0.75em' },
  btns: { display: 'flex', gap: '6px', justifyContent: 'flex-end' },
  addBtn: { background: 'var(--ansi-magenta)', border: 'none', borderRadius: '4px', color: 'var(--bg-primary)', cursor: 'pointer', padding: '3px 12px', fontSize: '0.85em' },
  cancelBtn: { background: 'none', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'var(--text-secondary)', cursor: 'pointer', padding: '3px 12px', fontSize: '0.85em' },
};
