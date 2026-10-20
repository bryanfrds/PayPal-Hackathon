import { describe, expect, it } from "vitest";
import { inertOutside, returnFocusTarget } from "./useDialog";

type FakeEl = { tagName: string; inert: boolean; parentElement: FakeEl | null; children: FakeEl[]; isConnected?: boolean };

function el(tagName: string, children: FakeEl[] = [], inert = false): FakeEl {
  const node: FakeEl = { tagName, inert, parentElement: null, children };
  for (const c of children) c.parentElement = node;
  return node;
}

describe("inertOutside", () => {
  // <html><head/><body><header/><main><h1/><div dialog/><p/></main><div toast inert/><script/></body></html>
  function page() {
    const dialog = el("DIV");
    const h1 = el("H1");
    const p = el("P");
    const main = el("MAIN", [h1, dialog, p]);
    const header = el("HEADER");
    const toast = el("DIV", [], true);
    const script = el("SCRIPT");
    const body = el("BODY", [header, main, toast, script]);
    const head = el("HEAD");
    el("HTML", [head, body]);
    return { dialog, h1, p, main, header, toast, script, body, head };
  }

  it("makes everything outside the dialog inert, up to <body>", () => {
    const { dialog, h1, p, main, header, script, body, head } = page();
    inertOutside(dialog);
    expect(h1.inert).toBe(true);
    expect(p.inert).toBe(true);
    expect(header.inert).toBe(true);
    // The dialog and its ancestors stay live; scripts, <head> and <body> are never touched.
    expect(dialog.inert).toBe(false);
    expect(main.inert).toBe(false);
    expect(body.inert).toBe(false);
    expect(head.inert).toBe(false);
    expect(script.inert).toBe(false);
  });

  it("keeps a sheet's tap-to-close backdrop live (the walk starts from .sheet-layer)", () => {
    // <body><header/><main/><div.sheet-layer><div.sheet-dim/><div sheet/></div></body>
    const dim = el("DIV");
    const sheet = el("DIV") as FakeEl & { closest?: (s: string) => FakeEl | null };
    const layer = el("DIV", [dim, sheet]);
    sheet.closest = (s) => (s === ".sheet-layer" ? layer : null);
    const header = el("HEADER");
    const main = el("MAIN");
    el("HTML", [el("HEAD"), el("BODY", [header, main, layer])]);
    const restore = inertOutside(sheet);
    expect(dim.inert).toBe(false);
    expect(sheet.inert).toBe(false);
    expect(layer.inert).toBe(false);
    expect([header.inert, main.inert]).toEqual([true, true]);
    restore();
    expect([header.inert, main.inert]).toEqual([false, false]);
  });

  it("undoes only what it did", () => {
    const { dialog, h1, p, header, toast } = page();
    const restore = inertOutside(dialog);
    restore();
    expect([h1.inert, p.inert, header.inert]).toEqual([false, false, false]);
    // Already inert before the dialog opened: still inert after it closes.
    expect(toast.inert).toBe(true);
  });
});

describe("returnFocusTarget", () => {
  const h1 = { id: "h1", isConnected: true } as unknown as HTMLElement;
  const main = { id: "main" } as unknown as HTMLElement;
  const body = { id: "body", isConnected: true } as unknown as HTMLElement;
  const doc = (found: Record<string, HTMLElement | null>) => ({
    body,
    querySelector: (s: string) => found[s] ?? null,
  });

  it("goes back to the button that opened the dialog", () => {
    const opener = { isConnected: true } as unknown as HTMLElement;
    expect(returnFocusTarget(opener, doc({ "main h1": h1 }))).toBe(opener);
  });

  it("goes to the page heading when the dialog opened by itself (focus was on <body>)", () => {
    expect(returnFocusTarget(body, doc({ "main h1": h1, main }))).toBe(h1);
    expect(returnFocusTarget(null, doc({ "main h1": h1, main }))).toBe(h1);
  });

  it("goes to the heading when the opener has left the page", () => {
    const gone = { isConnected: false } as unknown as HTMLElement;
    expect(returnFocusTarget(gone, doc({ "main h1": h1 }))).toBe(h1);
  });

  it("falls back to any h1, then <main>", () => {
    expect(returnFocusTarget(null, doc({ h1 }))).toBe(h1);
    expect(returnFocusTarget(null, doc({ main }))).toBe(main);
    expect(returnFocusTarget(null, doc({}))).toBeNull();
  });
});
