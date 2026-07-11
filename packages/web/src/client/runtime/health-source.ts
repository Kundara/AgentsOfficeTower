export const CLIENT_RUNTIME_HEALTH_SOURCE = `      const SNAPSHOT_STALE_AFTER_CLIENT_MS = 2 * 60 * 1000;
      const HEALTH_STATUS_SEVERITY = { ready: 0, unconfigured: 1, degraded: 2, error: 3 };

      function snapshotAgeMsClient(snapshot, nowMs = Date.now()) {
        const generatedMs = Date.parse(snapshot && snapshot.generatedAt ? snapshot.generatedAt : "");
        return Number.isFinite(generatedMs) ? Math.max(0, nowMs - generatedMs) : Number.POSITIVE_INFINITY;
      }

      function snapshotIsStale(snapshot, nowMs = Date.now()) {
        return snapshotAgeMsClient(snapshot, nowMs) > SNAPSHOT_STALE_AFTER_CLIENT_MS;
      }

      function snapshotHasDegradedProvider(snapshot) {
        return Array.isArray(snapshot && snapshot.providerHealth)
          && snapshot.providerHealth.some((row) => row.status === "degraded" || row.status === "error");
      }

      function providerHealthRollup(projects) {
        const rollups = new Map();
        for (const snapshot of projects) {
          for (const row of Array.isArray(snapshot.providerHealth) ? snapshot.providerHealth : []) {
            const existing = rollups.get(row.adapterId);
            if (!existing) {
              rollups.set(row.adapterId, Object.assign({}, row, {
                degradedProjects: row.status === "degraded" || row.status === "error" ? 1 : 0
              }));
              continue;
            }
            if (row.status === "degraded" || row.status === "error") {
              existing.degradedProjects += 1;
            }
            if ((HEALTH_STATUS_SEVERITY[row.status] || 0) > (HEALTH_STATUS_SEVERITY[existing.status] || 0)) {
              existing.status = row.status;
              existing.detail = row.detail;
            }
          }
        }
        return Array.from(rollups.values()).sort((left, right) => left.adapterId.localeCompare(right.adapterId));
      }

      function fleetHealthStatusClient(projects, nowMs = Date.now()) {
        if (!Array.isArray(projects) || projects.length === 0) {
          return "starting";
        }
        if (projects.some((snapshot) => snapshotIsStale(snapshot, nowMs))) {
          return "stale";
        }
        if (projects.some((snapshot) => snapshotHasDegradedProvider(snapshot))) {
          return "degraded";
        }
        return "healthy";
      }

      function formatHealthAge(ageMs) {
        if (!Number.isFinite(ageMs)) return "unknown";
        const seconds = Math.round(ageMs / 1000);
        if (seconds < 60) return seconds + "s";
        const minutes = Math.round(seconds / 60);
        if (minutes < 60) return minutes + "m";
        return Math.round(minutes / 60) + "h";
      }

      function renderHeroSummary(counts) {
        const health = state.fleetHealth || "healthy";
        const chips = [
          ["Agents", counts.total, "primary", true],
          ["Active", counts.active, "is-active", true],
          ["Waiting", counts.waiting, "is-waiting", counts.waiting > 0],
          ["Blocked", counts.blocked, "is-blocked", counts.blocked > 0],
          ["Cloud", counts.cloud, "is-cloud", counts.cloud > 0]
        ].filter(([, , , visible]) => visible).map(([label, value, className]) =>
          \`<span class="hero-summary-item \${className}"><strong>\${value}</strong><span>\${label}</span></span>\`
        );
        chips.push(
          \`<button class="hero-summary-item hero-health is-\${health}" type="button" data-action="toggle-coverage" aria-haspopup="dialog" aria-expanded="\${state.coverageOpen ? "true" : "false"}" aria-controls="coverage-popup" title="Fleet coverage: \${health}. Open the coverage drawer."><strong>\${health}</strong><span>Coverage</span></button>\`
        );
        return chips.join("");
      }

      function providerRowTone(status) {
        return status === "error" ? "is-error"
          : status === "degraded" ? "is-degraded"
          : status === "unconfigured" ? "is-unconfigured"
          : "is-ready";
      }

      function renderCoveragePopupBody(projects, nowMs = Date.now()) {
        const status = fleetHealthStatusClient(projects, nowMs);
        const rollup = providerHealthRollup(projects);
        const staleProjects = projects.filter((snapshot) => snapshotIsStale(snapshot, nowMs));
        const providerRows = rollup.length === 0
          ? '<div class="muted">No provider health reported yet.</div>'
          : rollup.map((row) =>
            \`<div class="coverage-provider \${providerRowTone(row.status)}"><span class="coverage-provider-status">\${escapeHtml(row.status)}</span><span class="coverage-provider-name">\${escapeHtml(row.adapterId)}</span>\${row.detail && row.status !== "ready" ? \`<span class="coverage-provider-detail muted">\${escapeHtml(row.detail)}</span>\` : ""}</div>\`
          ).join("");
        const staleRows = staleProjects.length === 0
          ? ""
          : \`<div class="settings-section"><strong>Stale floors</strong>\${staleProjects.map((snapshot) =>
              \`<div class="coverage-stale-row"><span>\${escapeHtml(projectLabel(snapshot.projectRoot))}</span><span class="muted">updated \${formatHealthAge(snapshotAgeMsClient(snapshot, nowMs))} ago</span></div>\`
            ).join("")}</div>\`;
        const notes = Array.from(new Set(projects.flatMap((snapshot) => Array.isArray(snapshot.notes) ? snapshot.notes : []))).slice(0, 6);
        const noteRows = notes.length === 0
          ? ""
          : \`<div class="settings-section"><strong>What might be missing</strong>\${notes.map((note) =>
              \`<div class="coverage-note muted">! \${escapeHtml(note)}</div>\`
            ).join("")}</div>\`;
        return \`<div class="coverage-fleet-status is-\${status}">Fleet visibility: <strong>\${status}</strong></div><div class="settings-section"><strong>Providers</strong>\${providerRows}</div>\${staleRows}\${noteRows}\`;
      }

      function coveragePopupElements() {
        return {
          popup: document.getElementById("coverage-popup"),
          body: document.getElementById("coverage-popup-body")
        };
      }

      function setCoverageOpen(open) {
        state.coverageOpen = open === true;
        const { popup, body } = coveragePopupElements();
        if (!popup || !body) return;
        if (state.coverageOpen) {
          body.innerHTML = renderCoveragePopupBody(state.healthProjects || []);
          popup.removeAttribute("hidden");
        } else {
          popup.setAttribute("hidden", "");
        }
        const chip = document.querySelector('[data-action="toggle-coverage"]');
        if (chip) chip.setAttribute("aria-expanded", state.coverageOpen ? "true" : "false");
      }

      function updateHealthSurfaces(projects) {
        state.healthProjects = projects;
        state.fleetHealth = fleetHealthStatusClient(projects);
        if (state.coverageOpen) {
          const { body } = coveragePopupElements();
          if (body) {
            setHtmlIfChanged(body, renderCoveragePopupBody(projects));
          }
        }
      }

      function floorHealthChipEntries(snapshot, nowMs = Date.now()) {
        const entries = [];
        if (snapshotIsStale(snapshot, nowMs)) {
          entries.push(["is-stale", "stale " + formatHealthAge(snapshotAgeMsClient(snapshot, nowMs))]);
        } else if (snapshotHasDegradedProvider(snapshot)) {
          entries.push(["is-degraded", "degraded"]);
        }
        return entries;
      }

      function sessionSnapshotStaleBadge(snapshot) {
        if (!snapshotIsStale(snapshot)) return "";
        return \`<span class="session-card-stale" title="This project's snapshot has not refreshed for \${escapeHtml(formatHealthAge(snapshotAgeMsClient(snapshot)))}">stale \${escapeHtml(formatHealthAge(snapshotAgeMsClient(snapshot)))}</span>\`;
      }
`;
