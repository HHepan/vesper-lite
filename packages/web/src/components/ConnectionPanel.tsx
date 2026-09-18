// ═══════════════════════════════════════════════════════════════════════════
// Vesper WebUI — Connection Panel (🔗)
//
// Manages connections and extensions: MCP, Relay, QQ Bot, Cron tasks.
// Uses the same layout as ConfigPanel (overlay + tab bar + body).
// ═══════════════════════════════════════════════════════════════════════════

import React, { memo, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { theme } from '../theme.js';
import type { Bridge } from '../bridge.js';
import type { WebStoreState, WebStore } from '../store.js';
import { McpTab, QQBotTab, RelayTab } from './ConfigPanel.js';
import { useModalAnimation } from '../hooks/useModalAnimation.js';
import { Select } from './Select.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CronEntry {
  id: string;
  creatorSession: string;
  target?: string;
  tag?: string;
  description?: string;
  message: string;
  nextRun: number;
  repeatMs?: number;
  createdAt: number;
  frozen?: boolean;
}

type ConnTabId = 'mcp' | 'relay' | 'qqbot' | 'cron' | 'cookies';

const CONN_TABS: { id: ConnTabId; label: string }[] = [
  { id: 'mcp', label: '扩展插件 (MCP)' },
  { id: 'relay', label: '远程连接 (Relay)' },
  { id: 'qqbot', label: 'QQ机器人 (Bot)' },
  { id: 'cron', label: '定时任务 (Cron)' },
  { id: 'cookies', label: '🍪 网络访问' },
];

// ---------------------------------------------------------------------------
// Duration formatter
// ---------------------------------------------------------------------------

function formatMs(ms: number): string {
  if (ms <= 0) return '0s';
  const totalSec = Math.floor(ms / 1000);
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (s) parts.push(`${s}s`);
  return parts.join('') || '0s';
}

