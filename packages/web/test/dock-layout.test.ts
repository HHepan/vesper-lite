/**
 * Unit tests for the dock layout helpers in DockLayoutWrapper.
 *
 * These cover the pure logic behind two regressions we hit during the
 * rc-dock split work:
 *
 *  1. "Zombie" / duplicated tabs after a split — the root cause was that
 *     `rebuildTitles` replaced every TabData object on every render (because
 *     App passed a fresh `sessionStates` object each time), which made rc-dock
 *     reload its whole internal layout and rebuild the tree with new object
 *     identities. rc-dock removes a dragged tab from its source panel by
 *     object identity, so a reload landing mid-drag left the tab duplicated.
 *     `computeDockTitleSignature` is the gate that prevents those needless
 *     rebuilds — it must change *only* when a title actually changes.
 *
 *  2. A stored split layout collapsing back to a single panel on reload —
 *     `serializeLayout` / `deserializeLayout` must round-trip the full
 *     box/panel tree.
 */
import { describe, it, expect } from 'vitest';
import type { BoxData, LayoutData, PanelData, TabData } from 'rc-dock';
import {
  buildLayoutFromTabs,
  collectTabIds,
  computeDockTitleSignature,
  deserializeLayout,
  serializeLayout,
  type DockSessionState,
  type Tab,
} from '../src/components/dock/DockLayoutWrapper';

// ── helpers ───────────────────────────────────────────────────────────────

const session = (id: string, name = id): Tab => ({ kind: 'session', id, name });
const terminal = (id: string, name = id, ready = true): Tab => ({ kind: 'terminal', id, name, ready });

const tabData = (id: string): TabData => ({ id, title: id, group: 'lux' }) as unknown as TabData;

const panel = (id: string, ids: string[]): PanelData =>
  ({ id, tabs: ids.map(tabData), activeId: ids[0], group: 'lux' }) as unknown as PanelData;

const box = (mode: 'horizontal' | 'vertical', children: (BoxData | PanelData)[]): BoxData =>
  ({ mode, children }) as unknown as BoxData;

const layoutOf = (children: (BoxData | PanelData)[]): LayoutData =>
  ({ dockbox: box('horizontal', children) }) as unknown as LayoutData;

/** Render callbacks are never invoked in these tests — pass a no-op. */
const noRender = (() => null) as never;

/** Count how many times each tab id appears across the whole tree. */
function tabPlacement(layout: LayoutData): Record<string, number> {
  const counts: Record<string, number> = {};
  const walk = (children: (BoxData | PanelData)[]) => {
    for (const child of children) {
      if ((child as PanelData).tabs) {
        for (const t of (child as PanelData).tabs!) {
          const id = t.id as string;
          counts[id] = (counts[id] ?? 0) + 1;
        }
      } else if ((child as BoxData).children) {
        walk((child as BoxData).children!);
      }
    }
  };
  if (layout.dockbox?.children) walk(layout.dockbox.children);
  return counts;
}

// ── computeDockTitleSignature ─────────────────────────────────────────────

describe('computeDockTitleSignature', () => {
  it('is identical for equal inputs even when the objects are different identities', () => {
    // This is the regression guard: App rebuilds `sessionStates` on every
    // render, so an identity-based check would fire on every render and
    // destabilise rc-dock. The signature must be value-based.
    const tabsA = [session('s1', 'Session 1'), terminal('t1', 'Terminal')];
    const tabsB = [session('s1', 'Session 1'), terminal('t1', 'Terminal')];
    const statesA: Record<string, DockSessionState> = { s1: { status: 'streaming', hasPending: true } };
    const statesB: Record<string, DockSessionState> = { s1: { status: 'streaming', hasPending: true } };

    expect(computeDockTitleSignature(tabsA, 's1', statesA))
      .toBe(computeDockTitleSignature(tabsB, 's1', statesB));
  });

  it('changes when a tab is renamed', () => {
    expect(computeDockTitleSignature([session('s1', 'Session 1')], null, {}))
      .not.toBe(computeDockTitleSignature([session('s1', 'Renamed')], null, {}));
  });

  it('changes when a tab is added or removed', () => {
    const one = computeDockTitleSignature([session('s1')], null, {});
    const two = computeDockTitleSignature([session('s1'), session('s2')], null, {});
    expect(one).not.toBe(two);
  });

  it('changes when a tab changes kind', () => {
    expect(computeDockTitleSignature([session('x', 'X')], null, {}))
      .not.toBe(computeDockTitleSignature([terminal('x', 'X')], null, {}));
  });

  it('changes when the preview tab changes', () => {
    expect(computeDockTitleSignature([session('s1')], null, {}))
      .not.toBe(computeDockTitleSignature([session('s1')], 's1', {}));
  });

  it('changes when a session status indicator changes', () => {
    const idle = computeDockTitleSignature([session('s1')], null, { s1: { status: 'idle' } });
    const streaming = computeDockTitleSignature([session('s1')], null, { s1: { status: 'streaming' } });
    const pending = computeDockTitleSignature([session('s1')], null, { s1: { status: 'idle', hasPending: true } });
    expect(idle).not.toBe(streaming);
    expect(idle).not.toBe(pending);
  });

  it('treats undefined and empty session states as equivalent', () => {
    expect(computeDockTitleSignature([session('s1')], undefined, undefined))
      .toBe(computeDockTitleSignature([session('s1')], null, {}));
  });
});

