# Product Plan — Trust, Coordination & Operation

Status: **Active** · Drafted 2026-07-11 · Owner: Kundara

This plan merges two independent product reviews (Claude and Codex, run against the same question: how should the product evolve in visibility, coordination, and operation) into one execution roadmap. Where the reviews disagreed, the collision was surfaced and decided explicitly; see the Decision Log.

## North star

Turn Agents Office Tower into a **trustworthy operational nervous system for agent work**. The pixel office remains the memorable ambient interface; the moat is the normalized, provenance-aware workload model underneath it.

Every release must move at least one of these five questions closer to a ten-second answer:

1. What is happening?
2. Can I trust the picture?
3. Where might work collide?
4. What needs my attention?
5. What is the safest next action?

**Flagship acceptance target** (Trust & Coordination v1): *In ten seconds, a user can tell what is active, whether Tower's view is complete, what needs attention, and whether two agents may be colliding.*

## Attitude guardrails (non-negotiable)

Both reviews independently concluded the existing philosophy is the differentiator. Every item below must extend it, never dilute it:

- **Truth before theater.** Discover real sessions; never synthesize presence. Unobserved means unobserved, not empty.
- **Provenance survives normalization.** Typed vs. inferred evidence stays visible end to end.
- **Current workload first, history second.** Retrospective surfaces are bounded and secondary.
- **Spatial and glanceable.** High-level state lives in the scene (motion, placement, small badges, drawers) — no detached dashboard slabs, no health badges carpeting the map.
- **Observe broadly, operate narrowly.** Actions only where the provider gives authoritative, safe control on an owned connection. Visibility never implies authority.
- **Evidence, not verdicts.** Coordination output says "possible overlap", "both recently touched this path", "team evidence unavailable" — never "owned by" without an explicit claim.

**Anti-goals** (explicitly rejected): individual productivity scores, token leaderboards, utilization percentages, automatic takeover, forced locks, arbitrary remote message injection, generic remote command execution, in-process arbitrary plugins.

## Decision log

Decisions made 2026-07-11 (Kundara), resolving the collisions between the two reviews:

| # | Question | Decision |
| --- | --- | --- |
| D1 | Product identity | **Vendor-neutral: Agents Office Tower.** Rename packages, CLI, and spec purpose statement. Codex remains the best-supported provider, but the product is the neutral agent workload surface. |
| D2 | Remote access to Needs You | **Local notifications now, remote later.** System notifications + menu-bar indicator ship first (no boundary change). Phone/remote answering is deferred until the capability-scoped action gateway and audit journal exist (Phase 4), then revisited. |
| D3 | Session dispatch from Tower | **Codex restraint this cycle.** Only act on existing typed waits; reply/steer/resume owned sessions; safe deep links and handoff packets. Templated dispatch is re-evaluated after the audit journal has soaked (see Parking Lot). |
| D4 | Distribution | **Publish publicly.** npm-publish the CLI, add CI running the acceptance checks, keep `demo preview` as the public pitch. Lifecycle work targets strangers' machines. |
| D5 | Code license | **MIT.** Bundled art assets keep their original authors' terms (see README License section); the MIT grant covers code only. |
| D6 | npm naming | **CLI publishes as `agents-office-tower`; workspace libraries under `@agents-tower/*`** (core, web, party). Root workspace is `agents-office-tower-workspace` (private). The `agents-tower` npm org must be created before first publish. |
| D7 | CLI bin | **`aot`**, with `codex-agents-office` retained as a deprecated alias bin for one release. |

## Phase overview and sequencing

```
P0 Identity & Release Readiness ──┐
P1 Trustworthy Visibility ────────┼──> P2 Attention & Collision ──> P3 Declared Coordination ──> P4 Managed Appliance
                                  │                                                                & Guarded Operations
                                  └──────────────────────────────> P5 Provider SDK ──────────────> P6 Operational
                                                                    (needs P1 health contract)       Intelligence
```

P0 and P1 can run in parallel. P5 depends on P1 (health reporting is part of the provider contract). P6 comes last by design: intelligence built on an untrusted picture would be noise.

