import { describe, expect, it } from "vitest";
import { findCustomerSuggestions } from "./customer-matching";
import type { CustomerRecord } from "./person1-types";

describe("customer-matching", () => {
  const directory: CustomerRecord[] = [
    {
      id: "cust-1",
      ownerEmail: "owner@example.com",
      name: "Pak Ali (Bengkel)",
      slug: "pak-ali-bengkel",
      email: "ali@example.com",
      createdAt: "2026-10-18T00:00:00Z",
      updatedAt: "2026-10-18T00:00:00Z",
    },
    {
      id: "cust-2",
      ownerEmail: "owner@example.com",
      name: "Mak Cik Siti",
      slug: "mak-cik-siti",
      email: "siti@example.com",
      createdAt: "2026-10-18T00:00:00Z",
      updatedAt: "2026-10-18T00:00:00Z",
    },
    {
      id: "cust-3",
      ownerEmail: "owner@example.com",
      name: "Ah Seng",
      slug: "ah-seng",
      email: "ahseng@example.com",
      createdAt: "2026-10-18T00:00:00Z",
      updatedAt: "2026-10-18T00:00:00Z",
    },
  ];

  it("finds exact match with high confidence", () => {
    const suggestions = findCustomerSuggestions("Pak Ali (Bengkel)", directory);
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions[0].customer.id).toBe("cust-1");
    expect(suggestions[0].confidence).toBeGreaterThanOrEqual(0.95);
  });

  it("finds fuzzy / partial matches for handwriting variations", () => {
    // "Pak Ali" matches "Pak Ali (Bengkel)"
    const suggestions = findCustomerSuggestions("Pak Ali", directory);
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions[0].customer.id).toBe("cust-1");
    expect(suggestions[0].confidence).toBeGreaterThan(0.7);
  });

  it("handles case and punctuation differences", () => {
    const suggestions = findCustomerSuggestions("mak cik  siti!", directory);
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions[0].customer.id).toBe("cust-2");
  });

  it("returns empty array when no good candidate exists", () => {
    const suggestions = findCustomerSuggestions("Zul Extraordinaire", directory);
    expect(suggestions).toHaveLength(0);
  });
});
