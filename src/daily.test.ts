import { describe, expect, test } from "bun:test";
import { dailyPuzzleNumber, dailyTarget, dailyTargetId } from "./daily";

describe("daily target selection", () => {
  test("keeps the public launch-day puzzle stable", () => {
    const launchDate = new Date("2026-04-30T12:00:00+02:00");
    const launchPuzzleNumber = dailyPuzzleNumber(launchDate);

    expect(launchPuzzleNumber).toBe(1);
    expect(dailyTargetId(launchPuzzleNumber)).toBe(565);
    expect(dailyTarget(launchPuzzleNumber).slug).toBe("carracosta");
  });
});
