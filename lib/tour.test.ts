import { describe, expect, it } from "vitest";
import {
  TOUR_STEP_IDS,
  availableSteps,
  backStep,
  currentStep,
  nextStep,
  placeTip,
  relayout,
  resolveTarget,
  skipMissing,
  startTour,
  tourTargets,
  type TourState,
} from "./tour";

/** A screen where these data-tour targets are showing. */
const showing = (...targets: string[]) => (t: string) => targets.includes(t);

const PHONE = showing("home-hero", "nav-scan", "nav-collect", "home-reminders", "settings-phone");
const WIDE = showing("home-hero", "nav-scan", "nav-collect", "nav-reminders", "settings-wide");

describe("step lists", () => {
  it("has the five steps in order", () => {
    expect(TOUR_STEP_IDS).toEqual(["home", "scan", "collect", "reminders", "settings"]);
  });

  it("phone points Reminders at Home's button and Settings at the avatar", () => {
    expect(tourTargets("reminders", "phone")).toEqual(["home-reminders"]);
    expect(tourTargets("settings", "phone")).toEqual(["settings-phone"]);
    expect(availableSteps("phone", PHONE)).toEqual(TOUR_STEP_IDS);
  });

  it("laptop points Reminders and Settings at the sidebar", () => {
    expect(tourTargets("reminders", "wide")).toEqual(["nav-reminders"]);
    expect(tourTargets("settings", "wide")).toEqual(["settings-wide"]);
    expect(availableSteps("wide", WIDE)).toEqual(TOUR_STEP_IDS);
  });

  it("doesn't use the other layout's targets", () => {
    // A phone screen: the sidebar's Reminders tab and Settings link are hidden.
    expect(resolveTarget("reminders", "phone", WIDE)).toBeNull();
    expect(resolveTarget("settings", "wide", PHONE)).toBeNull();
  });

  it("skips a step whose target is missing", () => {
    const noRemind = showing("home-hero", "nav-scan", "nav-collect", "settings-phone");
    expect(availableSteps("phone", noRemind)).toEqual(["home", "scan", "collect", "settings"]);
  });
});

describe("startTour", () => {
  it("starts on step 1", () => {
    const s = startTour("phone", PHONE)!;
    expect(s.index).toBe(0);
    expect(currentStep(s)).toBe("home");
    expect(s.steps).toHaveLength(5);
  });

  it("starts on the first step that has a target", () => {
    const s = startTour("wide", showing("nav-collect", "settings-wide"))!;
    expect(currentStep(s)).toBe("collect");
    expect(s.steps).toEqual(["collect", "settings"]);
  });

  it("is null when nothing is on screen", () => {
    expect(startTour("phone", () => false)).toBeNull();
  });
});

describe("next / back", () => {
  it("walks forward and finishes after the last step", () => {
    let s: TourState | null = startTour("phone", PHONE);
    const seen: string[] = [];
    while (s) {
      seen.push(currentStep(s));
      s = nextStep(s);
    }
    expect(seen).toEqual(["home", "scan", "collect", "reminders", "settings"]);
  });

  it("goes back, and stays on step 1 at the start", () => {
    const s = startTour("phone", PHONE)!;
    expect(backStep(s)).toBe(s);
    const third = nextStep(nextStep(s)!)!;
    expect(currentStep(backStep(third))).toBe("scan");
  });

  it("doesn't change the state it was given", () => {
    const s = startTour("phone", PHONE)!;
    nextStep(s);
    expect(s.index).toBe(0);
  });
});

describe("skipMissing", () => {
  const start = startTour("phone", PHONE)!;
  const at = (id: string) => ({ ...start, index: start.steps.indexOf(id as never) });

  it("keeps the step when its target is still there", () => {
    expect(skipMissing(at("collect"), PHONE)).toEqual(at("collect"));
  });

  it("moves forward past a target that has gone", () => {
    const s = skipMissing(at("reminders"), showing("home-hero", "nav-scan", "nav-collect", "settings-phone"))!;
    expect(currentStep(s)).toBe("settings");
    expect(s.steps).toEqual(["home", "scan", "collect", "settings"]);
  });

  it("moves back past a target that has gone when going back", () => {
    const s = skipMissing(at("reminders"), showing("home-hero", "nav-scan", "nav-collect", "settings-phone"), -1)!;
    expect(currentStep(s)).toBe("collect");
  });

  it("finishes when the last step's target has gone", () => {
    expect(skipMissing(at("settings"), showing("home-hero", "nav-scan"))).toBeNull();
  });

  it("finishes when nothing is left", () => {
    expect(skipMissing(at("home"), () => false)).toBeNull();
  });

  it("also drops later steps that have gone, so the count stays right", () => {
    const s = skipMissing(at("scan"), showing("home-hero", "nav-scan", "nav-collect"))!;
    expect(currentStep(s)).toBe("scan");
    expect(s.steps).toEqual(["home", "scan", "collect"]);
  });
});

describe("relayout", () => {
  it("keeps the same step when the window crosses into laptop size", () => {
    const s = nextStep(startTour("phone", PHONE)!)!; // scan
    const r = relayout(s, "wide", WIDE)!;
    expect(r.layout).toBe("wide");
    expect(currentStep(r)).toBe("scan");
  });

  it("moves on to the next step the new layout has", () => {
    const phoneOnly = showing("home-hero", "nav-scan", "nav-collect", "home-reminders", "settings-phone");
    const s = { ...startTour("phone", phoneOnly)!, index: 3 }; // reminders
    const r = relayout(s, "wide", showing("home-hero", "nav-scan", "nav-collect", "settings-wide"))!;
    expect(currentStep(r)).toBe("settings");
  });

  it("does nothing when the layout is the same", () => {
    const s = startTour("phone", PHONE)!;
    expect(relayout(s, "phone", PHONE)).toBe(s);
  });
});

describe("placeTip", () => {
  const viewport = { width: 390, height: 800 };
  const tip = { width: 358, height: 180 };

  it("goes below a target near the top", () => {
    const p = placeTip({ top: 100, left: 16, width: 358, height: 150 }, tip, viewport);
    expect(p.side).toBe("below");
    expect(p.top).toBe(100 + 150 + 14);
    expect(p.left).toBe(16);
  });

  it("goes above a target near the bottom (the phone menu)", () => {
    const p = placeTip({ top: 730, left: 300, width: 60, height: 46 }, tip, viewport);
    expect(p.side).toBe("above");
    expect(p.top).toBe(730 - 14 - 180);
    // The arrow points at the tab's middle, kept inside the tooltip's rounded corners.
    expect(p.arrowX).toBe(Math.min(330 - p.left, 358 - 24));
  });

  it("stays inside the window on both sides", () => {
    const wide = { width: 1400, height: 900 };
    const small = { width: 340, height: 170 };
    const left = placeTip({ top: 200, left: 10, width: 40, height: 40 }, small, wide);
    expect(left.left).toBe(16);
    expect(left.arrowX).toBe(24);
    const right = placeTip({ top: 200, left: 1380, width: 20, height: 40 }, small, wide);
    expect(right.left).toBe(1400 - 16 - 340);
  });

  it("picks the roomier side and clamps when it fits neither", () => {
    const short = { width: 390, height: 400 };
    const p = placeTip({ top: 120, left: 16, width: 358, height: 150 }, { width: 358, height: 300 }, short);
    expect(p.side).toBe("below"); // 100px below vs 90px above
    expect(p.top).toBe(400 - 16 - 300); // pulled up so it doesn't run off the bottom
  });
});