---

## Phase 0 — Identity & release readiness

*Decisions: D1, D4. Goal: one name, publishable packages, CI safety net — before an SDK or npm locks the wrong names in.*

### Work items

- [x] **Rename to the tower identity.** Done 2026-07-11 per D6/D7: CLI package `agents-office-tower` with bins `aot` + deprecated `codex-agents-office` alias; libraries `@agents-tower/core|web|party`; VS Code package `agents-office-tower-vscode`; root workspace `agents-office-tower-workspace`; all imports and help text updated; build, typecheck, lint, and 429 workspace tests green. **Deliberately kept stable (functional identifiers on existing installs)**: browser localStorage keys (`codex-agents-office:*`), PartyKit deployment name (`codex-agents-office-sync`), Hermes plugin dir (`~/.hermes/plugins/codex-agents-office`), OpenClaw client id, app user-data dirs (`~/.codex/codex-agents-office`, `%LOCALAPPDATA%\CodexAgentsOffice`), and VS Code internal command ids (`codexAgentsOffice.*`). Rename those only with migrations/fallbacks, if ever.
- [x] **Rewrite the spec purpose statement.** Done 2026-07-11: `docs/spec.md`, `AGENTS.md`, `docs/architecture.md`, `docs/self-development.md`, `docs/integration-hooks.md`, README query examples, and the `agents-tower` skill CLI contract now carry the Agents Office Tower identity. Remaining: the `CodexAgentsOffice` Windows user-data/cache directory name in `packages/core/src/app-settings.ts` and `codex-command.ts` is functional, not branding — rename it with the package rename below and include a cache-path migration (or keep-old-path fallback).
- [x] **Add a LICENSE.** Done 2026-07-11 per D5: MIT `LICENSE` at root, `license` fields in every package, README License section clarifying that bundled art keeps its authors' terms. **Remaining sub-item:** verify the 2D Pig PixelOffice pack terms permit redistributing its environment assets in a public repo/npm tarball (Gherwit-derived crops and CC BY icons are already cleared) — see Open Questions.
- [x] **CI.** Done 2026-07-11: `.github/workflows/ci.yml` runs build + the full `npm run check` suite on push/PR, plus a guard that fails on reintroduced pre-rename package-scope imports or old product naming in docs. Also restored the missing `.codex/config.toml` `model`/`model_reasoning_effort` baseline so `check:agent-workflows` is green again (4/4). Note: CI runs on ubuntu — first run may surface Linux-only test assumptions since the suite has only been exercised on macOS.
- [ ] **Publish the CLI to npm** (initial `0.1.x`), with `npx agents-office-tower demo preview` as the documented zero-install pitch path. **Ready:** packages have `files` allowlists, publishable version-range deps, and a tag-driven `.github/workflows/release.yml` (core → web → cli, with provenance). **Blocked on user actions:** create the `agents-tower` npm org, add an `NPM_TOKEN` repo secret, then push a `v0.1.x` tag.
- [ ] **Public onboarding pass on README/Quick Start** targeting a stranger's machine (prerequisites, what works without Codex/Claude installed, what the demo shows). Partial: README now documents the `aot` binary and package name; the full stranger-oriented rewrite lands with the first npm release.

### Acceptance

- A stranger can run the demo scene from npm in one command.
- CI is green on master; publishing is tag-driven.
- No file in the repo introduces the old identity going forward (grep check in CI is acceptable).

---

## Phase 1 — Trustworthy visibility

*Goal: the picture explains itself. "Why should I believe this classification, and what might be missing?"*

### Work items

