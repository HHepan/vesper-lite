// ═══════════════════════════════════════════════════════════════════════════
// Vesper WebUI — GamePanel (电子木鱼游戏)
//
// 点击木鱼，消除 bug！功德 +1
// 精致的木鱼造型 + 敲击动画 + 飘动文字
// ═══════════════════════════════════════════════════════════════════════════

import React, { useState, useCallback, useEffect, useRef } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GamePanelProps {
  onClose: () => void;
}

interface FloatingText {
  id: number;
  x: number;
  y: number;
  text: string;
  hue: number;
}

interface Ripple {
  id: number;
  x: number;
  y: number;
}

// ---------------------------------------------------------------------------
// 木鱼组件 - 用 CSS 绘制
// ---------------------------------------------------------------------------

function WoodenFish({ onHit }: { onHit: (e: React.MouseEvent) => void }) {
  const [isHitting, setIsHitting] = useState(false);
  const [ripples, setRipples] = useState<Ripple[]>([]);
  const rippleIdRef = useRef(0);

  const handleClick = (e: React.MouseEvent) => {
    setIsHitting(true);
    
    // 创建涟漪效果
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const newRipple: Ripple = {
      id: rippleIdRef.current++,
      x,
      y,
    };
    setRipples(prev => [...prev, newRipple]);
    
    // 清理涟漪
    setTimeout(() => {
      setRipples(prev => prev.filter(r => r.id !== newRipple.id));
    }, 600);
    
    onHit(e);
    
    setTimeout(() => setIsHitting(false), 150);
  };

  return (
    <div onClick={handleClick} style={styles.woodenFishContainer}>
      {/* 涟漪效果 */}
      {ripples.map(ripple => (
        <div
          key={ripple.id}
          style={{
            ...styles.ripple,
            left: ripple.x,
            top: ripple.y,
          }}
        />
      ))}
      
      {/* 木鱼本体 */}
      <div
        style={{
          ...styles.woodenFish,
          transform: isHitting ? 'scale(0.92) rotate(-2deg)' : 'scale(1) rotate(0deg)',
        }}
      >
        {/* 木鱼主体 - 鼓形 */}
        <div style={styles.fishBody}>
          {/* 高光 */}
          <div style={styles.fishHighlight} />
          {/* 纹理线条 */}
          <div style={styles.fishLine1} />
          <div style={styles.fishLine2} />
          {/* 中心装饰 */}
          <div style={styles.fishCenter}>
            <div style={styles.fishDot} />
          </div>
        </div>
        
        {/* 木鱼底座 */}
        <div style={styles.fishBase}>
          <div style={styles.fishBaseTop} />
        </div>
        
        {/* 敲击光效 */}
        {isHitting && <div style={styles.hitGlow} />}
      </div>
      
      {/* 光环效果 */}
      <div style={{
        ...styles.aura,
        transform: isHitting ? 'scale(1.3)' : 'scale(1)',
        opacity: isHitting ? 0.8 : 0.3,
      }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 飘动文字组件
// ---------------------------------------------------------------------------

function FloatingTextView({ text }: { text: FloatingText }) {
  return (
    <div
      style={{
        ...styles.floatingText,
        left: `${text.x}%`,
        top: `${text.y}%`,
        '--hue': text.hue,
      } as React.CSSProperties}
    >
      {text.text}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Game Panel
// ---------------------------------------------------------------------------

export const GamePanel: React.FC<GamePanelProps> = ({ onClose }) => {
  const [count, setCount] = useState(0);
  const [floatingTexts, setFloatingTexts] = useState<FloatingText[]>([]);
  const nextId = useRef(0);

  // 加载保存的敲击次数
  useEffect(() => {
    const saved = localStorage.getItem('lux_wooden_fish_count');
    if (saved) {
      setCount(parseInt(saved, 10) || 0);
    }
  }, []);

  // 保存敲击次数
  useEffect(() => {
    localStorage.setItem('lux_wooden_fish_count', String(count));
  }, [count]);

  // 清理飘走的文字
  useEffect(() => {
    if (floatingTexts.length === 0) return;
    const timer = setTimeout(() => {
      setFloatingTexts(prev => prev.slice(1));
    }, 1500);
    return () => clearTimeout(timer);
  }, [floatingTexts]);

  const handleHit = useCallback((e: React.MouseEvent) => {
    setCount(c => c + 1);

    // 根据点击位置创建飘动文字
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    
    // 随机选择文字
    const texts = [
      'no bug ✨',
      '功德 +1 🙏',
      'code 完美 💯',
      '无灾无难 🌸',
      '需求不变 🎯',
      '上线顺利 🚀',
      '测试通过 ✓',
      '永不回滚 💪',
    ];
    
    const newText: FloatingText = {
      id: nextId.current++,
      x: Math.max(10, Math.min(90, x)),
      y: Math.max(20, Math.min(80, y)),
      text: texts[Math.floor(Math.random() * texts.length)],
      hue: Math.random() * 60 + 100, // 绿色到黄色范围
    };
    setFloatingTexts(prev => [...prev, newText]);
  }, []);

  // Esc 关闭
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div style={styles.overlay}>
      {/* 顶部栏 */}
      <div style={styles.topBar}>
        <span style={styles.title}>🪘 电子木鱼</span>
        <span style={{ flex: 1 }} />
        <div style={styles.stats}>
          <span style={styles.countLabel}>功德</span>
          <span style={styles.countValue}>{count.toLocaleString()}</span>
        </div>
        <button style={styles.closeBtn} onClick={onClose} title="关闭 (Esc)">
          ✕
        </button>
      </div>

      {/* 游戏区域 */}
      <div style={styles.gameArea}>
        {/* 背景装饰 */}
        <div style={styles.bgPattern} />
        
        {/* 飘动的文字 */}
        {floatingTexts.map(ft => (
          <FloatingTextView key={ft.id} text={ft} />
        ))}

        {/* 木鱼 */}
        <WoodenFish onHit={handleHit} />
      </div>

      {/* 底部提示区域 */}
      <div style={styles.bottomArea}>
        <div style={styles.hint}>
          <span style={styles.hintIcon}>👆</span>
          <span>敲击木鱼，积攒功德，消除 bug</span>
        </div>
        
        <div style={styles.footer}>
          <span>今日已敲 {count} 次 · 继续加油 💪</span>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 9999,
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: 'var(--bg-primary)',
    fontFamily: 'inherit',
    fontSize: 'inherit',
  },
  topBar: {
    display: 'flex',
    alignItems: 'center',
    padding: '1em 2ch',
    backgroundColor: 'rgba(30, 30, 46, 0.95)',
    borderBottom: '1px solid rgba(108, 112, 134, 0.3)',
    gap: '2ch',
    flexShrink: 0,
    backdropFilter: 'blur(10px)',
  },
  title: {
    color: 'var(--ansi-magenta)',
    fontWeight: 'bold',
    fontSize: '1.2em',
    textShadow: '0 0 20px rgba(245, 194, 231, 0.5)',
  },
  stats: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '0.8ch',
    padding: '0.4em 1.2ch',
    background: 'rgba(137, 180, 250, 0.1)',
    borderRadius: '6px',
    border: '1px solid rgba(137, 180, 250, 0.2)',
  },
  countLabel: {
    color: 'var(--text-muted)',
    fontSize: '0.9em',
  },
  countValue: {
    color: 'var(--ansi-blue)',
    fontWeight: 'bold',
    fontSize: '1.2em',
    textShadow: '0 0 10px rgba(137, 180, 250, 0.5)',
  },
  closeBtn: {
    background: 'none',
    border: '1px solid var(--text-muted)',
    borderRadius: '4px',
    color: 'var(--text-primary)',
    cursor: 'pointer',
    padding: '0.3em 1ch',
    fontFamily: 'inherit',
    fontSize: '1em',
    lineHeight: 1,
    transition: 'all 0.2s',
    marginLeft: '1ch',
  },
  gameArea: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    overflow: 'hidden',
    padding: '3em 2em',
    background: 'radial-gradient(ellipse at center, rgba(49, 50, 68, 0.3) 0%, transparent 70%)',
  },
  bgPattern: {
    position: 'absolute',
    inset: 0,
    opacity: 0.03,
    backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
    pointerEvents: 'none',
  },
  
  // 底部区域
  bottomArea: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '1.5em',
    padding: '2em 2em 3em',
    flexShrink: 0,
  },
  
  // 木鱼容器
  woodenFishContainer: {
    position: 'relative',
    width: '240px',
    height: '240px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    userSelect: 'none',
  },
  
  // 木鱼主体
  woodenFish: {
    position: 'relative',
    width: '180px',
    height: '160px',
    transition: 'transform 0.15s cubic-bezier(0.34, 1.56, 0.64, 1)',
    zIndex: 2,
  },
  
  // 木鱼鼓身
  fishBody: {
    position: 'absolute',
    width: '180px',
    height: '140px',
    top: '0',
    left: '0',
    background: 'linear-gradient(145deg, #8B4513 0%, #5D2E0C 50%, #3D1F08 100%)',
    borderRadius: '50% 50% 45% 45% / 60% 60% 40% 40%',
    boxShadow: `
      inset 0 25px 50px rgba(255, 200, 150, 0.2),
      inset 0 -25px 50px rgba(0, 0, 0, 0.4),
      0 15px 40px rgba(0, 0, 0, 0.5),
      0 0 80px rgba(245, 194, 231, 0.2)
    `,
  },
  
  // 高光
  fishHighlight: {
    position: 'absolute',
    width: '90px',
    height: '45px',
    top: '18px',
    left: '25%',
    background: 'linear-gradient(180deg, rgba(255, 220, 180, 0.35) 0%, transparent 100%)',
    borderRadius: '50%',
    filter: 'blur(6px)',
  },
  
  // 纹理线
  fishLine1: {
    position: 'absolute',
    width: '110px',
    height: '2px',
    top: '58px',
    left: '35px',
    background: 'linear-gradient(90deg, transparent, rgba(0,0,0,0.3), transparent)',
    borderRadius: '1px',
  },
  fishLine2: {
    position: 'absolute',
    width: '90px',
    height: '2px',
    top: '82px',
    left: '45px',
    background: 'linear-gradient(90deg, transparent, rgba(0,0,0,0.2), transparent)',
    borderRadius: '1px',
  },
  
  // 中心装饰
  fishCenter: {
    position: 'absolute',
    width: '55px',
    height: '55px',
    top: '42px',
    left: '62px',
    border: '3px solid rgba(255, 200, 150, 0.3)',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fishDot: {
    width: '22px',
    height: '22px',
    background: 'radial-gradient(circle, #D4A574 0%, #8B4513 100%)',
    borderRadius: '50%',
    boxShadow: 'inset 0 2px 5px rgba(255,255,255,0.3), 0 2px 5px rgba(0,0,0,0.3)',
  },
  
  // 底座
  fishBase: {
    position: 'absolute',
    bottom: '0',
    left: '50%',
    transform: 'translateX(-50%)',
    width: '110px',
    height: '28px',
    background: 'linear-gradient(180deg, #5D2E0C 0%, #3D1F08 100%)',
    borderRadius: '0 0 50% 50% / 0 0 100% 100%',
    boxShadow: '0 8px 20px rgba(0, 0, 0, 0.4)',
  },
  fishBaseTop: {
    position: 'absolute',
    top: '0',
    left: '10%',
    width: '80%',
    height: '8px',
    background: 'linear-gradient(180deg, rgba(255, 200, 150, 0.2) 0%, transparent 100%)',
    borderRadius: '50% 50% 0 0',
  },
  
  // 敲击光效
  hitGlow: {
    position: 'absolute',
    inset: '-25px',
    background: 'radial-gradient(circle, rgba(245, 194, 231, 0.5) 0%, transparent 70%)',
    borderRadius: '50%',
    animation: 'pulse 0.3s ease-out',
    pointerEvents: 'none',
  },
  
  // 光环
  aura: {
    position: 'absolute',
    width: '300px',
    height: '300px',
    borderRadius: '50%',
    border: '2px solid rgba(245, 194, 231, 0.25)',
    transition: 'all 0.3s ease-out',
    pointerEvents: 'none',
    boxShadow: '0 0 60px rgba(245, 194, 231, 0.15)',
  },
  
  // 涟漪
  ripple: {
    position: 'absolute',
    width: '10px',
    height: '10px',
    background: 'rgba(245, 194, 231, 0.6)',
    borderRadius: '50%',
    transform: 'translate(-50%, -50%)',
    animation: 'ripple 0.6s ease-out forwards',
    pointerEvents: 'none',
    zIndex: 10,
  },
  
  // 飘动文字
  floatingText: {
    position: 'absolute',
    color: 'var(--ansi-green)',
    fontSize: '1.5em',
    fontWeight: 'bold',
    pointerEvents: 'none',
    animation: 'floatUp 1.5s ease-out forwards',
    textShadow: '0 0 20px rgba(166, 227, 161, 0.8), 0 2px 6px rgba(0,0,0,0.5)',
    whiteSpace: 'nowrap',
    zIndex: 100,
  },
  
  // 提示
  hint: {
    color: 'var(--text-muted)',
    fontSize: '1em',
    display: 'flex',
    alignItems: 'center',
    gap: '0.8ch',
    padding: '0.8em 1.5em',
    background: 'rgba(108, 112, 134, 0.1)',
    borderRadius: '25px',
    border: '1px solid rgba(108, 112, 134, 0.2)',
  },
  hintIcon: {
    fontSize: '1.3em',
  },
  
  // 底部
  footer: {
    color: 'var(--bg-hover)',
    fontSize: '0.9em',
  },
};

// 注入动画样式
const styleSheet = document.createElement('style');
styleSheet.textContent = `
  @keyframes floatUp {
    0% {
      opacity: 1;
      transform: translateY(0) scale(1) rotate(0deg);
    }
    50% {
      opacity: 1;
      transform: translateY(-50px) scale(1.2) rotate(-5deg);
    }
    100% {
      opacity: 0;
      transform: translateY(-120px) scale(0.8) rotate(5deg);
    }
  }
  
  @keyframes ripple {
    0% {
      opacity: 1;
      transform: translate(-50%, -50%) scale(1);
    }
    100% {
      opacity: 0;
      transform: translate(-50%, -50%) scale(25);
    }
  }
  
  @keyframes pulse {
    0% {
      opacity: 1;
      transform: scale(0.8);
    }
    100% {
      opacity: 0;
      transform: scale(1.5);
    }
  }
`;
document.head.appendChild(styleSheet);
