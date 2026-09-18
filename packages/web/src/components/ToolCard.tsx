// ═══════════════════════════════════════════════════════════════════════════
// Vesper WebUI — ToolCard (TUI style: ● dot + tree border + diff/file views)
//
// Collapse model (original):
//   collapsed=true  → header only (no content shown)
//   collapsed=false → header + clampResult preview (3-line/200-char)
//
// Special handling for `script` tool:
//   - Always defaults to expanded
//   - Code param wrapped in ```javascript and rendered as markdown
//   - Result rendered as markdown (for code block highlighting)
// ═══════════════════════════════════════════════════════════════════════════

import React, { memo, useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { theme } from '../theme.js';
import { formatElapsed, formatArgsPreview, clampResult } from '../lib/format-utils.js';
import { renderMarkdown } from '../lib/markdown.js';
import type { ToolCallEntry, ToolResultMeta } from '../store.js';
import { TreeContent } from './TreeContent.js';
import { DiffView, FileReadView } from './DiffView.js';
import { subflowContainerStyle, subflowBadgeStyle } from './subflow-styles.js';

interface ToolCardProps {
  entry: ToolCallEntry;
  onToggle?: (id: string) => void;
}

/** Format line range suffix, e.g. " :100-200" or "" if reading entire file. */
function formatLineRange(m: { startLine?: number; endLine?: number; lineCount?: number }): string {
  if (!m.startLine || !m.endLine || !m.lineCount) return '';
  if (m.startLine === 1 && m.endLine === m.lineCount) return '';
  return ` :${m.startLine}-${m.endLine}`;
}

// CC-style header for file tools: "Read (path)" / "Write (path)" / "Update (path)"
function formatFileToolHeader(meta: ToolResultMeta): { label: string; path: string } | null {
  switch (meta.type) {
    case 'file_read':
      return { label: 'Read ', path: (meta.filePath ?? '') + formatLineRange(meta) };
    case 'file_write':
      return { label: meta.created ? 'Write ' : 'Update ', path: meta.filePath ?? '' };
    case 'file_edit':
      return { label: 'Update ', path: meta.filePath ?? '' };
    default:
      return null;
  }
}

/** Format full args for detail display (no truncation). */
function formatArgsFull(args: Record<string, any>): string {
  const entries = Object.entries(args);
  if (entries.length === 0) return '';
  return entries.map(([k, v]) => {
    const val = typeof v === 'string' ? v : JSON.stringify(v, null, 2);
    // For long string values, show them as multiline
    if (typeof v === 'string' && val.length > 80) {
      return `${k}=${val}`;
    }
    return `${k}=${val}`;
  }).join(', ');
}

/** Wrap script code in a javascript code fence for markdown rendering. */
function wrapScriptCode(code: string): string {
  return '```javascript\n' + code + '\n```';
}

/** Render script result — wrap bare output in a code fence if it doesn't already have one. */
function wrapScriptResult(text: string): string {
  // If the result already contains markdown code fences, render as-is
  if (text.includes('```')) return text;
  // Otherwise treat the entire output as plain text in a code block
  return '```\n' + text + '\n```';
}

// ---------------------------------------------------------------------------
// Detail Modal Styles
// ---------------------------------------------------------------------------

const modalOverlayStyle: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  background: 'rgba(0,0,0,0.7)',
  zIndex: 99999,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  animation: 'fade-in 0.2s ease',
};

const modalContentStyle: React.CSSProperties = {
  background: 'var(--bg-primary)',
  border: `1px solid ${theme.toolName}`,
  borderRadius: 'var(--radius-lg)',
  padding: '1em',
  maxWidth: '90vw',
  width: '800px',
  maxHeight: '80vh',
  display: 'flex',
  flexDirection: 'column',
  boxShadow: 'var(--shadow-elevated)',
  animation: 'scale-in 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
};

const modalHeaderStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: '0.5em',
  paddingBottom: '0.5em',
  borderBottom: '1px solid var(--border-color)',
  flexShrink: 0, // 确保头部在内容过多时不会被压缩
};

const modalBodyStyle: React.CSSProperties = {
  overflowY: 'auto',
  fontSize: '0.9em',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  lineHeight: 1.4,
  color: 'var(--text-primary)',
  maxHeight: '55vh',
  minHeight: '3em',
};