- [ ] **Resolve the Active/Done semantic contradiction.** The Sessions panel can report "5 active" while rows inside Active read `Done`. A session must either (a) show an activity label consistent with its lane, (b) use a transitional `Finishing` state, or (c) explain that runtime ownership remains active although the latest observed action completed. Pick one rule, encode it in `docs/spec.md`, and test it.
- [ ] **Preserve adapter health as a public contract.** Adapter health (ready/degraded/error) already exists internally; expose per-provider last success, refresh age, latency, last error, subscription mode, and cache age through the snapshot model.
- [ ] **Health endpoints**: `/api/health/live`, `/api/health/ready`, `/api/health` (full detail). Loopback-only like existing web APIs.
- [ ] **CLI `tower status` and `tower doctor`.** Status: fleet-level Healthy / Starting / Degraded / Stale plus per-provider rows. Doctor: environment probing (provider binaries, app-server reachability, stale listeners, log locations).
- [ ] **Coverage drawer in the browser.** One fleet-level health indicator, a small badge only on degraded floors, and a drawer answering "what might be missing?" — including explicit shared-team states (connected / stale / unavailable). No badge carpet on the map.
- [ ] **Stale-data indicators.** Freshness age on session cards and hover details when a provider's last authoritative refresh exceeds its expected cadence.
- [ ] **Deduplicate fleet-wide warnings.** Terminal mode repeats identical environment warnings per floor; hoist repeated diagnostics to one fleet-level note.
- [ ] **"Why is this here?" explainability view.** Compact per-session evidence panel: the signal that seated it (typed event vs. inferred transcript), last authoritative refresh, last state transition, the freshness/expiry rule in effect, and a short causal chain (e.g. prompt → planning → file edit → validating → waiting for input). This converts the sophisticated state rules in `docs/architecture.md` into user-visible trust.

### Acceptance

- No lane/label contradictions at `/layout-audit` synthetic floors or in live use.
- `tower status` degrades believably when a provider is killed mid-session (black-box test).
- Every seated agent can answer "why is this here?" from typed or inferred evidence without reading server logs.

---

## Phase 2 — Attention & collision

*Goal: Sessions becomes the triage cockpit for larger fleets; the office stays the ambient entry point. Decision D2's local-notification half lands here.*

### Work items

- [ ] **Sessions search + filters.** Project, provider, state, confidence (typed/inferred), local/remote, lead/subagent. Filters appear on demand; the default stays the current simple hierarchy.
- [ ] **Saved lenses**: Needs intervention · My live work · Inferred only · Remote work · Possible overlap · Degraded visibility.
- [ ] **Attention ranking + time-in-state.** Sort Needs You and Active by urgency: wait age, stuck indicators, staleness. Show time-in-state on cards; escalate visibly when a typed approval sits past a threshold ("waiting 22 minutes").
- [ ] **Local notifications + menu-bar presence (D2).** System notifications for new Needs You entries and long-stale waits; a minimal macOS menu-bar indicator showing the Needs You count and fleet health. Strictly local machine; no transport change.
- [ ] **Read-only Coordination Lens.** A toggleable scene/panel overlay revealing: full lead/subagent topology, actors touching the same files or subsystem, local vs. remote actors, branch/worktree relationships, shared hot files.
- [ ] **Possible-overlap cards.** Evidence-backed, timestamped, confidence-scored: "Possible overlap — both agents touched `packages/web/src/...` within 10 minutes." Include insufficient-evidence cards ("team evidence unavailable") rather than staying silent.
- [ ] **Hot-file → sessions navigation.** Click an Ops Wall hot file to see every session that touched it.
- [ ] **Cross-goal correlation.** Use the existing normalized goal metadata to flag "two agents have overlapping goals on the same repo" as a derived, advisory signal.

### Acceptance

- The flagship ten-second target is met on a busy fleet (5+ projects, 10+ sessions).
- A stale approval produces a system notification without the browser being focused.
- Every overlap card cites its evidence and timestamps; zero "owned by" language.

---

## Phase 3 — Declared coordination

*Goal: from a coordination read-model to a coordination model — advisory, expiring, never enforced.*

### Work items

