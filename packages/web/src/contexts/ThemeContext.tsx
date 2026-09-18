// ═══════════════════════════════════════════════════════════════════════════
// Vesper WebUI — ThemeContext
//
// React context for theme management.
// Provides current theme name, toggle function, and theme config object.
// Persists user choice in localStorage and applies data-theme attribute to root.
// ═══════════════════════════════════════════════════════════════════════════

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { VSCODE_DARK_PLUS, VSCODE_LIGHT_PLUS, type ThemeConfig } from '../theme.js';

export type ThemeName = 'dark' | 'light';

interface ThemeContextValue {
  themeName: ThemeName;
  theme: ThemeConfig;
  setTheme: (name: ThemeName) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = 'lux-theme-name';

// ═══════════════════════════════════════════════════════════════════════════
// Theme Provider
// ═══════════════════════════════════════════════════════════════════════════

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Initialize from localStorage, default to 'dark'
  const [themeName, setThemeName] = useState<ThemeName>(() => {
    if (typeof window === 'undefined') return 'dark';
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
    return 'dark';
  });

  // Get theme config object based on themeName
  const theme = themeName === 'light' ? VSCODE_LIGHT_PLUS : VSCODE_DARK_PLUS;

  // Apply data-theme attribute to root element
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', themeName);
  }, [themeName]);

  // Set theme and persist to localStorage
  const setTheme = useCallback((name: ThemeName) => {
    setThemeName(name);
    localStorage.setItem(STORAGE_KEY, name);
  }, []);

  // Toggle between dark and light
  const toggleTheme = useCallback(() => {
    setTheme(themeName === 'dark' ? 'light' : 'dark');
  }, [themeName, setTheme]);

  return (
    <ThemeContext value={{ themeName, theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Hook
// ═══════════════════════════════════════════════════════════════════════════

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
