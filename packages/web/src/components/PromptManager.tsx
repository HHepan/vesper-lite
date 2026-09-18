// =============================================================================
// Vesper WebUI -- PromptManager (Editor & Perspective Viewer)
//
// Allows editing global prompt templates and previewing the final merged prompt
// from a specific member's perspective.
// =============================================================================

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { theme } from '../theme.js';
import type { Bridge } from '../bridge.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PromptManifest {
  version: string;
  constants: Record<string, string>;
  templates: Record<string, string>;
  toolDescriptions: Record<string, string>;
}

interface PromptPart {
  type: 'text' | 'variable';
  content: string;
}

interface VesperConfig {
  roles?: Record<string, { toolset: string; description?: string }>;
  assignments?: Array<{
    roleName: string;
    personaName: string;
    isActive: boolean;
    customPrompt?: string;
  }>;
  personas?: Array<{
    name: string;
    ego: string;
    description?: string;
  }>;
  defaultSupervisorRules?: string;
  prependSystemToEgo?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parsePromptParts(raw: string): PromptPart[] {
  const parts: PromptPart[] = [];
  const regex = /\{\{(\w+)\}\}/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(raw)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', content: raw.slice(lastIndex, match.index) });
    }
    parts.push({ type: 'variable', content: match[1] });
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < raw.length) {
    parts.push({ type: 'text', content: raw.slice(lastIndex) });
  }

  return parts;
}

