# Live seating and floor motion audit — 6 September 2026

The reported churn is reproducible. The primary trigger is contradictory child-session state, amplified by immediate floor resizing and seat reassignment.

## Live evidence

Runtime: port 4181, PID 41020, normal fleet mode (`explicitProjects: false`), built 09:13:47.714 UTC, started 09:13:49.337 UTC. Four local projects. No runtime restart or product edits were made.

Recorded 172 fleet samples over approximately three minutes starting at 09:18:21 UTC. Evaluated the deployed browser `shouldSeatAtWorkstation` function against each agent, including its wall-clock grace periods. Recorded 31 seat-eligibility flips among the three Oops Game children: Leibniz 20, James 6, Hegel 5. One additional flip belongs to this investigation's mapper and is excluded from the Oops Game result. These are decision transitions, not a frame-by-frame count of rendered desk creation.

Separately sampled the real browser DOM 20 times over 35 seconds. Oops Game's rendered floor height changed five times. Measurements at the browser's existing viewport:

| UTC | Oops Game height | Next floor top | Lead chat anchor (x,y) |
|---|---:|---:|---|
| 09:19:07.702 | 303 px | 580 px | 231,452 |
| 09:19:09.523 | 370 px | 647 px | 113,385 |
| 09:19:11.345 | 471 px | 748 px | 231,452 |
| 09:19:13.162 | 303 px | 580 px | 231,452 |
| 09:19:38.854 | 404 px | 681 px | 113,385 |
| 09:19:40.666 | 303 px | 580 px | 113,385 |

All lower floors moved with the upper floor, including quiet projects. The lead's own anchor moved 118 px horizontally and 67 px vertically during the first cycle. Child chat anchors disappeared and reappeared. Anchor positions are DOM measurements, not an estimate of total avatar walking distance.

## Why desks repeatedly release and reopen

1. **Active and done disagree.** An active child can carry a completed commentary turn and summarize to `done`; active top-level promotion excludes children (`packages/core/src/snapshot-lib/thread-summary.ts:755`, `:938`). Core workload policy evaluates active + terminal before the ongoing latch, with only 1.2 seconds of child grace (`packages/core/src/domain/workload-policy.ts:13`, `:175`). The browser's active branch also rejects terminal agents once `isCurrent` is false, even when `isOngoing` is true (`packages/web/src/client/runtime/seating-source.ts:105`).
2. **An inferred stop can reopen the desk.** `markThreadLive` deletes the stop timestamp. A subsequent dormant observation generates a new `stoppedAt` (`packages/core/src/live-monitor.ts:1572`, `:1605`, `:1670`). The browser checks this timestamp first and seats a child for seven seconds (`packages/web/src/client/runtime/seating-source.ts:3`, `:88`). Thus active/done can be unseated, then stopped/done can become seated again. Thread removal also discards stop history, permitting renewed grace on rediscovery.
3. **Commentary gaps are vulnerable.** Dormant-child detection excludes agent messages from open-work evidence; children are excluded from the top-level non-final recovery bridge (`packages/core/src/domain/codex-turn-semantics.ts:40`, `packages/core/src/live-monitor.ts:185`, `packages/core/src/snapshot-lib/thread-summary.ts:617`). Final-answer detection itself correctly checks `phase: final_answer`; the problem is downstream settlement and conflicting evidence, not every text message being parsed as final.

Example: Leibniz is unseated at 09:18:37 with `state=done`, `status=active`, `isOngoing=true`; seated at 09:18:40 after `notLoaded` produces a fresh stop; unseated at 09:18:43; seated again at 09:18:53; unseated at 09:18:56. The same progress message remains displayed through these transitions. The capture's unique message events for Leibniz are at 09:17:43.950 and 09:18:28.464, while stop timestamps repeatedly renew later. A new message is therefore not necessary to trigger the loop.

The listed core built modules match a fresh in-memory transpilation of current source. Raw upstream list/read/notification traffic was not recorded; the exact producer of each conflicting status remains unproven. The emitted fleet contradictions and their downstream effects were observed directly.

## Why one agent destabilizes the whole scene

- Compact height is recalculated from present seating/group demand on every model build, without a shrink hold (`packages/web/src/client/runtime/scene-source.ts:764`). Height animates in 240 ms (`packages/web/src/client/tower-visuals.css:549`). This propagates into the positions of every lower floor.
- Boss-booth eligibility changes at more than one live child (`packages/web/src/client/runtime/layout-source.ts:1455`). Child count changes therefore move the parent between two kinds of workstation and change the desk-lane layout.
- Group slot coordinates are packed again from the current groups and available height (`packages/web/src/client/scene-grid-source.ts:245`). A stable slot ID does not guarantee a stable physical position.
- Departed agents lose their saved scene state (`packages/web/src/client/runtime/navigation-source.ts:3422`), so a returning agent cannot reliably recover its old seat. Workstation layout changes animate over 520 ms (`:21`).

## Recommended repair order

1. Give child sessions the same non-final work continuity as leads; reconcile active/ongoing evidence before terminal presentation. Make stops idempotent against an actual work generation so repeated observation cannot renew the departure grace.
2. Use one seating decision and one set of grace rules across core, browser, counts and parent classification. A confirmed finish should release once; commentary, observer unloads and quiet gaps should preserve ongoing work.
3. Preserve agent-to-seat assignments and group coordinates across short absences. Keep the parent's workstation stable across child-count fluctuations.
4. Grow floors when space is needed, hold capacity through temporary absences, and compact only after sustained quiet or an explicit action. Slower animation alone would retain the underlying churn.

Validation should replay active child/completed commentary, active/notLoaded alternation with unchanged messages, confirmed final completion, and returning agents. Assert no desk flicker or grace renewal during ongoing work; release once on a real finish; preserve surviving seat coordinates and lower-floor positions across short absences. No behavioral fixes or acceptance claims are included in this investigation.

Artifacts: `capture.mjs`, `fleet.jsonl`, `analyze.mjs`, and `analysis.json` in this directory. The raw capture contains local task content and should remain local.
