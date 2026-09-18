// ═══════════════════════════════════════════════════════════════════════════
// Vesper WebUI — TimelineItem (dispatcher for prompt/thinking/tool/text)
//
// Mirrors TUI's FrozenTimelineItemView: ● dot prefix + TreeContent border.
// ═══════════════════════════════════════════════════════════════════════════

import React, { memo, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { theme } from '../theme.js';
import type { TimelineItem as TimelineItemType } from '../store.js';
import { ThinkingBlock } from './ThinkingBlock.js';
import { ToolCard } from './ToolCard.js';
import { TreeContent } from './TreeContent.js';
import { renderMarkdown } from '../lib/markdown.js';
import { subflowContainerStyle, subflowBadgeStyle } from './subflow-styles.js';

interface TimelineItemProps {
  item: TimelineItemType;
  isStreaming?: boolean;
  onToggleTool?: (id: string) => void;
  onToggleThinking?: (id: string) => void;
}

export const TimelineItemView = memo(function TimelineItemView({
  item,
  isStreaming,
  onToggleTool,
  onToggleThinking,
}: TimelineItemProps) {
  // Image preview state — index into the prompt's image list (null = closed)
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [previewClosing, setPreviewClosing] = useState(false);
  const previewImages = item.kind === 'prompt' ? item.entry.images : undefined;
  const previewTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Close with exit animation (delayed unmount, mirrors ModalWrapper)
  const closePreview = () => {
    if (previewIndex === null) return;
    setPreviewClosing(true);
    if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    previewTimerRef.current = setTimeout(() => {
      setPreviewClosing(false);
      setPreviewIndex(null);
    }, 200); // match fade/scale duration
  };

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    };
  }, []);

  // Keyboard navigation for the preview modal (Esc close, ←/→ switch)
  useEffect(() => {
    if (previewIndex === null || !previewImages?.length) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closePreview();
      } else if (e.key === 'ArrowRight' && previewImages.length > 1) {
        setPreviewIndex(prev => (prev === null ? prev : (prev + 1) % previewImages.length));
      } else if (e.key === 'ArrowLeft' && previewImages.length > 1) {
        setPreviewIndex(prev => (prev === null ? prev : (prev - 1 + previewImages.length) % previewImages.length));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [previewIndex, previewImages]);

  switch (item.kind) {
    case 'prompt': {
      const images = item.entry.images;
      return (
        <>
          <div style={styles.prompt}>
            <span style={styles.promptMarker}>{'>'}</span>
            <div style={styles.promptBody}>
              {item.entry.content && <span style={styles.promptContent}>{item.entry.content}</span>}
            </div>
          </div>
          {images && images.length > 0 && (
            <div style={styles.promptImagesWrap}>
              {images.map((image, index) => {
                const single = images.length === 1;
                return (
                  <img
                    key={`${image.filename ?? 'image'}-${index}`}
                    src={`data:${image.mimeType};base64,${image.data}`}
                    alt={image.filename ?? `附图 ${index + 1}`}
                    title="点击查看大图"
                    style={{
                      ...(single ? styles.promptImageSingle : styles.promptImage),
                      cursor: 'zoom-in',
                    }}
                    onClick={() => setPreviewIndex(index)}
                  />
                );
              })}
            </div>
          )}

          {/* Full-size image preview modal */}
          {previewIndex !== null && images && images[previewIndex] && createPortal(
            <div
              style={{
                ...styles.imagePreviewOverlay,
                animation: previewClosing ? 'fade-out 0.2s ease-out forwards' : 'fade-in 0.2s ease-out',
              }}
              onClick={closePreview}
            >
              {images.length > 1 && (
                <>
                  <button
                    style={{ ...styles.imagePreviewNav, left: '16px' }}
                    onClick={(e) => { e.stopPropagation(); setPreviewIndex(prev => (prev === null ? prev : (prev - 1 + images.length) % images.length)); }}
                    aria-label="上一张"
                  >‹</button>
                  <button
                    style={{ ...styles.imagePreviewNav, right: '16px' }}
                    onClick={(e) => { e.stopPropagation(); setPreviewIndex(prev => (prev === null ? prev : (prev + 1) % images.length)); }}
                    aria-label="下一张"
                  >›</button>
                </>
              )}
              <div
                style={{
                  ...styles.imagePreviewContent,
                  animation: previewClosing ? 'scale-out 0.2s ease-out forwards' : 'scale-in 0.2s ease-out',
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  style={styles.imagePreviewClose}
                  onClick={closePreview}
                  aria-label="关闭"
                >✕</button>
                <img
                  src={`data:${images[previewIndex].mimeType};base64,${images[previewIndex].data}`}
                  alt={images[previewIndex].filename ?? `附图 ${previewIndex + 1}`}
                  style={styles.imagePreviewImg}
                />
                <div style={styles.imagePreviewFooter}>
                  <span style={styles.imagePreviewCounter}>
                    {previewIndex + 1} / {images.length}
                  </span>
                  <a
                    href={`data:${images[previewIndex].mimeType};base64,${images[previewIndex].data}`}
                    download={images[previewIndex].filename ?? `image-${previewIndex + 1}`}
                    style={styles.imagePreviewDownload}
                  >⬇️ 下载</a>
                </div>
              </div>
            </div>,
            document.body
          )}
        </>
      );
    }

    case 'thinking':
      return (
        <ThinkingBlock
          entry={item.entry}
          onToggle={onToggleThinking}
        />
      );

    case 'tool':
      return (
        <ToolCard
          entry={item.entry}
          onToggle={onToggleTool}
        />
      );

    case 'text': {
      const textSubflow = !!item.entry.subflow;
      const personaName = (item.entry as any).personaName as string | undefined;
      const renderedHtml = renderMarkdown(item.entry.content);
      const html = isStreaming
        ? renderedHtml + `<span class="tui-cursor" style="color:${theme.streamingCursor}">█</span>`
        : renderedHtml;

      return (
        <div style={{
          ...styles.textBlock,
          ...(textSubflow ? subflowContainerStyle : {}),
        }}>
          <div style={{ paddingLeft: '0.5ch', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <span style={{ color: theme.assistantDot }}>●</span>
              {textSubflow && (
                <span style={subflowBadgeStyle}>{item.entry.subflow!.label}</span>
              )}
            </div>
            {personaName && (
              <span style={styles.personaLabel}>{personaName}</span>
            )}
          </div>
          <TreeContent>
            <div
              style={styles.textContent}
              dangerouslySetInnerHTML={{ __html: html }}
            />
          </TreeContent>
        </div>
      );
    }

    case 'system':
      return (
        <div style={styles.systemBlock}>
          <div style={styles.systemHeader}>
            <span style={{ color: theme.systemDot }}>● </span>
            <span style={{ color: theme.systemLabel, fontWeight: 'bold' }}>System</span>
          </div>
          <TreeContent color={theme.systemDot}>
            <div style={styles.systemContent}>
              {item.entry.content}
            </div>
          </TreeContent>
        </div>
      );

    case 'link_message': {
      // Cross-session message — rendered with distinct amber/gold dot and label
      const content = item.entry.content;
      // Extract sender info from patterns like "[来自其他session: s10] 绮梦: message"
      const linkMatch = content.match(/^\[来自其他session:\s*([^\]]+)\]\s*(.*)/s);
      // Extract sender from "[LINK ALERT from session] message"
      const alertMatch = !linkMatch && content.match(/^\[LINK ALERT\s+from\s+([^\]]+)\]\s*(.*)/s);
      const sessionName = linkMatch ? linkMatch[1].trim() : alertMatch ? alertMatch[1].trim() : null;
      const messageContent = linkMatch ? linkMatch[2] : alertMatch ? alertMatch[2] : content;

      return (
        <div style={styles.linkMessageBlock}>
          <div style={styles.linkMessageHeader}>
            <span style={{ color: theme.linkMessageDot }}>●</span>
            {sessionName && (
              <span style={styles.linkMessageLabel}>↗ {sessionName}</span>
            )}
          </div>
          <TreeContent color={theme.linkMessageDot}>
            <div
              style={styles.linkMessageContent}
              dangerouslySetInnerHTML={{ __html: renderMarkdown(messageContent) }}
            />
          </TreeContent>
        </div>
      );
    }
  }
});

const styles: Record<string, React.CSSProperties> = {
  prompt: {
    display: 'flex',
    alignItems: 'flex-start',
    padding: '0.65em 1.2ch',
    margin: '0.8em 0',
    background: 'var(--prompt-bg)',
    border: '1px solid var(--border-color)',
    borderRadius: 'var(--radius-md)',
    boxShadow: 'var(--shadow-sm)',
    transition: 'background 0.2s ease, border-color 0.2s ease',
  },
  promptMarker: {
    color: 'var(--prompt-marker)',
    fontWeight: 700,
    fontSize: '1em',
    paddingLeft: '0.2ch',
    marginRight: '0.8ch',
    flexShrink: 0,
    lineHeight: '1.5em',
  },
  promptBody: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '0.4em',
    lineHeight: '1.5em',
  },
  promptContent: {
    color: 'var(--prompt-text)',
    fontWeight: 500,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
  promptImagesWrap: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: '6px',
    padding: '8px',
    marginBottom: '0.5em',
    border: '1px solid var(--prompt-bg)',
    borderRadius: '4px',
  },
  promptImage: {
    display: 'block',
    width: '88px',
    height: '88px',
    objectFit: 'cover' as const,
    borderRadius: '6px',
    flexShrink: 0,
  },
  promptImageSingle: {
    display: 'block',
    width: 'auto',
    height: 'auto',
    maxWidth: 'min(100%, 220px)',
    maxHeight: '160px',
    objectFit: 'contain' as const,
    borderRadius: '6px',
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
    background: 'rgba(255,255,255,0.14)',
    border: '1px solid rgba(255,255,255,0.4)',
    borderRadius: 'var(--radius-sm)',
    color: '#FFFFFF',
    fontSize: '1.5em',
    cursor: 'pointer',
    padding: '4px 10px',
    lineHeight: 1,
    boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
    transition: 'background 0.15s ease',
  },
  imagePreviewNav: {
    position: 'absolute' as const,
    top: '50%',
    transform: 'translateY(-50%)',
    background: 'rgba(255,255,255,0.14)',
    border: '1px solid rgba(255,255,255,0.4)',
    color: '#FFFFFF',
    fontSize: '2em',
    width: '44px',
    height: '44px',
    borderRadius: '50%',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    lineHeight: 1,
    userSelect: 'none' as const,
    zIndex: 1,
    boxShadow: '0 1px 6px rgba(0,0,0,0.4)',
  },
  imagePreviewImg: {
    maxWidth: '90vw',
    maxHeight: '82vh',
    objectFit: 'contain' as const,
    borderRadius: '6px',
    boxShadow: '0 4px 24px rgba(0,0,0,0.6)',
  },
  imagePreviewFooter: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  imagePreviewCounter: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: '0.85em',
  },
  imagePreviewDownload: {
    background: 'rgba(255,255,255,0.18)',
    border: '1px solid rgba(255,255,255,0.55)',
    borderRadius: 'var(--radius-sm)',
    padding: '6px 16px',
    color: '#FFFFFF',
    fontSize: '0.9em',
    cursor: 'pointer',
    textDecoration: 'none',
    boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
    transition: 'background 0.15s ease',
  },
  textBlock: {
    marginBottom: '0.5em',
  },
  textContent: {
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
  personaLabel: {
    color: 'var(--text-muted)',
    fontSize: '0.75em',
    marginRight: '0.5ch',
    userSelect: 'none' as const,
  },
  systemBlock: {
    marginBottom: '0.5em',
  },
  systemHeader: {
    paddingLeft: '0.5ch',
    userSelect: 'none' as const,
  },
  systemContent: {
    color: theme.systemText,
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
  },
  linkMessageBlock: {
    marginBottom: '0.5em',
  },
  linkMessageHeader: {
    paddingLeft: '0.5ch',
    display: 'flex',
    alignItems: 'center',
    gap: '0.5ch',
    userSelect: 'none' as const,
  },
  linkMessageLabel: {
    color: theme.linkMessageDot,
    fontWeight: 'bold',
    fontSize: '0.85em',
  },
  linkMessageContent: {
    color: theme.linkMessageText,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
};
