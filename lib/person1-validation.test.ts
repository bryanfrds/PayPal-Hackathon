import { describe, expect, it } from "vitest";
import { malaysiaDate, validateCustomerInput, validateEntryPatch } from "./person1-validation";

describe("Person 1 input validation", () => {
  it("caps customer fields", () => {
    expect(validateCustomerInput({ name: "x".repeat(121) }, true).ok).toBe(false);
    expect(validateCustomerInput({ name: "Ali", email: `a@${"x".repeat(252)}` }, true).ok).toBe(false);
    expect(validateCustomerInput({ name: "Ali", phone: "1".repeat(33) }, true).ok).toBe(false);
  });

  it("caps and validates edited entry fields", () => {
    expect(validateEntryPatch({ customerName: "x".repeat(121) }).ok).toBe(false);
    expect(validateEntryPatch({ item: "x".repeat(501) }).ok).toBe(false);
    expect(validateEntryPatch({ date: "18/10/2026" }).ok).toBe(false);
    expect(validateEntryPatch({ date: "2026-10-18", item: "Rice" }).ok).toBe(true);
  });

  it("uses the Malaysia calendar date around UTC midnight", () => {
    expect(malaysiaDate(new Date("2026-10-18T17:00:00Z"))).toBe("2026-10-19");
  });
});