- [ ] **Minimal coordination record schema**: objective, declared subsystem, expected files, branch/worktree, dependencies, expected validation, soft-claim expiry, heartbeat, handoff state. Versioned from day one (feeds the P5 SDK contract).
- [ ] **Soft advisory claims.** Agents and users can publish "I'm working on X for ~N minutes." Claims expire, require heartbeats, and are visible in the scene and Coordination Lens. Detected activity and declared intent render **side by side** — divergence is information; Tower never silently reconciles them.
- [ ] **Blockers, acknowledgements, handoff state.** An agent can declare "blocked on Y"; a human can acknowledge a warning; a session can be marked handed-off (record only — no takeover).
- [ ] **Privacy-minimized shared coordination envelope.** Shared rooms transmit coordination metadata (claims, states, goals) without full snapshots. Raw commands, message bodies, absolute paths, and notes are omitted or explicitly opted in.
- [ ] **Skills upgrade.** Extend `.agents/skills/agents-tower-coordination` so agents check claims before editing and can publish/release their own claims via the CLI. Update `check:agent-workflows` fixtures accordingly.
- [ ] **Level-3 guidance (advisory recommendations).** Evidence-backed, in browser and via a structured CLI coordination query: "Proceed: scopes appear disjoint" · "Wait: another actor is validating the same surface" · "This claim is stale, but no explicit release was observed" · "Team visibility is unavailable; confirm before delegating."

### Acceptance

- Two concurrent agents on one repo can each see the other's claim before their first edit, via skill query alone.
- A stale claim is visibly distinguishable from an active one, and its staleness reason is inspectable.
- Shared-room network traffic for coordination contains no message bodies or raw commands (verifiable in the envelope schema tests).

---

## Phase 4 — Managed appliance & guarded operations

*Goal: Tower can confidently report on and manage itself, and every action is capability-scoped and audited. Decisions D2 (remote gate), D3 (restraint), D4 (public machines) all land here.*

### Work items — managed appliance

- [ ] **Lifecycle CLI**: `tower install | start | stop | restart | status | doctor | logs | upgrade`.
- [ ] **Service packaging**: optional launchd (macOS), systemd (Linux), Windows service installation; headless daemon mode independent of any open browser.
- [ ] **Stale-listener ownership verification** before binding port 4181; refuse or adopt explicitly, never silently double-bind.
- [ ] **Atomic upgrade with last-known-good rollback.**
- [ ] **Build identity**: package version, git SHA, schema version, protocol compatibility, build time — exposed in `/api/health` and `tower status`.
- [ ] **Clear startup readiness and failure states** (extends P1 endpoints).

### Work items — guarded operations

- [ ] **Three authority planes, formalized in code and docs:**

  | Plane | Responsibility | Default authority |
  | --- | --- | --- |
  | Observation | Snapshots, events, provenance, history, health | Broad read-only |
  | Coordination | Claims, blockers, acknowledgements, handoffs | Team-scoped writes |
  | Operation | Approval, reply, resume, cancel, configuration | Local owner with explicit capability |

- [ ] **Capability-scoped action gateway.** Operational actions use short-lived capabilities bound to: Tower server instance, provider, thread, action class, ownership context. Idempotency keys on every action.
- [ ] **Local audit journal**: actor, target, action, outcome, provider provenance, timestamp — for every operational action including browser approvals. Shared-room visibility must never grant operational authority (enforced, tested).
- [ ] **Safe deep links & handoff actions (D3 scope)**: open/resume the owning task, export a bounded handoff packet, acknowledge a warning, answer an existing typed request, open the related branch/worktree/file/validation surface, generate a suggested delegation contract. **No dispatch, no takeover, no arbitrary remote messages.**
- [ ] **Black-box test suite**: startup, reconnect, degraded-adapter, and authorization paths (including a rejected cross-ownership action attempt).

### Acceptance

- `tower upgrade` from N to N+1 with rollback works on a machine that has never built from source.
- Every browser-initiated approval appears in the audit journal with full provenance.
- A shared-room peer attempting an operational action is denied and the denial is journaled.
- **Exit gate:** once the audit journal has soaked, formally revisit D3 (dispatch) and D2 (remote answering) — see Parking Lot.

---

## Phase 5 — Provider SDK

*Goal: every new agent runtime becomes someone else's adapter, not our reverse-engineering project. Depends on P1's health contract and P3's record schema.*

### Work items

