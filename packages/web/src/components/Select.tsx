// ═══════════════════════════════════════════════════════════════════════════
// Vesper WebUI — Custom Select (替代原生 <select>，避免移动端渲染兼容问题)
//
// 用于 overlay 弹窗中的下拉选择。使用 Portal 渲染浮层菜单，
// 避免被父级 overflow: hidden 裁剪，且 z-index 高于弹窗。
// ═══════════════════════════════════════════════════════════════════════════

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';

export interface SelectOption {
  label: string;
  value: string;
}

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  style?: React.CSSProperties;
}

export function Select({ value, onChange, options, placeholder = '', style }: SelectProps) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});

  const selectedOption = options.find(o => o.value === value);

  const handleOpen = useCallback(() => {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    // Position menu below the button, aligned to left edge
    setMenuStyle({
      position: 'fixed' as const,
      left: rect.left,
      top: rect.bottom + 4,
      width: Math.max(rect.width, 180),
      zIndex: 100001,
    });
    setOpen(true);
  }, []);

  const handleSelect = useCallback((val: string) => {
    onChange(val);
    setOpen(false);
  }, [onChange]);

  // Click outside to close
  // NOTE: 使用 click 而非 mousedown，避免选项的 onClick (handleSelect) 被抢先关闭的菜单吞掉。
  // mousedown 先于 click 触发，会导致 portal 菜单中的选项在收到 click 前就被关闭，
  // 使得 onChange 在某些竞争条件下无法执行。
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (buttonRef.current && !buttonRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [open]);

  // Close on scroll/resize
  useEffect(() => {
    if (!open) return;
    const handler = () => setOpen(false);
    window.addEventListener('scroll', handler, true);
    window.addEventListener('resize', handler);
    return () => {
      window.removeEventListener('scroll', handler, true);
      window.removeEventListener('resize', handler);
    };
  }, [open]);

  const baseStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '0.5em',
    padding: '0.5em 0.75em',
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border-color)',
    borderRadius: 'var(--radius-sm)',
    color: value ? 'var(--text-primary)' : 'var(--text-muted)',
    fontFamily: 'inherit',
    fontSize: 'inherit',
    cursor: 'pointer',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box' as const,
    minHeight: '2.3em',
    textAlign: 'left' as const,
    userSelect: 'none' as const,
    WebkitUserSelect: 'none' as const,
    touchAction: 'manipulation' as const,
    transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
  };

  // Custom chevron arrow (CSS triangle pointing down)
  const arrowStyle: React.CSSProperties = {
    flexShrink: 0,
    width: 0,
    height: 0,
    borderLeft: '5px solid transparent',
    borderRight: '5px solid transparent',
    borderTop: '5px solid var(--text-muted)',
    transition: 'transform 0.2s ease',
    transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
  };

  return (
    <>
      <button
        ref={buttonRef}
        style={{ ...baseStyle, ...style }}
        onClick={handleOpen}
        type="button"
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <div style={arrowStyle} />
      </button>
      {open && createPortal(
        <div
          style={{
            ...menuStyle,
            background: 'var(--bg-primary)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-sm)',
            boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
            maxHeight: '240px',
            overflowY: 'auto',
            padding: '4px 0',
          }}
        >
          {options.map(opt => (
            <div
              key={opt.value}
              style={{
                padding: '0.5em 0.75em',
                cursor: 'pointer',
                color: opt.value === value ? 'var(--accent-blue)' : 'var(--text-primary)',
                background: opt.value === value ? 'var(--bg-tertiary)' : 'transparent',
                fontSize: 'inherit',
                fontFamily: 'inherit',
                whiteSpace: 'nowrap' as const,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
              onClick={() => handleSelect(opt.value)}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = opt.value === value ? 'var(--bg-tertiary)' : 'transparent';
              }}
            >
              {opt.label}
            </div>
          ))}
        </div>,
        document.body
      )}
    </>
  );
}