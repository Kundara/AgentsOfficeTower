export const CLIENT_RUNTIME_COORDINATION_SOURCE = `      const DESKTOP_NOTIFY_PREF_KEY = "agents-tower:desktop-notifications";
      const STALE_WAIT_ESCALATION_MS = 10 * 60 * 1000;
      const notifiedWaits = new Map();

      function detectPossibleOverlaps(projects) {
        const overlaps = [];
        for (const snapshot of projects) {
          const hotChanges = snapshot.activity && Array.isArray(snapshot.activity.hotChanges)
            ? snapshot.activity.hotChanges
            : [];
          for (const change of hotChanges) {
            const agents = Array.isArray(change.agents) ? change.agents : [];
            const users = Array.isArray(change.users) ? change.users : [];
            const branches = Array.isArray(change.branches) ? change.branches : [];
            if (agents.length >= 2 || users.length >= 2 || branches.length >= 2) {
              overlaps.push({
                projectRoot: snapshot.projectRoot,
                path: change.path,
                label: change.label,
                agents,
                users,
                branches,
                lastChangedAt: change.lastChangedAt,
                confidence: change.confidence
              });
            }
          }
        }
        return overlaps.slice(0, 6);
      }

      function overlapEvidenceLine(overlap) {
        const parts = [];
        if (overlap.agents.length >= 2) parts.push(overlap.agents.length + " agents recently touched this path");
        if (overlap.users.length >= 2) parts.push("changed by " + overlap.users.join(" and "));
        if (overlap.branches.length >= 2) parts.push("seen on branches " + overlap.branches.join(", "));
        if (parts.length === 0) parts.push("multiple recent actors on this path");
        return parts.join(" · ");
      }

      function refreshCoordinationState(projects) {
        const overlaps = detectPossibleOverlaps(projects);
        state.overlapRows = overlaps;
        state.overlapAgentIds = new Set(overlaps.flatMap((overlap) => overlap.agents));
        return overlaps;
      }

      function declaredClaimRows(projects) {
        const rows = [];
        for (const snapshot of projects) {
          for (const claim of Array.isArray(snapshot.claims) ? snapshot.claims : []) {
            if (claim.lifecycle === "active" || claim.lifecycle === "stale" || claim.lifecycle === "handoff") {
              rows.push({ snapshot, claim });
            }
          }
        }
        return rows.slice(0, 6);
      }

      function renderDeclaredClaimCards(projects) {
        const rows = declaredClaimRows(projects);
        if (rows.length === 0) return "";
        const cards = rows.map(({ snapshot, claim }) => {
          const meta = [
            claim.agentLabel ? "by " + claim.agentLabel : "",
            claim.scope.length > 0 ? "scope " + claim.scope.join(", ") : "",
            claim.branch ? "branch " + claim.branch : "",
            "heartbeat " + (evidenceTime(claim.heartbeatAt) || "unknown")
          ].filter(Boolean).join(" \u00b7 ");
          const staleNote = claim.lifecycle === "stale"
            ? '<div class="coordination-claim-stale">Stale: expired without an explicit release — confirm before assuming it is done.</div>'
            : claim.lifecycle === "handoff"
            ? '<div class="coordination-claim-stale">Marked for handoff.</div>'
            : "";
          return \`<div class="coordination-card coordination-claim is-\${claim.lifecycle}" role="listitem"><div class="coordination-card-title">Declared: \${escapeHtml(claim.objective)}</div><div class="muted coordination-card-evidence">\${escapeHtml(projectLabel(snapshot.projectRoot))} \u00b7 \${escapeHtml(meta)}</div>\${staleNote}</div>\`;
        }).join("");
        return \`<section class="session-group session-group-coordination" role="group" aria-label="Declared work claims, \${escapeHtml(String(rows.length))} claims"><div class="session-group-header"><h3>Declared work</h3><span>\${escapeHtml(String(rows.length))}</span></div><div class="session-group-items" role="list">\${cards}</div></section>\`;
      }

      function renderCoordinationCards(projects) {
        const overlaps = state.overlapRows || [];
        if (overlaps.length === 0) return "";
        const cards = overlaps.map((overlap) =>
          \`<div class="coordination-card" role="listitem"><div class="coordination-card-title">Possible overlap — \${escapeHtml(overlap.label)}</div><div class="muted coordination-card-evidence">\${escapeHtml(overlapEvidenceLine(overlap))} · \${escapeHtml(evidenceTime(overlap.lastChangedAt) || "recently")} · \${escapeHtml(overlap.confidence)} evidence</div><div class="card-actions"><button data-action="search-overlap" data-query="\${escapeHtml(overlap.label)}">Show sessions</button></div></div>\`
        ).join("");
        return \`<section class="session-group session-group-coordination" role="group" aria-label="Possible coordination overlaps, \${escapeHtml(String(overlaps.length))} findings"><div class="session-group-header"><h3>Possible overlap</h3><span>\${escapeHtml(String(overlaps.length))}</span></div><div class="session-group-items" role="list">\${cards}</div></section>\`;
      }

      function desktopNotificationsState() {
        if (typeof Notification === "undefined") return "unsupported";
        if (localStorage.getItem(DESKTOP_NOTIFY_PREF_KEY) !== "on") return "off";
        return Notification.permission === "granted" ? "on" : "blocked";
      }

      function renderNotificationToggleSection() {
        const notifyState = desktopNotificationsState();
        if (notifyState === "unsupported") return "";
        const label = notifyState === "on" ? "Disable desktop notifications" : "Enable desktop notifications";
        const hint = notifyState === "on"
          ? "Notifying on new Needs You waits and 10-minute stale waits."
          : notifyState === "blocked"
          ? "Enabled, but the browser denied permission."
          : "Get a system notification for new Needs You waits and stale waits.";
        return \`<div class="settings-section"><strong>Notifications</strong><div class="muted">\${escapeHtml(hint)}</div><button type="button" data-action="toggle-desktop-notifications">\${escapeHtml(label)}</button></div>\`;
      }

      function syncNeedsYouNotifications(projects) {
        if (desktopNotificationsState() !== "on") return;
        const nowMs = Date.now();
        for (const snapshot of projects) {
          for (const agent of snapshot.agents) {
            if (!agent.needsUser) continue;
            const key = (agent.id || "") + "::" + (agent.needsUser.requestId || "");
            const waitAgeMs = nowMs - Date.parse(agent.updatedAt || "");
            const entry = notifiedWaits.get(key);
            if (!entry) {
              notifiedWaits.set(key, { escalated: false });
              new Notification("Needs you: " + (agent.label || "agent"), {
                body: (agent.needsUser.kind || "wait") + " in " + projectLabel(snapshot.projectRoot),
                tag: key
              });
            } else if (!entry.escalated && Number.isFinite(waitAgeMs) && waitAgeMs > STALE_WAIT_ESCALATION_MS) {
              entry.escalated = true;
              new Notification("Still waiting " + formatHealthAge(waitAgeMs) + ": " + (agent.label || "agent"), {
                body: (agent.needsUser.kind || "wait") + " in " + projectLabel(snapshot.projectRoot),
                tag: key + "::stale"
              });
            }
          }
        }
      }

      document.body.addEventListener("click", (event) => {
        const target = event.target instanceof HTMLElement ? event.target.closest("[data-action]") : null;
        if (!(target instanceof HTMLElement)) return;
        if (target.dataset.action === "search-overlap") {
          const input = document.getElementById("session-filter-input");
          if (input) {
            input.value = target.dataset.query || "";
            state.sessionFilter = { query: input.value, lens: "all" };
            const lensSelect = document.getElementById("session-filter-lens");
            if (lensSelect) lensSelect.value = "all";
            render();
          }
          return;
        }
        if (target.dataset.action === "toggle-desktop-notifications") {
          if (typeof Notification === "undefined") return;
          if (localStorage.getItem(DESKTOP_NOTIFY_PREF_KEY) === "on") {
            localStorage.setItem(DESKTOP_NOTIFY_PREF_KEY, "off");
          } else {
            localStorage.setItem(DESKTOP_NOTIFY_PREF_KEY, "on");
            if (Notification.permission === "default") {
              void Notification.requestPermission();
            }
          }
          if (state.coverageOpen) setCoverageOpen(true);
        }
      });
`;