- [ ] **Versioned provider contract** defining: provider identity and version, source kinds, typed vs. inferred confidence, discovery and snapshot support, live-event support, health reporting, optional action capabilities, schema negotiation.
- [ ] **Resource limits in the contract**: time, memory, filesystem, network, result-size budgets per provider.
- [ ] **Golden contract tests** any provider implementation must pass; publish fixtures.
- [ ] **Out-of-process provider execution** preferred over in-process plugins; the normalized Tower model remains authoritative. Migrate one existing adapter (candidate: Cursor, the weakest/most-inferred one) as the reference implementation.
- [ ] **SDK docs + example provider** repo/template under the `@agents-tower` scope.

### Acceptance

- An external developer can build a working read-only provider from docs + template + golden tests without reading Tower core source.
- A misbehaving out-of-process provider (hang, oversized result) degrades its floor to `Degraded` without harming the fleet snapshot.

---

## Phase 6 — Operational intelligence

*Goal: bounded fleet learning — only after health and coordination records are reliable, and never productivity scoring.*

### Work items

- [ ] **Fleet pulse signals**: time waiting for human input, stuck or repeatedly failing work (same file edited N times, repeated failing command), overloaded leads, stale claims, subscription instability, arrival/completion rhythm, likely collision hotspots.
- [ ] **Bounded daily digest** (history second, not never): sessions run, waits incurred and their total human-wait time, hot files, finished vs. abandoned work. One screen, local only, no per-agent scoring.
- [ ] **Token/cost burn per session** where providers expose it — as a health/attention signal (runaway burn), never as a leaderboard.

### Acceptance

- A stuck-loop session is flagged before its human would have noticed it manually.
- The digest answers "what happened while I was away?" in under a minute, and nothing in it ranks agents or people.

---

## Parking lot (explicitly deferred, with re-entry conditions)

| Item | Why deferred | Re-entry condition |
| --- | --- | --- |
| **Remote/phone answering of Needs You** (D2) | Breaks loopback-only boundary; must be built on capability gateway + audit journal, not before them | P4 complete and soaked; design an authenticated relay (PartyKit path is a candidate) as its own review |
| **Templated task dispatch from Tower** (D3) | Changes identity from observer to operator; Codex review recommends against until governance exists | P4 audit journal soaked; formal decision review |
| **Team product expansion** (persistent room history, roles/permissions, review queues, teammate handoff) | Biggest scope jump; both reviews agreed to let usage data decide | Evidence of real multi-human shared-room usage; P3 envelope shipped |
| **Desktop app packaging** (menu-bar app beyond indicator, Tauri/Electron) | D4 chose npm-first distribution | Post-P4, if non-developer users appear |

## Open questions (not yet decided — small, but need answers before their phase)

1. ~~License choice~~ Decided: MIT (D5). ~~Asset verification~~ Resolved 2026-07-11: the 2D Pig PixelOffice pack is CC0 (public domain — commercial use and redistribution explicitly permitted), Gherwit crops are shipped as derived sprites within the pack's free-use terms, and the icon packs are CC BY 4.0 with credits in the README. All bundled assets are cleared for public repo and npm distribution.
2. ~~npm scope~~ Decided (D6) and secured: the `agents-tower` npm org was created 2026-07-11 under @kundara on the free public-packages plan. **Still open:** add an `NPM_TOKEN` secret to the GitHub repo, then tag `v0.1.x` to trigger the release workflow. Note the CLI package `agents-office-tower` is unscoped (published under the user account, not the org), so the token must cover both.
3. **VS Code extension**: publish to the marketplace in P0, or defer to P4 when lifecycle is solid? (Package id is now `agents-office-tower-vscode`, publisher still `local`.)
4. **PartyKit hosting for public users** (P3): shipped rooms currently assume your deployment; public users need self-host docs or a hosted tier decision.
5. **`Finishing` vs. lane-consistent labels** (P1): pick the Active/Done resolution rule — recommend deciding during implementation with a spec update in the same PR.

## Release theme

The first shippable milestone is **Trust & Coordination v1** = Phase 0 + Phase 1 + the filter/ranking/overlap items of Phase 2, under the flagship acceptance target above. It materially evolves the product without changing its identity.
