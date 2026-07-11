export const CLIENT_RUNTIME_TRIAGE_SOURCE = `      function sessionLensPredicate(lens) {
        switch (lens) {
          case "needs-intervention":
            return ({ agent }) => Boolean(agent.needsUser) || agent.state === "blocked";
          case "live":
            return ({ agent }) => !agent.network && isBusyAgent(agent);
          case "inferred":
            return ({ agent }) => agent.confidence === "inferred";
          case "remote":
            return ({ agent }) => Boolean(agent.network) || agent.source === "cloud" || agent.state === "cloud";
          case "degraded":
            return ({ snapshot }) => snapshotHasDegradedProvider(snapshot) || snapshotIsStale(snapshot);
          case "overlap":
            return ({ agent }) => Boolean(state.overlapAgentIds && state.overlapAgentIds.has(agent.id));
          default:
            return () => true;
        }
      }

      function sessionSearchText(snapshot, agent) {
        return [
          displayAgentLabel(snapshot, agent),
          projectLabel(snapshot.projectRoot),
          agent.detail || "",
          agent.provenance || "",
          agent.state || "",
          Array.isArray(agent.paths) ? agent.paths.join(" ") : ""
        ].join(" ").toLowerCase();
      }

      function filterSessionEntries(entries) {
        const filter = state.sessionFilter || {};
        const lens = sessionLensPredicate(filter.lens || "all");
        const query = String(filter.query || "").trim().toLowerCase();
        if (!query && (!filter.lens || filter.lens === "all")) {
          return entries;
        }
        return entries.filter((entry) =>
          lens(entry) && (!query || sessionSearchText(entry.snapshot, entry.agent).includes(query))
        );
      }

      function needsYouUrgency(left, right) {
        return String(left.agent.updatedAt || "").localeCompare(String(right.agent.updatedAt || ""));
      }

      function sessionAgeBadge(agent) {
        const ms = Date.now() - Date.parse(agent.updatedAt || "");
        if (!Number.isFinite(ms) || ms < 45000) return "";
        return \`<span class="session-card-age" title="Time since the last observed change for this session">\${escapeHtml(formatHealthAge(ms))}</span>\`;
      }

      const sessionFilterInput = document.getElementById("session-filter-input");
      const sessionFilterLens = document.getElementById("session-filter-lens");
      let sessionFilterDebounce = null;
      function applySessionFilterChange() {
        state.sessionFilter = {
          query: sessionFilterInput ? sessionFilterInput.value : "",
          lens: sessionFilterLens ? sessionFilterLens.value : "all"
        };
        render();
      }
      if (sessionFilterInput) {
        sessionFilterInput.addEventListener("input", () => {
          if (sessionFilterDebounce) clearTimeout(sessionFilterDebounce);
          sessionFilterDebounce = setTimeout(applySessionFilterChange, 150);
        });
      }
      if (sessionFilterLens) {
        sessionFilterLens.addEventListener("change", applySessionFilterChange);
      }
`;
