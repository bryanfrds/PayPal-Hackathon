// Customer fuzzy matching service for scanned notebook names
import { customerSlug } from "./customer-tab";
import type { CustomerRecord } from "./person1-types";

export type CustomerMatchSuggestion = {
  customer: CustomerRecord;
  confidence: number;
  matchReason: string;
};

function normalizeTokens(str: string): string[] {
  return customerSlug(str).split("-").filter(Boolean);
}

function tokenSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setB = new Set(b);
  let matches = 0;
  for (const token of a) {
    if (setB.has(token)) {
      matches += 1;
    } else {
      // Partial prefix match
      for (const tB of b) {
        if (tB.startsWith(token) || token.startsWith(tB)) {
          matches += 0.5;
          break;
        }
      }
    }
  }
  return matches / Math.max(a.length, b.length);
}

export function findCustomerSuggestions(
  draftName: string,
  directory: CustomerRecord[],
): CustomerMatchSuggestion[] {
  const query = draftName.trim();
  if (!query) return [];

  const querySlug = customerSlug(query);
  const queryTokens = normalizeTokens(query);
  const results: CustomerMatchSuggestion[] = [];

  for (const customer of directory) {
    const custSlug = customer.slug || customerSlug(customer.name);
    const custTokens = normalizeTokens(customer.name);

    if (querySlug === custSlug) {
      results.push({
        customer,
        confidence: 0.99,
        matchReason: "Exact normalized name match",
      });
      continue;
    }

    if (custSlug.includes(querySlug) || querySlug.includes(custSlug)) {
      const ratio = Math.min(querySlug.length, custSlug.length) / Math.max(querySlug.length, custSlug.length);
      results.push({
        customer,
        confidence: Math.max(0.75, ratio * 0.9),
        matchReason: "Substring match on name",
      });
      continue;
    }

    const sim = tokenSimilarity(queryTokens, custTokens);
    if (sim >= 0.5) {
      results.push({
        customer,
        confidence: sim * 0.85,
        matchReason: `Matched name tokens (${Math.round(sim * 100)}%)`,
      });
    }
  }

  return results.sort((a, b) => b.confidence - a.confidence);
}
