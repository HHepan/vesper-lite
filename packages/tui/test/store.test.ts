import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTuiStore } from '../src/store.js';
import type { StreamEvent } from '@vesper/shared';

// Fake timers for text debounce
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('createTuiStore', () => {
  it('starts with idle status', () => {
    const store = createTuiStore();
    expect(store.getSnapshot().status).toBe('idle');
    expect(store.getSnapshot().assistantText).toBe('');
    expect(store.getSnapshot().toolEntries).toEqual([]);
    expect(store.getSnapshot().thinkingEntries).toEqual([]);
    expect(store.getSnapshot().timeline).toEqual([]);
    expect(store.getSnapshot().modelName).toBe('');
    expect(store.getSnapshot().inputHistory).toEqual([]);
    expect(store.getSnapshot().currentUserPrompt).toBe('');
  });

  it('accumulates text events (with debounce)', () => {
    const store = createTuiStore();
    store.handleEvent({ type: 'text', value: 'hello ' });
    store.handleEvent({ type: 'text', value: 'world' });
    // Before timer fires, text is buffered
    expect(store.getSnapshot().assistantText).toBe('');
    vi.advanceTimersByTime(50);
    expect(store.getSnapshot().assistantText).toBe('hello world');
  });

  it('sets status to streaming on text event', () => {
    const store = createTuiStore();
    store.handleEvent({ type: 'text', value: 'x' });
    vi.advanceTimersByTime(50);
    expect(store.getSnapshot().status).toBe('streaming');
  });

  it('creates tool_call entries', () => {
    const store = createTuiStore();
    store.handleEvent({
      type: 'tool_call',
      call: { name: 'read_file', arguments: { path: '/a' }, raw: '{}' },
    });
    const entries = store.getSnapshot().toolEntries;
    expect(entries).toHaveLength(1);
    expect(entries[0].call.name).toBe('read_file');
    expect(entries[0].collapsed).toBe(false);
    expect(entries[0].result).toBeUndefined();
  });

  it('pairs tool_result with tool_call', () => {
    const store = createTuiStore();
    store.handleEvent({
      type: 'tool_call',
      call: { name: 'read_file', arguments: { path: '/a' }, raw: '{}' },
    });
    store.handleEvent({
      type: 'tool_result',
      result: { content: 'file contents' },
      call: { name: 'read_file', arguments: { path: '/a' }, raw: '{}' },
    });
    const entries = store.getSnapshot().toolEntries;
    expect(entries).toHaveLength(1);
    expect(entries[0].result?.content).toBe('file contents');
    expect(entries[0].collapsed).toBe(false);
  });

  it('creates thinking entries (with debounce)', () => {
    const store = createTuiStore();
    store.handleEvent({ type: 'thinking', value: 'hmm...' });
    // Before timer fires, thinking is buffered
    expect(store.getSnapshot().thinkingEntries).toEqual([]);
    vi.advanceTimersByTime(50);
    const entries = store.getSnapshot().thinkingEntries;
    expect(entries).toHaveLength(1);
    expect(entries[0].content).toBe('hmm...');
    expect(entries[0].collapsed).toBe(false);
  });

  it('merges consecutive thinking deltas into one entry', () => {
    const store = createTuiStore();
    store.handleEvent({ type: 'thinking', value: 'part1 ' });
    store.handleEvent({ type: 'thinking', value: 'part2' });
    vi.advanceTimersByTime(50);
    const entries = store.getSnapshot().thinkingEntries;
    expect(entries).toHaveLength(1);
    expect(entries[0].content).toBe('part1 part2');
  });

  it('updates token_budget', () => {
    const store = createTuiStore();
    const snapshot = {
      totalTokens: 5000,
      budgetTokens: 10000,
      pinnedTokens: 1000,
      foldedTokens: 500,
      activeTokens: 3500,
      reminderTokens: 0,
      utilizationPercent: 50,
    };
    store.handleEvent({ type: 'token_budget', snapshot });
    expect(store.getSnapshot().tokenBudget).toEqual(snapshot);
  });

  it('transitions to done status', () => {
    const store = createTuiStore();
    store.handleEvent({ type: 'text', value: 'hello' });
    vi.advanceTimersByTime(50);
    store.handleEvent({ type: 'done' });
    expect(store.getSnapshot().status).toBe('done');
  });

  it('transitions to error status with message', () => {
    const store = createTuiStore();
    store.handleEvent({ type: 'error', error: new Error('something broke') });
    expect(store.getSnapshot().status).toBe('error');
    expect(store.getSnapshot().lastError).toBe('something broke');
  });

  it('toggleToolCollapse toggles collapsed state', () => {
    const store = createTuiStore();
    store.handleEvent({
      type: 'tool_call',
      call: { name: 'shell', arguments: { cmd: 'ls' }, raw: '{}' },
    });
    const id = store.getSnapshot().toolEntries[0].id;
    expect(store.getSnapshot().toolEntries[0].collapsed).toBe(false);
    store.toggleToolCollapse(id);
    expect(store.getSnapshot().toolEntries[0].collapsed).toBe(true);
    store.toggleToolCollapse(id);
    expect(store.getSnapshot().toolEntries[0].collapsed).toBe(false);
  });

  it('toggleThinkingCollapse toggles collapsed state', () => {
    const store = createTuiStore();
    store.handleEvent({ type: 'thinking', value: 'thinking...' });
    vi.advanceTimersByTime(50);
    const id = store.getSnapshot().thinkingEntries[0].id;
    expect(store.getSnapshot().thinkingEntries[0].collapsed).toBe(false);
    store.toggleThinkingCollapse(id);
    expect(store.getSnapshot().thinkingEntries[0].collapsed).toBe(true);
  });

  it('reset clears all state including turns', () => {
    const store = createTuiStore();
    store.handleEvent({ type: 'text', value: 'hello' });
    vi.advanceTimersByTime(50);
    store.handleEvent({
      type: 'tool_call',
      call: { name: 'shell', arguments: {}, raw: '{}' },
    });
    store.reset();
    const s = store.getSnapshot();
    expect(s.assistantText).toBe('');
    expect(s.toolEntries).toEqual([]);
    expect(s.turns).toEqual([]);
    expect(s.status).toBe('idle');
  });

  it('startNewTurn archives current turn and resets streaming state', () => {
    const store = createTuiStore();
    // Simulate first turn
    store.startNewTurn('hello');
    store.handleEvent({ type: 'text', value: 'response1' });
    vi.advanceTimersByTime(50);
    store.handleEvent({ type: 'done' });

    // Start second turn — should archive first turn
    store.startNewTurn('second question');
    const s = store.getSnapshot();
    expect(s.turns).toHaveLength(1);
    expect(s.turns[0].userPrompt).toBe('hello');
    expect(s.turns[0].assistantText).toBe('response1');
    expect(s.assistantText).toBe('');
    expect(s.status).toBe('streaming');
  });

  it('subscribe notifies listeners on state change', () => {
    const store = createTuiStore();
    const listener = vi.fn();
    const unsub = store.subscribe(listener);

    // thinking accumulates with debounce — listener notified after timer flush
    store.handleEvent({ type: 'thinking', value: 'hmm' });
    vi.advanceTimersByTime(50);
    expect(listener).toHaveBeenCalled();

    unsub();
    listener.mockClear();
    store.handleEvent({ type: 'thinking', value: 'hmm2' });
    vi.advanceTimersByTime(50);
    // After unsubscribe, should not be called
    expect(listener).not.toHaveBeenCalled();
  });

  it('handles sideband_injected events', () => {
    const store = createTuiStore();
    store.handleEvent({ type: 'sideband_injected', message: 'user interrupt' } as StreamEvent);
    expect(store.getSnapshot().pendingSidebands).toEqual(['user interrupt']);
  });

  it('setModelName updates modelName', () => {
    const store = createTuiStore();
    store.setModelName('qwen3-235b-a22b');
    expect(store.getSnapshot().modelName).toBe('qwen3-235b-a22b');
  });

  it('pushInputHistory adds entries and caps at 100', () => {
    const store = createTuiStore();
    store.pushInputHistory('first');
    store.pushInputHistory('second');
    expect(store.getSnapshot().inputHistory).toEqual(['first', 'second']);

    // Fill to 100
    for (let i = 0; i < 98; i++) {
      store.pushInputHistory(`entry-${i}`);
    }
    expect(store.getSnapshot().inputHistory).toHaveLength(100);

    // 101st entry should evict the oldest
    store.pushInputHistory('overflow');
    expect(store.getSnapshot().inputHistory).toHaveLength(100);
    expect(store.getSnapshot().inputHistory[0]).toBe('second');
    expect(store.getSnapshot().inputHistory[99]).toBe('overflow');
  });

  it('startNewTurn sets currentUserPrompt on state', () => {
    const store = createTuiStore();
    store.startNewTurn('hello world');
    expect(store.getSnapshot().currentUserPrompt).toBe('hello world');
  });

  it('startNewTurn archives currentUserPrompt into turn', () => {
    const store = createTuiStore();
    store.startNewTurn('first prompt');
    store.handleEvent({ type: 'text', value: 'reply' });
    vi.advanceTimersByTime(50);
    store.handleEvent({ type: 'done' });

    store.startNewTurn('second prompt');
    expect(store.getSnapshot().turns[0].userPrompt).toBe('first prompt');
    expect(store.getSnapshot().currentUserPrompt).toBe('second prompt');
  });

  it('timeline preserves chronological order of thinking and tool events', () => {
    const store = createTuiStore();
    // thinking → tool → thinking → tool
    store.handleEvent({ type: 'thinking', value: 'reasoning step 1' });
    vi.advanceTimersByTime(50);
    store.handleEvent({
      type: 'tool_call',
      call: { name: 'read_file', arguments: { path: '/a' }, raw: '{}' },
    });
    store.handleEvent({
      type: 'tool_result',
      result: { content: 'file content' },
      call: { name: 'read_file', arguments: { path: '/a' }, raw: '{}' },
    });
    store.handleEvent({ type: 'thinking', value: 'reasoning step 2' });
    vi.advanceTimersByTime(50);
    store.handleEvent({
      type: 'tool_call',
      call: { name: 'shell', arguments: { cmd: 'ls' }, raw: '{}' },
    });

    // With incremental rendering, completed items move to frozenTimeline.
    // Full timeline = frozenTimeline + timeline
    const s = store.getSnapshot();
    const fullTimeline = [...s.frozenTimeline, ...s.timeline];
    expect(fullTimeline).toHaveLength(4);
    expect(fullTimeline[0].kind).toBe('thinking');
    expect(fullTimeline[1].kind).toBe('tool');
    expect(fullTimeline[2].kind).toBe('thinking');
    expect(fullTimeline[3].kind).toBe('tool');

    // Derived arrays should still work
    expect(s.thinkingEntries).toHaveLength(2);
    expect(s.toolEntries).toHaveLength(2);
  });

  it('archived turns preserve timeline ordering', () => {
    const store = createTuiStore();
    store.startNewTurn('first');
    store.handleEvent({ type: 'thinking', value: 'think1' });
    vi.advanceTimersByTime(50);
    store.handleEvent({
      type: 'tool_call',
      call: { name: 'shell', arguments: { cmd: 'ls' }, raw: '{}' },
    });
    store.handleEvent({
      type: 'tool_result',
      result: { content: 'ok' },
      call: { name: 'shell', arguments: { cmd: 'ls' }, raw: '{}' },
    });
    store.handleEvent({ type: 'thinking', value: 'think2' });
    vi.advanceTimersByTime(50);
    store.handleEvent({ type: 'text', value: 'response' });
    vi.advanceTimersByTime(50);
    store.handleEvent({ type: 'done' });

    store.startNewTurn('second');
    const turn = store.getSnapshot().turns[0];
    // Timeline now includes the prompt as the first item.
    // Force-freeze anti-flicker mechanisms move completed thinking and tool
    // items to the frozen zone at each boundary, producing correct
    // chronological order: thinking1 → tool → thinking2 → text.
    expect(turn.timeline).toHaveLength(5);
    expect(turn.timeline[0].kind).toBe('prompt');
    expect(turn.timeline[1].kind).toBe('thinking');
    expect(turn.timeline[2].kind).toBe('tool');
    expect(turn.timeline[3].kind).toBe('thinking');
    expect(turn.timeline[4].kind).toBe('text');
    // Legacy derived fields should also be present if defined
    if (turn.thinkingEntries) expect(turn.thinkingEntries).toHaveLength(2);
    if (turn.toolEntries) expect(turn.toolEntries).toHaveLength(1);
    expect(turn.assistantText).toBe('response');
  });
});
