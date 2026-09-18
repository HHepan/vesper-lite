// ═══════════════════════════════════════════════════════════════════════════
// Vesper Core — CLI Three-Layer Interrupt Handler
// ═══════════════════════════════════════════════════════════════════════════

// ---------------------------------------------------------------------------
// Layer 1: SIGINT Handler
// ---------------------------------------------------------------------------

export interface InterruptHandler {
  dispose(): void;
}

const DOUBLE_SIGINT_WINDOW_MS = 2000;

/**
 * Create a SIGINT handler with two-stage interrupt behavior:
 *  - First SIGINT: soft abort via controller.abort()
 *  - Second SIGINT within 2 seconds: hard exit via process.exit(1)
 */
export function createInterruptHandler(controller: AbortController): InterruptHandler {
  let firstSigintTime = 0;

  const handler = () => {
    const now = Date.now();
    if (now - firstSigintTime < DOUBLE_SIGINT_WINDOW_MS) {
      // Double SIGINT — hard kill
      process.exit(1);
    }
    // First SIGINT — soft abort
    firstSigintTime = now;
    controller.abort();
  };

  process.on('SIGINT', handler);

  return {
    dispose() {
      process.removeListener('SIGINT', handler);
    },
  };
}

// ---------------------------------------------------------------------------
// Layer 2: Sideband Checker (message queue)
// ---------------------------------------------------------------------------

export interface SidebandChecker {
  checkSideband(): string | null;
  pushMessage(msg: string): void;
  enableStdinCapture(): void;
  disableStdinCapture(): void;
}

export interface SidebandCheckerOptions {
  stdin?: NodeJS.ReadableStream;
  onInjected?: (msg: string) => void;
}

/**
 * Create a sideband message checker with optional stdin capture (Layer 3).
 *
 * Layer 2: basic message queue — pushMessage() enqueues, checkSideband() dequeues.
 * Layer 3: when stdin is provided, enableStdinCapture() attaches a data listener
 *          that reads lines from stdin and pushes them into the queue.
 */
export function createSidebandChecker(options?: SidebandCheckerOptions): SidebandChecker {
  const queue: string[] = [];
  const stdin = options?.stdin;
  const onInjected = options?.onInjected;

  let lineBuffer = '';
  let capturing = false;

  const dataHandler = (chunk: Buffer | string): void => {
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
    lineBuffer += text;

    const lines = lineBuffer.split(/\r?\n/);
    // Keep the last element (incomplete line) in the buffer
    lineBuffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length > 0) {
        queue.push(trimmed);
        onInjected?.(trimmed);
      }
    }
  };

  return {
    checkSideband(): string | null {
      return queue.shift() ?? null;
    },
    pushMessage(msg: string): void {
      queue.push(msg);
    },
    enableStdinCapture(): void {
      if (!stdin || capturing) return;
      capturing = true;
      stdin.on('data', dataHandler);
      if (typeof (stdin as any).resume === 'function') {
        (stdin as any).resume();
      }
    },
    disableStdinCapture(): void {
      if (!stdin || !capturing) return;
      capturing = false;
      stdin.removeListener('data', dataHandler);
      // Flush remaining lineBuffer
      if (lineBuffer.trim().length > 0) {
        const trimmed = lineBuffer.trim();
        queue.push(trimmed);
        onInjected?.(trimmed);
      }
      lineBuffer = '';
    },
  };
}
