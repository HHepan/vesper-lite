// A single memory entry row in the Knowledge sidebar.
// Displays summary + type badge; hover reveals edit/delete actions.
// Edit mode swaps to an inline form (per-category fields).

import React, { useState } from 'react';
import type { SidebarNode, SidebarEdge, SidebarNote, EntryCategory } from './types.js';

export interface EntryUpdate {
  node: { type?: string; name?: string; aliases?: string[]; summary?: string };
  edge: { type?: string; summary?: string; weight?: number };
  note: { kind?: string; content?: string; summary?: string; tags?: string[] };
}

interface Props {
  category: EntryCategory;
  entry: SidebarNode | SidebarEdge | SidebarNote;
  nodeNameById: Map<string, string>; // scoped id → display name (for edges)
  onSave: (fields: EntryUpdate[EntryCategory]) => void;
  onDelete: () => void;
}

const NOTE_KINDS = ['observation', 'episode', 'lesson', 'decision'] as const;

export function MemoryEntryRow({ category, entry, nodeNameById, onSave, onDelete }: Props) {
  const [editing, setEditing] = useState(false);

  return editing
    ? <EditForm category={category} entry={entry} nodeNameById={nodeNameById}
        onCancel={() => setEditing(false)}
        onSave={(f) => { onSave(f); setEditing(false); }} />
    : <DisplayRow category={category} entry={entry} nodeNameById={nodeNameById}
        onEdit={() => setEditing(true)} onDelete={onDelete} />;
}

// ---------------------------------------------------------------------------

function DisplayRow({ category, entry, nodeNameById, onEdit, onDelete }:
  Omit<Props, 'onSave'> & { onEdit: () => void }) {
  const title = titleOf(category, entry, nodeNameById);
  const sub = subOf(category, entry);
  return (
    <div
      style={s.row}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--bg-tertiary)';
        e.currentTarget.querySelectorAll<HTMLElement>('.mem-action').forEach(el => { el.style.opacity = '1'; });
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = '';
        e.currentTarget.querySelectorAll<HTMLElement>('.mem-action').forEach(el => { el.style.opacity = '0'; });
      }}
    >
      <span style={{ ...s.badge, ...badgeColor(category) }}>{badgeLabel(category, entry)}</span>
      <div style={s.rowText}>
        <div style={s.rowTitle} title={title}>{title}</div>
        {sub && <div style={s.rowSub} title={sub}>{sub}</div>}
      </div>
      <button className="mem-action" style={s.actionBtn} onClick={onEdit} title="编辑">✎</button>
      <button className="mem-action" style={{ ...s.actionBtn, color: 'var(--status-error)' }}
        onClick={() => { if (window.confirm(`删除这条记忆？\n${title}`)) onDelete(); }} title="删除">✕</button>
    </div>
  );
}

// ---------------------------------------------------------------------------

