import { describe, expect, it } from "vitest";
import { isNavActive } from "./navActive";

describe("isNavActive", () => {
  it("Home only on /", () => {
    expect(isNavActive("/", "/")).toBe(true);
    expect(isNavActive("/", "/ledger")).toBe(false);
  });

  it("an item and the pages under it", () => {
    expect(isNavActive("/collect", "/collect")).toBe(true);
    expect(isNavActive("/collect", "/collect/abc")).toBe(true);
    expect(isNavActive("/scan", "/scanner")).toBe(false);
  });

  it("Ledger also covers Add debt and Customers, which have no item of their own", () => {
    expect(isNavActive("/ledger", "/add")).toBe(true);
    expect(isNavActive("/ledger", "/customers")).toBe(true);
    expect(isNavActive("/home", "/customers")).toBe(false);
    expect(isNavActive("/collect", "/add")).toBe(false);
  });
});