function serializePromptParts(parts: PromptPart[]): string {
  return parts.map(p => p.type === 'variable' ? `{{${p.content}}}` : p.content).join('');
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

const PRESET_ROLES = [
  'explorer', 'reviewer', 'developer', 'architect', 'quick-fix', 
  'debugger', 'writer', 'daily', 'analyst', 'planner', 
  'skill-crafter', 'prompt-designer', 'overseer'
];

export function PromptManager({ bridge, config }: { bridge: Bridge; config?: VesperConfig }) {
  const [viewMode, setViewMode] = useState<'editor' | 'perspective'>('editor');
  const [manifest, setManifest] = useState<PromptManifest | null>(null);
  const [manifestLoading, setManifestLoading] = useState(true);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['Constants']));
  const [expandedSubgroups, setExpandedSubgroups] = useState<Set<string>>(new Set());

  // Editor State
  const [selectedFile, setSelectedFile] = useState<{ key: string; filename: string; label: string } | null>(null);
  const [rawContent, setRawContent] = useState<string>('');
  const [parts, setParts] = useState<PromptPart[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isOverridden, setIsOverridden] = useState(false);
  const [dotLuxDir, setDotLuxDir] = useState<string | undefined>(undefined);

  // Perspective State
  const [selectedPersonaName, setSelectedPersonaName] = useState('');
  const [selectedRoleName, setSelectedRoleName] = useState('');
  const [perspectiveCustomPrompt, setPerspectiveCustomPrompt] = useState('');
  const [previewResult, setPreviewResult] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // ── Initial Data Loading ───────────────────────────────────────
  useEffect(() => {
    const unsub = bridge.onMetaEvent((ev) => {
      if (ev.type === 'prompts_list') {
        setManifestLoading(false);
        if (ev.error) setError(ev.error);
        else {
          setManifest(ev.manifest);
          setDotLuxDir(ev.dotLuxPromptsDir);
        }
      }
      if (ev.type === 'prompt_content') {
        setLoading(false);
        setRawContent(ev.content || '');
        setParts(parsePromptParts(ev.content || ''));
        setIsOverridden(!!ev.overridden);
      }
      if (ev.type === 'prompt_saved') {
        setSaving(false);
        if (!ev.success) {
          setError(ev.error || '保存失败');
        } else {
          setRawContent(serializePromptParts(parts)); // Mark as clean
          setIsOverridden(!!ev.overridden);
        }
      }
      if (ev.type === 'prompt_preview_result') {
        setPreviewLoading(false);
        if (ev.error) setError(ev.error);
        else setPreviewResult(ev.content ?? null);
      }
    });

    bridge.listPrompts();
    return unsub;
  }, [bridge, parts]);

  // ── Reset to Default Handler ──────────────────────────────────
  const [confirmReset, setConfirmReset] = useState(false);

  const handleResetToDefault = () => {
    if (!selectedFile) return;
    if (!confirmReset) {
      setConfirmReset(true);
      setTimeout(() => setConfirmReset(false), 3000); // auto-dismiss after 3s
      return;
    }
    setConfirmReset(false);
    bridge.deletePromptOverride(selectedFile.filename);
    // Re-read the built-in version after a brief delay for the server to process
    setTimeout(() => {
      bridge.readPrompt(selectedFile.filename);
      setIsOverridden(false);
    }, 300);
  };

  // ── Editor Handlers ───────────────────────────────────────────
  const handleSelectFile = (key: string, filename: string, label: string) => {
    setError(null);
    setSelectedFile({ key, filename, label });
    setLoading(true);
    bridge.readPrompt(filename);
  };

  const handleTextChange = (idx: number, newContent: string) => {
    const next = [...parts];
    next[idx] = { ...next[idx], content: newContent };
    setParts(next);
  };

  const handleSave = () => {
    if (!selectedFile) return;
    setSaving(true);
    const content = serializePromptParts(parts);
    bridge.writePrompt(selectedFile.filename, content);
  };

  const isDirty = useMemo(() => {
    return serializePromptParts(parts) !== rawContent;
  }, [parts, rawContent]);

  const toggleGroup = (groupLabel: string) => {
    const next = new Set(expandedGroups);
    if (next.has(groupLabel)) next.delete(groupLabel);
    else next.add(groupLabel);
    setExpandedGroups(next);
  };

  // ── Perspective Handlers ─────────────────────────────────────
  const updatePreview = () => {
    // Allow empty persona (shows default/SYSTEM) and empty role (no role assignment)
    const persona = selectedPersonaName
      ? config?.personas?.find(p => p.name === selectedPersonaName)
      : null;

    setError(null);
    setPreviewLoading(true);
    bridge.readPromptPreview(
      persona || { name: 'default', ego: '', description: '' },
      selectedRoleName || '',
      perspectiveCustomPrompt,
      config?.defaultSupervisorRules,
      config?.prependSystemToEgo
    );
  };

  // ── Render ─────────────────────────────────────────────────────

  // Separate "injected" prompts from templates
  // These are runtime-injected reminders and warnings
  const INJECTED_KEYS = new Set([
    'loopWarningContent',
    'formatReminderContent',
    'errorRecoveryContent',
    'userSidebandContent',
    'circuitBreakerMessage',
    'noProgressCriticalMessage',
    'pingPongCriticalMessage',
    'noProgressWarningMessage',
    'pingPongWarningMessage',
    'genericRepeatWarningMessage',
    'flowAbortedContent',
    'subagentCompletedContent',
    'linkMessageContent',
    'timeAwarenessInterval',
    'timeAwarenessFormat',
  ]);

  // Keys that belong to subagents, not core constants
  const SUBAGENT_CONSTANT_KEYS = new Set([
    'CURATOR_SYSTEM_PROMPT',
    'SUPERVISOR_PERMISSION_SYSTEM_PROMPT',
    'SUPERVISOR_ASK_USER_SYSTEM_PROMPT',
    'SUPERVISOR_RULES',
    'MEMORY_AGENT_SYSTEM_PROMPT',
  ]);

  // Separate CONTEXT_BUDGET_WARNING and subagent keys from constants
  const constantsWithoutWarning: Record<string, string> = {};
  const contextBudgetWarning: Record<string, string> = {};
  if (manifest?.constants) {
    for (const [key, val] of Object.entries(manifest.constants)) {
      if (key === 'CONTEXT_BUDGET_WARNING') {
        contextBudgetWarning[key] = val as string;
      } else if (SUBAGENT_CONSTANT_KEYS.has(key)) {
        // Skip — these are shown in the Subagents group
      } else {
        constantsWithoutWarning[key] = val as string;
      }
    }
  }

  // Separate injected templates from regular templates
  const regularTemplates: Record<string, string> = {};
  const injectedTemplates: Record<string, string> = {};
  if (manifest?.templates) {
    for (const [key, val] of Object.entries(manifest.templates)) {
      if (INJECTED_KEYS.has(key)) {
        injectedTemplates[key] = val as string;
      } else {
        regularTemplates[key] = val as string;
      }
    }
  }

  // Combined injected prompts: CONTEXT_BUDGET_WARNING + injected templates + injected section from manifest
  const injectedPrompts: Record<string, string> = { ...contextBudgetWarning, ...injectedTemplates, ...(manifest as any)?.injected };

  // ── Tool description subcategories ──
  // Group tool description keys into functional subcategories for the UI.
  // Keys not matched by any category go into "其他" (Other).
  const TOOL_DESC_CATEGORIES: Record<string, { title: string; keys: string[] }> = {
    'core':      { title: '核心工具', keys: ['read', 'write', 'write_md', 'write_docx', 'write_xlsx', 'edit', 'glob', 'grep', 'bash', 'script', 'send_file'] },
    'task':      { title: '任务系统', keys: ['task_create', 'task_update', 'task_list', 'task_get', 'task_delete'] },
    'memory':    { title: '记忆/知识', keys: ['remember', 'recall', 'inspect', 'graph'] },
    'network':   { title: '网络', keys: ['fetch'] },
    'cron':      { title: '定时任务', keys: ['cron_schedule', 'cron_list', 'cron_cancel'] },
    'persona':   { title: '身份/技能', keys: ['switch_persona', 'list_personas', 'current_persona', 'save_persona', 'find_personas', 'list_skills', 'load_skill', 'unload_skill', 'find_skills'] },
    'toolset':   { title: '工具集', keys: ['list_toolsets', 'switch_toolset', 'current_toolset', 'find_toolsets'] },
    'lsp':       { title: 'LSP 代码智能', keys: ['lsp_find_definition', 'lsp_find_references', 'lsp_find_implementation', 'lsp_get_diagnostics', 'lsp_get_hover', 'lsp_rename_symbol', 'lsp_rename_symbol_strict', 'lsp_find_workspace_symbols', 'lsp_prepare_call_hierarchy', 'lsp_get_incoming_calls', 'lsp_get_outgoing_calls', 'lsp_restart_server'] },
    'session':   { title: 'Session 通信', keys: ['session_list', 'session_peek', 'session_post'] },
    'discovery': { title: '工具发现', keys: ['search_tools'] },
    'todo':      { title: '待办', keys: ['peek_master_todo'] },
  };

  // Build two-level tool description data: Record<categoryName, Record<key, file>>
  const toolDescCategories: Record<string, Record<string, string>> = {};
  if (manifest?.toolDescriptions) {
    const td = manifest.toolDescriptions;
    const categorized = new Set<string>();
    for (const [catKey, cat] of Object.entries(TOOL_DESC_CATEGORIES)) {
      const sub: Record<string, string> = {};
      for (const k of cat.keys) {
        if (td[k]) { sub[k] = td[k]; categorized.add(k); }
      }
      if (Object.keys(sub).length > 0) toolDescCategories[cat.title] = sub;
    }
    // Remaining uncategorized keys → "其他"
    const other: Record<string, string> = {};
    for (const [k, v] of Object.entries(td)) {
      if (!categorized.has(k)) other[k] = v;
    }
    if (Object.keys(other).length > 0) toolDescCategories['其他'] = other;
  }

  // Merge egos into constants (they are constant-level overrides)
  const constantsWithEgos: Record<string, string> = { ...constantsWithoutWarning };
  if ((manifest as any)?.egos) {
    for (const [key, file] of Object.entries((manifest as any).egos as Record<string, string>)) {
      constantsWithEgos[key] = file;
    }
  }

  const groups = [
    { label: 'Constants', title: '核心指令', data: constantsWithEgos },
    { label: 'Subagents', title: '子智能体相关', data: (manifest as any)?.subagents, isTwoLevel: true },
    { label: 'QQBot', title: 'QQ机器人', data: (manifest as any)?.qqbot },
    { label: 'Injected', title: '内嵌指令', data: injectedPrompts },
    { label: 'Templates', title: '系统模板', data: regularTemplates },
    { label: 'ToolDesc', title: '工具描述', data: toolDescCategories, isTwoLevel: true },
    { label: 'Roles', title: '岗位分工', data: (manifest as any)?.roles },
    { label: 'Extra', title: '其他文件', data: (manifest as any)?.extra },
  ];

  const allRoleOptions = useMemo(() => {
    const rolesFromConfig = config?.roles ? Object.keys(config.roles) : [];
    return Array.from(new Set([...PRESET_ROLES, ...rolesFromConfig]));
  }, [config?.roles]);

  return (
    <div style={styles.container}>
      {/* Header Tabs */}
      <div style={styles.header}>
        <button
          style={{ ...styles.navBtn, ...(viewMode === 'editor' ? styles.navBtnActive : {}) }}
          onClick={() => setViewMode('editor')}
        >
          编辑模板 (Editor)
        </button>
        <button
          style={{ ...styles.navBtn, ...(viewMode === 'perspective' ? styles.navBtnActive : {}) }}
          onClick={() => setViewMode('perspective')}
        >
          成员视角 (Perspective)
        </button>
      </div>

      <div style={styles.content}>
        {viewMode === 'editor' ? (
          <div style={{ display: 'flex', height: '100%' }}>
            {/* Sidebar */}
            <div style={styles.sidebar}>
              {manifestLoading ? (
                <div style={styles.statusHint}>正在加载提示词列表...</div>
              ) : !manifest ? (
                <div style={styles.statusHint}>无法获取提示词 manifest</div>
              ) : groups.map((group, gIdx) => {
                const isTwoLevel = !!(group as any).isTwoLevel;
                // For two-level groups (subagents), data is Record<agentName, Record<key, file>>
                const count = group.data
                  ? isTwoLevel
                    ? Object.values(group.data).reduce((sum: number, sub: any) => sum + Object.keys(sub as Record<string, string>).length, 0)
                    : Object.keys(group.data).length
                  : 0;
                if (count === 0 && group.label === 'Extra') return null;
                const isExpanded = expandedGroups.has(group.label);
                const toggleSubgroup = (name: string) => {
                  setExpandedSubgroups(prev => {
                    const next = new Set(prev);
                    if (next.has(name)) next.delete(name); else next.add(name);
                    return next;
                  });
                };

                return (
                  <div key={gIdx} style={styles.group}>
                    <div style={styles.groupHeader} onClick={() => toggleGroup(group.label)}>
                      <span style={{ fontSize: '0.7em', marginRight: '0.5em', transform: isExpanded ? 'rotate(90deg)' : 'none', display: 'inline-block' }}>▶</span>
                      <span style={styles.groupLabel}>{group.title}</span>
                      <div style={{ flex: 1 }} />
                      <span style={styles.groupCount}>{count}</span>
                    </div>
                    {isExpanded && group.data && !isTwoLevel && (
                      <div style={styles.groupItems}>
                        {Object.entries(group.data).map(([key, file]) => {
                          const isActive = selectedFile?.key === key;
                          return (
                            <button
                              key={key}
                              style={{ ...styles.promptBtn, ...(isActive ? styles.promptBtnActive : {}) }}
                              onClick={() => handleSelectFile(key, file as string, key)}
                              title={file as string}
                            >
                              {key}
                            </button>
                          );
                        })}
                      </div>
                    )}
                    {isExpanded && group.data && isTwoLevel && (
                      <div style={styles.groupItems}>
                        {Object.entries(group.data as Record<string, Record<string, string>>).map(([agentName, prompts]) => {
                          const subCount = Object.keys(prompts).length;
                          const isSubExpanded = expandedSubgroups.has(agentName);
                          return (
                            <div key={agentName}>
                              <div
                                style={{ ...styles.groupHeader, paddingLeft: '0.8em', cursor: 'pointer', fontSize: '0.9em' }}
                                onClick={(e) => { e.stopPropagation(); toggleSubgroup(agentName); }}
                              >
                                <span style={{ fontSize: '0.65em', marginRight: '0.4em', transform: isSubExpanded ? 'rotate(90deg)' : 'none', display: 'inline-block' }}>▶</span>
                                <span style={{ ...styles.groupLabel, fontSize: '0.9em' }}>{agentName}</span>
                                <div style={{ flex: 1 }} />
                                <span style={{ ...styles.groupCount, fontSize: '0.85em' }}>{subCount}</span>
                              </div>
                              {isSubExpanded && Object.entries(prompts).map(([key, file]) => {
                                const isActive = selectedFile?.key === key;
                                return (
                                  <button
                                    key={key}
                                    style={{ ...styles.promptBtn, marginLeft: '1.6em', ...(isActive ? styles.promptBtnActive : {}) }}
                                    onClick={() => handleSelectFile(key, file, key)}
                                    title={file}
                                  >
                                    {key}
                                  </button>
                                );
                              })}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Editor Area */}
            <div style={styles.mainArea}>
              {!selectedFile ? (
                <div style={styles.emptyHint}>请从左侧选择一个提示词进行编辑</div>
              ) : loading ? (
                <div style={styles.emptyHint}>正在加载内容...</div>
              ) : (
                <div style={styles.editArea}>
                  <div style={styles.toolbar}>
                    <span style={styles.filename}>{selectedFile.filename}</span>
                    {isOverridden && <span style={{ ...styles.overriddenMark, marginLeft: '0.5em' }}>⚡ 自定义</span>}
                    <div style={{ flex: 1 }} />
                    {isOverridden && (
                      <button
                        style={{ ...styles.resetBtn, color: confirmReset ? '#ff6b6b' : 'var(--text-muted)', borderColor: confirmReset ? '#ff6b6b' : 'var(--text-muted)' }}
                        onClick={handleResetToDefault}
                        title="删除 .vesper/prompts/ 中的覆盖文件，还原为内置默认版本"
                      >
                        {confirmReset ? '确认还原？' : '还原默认'}
                      </button>
                    )}
                    {isDirty && <span style={styles.dirtyMark}>● 未保存</span>}
                    <button
                      style={{ ...styles.saveBtn, opacity: isDirty && !saving ? 1 : 0.5 }}
                      disabled={!isDirty || saving}
                      onClick={handleSave}
                    >
                      {saving ? '正在保存...' : '保存修改'}
                    </button>
                  </div>

                  <div style={styles.partsList}>
                    {parts.map((p, idx) => (
                      <div key={idx} style={styles.partRow}>
                        {p.type === 'variable' ? (
                          <div style={styles.varBadge}>
                            <span style={styles.varBracket}>{"{{"}</span>
                            <span style={styles.varName}>{p.content}</span>
                            <span style={styles.varBracket}>{"}}"}</span>
                          </div>
                        ) : (
                          <AutoResizingTextarea
                            value={p.content}
                            onChange={(val) => handleTextChange(idx, val)}
                            placeholder="(输入文本内容...)"
                          />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* Perspective View */
          <div style={styles.perspectiveContainer}>
            <div style={styles.perspectiveSidebar}>
              <div style={styles.sectionLabel}>模拟配置 (Mock Config)</div>
              
              <div style={styles.field}>
                <label style={styles.label}>人格 (Ego):</label>
                <select
                  style={styles.select}
                  value={selectedPersonaName}
                  onChange={(e) => setSelectedPersonaName(e.target.value)}
                >
                  <option value="">(默认 — 无人格)</option>
                  {config?.personas?.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
                </select>
              </div>

              <div style={styles.field}>
                <label style={styles.label}>担任角色 (Role):</label>
                <select
                  style={styles.select}
                  value={selectedRoleName}
                  onChange={(e) => setSelectedRoleName(e.target.value)}
                >
                  <option value="">(无角色)</option>
                  {allRoleOptions.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>

              <div style={styles.field}>
                <label style={styles.label}>特定指令 (Custom Prompt):</label>
                <textarea
                  style={{ ...styles.textarea, height: '100px', fontSize: '0.9em', border: '1px solid var(--border-color)' }}
                  value={perspectiveCustomPrompt}
                  onChange={(e) => setPerspectiveCustomPrompt(e.target.value)}
                  placeholder="该成员分工的特定指令内容..."
                />
              </div>

              <button
                style={{ ...styles.saveBtn, marginTop: '1em', width: '100%' }}
                onClick={updatePreview}
                disabled={previewLoading}
              >
                {previewLoading ? '正在生成预览...' : '生成完整提示词预览'}
              </button>

              <div style={{ marginTop: '2em', fontSize: '0.8em', color: 'var(--text-muted)' }}>
                提示：预览视角将按照真正的 <code>PromptBuilder</code> 逻辑拼接全局常量、系统模板和成员 ego。
              </div>
            </div>

            <div style={styles.perspectiveMain}>
              {!previewResult ? (
                <div style={styles.emptyHint}>配置左侧参数并点击按钮生成预览</div>
              ) : (
                <div style={styles.previewContainer}>
                  <div style={styles.previewHeader}>拼装结果 (Final System Instruction) <span style={{ color: 'var(--text-muted)', fontSize: '0.85em' }}>({previewResult.length} 字符)</span></div>
                  <pre style={styles.previewPre}>{previewResult}</pre>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {error && <div style={styles.error}>{error}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-component: Auto-resizing Textarea
// ---------------------------------------------------------------------------

function AutoResizingTextarea({ value, onChange, placeholder }: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.style.height = 'auto';
      ref.current.style.height = ref.current.scrollHeight + 'px';
    }
  }, [value]);

  return (
    <textarea
      ref={ref}
      style={styles.textarea}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={1}
      spellCheck={false}
    />
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    background: 'var(--bg-primary)',
    color: 'var(--text-primary)',
  },
  header: {
    display: 'flex',
    borderBottom: '1px solid var(--border-color)',
    background: 'var(--bg-secondary)',
    flexShrink: 0,
  },
  navBtn: {
    padding: '0.6em 1.5em',
    background: 'transparent',
    border: 'none',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    fontSize: '0.9em',
    fontWeight: 'bold',
    borderBottom: '2px solid transparent',
  },
  navBtnActive: {
    color: 'var(--text-primary)',
    borderBottomColor: 'var(--accent-blue)',
    background: 'rgba(255,255,255,0.05)',
  },
  content: {
    flex: 1,
    minHeight: 0,
  },
  sidebar: {
    width: '240px',
    borderRight: '1px solid var(--border-color)',
    overflowY: 'auto',
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--bg-secondary)',
  },
  mainArea: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
  },
  group: {
    borderBottom: '1px solid var(--border-color)',
  },
  groupHeader: {
    padding: '0.6em 1em',
    background: 'var(--border-color)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    userSelect: 'none',
  },
  groupLabel: {
    fontSize: '0.85em',
    color: 'var(--text-secondary)',
    fontWeight: 'bold',
  },
  groupCount: {
    fontSize: '0.75em',
    color: 'var(--text-muted)',
    background: 'rgba(0,0,0,0.2)',
    padding: '0 0.5em',
    borderRadius: '10px',
  },
  groupItems: {
    padding: '0.2em 0',
    background: 'var(--bg-primary)',
  },
  promptBtn: {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    background: 'transparent',
    border: 'none',
    color: 'var(--text-secondary)',
    padding: '0.4em 1.5em',
    cursor: 'pointer',
    fontSize: '0.85em',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  promptBtnActive: {
    background: 'var(--bg-tertiary)',
    color: 'var(--text-primary)',
    boxShadow: 'inset 2px 0 0 var(--accent-blue)',
  },
  statusHint: {
    padding: '2em 1em',
    fontSize: '0.85em',
    color: 'var(--text-muted)',
    textAlign: 'center',
  },
  emptyHint: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--text-muted)',
  },
  editArea: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    padding: '0.5em 1em',
    borderBottom: '1px solid var(--border-color)',
    background: 'var(--bg-secondary)',
  },
  filename: {
    fontSize: '0.85em',
    color: 'var(--text-muted)',
    fontFamily: 'monospace',
  },
  dirtyMark: {
    fontSize: '0.75em',
    color: 'var(--status-warning)',
    marginRight: '1em',
  },
  overriddenMark: {
    fontSize: '0.7em',
    color: 'var(--status-success)',
    background: 'rgba(76, 175, 80, 0.15)',
    padding: '0.15em 0.5em',
    borderRadius: '3px',
    border: '1px solid rgba(76, 175, 80, 0.3)',
  },
  resetBtn: {
    background: 'transparent',
    border: '1px solid var(--text-muted)',
    color: 'var(--text-muted)',
    padding: '0.3em 0.8em',
    borderRadius: '3px',
    cursor: 'pointer',
    fontSize: '0.8em',
    marginRight: '0.5em',
    transition: 'color 0.2s, border-color 0.2s',
  },
  saveBtn: {
    background: 'var(--accent-blue)',
    color: 'white',
    border: 'none',
    padding: '0.4em 1em',
    borderRadius: '2px',
    cursor: 'pointer',
    fontSize: '0.85em',
    fontWeight: 'bold',
  },
  partsList: {
    flex: 1,
    overflowY: 'auto',
    padding: '1em',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5em',
  },
  partRow: {
    width: '100%',
  },
  textarea: {
    width: '100%',
    background: 'transparent',
    border: '1px transparent',
    color: 'var(--text-primary)',
    fontFamily: 'inherit',
    fontSize: '1em',
    lineHeight: '1.5',
    padding: '0.2em 0.5em',
    resize: 'none',
    outline: 'none',
    display: 'block',
    borderLeft: '2px solid var(--text-muted)',
  },
  varBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    background: 'var(--border-color)',
    padding: '0.1em 0.5em',
    borderRadius: '4px',
    margin: '0.2em 0',
    border: '1px solid var(--text-muted)',
  },
  varBracket: {
    color: 'var(--ansi-blue)',
    fontWeight: 'bold',
    fontSize: '0.9em',
  },
  varName: {
    color: 'var(--accent-bluepurple)',
    margin: '0 0.3em',
    fontFamily: 'monospace',
  },
  error: {
    padding: '0.5em 1em',
    background: 'var(--status-error-bg)',
    color: 'var(--status-error-light)',
    fontSize: '0.85em',
  },

  // Perspective Styles
  perspectiveContainer: {
    display: 'flex',
    height: '100%',
  },
  perspectiveSidebar: {
    width: '280px',
    borderRight: '1px solid var(--border-color)',
    padding: '1em',
    overflowY: 'auto',
    flexShrink: 0,
  },
  perspectiveMain: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--bg-primary)',
  },
  field: {
    marginBottom: '1em',
  },
  label: {
    display: 'block',
    fontSize: '0.8em',
    color: 'var(--text-muted)',
    marginBottom: '0.3em',
  },
  select: {
    width: '100%',
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border-color)',
    color: 'var(--text-primary)',
    padding: '0.4em',
    borderRadius: '2px',
    outline: 'none',
  },
  sectionLabel: {
    fontSize: '0.85em',
    fontWeight: 'bold',
    color: 'var(--accent-blue)',
    marginBottom: '1em',
    textTransform: 'uppercase' as const,
  },
  previewContainer: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  previewHeader: {
    padding: '0.5em 1em',
    background: 'var(--bg-secondary)',
    borderBottom: '1px solid var(--border-color)',
    fontSize: '0.85em',
    color: 'var(--text-muted)',
  },
  previewPre: {
    flex: 1,
    margin: 0,
    padding: '1em',
    overflow: 'auto',
    fontFamily: 'monospace',
    fontSize: '0.9em',
    lineHeight: '1.4',
    whiteSpace: 'pre-wrap',
    color: 'var(--text-primary)',
  },
};
