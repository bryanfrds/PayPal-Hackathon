import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("deployment config", () => {
  // CI can't see this one: the build passes and only Vercel rejects the deployment.
  it("runs every cron at most once a day, the Hobby plan's limit", () => {
    const { crons } = JSON.parse(read("vercel.json")) as { crons: { schedule: string }[] };
    expect(crons.length).toBeGreaterThan(0);
    for (const { schedule } of crons) {
      const [minute, hour] = schedule.split(" ");
      expect(minute).toMatch(/^\d+$/);
      expect(hour).toMatch(/^\d+$/);
    }
  });

  it.each(["app/api/scans/route.ts", "app/api/scans/[id]/rescan/route.ts", "app/api/scans/[id]/retry/route.ts"])(
    "gives %s longer than the vision time limit",
    (path) => {
      expect(read(path)).toContain("export const maxDuration = 60;");
    },
  );
});
