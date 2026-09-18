// ═══════════════════════════════════════════════════════════════════════════
// Vesper WebUI — MessageTimeline (expandable menu-style navigation)
//
// Hover to expand into a clickable menu list of user messages.
// Inspired by DeepSeek's sidebar timeline interaction.
// ═══════════════════════════════════════════════════════════════════════════

import React, { useMemo, useState, useRef, useEffect } from 'react';
import type { Virtualizer } from '@tanstack/react-virtual';
import type { TimelineItem } from '../store.js';
import type { GroupedTimelineItem } from '../lib/group-tools.js';
import { useIsMobile } from '../hooks/useIsMobile.js';
import './MessageTimeline.css';

// ---------------------------------------------------------------------------
// Types (mirrored from SessionPanel)
// ---------------------------------------------------------------------------

type FlatItem =
  | { kind: 'welcome' }
  | { kind: 'timeline'; item: GroupedTimelineItem }
  | { kind: 'tail' };

interface MessageTimelineProps {
  flatItems: FlatItem[];
  virtualizer: Virtualizer<HTMLDivElement, Element>;
  visibleRange: { start: number; end: number };
  /** In mobile mode, if true, only render the popup sheet dialog without the standalone fixed FAB */
  renderSheetOnly?: boolean;
  /** Controlled open state for external trigger */
  mobileOpen?: boolean;
  /** Controlled open state change callback */
  onMobileOpenChange?: (open: boolean) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MessageTimeline({
  flatItems,
  virtualizer,
  visibleRange,
  renderSheetOnly,
  mobileOpen,
  onMobileOpenChange,
}: MessageTimelineProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [selectedPromptIndex, setSelectedPromptIndex] = useState<number | null>(null);
  const [internalShowMobileMenu, setInternalShowMobileMenu] = useState(false);
  const showMobileMenu = mobileOpen !== undefined ? mobileOpen : internalShowMobileMenu;
  const setShowMobileMenu = (open: boolean) => {
    if (onMobileOpenChange) onMobileOpenChange(open);
    else setInternalShowMobileMenu(open);
  };
  const menuListRef = useRef<HTMLDivElement>(null);
  const mobileMenuListRef = useRef<HTMLDivElement>(null);

  // Find all prompt items and their indices
  const promptItems = useMemo(() => {
    const prompts: Array<{ index: number; item: FlatItem }> = [];
    flatItems.forEach((item, index) => {
      if (item.kind === 'timeline' && item.item.kind === 'prompt') {
        prompts.push({ index, item });
      }
    });
    return prompts;
  }, [flatItems]);

  // Find the prompt closest to viewport center (for initial state when no selection)
  const closestToCenterPromptIndex = useMemo(() => {
    const viewportCenter = (visibleRange.start + visibleRange.end) / 2;
    let closestIndex = 0;
    let minDistance = Infinity;
    
    for (let i = 0; i < promptItems.length; i++) {
      const distance = Math.abs(promptItems[i].index - viewportCenter);
      if (distance < minDistance) {
        minDistance = distance;
        closestIndex = i;
      }
    }
    return closestIndex;
  }, [promptItems, visibleRange]);

  // Use selected index if available, otherwise use closest to center
  // selectedPromptIndex is only set when user clicks, and cleared when menu closes
  const highlightedPromptIndex = selectedPromptIndex !== null ? selectedPromptIndex : closestToCenterPromptIndex;
  
  // Clear selection when menu closes (so next open will use viewport center)
  useEffect(() => {
    if (!isExpanded) {
      setSelectedPromptIndex(null);
    }
  }, [isExpanded]);

  // Scroll to center the selected message in menu list (with boundary handling)
  // Only scroll when menu opens, not when highlightedPromptIndex changes during interaction
  useEffect(() => {
    if (isExpanded && menuListRef.current && promptItems.length > 0) {
      const menuList = menuListRef.current;
      
      // Use setTimeout to ensure DOM is fully rendered after animation
      const timer = setTimeout(() => {
        // Get actual item height from DOM
        const firstItem = menuList.querySelector('.message-timeline__menu-item') as HTMLElement;
        const itemHeight = firstItem ? firstItem.offsetHeight : 44; // Fallback to 44px
        
        const menuHeight = menuList.clientHeight;
        const targetPosition = highlightedPromptIndex * itemHeight;
        
        // Calculate scroll position to center the item
        const scrollTop = targetPosition - (menuHeight / 2) + (itemHeight / 2);
        
        // Boundary handling: don't scroll beyond start or end
        const maxScrollTop = menuList.scrollHeight - menuHeight;
        const clampedScrollTop = Math.max(0, Math.min(scrollTop, maxScrollTop));
        
        menuList.scrollTop = clampedScrollTop;
      }, 50); // Wait 50ms for animation
      
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isExpanded, promptItems.length]); // Intentionally exclude highlightedPromptIndex

  // Mobile: auto-scroll to center the current message when menu opens
  useEffect(() => {
    if (showMobileMenu && mobileMenuListRef.current && promptItems.length > 0) {
      const menuList = mobileMenuListRef.current;

      const timer = setTimeout(() => {
        const firstButton = menuList.querySelector('button') as HTMLElement;
        const itemHeight = firstButton ? firstButton.offsetHeight : 48;
        const menuHeight = menuList.clientHeight;
        const targetPosition = highlightedPromptIndex * itemHeight;
        const scrollTop = targetPosition - (menuHeight / 2) + (itemHeight / 2);
        const maxScrollTop = menuList.scrollHeight - menuHeight;
        menuList.scrollTop = Math.max(0, Math.min(scrollTop, maxScrollTop));
      }, 50);

      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showMobileMenu, promptItems.length]);

  // Get preview text from prompt
  const getPreviewText = (prompt: { index: number; item: FlatItem }) => {
    const promptText = prompt.item.kind === 'timeline' && prompt.item.item.kind === 'prompt'
      ? prompt.item.item.entry.content
      : '';
    return promptText.replace(/\n/g, ' ').slice(0, 60) + (promptText.length > 60 ? '...' : '');
  };

  // Mobile version: floating button + bottom sheet overlay
  const isMobile = useIsMobile();
  if (promptItems.length === 0) {
    return null;
  }

  if (isMobile) {
    return (
      <>
        {/* Floating button (only shown if not sheet-only) */}
        {!renderSheetOnly && (
          <button
            className="message-timeline-mobile-btn"
            onClick={() => setShowMobileMenu(true)}
            style={mobileStyles.floatingBtn}
          >
            📋 {promptItems.length}
          </button>
        )}

        {/* Bottom sheet overlay */}
        {showMobileMenu && (
          <div
            style={mobileStyles.overlay}
            onClick={() => setShowMobileMenu(false)}
          >
            <div
              style={mobileStyles.panel}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={mobileStyles.header}>
                <span style={mobileStyles.headerTitle}>
                  消息导航 ({promptItems.length})
                </span>
                <button
                  onClick={() => setShowMobileMenu(false)}
                  style={mobileStyles.closeBtn}
                >
                  ✕
                </button>
              </div>
              <div style={mobileStyles.list} ref={mobileMenuListRef}>
                {promptItems.map((prompt, i) => {
                  const isHighlighted = i === highlightedPromptIndex;
                  return (
                    <button
                      key={prompt.index}
                      style={{
                        ...mobileStyles.item,
                        ...(isHighlighted ? mobileStyles.itemHighlighted : {}),
                      }}
                      onClick={() => {
                        virtualizer.scrollToIndex(prompt.index, { align: 'start' });
                        setShowMobileMenu(false);
                      }}
                    >
                      <span style={mobileStyles.itemIndex}>#{i + 1}</span>
                      <span style={mobileStyles.itemText}>{getPreviewText(prompt)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <div
      className={`message-timeline ${isExpanded ? 'message-timeline--expanded' : ''}`}
      onMouseEnter={() => setIsExpanded(true)}
      onMouseLeave={() => {
        setIsExpanded(false);
        setHoveredIndex(null);
      }}
    >
      {/* Collapsed: vertical line with nodes */}
      {!isExpanded && (
        <>
          <div className="message-timeline__line" />
          {promptItems.map((prompt, i) => {
            const isClosestToCenter = i === closestToCenterPromptIndex;
            return (
              <div
                key={prompt.index}
                className={`message-timeline__node ${isClosestToCenter ? 'message-timeline__node--visible' : ''}`}
                style={{ top: `${(i + 1) / (promptItems.length + 1) * 100}%` }}
              />
            );
          })}
        </>
      )}

      {/* Expanded: menu list */}
      {isExpanded && (
        <div className="message-timeline__menu">
          <div className="message-timeline__menu-header">
            消息导航 ({promptItems.length})
          </div>
          <div className="message-timeline__menu-list" ref={menuListRef}>
            {promptItems.map((prompt, i) => {
              const isHovered = hoveredIndex === prompt.index;
              const isHighlighted = i === highlightedPromptIndex;
              
              return (
                <button
                  key={prompt.index}
                  className={`message-timeline__menu-item ${isHovered ? 'message-timeline__menu-item--hovered' : ''} ${isHighlighted ? 'message-timeline__menu-item--visible' : ''}`}
                  onClick={() => {
                    setSelectedPromptIndex(i);
                    virtualizer.scrollToIndex(prompt.index, { align: 'start' });
                  }}
                  onMouseEnter={() => setHoveredIndex(prompt.index)}
                  onMouseLeave={() => setHoveredIndex(null)}
                >
                  <span className="message-timeline__menu-index">#{i + 1}</span>
                  <span className="message-timeline__menu-text">{getPreviewText(prompt)}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Mobile Styles ──────────────────────────────────────────────────────────
const mobileStyles: Record<string, React.CSSProperties> = {
  floatingBtn: {
    position: 'absolute',
    bottom: '5.5em',
    right: '1em',
    zIndex: 20,
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    padding: '6px 12px',
    background: 'var(--bg-primary)',
    border: '1px solid var(--border-color)',
    borderRadius: '16px',
    color: 'var(--text-primary)',
    fontSize: '0.85em',
    cursor: 'pointer',
    boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
    touchAction: 'manipulation',
    whiteSpace: 'nowrap',
    pointerEvents: 'auto',
  },
  overlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 10000,
    background: 'rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'center',
    animation: 'fade-in 0.15s ease-out',
  },
  panel: {
    background: 'var(--bg-primary)',
    borderTopLeftRadius: '12px',
    borderTopRightRadius: '12px',
    width: '100%',
    maxHeight: '60vh',
    display: 'flex',
    flexDirection: 'column',
    animation: 'slide-up 0.2s ease-out',
    overflow: 'hidden',
    borderTop: '1px solid var(--border-color)',
    boxShadow: '0 -4px 12px rgba(0,0,0,0.3)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '14px 16px',
    borderBottom: '1px solid var(--border-color)',
    flexShrink: 0,
  },
  headerTitle: {
    fontWeight: 'bold' as const,
    color: 'var(--text-primary)',
    fontSize: '0.95em',
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: 'var(--text-secondary)',
    fontSize: '1.1em',
    cursor: 'pointer',
    padding: '4px 8px',
    touchAction: 'manipulation',
  },
  list: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '4px 0',
  },
  item: {
    display: 'flex',
    gap: '10px',
    width: '100%',
    padding: '12px 16px',
    border: 'none',
    borderLeft: '3px solid transparent',
    background: 'transparent',
    textAlign: 'left' as const,
    cursor: 'pointer',
    touchAction: 'manipulation',
  },
  itemHighlighted: {
    borderLeft: '3px solid var(--accent-blue)',
    background: 'rgba(91, 168, 208, 0.22)',
  },
  itemIndex: {
    flexShrink: 0,
    fontSize: '11px',
    fontWeight: 600,
    color: 'var(--text-muted)',
    minWidth: '26px',
    paddingTop: '1px',
  },
  itemText: {
    flex: 1,
    fontSize: '13px',
    color: 'var(--text-primary)',
    lineHeight: 1.4,
    whiteSpace: 'normal' as const,
    wordBreak: 'break-word' as const,
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical' as any,
  },
};
