// Hands "start the quick tour" from Settings to Home, and remembers a skip for this visit even
// when the browser can't save it (private mode). Kept in memory only, like settings/flash.ts.

let replay = false;
let closedThisVisit = false;

/** Settings' "Replay quick tour": Home starts the tour at step 1 when it next opens. */
export function requestTourReplay() {
  replay = true;
}

export function takeTourReplay(): boolean {
  const asked = replay;
  replay = false;
  return asked;
}

/** The tour was finished or skipped: don't offer it again in this tab, saved or not. */
export function markTourClosed() {
  closedThisVisit = true;
}

export function tourClosedThisVisit(): boolean {
  return closedThisVisit;
}
