# Provider SDK

Agents Office Tower renders every agent runtime through one normalized snapshot model. A provider (adapter) is the bridge from a runtime's native signals to that model. This document is the versioned contract a provider must satisfy.

Contract version: **1** (`PROVIDER_CONTRACT_VERSION` in `@agents-tower/core`).

## The contract

A provider implements `ProjectAdapter` from `@agents-tower/core`:

```ts
interface ProjectAdapter {
  id: string;                      // stable adapter id, e.g. "codex-local"
  source: DashboardAgent["source"]; // provider family for rendering
  capabilities: AdapterCapabilities; // declare only what you actually support
  discoverProjects?(limit?: number): Promise<DiscoveredProject[]>;
  createSource(context: ProjectAdapterContext): ProjectSource;
}

interface ProjectSource {
  warm(): Promise<void>;                       // cheap pre-load; must not throw
  refresh(reason: AdapterRefreshReason): Promise<void>; // must resolve; report failures via health
  getCachedSnapshot(): AdapterSnapshot;        // synchronous, always valid
  subscribe?(listener: () => void): () => void; // optional live updates
  dispose(): Promise<void>;                    // release resources; must not throw
}
```

## Non-negotiable semantics

1. **Failures become health, not exceptions.** `refresh()` must resolve even when the runtime is unreachable. Report the condition through `AdapterSnapshot.health`:
   - `ready` — the provider read its runtime successfully (empty results are still ready).
   - `unconfigured` — the integration is intentionally absent (no API key, no install). Not a failure; must not degrade fleet health.
   - `degraded` — the provider works partially or a read failed and cached/partial data is being served.
   - `error` — the provider cannot serve meaningful data at all.
   Every non-ready status must carry a human-readable `detail`.
2. **Provenance survives.** Every agent carries `confidence: "typed" | "inferred"`. Typed means the runtime gave you a structured signal; inferred means you reconstructed state from logs or files. Never upgrade inferred data to typed.
3. **Truth before theater.** Never synthesize presence. An unobserved runtime is `unconfigured` or `degraded` with a detail — not an empty `ready`.
4. **Snapshots are cheap and synchronous.** `getCachedSnapshot()` returns the last computed state immediately; loading happens in `warm`/`refresh`. `StaticProjectSource` in `@agents-tower/core` implements this pattern with a monotonic generation guard — wrap it unless you need custom caching. The newest requested refresh owns publication, including failures. Loader failures preserve cached agents, events, tasks, `generatedAt`, and `health.lastUpdatedAt`; cached successful data becomes `degraded`, while a source without meaningful cached data becomes `error`. A successful empty snapshot still counts as valid cached data.
5. **Stay inside your budget.** Providers run inside the shared snapshot coordinator. Keep refreshes bounded (the built-ins target seconds, not minutes; the harness enforces a separate 10-second default timeout for warm, refresh, and disposal), keep result sizes proportional to real workload, and never block `getCachedSnapshot()` on I/O.

6. **Disposal is terminal.** `StaticProjectSource.dispose()` is idempotent, clears subscribers, prevents new loads, and suppresses publication from loads already in flight. It does not cancel the underlying loader; loaders that own I/O resources must arrange cancellation themselves. Subscriber exceptions are isolated so they cannot turn a successful refresh into a provider failure or prevent other subscribers from receiving the update.

## Golden contract checks

`@agents-tower/core` exports a harness every provider must pass:

```ts
import { runAdapterContractChecks } from "@agents-tower/core";

const failures = await runAdapterContractChecks(myAdapter, { projectRoot: "/tmp/fixture" });
// failures: string[] — empty means the contract is satisfied
```

The checks validate shape (id, source, capabilities, source methods), snapshot invariants (adapterId match, parseable timestamps, array fields, valid health status, detail on non-ready health, valid confidences), and behavior (warm, refresh, and dispose each resolve within the timeout). `refreshTimeoutMs` sets the per-operation budget for all three lifecycle calls. Snapshot getter failures and malformed sources are returned as failures, and a callable dispose method is attempted in a finally block even when earlier checks fail. Deadline timers are cleared after each operation. A timeout bounds the harness wait; it cannot forcibly cancel provider work or synchronous blocking code. All built-in adapters run these checks in CI (`packages/core/test/adapter-contract.test.js`) — add your provider to the same table.

## Registration

Built-in providers are registered in `packages/core/src/adapters/index.ts` (`PROJECT_ADAPTERS`) and wired by the snapshot coordinator. Out-of-process provider execution (isolated processes with resource limits and schema negotiation) is the planned isolation model for third-party providers; until it lands, providers compile into the registry and the golden checks are the gate.

## What providers may not do

- Approve requests, send replies, or mutate another runtime's sessions from within a provider — providers observe; actions flow through the explicitly bounded action routes.
- Report another provider's data as their own or fabricate `typed` confidence.
- Write outside their own runtime's storage and the Tower app-data directory.
