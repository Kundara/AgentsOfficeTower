# References

## Codex

- [Codex App Server](https://developers.openai.com/codex/app-server)
  Primary local integration surface for threads, turns, items, approvals, and live notifications.
- [Codex app-server API overview](https://learn.chatgpt.com/docs/app-server#api-overview)
  Current Codex desktop integration contract; it enumerates Codex tasks/threads rather than ChatGPT Quick Chat account history.
- [Projects, chats, and tasks](https://learn.chatgpt.com/docs/projects#start-a-chat)
  Official product guidance for the Quick Chat **Add to task** bridge used before a conversation can enter the Codex task inventory.
- [Codex glossary](https://learn.chatgpt.com/docs/glossary)
  Official distinction among chats, tasks, projects, and related Codex surfaces.
- [Codex app-server README and generated schema guidance](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md)
  Official source-repo reference for `codex app-server generate-ts`, server-initiated approval/input requests, MCP elicitations, and permission request payloads.
- [Codex App Server events](https://developers.openai.com/codex/app-server#events)
  Source of truth for notification semantics such as `thread/status/changed` and the meaning of active desktop thread state while the observer is attached.
- [Codex Cloud](https://developers.openai.com/codex/cloud)
  Supported surface for Codex web/cloud task listing.
- [Codex IDE](https://developers.openai.com/codex/ide)
  Useful when aligning VS Code behavior with Codex session workflows.
- [Codex App Features](https://developers.openai.com/codex/app/features)
  Background for worktrees, app behavior, and multi-project workflows.
- [Codex Subagents](https://developers.openai.com/codex/subagents)
  Source for built-in roles, custom subagent definitions, and naming behavior.
- [Codex Advanced Configuration](https://developers.openai.com/codex/config-advanced)
  Telemetry and advanced runtime behavior reference.
- [Codex Configuration Reference](https://developers.openai.com/codex/config-reference)
  Project configuration, model/reasoning controls, multi-agent limits, and custom role registration.
- [Custom instructions with AGENTS.md](https://developers.openai.com/codex/guides/agents-md)
  Repository instruction discovery, precedence, and scope.
- [Codex Skills](https://developers.openai.com/codex/skills)
  Repo skill discovery under `.agents/skills`, progressive disclosure, frontmatter, and UI metadata.
- [GPT-6 Astra model](https://developers.openai.com/api/docs/models/gpt-6-astra)
  Explicit `gpt-6-astra` specialist routing and supported reasoning levels; checked 2026-09-05.
- [Using GPT-6 Astra](https://developers.openai.com/api/docs/guides/latest-model)
  Migration guidance: preserve effective reasoning effort. Tower observes provider sessions; this role migration does not add Responses API calls or credentials.

## Claude

- [Claude Agent SDK TypeScript reference](https://platform.claude.com/docs/en/agent-sdk/typescript)
  Official session APIs, hook callback contracts, SDK-managed Claude Code integration surface, and built-in tool schemas such as `Agent`, `TaskOutput`, `Bash`, `Edit`, and `Write`.
- [Claude Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview)
  Current setup and capability overview confirming SDK hooks, sessions, permissions, MCP, and bundled Claude Code behavior.
- [Claude Agent SDK sessions](https://code.claude.com/docs/en/agent-sdk/sessions)
  Official boundary for `listSessions()` and `getSessionMessages()`: local Claude Code / Agent SDK sessions, not Claude Home account conversation history.
- [Claude Agent SDK TypeScript V2 preview](https://platform.claude.com/docs/en/agent-sdk/typescript-v2-preview)
  Preview reference for `createSession()` / `resumeSession()` and the newer session lifecycle shape.
- [Claude API client SDKs](https://platform.claude.com/docs/en/api/client-sdks)
  Useful contrast with the Agent SDK: model API wrappers, not Claude Code session observability.
- [Claude Code hooks reference](https://code.claude.com/docs/en/hooks)
  Official hook lifecycle and input schema for `PermissionRequest`, `PreToolUse`, `PostToolUse`, `TaskCreated`, `SubagentStart`, `SubagentStop`, `Stop`, `StopFailure`, and related events.
- [Claude Code subagents](https://code.claude.com/docs/en/sub-agents)
  Official reference for Claude subagent definitions, agent types, invocation behavior, and the conceptual parent/child model behind workflow-managed child work.
- [Claude Code dynamic workflows](https://code.claude.com/docs/en/workflows)
  Official `workflow` / `ultracode` reference for script-orchestrated workflow runs, `/workflows` progress, agent limits, and workflow cost/permission behavior.
- [Introducing dynamic workflows in Claude Code](https://claude.com/blog/introducing-dynamic-workflows-in-claude-code)
  Launch context for `ultracode`, workflow fan-out across subagents, confirmation prompts, resumable progress, and higher usage expectations.
- [Claude Code Agent View](https://code.claude.com/docs/en/agent-view)
  Official background-session reference for `claude agents`, `~/.claude/jobs/<id>/state.json`, and the local supervisor model.
- [Claude Code monitoring](https://code.claude.com/docs/en/monitoring-usage)
  Official OpenTelemetry reference for Claude Code logs, traces, tool events, and subagent span attributes such as `agent_id`, `parent_agent_id`, and `subagent_type`.
- [Claude Code Agent Teams](https://code.claude.com/docs/en/agent-teams)
  Product and workflow reference for Claude team leads, teammates, team names, and cowork/project behavior.
- [Run agents in parallel](https://code.claude.com/docs/en/agents)
  Official comparison of subagents, Agent View, Agent Teams, worktrees, and dynamic workflows.
- [Claude Code monitoring / OpenTelemetry](https://code.claude.com/docs/en/monitoring-usage)
  Official telemetry export reference for Claude Code metrics, log events, traces, and subagent-related span attributes such as `agent_id`, `parent_agent_id`, and `subagent_type`.
- [Automate workflows with hooks](https://code.claude.com/docs/en/hooks-guide)
  Quickstart examples for wiring command hooks and project-local hook scripts.
- [Use Claude Cowork on web, desktop, and mobile](https://support.claude.com/en/articles/15520349-use-claude-cowork-on-web-desktop-and-mobile)
  Official product guidance for the current Home surface that consolidates chat and Cowork entry points while preserving distinct work behavior.
- [Open Claude Desktop with a link](https://support.claude.com/en/articles/14729294-open-claude-desktop-with-a-link)
  Supported deep-link schemes for known Claude chats, Cowork tasks, and Code sessions; opening a known id is not a conversation-list API.
- [Claude Compliance API: chats](https://platform.claude.com/docs/en/api/compliance/apps/chats)
  Enterprise-only administrative chat metadata listing with a Compliance Access Key and an optional user filter.
- [Compliance API content data](https://platform.claude.com/docs/en/manage-claude/compliance-content-data)
  Scope and access requirements for Enterprise chat export, including the boundary between compliance data and Cowork activity.
- [Export your Claude data](https://support.claude.com/en/articles/9450526-export-your-claude-data)
  Supported manual account-data export for personal plans; useful evidence that this is not a live local observation surface.
- [tanbiralam/claude-code source](https://github.com/tanbiralam/claude-code/tree/main/src)
  Implementation reference used to confirm current `agent_id` / `agent_type`, team config, teammate `sessionId`, and worktree metadata shapes; treat it as supporting evidence below official Claude docs, not a primary API contract.

## OpenClaw

- [OpenClaw repository](https://github.com/openclaw/openclaw)
  Primary upstream implementation and README for the Gateway, session model, and workspace configuration.
- [OpenClaw ACP bridge](https://github.com/openclaw/openclaw/blob/main/docs.acp.md)
  Clear explanation of Gateway-backed session routing, session keys such as `agent:main:main`, and the relationship between ACP sessions and Gateway sessions.

## Hermes

- [Hermes Agent repository](https://github.com/nousresearch/hermes-agent)
  Primary upstream implementation for Hermes CLI/TUI behavior, plugin hooks, cron-run sessions, local `~/.hermes/state.db` persistence, profile homes, working-directory context handling, plugin opt-in configuration, verification hooks, subagent lifecycle hooks, and hook correlation fields.

## Cursor

- [Cursor Hooks](https://cursor.com/docs/hooks)
  Official local hook lifecycle, `hooks.json` configuration, event schemas, matcher rules, and project-hook distribution model.
- [Cursor Background Agents](https://docs.cursor.com/en/background-agents)
  Product-level overview for remote background agents, follow-ups, takeover, and supported model constraints.
- [Cursor Cloud Agents](https://cursor.com/docs/cloud-agent)
  Current product overview for remote cloud agents, follow-ups, takeover, and supported model constraints.
- [Cursor Cloud Agents API](https://cursor.com/docs/cloud-agent/api/endpoints)
  Current API entrypoint for listing agents, reading status, conversations, webhooks, repositories, model metadata, and Bearer-token API authorization.
- [Cursor List Agents](https://cursor.com/docs/cloud-agent/api/endpoints)
  Primary endpoint for agent id, repo/ref, status, branch, summary, and target URLs.
- [Cursor Agent Conversation](https://cursor.com/docs/cloud-agent/api/endpoints)
  Official conversation-history endpoint for a single background agent.
- [Cursor Webhooks](https://cursor.com/docs/cloud-agent/api/webhooks)
  Status-change webhook contract and signing headers.
- [Cursor List Models](https://cursor.com/docs/cloud-agent/api/endpoints)
  Supported model identifiers for background-agent creation.
- [Cursor CLI](https://cursor.com/docs/cli/using)
  Official local CLI surface for listing and resuming prior Cursor Agent conversations.
- [Cursor API Keys](https://cursor.com/docs/advanced/api-keys)
  BYOK model and account-level API-key behavior.
- [Cursor community forum: recovered vanished chat](https://forum.cursor.com/t/how-i-recovered-my-vanished-cursor-chat-so-you-dont-have-to/151158)
  Useful field report showing the split between workspace sidebar state and the global Cursor conversation database when local chat history goes missing.
- [AgentBase Cursor message history notes](https://github.com/AgentOrchestrator/AgentBase/blob/5c26fc2935d4db34b801267af5994a14170f4f3f/docs/CURSOR_MESSAGE_HISTORY.md)
  Community reverse-engineering notes covering `agent-transcripts`, workspace `ItemTable`, and global `cursorDiskKV` storage layers.

## Visual / asset references

- [Gherwit CAFE TILES - FREE](https://gherwit.itch.io/cafe-tiles-16x16)
  Source for the street-café tables, chairs, shelf, plant, and coffee-machine sprite crops. Commercial and non-commercial use and modification are allowed; raw-pack resale/reposting is prohibited; credit is optional and appreciated.
- [Gherwit CITY TILES - FREE](https://gherwit.itch.io/city-tiles)
  Matching 16×16 source for the street-café storefront crop and exterior palette, under the same use and redistribution terms.
- [PixelOffice asset pack](https://2dpig.itch.io/)
  Source style reference for the office visuals used in this repo.
- [Justin's 16x16 Icon Pack](https://zeromatrix.itch.io/rpgiab-icons)
  Source for the branch/message/search/image/command pixel icons now shipped in the browser asset set; released by Justin Arnold under CC BY 4.0.
- Local source assets are intentionally not listed here with machine-specific paths.
  Keep any downloaded PixelOffice source files outside the repo and document them with repo-relative notes only if they become part of the shipped workflow.

## Aseprite

- [Aseprite file format docs](https://www.aseprite.org/docs/files)
- [Aseprite slices docs](https://www.aseprite.org/docs/slices/)

These matter because the long-term renderer should use authored slice/tag metadata where possible instead of ad-hoc coordinate guesses.

## PartyKit

- [PartyKit Quickstart](https://docs.partykit.io/quickstart/)
  Current create, local dev, and first deploy flow.
- [PartyKit CLI](https://docs.partykit.io/reference/partykit-cli/)
  Reference for `init`, `dev`, `deploy`, auth, and environment variable commands.
- [Deploy your PartyKit server](https://docs.partykit.io/guides/deploying-your-partykit-server/)
  Current deploy behavior, GitHub login flow, generated `partykit.dev` hostnames, and live log tailing.

## Adjacent inspiration

- [pixel-agents](https://github.com/pablodelucca/pixel-agents)
  Useful reference for sharper README structure, product framing, and “agent work you can actually see” presentation.
  Also a useful negative control: it stays observational over Claude JSONL transcripts and does not rely on a secret Claude integration surface.
- [Reddit: VS Code office-life extension inspiration](https://www.reddit.com/r/ClaudeCode/comments/1rbs0gx/i_built_a_vs_code_extension_that_turns_your/)
  Useful reference for hover-driven character details and “office life” framing.
