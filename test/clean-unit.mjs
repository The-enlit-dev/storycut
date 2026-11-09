#!/usr/bin/env node
// Unit checks for cut planning: manual cuts and cut noises (no audio needed). Usage: node test/clean-unit.mjs
import { planCuts, mapTime } from "../lib/clean.mjs";

let failed = 0;
const ok = (c, m) => {
  console.log(`${c ? "✓" : "✗"} ${m}`);
  if (!c) failed++;
};
const W = (text, start, end) => ({ text, start, end, p: 0.99 });
// "One two three. (sneeze ~3.3–4.3) Four five. Six seven."
const words = [W("One", 0.5, 0.8), W("two", 0.85, 1.1), W("three.", 1.15, 1.6), W("Four", 4.6, 4.9), W("five.", 4.95, 5.3), W("Six", 5.9, 6.2), W("seven.", 6.25, 6.7)];
const silence = { runs: [{ s: 1.7, e: 3.2 }], thr: -50 }; // sound (the sneeze) between 3.2 and 4.5
const opts = {};

// baseline: the gap holds sound, so it is left uncut and reported
const base = planCuts(words, [], { sections: [] }, [], opts, silence);
ok(mapTime(base.ranges, 3.8) !== null, "a gap with unexplained sound is never cut blindly");
ok(mapTime(base.ranges, 4.6) - mapTime(base.ranges, 1.6) < 3 - 0.5, "…only its quiet part is shortened");

// an applied noise edit in that gap removes it
const noise = [{ type: "noise", status: "applied", start: 1.6, end: 4.6, wordRange: null }];
const n = planCuts(words, noise, { sections: [] }, [], opts, silence);
ok(mapTime(n.ranges, 3.8) === null, "a cut noise (sneeze) between words is removed");
ok(mapTime(n.ranges, 1.3) !== null && mapTime(n.ranges, 4.7) !== null, "the words either side are kept");
const gap = mapTime(n.ranges, 4.6) - mapTime(n.ranges, 1.6);
ok(gap > 0.1 && gap < 0.9, `a natural pause is left in its place (${gap.toFixed(2)}s)`);

// a flagged (not applied) noise changes nothing
const flagged = planCuts(words, [{ ...noise[0], status: "flagged" }], { sections: [] }, [], opts, silence);
ok(mapTime(flagged.ranges, 3.8) !== null, "a flagged noise is kept until approved");

// a manual cut removing words "Four five." together with the sneeze before them
const manual = [{ type: "manual", status: "applied", start: 1.6, end: 5.5, wordRange: [3, 4] }];
const m = planCuts(words, manual, { sections: [] }, [], opts, silence);
ok(mapTime(m.ranges, 4.7) === null && mapTime(m.ranges, 3.8) === null, "a manual cut removes its words and the sound before them");
ok(mapTime(m.ranges, 6.0) !== null, "speech after a manual cut is kept");

if (failed) {
  console.error(`${failed} check(s) failed`);
  process.exit(1);
}
console.log("clean unit checks passed");
