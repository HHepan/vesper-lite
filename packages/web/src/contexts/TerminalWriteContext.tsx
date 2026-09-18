// ═══════════════════════════════════════════════════════════════════════════
// Vesper WebUI — TerminalWriteContext
//
// React context providing a registry for terminal write functions.
// Needed because rc-dock renders tab content deep in its own component tree
// where parent refs can't reach.
// ═══════════════════════════════════════════════════════════════════════════

import { createContext, useContext, useRef, useCallback, type ReactNode } from 'react';

type WriteFn = (data: string) => void;

interface TerminalWriteRegistry {
  register(termId: string, writeFn: WriteFn): void;
  unregister(termId: string): void;
  write(termId: string, data: string): void;
}

const TerminalWriteContext = createContext<TerminalWriteRegistry | null>(null);

export function TerminalWriteProvider({ children }: { children: ReactNode }) {
  const registryRef = useRef<Map<string, WriteFn>>(new Map());

  const register = useCallback((termId: string, writeFn: WriteFn) => {
    registryRef.current.set(termId, writeFn);
  }, []);

  const unregister = useCallback((termId: string) => {
    registryRef.current.delete(termId);
  }, []);

  const write = useCallback((termId: string, data: string) => {
    const fn = registryRef.current.get(termId);
    fn?.(data);
  }, []);

  const registry: TerminalWriteRegistry = { register, unregister, write };

  return (
    <TerminalWriteContext value={registry}>
      {children}
    </TerminalWriteContext>
  );
}

export function useTerminalWrite(): TerminalWriteRegistry {
  const ctx = useContext(TerminalWriteContext);
  if (!ctx) throw new Error('useTerminalWrite must be used within TerminalWriteProvider');
  return ctx;
}
