import { describe, expect, it } from "vitest";
import { watchElementWidth } from "./studio-dom";

// No DOM library is installed for tests: a box whose one child Studio can swap, and observers
// and timers the test fires by hand.
class FakeEl {
  isConnected = true;
  constructor(public width: number) {}
  getBoundingClientRect() {
    return { width: this.isConnected ? this.width : 0 } as DOMRect;
  }
}

function setup() {
  let current: FakeEl | null = new FakeEl(718);
  let queries = 0;
  const box = {
    querySelector: () => {
      queries++;
      return current;
    },
  };
  const resizeCallbacks: (() => void)[] = [];
  const observed = new Set<unknown>();
  const mutationCallbacks: (() => void)[] = [];
  const timers = new Map<number, () => void>();
  let nextTimer = 1;
  const env = {
    ResizeObserver: class {
      constructor(run: () => void) {
        resizeCallbacks.push(run);
      }
      observe(el: unknown) {
        observed.add(el);
      }
      unobserve(el: unknown) {
        observed.delete(el);
      }
      disconnect() {
        observed.clear();
      }
    } as unknown as typeof ResizeObserver,
    MutationObserver: class {
      constructor(run: () => void) {
        mutationCallbacks.push(run);
      }
      observe() {}
      disconnect() {}
    } as unknown as typeof MutationObserver,
    setTimeout: (run: () => void) => {
      timers.set(nextTimer, run);
      return nextTimer++;
    },
    clearTimeout: (handle: unknown) => {
      timers.delete(handle as number);
    },
  };
  const widths: number[] = [];
  const stop = watchElementWidth(box as unknown as ParentNode & Node, ".canvas", (w) => widths.push(w), 150, env);
  return {
    widths,
    stop,
    observed,
    get queries() {
      return queries;
    },
    get current() {
      return current;
    },
    swap(next: FakeEl | null) {
      if (current) current.isConnected = false;
      current = next;
    },
    resize: () => resizeCallbacks.forEach((run) => run()),
    mutate: () => mutationCallbacks.forEach((run) => run()),
    settle: () => {
      const pending = [...timers.values()];
      timers.clear();
      pending.forEach((run) => run());
    },
  };
}

describe("watchElementWidth", () => {
  it("reports the first width at once and later ones only once they settle", () => {
    const w = setup();
    expect(w.widths).toEqual([718]);
    w.current!.width = 700;
    w.resize();
    w.current!.width = 690;
    w.resize();
    expect(w.widths).toEqual([718]);
    w.settle();
    expect(w.widths).toEqual([718, 690]);
  });

  it("never reports 0 from the old element while Studio rebuilds", () => {
    const w = setup();
    w.swap(null); // Studio removed its canvas; the new one isn't there yet.
    w.resize();
    w.mutate();
    w.settle();
    expect(w.widths).toEqual([718]);
  });

  it("ignores a connected element that has no width yet", () => {
    const w = setup();
    w.current!.width = 0;
    w.resize();
    w.settle();
    expect(w.widths).toEqual([718]);
  });

  it("watches the new element once Studio has rebuilt", () => {
    const w = setup();
    const old = w.current;
    const fresh = new FakeEl(448);
    w.swap(fresh);
    w.mutate();
    expect(w.observed.has(old)).toBe(false);
    expect(w.observed.has(fresh)).toBe(true);
    w.settle();
    expect(w.widths).toEqual([718, 448]);
  });

  it("doesn't search the DOM again while the element is still there", () => {
    const w = setup();
    const before = w.queries;
    w.mutate();
    w.mutate();
    expect(w.queries).toBe(before);
  });

  it("stops reporting once cleaned up", () => {
    const w = setup();
    w.current!.width = 500;
    w.resize();
    w.stop();
    w.settle();
    expect(w.widths).toEqual([718]);
  });
});
