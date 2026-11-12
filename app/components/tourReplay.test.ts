import { describe, expect, it } from "vitest";
import { markTourClosed, requestTourReplay, takeTourReplay, tourClosedThisVisit } from "./tourReplay";

describe("tour replay hand-off", () => {
  it("is off until Settings asks", () => {
    expect(takeTourReplay()).toBe(false);
  });

  it("is taken once, then off again", () => {
    requestTourReplay();
    expect(takeTourReplay()).toBe(true);
    expect(takeTourReplay()).toBe(false);
  });

  it("asking twice still starts it once", () => {
    requestTourReplay();
    requestTourReplay();
    expect(takeTourReplay()).toBe(true);
    expect(takeTourReplay()).toBe(false);
  });
});

describe("closed this visit", () => {
  it("is open until the tour is finished or skipped, then stays closed", () => {
    expect(tourClosedThisVisit()).toBe(false);
    markTourClosed();
    expect(tourClosedThisVisit()).toBe(true);
    expect(tourClosedThisVisit()).toBe(true);
  });

  it("doesn't touch a pending replay", () => {
    requestTourReplay();
    markTourClosed();
    expect(takeTourReplay()).toBe(true);
  });
});
