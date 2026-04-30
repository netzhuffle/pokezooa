import { dailyPuzzleNumber, dailyTarget, dailyTargetId } from "../src/daily";

const launchDate = new Date("2026-04-30T12:00:00+02:00");
const launchPuzzleNumber = dailyPuzzleNumber(launchDate);
const launchTarget = dailyTarget(launchPuzzleNumber);
const launchTargetId = dailyTargetId(launchPuzzleNumber);

const checks: Array<[string, boolean]> = [
  ["2026-04-30 resolves to daily #1", launchPuzzleNumber === 1],
  ["daily #1 target ID is 565", launchTargetId === 565],
  ["daily #1 target is Karippas", launchTarget.slug === "carracosta"],
];

const failed = checks.filter(([, passed]) => !passed);
if (failed.length > 0) {
  for (const [label] of failed) {
    console.error(`Daily target check failed: ${label}`);
  }
  process.exit(1);
}

console.log(`Daily target check passed: #${launchPuzzleNumber} is ${launchTarget.name}.`);