function formatTimestamp(epoch: number): string {
  const d = new Date(epoch);
  const yy = String(d.getFullYear()).slice(2);
  const MM = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${yy}-${MM}-${dd} ${hh}:${mm}:${ss}`;
}

// ---------------------------------------------------------------------------
// Duration fields component (must be outside CronTab to avoid re-mount on render)
// ---------------------------------------------------------------------------

const durInputStyle: React.CSSProperties = {
  width: '3.2em',
  background: 'var(--bg-primary)',
  border: '1px solid var(--text-muted)',
  borderRadius: '3px',
  padding: '0.3em 0.4em',
  color: theme.toolResult,
  fontSize: '0.9em',
  fontFamily: 'inherit',
  outline: 'none',
  textAlign: 'center' as const,
};

const durLabelStyle: React.CSSProperties = {
  color: theme.dimText,
  fontSize: '0.85em',
  marginLeft: '0.15em',
  marginRight: '0.4em',
};

function DurFields({ h, m, s, setH, setM, setS }: {
  h: string; m: string; s: string;
  setH: (v: string) => void; setM: (v: string) => void; setS: (v: string) => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      <input type="text" value={h} style={durInputStyle}
        onChange={e => setH(e.target.value.replace(/[^0-9]/g, ''))} />
      <span style={durLabelStyle}>h</span>
      <input type="text" value={m} style={durInputStyle}
        onChange={e => setM(e.target.value.replace(/[^0-9]/g, ''))} />
      <span style={durLabelStyle}>m</span>
      <input type="text" value={s} style={durInputStyle}
        onChange={e => setS(e.target.value.replace(/[^0-9]/g, ''))} />
      <span style={durLabelStyle}>s</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ConnectionPanelProps {
  bridge: Bridge;
  storeRef: React.RefObject<WebStore | null>;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// CronTab Component
// ---------------------------------------------------------------------------

function CronTab({ bridge, sessionId, cronEntries, cronRunning, cronDataCollectionEnabled, cronDataCollectionPath, onSetDataCollection }: {
  bridge: Bridge;
  sessionId: string;
  cronEntries: CronEntry[];
  cronRunning: false | string | true;
  cronDataCollectionEnabled: boolean;
  cronDataCollectionPath: string;
  onSetDataCollection: (enabled: boolean, path?: string) => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // Duration as string fields: hours, minutes, seconds
  const [delayH, setDelayH] = useState('0');
  const [delayM, setDelayM] = useState('30');
  const [delayS, setDelayS] = useState('0');
  const [hasRepeat, setHasRepeat] = useState(false);
  const [repeatH, setRepeatH] = useState('0');
  const [repeatM, setRepeatM] = useState('0');
  const [repeatS, setRepeatS] = useState('0');
  const [formMessage, setFormMessage] = useState('');
  const [formTarget, setFormTarget] = useState('__self__');
  const [formTag, setFormTag] = useState('');
  const [formDescription, setFormDescription] = useState('');

  // Discover sessions for target dropdown
  const [sessions, setSessions] = useState<string[]>([]);
  useEffect(() => {
    const unsub = bridge.onMetaEvent((event: any) => {
      if (event.type === 'session_list') {
        setSessions((event.sessions || []).map((s: any) => s.name || s.id).filter(Boolean));
      }
    });
    bridge.listActiveSessions();
    return unsub;
  }, [bridge]);

  const sendCron = useCallback((cmd: Record<string, any>) => {
    bridge.sendCommand(sessionId, { id: `cron-${Date.now()}`, ...cmd } as any);
  }, [bridge, sessionId]);

  /** Validate duration string format: "30m", "1h", "2h30m", "1d6h30s", etc. */
  const isValidDuration = useCallback((s: string): boolean => {
    if (!s) return false;
    return /^(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.test(s.trim()) && s.trim().length > 0;
  }, []);

  /** Build duration string from h/m/s text fields. */
  const buildDurationStr = useCallback((h: string, m: string, s: string): string => {
    const hNum = parseInt(h, 10) || 0;
    const mNum = parseInt(m, 10) || 0;
    const sNum = parseInt(s, 10) || 0;
    const parts: string[] = [];
    if (hNum > 0) parts.push(`${hNum}h`);
    if (mNum > 0) parts.push(`${mNum}m`);
    if (sNum > 0) parts.push(`${sNum}s`);
    return parts.join('');
  }, []);

  const handleAdd = useCallback(() => {
    setFormError(null);
    const delayStr = buildDurationStr(delayH, delayM, delayS);
    if (!delayStr) {
      setFormError('⚠ 延迟不能全为零（至少填一个值）');
      return;
    }
    if (!formMessage.trim()) {
      setFormError('⚠ 消息不能为空');
      return;
    }
    const repeatStr = hasRepeat ? buildDurationStr(repeatH, repeatM, repeatS) : undefined;
    if (hasRepeat && !repeatStr) {
      setFormError('⚠ 重复间隔不能全为零');
      return;
    }
    sendCron({
      cmd: 'cron_add',
      entry: {
        delay: delayStr,
        message: formMessage.trim(),
        repeat: repeatStr || undefined,
        target: formTarget === '__self__' ? undefined : (formTarget || undefined),
        tag: formTag.trim() || undefined,
        description: formDescription.trim() || undefined,
      },
    });
    // Reset form
    setDelayH('0'); setDelayM('30'); setDelayS('0');
    setRepeatH('0'); setRepeatM('0'); setRepeatS('0');
    setHasRepeat(false);
    setFormMessage(''); setFormTarget('__self__'); setFormTag(''); setFormDescription('');
    setShowForm(false);
    // Refresh after a short delay
    setTimeout(() => sendCron({ cmd: 'cron_query' }), 500);
  }, [delayH, delayM, delayS, repeatH, repeatM, repeatS, hasRepeat, formMessage, formTarget, formTag, formDescription, sendCron, buildDurationStr]);

  const handleFreeze = useCallback((id: string, frozen: boolean) => {
    sendCron({ cmd: frozen ? 'cron_unfreeze' : 'cron_freeze', entryId: id });
    setTimeout(() => sendCron({ cmd: 'cron_query' }), 500);
  }, [sendCron]);

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmClosing, setConfirmClosing] = useState(false);

  const handleCloseConfirm = useCallback(() => {
    setConfirmClosing(true);
    setTimeout(() => {
      setConfirmDeleteId(null);
      setConfirmClosing(false);
    }, 200);
  }, []);

  const handleDelete = useCallback((id: string) => {
    setConfirmDeleteId(id);
  }, []);

  const handleConfirmDelete = useCallback(() => {
    if (!confirmDeleteId) return;
    sendCron({ cmd: 'cron_delete', entryId: confirmDeleteId });
    setConfirmDeleteId(null);
    setTimeout(() => sendCron({ cmd: 'cron_query' }), 500);
  }, [confirmDeleteId, sendCron]);

  const handleRefresh = useCallback(() => {
    sendCron({ cmd: 'cron_query' });
  }, [sendCron]);

  // Single timer for all CronEntryRow countdowns (instead of per-row setInterval)
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div style={cronStyles.container}>
      {/* Header */}
      <div style={cronStyles.header}>
        <span style={{ color: theme.toolName, fontWeight: 'bold' }}>
          定时任务 ({cronEntries.length})
        </span>
        {cronRunning && (
          <span style={{ color: 'var(--status-success)', fontSize: '0.85em', marginLeft: '0.5em' }}>
            ⏳ 执行中{typeof cronRunning === 'string' ? `: ${cronRunning}` : ''}
          </span>
        )}
        <div style={cronStyles.headerActions}>
          <button style={cronStyles.btn} onClick={handleRefresh}>刷新</button>
          <button style={{ ...cronStyles.btn, background: 'var(--status-success-bg)' }} onClick={() => { setShowForm(!showForm); setFormError(null); }}>
            + 新建
          </button>
        </div>
      </div>

      {/* Data collection toggle */}
      <div style={cronStyles.dataRow}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.3em', cursor: 'pointer' }}>
          <input type="checkbox"
            checked={cronDataCollectionEnabled}
            onChange={e => onSetDataCollection(e.target.checked, cronDataCollectionPath)}
            style={{ accentColor: 'var(--status-success)' }} />
          <span style={{ fontSize: '0.85em', color: theme.dimText }}>数据收集</span>
        </label>
        {cronDataCollectionEnabled && (
          <input style={{ ...cronStyles.input, flex: 1, fontSize: '0.8em' }}
            value={cronDataCollectionPath}
            onChange={e => onSetDataCollection(true, e.target.value)}
            placeholder="保存路径（如 /data/cron）" />
        )}
      </div>

      {/* New task form */}
      {showForm && (
        <div style={cronStyles.form}>
          <div style={cronStyles.formRow}>
            <label style={cronStyles.label}>描述</label>
            <input style={cronStyles.input} value={formDescription}
              onChange={e => setFormDescription(e.target.value)}
              placeholder="可选，用于UI显示" />
          </div>
          <div style={cronStyles.formRow}>
            <label style={cronStyles.label}>延迟 *</label>
            <DurFields h={delayH} m={delayM} s={delayS} setH={setDelayH} setM={setDelayM} setS={setDelayS} />
          </div>
          <div style={cronStyles.formRow}>
            <label style={cronStyles.label}>消息 *</label>
            <input style={{ ...cronStyles.input, flex: 2 }} value={formMessage}
              onChange={e => setFormMessage(e.target.value)}
              placeholder="触发时发送的消息" />
          </div>
          <div style={cronStyles.formRow}>
            <label style={cronStyles.label}>重复</label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.3em', marginRight: '0.5em', cursor: 'pointer' }}>
              <input type="checkbox" checked={hasRepeat} onChange={e => setHasRepeat(e.target.checked)}
                style={{ accentColor: 'var(--status-success)' }} />
              <span style={{ fontSize: '0.85em', color: theme.dimText }}>启用</span>
            </label>
            {hasRepeat && (
              <DurFields h={repeatH} m={repeatM} s={repeatS} setH={setRepeatH} setM={setRepeatM} setS={setRepeatS} />
            )}
            {!hasRepeat && <span style={{ color: theme.dimText, fontSize: '0.85em' }}>一次性</span>}
          </div>
          <div style={cronStyles.formRow}>
            <label style={cronStyles.label}>目标</label>
            <Select
              value={formTarget}
              onChange={v => setFormTarget(v)}
              placeholder="选择目标"
              options={[
                { label: '自己 (当前会话)', value: '__self__' },
                ...sessions.filter(s => s !== sessionId).map(s => ({ label: s, value: s })),
              ]}
            />
            <span style={{ color: theme.dimText, fontSize: '0.75em', marginLeft: '0.3em' }}>跨会话需连接Link</span>
          </div>
          <div style={cronStyles.formRow}>
            <label style={cronStyles.label}>标签</label>
            <input style={cronStyles.input} value={formTag}
              onChange={e => setFormTag(e.target.value)}
              placeholder="可选，分组标识" />
          </div>
          {formError && (
            <div style={{ color: 'var(--status-error)', fontSize: '0.85em', padding: '0.3em 0' }}>{formError}</div>
          )}
          <div style={cronStyles.formActions}>
            <button style={cronStyles.btn} onClick={() => { setShowForm(false); setFormError(null); }}>取消</button>
            <button style={{ ...cronStyles.btn, background: 'var(--status-success-bg)' }} onClick={handleAdd}>
              创建
            </button>
          </div>
        </div>
      )}

      {/* Entry list */}
      {cronEntries.length === 0 ? (
        <div style={{ color: theme.dimText, padding: '2em', textAlign: 'center' }}>
          暂无定时任务。<br/>
          点击 "新建" 创建，或让 AI 使用 cron_schedule 工具。
        </div>
      ) : (
        <div style={cronStyles.list}>
          {cronEntries.map(entry => (
            <CronEntryRow
              key={entry.id}
              entry={entry}
              now={now}
              onFreeze={() => handleFreeze(entry.id, !!entry.frozen)}
              onDelete={() => handleDelete(entry.id)}
            />
          ))}
        </div>
      )}

      {/* Confirm delete modal */}
      {confirmDeleteId && (() => {
        const entry = cronEntries.find(e => e.id === confirmDeleteId);
        const entryLabel = entry?.description || entry?.tag || confirmDeleteId.slice(0, 8);
        return (
          <div
            style={{ ...cronStyles.confirmOverlay, animation: confirmClosing ? 'fade-out 0.2s ease-out forwards' : 'fade-in 0.2s ease-out' }}
            onClick={handleCloseConfirm}
          >
            <div
              style={{ ...cronStyles.confirmBox, animation: confirmClosing ? 'scale-out 0.2s ease-out forwards' : 'scale-in 0.2s ease-out' }}
              onClick={e => e.stopPropagation()}
            >
              <p style={{ color: 'var(--text-primary)', margin: '0 0 0.5em' }}>
                确认删除定时任务 <strong>"{entryLabel}"</strong>？
              </p>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85em', margin: '0 0 1em' }}>
                此操作不可撤销。
              </p>
              <div style={{ display: 'flex', gap: '0.5em' }}>
                <button style={cronStyles.dangerBtn} onClick={handleConfirmDelete}>
                  确认删除
                </button>
                <button style={cronStyles.secondaryBtn} onClick={handleCloseConfirm}>取消</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CronEntryRow — single entry with countdown
// ---------------------------------------------------------------------------

function CronEntryRow({ entry, now, onFreeze, onDelete }: {
  entry: CronEntry;
  now: number;
  onFreeze: () => void;
  onDelete: () => void;
}) {
  // `now` is passed from parent CronTab's single timer — no per-row setInterval
  const remaining = Math.max(0, entry.nextRun - now);
  const isRepeating = !!entry.repeatMs;
  const statusColor = entry.frozen ? 'var(--status-warning)' : (remaining < 60000 ? 'var(--status-success)' : theme.dimText);
  const statusText = entry.frozen ? '⏸ 冻结' : (remaining < 60000 ? '⏳ 即将触发' : '▶ 运行中');

  return (
    <div style={{
      ...cronStyles.entry,
      opacity: entry.frozen ? 0.6 : 1,
      borderLeft: `3px solid ${entry.frozen ? 'var(--status-warning)' : 'var(--status-success)'}`,
    }}>
      {/* Top row: description / tag / status */}
      <div style={cronStyles.entryTop}>
        <span style={{ color: theme.toolName, fontWeight: 'bold', flex: 1 }}>
          {entry.description || entry.message.slice(0, 40) + (entry.message.length > 40 ? '...' : '')}
        </span>
        {entry.tag && (
          <span style={cronStyles.tag}>{entry.tag}</span>
        )}
        <span style={{ color: statusColor, fontSize: '0.85em' }}>{statusText}</span>
      </div>

      {/* Message */}
      <div style={{ color: theme.toolResult, fontSize: '0.9em', marginBottom: '0.3em', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {entry.message}
      </div>

      {/* Details */}
      <div style={cronStyles.entryDetails}>
        <span style={cronStyles.detail}>创建者: {entry.creatorSession}</span>
        <span style={cronStyles.detail}>目标: {entry.target || '自己'}{entry.target === '*' ? ' (广播)' : ''}</span>
        <span style={cronStyles.detail}>重复: {isRepeating ? formatMs(entry.repeatMs!) : '一次性'}</span>
        <span style={cronStyles.detail}>创建: {formatTimestamp(entry.createdAt)}</span>
      </div>

      {/* Countdown */}
      <div style={cronStyles.entryDetails}>
        <span style={{ color: entry.frozen ? theme.dimText : 'var(--status-success)', fontFamily: 'monospace' }}>
          ⏱ {entry.frozen ? '已暂停' : `下次触发: ${formatMs(remaining)}`}
        </span>
      </div>

      {/* ID (small) */}
      <div style={{ color: 'var(--text-muted)', fontSize: '0.75em', marginTop: '0.2em' }}>
        ID: {entry.id.slice(0, 8)}...
      </div>

      {/* Actions */}
      <div style={cronStyles.entryActions}>
        <button style={cronStyles.btnSmall} onClick={onFreeze}>
          {entry.frozen ? '▶ 激活' : '⏸ 冻结'}
        </button>
        <button style={{ ...cronStyles.btnSmall, color: 'var(--status-error)' }} onClick={onDelete}>
          🗑 删除
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CronTab Styles
// ---------------------------------------------------------------------------

const cronStyles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5em',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0.5em 0',
    borderBottom: `1px solid var(--border-color)`,
  },
  dataRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5em',
    padding: '0.3em 0',
  },
  headerActions: {
    display: 'flex',
    gap: '0.5em',
  },
  form: {
    background: 'rgba(0,0,0,0.3)',
    border: `1px solid ${theme.border}`,
    borderRadius: '4px',
    padding: '0.8em',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5em',
  },
  formRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5em',
  },
  label: {
    color: theme.dimText,
    fontSize: '0.9em',
    minWidth: '4em',
  },
  input: {
    flex: 1,
    background: 'var(--bg-primary)',
    border: `1px solid var(--text-muted)`,
    borderRadius: '3px',
    padding: '0.3em 0.5em',
    color: theme.toolResult,
    fontSize: '0.9em',
    fontFamily: 'inherit',
    outline: 'none',
  },
  select: {
    flex: 1,
    background: 'var(--bg-primary)',
    border: `1px solid var(--text-muted)`,
    borderRadius: '3px',
    padding: '0.3em 0.5em',
    color: theme.toolResult,
    fontSize: '0.9em',
    fontFamily: 'inherit',
    outline: 'none',
    colorScheme: 'dark' as React.CSSProperties['colorScheme'],
  },
  formActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '0.5em',
    marginTop: '0.3em',
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5em',
  },
  entry: {
    background: 'rgba(0,0,0,0.2)',
    border: `1px solid var(--border-color)`,
    borderRadius: '4px',
    padding: '0.6em 0.8em',
  },
  entryTop: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5em',
    marginBottom: '0.3em',
  },
  tag: {
    background: 'var(--border-color)',
    color: theme.dimText,
    fontSize: '0.8em',
    padding: '0.1em 0.5em',
    borderRadius: '3px',
  },
  entryDetails: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '1em',
    fontSize: '0.85em',
    color: theme.dimText,
  },
  detail: {},
  entryActions: {
    display: 'flex',
    gap: '0.5em',
    marginTop: '0.5em',
  },
  btn: {
    background: 'var(--border-color)',
    border: `1px solid var(--text-muted)`,
    borderRadius: '3px',
    padding: '0.3em 0.8em',
    color: theme.toolResult,
    fontSize: '0.85em',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  btnSmall: {
    background: 'transparent',
    border: `1px solid var(--text-muted)`,
    borderRadius: '3px',
    padding: '0.2em 0.6em',
    color: theme.toolResult,
    fontSize: '0.8em',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  confirmOverlay: {
    position: 'fixed' as const, top: 0, left: 0, right: 0, bottom: 0,
    background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center',
    justifyContent: 'center', zIndex: 1000,
    animation: 'fade-in 0.2s ease-out',
  },
  confirmBox: {
    background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '8px',
    padding: '1.5em', maxWidth: '400px', width: '90%',
    boxShadow: '0 4px 24px rgba(0,0,0,0.3)',
    animation: 'scale-in 0.2s ease-out',
  },
  dangerBtn: {
    background: 'var(--status-error)', color: '#fff', border: 'none',
    borderRadius: '4px', padding: '0.5em 1em', cursor: 'pointer',
    fontFamily: 'inherit', fontSize: '0.9em',
  },
  secondaryBtn: {
    background: 'var(--bg-secondary)', color: 'var(--text-primary)',
    border: '1px solid var(--border-color)', borderRadius: '4px',
    padding: '0.5em 1em', cursor: 'pointer',
    fontFamily: 'inherit', fontSize: '0.9em',
  },
};

// ---------------------------------------------------------------------------
// CookieTab — Cookie management (🍪 网络访问)
// ---------------------------------------------------------------------------

interface CookieProfile {
  id: string;
  domain: string;
  label: string;
  active: boolean;
  cookies: CookieEntry[];
  createdAt: string;
  updatedAt: string;
}

interface CookieEntry {
  name: string;
  value: string;
  domain: string;
  path?: string;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: string;
  expires?: string;
}

function CookieTab({ bridge }: { bridge: Bridge }) {
  const [profiles, setProfiles] = useState<CookieProfile[]>([]);
  const [loading, setLoading] = useState(false); // Don't show loading on initial render
  const [loaded, setLoaded] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState('');
  const [importLabel, setImportLabel] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [addDomain, setAddDomain] = useState('');
  const [addLabel, setAddLabel] = useState('');
  const [addCookies, setAddCookies] = useState('');
  const [status, setStatus] = useState<string | null>(null);

  const sendCookie = useCallback((cmd: Record<string, any>) => {
    return new Promise<any>((resolve) => {
      const id = `cookie-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      // Cookie commands are handled by server directly (no session required)
      // Responses come as meta events (no sessionId in response)
      const unsub = bridge.onMetaEvent((event: any) => {
        if (event.id === id) {
          unsub();
          resolve(event);
        }
      });
      bridge.sendGlobalCommand({ ...cmd, id } as any);
      // Timeout after 3s
      setTimeout(() => { unsub(); resolve(null); }, 3000);
    });
  }, [bridge]);

  const refresh = useCallback(() => {
    setLoading(true);
    const id = `cookie-list-${Date.now()}`;
    const unsub = bridge.onMetaEvent((event: any) => {
      if (event.id === id && event.type === 'cookie_list_result') {
        setProfiles(event.profiles || []);
        setLoading(false);
        setLoaded(true);
        unsub();
      }
    });
    bridge.sendGlobalCommand({ cmd: 'cookie_list', id });
    setTimeout(() => { setLoading(false); unsub(); }, 3000);
  }, [bridge]);

  useEffect(() => { refresh(); }, [refresh]);

  const handleActivate = useCallback(async (profileId: string) => {
    const res = await sendCookie({ cmd: 'cookie_activate', profileId });
    if (res?.success) setStatus(`已激活 ${profileId}`);
    else setStatus(`激活失败: ${res?.error || '未知错误'}`);
    refresh();
  }, [sendCookie, refresh]);

  const handleFreeze = useCallback(async (profileId: string) => {
    const res = await sendCookie({ cmd: 'cookie_freeze', profileId });
    if (res?.success) setStatus(`已冻结 ${profileId}`);
    else setStatus(`冻结失败: ${res?.error || '未知错误'}`);
    refresh();
  }, [sendCookie, refresh]);

  const handleDelete = useCallback(async (profileId: string) => {
    const res = await sendCookie({ cmd: 'cookie_delete', profileId });
    if (res?.success) setStatus(`已删除 ${profileId}`);
    else setStatus(`删除失败: ${res?.error || '未知错误'}`);
    refresh();
  }, [sendCookie, refresh]);

  const handleExport = useCallback(async (profileId?: string) => {
    const res = await sendCookie({ cmd: 'cookie_export', profileId });
    if (res?.data) {
      navigator.clipboard.writeText(res.data).then(() => setStatus('已复制到剪贴板'));
    } else {
      setStatus(`导出失败: ${res?.error || '未知错误'}`);
    }
  }, [sendCookie]);

  const handleImport = useCallback(async () => {
    if (!importText.trim()) return;
    const res = await sendCookie({ cmd: 'cookie_import', data: importText, label: importLabel || undefined });
    if (res?.success) {
      setStatus(`导入成功: ${res.profiles?.length || 0} 个配置`);
      setShowImport(false);
      setImportText('');
      setImportLabel('');
      refresh();
    } else {
      setStatus(`导入失败: ${res?.error || '未知错误'}`);
    }
  }, [sendCookie, importText, importLabel, refresh]);

  const handleAdd = useCallback(async () => {
    if (!addDomain.trim() || !addCookies.trim()) return;
    try {
      const cookies = JSON.parse(addCookies);
      if (!Array.isArray(cookies)) throw new Error('cookies must be an array');
      // Add domain to each cookie if missing
      for (const c of cookies) {
        if (!c.domain) c.domain = addDomain.startsWith('.') ? addDomain : `.${addDomain}`;
      }
      const res = await sendCookie({ cmd: 'cookie_add', cookies, label: addLabel || undefined });
      if (res?.success) {
        setStatus(`添加成功: ${res.profile?.id}`);
        setShowAdd(false);
        setAddDomain('');
        setAddLabel('');
        setAddCookies('');
        refresh();
      } else {
        setStatus(`添加失败: ${res?.error || '未知错误'}`);
      }
    } catch (err: any) {
      setStatus(`JSON 解析错误: ${err.message}`);
    }
  }, [sendCookie, addDomain, addLabel, addCookies, refresh]);

  // Group profiles by domain
  const grouped = useMemo(() => {
    const map = new Map<string, CookieProfile[]>();
    for (const p of profiles) {
      const existing = map.get(p.domain) || [];
      existing.push(p);
      map.set(p.domain, existing);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [profiles]);

  const cookieEntryStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: '1fr 2fr 80px 60px',
    gap: '0.5em',
    padding: '0.3em 0.5em',
    fontSize: '0.85em',
    borderBottom: '1px solid var(--border-color)',
    alignItems: 'center',
  };

  const cookieHeaderStyle: React.CSSProperties = {
    ...cookieEntryStyle,
    color: theme.dimText,
    fontWeight: 'bold',
    borderBottom: '1px solid var(--text-muted)',
  };

  return (
    <div style={{ padding: '0.5em 0' }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', gap: '0.5em', marginBottom: '0.8em', flexWrap: 'wrap' }}>
        <button style={styles.actionBtn} onClick={() => setShowAdd(true)}>＋ 添加</button>
        <button style={styles.actionBtn} onClick={() => setShowImport(true)}>↑ 导入</button>
        <button style={styles.actionBtn} onClick={() => handleExport()}>↓ 导出全部</button>
        <button style={styles.actionBtn} onClick={refresh}>↻ 刷新</button>
      </div>

      {status && (
        <div style={{ color: theme.dimText, fontSize: '0.85em', marginBottom: '0.5em' }}
          onClick={() => setStatus(null)}>
          {status} <span style={{ cursor: 'pointer', opacity: 0.6 }}>✕</span>
        </div>
      )}

      {loading ? (
        <div style={{ color: theme.dimText, textAlign: 'center', padding: '2em' }}>加载中...</div>
      ) : grouped.length === 0 ? (
        <div style={{ color: theme.dimText, textAlign: 'center', padding: '2em' }}>
          暂无 Cookie 配置。<br />点击"＋ 添加"或"↑ 导入"来添加。
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5em' }}>
          {grouped.map(([domain, group]) => (
            <div key={domain} style={{
              background: 'var(--bg-primary)',
              border: '1px solid var(--border-color)',
              borderRadius: '4px',
              overflow: 'hidden',
            }}>
              {/* Domain header */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                padding: '0.5em 0.8em',
                cursor: 'pointer',
                background: 'var(--bg-secondary)',
                gap: '0.5em',
              }} onClick={() => {
                // Toggle expand: if any in group is expanded, collapse all; otherwise expand first
                const anyExpanded = group.some(p => expandedId === p.id);
                setExpandedId(anyExpanded ? null : group[0].id);
              }}>
                <span style={{ fontSize: '0.9em', color: 'var(--text-muted)' }}>▶</span>
                <span style={{ color: theme.toolName, fontWeight: 'bold', fontSize: '0.95em' }}>{domain}</span>
                <span style={{ color: theme.dimText, fontSize: '0.8em' }}>({group.length})</span>
                <div style={{ flex: 1 }} />
                {group.some(p => p.active) && (
                  <span style={{ color: 'var(--status-success)', fontSize: '0.8em' }}>● 已激活</span>
                )}
              </div>

              {/* Profile cards within domain */}
              {group.map(profile => (
                <div key={profile.id} style={{ borderTop: '1px solid var(--border-color)' }}>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '0.4em 0.8em 0.4em 1.5em',
                    gap: '0.5em',
                  }}>
                    <span style={{
                      width: 8, height: 8, borderRadius: '50%',
                      background: profile.active ? 'var(--status-success)' : 'var(--text-muted)',
                      flexShrink: 0,
                    }} />
                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.9em', flex: 1 }}>{profile.label}</span>
                    <span style={{ color: theme.dimText, fontSize: '0.75em' }}>
                      {profile.cookies.length} 条 · {new Date(profile.createdAt).toLocaleDateString()}
                    </span>
                    <button style={styles.actionBtn}
                      onClick={() => setExpandedId(expandedId === profile.id ? null : profile.id)}>
                      {expandedId === profile.id ? '收起' : '展开'}
                    </button>
                    {!profile.active ? (
                      <button style={{ ...styles.actionBtn, color: 'var(--status-success)' }}
                        onClick={() => handleActivate(profile.id)}>激活</button>
                    ) : (
                      <button style={{ ...styles.actionBtn, color: 'var(--status-warning)' }}
                        onClick={() => handleFreeze(profile.id)}>冻结</button>
                    )}
                    <button style={{ ...styles.actionBtn, color: 'var(--accent-blue)' }}
                      onClick={() => handleExport(profile.id)}>导出</button>
                    <button style={{ ...styles.actionBtn, color: theme.errorText }}
                      onClick={() => { if (confirm(`确定删除 ${profile.label}？`)) handleDelete(profile.id); }}>删除</button>
                  </div>

                  {/* Expanded cookie table */}
                  {expandedId === profile.id && (
                    <div style={{ padding: '0.3em 0.8em 0.5em 2em' }}>
                      <div style={cookieHeaderStyle}>
                        <span>名称</span><span>值</span><span>路径</span><span>属性</span>
                      </div>
                      {profile.cookies.map((c, i) => (
                        <div key={i} style={cookieEntryStyle}>
                          <span style={{ color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: '0.85em' }}>{c.name}</span>
                          <span style={{ color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: '0.85em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.value}>
                            {c.value.length > 40 ? c.value.slice(0, 37) + '...' : c.value}
                          </span>
                          <span style={{ color: 'var(--text-muted)', fontSize: '0.85em' }}>{c.path || '/'}</span>
                          <span style={{ color: 'var(--text-muted)', fontSize: '0.75em' }}>
                            {[c.httpOnly && 'H', c.secure && 'S', c.sameSite].filter(Boolean).join(' ')}
                            {c.expires && c.expires !== 'session' && (
                              <> · {new Date(c.expires) < new Date() ? <span style={{ color: theme.errorText }}>过期</span> : new Date(c.expires).toLocaleDateString()}</>
                            )}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Add modal */}
      {showAdd && (
        <div style={modalOverlayStyle} onClick={() => setShowAdd(false)}>
          <div style={modalContentStyle} onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 'bold', marginBottom: '0.8em', color: theme.toolName }}>添加 Cookie</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6em' }}>
              <label style={{ color: theme.dimText, fontSize: '0.85em' }}>域名</label>
              <input style={modalInputStyle} value={addDomain} onChange={e => setAddDomain(e.target.value)}
                placeholder=".example.com" />
              <label style={{ color: theme.dimText, fontSize: '0.85em' }}>标签（可选）</label>
              <input style={modalInputStyle} value={addLabel} onChange={e => setAddLabel(e.target.value)}
                placeholder="GitHub Login" />
              <label style={{ color: theme.dimText, fontSize: '0.85em' }}>Cookies JSON 数组</label>
              <textarea style={{ ...modalInputStyle, minHeight: '6em', fontFamily: 'monospace', fontSize: '0.85em', resize: 'vertical' }}
                value={addCookies} onChange={e => setAddCookies(e.target.value)}
                placeholder={'[{"name":"session","value":"abc123","path":"/","httpOnly":true,"secure":true}]'} />
              <div style={{ display: 'flex', gap: '0.5em', justifyContent: 'flex-end', marginTop: '0.5em' }}>
                <button style={styles.cancelBtn} onClick={() => setShowAdd(false)}>取消</button>
                <button style={styles.saveBtn} onClick={handleAdd}>添加</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Import modal */}
      {showImport && (
        <div style={modalOverlayStyle} onClick={() => setShowImport(false)}>
          <div style={modalContentStyle} onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 'bold', marginBottom: '0.8em', color: theme.toolName }}>导入 Cookie (Netscape 格式)</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6em' }}>
              <label style={{ color: theme.dimText, fontSize: '0.85em' }}>标签（可选）</label>
              <input style={modalInputStyle} value={importLabel} onChange={e => setImportLabel(e.target.value)}
                placeholder="Google Account" />
              <label style={{ color: theme.dimText, fontSize: '0.85em' }}>Netscape Cookie 数据</label>
              <textarea style={{ ...modalInputStyle, minHeight: '8em', fontFamily: 'monospace', fontSize: '0.85em', resize: 'vertical' }}
                value={importText} onChange={e => setImportText(e.target.value)}
                placeholder={'.example.com\tTRUE\t/\tFALSE\t0\tsession\tvalue'} />
              <div style={{ display: 'flex', gap: '0.5em', justifyContent: 'flex-end', marginTop: '0.5em' }}>
                <button style={styles.cancelBtn} onClick={() => setShowImport(false)}>取消</button>
                <button style={styles.saveBtn} onClick={handleImport}>导入</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const modalOverlayStyle: React.CSSProperties = {
  position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
  background: 'rgba(0,0,0,0.7)', zIndex: 10001,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};

const modalContentStyle: React.CSSProperties = {
  background: 'var(--bg-primary)', border: '1px solid var(--text-muted)', borderRadius: '6px',
  padding: '1.2em', width: 'min(500px, 90vw)', maxHeight: '80vh', overflow: 'auto',
};

const modalInputStyle: React.CSSProperties = {
  background: '#111', border: '1px solid var(--text-muted)', borderRadius: '3px',
  padding: '0.4em 0.6em', color: 'var(--text-secondary)', fontSize: '0.9em', outline: 'none', width: '100%',
  boxSizing: 'border-box' as const,
};

// ---------------------------------------------------------------------------
// ConnectionPanel
// ---------------------------------------------------------------------------

interface VesperConfig {
  [key: string]: any;
}

export function ConnectionPanel({ bridge, storeRef, onClose }: ConnectionPanelProps) {
  const { isClosing, handleClose, handleOverlayClick, overlayAnimation, panelAnimation } = useModalAnimation(onClose);

  const [activeTab, setActiveTab] = useState<ConnTabId>('cron');
  const [config, setConfig] = useState<VesperConfig>({});
  const [originalJson, setOriginalJson] = useState<string>('__loading__');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const saveSuccessTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Subscribe to store changes so cron state updates reactively.
  // Use trailing-edge debounce: wait until store settles for 300ms before re-rendering.
  // This avoids re-rendering on every streaming token (~50ms batches).
  // NOTE: We intentionally do NOT include storeRef in the dependency array.
  // storeRef is a React ref (stable identity); its .current may change but the ref
  // object itself stays the same. Including it would cause unnecessary re-subscriptions
  // and can trigger infinite loops (cron_query → cron_snapshot → re-render → cron_query…).
  const [storeTick, setStoreTick] = useState(0);
  useEffect(() => {
    const store = storeRef.current;
    if (!store) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsub = store.subscribe(() => {
      // Reset timer on each update — only fire after 300ms of silence
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        setStoreTick(t => t + 1);
      }, 300);
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsub();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Cron state is derived from store (events come via session path, not meta)
  // storeTick is read to ensure re-render on store changes
  const storeSnapshot = storeRef.current?.getSnapshot();
  void storeTick; // ensures re-render trigger is consumed
  const cronEntries: CronEntry[] = storeSnapshot?.cronEntries ?? [];
  const cronRunning: false | string | true = storeSnapshot?.cronRunning ?? false;

  // Dirty detection: compare current config JSON with original
  // Use useMemo to avoid re-serializing on every render (e.g. from store ticks)
  const currentJson = useMemo(() => JSON.stringify(config, null, 2), [config]);
  const dirty = originalJson === '__loading__' ? false : currentJson !== originalJson;

  // Clear the brief "saved" confirmation as soon as the user makes new changes
  useEffect(() => {
    if (dirty) setSaveSuccess(false);
  }, [dirty]);

  // Keys that belong to project-level config
  // Managed exclusively by ConnectionPanel (Connections)
  const PROJECT_KEYS = new Set([
    'cronDataCollection', 'qqbot',
  ]);

  // Keys that belong to global-level config (managed by ConnectionPanel's MCP/Relay tabs)
  const GLOBAL_KEYS = new Set([
    'mcpServers', 'mcp', 'link', 'proxy',
  ]);

  // Internal/temporary keys injected by server during read — never write these back
  const INTERNAL_KEYS = new Set(['_mergedGlobalProfiles', '_mergedGlobalPersonas', '_mergedGlobalQqbot']);

  // Load config on mount: read both project and global configs, then merge for display.
  // MCP/Relay/QQBot settings live in global config, while cron/team settings live in project config.
  const pendingConfigsRef = useRef<{ project: VesperConfig | null; global: VesperConfig | null }>({ project: null, global: null });

  const applyMergedConfig = useCallback((projectCfg: VesperConfig, globalCfg: VesperConfig) => {
    // Merge: project values take priority for shared keys, global provides MCP/Relay/QQBot etc.
    const merged = { ...globalCfg, ...projectCfg };
    setConfig(merged);
    setOriginalJson(JSON.stringify(merged, null, 2));
    setLoading(false);
  }, []);

  // Safety timeout ref for save operation
  const pendingSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track pending save scopes to know when all writes are confirmed
  const pendingSaveScopesRef = useRef<Set<string>>(new Set());
  // Track whether any scope failed during the current save cycle (for the success indicator)
  const saveFailedRef = useRef(false);

  useEffect(() => {
    let configReloadTimer: ReturnType<typeof setTimeout>;
    const unsub = bridge.onMetaEvent((event) => {
      if (event.type === 'config_file_content') {
        const eventScope = (event as any).scope ?? 'global';
        if (event.error) {
          setError(event.error);
          setLoading(false);
          return;
        }
        try {
          let raw = event.content ?? '';
          if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
          const parsed = raw ? JSON.parse(raw) : {};
          // Store the config for the appropriate scope
          if (eventScope === 'project') {
            pendingConfigsRef.current.project = parsed;
          } else if (eventScope === 'global') {
            pendingConfigsRef.current.global = parsed;
          }
          // Once both configs are loaded, merge and apply
          if (pendingConfigsRef.current.project !== null && pendingConfigsRef.current.global !== null) {
            applyMergedConfig(pendingConfigsRef.current.project, pendingConfigsRef.current.global);
          }
        } catch (e: any) {
          setError(`解析失败: ${e.message}`);
          setLoading(false);
        }
      }
      if (event.type === 'config_file_saved') {
        const eventScope = (event as any).scope ?? 'global';
        if (!(event as any).success) {
          setError(`保存失败 (${eventScope}): ${(event as any).error}`);
          saveFailedRef.current = true;
          setSaveSuccess(false);
        }
        // Remove this scope from pending saves
        pendingSaveScopesRef.current.delete(eventScope);
        // Only clear saving state when all pending saves are confirmed
        if (pendingSaveScopesRef.current.size === 0) {
          if (pendingSaveTimeoutRef.current) {
            clearTimeout(pendingSaveTimeoutRef.current);
            pendingSaveTimeoutRef.current = null;
          }
          setSaving(false);
          // Flash a success confirmation on the save button, then auto-revert
          if (!saveFailedRef.current) {
            setSaveSuccess(true);
            if (saveSuccessTimeoutRef.current) clearTimeout(saveSuccessTimeoutRef.current);
            saveSuccessTimeoutRef.current = setTimeout(() => setSaveSuccess(false), 2000);
          }
        }
      }
      if (event.type === 'config_updated') {
        // Debounce: re-read both configs after a short delay
        clearTimeout(configReloadTimer);
        configReloadTimer = setTimeout(() => {
          pendingConfigsRef.current = { project: null, global: null };
          bridge.readConfigFile('project', false);
          bridge.readConfigFile('global', false);
        }, 100) as any;
      }
    });
    // Load both project and global configs on mount
    bridge.readConfigFile('project', false);
    bridge.readConfigFile('global', false);
    return () => {
      clearTimeout(configReloadTimer);
      if (saveSuccessTimeoutRef.current) clearTimeout(saveSuccessTimeoutRef.current);
      unsub();
    };
  }, [bridge, applyMergedConfig]);

  // Request cron entries when tab is shown
  // NOTE: Same as above — don't include storeRef in deps to avoid infinite loops.
  useEffect(() => {
    if (activeTab === 'cron') {
      const sid = storeRef.current?.getSnapshot()?.sessionId;
      if (sid) {
        bridge.sendCommand(sid, { cmd: 'cron_query', id: `cq-${Date.now()}` });
      }
    }
  }, [activeTab, bridge]); // eslint-disable-line react-hooks/exhaustive-deps

  // Config set helper — local state only, does NOT write to file
  const set = useCallback(<K extends keyof VesperConfig>(key: K, value: VesperConfig[K]) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  }, []);

  // Save handler: only write keys managed by ConnectionPanel, preserve others
  const handleSave = useCallback(() => {
    // Guard: don't attempt save if bridge is not connected (messages would be silently dropped)
    if (bridge.state !== 'connected') {
      setError('保存失败：未连接到服务器，请稍后重试');
      return;
    }
    setSaving(true);
    setError(null);
    saveFailedRef.current = false;

    // For project config: merge our managed keys into the existing project config
    // to avoid overwriting keys managed by ConfigPanel
    const projectBase = pendingConfigsRef.current.project ?? {};
    const mergedProject = { ...projectBase };
    for (const k of PROJECT_KEYS) {
      const v = (config as any)[k];
      if (v === undefined || v === null || (typeof v === 'object' && !Array.isArray(v) && Object.keys(v as any).length === 0)) {
        delete mergedProject[k];
      } else {
        mergedProject[k] = v;
      }
    }

    // For global config: merge our managed keys into the existing global config
    const globalBase = pendingConfigsRef.current.global ?? {};
    const mergedGlobal = { ...globalBase };
    for (const k of GLOBAL_KEYS) {
      const v = (config as any)[k];
      if (v === undefined || v === null || (typeof v === 'object' && !Array.isArray(v) && Object.keys(v as any).length === 0)) {
        delete mergedGlobal[k];
      } else {
        mergedGlobal[k] = v;
      }
    }

    console.log('[ConnectionPanel] handleSave: mergedProject keys=', Object.keys(mergedProject).filter(k => PROJECT_KEYS.has(k)), 'mergedGlobal keys=', Object.keys(mergedGlobal).filter(k => GLOBAL_KEYS.has(k)));

    // Track both scopes as pending saves
    pendingSaveScopesRef.current = new Set(['project', 'global']);

    // Write both configs
    bridge.writeConfigFile(JSON.stringify(mergedProject, null, 2), 'project');
    bridge.writeConfigFile(JSON.stringify(mergedGlobal, null, 2), 'global');

    // Safety timeout: if server doesn't respond within 10s, clear saving state
    // This prevents the UI from getting stuck in "saving..." forever
    const saveTimeout = setTimeout(() => {
      console.warn('[ConnectionPanel] SAVE TIMEOUT — no config_file_saved response within 10s, pending scopes=', [...pendingSaveScopesRef.current]);
      setSaving(false);
      setSaveSuccess(false);
      setError('保存超时（服务器未响应）');
      pendingSaveScopesRef.current.clear();
    }, 10000);
    pendingSaveTimeoutRef.current = saveTimeout;
  }, [config, bridge, storeRef]);

  // Cancel handler: restore original config
  const handleCancel = useCallback(() => {
    if (originalJson !== '__loading__') {
      try {
        setConfig(JSON.parse(originalJson));
      } catch { /* ignore parse errors on cancel */ }
    }
    handleClose();
  }, [originalJson, handleClose]);

  // Escape to close (with dirty check)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (dirty) {
          // If there are unsaved changes, just close (discard)
          // Could add a confirmation dialog here in the future
        }
        handleClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleClose, dirty]);

  // Get sessionId for cron tab
  const sessionId = storeRef.current?.getSnapshot()?.sessionId ?? '';

  // Derive cron data collection state from config (local state, not runtime)
  const cronDataCollectionEnabled = !!(config as any).cronDataCollection?.enabled;
  const cronDataCollectionPath = (config as any).cronDataCollection?.path || '';

  return (
    <div style={{ ...styles.overlay, animation: overlayAnimation }} onClick={handleOverlayClick}>
      <div style={{ ...styles.panel, animation: panelAnimation }}>
        {/* Header */}
        <div style={styles.header}>
          <span style={{ color: theme.bannerTitle, fontWeight: 'bold' }}>🔗 连接与扩展</span>
          <button style={styles.closeBtn} onClick={handleClose}>x</button>
        </div>

        {/* Tab bar */}
        <div style={styles.tabBar}>
          {CONN_TABS.map(t => {
            const isActive = t.id === activeTab;
            return (
              <button
                key={t.id}
                style={{ ...styles.tab, ...(isActive ? styles.tabActive : {}) }}
                onClick={() => setActiveTab(t.id)}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Body */}
        {loading ? (
          <div style={styles.loading}>正在加载配置...</div>
        ) : error ? (
          <div style={{ color: theme.errorText, padding: '1em' }}>{error}</div>
        ) : (
          <div style={styles.body}>
            {activeTab === 'mcp' && (
              <McpTab config={config} set={set} />
            )}
            {activeTab === 'relay' && (
              <RelayTab config={config} set={set} bridge={bridge} />
            )}
            {activeTab === 'qqbot' && (
              <QQBotTab config={config} set={set} bridge={bridge} />
            )}
            {activeTab === 'cron' && (
              <CronTab
                bridge={bridge}
                sessionId={sessionId}
                cronEntries={cronEntries}
                cronRunning={cronRunning}
                cronDataCollectionEnabled={cronDataCollectionEnabled}
                cronDataCollectionPath={cronDataCollectionPath}
                onSetDataCollection={(enabled, path) => {
                  // Update local config state
                  setConfig(prev => ({
                    ...prev,
                    cronDataCollection: {
                      ...(prev.cronDataCollection || {}),
                      enabled,
                      ...(path !== undefined ? { path } : {}),
                    },
                  }));
                  // Also sync to runtime immediately for responsiveness
                  // (persistence to file happens on "保存修改")
                  if (sessionId) {
                    bridge.sendCommand(sessionId, {
                      cmd: 'cron_set_data_collection',
                      id: `csdc-${Date.now()}`,
                      enabled,
                      path: path || undefined,
                    });
                  }
                }}
              />
            )}
            {activeTab === 'cookies' && (
              <CookieTab bridge={bridge} />
            )}
          </div>
        )}

        {/* Footer with Cancel / Save buttons */}
        {!loading && (
          <div style={styles.footer}>
            {error && <span style={styles.errorText}>{error}</span>}
            <div style={{ flex: 1 }} />
            <button style={styles.cancelBtn} onClick={handleCancel}>取消</button>
            <button
              style={{ ...styles.saveBtn, opacity: dirty && !saving ? 1 : 0.5 }}
              onClick={handleSave}
              disabled={!dirty || saving}
            >
              {saving ? '正在保存...' : '保存修改'}
            </button>
            {/* Status indicator: red dot = unsaved changes, green ✓ = just saved */}
            {saveSuccess ? (
              <span style={{ color: 'var(--status-success)', fontWeight: 'bold', fontSize: '1.05em' }}>✓</span>
            ) : dirty && !saving ? (
              <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: 'var(--status-error)' }} />
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles (matching ConfigPanel)
// ---------------------------------------------------------------------------

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0,0,0,0.7)',
    zIndex: 1000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    animation: 'fade-in 0.2s ease-out',
  },
  panel: {
    background: 'var(--bg-primary)',
    border: '1px solid var(--border-color)',
    borderRadius: '6px',
    width: 'min(700px, 90vw)',
    maxHeight: '85vh',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
    animation: 'scale-in 0.2s ease-out',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0.6em 1em',
    borderBottom: '1px solid var(--border-color)',
  },
  closeBtn: {
    background: 'transparent',
    border: 'none',
    color: theme.dimText,
    fontSize: '1.2em',
    cursor: 'pointer',
    padding: '0 0.5em',
    lineHeight: 1,
  },
  tabBar: {
    display: 'flex',
    borderBottom: '1px solid var(--border-color)',
    padding: '0 0.5em',
    overflowX: 'auto',
    overflowY: 'hidden',
    scrollbarWidth: 'none',
  },
  tab: {
    background: 'transparent',
    border: 'none',
    borderBottom: '2px solid transparent',
    color: theme.dimText,
    fontSize: '0.9em',
    padding: '0.5em 0.8em',
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'border-bottom-color 0.2s, color 0.2s',
    whiteSpace: 'nowrap',
    flexShrink: 0,
  },
  tabActive: {
    color: theme.toolName,
    borderBottom: `2px solid ${theme.toolName}`,
  },
  body: {
    flex: 1,
    overflow: 'auto',
    padding: '0.8em 1em',
  },
  loading: {
    padding: '2em',
    textAlign: 'center' as const,
    color: theme.dimText,
  },
  footer: {
    display: 'flex',
    alignItems: 'center',
    gap: '1ch',
    padding: '0.5em 1ch',
    borderTop: '1px solid var(--border-color)',
    flexShrink: 0,
  },
  errorText: {
    color: theme.errorText,
    fontSize: '0.85em',
    maxWidth: '40ch',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  cancelBtn: {
    padding: '0.25em 1ch',
    background: 'transparent',
    border: '1px solid var(--border-color)',
    borderRadius: '2px',
    color: 'var(--text-secondary)',
    fontFamily: 'inherit',
    fontSize: 'inherit',
    cursor: 'pointer',
  },
  saveBtn: {
    padding: '0.25em 2ch',
    background: 'var(--accent-blue)',
    border: 'none',
    borderRadius: '2px',
    color: 'var(--btn-primary-text, #FFFFFF)',
    fontFamily: 'inherit',
    fontSize: 'inherit',
    fontWeight: 'bold',
    cursor: 'pointer',
  },
};
