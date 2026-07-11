export const CLIENT_RUNTIME_EVIDENCE_SOURCE = `      function sessionCardState(agent) {
        if (agent && agent.needsUser) {
          return { key: "needs-you", label: "Needs you" };
        }
        if (agent && (agent.state === "done" || agent.state === "idle") && (agent.isCurrent === true || agent.isOngoing === true)) {
          return { key: "finishing", label: "Finishing" };
        }
        const key = String(agent && agent.state ? agent.state : "idle")
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "") || "idle";
        return { key, label: titleCaseWords(agent && agent.state ? agent.state : "idle") || "Idle" };
      }

      function sessionDomKey(snapshot, agent) {
        if (agent && agent.conversationKey) {
          return JSON.stringify(["conversation", agent.conversationKey]);
        }
        return JSON.stringify([
          agent.sourceProjectRoot || snapshot.projectRoot || "",
          agent.threadId || agent.sourceAgentId || agent.id || ""
        ]);
      }

      function agentSeatingSignal(agent) {
        if (agent.needsUser) {
          return "Durable " + (agent.needsUser.kind || "approval/input") + " wait — stays until answered";
        }
        if (agent.isOngoing === true) {
          return "Live monitor reports an ongoing turn (isOngoing)";
        }
        if (agent.isCurrent === true) {
          return "Recent activity inside the current-workload window (isCurrent)";
        }
        if (agent.source === "cloud" || agent.state === "cloud") {
          return "Cloud task listed by the provider";
        }
        return "Recent session retained for the Recent list";
      }

      function agentFreshnessRule(agent) {
        if (agent.needsUser) {
          return "Durable wait: cleared only by an answer or provider resolution";
        }
        if (agent.isOngoing === true) {
          return "Ongoing until a final answer or hard terminal state arrives";
        }
        if (agent.isCurrent === true && (agent.state === "done" || agent.state === "idle")) {
          return "Post-stop desk cooldown (short done grace), then moves to Recent";
        }
        if (agent.isCurrent === true) {
          return "Kept current while fresh activity continues; cools after the workload window";
        }
        return "Shown while it fits the global recent cap, newest first";
      }

      function agentEvidenceEvents(snapshot, agent) {
        if (!agent.threadId || !Array.isArray(snapshot.events)) return [];
        return snapshot.events
          .filter((event) => event.threadId === agent.threadId)
          .slice(0, 5)
          .reverse();
      }

      function evidenceTime(iso) {
        const parsed = Date.parse(iso || "");
        if (!Number.isFinite(parsed)) return "";
        return formatHealthAge(Math.max(0, Date.now() - parsed)) + " ago";
      }

      function renderAgentEvidence(snapshot, agent) {
        const chain = agentEvidenceEvents(snapshot, agent);
        const chainHtml = chain.length === 0
          ? '<div class="muted">No recent typed events for this session in the 2-minute event window.</div>'
          : chain.map((event) =>
            \`<div class="evidence-event"><span class="evidence-event-kind">\${escapeHtml(event.kind + "/" + event.phase)}</span><span class="evidence-event-title">\${escapeHtml(event.title || event.method || "")}</span><span class="muted">\${escapeHtml(evidenceTime(event.createdAt))}</span></div>\`
          ).join("");
        const rows = [
          ["Seated by", agentSeatingSignal(agent)],
          ["Provenance", agent.provenance + " · " + agent.confidence + (agent.confidence === "inferred" ? " (no typed hook/observer evidence)" : " (typed provider signal)")],
          ["Updated", (agent.updatedAt || "unknown") + (agent.updatedAt ? " (" + evidenceTime(agent.updatedAt) + ")" : "")],
          ["Snapshot", (snapshot.generatedAt || "unknown") + " (" + evidenceTime(snapshot.generatedAt) + ")"],
          ["Stays because", agentFreshnessRule(agent)]
        ];
        return \`<div class="session-card-evidence" role="note" aria-label="Why is this session here?">\${rows.map(([label, value]) =>
          \`<div class="evidence-row"><span class="evidence-label">\${escapeHtml(label)}</span><span class="evidence-value">\${escapeHtml(value)}</span></div>\`
        ).join("")}<div class="evidence-chain-title">Recent evidence</div>\${chainHtml}</div>\`;
      }
`;
