import { describe, expect, it } from "vitest";
import { inertOutside } from "./studio-dom";

// No DOM library is installed for tests, so this is the small slice of Element that
// inertOutside uses: parents, children, attributes and the live-region selector.
class FakeElement {
  parentElement: FakeElement | null = null;
  children: FakeElement[] = [];
  private attrs = new Map<string, string>();
  constructor(
    readonly tagName: string,
    attrs: Record<string, string> = {},
  ) {
    for (const [k, v] of Object.entries(attrs)) this.attrs.set(k, v);
  }
  add(...kids: FakeElement[]) {
    for (const kid of kids) {
      kid.parentElement = this;
      this.children.push(kid);
    }
    return this;
  }
  hasAttribute(name: string) {
    return this.attrs.has(name);
  }
  setAttribute(name: string, value: string) {
    this.attrs.set(name, value);
  }
  removeAttribute(name: string) {
    this.attrs.delete(name);
  }
  matches(selector: string) {
    if (selector !== '[role="status"], [aria-live]') throw new Error(`unexpected selector ${selector}`);
    return this.attrs.get("role") === "status" || this.attrs.has("aria-live");
  }
}

function page() {
  const sheet = new FakeElement("DIV");
  const canvas = new FakeElement("DIV");
  const studio = new FakeElement("DIV").add(canvas, sheet);
  const status = new FakeElement("P", { role: "status" });
  const head = new FakeElement("DIV");
  const main = new FakeElement("MAIN").add(head, status, studio);
  const nav = new FakeElement("NAV");
  const announcer = new FakeElement("DIV", { "aria-live": "assertive" });
  const script = new FakeElement("SCRIPT");
  const already = new FakeElement("DIV", { inert: "" });
  const body = new FakeElement("BODY").add(nav, main, announcer, script, already);
  return { body, sheet, canvas, studio, status, head, main, nav, announcer, script, already };
}

const run = (keep: FakeElement, top: FakeElement) => inertOutside(keep as unknown as Element, top as unknown as Element);

describe("inertOutside", () => {
  it("makes everything outside the sheet inert, but not the sheet, its ancestors or live regions", () => {
    const p = page();
    run(p.sheet, p.body);
    for (const el of [p.canvas, p.head, p.nav]) expect(el.hasAttribute("inert")).toBe(true);
    for (const el of [p.sheet, p.studio, p.main, p.status, p.announcer, p.script]) expect(el.hasAttribute("inert")).toBe(false);
  });

  it("undoes only what it changed", () => {
    const p = page();
    const undo = run(p.sheet, p.body);
    undo();
    for (const el of [p.canvas, p.head, p.nav]) expect(el.hasAttribute("inert")).toBe(false);
    // Inert before the sheet opened, so still inert after.
    expect(p.already.hasAttribute("inert")).toBe(true);
  });
});