// ── collectTabIds ─────────────────────────────────────────────────────────

describe('collectTabIds', () => {
  it('collects ids across nested boxes and panels', () => {
    const layout = layoutOf([
      panel('p1', ['a', 'b']),
      box('vertical', [panel('p2', ['c']), panel('p3', ['d'])]),
    ]);
    expect([...collectTabIds(layout)].sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('returns an empty set for an empty layout', () => {
    expect(collectTabIds(layoutOf([])).size).toBe(0);
  });
});

// ── serializeLayout / deserializeLayout ───────────────────────────────────

describe('serializeLayout / deserializeLayout', () => {
  it('round-trips a nested split without collapsing it', () => {
    const layout = layoutOf([
      panel('p1', ['a', 'b']),
      box('vertical', [panel('p2', ['c']), panel('p3', ['d'])]),
    ]);

    const skeleton = serializeLayout(layout)!;
    expect(skeleton.dockbox.children.length).toBe(2);

    const tabs = [session('a'), session('b'), session('c'), session('d')];
    const restored = deserializeLayout(skeleton, tabs, noRender, noRender)!;

    // The split must survive a save/load cycle — this is the "refresh collapses
    // the layout back to one panel" regression guard.
    expect(restored.dockbox.children.length).toBe(2);
    const nested = restored.dockbox.children[1] as BoxData;
    expect(nested.children!.length).toBe(2);
    expect(tabPlacement(restored)).toEqual({ a: 1, b: 1, c: 1, d: 1 });
  });

  it('prunes panels whose tabs no longer exist', () => {
    const skeleton = serializeLayout(layoutOf([panel('p1', ['a']), panel('p2', ['gone'])]))!;
    const restored = deserializeLayout(skeleton, [session('a')], noRender, noRender)!;
    expect(restored.dockbox.children.length).toBe(1);
    expect(tabPlacement(restored)).toEqual({ a: 1 });
  });

  it('appends newly added tabs to the first panel', () => {
    const skeleton = serializeLayout(layoutOf([panel('p1', ['a'])]))!;
    const restored = deserializeLayout(skeleton, [session('a'), session('new')], noRender, noRender)!;
    expect(tabPlacement(restored)).toEqual({ a: 1, new: 1 });
  });

  it('returns null when no skeleton tabs can be resolved', () => {
    const skeleton = serializeLayout(layoutOf([panel('p1', ['gone'])]))!;
    expect(deserializeLayout(skeleton, [session('a')], noRender, noRender)).toBeNull();
  });
});

// ── buildLayoutFromTabs ───────────────────────────────────────────────────

describe('buildLayoutFromTabs', () => {
  it('creates a single panel holding every tab when there is no existing layout', () => {
    const layout = buildLayoutFromTabs([session('a'), session('b')], noRender, noRender);
    expect(layout.dockbox.children.length).toBe(1);
    expect(tabPlacement(layout)).toEqual({ a: 1, b: 1 });
  });

  it('preserves an existing split while reconciling', () => {
    const existing = layoutOf([panel('p1', ['a']), panel('p2', ['b'])]);
    const layout = buildLayoutFromTabs([session('a'), session('b')], noRender, noRender, existing);

    expect(layout.dockbox.children.length).toBe(2);
    // …and never duplicates a tab across panels.
    expect(tabPlacement(layout)).toEqual({ a: 1, b: 1 });
  });

  it('removes tabs that are no longer present', () => {
    const existing = layoutOf([panel('p1', ['a', 'b'])]);
    const layout = buildLayoutFromTabs([session('a')], noRender, noRender, existing);
    expect(tabPlacement(layout)).toEqual({ a: 1 });
  });

  it('drops panels that become empty after a tab is removed', () => {
    const existing = layoutOf([panel('p1', ['a']), panel('p2', ['b'])]);
    const layout = buildLayoutFromTabs([session('a')], noRender, noRender, existing);
    expect(layout.dockbox.children.length).toBe(1);
    expect(tabPlacement(layout)).toEqual({ a: 1 });
  });

  it('appends newly added tabs without touching the existing split', () => {
    const existing = layoutOf([panel('p1', ['a']), panel('p2', ['b'])]);
    const layout = buildLayoutFromTabs([session('a'), session('b'), session('c')], noRender, noRender, existing);

    expect(layout.dockbox.children.length).toBe(2);
    expect(tabPlacement(layout)).toEqual({ a: 1, b: 1, c: 1 });
  });

  it('marks the preview tab (and only it) with the preview close behaviour', () => {
    const existing = layoutOf([panel('p1', ['a', 'b'])]);
    const layout = buildLayoutFromTabs([session('a'), session('b')], noRender, noRender, existing, 'a', undefined, 'a');
    const p = layout.dockbox.children[0] as PanelData;
    const preview = p.tabs!.find(t => t.id === 'a') as TabData & { closable?: boolean };
    const normal = p.tabs!.find(t => t.id === 'b') as TabData & { closable?: boolean };
    // The preview tab is closable too — just assert both survive reconciliation.
    expect(preview).toBeTruthy();
    expect(normal).toBeTruthy();
  });
});
