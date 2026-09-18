import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PassThrough } from 'node:stream';
import { createInterruptHandler, createSidebandChecker } from '../src/interrupt.js';

describe('createInterruptHandler', () => {
  let processOnSpy: ReturnType<typeof vi.spyOn>;
  let processRemoveListenerSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    processOnSpy = vi.spyOn(process, 'on');
    processRemoveListenerSpy = vi.spyOn(process, 'removeListener');
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers a SIGINT handler', () => {
    const controller = new AbortController();
    createInterruptHandler(controller);
    expect(processOnSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function));
  });

  it('first SIGINT aborts the controller', () => {
    const controller = new AbortController();
    createInterruptHandler(controller);

    // Get the registered handler
    const handler = processOnSpy.mock.calls[0][1] as () => void;
    handler();

    expect(controller.signal.aborted).toBe(true);
  });

  it('second SIGINT within window calls process.exit(1)', () => {
    const controller = new AbortController();
    createInterruptHandler(controller);

    const handler = processOnSpy.mock.calls[0][1] as () => void;

    // First SIGINT
    handler();
    // Second SIGINT immediately (within 2s window)
    handler();

    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it('dispose removes the SIGINT listener', () => {
    const controller = new AbortController();
    const ih = createInterruptHandler(controller);
    ih.dispose();
    expect(processRemoveListenerSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function));
  });
});

describe('createSidebandChecker', () => {
  it('returns null when queue is empty', () => {
    const checker = createSidebandChecker();
    expect(checker.checkSideband()).toBeNull();
  });

  it('returns messages in FIFO order', () => {
    const checker = createSidebandChecker();
    checker.pushMessage('first');
    checker.pushMessage('second');
    expect(checker.checkSideband()).toBe('first');
    expect(checker.checkSideband()).toBe('second');
    expect(checker.checkSideband()).toBeNull();
  });

  it('supports multiple push/check cycles', () => {
    const checker = createSidebandChecker();
    checker.pushMessage('a');
    expect(checker.checkSideband()).toBe('a');
    checker.pushMessage('b');
    expect(checker.checkSideband()).toBe('b');
    expect(checker.checkSideband()).toBeNull();
  });

  it('enable/disable are no-ops without stdin', () => {
    const checker = createSidebandChecker();
    // Should not throw
    checker.enableStdinCapture();
    checker.disableStdinCapture();
    expect(checker.checkSideband()).toBeNull();
  });
});

describe('createSidebandChecker — Layer 3 stdin capture', () => {
  it('captures lines from stdin into queue', () => {
    const stdin = new PassThrough();
    const checker = createSidebandChecker({ stdin });

    checker.enableStdinCapture();
    stdin.write('hello world\n');

    expect(checker.checkSideband()).toBe('hello world');
    expect(checker.checkSideband()).toBeNull();

    checker.disableStdinCapture();
  });

  it('splits multi-line chunks correctly', () => {
    const stdin = new PassThrough();
    const checker = createSidebandChecker({ stdin });

    checker.enableStdinCapture();
    stdin.write('line one\nline two\nline three\n');

    expect(checker.checkSideband()).toBe('line one');
    expect(checker.checkSideband()).toBe('line two');
    expect(checker.checkSideband()).toBe('line three');
    expect(checker.checkSideband()).toBeNull();

    checker.disableStdinCapture();
  });

  it('ignores empty lines', () => {
    const stdin = new PassThrough();
    const checker = createSidebandChecker({ stdin });

    checker.enableStdinCapture();
    stdin.write('hello\n\n\nworld\n');

    expect(checker.checkSideband()).toBe('hello');
    expect(checker.checkSideband()).toBe('world');
    expect(checker.checkSideband()).toBeNull();

    checker.disableStdinCapture();
  });

  it('fires onInjected callback for each line', () => {
    const stdin = new PassThrough();
    const injected: string[] = [];
    const checker = createSidebandChecker({
      stdin,
      onInjected: (msg) => injected.push(msg),
    });

    checker.enableStdinCapture();
    stdin.write('first\nsecond\n');

    expect(injected).toEqual(['first', 'second']);

    checker.disableStdinCapture();
  });

  it('disableStdinCapture stops capturing', () => {
    const stdin = new PassThrough();
    const checker = createSidebandChecker({ stdin });

    checker.enableStdinCapture();
    stdin.write('captured\n');
    checker.disableStdinCapture();

    stdin.write('not captured\n');

    expect(checker.checkSideband()).toBe('captured');
    expect(checker.checkSideband()).toBeNull();
  });

  it('flushes incomplete line buffer on disable', () => {
    const stdin = new PassThrough();
    const checker = createSidebandChecker({ stdin });

    checker.enableStdinCapture();
    stdin.write('incomplete');
    checker.disableStdinCapture();

    expect(checker.checkSideband()).toBe('incomplete');
    expect(checker.checkSideband()).toBeNull();
  });

  it('handles partial lines across chunks', () => {
    const stdin = new PassThrough();
    const checker = createSidebandChecker({ stdin });

    checker.enableStdinCapture();
    stdin.write('hel');
    stdin.write('lo world\n');

    expect(checker.checkSideband()).toBe('hello world');

    checker.disableStdinCapture();
  });
});
