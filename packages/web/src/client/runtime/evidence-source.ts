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

      function evidenceTime(iso) {
        const parsed = Date.parse(iso || "");
        if (!Number.isFinite(parsed)) return "";
        return formatHealthAge(Math.max(0, Date.now() - parsed)) + " ago";
      }
`;
