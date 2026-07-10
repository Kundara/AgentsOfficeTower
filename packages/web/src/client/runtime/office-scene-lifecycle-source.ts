export const CLIENT_RUNTIME_OFFICE_SCENE_LIFECYCLE_SOURCE = `
      function recentActivitySceneToken(snapshot) {
        const now = Date.now();
        return (snapshot.events || [])
          .filter((event) => {
            const cue = activityCueForEvent(event);
            if (!cue) {
              return false;
            }
            const createdAtMs = Date.parse(event.createdAt || "");
            const durationMs = activityCueDurationMs(cue.mode);
            return Number.isFinite(createdAtMs)
              && now - createdAtMs <= durationMs
              && createdAtMs <= now + ACTIVITY_CUE_MAX_AGE_MS;
          })
          .map(eventSnapshotToken)
          .join("||");
      }

      function officeSceneInteractionToken(snapshot) {
        const opened = state.openAgentThread && state.openAgentThread.projectRoot === snapshot.projectRoot
          ? ["open", state.openAgentThread.threadId].join(":")
          : "";
        const closing = state.closingAgentThread && state.closingAgentThread.projectRoot === snapshot.projectRoot
          ? ["closing", state.closingAgentThread.threadId].join(":")
          : "";
        const replyIntents = (snapshot.agents || [])
          .filter((agent) => hasReplyThreadWorkIntent(agent))
          .map((agent) => agent.threadId || "")
          .filter(Boolean)
          .sort()
          .join(",");
        return [opened, closing, replyIntents].join("|");
      }

      function officeSceneRenderToken(snapshot, options = {}) {
        return [
          snapshot.projectRoot,
          roomsSnapshotToken(snapshot.rooms),
          sceneSnapshotToken(snapshot),
          furnitureLayoutOverrideToken(snapshot.projectRoot),
          recentActivitySceneToken(snapshot),
          officeSceneInteractionToken(snapshot),
          scenePaletteToken(snapshot),
          options.compact ? "compact" : "wide",
          options.focusMode ? "focus" : "normal",
          options.liveOnly ? "live" : "all",
          typeof officeWallDashboardSceneToken === "function" ? officeWallDashboardSceneToken(snapshot) : ""
        ].join("::");
      }

      function scheduleOfficeSceneViewportSync() {
        if (officeSceneViewportSyncQueued || state.view !== "map" || latestOfficeMapProjects.length === 0) {
          return;
        }
        officeSceneViewportSyncQueued = true;
        window.requestAnimationFrame(() => {
          officeSceneViewportSyncQueued = false;
          if (state.view === "map" && latestOfficeMapProjects.length > 0) {
            void syncOfficeMapScenes(latestOfficeMapProjects, latestFloatingHermesProjects, { viewportOnly: true });
          }
        });
      }

      async function syncOfficeMapScenes(projects, floatingProjects = null, options = {}) {
  const assignedRects = new Map(lastHermesAssignedScreenRects);
  snapshotHermesAssignedScreenRects().forEach((rect, key) => {
    rememberHermesAssignedRect(assignedRects, key, rect);
  });
  cleanupOfficeRenderers();
  latestOfficeMapProjects = Array.isArray(projects) ? projects : [];
  if (Array.isArray(floatingProjects)) {
    latestFloatingHermesProjects = floatingProjects;
  } else if (latestFloatingHermesProjects.length === 0) {
    latestFloatingHermesProjects = latestOfficeMapProjects;
  }
  for (const host of Array.from(document.querySelectorAll("[data-office-map-host]"))) {
    if (!(host instanceof HTMLElement)) {
      continue;
    }
    const projectRoot = host.dataset.projectRoot || "";
    const snapshot = projects.find((project) => project.projectRoot === projectRoot);
    if (!snapshot) {
      continue;
    }
    const compact = host.dataset.compact === "1";
    const focusMode = host.dataset.focusMode === "1";
    const renderer = await ensureOfficeRenderer(host);
    if (!renderer) {
      continue;
    }
    const model = buildOfficeSceneModel(snapshot, {
      compact,
      focusMode,
      liveOnly: state.activeOnly
    });
    if (!model) {
      continue;
    }
    try {
      const renderToken = officeSceneRenderToken(snapshot, {
        compact,
        focusMode,
        liveOnly: state.activeOnly
      });
      if (renderer.sceneRenderToken !== renderToken) {
        await ensureOfficeSceneAssets(model);
        if (syncOfficeRendererScene(renderer, model)) {
          renderer.sceneRenderToken = renderToken;
        }
      } else {
        renderer.model = model;
        syncOfficeAnchors(renderer, model, renderer.scale || 1);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
          console.error("office scene render failed", {
            projectRoot,
            compact,
            focusMode,
            message,
            modelSummary: {
              rooms: model.rooms.length,
              wallDashboards: (model.wallDashboards || []).length,
              tileObjects: model.tileObjects.length,
              desks: model.desks.length,
              offices: model.offices.length,
          recAgents: model.recAgents.length
        }
      });
    }
  }
  const activeFloatingHermesKeys = syncFloatingHermesAgents(latestFloatingHermesProjects.length > 0 ? latestFloatingHermesProjects : latestOfficeMapProjects, {
    assignedRects
  }) || new Set();
  spawnHermesAssignedTransferGhosts(assignedRects, latestOfficeMapProjects, activeFloatingHermesKeys, options || {});
  lastHermesAssignedScreenRects = snapshotHermesAssignedScreenRects();
}

function focusKeysIntersect(keys, focusedKeys) {
        return Array.isArray(keys) && keys.some((key) => focusedKeys.has(String(key)));
      }

      function applyOfficeRendererFocus(renderer) {
        if (!renderer || !Array.isArray(renderer.focusables)) {
          return;
        }
        const focusedKeys = new Set(state.focusedSessionKeys);
        const hasFocus = focusedKeys.size > 0;
        renderer.focusables.forEach((entry) => {
          const match = !hasFocus || focusKeysIntersect(entry.keys, focusedKeys);
          entry.nodes.forEach((nodeEntry) => {
            if (!nodeEntry || !nodeEntry.node) {
              return;
            }
            nodeEntry.node.alpha = match ? nodeEntry.baseAlpha : Math.max(0.18, nodeEntry.baseAlpha * 0.45);
          });
        });
        const hoveredRelationshipBossKey = typeof state.hoveredRelationshipBossKey === "string"
          ? state.hoveredRelationshipBossKey
          : "";
        (Array.isArray(renderer.relationshipLineEntries) ? renderer.relationshipLineEntries : []).forEach((entry) => {
          const visible = hoveredRelationshipBossKey.length > 0 && entry && entry.bossKey === hoveredRelationshipBossKey;
          (Array.isArray(entry?.nodes) ? entry.nodes : []).forEach((nodeEntry) => {
            if (!nodeEntry || !nodeEntry.node) {
              return;
            }
            nodeEntry.node.visible = visible;
            nodeEntry.node.alpha = visible ? nodeEntry.baseAlpha : 0;
          });
        });
      }

      function applyOfficeRendererFocusAll() {
        officeSceneRenderers.forEach((renderer) => applyOfficeRendererFocus(renderer));
      }

      function rendererForHost(host) {
        if (!(host instanceof HTMLElement)) {
          return null;
        }
        return officeSceneRenderers.get(host.dataset.officeMapHost || "") || null;
      }
`;