function EditForm({ category, entry, nodeNameById, onSave, onCancel }: {
  category: EntryCategory;
  entry: SidebarNode | SidebarEdge | SidebarNote;
  nodeNameById: Map<string, string>;
  onSave: (fields: any) => void;
  onCancel: () => void;
}) {
  const n = entry as SidebarNode;
  const e = entry as SidebarEdge;
  const t = entry as SidebarNote;

  const [name, setName] = useState(category === 'node' ? n.name : '');
  const [type, setType] = useState(category === 'node' ? n.type : category === 'edge' ? e.type : '');
  const [summary, setSummary] = useState(entry.summary ?? '');
  const [aliases, setAliases] = useState(category === 'node' ? n.aliases.join(', ') : '');
  const [weight, setWeight] = useState(category === 'edge' ? String(e.weight) : '1');
  const [kind, setKind] = useState(category === 'note' ? t.kind : 'observation');
  const [content, setContent] = useState(category === 'note' ? t.content : '');
  const [tags, setTags] = useState(category === 'note' ? t.tags.join(', ') : '');

  const commit = () => {
    if (category === 'node') {
      if (!name.trim()) return;
      onSave({
        name: name.trim(), type: type.trim() || n.type,
        aliases: aliases.split(',').map(a => a.trim()).filter(Boolean),
        summary,
      });
    } else if (category === 'edge') {
      onSave({ type: type.trim() || e.type, summary, weight: parseFloat(weight) || e.weight });
    } else {
      if (!content.trim()) return;
      onSave({
        kind, content: content.trim(), summary,
        tags: tags.split(',').map(x => x.trim()).filter(Boolean),
      });
    }
  };

  return (
    <div style={s.editBox}>
      {category === 'node' && (
        <>
          <input style={s.input} value={name} onChange={ev => setName(ev.target.value)} placeholder="名称" />
          <input style={s.input} value={type} onChange={ev => setType(ev.target.value)} placeholder="类型 (person/project/…)" />
          <input style={s.input} value={aliases} onChange={ev => setAliases(ev.target.value)} placeholder="别名（逗号分隔）" />
        </>
      )}
      {category === 'edge' && (
        <>
          <div style={s.edgePair}>{nodeNameById.get(e.src) ?? e.src} → {nodeNameById.get(e.dst) ?? e.dst}</div>
          <input style={s.input} value={type} onChange={ev => setType(ev.target.value)} placeholder="关系类型" />
          <input style={s.input} value={weight} onChange={ev => setWeight(ev.target.value)} placeholder="权重 (0-1)" />
        </>
      )}
      {category === 'note' && (
        <>
          <select style={s.input} value={kind} onChange={ev => setKind(ev.target.value)}>
            {NOTE_KINDS.map(k => <option key={k} value={k}>{k}</option>)}
          </select>
          <textarea style={{ ...s.input, minHeight: '4em', resize: 'vertical' }}
            value={content} onChange={ev => setContent(ev.target.value)} placeholder="内容" />
          <input style={s.input} value={tags} onChange={ev => setTags(ev.target.value)} placeholder="标签（逗号分隔）" />
        </>
      )}
      <input style={s.input} value={summary} onChange={ev => setSummary(ev.target.value)} placeholder="摘要（一句话）" />
      <div style={s.editBtns}>
        <button style={s.saveBtn} onClick={commit}>保存</button>
        <button style={s.cancelBtn} onClick={onCancel}>取消</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function titleOf(category: EntryCategory, entry: any, names: Map<string, string>): string {
  if (category === 'node') return entry.name;
  if (category === 'edge') {
    return `${names.get(entry.src) ?? entry.src} —[${entry.type}]→ ${names.get(entry.dst) ?? entry.dst}`;
  }
  return entry.summary || entry.content.slice(0, 60);
}

function subOf(category: EntryCategory, entry: any): string {
  if (category === 'node') return entry.summary || entry.type;
  if (category === 'edge') return entry.summary || '';
  return entry.content.length > 60 ? entry.content : '';
}

function badgeLabel(category: EntryCategory, entry: any): string {
  if (category === 'node') return '实体';
  if (category === 'edge') return '关系';
  return entry.kind ?? 'note';
}

function badgeColor(category: EntryCategory): React.CSSProperties {
  if (category === 'node') return { color: '#89B4FA', borderColor: '#89B4FA' };
  if (category === 'edge') return { color: '#A6E3A1', borderColor: '#A6E3A1' };
  return { color: 'var(--text-muted)', borderColor: 'var(--text-muted)' };
}

const s: Record<string, React.CSSProperties> = {
  row: { display: 'flex', alignItems: 'flex-start', gap: '6px', padding: '5px 8px', borderRadius: '4px' },
  badge: { flexShrink: 0, fontSize: '0.7em', border: '1px solid', borderRadius: '3px', padding: '0 4px', marginTop: '2px' },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { color: 'var(--text-primary)', fontSize: '0.85em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  rowSub: { color: 'var(--text-muted)', fontSize: '0.75em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  actionBtn: { opacity: 0, flexShrink: 0, background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '1px 4px', fontSize: '0.85em' },
  editBox: { display: 'flex', flexDirection: 'column', gap: '4px', padding: '6px 8px', background: 'var(--bg-tertiary)', borderRadius: '4px' },
  input: { background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'var(--text-primary)', padding: '3px 6px', fontSize: '0.8em', fontFamily: 'inherit' },
  edgePair: { color: 'var(--text-muted)', fontSize: '0.75em' },
  editBtns: { display: 'flex', gap: '6px', justifyContent: 'flex-end' },
  saveBtn: { background: 'var(--ansi-magenta)', border: 'none', borderRadius: '4px', color: 'var(--bg-primary)', cursor: 'pointer', padding: '2px 10px', fontSize: '0.8em' },
  cancelBtn: { background: 'none', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'var(--text-secondary)', cursor: 'pointer', padding: '2px 10px', fontSize: '0.8em' },
};
