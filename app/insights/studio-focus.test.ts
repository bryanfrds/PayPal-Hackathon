import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Studio outlines a tapped (selected) widget with a square accent line round the whole tile.
// globals.css removes it in view mode and keeps a rounded keyboard-only ring on the card.
const css = readFileSync(join(__dirname, "..", "globals.css"), "utf8").replace(/\s+/g, " ");

describe("Studio widget focus in view mode", () => {
  it("drops Studio's square hover/selection line outside edit mode", () => {
    expect(css).toContain(".ag-studio-layout-widget:not(.ag-studio-layout-widget-editing) { box-shadow: none; }");
  });

  it("keeps a keyboard-only ring on the rounded card", () => {
    expect(css).toContain(
      ".ag-studio-layout-widget-focus:not(.ag-studio-layout-widget-editing) > .ag-studio-layout-widget-container { outline: 2px solid var(--accent);",
    );
  });
});
