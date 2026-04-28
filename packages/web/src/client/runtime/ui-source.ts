export const CLIENT_RUNTIME_UI_SOURCE = `      function renderSessions(snapshot) {
        if (!snapshot || snapshot.agents.length === 0) {
          return '<div class="empty">No live or recent lead sessions in the selected workspace right now.</div>';
        }

        const sorted = [...snapshot.agents].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
        return renderNeedsAttention([snapshot]) + sorted.map((agent) => {
          const appearanceProjectRoot = agent.sourceProjectRoot || snapshot.projectRoot;
          const appearanceAgentId = agent.sourceAgentId || agent.id;
          const replyProjectRoot = replyActionProjectRoot(snapshot, agent);
          const title = displayAgentLabel(snapshot, agent);
          const replyAction = replyProjectRoot
            ? \`<button data-action="open-reply-composer" data-project-root="\${escapeHtml(replyProjectRoot)}" data-thread-id="\${escapeHtml(agent.threadId)}">Reply</button>\`
            : "";
          const appearanceAction = agent.network
            ? ""
            : \`<button data-action="cycle-look" data-project-root="\${escapeHtml(appearanceProjectRoot)}" data-agent-id="\${escapeHtml(appearanceAgentId)}">Cycle look</button>\`;
          const cardActions = [replyAction, appearanceAction].filter(Boolean).join("");
          const focusKeys = escapeHtml(JSON.stringify(collectFocusedSessionKeys(snapshot, agent)));
          const description = normalizeDisplayText(snapshot.projectRoot, agent.detail)
            || latestAgentMessage(snapshot.projectRoot, agent)
            || \`[\${agent.state}]\`;
          const sourceLabel = agentNetworkLabel(agent);
          const fullDescription = sourceLabel ? \`\${sourceLabel} · \${description}\` : description;
          return \`<article class="session-card" tabindex="0" data-focus-keys="\${focusKeys}"><div class="session-card-header"><strong class="session-card-title">\${escapeHtml(title)}</strong><div class="card-actions">\${cardActions}</div></div><div class="muted session-card-description" title="\${escapeHtml(fullDescription)}">\${escapeHtml(fullDescription)}</div>\${renderReplyComposer(snapshot, agent)}</article>\`;
        }).join("");
      }

      function findReplyThreadEntry(projectRoot, threadId) {
        if (!state.fleet || !projectRoot || !threadId) {
          return null;
        }
        const projects = Array.isArray(state.fleet.projects) ? state.fleet.projects : [];
        for (const snapshot of projects) {
          const agent = Array.isArray(snapshot.agents)
            ? snapshot.agents.find((candidate) =>
              candidate
              && candidate.threadId === threadId
              && replyActionProjectRoot(snapshot, candidate) === projectRoot
            )
            : null;
          if (agent) {
            return { snapshot, agent };
          }
        }
        return null;
      }

      function findThreadViewEntry(projectRoot, threadId) {
        if (!state.fleet || !projectRoot || !threadId) {
          return null;
        }
        const projects = Array.isArray(state.fleet.projects) ? state.fleet.projects : [];
        for (const snapshot of projects) {
          const agent = Array.isArray(snapshot.agents)
            ? snapshot.agents.find((candidate) =>
              candidate
              && candidate.threadId === threadId
              && threadViewProjectRoot(snapshot, candidate) === projectRoot
            )
            : null;
          if (agent) {
            return { snapshot, agent };
          }
        }
        return null;
      }

      function agentThreadPanelMatches(snapshot, agent) {
        if (!state.openAgentThread || !snapshot || !agent || !agent.threadId) {
          return false;
        }
        const projectRoot = threadViewProjectRoot(snapshot, agent);
        if (!projectRoot) {
          return false;
        }
        return (
          state.openAgentThread.projectRoot === projectRoot
          && state.openAgentThread.threadId === agent.threadId
        );
      }

      function focusReplyComposer(projectRoot, threadId) {
        requestAnimationFrame(() => {
          const textarea = document.querySelector(
            \`textarea[data-reply-project-root="\${CSS.escape(projectRoot || "")}"][data-reply-thread-id="\${CSS.escape(threadId || "")}"]\`
          );
          if (textarea instanceof HTMLTextAreaElement) {
            textarea.focus();
            textarea.selectionStart = textarea.value.length;
            textarea.selectionEnd = textarea.value.length;
          }
        });
      }

      function openReplyComposer(projectRoot, threadId, options = {}) {
        const previousDraft =
          state.replyComposer
          && state.replyComposer.projectRoot === projectRoot
          && state.replyComposer.threadId === threadId
            ? state.replyComposer.draft
            : "";
        state.replyComposer = {
          projectRoot,
          threadId,
          draft: previousDraft || "",
          pending: false,
          error: null
        };
        render();
        if (options.focus !== false) {
          focusReplyComposer(projectRoot, threadId);
        }
      }

      function replyThreadWorkIntentKey(threadId) {
        return String(threadId || "");
      }

      function markReplyThreadWorkIntent(threadId, ttlMs = 12000) {
        const key = replyThreadWorkIntentKey(threadId);
        if (!key) {
          return;
        }
        state.replyThreadWorkIntents = {
          ...(state.replyThreadWorkIntents || {}),
          [key]: Date.now() + ttlMs
        };
      }

      function toggleThreadEntryExpanded(stateKey) {
        const key = String(stateKey || "");
        if (!key) {
          return;
        }
        state.expandedThreadEntries = {
          ...(state.expandedThreadEntries || {}),
          [key]: !Boolean(state.expandedThreadEntries && state.expandedThreadEntries[key])
        };
        render();
      }

      function closeAgentThread(projectRoot = null, threadId = null) {
        if (
          !state.openAgentThread
          || (
            projectRoot
            && threadId
            && (
              state.openAgentThread.projectRoot !== projectRoot
              || state.openAgentThread.threadId !== threadId
            )
          )
        ) {
          return;
        }
        const closingThread = state.openAgentThread;
        state.openAgentThread = null;
        state.closingAgentThread = closingThread;
        window.setTimeout(() => {
          if (
            state.closingAgentThread
            && state.closingAgentThread.projectRoot === closingThread.projectRoot
            && state.closingAgentThread.threadId === closingThread.threadId
          ) {
            state.closingAgentThread = null;
            render();
          }
        }, 180);
        if (
          state.replyComposer
          && (
            !projectRoot
            || !threadId
            || (
              state.replyComposer.projectRoot === projectRoot
              && state.replyComposer.threadId === threadId
            )
          )
        ) {
          state.replyComposer = null;
        }
        render();
      }

      function openAgentThread(projectRoot, threadId) {
        const entry = findThreadViewEntry(projectRoot, threadId);
        if (!entry) {
          return;
        }
        state.closingAgentThread = null;
        if (
          state.openAgentThread
          && state.openAgentThread.projectRoot === projectRoot
          && state.openAgentThread.threadId === threadId
        ) {
          render();
          return;
        }
        state.openAgentThread = {
          projectRoot,
          threadId
        };
        render();
      }

      function replyActionProjectRoot(snapshot, agent) {
        if (!agent || !agent.threadId) {
          return null;
        }
        if (agent.network || agent.provenance !== "codex" || agent.source !== "local") {
          return null;
        }
        if (agent.sourceKind !== "appServer") {
          return null;
        }
        return threadViewProjectRoot(snapshot, agent);
      }

      function threadViewProjectRoot(snapshot, agent) {
        if (!agent || !agent.threadId) {
          return null;
        }
        if (agent.network || agent.provenance !== "codex" || agent.source !== "local") {
          return null;
        }
        const preferredRoot = agent.sourceProjectRoot || snapshot.projectRoot;
        const localRoots = localProjectRootsForSnapshot(snapshot);
        if (localRoots.includes(preferredRoot)) {
          return preferredRoot;
        }
        return localRoots[0] || preferredRoot;
      }

      function replyComposerMatches(snapshot, agent) {
        if (!state.replyComposer || !agent || !agent.threadId) {
          return false;
        }
        const projectRoot = replyActionProjectRoot(snapshot, agent);
        if (
          agent.needsUser
          && agent.needsUser.kind === "input"
          && (!Array.isArray(agent.needsUser.questions) || agent.needsUser.questions.length === 0)
        ) {
          return false;
        }
        return replyComposerMatchesThread(projectRoot, agent.threadId);
      }

      function replyComposerMatchesThread(projectRoot, threadId) {
        if (!state.replyComposer || !projectRoot || !threadId) {
          return false;
        }
        return Boolean(
          state.replyComposer.projectRoot === projectRoot
          && state.replyComposer.threadId === threadId
        );
      }

      function renderReplyComposer(snapshot, agent) {
        const projectRoot = replyActionProjectRoot(snapshot, agent);
        if (!replyComposerMatches(snapshot, agent) || !projectRoot) {
          return "";
        }
        return renderReplyComposerForThread(projectRoot, agent.threadId, "Send a follow-up to this session...");
      }

      function renderReplyComposerForThread(projectRoot, threadId, placeholder = "Send a follow-up to this session...") {
        if (!replyComposerMatchesThread(projectRoot, threadId)) {
          return "";
        }
        const composer = state.replyComposer;
        const disabled = composer.pending === true;
        const errorHtml = composer.error
          ? \`<div class="chat-composer-error">\${escapeHtml(composer.error)}</div>\`
          : "";
        const hasText = Boolean(String(composer.draft || "").trim());
        return \`<form class="chat-composer" data-chat-composer="reply"><textarea class="chat-composer-field" rows="2" data-reply-project-root="\${escapeHtml(composer.projectRoot)}" data-reply-thread-id="\${escapeHtml(composer.threadId)}" placeholder="\${escapeHtml(placeholder)}"\${disabled ? " disabled" : ""}>\${escapeHtml(composer.draft || "")}</textarea><div class="chat-composer-toolbar"><div class="chat-composer-state">\${escapeHtml(disabled ? "Sending" : (hasText ? "Ready" : "Draft"))}</div><div class="chat-composer-actions"><button type="button" data-action="cancel-reply-composer" data-project-root="\${escapeHtml(composer.projectRoot)}" data-thread-id="\${escapeHtml(composer.threadId)}"\${disabled ? " disabled" : ""}>Cancel</button><button type="button" class="primary-action" data-action="submit-reply-composer" data-project-root="\${escapeHtml(composer.projectRoot)}" data-thread-id="\${escapeHtml(composer.threadId)}"\${disabled || !hasText ? " disabled" : ""}>\${escapeHtml(disabled ? "Sending..." : "Send")}</button></div></div>\${errorHtml}</form>\`;
      }

      function renderFleetSessions(projects) {
        const entries = projects.flatMap((snapshot) =>
          snapshot.agents.map((agent) => ({ snapshot, agent }))
        );

        if (entries.length === 0) {
          return '<div class="empty">No live or recent lead sessions across the tracked workspaces right now.</div>';
        }

        entries.sort((left, right) => right.agent.updatedAt.localeCompare(left.agent.updatedAt));
        return renderNeedsAttention(projects) + entries.map(({ snapshot, agent }) => {
          const appearanceProjectRoot = agent.sourceProjectRoot || snapshot.projectRoot;
          const appearanceAgentId = agent.sourceAgentId || agent.id;
          const replyProjectRoot = replyActionProjectRoot(snapshot, agent);
          const title = displayAgentLabel(snapshot, agent);
          const replyAction = replyProjectRoot
            ? \`<button data-action="open-reply-composer" data-project-root="\${escapeHtml(replyProjectRoot)}" data-thread-id="\${escapeHtml(agent.threadId)}">Reply</button>\`
            : "";
          const appearanceAction = agent.network
            ? ""
            : \`<button data-action="cycle-look" data-project-root="\${escapeHtml(appearanceProjectRoot)}" data-agent-id="\${escapeHtml(appearanceAgentId)}">Cycle look</button>\`;
          const cardActions = [replyAction, appearanceAction].filter(Boolean).join("");
          const focusKeys = escapeHtml(JSON.stringify(collectFocusedSessionKeys(snapshot, agent)));
          const detail = normalizeDisplayText(snapshot.projectRoot, agent.detail)
            || latestAgentMessage(snapshot.projectRoot, agent)
            || \`[\${agent.state}]\`;
          const sourceLabel = agentNetworkLabel(agent);
          const description = projectLabel(snapshot.projectRoot) + " · " + (sourceLabel ? sourceLabel + " · " : "") + detail;
          return \`<article class="session-card" tabindex="0" data-focus-keys="\${focusKeys}"><div class="session-card-header"><strong class="session-card-title">\${escapeHtml(title)}</strong><div class="card-actions">\${cardActions}</div></div><div class="muted session-card-description" title="\${escapeHtml(description)}">\${escapeHtml(description)}</div>\${renderReplyComposer(snapshot, agent)}</article>\`;
        }).join("");
      }

      function applySessionFocus() {
        const focusedKeys = new Set(state.focusedSessionKeys);
        const hasFocus = focusedKeys.size > 0;
        const hoveredRelationshipBossKey = typeof state.hoveredRelationshipBossKey === "string"
          ? state.hoveredRelationshipBossKey
          : "";
        document.querySelectorAll("[data-scene-grid]").forEach((grid) => {
          if (!(grid instanceof HTMLElement)) {
            return;
          }
          if (hasFocus) {
            grid.dataset.focusActive = "true";
          } else {
            delete grid.dataset.focusActive;
          }
        });
        document.querySelectorAll("[data-focus-agent]").forEach((element) => {
          if (!(element instanceof HTMLElement)) {
            return;
          }
          element.classList.toggle("is-focused", hasFocus && focusedKeys.has(element.dataset.focusKey || ""));
        });
        document.querySelectorAll("[data-focus-line]").forEach((element) => {
          if (!(element instanceof SVGElement)) {
            return;
          }
          element.classList.toggle(
            "is-focused",
            hoveredRelationshipBossKey.length > 0 && hoveredRelationshipBossKey === (element.dataset.focusBossKey || "")
          );
        });
        applyOfficeRendererFocusAll();
      }

      function setSessionFocusFromElement(element) {
        if (!(element instanceof HTMLElement)) {
          state.focusedSessionKeys = [];
          state.hoveredRelationshipBossKey = null;
          applySessionFocus();
          return;
        }
        try {
          const parsed = JSON.parse(element.dataset.focusKeys || "[]");
          state.focusedSessionKeys = Array.isArray(parsed) ? parsed.map((value) => String(value)) : [];
        } catch {
          state.focusedSessionKeys = [];
        }
        state.hoveredRelationshipBossKey = (
          element.dataset.focusAgent === "true"
          && typeof element.dataset.focusKey === "string"
          && element.dataset.focusKey.length > 0
          && state.focusedSessionKeys.length > 1
        )
          ? element.dataset.focusKey
          : null;
        applySessionFocus();
      }

      function syncSessionFocusFromDom() {
        const activeSceneAgent = document.querySelector("[data-focus-agent]:focus-within, [data-focus-agent]:hover");
        if (activeSceneAgent instanceof HTMLElement) {
          setSessionFocusFromElement(activeSceneAgent);
          return;
        }
        const activeCard = document.querySelector(".session-card:focus-within, .session-card:hover");
        if (activeCard instanceof HTMLElement) {
          setSessionFocusFromElement(activeCard);
          return;
        }
        state.focusedSessionKeys = [];
        applySessionFocus();
      }

      function syncLiveAgentState(projects) {
        const now = Date.now();
        const previousKeys = new Set(liveAgentMemory.keys());
        const nextMemory = new Map();

        for (const snapshot of projects) {
          for (const agent of snapshot.agents) {
            const key = agentKey(snapshot.projectRoot, agent);
            nextMemory.set(key, {
              key,
              projectRoot: snapshot.projectRoot,
              roomId: agent.roomId,
              agent
            });
          }
        }

        for (const snapshot of projects) {
          if (!snapshot || !snapshot.projectRoot) {
            continue;
          }
          const previousProjectAgentCount = [...liveAgentMemory.values()]
            .filter((entry) => entry.projectRoot === snapshot.projectRoot)
            .length;
          if (previousProjectAgentCount > 0 || (snapshot.agents || []).length > 0) {
            markProjectHydrated(snapshot.projectRoot, now);
          }
        }

        enteringAgentKeys = previousKeys.size === 0 || screenshotMode
          ? new Set()
          : new Set(
              [...nextMemory.keys()].filter((key) => {
                if (previousKeys.has(key)) {
                  return false;
                }
                const entry = nextMemory.get(key) || null;
                return !(entry && agentLooksHistoricallyHydrated(entry.projectRoot, entry.agent));
              })
            );

        for (const [key, entry] of liveAgentMemory.entries()) {
          if (!nextMemory.has(key)) {
            const sceneState = renderedAgentSceneState.get(key) || null;
            if (!sceneState) {
              continue;
            }
            const existingGhost = departingAgents.find((ghost) => ghost.key === key) || null;
            if (existingGhost) {
              existingGhost.projectRoot = entry.projectRoot;
              existingGhost.roomId = entry.roomId;
              existingGhost.agent = entry.agent;
              existingGhost.sceneState = sceneState;
              existingGhost.expiresAt = now + departingAgentTtlMs(entry.agent);
              continue;
            }
            departingAgents.push({
              ...entry,
              sceneState,
              expiresAt: now + departingAgentTtlMs(entry.agent)
            });
          }
        }

        departingAgents = departingAgents.filter((ghost) => ghost.expiresAt > now && !nextMemory.has(ghost.key));
        liveAgentMemory.clear();
        for (const [key, entry] of nextMemory.entries()) {
          liveAgentMemory.set(key, entry);
        }
      }

      function fitScenes() {
        const wrappers = document.querySelectorAll("[data-scene-fit]");
        const canZoom = typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("zoom", "1");
        wrappers.forEach((wrapper) => {
          const grid = wrapper.querySelector("[data-scene-grid]");
          if (!(wrapper instanceof HTMLElement) || !(grid instanceof HTMLElement)) {
            return;
          }

          const rawWidth = Number.parseFloat(grid.style.width || "0");
          const rawHeight = Number.parseFloat(grid.style.height || "0");
          if (!rawWidth || !rawHeight) {
            return;
          }

          const focusMode = wrapper.dataset.sceneMode === "focus";
          const towerMode = wrapper.closest(".tower-floor-body") instanceof HTMLElement;
          const availableWidth = Math.max(wrapper.clientWidth - (focusMode ? 0 : 4), 1);
          const wrapperRect = wrapper.getBoundingClientRect();
          const viewportRemaining = Math.max(window.innerHeight - wrapperRect.top - (focusMode ? 0 : 20), 1);
          const availableHeight = focusMode
            ? Math.max(wrapper.clientHeight || viewportRemaining, 1)
            : Math.max(
              Math.min(
                viewportRemaining,
                window.innerHeight * (
                  towerMode
                    ? (wrapper.classList.contains("compact") ? 0.52 : 0.72)
                    : (wrapper.classList.contains("compact") ? 0.34 : 0.68)
                )
              ),
              wrapper.classList.contains("compact")
                ? (towerMode ? 240 : 180)
                : 220
            );
          if (focusMode) {
            const coverScale = Math.max(availableWidth / rawWidth, availableHeight / rawHeight);
            const boundedCoverScale = Number.isFinite(coverScale) && coverScale > 0
              ? Math.min(Math.max(coverScale, 0.2), 6)
              : 1;

            wrapper.style.height = \`\${Math.max(1, Math.round(availableHeight))}px\`;
            grid.style.zoom = "";
            grid.style.transform = \`translate(-50%, -50%) scale(\${boundedCoverScale})\`;
            wrapper.dataset.sceneFitted = "true";
            return;
          }

          if (towerMode) {
            const scale = availableWidth / rawWidth;
            const boundedScale = Number.isFinite(scale) && scale > 0
              ? Math.min(Math.max(scale, 0.2), 3.5)
              : 1;

            wrapper.style.height = \`\${Math.max(220, Math.round(rawHeight * boundedScale))}px\`;
            if (canZoom) {
              grid.style.zoom = String(boundedScale);
              grid.style.transform = "";
            } else {
              grid.style.zoom = "";
              grid.style.transform = \`scale(\${boundedScale})\`;
            }
            wrapper.dataset.sceneFitted = "true";
            return;
          }

          const heightScale = wrapper.classList.contains("compact")
            ? availableHeight / rawHeight
            : Math.max(1, availableHeight / rawHeight);
          const scale = Math.min(availableWidth / rawWidth, heightScale);
          const boundedScale = Number.isFinite(scale) && scale > 0
            ? Math.min(Math.max(scale, 0.2), 3.5)
            : 1;

          wrapper.style.height = \`\${Math.max(160, Math.round(rawHeight * boundedScale))}px\`;
          if (canZoom) {
            grid.style.zoom = String(boundedScale);
            grid.style.transform = "";
          } else {
            grid.style.zoom = "";
            grid.style.transform = \`scale(\${boundedScale})\`;
          }
          wrapper.dataset.sceneFitted = "true";
        });
      }

      const THREAD_REPLY_TIMEOUT_MS = 90000;

      async function postJson(path, payload = {}, timeoutMs = 15000) {
        const controller = typeof AbortController === "function" ? new AbortController() : null;
        const timer = controller
          ? setTimeout(() => controller.abort(), timeoutMs)
          : null;
        let response;
        try {
          response = await fetch(path, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
            signal: controller ? controller.signal : undefined
          });
        } catch (error) {
          if (error && error.name === "AbortError") {
            throw new Error("Request timed out. Try again when the local app-server is responsive.");
          }
          throw error;
        } finally {
          if (timer) {
            clearTimeout(timer);
          }
        }

        if (!response.ok) {
          throw new Error(await response.text());
        }

        return response.json();
      }

      function setNeedsUserRequestError(requestId, message) {
        state.needsUserActionErrorsByRequestId = {
          ...(state.needsUserActionErrorsByRequestId || {}),
          [requestId]: message
        };
      }

      function clearNeedsUserRequestError(requestId) {
        const nextErrors = { ...(state.needsUserActionErrorsByRequestId || {}) };
        delete nextErrors[requestId];
        state.needsUserActionErrorsByRequestId = nextErrors;
      }

      function updateNeedsUserInputDraft(requestId, questionId, patch) {
        const existingRequestDraft = state.needsUserInputDrafts && state.needsUserInputDrafts[requestId]
          ? state.needsUserInputDrafts[requestId]
          : {};
        const existingQuestionDraft = existingRequestDraft && existingRequestDraft[questionId]
          ? existingRequestDraft[questionId]
          : { selected: "", other: "" };
        state.needsUserInputDrafts = {
          ...(state.needsUserInputDrafts || {}),
          [requestId]: {
            ...existingRequestDraft,
            [questionId]: {
              ...existingQuestionDraft,
              ...patch
            }
          }
        };
      }

      function dropNeedsUserInputDraft(requestId) {
        const nextDrafts = { ...(state.needsUserInputDrafts || {}) };
        delete nextDrafts[requestId];
        state.needsUserInputDrafts = nextDrafts;
      }

      function findNeedsUserEntry(requestId) {
        const projects = state.fleet && Array.isArray(state.fleet.projects) ? state.fleet.projects : [];
        for (const snapshot of projects) {
          const agent = Array.isArray(snapshot.agents)
            ? snapshot.agents.find((candidate) => candidate && candidate.needsUser && candidate.needsUser.requestId === requestId)
            : null;
          if (agent && agent.needsUser) {
            return { snapshot, agent, need: agent.needsUser };
          }
        }
        return null;
      }

      function syncReplyComposerSubmitButton(projectRoot, threadId) {
        const button = document.querySelector(
          \`button[data-action="submit-reply-composer"][data-project-root="\${CSS.escape(projectRoot || "")}"][data-thread-id="\${CSS.escape(threadId || "")}"]\`
        );
        if (!(button instanceof HTMLButtonElement) || !state.replyComposer) {
          return;
        }
        button.disabled = state.replyComposer.pending === true || !String(state.replyComposer.draft || "").trim();
      }

      function syncNeedsUserSubmitButton(requestId) {
        const button = document.querySelector(
          \`button[data-action="submit-needs-user-input"][data-request-id="\${CSS.escape(requestId || "")}"]\`
        );
        if (!(button instanceof HTMLButtonElement)) {
          return;
        }
        const entry = findNeedsUserEntry(requestId);
        button.disabled = state.needsUserActionRequestIds.includes(requestId)
          || !entry
          || !entry.need
          || entry.need.kind !== "input"
          || !needsUserInputReady(entry.need);
      }

      async function submitNeedsUserInput(projectRoot, requestId) {
        if (typeof projectRoot !== "string" || projectRoot.length === 0) {
          setNeedsUserRequestError(requestId, "Project root is unavailable for this input request.");
          render();
          return;
        }
        if (state.needsUserActionRequestIds.includes(requestId)) {
          return;
        }

        const entry = findNeedsUserEntry(requestId);
        if (!entry || !entry.need || entry.need.kind !== "input") {
          setNeedsUserRequestError(requestId, "Input request is no longer available.");
          render();
          return;
        }

        const questions = Array.isArray(entry.need.questions) ? entry.need.questions : [];
        const completion = needsUserInputCompletion(entry.need);
        if (completion.missingRequired.length > 0) {
          setNeedsUserRequestError(requestId, completion.missingRequired[0] + " still needs an answer.");
          render();
          return;
        }
        const answers = {};
        for (const [questionIndex, question] of questions.entries()) {
          const draft = needsUserInputDraft(requestId, question.id);
          const values = needsUserInputAnswerValues(question, draft);
          if (values.length === 0) {
            if (question.required === false) {
              continue;
            }
            setNeedsUserRequestError(requestId, needsUserInputQuestionLabel(question, questionIndex) + " still needs an answer.");
            render();
            return;
          }
          answers[question.id] = { answers: values };
        }

        state.needsUserActionRequestIds = [...state.needsUserActionRequestIds, requestId];
        clearNeedsUserRequestError(requestId);
        render();

        try {
          await postJson("/api/needs-user/answer", {
            projectRoot,
            requestId,
            answers
          });
          dropNeedsUserInputDraft(requestId);
          clearNeedsUserRequestError(requestId);
          await refreshFleet();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          setNeedsUserRequestError(requestId, "Needs You action failed: " + message);
        } finally {
          state.needsUserActionRequestIds = state.needsUserActionRequestIds.filter((value) => value !== requestId);
          render();
        }
      }

      async function submitReplyComposer(projectRoot, threadId) {
        if (
          !state.replyComposer
          || state.replyComposer.projectRoot !== projectRoot
          || state.replyComposer.threadId !== threadId
        ) {
          return;
        }
        if (state.replyComposer.pending === true) {
          return;
        }

        const text = String(state.replyComposer.draft || "").trim();
        if (!text) {
          state.replyComposer = {
            ...state.replyComposer,
            error: "Reply text is required."
          };
          render();
          return;
        }

        state.replyComposer = {
          ...state.replyComposer,
          pending: true,
          error: null
        };
        render();

        try {
          await postJson("/api/thread/reply", {
            projectRoot,
            threadId,
            text
          }, THREAD_REPLY_TIMEOUT_MS);
          markReplyThreadWorkIntent(threadId);
          state.replyComposer = null;
          if (
            state.openAgentThread
            && state.openAgentThread.projectRoot === projectRoot
            && state.openAgentThread.threadId === threadId
          ) {
            state.openAgentThread = null;
          }
          state.closingAgentThread = null;
          await refreshFleet();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          state.replyComposer = {
            ...state.replyComposer,
            pending: false,
            error: "Reply failed: " + message
          };
          render();
          return;
        }

        render();
      }

      function setTextIfChanged(element, value) {
        if (!element) {
          return false;
        }
        const next = String(value ?? "");
        if (element.textContent === next) {
          return false;
        }
        element.textContent = next;
        return true;
      }

      function setHtmlIfChanged(element, html, options = {}) {
        if (!element) {
          return false;
        }
        if (element.dataset.renderHtml === html) {
          return false;
        }

        const preserveScroll = options.preserveScroll === true;
        const scrollTop = preserveScroll ? element.scrollTop : 0;
        const scrollLeft = preserveScroll ? element.scrollLeft : 0;
        element.innerHTML = html;
        element.dataset.renderHtml = html;
        if (preserveScroll) {
          element.scrollTop = scrollTop;
          element.scrollLeft = scrollLeft;
        }
        return true;
      }

      function currentSnapshot(projects = null) {
        if (!state.fleet) return null;
        if (state.selected === "all") return null;
        const availableProjects = Array.isArray(projects) ? projects : mergeWorktreeProjects(visibleProjects(state.fleet));
        return availableProjects.find((snapshot) => snapshotMatchesProjectRoot(snapshot, state.selected)) || null;
      }

      function renderHeroSummary(counts) {
        return [
          ["Agents", counts.total, "primary"],
          ["Active", counts.active, "is-active"],
          ["Waiting", counts.waiting, "is-waiting"],
          ["Blocked", counts.blocked, "is-blocked"],
          ["Cloud", counts.cloud, "is-cloud"]
        ].map(([label, value, className]) =>
          \`<span class="hero-summary-item \${className}"><strong>\${value}</strong><span>\${label}</span></span>\`
        ).join("");
      }

      function ingestFleet(fleet) {
        state.localFleet = fleet;
        applyFleet(fleet);
        scheduleMultiplayerBroadcast();
      }

      function render() {
        if (!state.fleet) return;

        const fleet = state.fleet;
        if (
          state.openAgentThread
          && !findThreadViewEntry(state.openAgentThread.projectRoot, state.openAgentThread.threadId)
        ) {
          const staleThread = state.openAgentThread;
          state.openAgentThread = null;
          if (
            state.replyComposer
            && state.replyComposer.projectRoot === staleThread.projectRoot
            && state.replyComposer.threadId === staleThread.threadId
          ) {
            state.replyComposer = null;
          }
        }
        const rawProjects = visibleProjects(fleet);
        const floorProjects = mergeWorktreeProjects(rawProjects);
        const selectableProjects = Boolean(state.globalSceneSettings && state.globalSceneSettings.splitWorktrees)
          ? rawProjects
          : floorProjects;
        const selectedSnapshot = currentSnapshot(selectableProjects);
        if (
          selectedSnapshot
          && state.selected !== "all"
          && state.selected !== selectedSnapshot.projectRoot
        ) {
          state.selected = selectedSnapshot.projectRoot;
          syncUrl();
        }
        const towerProjects = state.selected === "all" ? floorProjects : selectableProjects;
        updateRecentLeadReservations(towerProjects);
        const displayedProjects = towerProjects.map((project) => viewSnapshot(project, SCENE_RECENT_LEAD_LIMIT));
        const sessionProjects = towerProjects.map((project) => viewSessionSnapshot(project, SESSION_RECENT_LEAD_LIMIT));
        const snapshot = selectedSnapshot
          ? viewSnapshot(selectedSnapshot, SCENE_RECENT_LEAD_LIMIT, selectableProjects)
          : null;
        const sessionSnapshot = selectedSnapshot
          ? viewSessionSnapshot(selectedSnapshot, SESSION_RECENT_LEAD_LIMIT, selectableProjects)
          : null;
        if (!snapshot && state.workspaceFullscreen) {
          state.workspaceFullscreen = false;
          syncUrl();
        }
        syncLiveAgentState(snapshot ? [snapshot] : displayedProjects);
        sceneStateDraft = null;
        const counts = fleetCounts({ projects: sessionProjects });
        const nextSceneToken = state.view === "map"
          ? (snapshot
            ? \`project-shell::\${snapshot.projectRoot}::\${state.workspaceFullscreen ? "focus" : "default"}\`
            : \`fleet-shell::\${displayedProjects.map((project) => project.projectRoot).join("||")}\`)
          : (snapshot
            ? \`project::\${sceneSnapshotToken(snapshot)}\`
            : \`fleet::\${displayedProjects.map(sceneSnapshotToken).join("||")}\`);

        setTextIfChanged(stamp, \`Updated \${fleet.generatedAt}\`);
        setTextIfChanged(projectCount, \`\${fleet.projects.length} tracked · \${floorProjects.length} floors · \${displayedProjects.filter((project) => busyCount(project) > 0).length} live · \${SESSION_RECENT_LEAD_LIMIT} recent sessions\`);
        mapViewButton.classList.toggle("active", state.view === "map");
        terminalViewButton.classList.toggle("active", state.view === "terminal");
        setConnection(state.connection);
        rememberVisibleRecentLeads(displayedProjects);
        syncWorkspaceFullscreenUi();
        syncFleetBackdrop();
        syncSkyParallax();
        if (state.view !== "map") {
          cleanupOfficeRenderers();
        }

        setHtmlIfChanged(heroSummary, renderHeroSummary(counts));

        setHtmlIfChanged(projectTabs, [
          \`<button class="project-tab\${state.selected === "all" ? " active" : ""}" data-action="select-project" data-project-root="all">All</button>\`,
          ...selectableProjects.map((project) => {
            const counts = countsForSnapshot(project);
            const activeClass = snapshotMatchesProjectRoot(project, state.selected) ? " active" : "";
            const badge = counts.active;
            return \`<button class="project-tab\${activeClass}" data-action="select-project" data-project-root="\${escapeHtml(project.projectRoot)}" title="\${escapeHtml(project.projectRoot)}">\${escapeHtml(projectLabel(project.projectRoot))} <span class="muted">\${badge}</span></button>\`;
          })
        ].join(""));

        try {
          if (!snapshot) {
            const shouldRenderScene = state.view !== "map" || nextSceneToken !== lastSceneRenderToken;
            const centerChanged = shouldRenderScene
              ? setHtmlIfChanged(centerContent, renderWorkspaceScroll(displayedProjects), { preserveScroll: true })
              : false;
            if (shouldRenderScene) {
              lastSceneRenderToken = nextSceneToken;
            }
            setHtmlIfChanged(sessionList, renderFleetSessions(sessionProjects), { preserveScroll: true });
            setTextIfChanged(centerTitle, "All Workspaces");
            setTextIfChanged(roomsPath, \`Live agents on the floor plus \${SESSION_RECENT_LEAD_LIMIT} recent sessions in the panel across tracked workspaces\`);
            if (centerChanged) {
              fitScenes();
            }
            if (sceneStateDraft) {
              renderedAgentSceneState = sceneStateDraft;
            }
            sceneStateDraft = null;
            syncSessionFocusFromDom();
            syncWorkstationEffects();
            if (state.view === "map") {
              void syncOfficeMapScenes(displayedProjects);
            }
            renderNotifications();
            return;
          }

          setTextIfChanged(centerTitle, projectLabel(snapshot.projectRoot));
          const shouldRenderScene = state.view !== "map" || nextSceneToken !== lastSceneRenderToken;
          const centerChanged = shouldRenderScene
            ? setHtmlIfChanged(
              centerContent,
              state.view === "terminal"
                ? renderTerminalSnapshot(snapshot)
                : \`<div class="workspace-tower workspace-tower-single">\${renderWorkspaceFloor(snapshot, {
                  compact: true,
                  focusMode: state.workspaceFullscreen,
                  action: {
                    type: "toggle-workspace-focus",
                    label: state.workspaceFullscreen ? "Close" : "Expand"
                  }
                })}</div>\`,
              { preserveScroll: true }
            )
            : false;
          if (shouldRenderScene) {
            lastSceneRenderToken = nextSceneToken;
          }
          const sessionsHtml = renderSessions(sessionSnapshot || snapshot);
          setHtmlIfChanged(sessionList, sessionsHtml, { preserveScroll: true });
          setTextIfChanged(
            roomsPath,
            snapshot.rooms.generated
              ? \`Auto rooms · floor shows live agents plus \${SCENE_RECENT_LEAD_LIMIT} recent leads · panel shows \${SESSION_RECENT_LEAD_LIMIT} recent sessions\`
              : \`Saved rooms.xml · floor shows live agents plus \${SCENE_RECENT_LEAD_LIMIT} recent leads · panel shows \${SESSION_RECENT_LEAD_LIMIT} recent sessions\`
          );
          if (centerChanged) {
            fitScenes();
          }
          if (sceneStateDraft) {
            renderedAgentSceneState = sceneStateDraft;
          }
          sceneStateDraft = null;
          syncSessionFocusFromDom();
          syncWorkstationEffects();
          if (state.view === "map") {
            void syncOfficeMapScenes(snapshot ? [snapshot] : displayedProjects);
          }
          renderNotifications();
        } catch (error) {
          console.error("render failed", error);
          const message = error instanceof Error ? error.message : String(error);
          setHtmlIfChanged(centerContent, '<div class="empty">Render failed: ' + escapeHtml(message) + "</div>");
          setHtmlIfChanged(sessionList, '<div class="empty">Render failed: ' + escapeHtml(message) + "</div>");
          setConnection("offline");
          lastSceneRenderToken = null;
          renderedAgentSceneState = new Map();
          sceneStateDraft = null;
          syncWorkstationEffects();
        }
      }

      async function refreshFleet() {
        const response = await fetch("/api/fleet");
        ingestFleet(await response.json());
      }

      function connectEvents() {
        if (events) {
          events.close();
        }

        setConnection("connecting");
        events = new EventSource("/api/events");
        events.addEventListener("open", () => {
          setConnection("live");
        });
        events.addEventListener("fleet", (event) => {
          ingestFleet(JSON.parse(event.data));
          setConnection("live");
        });
        events.addEventListener("error", () => {
          setConnection(navigator.onLine === false ? "offline" : "reconnecting");
        });
      }

      document.body.addEventListener("click", async (event) => {
        const target = event.target instanceof HTMLElement ? event.target.closest("[data-action], [data-view], #workspace-focus-button") : null;
        if (!(target instanceof HTMLElement)) return;

        if (target.dataset.view) {
          setView(target.dataset.view);
          return;
        }

        const action = target.dataset.action;
        if (action === "toggle-settings") {
          setSettingsOpen(!state.settingsOpen);
          return;
        }

        if (action === "close-settings") {
          setSettingsOpen(false);
          return;
        }

        if (action === "select-project" && target.dataset.projectRoot) {
          setSettingsOpen(false);
          setSelection(target.dataset.projectRoot);
          return;
        }

        if (action === "toggle-project-share") {
          try {
            const projectRoots = JSON.parse(target.dataset.projectRoots || "[]");
            const enabled = target.getAttribute("aria-pressed") === "true";
            target.setAttribute("aria-pressed", enabled ? "false" : "true");
            target.classList.toggle("active", !enabled);
            target.title = !enabled ? "Shared with the room" : "Not shared with the room";
            setProjectRootsSharedWithRoom(projectRoots, !enabled);
          } catch {}
          return;
        }

        if (action === "toggle-workspace-focus") {
          toggleWorkspaceFullscreen();
          return;
        }

        if (target === workspaceFocusButton) {
          toggleWorkspaceFullscreen();
          return;
        }

        if (action === "cycle-look" && target.dataset.projectRoot && target.dataset.agentId) {
          await postJson("/api/appearance/cycle", {
            projectRoot: target.dataset.projectRoot,
            agentId: target.dataset.agentId
          });
          return;
        }

        if (action === "open-reply-composer" && target.dataset.projectRoot && target.dataset.threadId) {
          openReplyComposer(target.dataset.projectRoot, target.dataset.threadId);
          return;
        }

        if (action === "open-agent-thread" && target.dataset.projectRoot && target.dataset.threadId) {
          openAgentThread(target.dataset.projectRoot, target.dataset.threadId);
          return;
        }

        if (action === "close-agent-thread") {
          closeAgentThread(target.dataset.projectRoot || null, target.dataset.threadId || null);
          return;
        }

        if (action === "toggle-thread-entry" && target.dataset.threadEntryStateKey) {
          toggleThreadEntryExpanded(target.dataset.threadEntryStateKey);
          return;
        }

        if (action === "cancel-reply-composer" && target.dataset.projectRoot && target.dataset.threadId) {
          if (
            state.replyComposer
            && state.replyComposer.projectRoot === target.dataset.projectRoot
            && state.replyComposer.threadId === target.dataset.threadId
          ) {
            state.replyComposer = null;
            render();
          }
          return;
        }

        if (action === "submit-reply-composer" && target.dataset.projectRoot && target.dataset.threadId) {
          await submitReplyComposer(target.dataset.projectRoot, target.dataset.threadId);
          return;
        }

        if (action === "select-needs-user-option" && target.dataset.needsUserRequestId && target.dataset.needsUserQuestionId) {
          updateNeedsUserInputDraft(target.dataset.needsUserRequestId, target.dataset.needsUserQuestionId, {
            selected: String(target.dataset.answer || "")
          });
          clearNeedsUserRequestError(target.dataset.needsUserRequestId);
          render();
          return;
        }

        if (action === "clear-needs-user-answer" && target.dataset.needsUserRequestId && target.dataset.needsUserQuestionId) {
          updateNeedsUserInputDraft(target.dataset.needsUserRequestId, target.dataset.needsUserQuestionId, {
            selected: "",
            other: ""
          });
          clearNeedsUserRequestError(target.dataset.needsUserRequestId);
          render();
          return;
        }

        if (action === "submit-needs-user-input" && target.dataset.projectRoot && target.dataset.requestId) {
          await submitNeedsUserInput(target.dataset.projectRoot, target.dataset.requestId);
          return;
        }

        if (action === "respond-needs-user" && target.dataset.projectRoot && target.dataset.requestId && target.dataset.decision) {
          const requestId = target.dataset.requestId;
          if (state.needsUserActionRequestIds.includes(requestId)) {
            return;
          }

          state.needsUserActionRequestIds = [...state.needsUserActionRequestIds, requestId];
          clearNeedsUserRequestError(requestId);
          render();

          try {
            await postJson("/api/needs-user/respond", {
              projectRoot: target.dataset.projectRoot,
              requestId,
              decision: target.dataset.decision
            });
            await refreshFleet();
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setNeedsUserRequestError(requestId, "Needs You action failed: " + message);
          } finally {
            state.needsUserActionRequestIds = state.needsUserActionRequestIds.filter((value) => value !== requestId);
            render();
          }
        }
      });

      document.body.addEventListener("input", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLTextAreaElement) && !(target instanceof HTMLInputElement)) {
          return;
        }
        if (target.matches("[data-needs-user-text][data-needs-user-request-id][data-needs-user-question-id]")) {
          updateNeedsUserInputDraft(target.dataset.needsUserRequestId, target.dataset.needsUserQuestionId, {
            other: target.value
          });
          syncNeedsUserSubmitButton(target.dataset.needsUserRequestId);
          return;
        }
        if (!(target instanceof HTMLTextAreaElement)) {
          return;
        }
        if (!target.matches("textarea[data-reply-project-root][data-reply-thread-id]")) {
          return;
        }
        if (
          !state.replyComposer
          || state.replyComposer.projectRoot !== target.dataset.replyProjectRoot
          || state.replyComposer.threadId !== target.dataset.replyThreadId
        ) {
          return;
        }
        state.replyComposer = {
          ...state.replyComposer,
          draft: target.value,
          error: null
        };
        syncReplyComposerSubmitButton(target.dataset.replyProjectRoot, target.dataset.replyThreadId);
      });

      document.body.addEventListener("pointerover", (event) => {
        const focusTarget = event.target instanceof HTMLElement
          ? event.target.closest(".session-card[data-focus-keys], [data-focus-agent][data-focus-keys]")
          : null;
        const relatedTarget = event.relatedTarget;
        if (!(focusTarget instanceof HTMLElement)) {
          return;
        }
        if (relatedTarget instanceof Node && focusTarget.contains(relatedTarget)) {
          return;
        }
        setSessionFocusFromElement(focusTarget);
      });

      document.body.addEventListener("pointerout", (event) => {
        const focusTarget = event.target instanceof HTMLElement
          ? event.target.closest(".session-card[data-focus-keys], [data-focus-agent][data-focus-keys]")
          : null;
        const relatedTarget = event.relatedTarget;
        if (!(focusTarget instanceof HTMLElement)) {
          return;
        }
        if (relatedTarget instanceof Node && focusTarget.contains(relatedTarget)) {
          return;
        }
        if (relatedTarget instanceof HTMLElement && relatedTarget.closest(".session-card[data-focus-keys], [data-focus-agent][data-focus-keys]")) {
          return;
        }
        setSessionFocusFromElement(null);
      });

      document.body.addEventListener("focusin", (event) => {
        const focusTarget = event.target instanceof HTMLElement
          ? event.target.closest(".session-card[data-focus-keys], [data-focus-agent][data-focus-keys]")
          : null;
        if (focusTarget instanceof HTMLElement) {
          setSessionFocusFromElement(focusTarget);
        }
      });

      document.addEventListener("pointerdown", (event) => {
        if (state.openAgentThread) {
          const withinThread = event.target instanceof HTMLElement
            ? event.target.closest("[data-agent-thread-card], .office-map-agent-trigger")
            : null;
          if (!withinThread) {
            closeAgentThread();
          }
        }
        if (!state.settingsOpen) {
          return;
        }
        const withinSettings = event.target instanceof HTMLElement
          ? event.target.closest(".settings-shell")
          : null;
        if (!withinSettings) {
          setSettingsOpen(false);
        }
      });

      document.body.addEventListener("focusout", (event) => {
        const focusTarget = event.target instanceof HTMLElement
          ? event.target.closest(".session-card[data-focus-keys], [data-focus-agent][data-focus-keys]")
          : null;
        const relatedTarget = event.relatedTarget;
        if (!(focusTarget instanceof HTMLElement)) {
          return;
        }
        if (relatedTarget instanceof Node && focusTarget.contains(relatedTarget)) {
          return;
        }
        if (relatedTarget instanceof HTMLElement && relatedTarget.closest(".session-card[data-focus-keys], [data-focus-agent][data-focus-keys]")) {
          return;
        }
        setSessionFocusFromElement(null);
      });

      document.body.addEventListener("pointerdown", (event) => {
        const target = event.target instanceof HTMLElement ? event.target.closest(".office-map-furniture-hit") : null;
        if (!(target instanceof HTMLElement)) {
          return;
        }
        const host = target.closest("[data-office-map-host]");
        const renderer = rendererForHost(host);
        if (!renderer || !renderer.model) {
          return;
        }
        const item = renderer.model.furniture.find((entry) => entry.id === target.dataset.furnitureId && entry.roomId === target.dataset.roomId);
        if (!item) {
          return;
        }
        const rect = target.getBoundingClientRect();
        const pointerOffsetTiles = ((event.clientX - rect.left) / (renderer.scale * renderer.model.tile));
        furnitureDragState = {
          renderer,
          projectRoot: renderer.model.projectRoot,
          item,
          currentColumn: item.column,
          pointerOffsetTiles,
          hostRect: renderer.host.getBoundingClientRect()
        };
        window.addEventListener("pointermove", handleFurnitureDragMove);
        window.addEventListener("pointerup", stopFurnitureDrag);
        window.addEventListener("pointercancel", stopFurnitureDrag);
        event.preventDefault();
      });

      if (textScaleInput instanceof HTMLInputElement) {
        textScaleInput.addEventListener("input", () => {
          syncTextScalePreview(textScaleInput.value);
        });
        textScaleInput.addEventListener("change", () => {
          commitTextScale(textScaleInput.value);
        });
      }
      if (debugTilesButton instanceof HTMLButtonElement) {
        debugTilesButton.addEventListener("click", () => {
          state.globalSceneSettings = {
            ...state.globalSceneSettings,
            debugTiles: !state.globalSceneSettings.debugTiles
          };
          applyGlobalSceneSettings();
          saveGlobalSceneSettings();
          render();
        });
      }
      if (splitWorktreesButton instanceof HTMLButtonElement) {
        splitWorktreesButton.addEventListener("click", () => {
          state.globalSceneSettings = {
            ...state.globalSceneSettings,
            splitWorktrees: !state.globalSceneSettings.splitWorktrees
          };
          applyGlobalSceneSettings();
          saveGlobalSceneSettings();
          lastSceneRenderToken = null;
          render();
        });
      }
      if (cursorApiKeyInput instanceof HTMLInputElement) {
        cursorApiKeyInput.addEventListener("input", () => {
          queueCursorApiKeySave();
        });
        cursorApiKeyInput.addEventListener("blur", () => {
          queueCursorApiKeySave(true);
        });
        cursorApiKeyInput.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            queueCursorApiKeySave(true);
          }
        });
      }
      let hatSelectionRequestId = 0;
      function applyOptimisticHatSelection(hatId) {
        state.integrationSettings = normalizedIntegrationSettings({
          ...state.integrationSettings,
          appearance: {
            ...(state.integrationSettings && state.integrationSettings.appearance
              ? state.integrationSettings.appearance
              : defaultIntegrationSettings().appearance),
            hatId: normalizeHatId(hatId)
          }
        });
        syncAppearanceSettingsUi();
        render();
        scheduleMultiplayerBroadcast();
      }
      async function saveHatSelection(hatId) {
        const requestId = ++hatSelectionRequestId;
        const previousHatId = currentSelectedHatId();
        applyOptimisticHatSelection(hatId);
        state.appearanceSettingsPending = true;
        syncAppearanceSettingsUi();
        try {
          const response = await postJson("/api/settings/integrations", {
            appearance: {
              hatId: normalizeHatId(hatId)
            }
          });
          if (requestId !== hatSelectionRequestId) {
            return;
          }
          applyIntegrationSettingsResponse(response);
        } catch (error) {
          if (requestId !== hatSelectionRequestId) {
            return;
          }
          console.error("failed to save hat selection", error);
          applyOptimisticHatSelection(previousHatId);
        } finally {
          if (requestId !== hatSelectionRequestId) {
            return;
          }
          state.appearanceSettingsPending = false;
          syncAppearanceSettingsUi();
        }
      }
      function cycleHatSelection(direction) {
        const entries = hatSelectionEntries();
        if (entries.length <= 1) {
          return;
        }
        const index = currentHatSelectionIndex();
        const nextIndex = (index + direction + entries.length) % entries.length;
        void saveHatSelection(entries[nextIndex]);
      }
      if (hatPrevButton instanceof HTMLButtonElement) {
        hatPrevButton.addEventListener("click", () => {
          cycleHatSelection(-1);
        });
      }
      if (hatNextButton instanceof HTMLButtonElement) {
        hatNextButton.addEventListener("click", () => {
          cycleHatSelection(1);
        });
      }
      const commitMultiplayerInputs = (overrides = {}) => {
        commitMultiplayerSettings({
          ...state.multiplayerDraft,
          host: multiplayerHostInput instanceof HTMLInputElement ? multiplayerHostInput.value : "",
          room: multiplayerRoomInput instanceof HTMLInputElement ? multiplayerRoomInput.value : "",
          nickname: multiplayerNicknameInput instanceof HTMLInputElement ? multiplayerNicknameInput.value : "",
          ...overrides
        });
      };
      const saveMultiplayerDraft = async (overrides = {}) => {
        state.integrationSettingsPending = true;
        syncCursorIntegrationUi();
        syncMultiplayerSettingsUi();
        try {
          state.multiplayerDraftDirty = false;
          applyIntegrationSettingsResponse(await postJson("/api/settings/integrations", {
            multiplayer: {
              ...state.multiplayerDraft,
              ...overrides
            }
          }));
          state.integrationSettingsError = null;
        } catch (error) {
          state.multiplayerDraftDirty = true;
          const message = error instanceof Error ? error.message : String(error);
          setMultiplayerStatus("error", "Failed to save shared room settings: " + message);
        } finally {
          state.integrationSettingsPending = false;
          syncCursorIntegrationUi();
          syncMultiplayerSettingsUi();
        }
      };
      const clearMultiplayerDraft = async () => {
        state.integrationSettingsPending = true;
        syncCursorIntegrationUi();
        syncMultiplayerSettingsUi();
        try {
          state.multiplayerDraftDirty = false;
          applyIntegrationSettingsResponse(await postJson("/api/settings/integrations", { multiplayer: null }));
          state.integrationSettingsError = null;
        } catch (error) {
          state.multiplayerDraftDirty = true;
          const message = error instanceof Error ? error.message : String(error);
          setMultiplayerStatus("error", "Failed to clear shared room settings: " + message);
        } finally {
          state.integrationSettingsPending = false;
          syncCursorIntegrationUi();
          syncMultiplayerSettingsUi();
        }
      };
      if (multiplayerHostInput instanceof HTMLInputElement) {
        multiplayerHostInput.addEventListener("input", () => {
          commitMultiplayerInputs();
        });
        multiplayerHostInput.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void saveMultiplayerDraft();
          }
        });
      }
      if (multiplayerRoomInput instanceof HTMLInputElement) {
        multiplayerRoomInput.addEventListener("input", () => {
          commitMultiplayerInputs();
        });
        multiplayerRoomInput.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void saveMultiplayerDraft();
          }
        });
      }
      if (multiplayerNicknameInput instanceof HTMLInputElement) {
        multiplayerNicknameInput.addEventListener("input", () => {
          commitMultiplayerInputs();
        });
        multiplayerNicknameInput.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void saveMultiplayerDraft();
          }
        });
      }
      if (multiplayerSaveButton instanceof HTMLButtonElement) {
        multiplayerSaveButton.addEventListener("click", () => {
          void saveMultiplayerDraft();
        });
      }
      if (multiplayerClearButton instanceof HTMLButtonElement) {
        multiplayerClearButton.addEventListener("click", () => {
          void clearMultiplayerDraft();
        });
      }
      if (multiplayerEnabledButton instanceof HTMLButtonElement) {
        multiplayerEnabledButton.addEventListener("click", () => {
          commitMultiplayerInputs({
            enabled: !state.multiplayerSettings.enabled
          });
          void saveMultiplayerDraft({
            enabled: !state.multiplayerSettings.enabled
          });
        });
      }

      if (!screenshotMode) {
        window.addEventListener("online", () => setConnection("reconnecting"));
        window.addEventListener("offline", () => setConnection("offline"));
        window.addEventListener("scroll", syncSkyParallax, { passive: true });
      }
      document.addEventListener("keydown", (event) => {
        if (event.defaultPrevented || event.repeat || event.metaKey || event.ctrlKey || event.altKey) {
          const target = event.target;
          if (
            (event.metaKey || event.ctrlKey)
            && event.key === "Enter"
            && target instanceof HTMLTextAreaElement
            && (
              target.matches("textarea[data-reply-project-root][data-reply-thread-id]")
              || target.matches("textarea[data-needs-user-text][data-needs-user-request-id]")
            )
          ) {
            event.preventDefault();
            if (target.matches("textarea[data-reply-project-root][data-reply-thread-id]")) {
              void submitReplyComposer(target.dataset.replyProjectRoot, target.dataset.replyThreadId);
            } else {
              const card = target.closest("[data-needs-user-project-root]");
              const projectRoot = card instanceof HTMLElement ? card.dataset.needsUserProjectRoot : null;
              void submitNeedsUserInput(projectRoot, target.dataset.needsUserRequestId);
            }
          }
          return;
        }
        if (
          event.key === "Enter"
          && !event.shiftKey
          && !event.isComposing
          && event.target instanceof HTMLTextAreaElement
          && event.target.matches("textarea[data-reply-project-root][data-reply-thread-id]")
        ) {
          event.preventDefault();
          void submitReplyComposer(event.target.dataset.replyProjectRoot, event.target.dataset.replyThreadId);
          return;
        }
        if (isTypingTarget(event.target)) {
          return;
        }
        if (event.key === "Escape" && state.openAgentThread) {
          event.preventDefault();
          closeAgentThread();
          return;
        }
        if (event.key === "Escape" && state.settingsOpen) {
          event.preventDefault();
          setSettingsOpen(false);
          return;
        }
        if (event.key === "Escape" && state.workspaceFullscreen) {
          event.preventDefault();
          setWorkspaceFullscreen(false);
          return;
        }
        if (
          (event.key === "Enter" || event.key === " ")
          && event.target instanceof HTMLElement
          && event.target.matches(".office-map-agent-trigger[data-project-root][data-thread-id]")
        ) {
          event.preventDefault();
          openAgentThread(event.target.dataset.projectRoot, event.target.dataset.threadId);
          return;
        }
        if ((event.key === "f" || event.key === "F") && canFocusWorkspace()) {
          event.preventDefault();
          toggleWorkspaceFullscreen();
        }
      });
      window.addEventListener("resize", () => {
        syncSkyParallax();
        fitScenes();
        renderNotifications();
      });

      refreshFleet()
        .then(() => {
          if (screenshotMode) {
            setConnection("snapshot");
            return;
          }
          connectEvents();
        })
        .catch((error) => {
          console.error("initial refresh failed", error);
          setConnection("offline");
        });

`;
