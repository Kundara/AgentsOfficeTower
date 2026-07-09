# Agent Workflows

## Purpose

This repository keeps its Codex workflow contract in three places:

- `AGENTS.md` for durable repository rules and verification expectations.
- `.codex/config.toml` plus `.codex/agents/*.toml` for model, concurrency, and role configuration.
- `.agents/skills/*` for reusable Tower operations and coordination workflows.

Keep these surfaces aligned. Put product and codebase invariants in `AGENTS.md`, role-specific behavior in the role config, and repeatable operational procedures in a skill.

## GPT-5.6 baseline

The trusted-project config uses the explicit flagship slug `gpt-5.6-sol` for lead, review, and subagent work. The unsuffixed `gpt-5.6` value is an alias; the explicit slug makes model routing visible in configuration and diagnostics.

The baseline is intentionally bounded:

- Lead work uses `medium` reasoning.
- Plan mode uses `high` reasoning for architecture and dependency decisions.
- Narrow copy roles use `low` reasoning.
- Independent verification uses `high` reasoning.
- Model verbosity remains `medium`; prompts define required evidence instead of generic brevity rules.

These settings are a starting contract, not a claim that the highest effort is always best. When representative workflow evals exist, compare the current setting with one level lower and keep the cheaper setting when completion quality and evidence remain equivalent.

## Concurrency contract

`.codex/config.toml` enables the multi-agent v2 scheduler tested with Codex CLI 0.144.0:

- at most four total agent threads;
- one delegation level, so subagents do not recursively fan out;
- an 1800-second ceiling for batch workers;
- an interrupt message preserved when a worker is stopped;
- read-only specialist roles by default;
- no prompt-only writer role that can mutate more of the workspace than its description claims.

The lead agent owns the plan, user communication, integration decisions, edits to shared files, and final validation. Delegation is useful only when a subtask is bounded, independent, and produces an artifact the lead can verify.

Do not delegate:

- a trivial task whose handoff costs more than doing it directly;
- tightly coupled edits to the same file or generated output;
- a decision that depends on unresolved results from the current step;
- final integration or the completion claim.

## Registered roles

| Role | Access | Effort | Use for | Expected result |
| --- | --- | --- | --- | --- |
| `office_mapper` | Read-only | Medium | Trace behavior across unfamiliar packages before implementation | Minimal file/symbol/test map, evidence, uncertainties, next action |
| `content_designer` | Read-only | Low | Labels, status text, tooltips, and constrained UI wording | One preferred option plus materially different alternatives |
| `office_verifier` | Read-only | High | Independent regression and requirement review after implementation | Readiness conclusion, evidence-backed findings, residual risk |

Keep selection metadata in `.codex/config.toml`. Role files are config layers for model, effort, sandbox, and developer instructions; they should not duplicate role names, descriptions, or nickname candidates. A prompt is not a filesystem access boundary; add a real permission profile before introducing any narrowly scoped writer role.

## Delegation handoff

Give a worker an outcome contract, not a copy of the entire parent prompt:

```text
Goal: the concrete question or artifact to resolve.
Scope: allowed packages, files, and behavior.
Inputs: the minimum known evidence and dependencies.
Success: what the parent must be able to decide or verify.
Output: exact structure, file references, or findings required.
Stop: conditions that should return a blocker instead of expanding scope.
```

For parallel work, assign non-overlapping scopes and name any shared generated output. After results return, the lead synthesizes them before editing or making a final claim.

## Autonomy and permissions

- Review, explain, diagnose, and plan requests authorize inspection and reporting, not implementation.
- Change, build, and fix requests authorize in-scope local edits plus relevant non-destructive validation.
- External writes, destructive operations, deployment, purchases, and material scope expansion require separate authority.
- Existing worktree changes belong to the user or another workflow until proven otherwise; preserve them and avoid overlapping edits.

State these boundaries once in the relevant workflow. Repeating permission warnings throughout role prompts can make safe local work stall unnecessarily.

## Skills

Repo skills live under `.agents/skills`, the Codex repository discovery path:

- `$agents-tower` operates and diagnoses the local server, snapshots, watch mode, and bounded query API.
- `$agents-tower-coordination` reads local or shared-room state before parallel or delegated work and never mutates runtime or sessions.

Keep `SKILL.md` focused on the core decision flow. Put exact command matrices, filters, endpoint details, and edge-case policy in one-level `references/` files. Every `agents/openai.yaml` default prompt must explicitly invoke its `$skill-name`.

## Validation

Run the workflow guard after changing Codex config, roles, or skills:

```bash
npm run check:agent-workflows
```

It parses the Codex TOML layers structurally and verifies the GPT-5.6 model contract, exact role registration, concurrency bounds, unique in-tree role files, read-only sandboxes, intentional effort levels, skill discovery paths, frontmatter, UI prompts, and linked references. Fixture tests ensure malformed or duplicate TOML, orphan role files, shared role targets, and permission drift fail closed.

Also run:

```bash
codex features list
npm run check
```

`multi_agent_v2` is still marked under development in the tested CLI, while the public stable documentation describes the v1 `multi_agent`/`agents.max_threads` shape. This repository intentionally targets the tested v2/Fable-era runtime. Revalidate the project layer before changing either shape.

`codex features list` reports feature availability, but it is not proof that the project layer won over user config. Use `codex --strict-config doctor --summary` after a Codex upgrade and inspect app-server `config/read` with `includeLayers: true` when changing this contract. Multi-agent v2 owns its concurrency limit, and Codex 0.144.0 rejects the older `agents.max_threads` setting when v2 is enabled. `npm run check` includes the deterministic repository guard alongside boundaries, type checks, and tests.

The public model catalog and current local Codex catalog expose GPT-5.6 as Sol, Terra, and Luna. `Fable` is not a public model slug or config key, so do not hard-code it as a model alias. If a Codex surface supplies `Fable` as an agent nickname or other display label, preserve it as opaque metadata.

If `gpt-5.6-sol` is unavailable to the current account or Codex surface, report the access error. Do not silently change the checked-in model contract or fall back to another family.
