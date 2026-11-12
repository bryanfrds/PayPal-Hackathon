import { describe, expect, it } from "vitest";
import { customerPagePath, initialCustomerQuery } from "./customerLinks";

describe("customerPagePath", () => {
  it("opens the owner's Customers screen searched by name, not the customer's tab", () => {
    expect(customerPagePath("Mak Cik Siti")).toBe("/customers?q=Mak%20Cik%20Siti");
    expect(customerPagePath("Pak Ali (Bengkel)")).not.toMatch(/^\/tab\//);
  });

  it("encodes names safely for the URL", () => {
    expect(customerPagePath(" Ah & Co ")).toBe("/customers?q=Ah%20%26%20Co");
  });
});

describe("initialCustomerQuery", () => {
  it("reads ?q=, trimmed, first value only", () => {
    expect(initialCustomerQuery(" Kak Lina ")).toBe("Kak Lina");
    expect(initialCustomerQuery(["Ah Seng", "x"])).toBe("Ah Seng");
    expect(initialCustomerQuery(undefined)).toBe("");
  });

  it("caps very long text", () => {
    expect(initialCustomerQuery("a".repeat(500))).toHaveLength(100);
  });
});
