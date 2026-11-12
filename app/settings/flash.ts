// A "Saved" note handed from the language picker back to Settings, which shows it on arrival.
// Kept in memory only: it's for the next screen in this tab, nothing more.

let pending: string | null = null;

export function flashSaved(text: string) {
  pending = text;
}

export function takeFlash(): string | null {
  const text = pending;
  pending = null;
  return text;
}