export const ToolCard = memo(function ToolCard({ entry, onToggle }: ToolCardProps) {
  const [showDetail, setShowDetail] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [justCompleted, setJustCompleted] = useState(false);

  const isPending = !entry.result;
  const isError = entry.result?.isError;
  const isSubflow = !!entry.subflow;
  const isScript = entry.call.name === 'script';

  // Track completion for animation
  useEffect(() => {
    if (!isPending && !isError) {
      setJustCompleted(true);
      const timer = setTimeout(() => setJustCompleted(false), 500);
      return () => clearTimeout(timer);
    }
  }, [isPending, isError]);

  // Status dot + color
  let dotColor: string;
  let dotClass = '';
  if (isPending) {
    dotColor = theme.toolPending;
    dotClass = 'tui-dot-pulse';
  } else if (isError) {
    dotColor = theme.toolError;
  } else {
    dotColor = theme.toolSuccess;
  }

  const elapsed = entry.elapsedMs ? formatElapsed(entry.elapsedMs) : '';
  const argsPreview = formatArgsPreview(entry.call.arguments);

  // Determine result rendering mode
  const meta = entry.result?.meta;
  const hasDiff = meta?.type === 'file_edit' || meta?.type === 'file_write';
  const hasFileRead = meta?.type === 'file_read';
  const hasFileAttachment = meta?.type === 'file_attachment';

  // CC-style header for file tools (completed, non-error)
  const fileHeader = !isPending && !isError && meta && !hasFileAttachment ? formatFileToolHeader(meta) : null;

  // Format file attachment size
  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // File icon based on MIME type
  const getFileIcon = (mimeType: string): string => {
    if (mimeType.startsWith('image/')) return '🖼️';
    if (mimeType.startsWith('audio/')) return '🎵';
    if (mimeType.startsWith('video/')) return '🎬';
    if (mimeType.includes('pdf')) return '📄';
    if (mimeType.includes('word') || mimeType.includes('docx')) return '📝';
    if (mimeType.includes('sheet') || mimeType.includes('xlsx')) return '📊';
    if (mimeType.includes('presentation') || mimeType.includes('pptx')) return '📑';
    if (mimeType.startsWith('text/')) return '📃';
    if (mimeType.includes('zip') || mimeType.includes('tar') || mimeType.includes('gzip')) return '📦';
    return '📎';
  };

  // Pre-render script markdown (memoized)
  const scriptCodeHtml = useMemo(() => {
    if (!isScript || !entry.call.arguments.code) return '';
    return renderMarkdown(wrapScriptCode(entry.call.arguments.code as string));
  }, [isScript, entry.call.arguments.code]);

  const scriptResultHtml = useMemo(() => {
    if (!isScript || !entry.result?.content) return '';
    // For script results, use fullContent if available (truncated inline for perf)
    const resultText = entry.result.fullContent ?? entry.result.content;
    // Limit markdown rendering to prevent lag on very long outputs
    const maxRenderLen = 50000;
    const textToRender = resultText.length > maxRenderLen
      ? resultText.slice(0, maxRenderLen) + '\n\n... (output truncated for display)'
      : resultText;
    return renderMarkdown(wrapScriptResult(textToRender));
  }, [isScript, entry.result?.content, entry.result?.fullContent]);

  // Detail Modal Content Logic
  const renderDetailContent = () => {
    if (!entry.result) return <div style={{ color: theme.dimText }}>No result available</div>;

    // Use fullContent if available (truncated results), otherwise fall back to content
    const displayContent = entry.result.fullContent ?? entry.result.content;

    // Shared scrollable block style with independent max-height
    const scrollableBlockStyle: React.CSSProperties = {
      overflowY: 'auto',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      lineHeight: 1.4,
      background: 'var(--bg-tertiary)',
      padding: '0.5em 0.75em',
      borderRadius: '3px',
      fontSize: '0.85em',
    };

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75em', flex: '1 1 auto', minHeight: 0 }}>
        {/* ── AI Call Instruction ── */}
        <div style={{ display: 'flex', flexDirection: 'column', flex: '0 1 auto', maxHeight: '30vh' }}>
          <div style={{ color: theme.toolName, marginBottom: '0.3em', fontWeight: 'bold', fontSize: '0.85em', flexShrink: 0 }}>Instruction:</div>
          <div style={{
            ...scrollableBlockStyle,
            flex: '1 1 auto',
            minHeight: 0,
            borderLeft: `2px solid ${theme.toolName}`,
          }}>
            {entry.call.name}({formatArgsFull(entry.call.arguments)})
          </div>
        </div>

        {/* ── Result Details (flexible, takes remaining space) ── */}
        <div style={{ display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: 0 }}>
          <div style={{ color: theme.toolName, marginBottom: '0.3em', fontWeight: 'bold', fontSize: '0.85em', flexShrink: 0 }}>Result:</div>
          {renderResultDetail(displayContent, scrollableBlockStyle)}
        </div>
      </div>
    );
  };

  const renderResultDetail = (fullText?: string, baseStyle?: React.CSSProperties) => {
    const contentStyle = baseStyle ? { ...baseStyle, background: 'var(--bg-tertiary)' } : { ...modalBodyStyle, background: 'var(--bg-tertiary)' };
    
    if (meta?.type === 'file_read') {
      if (meta.fileContent) {
        return <div style={{ ...contentStyle, padding: '0.75em', flex: '1 1 auto', minHeight: 0 }}>{meta.fileContent}</div>;
      }
      return <div style={{ ...contentStyle, color: theme.dimText, padding: '0.75em', flex: '1 1 auto', minHeight: 0 }}>File content not available (file too large or read without content retention).</div>;
    }

    // Script Details
    if (isScript) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5em', flex: '1 1 auto', minHeight: 0 }}>
          <div style={{ display: 'flex', flexDirection: 'column', flex: '0 1 auto', maxHeight: '30vh' }}>
            <div style={{ color: theme.toolName, marginBottom: '0.3em', fontWeight: 'bold', fontSize: '0.85em', flexShrink: 0 }}>Code:</div>
            <div
              style={{ ...contentStyle, padding: '0.5em', flex: '1 1 auto', minHeight: 0 }}
              dangerouslySetInnerHTML={{ __html: scriptCodeHtml || 'No code provided' }}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: 0 }}>
            <div style={{ color: theme.toolName, marginBottom: '0.3em', fontWeight: 'bold', fontSize: '0.85em', flexShrink: 0 }}>Output:</div>
            <div
              style={{ ...contentStyle, padding: '0.5em', flex: '1 1 auto', minHeight: 0 }}
              dangerouslySetInnerHTML={{ __html: scriptResultHtml }}
            />
          </div>
        </div>
      );
    }

    // Standard Text Output — use full content in detail modal
    return (
      <div style={{ ...contentStyle, padding: '0.75em', flex: '1 1 auto', minHeight: 0 }}>
        {fullText ?? entry.result?.content ?? ''}
      </div>
    );
  };

  // Handle detail modal close with animation
  const handleCloseDetail = () => {
    setIsClosing(true);
    // Wait for animation to complete before hiding
    setTimeout(() => {
      setShowDetail(false);
      setIsClosing(false);
    }, 200); // Match fade-out duration
  };

  return (
    <div
      className={`tui-card ${justCompleted ? 'tui-tool-complete' : ''}`}
      style={{
        ...styles.container,
        ...(isSubflow ? subflowContainerStyle : {}),
      }}
    >
      {/* Header row */}
      <div
        style={styles.header}
        onClick={() => !isPending && onToggle?.(entry.id)}
        role={isPending ? undefined : 'button'}
        tabIndex={isPending ? undefined : 0}
      >
        <span className={dotClass} style={{ color: dotColor }}>● </span>
        {isSubflow && (
          <span style={subflowBadgeStyle}>{entry.subflow!.label}</span>
        )}
        {fileHeader ? (
          <>
            <span style={{ color: theme.toolName, fontWeight: 'bold' }}>{fileHeader.label}</span>
            <span style={{ color: theme.toolArgs }}>{fileHeader.path}</span>
          </>
        ) : (
          <>
            <span style={{ color: theme.toolName, fontWeight: 'bold' }}>{entry.call.name}</span>
            <span style={{ color: theme.toolArgs }}> {argsPreview}</span>
          </>
        )}
        {elapsed && <span style={{ color: theme.dimText }}> ({elapsed})</span>}
        {!isPending && (
          <span style={{ color: theme.dimText }}> {entry.collapsed ? '▸' : '▾'}</span>
        )}
        {!isPending && (
          <span
            style={{ marginLeft: '0.5em', cursor: 'pointer', fontSize: '0.85em', color: theme.dimText, opacity: 0.7 }}
            onClick={(e) => { e.stopPropagation(); setShowDetail(true); }}
            title="View details"
          >
            📋
          </span>
        )}
      </div>

      {/* Result content (when not collapsed) */}
      {!isPending && !entry.collapsed && entry.result && (
        <TreeContent color={isError ? theme.toolError : theme.toolSuccess}>
          {/* ── Script tool: markdown-rendered code + result ── */}
          {isScript ? (
            <div>
              {/* Script code (input) */}
              {scriptCodeHtml && (
                <div
                  style={styles.scriptSection}
                  dangerouslySetInnerHTML={{ __html: scriptCodeHtml }}
                />
              )}
              {/* Script result (output) */}
              <div
                style={styles.scriptSection}
                dangerouslySetInnerHTML={{ __html: scriptResultHtml }}
              />
            </div>
          ) : hasFileAttachment && meta ? (
            /* ── File attachment card ── */
            <div style={styles.fileAttachmentCard}>
              {/* Image: inline thumbnail */}
              {(meta.mimeType ?? '').startsWith('image/') && meta.token ? (
                <div style={styles.fileAttachmentPreview}>
                  <img
                    src={`/api/files/${meta.token}`}
                    alt={meta.filename ?? 'image'}
                    style={styles.fileAttachmentThumb}
                    onClick={() => setPreviewUrl(`/api/files/${meta.token}`)}
                  />
                </div>
              ) : (meta.mimeType ?? '').startsWith('audio/') && meta.token ? (
                /* Audio: inline player */
                <div style={styles.fileAttachmentAudioWrap}>
                  <span style={{ ...styles.fileAttachmentIcon, fontSize: '1.2em', marginRight: 4 }}>🎵</span>
                  <audio
                    controls
                    src={`/api/files/${meta.token}`}
                    style={styles.fileAttachmentAudio}
                    preload="metadata"
                  />
                </div>
              ) : (
                /* Generic file icon */
                <span style={styles.fileAttachmentIcon}>{getFileIcon(meta.mimeType ?? 'application/octet-stream')}</span>
              )}
              <div style={styles.fileAttachmentInfo}>
                <div style={styles.fileAttachmentName}>{meta.filename ?? 'unknown'}</div>
                <div style={styles.fileAttachmentMeta}>{formatFileSize(meta.sizeBytes ?? 0)} · {meta.mimeType ?? 'unknown'}</div>
              </div>
              <a
                href={`/api/files/${meta.token}`}
                download={meta.filename}
                style={styles.fileAttachmentDownload}
              >
                ⬇️ Download
              </a>
            </div>
          ) : hasDiff && meta ? (
            <DiffView meta={meta as any} />
          ) : hasFileRead && meta ? (
            <div>
              <FileReadView meta={meta} />
            </div>
          ) : (
            <div style={{
              color: isError ? theme.errorText : theme.toolResult,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}>
              {clampResult(entry.result.content)}
            </div>
          )}

          {entry.result.hasAttachments && (
            <div style={{ color: theme.dimText }}>
              📎 {entry.result.attachmentCount ?? 0} attachment(s)
            </div>
          )}
        </TreeContent>
      )}

      {/* Detail Modal - rendered via Portal to escape stacking context */}
      {showDetail && createPortal(
        <div
          style={{
            ...modalOverlayStyle,
            animation: isClosing ? 'fade-out 0.2s ease forwards' : modalOverlayStyle.animation,
          }}
          onClick={handleCloseDetail}
        >
          <div
            style={{
              ...modalContentStyle,
              animation: isClosing ? 'scale-out 0.2s cubic-bezier(0.4, 0, 0.2, 1) forwards' : modalContentStyle.animation,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={modalHeaderStyle}>
              <div style={{ fontWeight: 'bold', color: theme.toolName }}>
                {entry.call.name} Details
              </div>
              <button
                style={styles.closeBtn}
                onClick={handleCloseDetail}
              >
                ✕
              </button>
            </div>
            {renderDetailContent()}
          </div>
        </div>,
        document.body
      )}

      {/* Image Preview Modal - rendered via Portal to escape stacking context */}
      {previewUrl && createPortal(
        <div
          style={styles.imagePreviewOverlay}
          onClick={() => setPreviewUrl(null)}
        >
          <div style={styles.imagePreviewContent} onClick={e => e.stopPropagation()}>
            <button
              style={styles.imagePreviewClose}
              onClick={() => setPreviewUrl(null)}
            >
              ✕
            </button>
            <img
              src={previewUrl}
              alt="Preview"
              style={styles.imagePreviewImg}
            />
            <a
              href={previewUrl}
              download
              style={styles.imagePreviewDownload}
            >
              ⬇️ Download
            </a>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
});

const styles: Record<string, React.CSSProperties> = {
  container: {
    marginBottom: '0.75em',
    padding: '0.75em 1ch',
    borderRadius: 'var(--radius-md)',
    background: 'var(--bg-secondary)',
  },
  header: {
    cursor: 'pointer',
    userSelect: 'none',
    paddingLeft: '0.5ch',
  },
  scriptSection: {
    marginBottom: '0.5em',
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
  fileAttachmentCard: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '8px 12px',
    background: 'rgba(255,255,255,0.03)',
    borderRadius: '6px',
    border: '1px solid var(--bg-tertiary)',
  },
  fileAttachmentIcon: {
    fontSize: '1.6em',
    flexShrink: 0,
  },
  fileAttachmentInfo: {
    flex: 1,
    minWidth: 0,
  },
  fileAttachmentName: {
    color: 'var(--text-secondary)',
    fontSize: '0.95em',
    fontWeight: 'bold',
    overflow: 'hidden' as const,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  fileAttachmentMeta: {
    color: 'var(--text-muted)',
    fontSize: '0.8em',
    marginTop: '2px',
  },
  fileAttachmentDownload: {
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid var(--text-muted)',
    borderRadius: '4px',
    padding: '6px 12px',
    color: 'var(--text-muted)',
    fontSize: '0.85em',
    cursor: 'pointer',
    textDecoration: 'none',
    flexShrink: 0,
    fontFamily: 'inherit',
  },
  fileAttachmentPreview: {
    flexShrink: 0,
    cursor: 'pointer',
  },
  fileAttachmentThumb: {
    maxWidth: '120px',
    maxHeight: '80px',
    objectFit: 'contain' as const,
    borderRadius: '4px',
    border: '1px solid var(--border-color)',
    display: 'block',
  },
  fileAttachmentAudioWrap: {
    display: 'flex',
    alignItems: 'center',
    flexShrink: 0,
    gap: '4px',
  },
  fileAttachmentAudio: {
    height: '32px',
    maxWidth: '200px',
    borderRadius: '4px',
  },
  imagePreviewOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0,0,0,0.85)',
    zIndex: 99999,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
  imagePreviewContent: {
    position: 'relative' as const,
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center' as const,
    gap: '12px',
  },
  imagePreviewClose: {
    position: 'absolute' as const,
    top: '-36px',
    right: '0',
    background: 'transparent',
    border: 'none',
    color: 'var(--text-primary)',
    fontSize: '1.5em',
    cursor: 'pointer',
    padding: '4px 8px',
    lineHeight: 1,
  },
  imagePreviewImg: {
    maxWidth: '90vw',
    maxHeight: '82vh',
    objectFit: 'contain' as const,
    borderRadius: '6px',
    boxShadow: '0 4px 24px rgba(0,0,0,0.6)',
  },
  imagePreviewDownload: {
    background: 'rgba(255,255,255,0.1)',
    border: '1px solid var(--text-muted)',
    borderRadius: 'var(--radius-sm)',
    padding: '6px 16px',
    color: 'var(--text-secondary)',
    fontSize: '0.9em',
    cursor: 'pointer',
    textDecoration: 'none',
  },
};