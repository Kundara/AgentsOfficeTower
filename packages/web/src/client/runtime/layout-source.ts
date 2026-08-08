export const CLIENT_RUNTIME_LAYOUT_SOURCE = `
      const mapViewButton = document.getElementById("map-view-button");
      const terminalViewButton = document.getElementById("terminal-view-button");
      const splitWorktreesButton = document.getElementById("split-worktrees-button");
      const settingsButton = document.getElementById("settings-button");
      const settingsPopup = document.getElementById("settings-popup");
      const debugTilesButton = document.getElementById("debug-tiles-button");
      const textScaleInput = document.getElementById("text-scale-input");
      const textScaleOutput = document.getElementById("text-scale-output");
      const hatPrevButton = document.getElementById("hat-prev-button");
      const hatNextButton = document.getElementById("hat-next-button");
      const hatPreview = document.getElementById("hat-preview");
      const cursorApiKeyInput = document.getElementById("cursor-api-key-input");
      const cursorApiKeyStatus = document.getElementById("cursor-api-key-status");
      const multiplayerEnabledButton = document.getElementById("multiplayer-enabled-button");
      const multiplayerHostInput = document.getElementById("multiplayer-host-input");
      const multiplayerRoomInput = document.getElementById("multiplayer-room-input");
      const multiplayerNicknameInput = document.getElementById("multiplayer-nickname-input");
      const multiplayerSaveButton = document.getElementById("multiplayer-save-button");
      const multiplayerClearButton = document.getElementById("multiplayer-clear-button");
      const multiplayerStatus = document.getElementById("multiplayer-status");
      const connectionPill = document.getElementById("connection-pill");
      const stamp = document.getElementById("stamp");
      const heroSummary = document.getElementById("hero-summary");
      const projectCount = document.getElementById("project-count");
      const projectTabs = document.getElementById("project-tabs");
      const centerTitle = document.getElementById("center-title");
      const workspaceFocusButton = document.getElementById("workspace-focus-button");
      const workspacePanel = document.getElementById("workspace-panel");
      const centerContent = document.getElementById("center-content");
      const sessionList = document.getElementById("session-list");
      const roomsPath = document.getElementById("rooms-path");
      applyGlobalSceneSettings();
      syncSettingsPopup();
      syncAppearanceSettingsUi();
      syncCursorIntegrationUi();
      syncMultiplayerSettingsUi();
      void refreshIntegrationSettings();
      multiplayerPruneTimer = setInterval(pruneMultiplayerPeers, 5000);

      function syncSettingsPopup() {
        if (settingsButton instanceof HTMLButtonElement) {
          settingsButton.classList.toggle("active", state.settingsOpen);
          settingsButton.setAttribute("aria-expanded", state.settingsOpen ? "true" : "false");
        }
        if (settingsPopup instanceof HTMLElement) {
          settingsPopup.hidden = !state.settingsOpen;
        }
      }

      function setSettingsOpen(nextOpen) {
        state.settingsOpen = Boolean(nextOpen);
        syncSettingsPopup();
      }

      function cursorIntegrationStatusText() {
        if (typeof state.integrationSettingsError === "string" && state.integrationSettingsError.length > 0) {
          return state.integrationSettingsError;
        }

        const cursor = state.integrationSettings && state.integrationSettings.cursor
          ? state.integrationSettings.cursor
          : defaultIntegrationSettings().cursor;

        if (state.integrationSettingsPending) {
          return "Saving Cursor API key on this machine...";
        }

        if (cursor.source === "env") {
          const storedSuffix = cursor.storedConfigured && cursor.storedMaskedKey
            ? " A saved key is also present and can be cleared here."
            : "";
          return "Cursor API key is coming from CURSOR_API_KEY in the server process" + (cursor.maskedKey ? " (" + cursor.maskedKey + ")." : ".") + storedSuffix;
        }

        if (cursor.source === "stored") {
          return "Saved on this machine for Agents Office" + (cursor.maskedKey ? " (" + cursor.maskedKey + ")." : ".");
        }

        return "No Cursor API Key is saved";
      }

      function syncCursorIntegrationUi() {
        const cursor = state.integrationSettings && state.integrationSettings.cursor
          ? state.integrationSettings.cursor
          : defaultIntegrationSettings().cursor;
        const busy = state.integrationSettingsPending === true;

        if (cursorApiKeyInput instanceof HTMLInputElement) {
          cursorApiKeyInput.disabled = busy;
          if (cursorApiKeyInput.value.length === 0) {
            cursorApiKeyInput.placeholder = cursor.source === "stored"
              ? "Saved on this machine"
              : cursor.source === "env"
                ? "Provided by CURSOR_API_KEY"
                : "cursor_...";
          }
        }

        setTextIfChanged(cursorApiKeyStatus, cursorIntegrationStatusText());
      }

      function normalizedIntegrationSettings(nextSettings) {
        const defaults = defaultIntegrationSettings();
        const incoming = nextSettings && typeof nextSettings === "object" ? nextSettings : {};
        return {
          ...defaults,
          ...incoming,
          cursor: {
            ...defaults.cursor,
            ...(incoming && incoming.cursor ? incoming.cursor : {})
          },
          appearance: {
            ...defaults.appearance,
            ...(incoming && incoming.appearance ? incoming.appearance : {})
          },
          multiplayer: {
            ...defaults.multiplayer,
            ...(incoming && incoming.multiplayer ? incoming.multiplayer : {})
          }
        };
      }

      function hatSelectionEntries() {
        return [null].concat(
          pixelOfficeHatOptions()
            .map((entry) => normalizeHatId(entry && entry.id))
            .filter(Boolean)
        );
      }

      function currentHatSelectionIndex() {
        const entries = hatSelectionEntries();
        const currentHatId = currentSelectedHatId();
        const matchIndex = entries.findIndex((hatId) => hatId === currentHatId);
        return matchIndex >= 0 ? matchIndex : 0;
      }

      function selectedHatDefinition() {
        return hatDefinitionById(currentSelectedHatId());
      }

      function syncAppearanceSettingsUi() {
        const entries = hatSelectionEntries();
        if (hatPrevButton instanceof HTMLButtonElement) {
          hatPrevButton.disabled = entries.length <= 1;
        }
        if (hatNextButton instanceof HTMLButtonElement) {
          hatNextButton.disabled = entries.length <= 1;
        }
        if (hatPreview instanceof HTMLElement) {
          const hat = selectedHatDefinition();
          if (!hat) {
            hatPreview.innerHTML = '<div class="hat-preview-frame is-empty" aria-label="No hat selected"><span class="hat-preview-empty" aria-hidden="true"></span></div>';
            return;
          }
          const previewScale = Number.isFinite(hat.previewScale) ? Number(hat.previewScale) : pixelOfficeHatDefaults().previewScale;
          hatPreview.innerHTML = '<div class="hat-preview-frame" aria-label="Hat selected"><img class="hat-preview-image" src="'
            + escapeHtml(hat.url)
            + '" alt="" style="transform: translateY('
            + Math.round(Math.min(0, hat.offsetPx.y * 0.5))
            + 'px) scale('
            + previewScale
            + ');" /></div>';
        }
      }

      function applyIntegrationSettingsResponse(nextSettings) {
        state.integrationSettings = normalizedIntegrationSettings(nextSettings);
        syncAppearanceSettingsUi();
        syncStoredMultiplayerSettings(state.integrationSettings.multiplayer);
      }

      async function refreshIntegrationSettings() {
        try {
          const response = await fetch("/api/settings/integrations");
          if (!response.ok) {
            throw new Error(await response.text());
          }
          applyIntegrationSettingsResponse(await response.json());
          state.integrationSettingsError = null;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          applyIntegrationSettingsResponse(defaultIntegrationSettings());
          state.integrationSettingsError = "Cursor settings unavailable: " + message;
        } finally {
          state.integrationSettingsPending = false;
          state.appearanceSettingsPending = false;
          syncAppearanceSettingsUi();
          syncCursorIntegrationUi();
        }
      }

      let cursorApiKeySaveTimer = null;

      function queueCursorApiKeySave(immediate = false) {
        if (!(cursorApiKeyInput instanceof HTMLInputElement)) {
          return;
        }
        if (cursorApiKeySaveTimer !== null) {
          clearTimeout(cursorApiKeySaveTimer);
          cursorApiKeySaveTimer = null;
        }
        const saveDelayMs = immediate ? 0 : 500;
        cursorApiKeySaveTimer = window.setTimeout(() => {
          cursorApiKeySaveTimer = null;
          void saveCursorApiKeyDraft();
        }, saveDelayMs);
      }

      async function saveCursorApiKeyDraft() {
        if (!(cursorApiKeyInput instanceof HTMLInputElement)) {
          return;
        }

        const cursorApiKey = cursorApiKeyInput.value.trim();
        const cursor = state.integrationSettings && state.integrationSettings.cursor
          ? state.integrationSettings.cursor
          : defaultIntegrationSettings().cursor;
        if (!cursorApiKey && cursor.storedConfigured !== true) {
          state.integrationSettingsError = null;
          syncCursorIntegrationUi();
          return;
        }

        state.integrationSettingsPending = true;
        state.integrationSettingsError = null;
        syncCursorIntegrationUi();

        try {
          applyIntegrationSettingsResponse(await postJson("/api/settings/integrations", {
            cursorApiKey: cursorApiKey || null
          }));
          state.integrationSettingsError = null;
          cursorApiKeyInput.value = "";
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          state.integrationSettingsError = "Failed to save Cursor API key: " + message;
        } finally {
          state.integrationSettingsPending = false;
          syncCursorIntegrationUi();
        }
      }

      function syncFleetBackdrop() {
        const towerMode = state.view === "map";
        document.body.classList.toggle("fleet-sky-active", towerMode);
        if (workspacePanel instanceof HTMLElement) {
          workspacePanel.dataset.panelMode = towerMode ? "tower" : "default";
        }
        if (centerContent instanceof HTMLElement) {
          centerContent.dataset.contentMode = towerMode ? "tower" : "default";
        }
      }

      function syncSkyParallax() {
        const scrollY = Math.max(window.scrollY || 0, document.documentElement.scrollTop || 0, document.body.scrollTop || 0);
        document.documentElement.style.setProperty("--tower-scroll-y", Math.round(scrollY) + "px");
      }

      function syncUrl() {
        const url = new URL(window.location.href);
        if (state.selected === "all") url.searchParams.delete("project");
        else url.searchParams.set("project", state.selected);
        if (state.view === "map") url.searchParams.delete("view");
        else url.searchParams.set("view", state.view);
        if (state.workspaceFullscreen && state.selected !== "all") url.searchParams.set("focus", "1");
        else url.searchParams.delete("focus");
        url.searchParams.delete("active");
        url.searchParams.delete("history");
        window.history.replaceState({}, "", url);
      }

      function setSelection(nextSelection) {
        state.selected = nextSelection;
        if (nextSelection === "all") {
          state.workspaceFullscreen = false;
        }
        syncUrl();
        render();
      }

      function setView(nextView) {
        state.view = nextView === "terminal" ? "terminal" : "map";
        syncUrl();
        render();
      }

      function canFocusWorkspace() {
        return Boolean(state.fleet && state.selected !== "all" && currentSnapshot());
      }

      function syncWorkspaceFullscreenUi() {
        const isVisible = canFocusWorkspace();
        const isActive = isVisible && state.workspaceFullscreen;
        document.body.classList.toggle("workspace-focus", isActive);
        if (!(workspaceFocusButton instanceof HTMLButtonElement)) {
          return;
        }
        workspaceFocusButton.hidden = !isVisible;
        workspaceFocusButton.classList.toggle("active", isActive);
        workspaceFocusButton.setAttribute("aria-pressed", isActive ? "true" : "false");
        workspaceFocusButton.textContent = isActive ? "Close" : "[] Expand";
        workspaceFocusButton.title = isActive
          ? "Close workspace focus (F)"
          : "Expand selected workspace (F)";
      }

      function setWorkspaceFullscreen(nextValue) {
        const normalized = Boolean(nextValue) && canFocusWorkspace();
        if (state.workspaceFullscreen === normalized) {
          syncWorkspaceFullscreenUi();
          return;
        }
        if (normalized) {
          setSettingsOpen(false);
        }
        state.workspaceFullscreen = normalized;
        lastSceneRenderToken = null;
        syncUrl();
        render();
      }

      function toggleWorkspaceFullscreen() {
        if (!canFocusWorkspace()) {
          return;
        }
        setWorkspaceFullscreen(!state.workspaceFullscreen);
      }

      function isTypingTarget(target) {
        if (!(target instanceof HTMLElement)) {
          return false;
        }
        if (target.isContentEditable) {
          return true;
        }
        return Boolean(target.closest("input, textarea, select, [contenteditable='true'], [contenteditable='plaintext-only']"));
      }

      function setConnection(nextConnection) {
        state.connection = nextConnection;
        if (!connectionPill) return;
        connectionPill.className = \`status-pill state-\${nextConnection}\`;
        connectionPill.textContent =
          nextConnection === "live" ? "Live stream"
          : nextConnection === "snapshot" ? "Snapshot mode"
          : nextConnection === "offline" ? "Offline"
          : nextConnection === "reconnecting" ? "Reconnecting"
          : "Connecting";
      }

      function countsForSnapshot(snapshot) {
        const counters = { total: 0, active: 0, waiting: 0, blocked: 0, cloud: 0 };
        const agentsById = new Map(snapshot.agents.map((agent) => [agent.id, agent]));
        const countedFamilies = new Map();
        for (const agent of snapshot.agents) {
          const cloud = agent.source === "cloud" || agent.state === "cloud";
          const live = !cloud && isLiveSceneAgent(agent);
          if (!live && !(cloud && isBusyAgent(agent))) {
            continue;
          }
          let familyAgent = agent;
          const visited = new Set([agent.id]);
          while (
            familyAgent.parentThreadId
            && agentsById.has(familyAgent.parentThreadId)
            && !visited.has(familyAgent.parentThreadId)
          ) {
            familyAgent = agentsById.get(familyAgent.parentThreadId);
            visited.add(familyAgent.id);
          }
          const familyKey = familyAgent.id || agent.id;
          const existing = countedFamilies.get(familyKey) || { cloud: false, blocked: false, waiting: false, active: false };
          countedFamilies.set(familyKey, {
            cloud: existing.cloud || cloud,
            blocked: existing.blocked || agent.state === "blocked",
            waiting: existing.waiting || agent.state === "waiting",
            active: existing.active || live
          });
        }
        for (const family of countedFamilies.values()) {
          counters.total += 1;
          if (family.active) counters.active += 1;
          if (family.blocked) counters.blocked += 1;
          if (family.waiting) counters.waiting += 1;
          if (family.cloud) counters.cloud += 1;
        }
        return counters;
      }

      function worktreeIconUrl() {
        return pixelOffice && pixelOffice.icons && pixelOffice.icons.worktree && pixelOffice.icons.worktree.url
          ? pixelOffice.icons.worktree.url
          : "/assets/pixel-office/sprites/icons/worktree.png";
      }

      function inferredCodexWorktreeMetadata(projectRoot) {
        const normalizedRoot = normalizeSharedPathCandidate(projectRoot || "");
        const marker = "/.codex/worktrees/";
        const markerIndex = normalizedRoot.lastIndexOf(marker);
        if (markerIndex < 0) {
          return null;
        }
        const suffix = normalizedRoot.slice(markerIndex + marker.length);
        const parts = suffix.split("/").filter(Boolean);
        if (parts.length < 2) {
          return null;
        }
        return {
          worktreeName: parts[0],
          projectName: parts[1]
        };
      }

      function branchDerivedWorktreeName(branch) {
        const normalizedBranch = String(branch || "").trim();
        if (!normalizedBranch || normalizedBranch === "HEAD" || normalizedBranch === "main" || normalizedBranch === "master") {
          return "";
        }
        const parts = normalizedBranch.split("/").map((part) => String(part || "").trim()).filter(Boolean);
        if (parts.length === 0) {
          return "";
        }
        if (String(parts[0] || "").toLowerCase() === "codex" && parts.length > 1) {
          return parts.slice(1).join("/");
        }
        return normalizedBranch;
      }

      function worktreeNameForSnapshot(snapshot) {
        const explicitName = String(snapshot && snapshot.projectIdentity && snapshot.projectIdentity.worktreeName || "").trim();
        const branchName = branchDerivedWorktreeName(snapshot && snapshot.projectIdentity && snapshot.projectIdentity.branch);
        if (branchName && (!explicitName || explicitName === inferredCodexWorktreeMetadata(snapshot && snapshot.projectRoot)?.worktreeName)) {
          return branchName;
        }
        if (explicitName) {
          return explicitName;
        }
        return String(inferredCodexWorktreeMetadata(snapshot && snapshot.projectRoot)?.worktreeName || "").trim();
      }

      function isWorktreeSnapshot(snapshot) {
        return worktreeNameForSnapshot(snapshot).length > 0;
      }

      function snapshotMatchesProjectRoot(snapshot, projectRoot) {
        if (!snapshot || !projectRoot) {
          return false;
        }
        if (snapshot.projectRoot === projectRoot) {
          return true;
        }
        return Array.isArray(snapshot.mergedProjectRoots)
          && snapshot.mergedProjectRoots.includes(projectRoot);
      }

      function normalizeRepoIdentity(value) {
        const trimmed = String(value || "").trim();
        if (!trimmed) {
          return "";
        }
        const sshMatch = trimmed.match(/^git@([^:]+):(.+)$/i);
        if (sshMatch) {
          return ("https://" + sshMatch[1] + "/" + sshMatch[2])
            .replace(/\\.git$/i, "")
            .replace(/[\\\\/]+$/g, "")
            .toLowerCase();
        }
        try {
          const url = new URL(trimmed);
          if (!["http:", "https:", "ssh:", "git:"].includes(url.protocol.toLowerCase()) || !url.hostname || !url.pathname.replace(/^\\/+|\\/+$/g, "")) {
            return "";
          }
          const protocol = url.protocol === "ssh:" || url.protocol === "git:" ? "https:" : url.protocol;
          const pathname = url.pathname.replace(/\\.git$/i, "").replace(/^\\/+|\\/+$/g, "");
          return (protocol + "//" + url.hostname + "/" + pathname).toLowerCase();
        } catch {
          return trimmed
            .replace(/\\.git$/i, "")
            .replace(/[\\\\/]+$/g, "")
            .toLowerCase();
        }
      }

      function repoIdentityForSnapshot(snapshot) {
        const explicitRepoUrl = normalizeRepoIdentity(snapshot && snapshot.projectIdentity && snapshot.projectIdentity.repoUrl || "");
        if (explicitRepoUrl) {
          return explicitRepoUrl;
        }
        const agents = Array.isArray(snapshot && snapshot.agents) ? snapshot.agents : [];
        for (const agent of agents) {
          const repoUrl = normalizeRepoIdentity(agent && agent.git && agent.git.originUrl || "");
          if (repoUrl) {
            return repoUrl;
          }
        }
        const rootCommit = String(snapshot && snapshot.projectIdentity && snapshot.projectIdentity.rootCommit || "").trim().toLowerCase();
        if (/^[a-f0-9]{40,64}$/.test(rootCommit)) {
          return "git-root-commit:" + rootCommit;
        }
        return "";
      }

      function snapshotGroupKey(snapshot) {
        const identity = snapshot && snapshot.projectIdentity ? snapshot.projectIdentity : null;
        const repoIdentity = repoIdentityForSnapshot(snapshot);
        if (repoIdentity) {
          return "git-repo:" + repoIdentity;
        }
        const identityKey = String(identity && identity.key || "").trim();
        if (identityKey) {
          return "git-key:" + identityKey;
        }
        const commonGitDir = normalizeSharedPathCandidate(identity && identity.commonGitDir || "");
        if (commonGitDir) {
          return "git-common:" + commonGitDir;
        }
        const gitRoot = normalizeSharedPathCandidate(identity && identity.gitRoot || "");
        if (gitRoot) {
          return "git-root:" + gitRoot;
        }
        return "project:" + normalizeSharedPathCandidate(snapshot && snapshot.projectRoot || "");
      }

      function preferredRepresentativeSnapshot(current, candidate) {
        if (!current) {
          return candidate;
        }
        if (!isWorktreeSnapshot(candidate) && isWorktreeSnapshot(current)) {
          return candidate;
        }
        return current;
      }

      function mergedAgentId(projectRoot, agentId) {
        return String(projectRoot || "") + "::" + String(agentId || "");
      }

      function mergedAgentIdentity(agent) {
        return String(agent && (agent.sourceAgentId || agent.id) || "").trim();
      }

      function normalizedMergedAgentPath(value) {
        return String(value || "").trim().replace(/\\\\/g, "/").replace(/\\/+$/g, "");
      }

      function mergedAgentSnapshotAffinity(snapshot, agent) {
        const projectRoot = normalizedMergedAgentPath(snapshot && snapshot.projectRoot);
        if (!projectRoot) {
          return 0;
        }
        if (normalizedMergedAgentPath(agent && agent.cwd) === projectRoot) {
          return 2;
        }
        return (Array.isArray(agent && agent.paths) ? agent.paths : [])
          .some((path) => normalizedMergedAgentPath(path) === projectRoot)
          ? 1
          : 0;
      }

      function preferredMergedAgentEntry(current, candidate) {
        if (!current) {
          return candidate;
        }
        const currentAffinity = mergedAgentSnapshotAffinity(current.snapshot, current.agent);
        const candidateAffinity = mergedAgentSnapshotAffinity(candidate.snapshot, candidate.agent);
        if (candidateAffinity !== currentAffinity) {
          return candidateAffinity > currentAffinity ? candidate : current;
        }
        const currentUpdatedAt = Date.parse(String(current.agent && current.agent.updatedAt || "")) || 0;
        const candidateUpdatedAt = Date.parse(String(candidate.agent && candidate.agent.updatedAt || "")) || 0;
        return candidateUpdatedAt > currentUpdatedAt ? candidate : current;
      }

      function dedupeMergedAgentEntries(snapshots) {
        const entries = [];
        const indexByIdentity = new Map();
        for (const snapshot of snapshots) {
          for (const agent of Array.isArray(snapshot && snapshot.agents) ? snapshot.agents : []) {
            const candidate = { snapshot, agent };
            const identity = mergedAgentIdentity(agent);
            if (!identity || !indexByIdentity.has(identity)) {
              if (identity) {
                indexByIdentity.set(identity, entries.length);
              }
              entries.push(candidate);
              continue;
            }
            const index = indexByIdentity.get(identity);
            entries[index] = preferredMergedAgentEntry(entries[index], candidate);
          }
        }
        return entries;
      }

      function cloneAgentForMergedSnapshot(sourceSnapshot, targetSnapshot, agent, useSyntheticIds, sourceRootByIdentity) {
        const sourceProjectRoot = sourceSnapshot && sourceSnapshot.projectRoot ? sourceSnapshot.projectRoot : targetSnapshot.projectRoot;
        const parentIdentity = mergedParentAgentIdentity(agent);
        const parentSourceProjectRoot = parentIdentity && sourceRootByIdentity instanceof Map
          ? sourceRootByIdentity.get(parentIdentity) || sourceProjectRoot
          : sourceProjectRoot;
        const remappedPaths = remapSharedPaths(
          sourceProjectRoot,
          targetSnapshot.projectRoot,
          Array.isArray(agent && agent.paths) ? agent.paths : []
        );
        const remappedCwd = remapSharedPath(sourceProjectRoot, targetSnapshot.projectRoot, agent && agent.cwd);
        const fallbackPaths = remappedPaths.length > 0
          ? remappedPaths
          : remapSharedPaths(sourceProjectRoot, targetSnapshot.projectRoot, [
            remappedCwd || agent && agent.cwd || sourceProjectRoot,
            sourceProjectRoot
          ]);
        const roomId = sourceProjectRoot === targetSnapshot.projectRoot
          ? agent.roomId
          : roomIdForSharedPaths(targetSnapshot, fallbackPaths);
        return {
          ...agent,
          id: useSyntheticIds ? mergedAgentId(sourceProjectRoot, agent.id) : agent.id,
          parentThreadId: parentIdentity
            ? (useSyntheticIds ? mergedAgentId(parentSourceProjectRoot, parentIdentity) : agent.parentThreadId)
            : null,
          roomId: roomId || (sourceProjectRoot === targetSnapshot.projectRoot ? agent.roomId : null),
          cwd: remappedCwd || agent.cwd,
          paths: fallbackPaths.length > 0 ? fallbackPaths : agent.paths,
          sourceProjectRoot,
          sourceAgentId: agent.id,
          worktreeName: worktreeNameForSnapshot(sourceSnapshot)
        };
      }

      function mergeWorktreeProjects(projects) {
        if (state.globalSceneSettings && state.globalSceneSettings.splitWorktrees) {
          return projects;
        }

        const bucketByKey = new Map();
        const buckets = [];
        projects.forEach((snapshot, index) => {
          const key = snapshotGroupKey(snapshot);
          let bucket = bucketByKey.get(key);
          if (!bucket) {
            bucket = {
              firstIndex: index,
              representative: snapshot,
              snapshots: []
            };
            bucketByKey.set(key, bucket);
            buckets.push(bucket);
          }
          bucket.snapshots.push(snapshot);
          bucket.representative = preferredRepresentativeSnapshot(bucket.representative, snapshot);
        });

        return buckets
          .sort((left, right) => left.firstIndex - right.firstIndex)
          .map((bucket) => {
            const representative = bucket.representative;
            const useSyntheticIds = bucket.snapshots.length > 1;
            const mergedAgentEntries = dedupeMergedAgentEntries(bucket.snapshots);
            const sourceRootByAgentIdentity = mergedAgentSourceRoots(mergedAgentEntries);
            return {
              ...representative,
              mergedProjectRoots: bucket.snapshots.map((snapshot) => snapshot.projectRoot),
              agents: mergedAgentEntries.map(({ snapshot, agent }) =>
                cloneAgentForMergedSnapshot(snapshot, representative, agent, useSyntheticIds, sourceRootByAgentIdentity)
              ),
              cloudTasks: bucket.snapshots.flatMap((snapshot) => Array.isArray(snapshot.cloudTasks) ? snapshot.cloudTasks : []),
              events: bucket.snapshots.flatMap((snapshot) => Array.isArray(snapshot.events) ? snapshot.events : []),
              notes: Array.from(new Set(bucket.snapshots.flatMap((snapshot) => Array.isArray(snapshot.notes) ? snapshot.notes : []).filter(Boolean))),
              worktreeGroupSize: bucket.snapshots.length
            };
          });
      }

      function isCodexChatProject(snapshot) {
        return isCodexChatProjectRootForStreetCafe(snapshot && snapshot.projectRoot);
      }

      function isStreetCafeAgent(snapshot, agent) {
        if (!agent) {
          return false;
        }
        if (isCodexChatProject(snapshot)) {
          return true;
        }
        if (String(agent.sourceKind || "").startsWith("claude:cowork")) {
          return true;
        }
        return agent.interactionMode === "work";
      }

      function cloneAgentForStreetCafe(sourceSnapshot, agent, movedIds) {
        const sourceProjectRoot = agent.sourceProjectRoot || sourceSnapshot.projectRoot;
        const sourceAgentId = agent.sourceAgentId || agent.id;
        const streetId = mergedAgentId(sourceProjectRoot, sourceAgentId);
        const sourceParentId = agent.parentThreadId || null;
        return {
          ...agent,
          id: streetId,
          parentThreadId: sourceParentId && movedIds.has(sourceParentId)
            ? mergedAgentId(sourceProjectRoot, sourceParentId)
            : null,
          roomId: "street-cafe",
          sourceProjectRoot,
          sourceAgentId
        };
      }

      function cloneAccountAgentForStreetCafe(agent) {
        return {
          ...agent,
          id: String(agent.id || agent.conversationKey || "account-session"),
          parentThreadId: null,
          roomId: "street-cafe",
          sourceProjectRoot: null,
          sourceAgentId: agent.sourceAgentId || agent.id,
          accountObserved: true
        };
      }

      function streetCafeConversationKey(agent) {
        const conversationKey = String(agent && agent.conversationKey || "").trim();
        if (conversationKey) {
          return "conversation::" + conversationKey;
        }
        return [
          agent && agent.sourceProjectRoot,
          agent && (agent.threadId || agent.sourceAgentId || agent.id),
          agent && agent.sourceKind
        ].join("::");
      }

      function partitionStreetCafeProjects(projects, accountAgents = []) {
        const sourceEntries = [];
        const workspaceProjects = [];
        projects.forEach((snapshot) => {
          const movedAgents = snapshot.agents.filter((agent) => isStreetCafeAgent(snapshot, agent));
          const remainingAgents = snapshot.agents.filter((agent) => !isStreetCafeAgent(snapshot, agent));
          if (movedAgents.length > 0) {
            sourceEntries.push({ snapshot, agents: movedAgents });
          }
          if (remainingAgents.length > 0 || (!isCodexChatProject(snapshot) && !isClaudeCoworkProject(snapshot))) {
            workspaceProjects.push({ ...snapshot, agents: remainingAgents });
          }
        });

        const seenAgents = new Set();
        const projectStreetAgents = sourceEntries.flatMap(({ snapshot, agents }) => {
          const movedIds = new Set(agents.map((agent) => agent.id));
          return agents
            .map((agent) => cloneAgentForStreetCafe(snapshot, agent, movedIds))
            .filter((agent) => {
              const key = streetCafeConversationKey(agent);
              if (seenAgents.has(key)) {
                return false;
              }
              seenAgents.add(key);
              return true;
            });
        });
        const accountStreetAgents = (Array.isArray(accountAgents) ? accountAgents : [])
          .map(cloneAccountAgentForStreetCafe)
          .filter((agent) => {
            const key = streetCafeConversationKey(agent);
            if (seenAgents.has(key)) {
              return false;
            }
            seenAgents.add(key);
            return true;
          });
        const streetAgents = [...projectStreetAgents, ...accountStreetAgents];
        const contributingRoots = Array.from(new Set(sourceEntries.flatMap(({ snapshot, agents }) => [
          snapshot.projectRoot,
          ...(snapshot.mergedProjectRoots || []),
          ...agents.map((agent) => agent.sourceProjectRoot).filter(Boolean)
        ])));
        const cafeSnapshot = {
          projectRoot: STREET_CAFE_PROJECT_ROOT,
          projectLabel: "Chat Café",
          projectIdentity: null,
          generatedAt: state.fleet && state.fleet.generatedAt ? state.fleet.generatedAt : new Date().toISOString(),
          sceneKind: "street-cafe",
          mergedProjectRoots: contributingRoots,
          rooms: {
            version: 1,
            generated: true,
            filePath: "",
            rooms: [{
              id: "street-cafe",
              name: "Chat Café",
              path: ".",
              x: 0,
              y: 0,
              width: 24,
              height: 9,
              children: []
            }]
          },
          agents: streetAgents,
          cloudTasks: [],
          events: sourceEntries.flatMap(({ snapshot }) => Array.isArray(snapshot.events) ? snapshot.events : []),
          activity: {
            generatedAt: state.fleet && state.fleet.generatedAt ? state.fleet.generatedAt : new Date().toISOString(),
            hotChanges: [],
            hotTools: [],
            runningCommands: []
          },
          notes: streetAgents.length === 0
            ? ["Claude remote Home work appears here when the desktop cache makes it available. Codex Quick Chat is separate from Codex tasks; choose Add to task to make that conversation visible in the Café."]
            : []
        };
        return { workspaceProjects, cafeSnapshot };
      }

      function isBusyAgent(agent) {
        return agent.isCurrent === true || agent.isOngoing === true || isRuntimeActiveLocalAgent(agent);
      }

      function parseAgentUpdatedAt(value) {
        const parsed = Date.parse(value || "");
        return Number.isFinite(parsed) ? parsed : Number.NaN;
      }

      function isDeskLiveLocalState(state) {
        return [
          "editing",
          "running",
          "validating",
          "scanning",
          "thinking",
          "planning",
          "delegating",
          "waiting",
          "blocked"
        ].includes(String(state || "").toLowerCase());
      }

      function isRecentLeadCandidate(agent) {
        return agent.source !== "cloud"
          && agent.source !== "presence"
          && !agent.network
          && !agent.parentThreadId
          && Boolean(agent.threadId || agent.taskId || agent.url || agent.source === "claude");
      }

      function reservedRecentLeadSlots(snapshot) {
        const reservations = activeRecentLeadReservations.get(snapshot.projectRoot);
        return reservations ? reservations.size : 0;
      }

      function updateRecentLeadReservations(projects) {
        for (const snapshot of projects) {
          const previousVisibleIds = recentLeadDisplayMemory.get(snapshot.projectRoot) || [];
          const activeIds = new Set(
            snapshot.agents
              .filter((agent) => shouldSeatAtWorkstation(agent) && isRecentLeadCandidate(agent))
              .map((agent) => agent.id)
          );
          const nextReservations = new Set(
            [...(activeRecentLeadReservations.get(snapshot.projectRoot) || new Set())]
              .filter((agentId) => activeIds.has(agentId))
          );

          for (const agentId of previousVisibleIds) {
            if (activeIds.has(agentId)) {
              nextReservations.add(agentId);
            }
          }

          if (nextReservations.size > 0) {
            activeRecentLeadReservations.set(snapshot.projectRoot, nextReservations);
          } else {
            activeRecentLeadReservations.delete(snapshot.projectRoot);
          }
        }
      }

      function rememberVisibleRecentLeads(projects) {
        for (const snapshot of projects) {
          const visibleIds = snapshot.agents
            .filter((agent) => isFinishedLeadForRec(agent))
            .map((agent) => agent.id);
          recentLeadDisplayMemory.set(snapshot.projectRoot, visibleIds);
        }
      }

      const SUBAGENT_RECENT_SESSION_GRACE_MS = 12000;

      function keepFinishedSubagentSession(agent) {
        if (!agent || !agent.parentThreadId) {
          return false;
        }
        if (agent.isCurrent === true || agent.isOngoing === true) {
          return true;
        }
        const updatedAt = parseAgentUpdatedAt(agent.updatedAt);
        return Number.isFinite(updatedAt)
          && Date.now() - updatedAt <= SUBAGENT_RECENT_SESSION_GRACE_MS;
      }

      function isRecentSessionCandidate(agent) {
        if (agent.source === "cloud" || agent.source === "presence" || agent.network) {
          return false;
        }
        if (!agent.parentThreadId) {
          return true;
        }
        return keepFinishedSubagentSession(agent);
      }

      function recentLeadAgents(snapshot, limit = SCENE_RECENT_LEAD_LIMIT) {
        const activeIds = new Set(snapshot.agents.filter(shouldSeatAtWorkstation).map((agent) => agent.id));
        const effectiveLimit = Math.max(0, limit - reservedRecentLeadSlots(snapshot));
        return [...snapshot.agents]
          .filter((agent) => isFinishedLeadForRec(agent) && !activeIds.has(agent.id))
          .sort(compareAgentsByRecencyStable)
          .slice(0, effectiveLimit);
      }

      function recentSessionAgents(snapshot, limit = SESSION_RECENT_LEAD_LIMIT) {
        const activeIds = new Set(snapshot.agents.filter(isBusyAgent).map((agent) => agent.id));
        return [...snapshot.agents]
          .filter((agent) => isRecentSessionCandidate(agent) && !activeIds.has(agent.id))
          .sort(compareAgentsByRecencyStable)
          .slice(0, limit);
      }

      function busyCount(snapshot) {
        return snapshot.agents.filter(isBusyAgent).length;
      }

      function normalizeSharedNotificationSubjectId(value) {
        const subjectId = typeof value === "string" ? value : "";
        const match = subjectId.match(/^shared:[^:]+:(.+)$/);
        return match ? match[1] : subjectId;
      }

      function notificationSubjectKey(projectRoot, agent, threadId) {
        const explicitThreadId = typeof threadId === "string" && threadId.length > 0 ? threadId : null;
        const agentThreadId = agent && typeof agent.threadId === "string" && agent.threadId.length > 0
          ? agent.threadId
          : null;
        const subjectThreadId = explicitThreadId || agentThreadId;
        if (subjectThreadId) {
          return \`\${projectRoot}::thread::\${normalizeSharedNotificationSubjectId(subjectThreadId)}\`;
        }
        return \`\${projectRoot}::agent::\${normalizeSharedNotificationSubjectId(agent && agent.id ? agent.id : "unknown")}\`;
      }

      function projectHydrationBaselineAt(projectRoot) {
        return baselineProjectHydrationAt.get(projectRoot) ?? 0;
      }

      function markProjectHydrated(projectRoot, atMs = Date.now()) {
        if (!projectRoot || baselineProjectHydrationAt.has(projectRoot)) {
          return;
        }
        baselineProjectHydrationAt.set(projectRoot, atMs);
      }

      function agentLooksHistoricallyHydrated(projectRoot, agent) {
        if (!projectRoot || !agent) {
          return false;
        }
        const baselineAt = projectHydrationBaselineAt(projectRoot);
        if (!Number.isFinite(baselineAt) || baselineAt <= 0) {
          return false;
        }
        const updatedAt = Date.parse(agent.updatedAt || "");
        if (!Number.isFinite(updatedAt)) {
          return false;
        }
        return baselineAt - updatedAt >= HISTORICAL_HYDRATION_SUPPRESS_MS;
      }

      function sceneAgentToken(agent) {
        return [
          agent.id,
          agent.state,
          agent.roomId || "",
          agent.parentThreadId || "",
          agent.isCurrent ? "1" : "0",
          agent.appearance?.id || "",
          agent.source,
          agent.sourceKind || ""
        ].join(":");
      }

      function sceneSnapshotToken(snapshot) {
        return [
          snapshot.projectRoot,
          ...snapshot.agents.map(sceneAgentToken)
        ].join("::");
      }

      function eventSnapshotToken(event) {
        if (!event) {
          return "";
        }
        return [
          event.id || "",
          event.threadId || "",
          event.kind || "",
          event.phase || "",
          event.method || "",
          event.createdAt || "",
          event.itemId || "",
          event.requestId || "",
          event.title || "",
          event.detail || "",
          event.command || "",
          event.path || ""
        ].join(":");
      }

      function roomsSnapshotToken(rooms) {
        if (!rooms) {
          return "";
        }
        return JSON.stringify({
          generated: rooms.generated,
          filePath: rooms.filePath,
          rooms: rooms.rooms
        });
      }

      function projectSemanticToken(snapshot) {
        return [
          snapshot.projectRoot,
          roomsSnapshotToken(snapshot.rooms),
          ...snapshot.agents.map(sceneAgentToken),
          ...((snapshot.events || []).map(eventSnapshotToken)),
          ...((snapshot.notes || []).map((note) => String(note || "")))
        ].join("::");
      }

      function accountAgentSemanticToken(agent) {
        return [
          sceneAgentToken(agent),
          agent.conversationKey || "",
          agent.label || "",
          agent.detail || "",
          agent.statusText || "",
          agent.updatedAt || "",
          agent.isOngoing ? "1" : "0"
        ].join(":");
      }

      function fleetSemanticToken(fleet) {
        if (!fleet) {
          return "";
        }
        const projectTokens = (Array.isArray(fleet.projects) ? fleet.projects : []).map(projectSemanticToken);
        const accountAgentTokens = (Array.isArray(fleet.accountAgents) ? fleet.accountAgents : []).map(accountAgentSemanticToken);
        return [...projectTokens, "account-agents", ...accountAgentTokens].join("||");
      }

      function viewSnapshot(snapshot, recentLeadLimit = SCENE_RECENT_LEAD_LIMIT, allProjects = null) {
        const liveAgents = snapshot.agents.filter(isLiveSceneAgent);
        const recentLeads = recentLeadAgents(snapshot, recentLeadLimit);
        const fallbackAgents = recentFallbackAgentsForEmptyProject(snapshot, allProjects, recentLeadLimit);
        const seenAgentIds = new Set();
        const visibleAgents = liveAgents.length > 0 || recentLeads.length > 0
          ? [...liveAgents, ...recentLeads]
          : fallbackAgents;
        return {
          ...snapshot,
          agents: visibleAgents.filter((agent) => {
            const agentId = String(agent && agent.id || "");
            if (!agentId || seenAgentIds.has(agentId)) {
              return false;
            }
            seenAgentIds.add(agentId);
            return true;
          })
        };
      }

      function emptyProjectNeedsRecentFallback(snapshot) {
        return Boolean(snapshot) && !snapshot.agents.some((agent) => agent.source !== "cloud" && agent.source !== "presence");
      }

      function cloneRecentFallbackAgent(sourceSnapshot, agent) {
        const summary = normalizeDisplayText(sourceSnapshot.projectRoot, agent.detail)
          || latestAgentMessage(sourceSnapshot.projectRoot, agent)
          || "[" + String(agent.state || "idle") + "]";
        const projectPrefix = projectLabel(sourceSnapshot.projectRoot);
        const latestMessage = latestAgentMessage(sourceSnapshot.projectRoot, agent);
        return {
          ...agent,
          isCurrent: false,
          isOngoing: false,
          needsUser: null,
          detail: projectPrefix + " · " + summary,
          latestMessage: latestMessage ? projectPrefix + " · " + latestMessage : null
        };
      }

      function recentFallbackAgentsForEmptyProject(snapshot, allProjects, limit = SCENE_RECENT_LEAD_LIMIT) {
        if (!emptyProjectNeedsRecentFallback(snapshot) || !Array.isArray(allProjects) || allProjects.length === 0) {
          return [];
        }
        const seenAgentIds = new Set();
        return allProjects
          .flatMap((project) =>
            project.projectRoot === snapshot.projectRoot
              ? []
              : project.agents
                .filter((agent) => isFinishedLeadForRec(agent))
                .map((agent) => cloneRecentFallbackAgent(project, agent))
          )
          .sort(compareAgentsByRecencyStable)
          .filter((agent) => {
            const agentId = String(agent && agent.id || "");
            if (!agentId || seenAgentIds.has(agentId)) {
              return false;
            }
            seenAgentIds.add(agentId);
            return true;
          })
          .slice(0, Math.max(0, limit));
      }

      function viewSessionSnapshot(snapshot, recentSessionLimit = SESSION_RECENT_LEAD_LIMIT, allProjects = null) {
        const activeAgents = snapshot.agents.filter(isBusyAgent);
        const recentAgents = recentSessionAgents(snapshot, recentSessionLimit);
        const fallbackAgents = recentFallbackAgentsForEmptyProject(
          snapshot,
          allProjects,
          Math.min(SCENE_RECENT_LEAD_LIMIT, recentSessionLimit)
        );
        return {
          ...snapshot,
          agents: activeAgents.length > 0 || recentAgents.length > 0
            ? [...activeAgents, ...recentAgents]
            : fallbackAgents
        };
      }

      function projectDisplayOrderValue(project) {
        const root = String(project && project.projectRoot || "");
        if (configuredProjectOrder.has(root)) {
          return configuredProjectOrder.get(root);
        }
        if (!dynamicProjectOrder.has(root)) {
          dynamicProjectOrder.set(root, nextDynamicProjectOrder);
          nextDynamicProjectOrder += 1;
        }
        return dynamicProjectOrder.get(root);
      }

      function isClaudeCoworkProject(project) {
        const agents = Array.isArray(project && project.agents) ? project.agents : [];
        return agents.length > 0
          && agents.every((agent) => String(agent && agent.sourceKind || "").startsWith("claude:cowork"));
      }

      function visibleProjects(fleet) {
        const projects = [...(Array.isArray(fleet && fleet.projects) ? fleet.projects : [])];
        projects.forEach((project) => projectDisplayOrderValue(project));
        return projects.sort((left, right) => {
          const sourceTierDelta = (isClaudeCoworkProject(left) ? 1 : 0) - (isClaudeCoworkProject(right) ? 1 : 0);
          if (sourceTierDelta !== 0) {
            return sourceTierDelta;
          }
          const orderDelta = projectDisplayOrderValue(left) - projectDisplayOrderValue(right);
          if (orderDelta !== 0) {
            return orderDelta;
          }
          const labelDelta = projectLabel(left.projectRoot).localeCompare(projectLabel(right.projectRoot));
          if (labelDelta !== 0) {
            return labelDelta;
          }
          return String(left.projectRoot || "").localeCompare(String(right.projectRoot || ""));
        });
      }

      function fleetCounts(fleet) {
        return fleet.projects.reduce((acc, snapshot) => {
          const next = countsForSnapshot(snapshot);
          acc.total += next.total;
          acc.active += next.active;
          acc.waiting += next.waiting;
          acc.blocked += next.blocked;
          acc.cloud += next.cloud;
          return acc;
        }, { total: 0, active: 0, waiting: 0, blocked: 0, cloud: 0 });
      }

      function stableHash(input) {
        let hash = 2166136261;
        for (const char of String(input)) {
          hash ^= char.charCodeAt(0);
          hash = Math.imul(hash, 16777619);
        }
        return Math.abs(hash >>> 0);
      }

      function agentRole(agent) {
        if (agent.role) {
          return String(agent.role).toLowerCase();
        }
        if (agent.source === "cloud") {
          return "cloud";
        }
        if (agent.source === "claude") {
          return "claude";
        }
        if (agent.source === "cursor") {
          return "cursor";
        }
        if (agent.source === "hermes") {
          return "hermes";
        }
        if (agent.source === "openclaw") {
          return "openclaw";
        }
        return "default";
      }

      function titleCaseWords(value) {
        return String(value)
          .split(/\\s+/)
          .filter(Boolean)
          .map((word) => word[0] ? word[0].toUpperCase() + word.slice(1) : word)
          .join(" ");
      }

      function compactPathyLabel(snapshot, label) {
        const normalized = normalizeDisplayText(snapshot && snapshot.projectRoot, label);
        if (!normalized) {
          return "";
        }
        const match = normalized.match(/^(Read|Review|Explore|Search)\\s+(.+)$/);
        if (!match) {
          return normalized;
        }
        const [, verb, subject] = match;
        if (!/[\\\\/]/.test(subject)) {
          return normalized;
        }
        const fileLabel = notificationFileName(snapshot && snapshot.projectRoot, subject, subject);
        return fileLabel ? verb + " " + fileLabel : normalized;
      }

      function displayAgentLabel(snapshot, agent) {
        if (!agent) {
          return "Agent";
        }
        const preferred = typeof agent.nickname === "string" && agent.nickname.trim().length > 0
          ? agent.nickname
          : agent.label;
        const compact = compactPathyLabel(snapshot, preferred);
        if (compact) {
          return compact;
        }
        return normalizeDisplayText(snapshot && snapshot.projectRoot, preferred) || preferred || "Agent";
      }

      function pluralizeWord(word, count) {
        if (count === 1) {
          return word;
        }
        if (/[^aeiou]y$/i.test(word)) {
          return word.slice(0, -1) + "ies";
        }
        if (/(s|x|z|ch|sh)$/i.test(word)) {
          return word + "es";
        }
        return word + "s";
      }

      function pluralizePhrase(phrase, count) {
        if (count === 1) {
          return phrase;
        }
        const words = String(phrase).split(/\\s+/).filter(Boolean);
        if (words.length === 0) {
          return phrase;
        }
        words[words.length - 1] = pluralizeWord(words[words.length - 1], count);
        return words.join(" ");
      }

      function agentRoleLabel(agent) {
        return titleCaseWords(agentRole(agent).replace(/[_-]+/g, " "));
      }

      function childAgentsFor(snapshot, parentThreadId) {
        return snapshot.agents.filter((agent) => agent.parentThreadId === parentThreadId);
      }

      function liveChildAgentsFor(snapshot, parentThreadId) {
        return childAgentsFor(snapshot, parentThreadId).filter((agent) => isBusyAgent(agent));
      }

      function isLeadSession(snapshot, agent) {
        return agent.source !== "cloud"
          && !agent.parentThreadId
          && (Boolean(agent.threadId || agent.taskId || agent.url || agent.source === "claude") || childAgentsFor(snapshot, agent.id).length > 0);
      }

      function agentRankLabel(snapshot, agent) {
        if (isLeadSession(snapshot, agent)) {
          return "mini-boss";
        }
        if (agent.parentThreadId) {
          return "subagent";
        }
        return agent.sourceKind || agentRole(agent);
      }

      function parentLabelFor(snapshot, agent) {
        if (!agent.parentThreadId) {
          return null;
        }
        return snapshot.agents.find((candidate) => candidate.id === agent.parentThreadId)?.label ?? null;
      }

      function focusAgentKey(snapshot, agent) {
        return agentKey(snapshot.projectRoot, agent);
      }

      function collectFocusedSessionKeys(snapshot, agent) {
        const queue = [agent.id];
        const visited = new Set(queue);
        const keys = new Set([focusAgentKey(snapshot, agent)]);
        while (queue.length > 0) {
          const currentId = queue.shift();
          for (const candidate of snapshot.agents) {
            if (candidate.parentThreadId !== currentId || visited.has(candidate.id)) {
              continue;
            }
            visited.add(candidate.id);
            queue.push(candidate.id);
            keys.add(focusAgentKey(snapshot, candidate));
          }
        }
        return [...keys];
      }

      function focusWrapperAttrs(snapshot, agent) {
        if (!agent) {
          return "";
        }
        return \` data-focus-agent="true" data-focus-key="\${escapeHtml(focusAgentKey(snapshot, agent))}" data-focus-keys="\${escapeHtml(JSON.stringify(collectFocusedSessionKeys(snapshot, agent)))}"\`;
      }

      function stationRoleLabel(role, count) {
        const normalized = String(role || "default").trim().toLowerCase().replace(/[_-]+/g, " ");
        const base =
          normalized === "default" ? "generalist"
          : normalized === "cloud" ? "cloud operator"
          : normalized;
        return titleCaseWords(pluralizePhrase(base, count));
      }

      function groupAgentsByRole(agents) {
        const buckets = new Map();
        for (const agent of agents) {
          const role = agentRole(agent);
          const list = buckets.get(role) || [];
          list.push(agent);
          buckets.set(role, list);
        }

        return [...buckets.entries()]
          .map(([role, roleAgents]) => ({
            role,
            agents: [...roleAgents].sort(compareAgentsByRecencyStable)
          }))
          .sort((left, right) => {
            if (right.agents.length !== left.agents.length) {
              return right.agents.length - left.agents.length;
            }
            return stationRoleLabel(left.role, left.agents.length)
              .localeCompare(stationRoleLabel(right.role, right.agents.length));
          });
      }

      function compareAgentsForDeskLayout(snapshot, left, right) {
        const leadDelta = Number(isLeadSession(snapshot, right)) - Number(isLeadSession(snapshot, left));
        if (leadDelta !== 0) {
          return leadDelta;
        }

        const depthDelta = left.depth - right.depth;
        if (depthDelta !== 0) {
          return depthDelta;
        }

        const parentDelta = String(left.parentThreadId || "").localeCompare(String(right.parentThreadId || ""));
        if (parentDelta !== 0) {
          return parentDelta;
        }

        const roleDelta = agentRole(left).localeCompare(agentRole(right));
        if (roleDelta !== 0) {
          return roleDelta;
        }

        const labelDelta = String(left.label || "").localeCompare(String(right.label || ""));
        if (labelDelta !== 0) {
          return labelDelta;
        }

        return String(left.id || "").localeCompare(String(right.id || ""));
      }

      function compareAgentsByRecencyStable(left, right) {
        const updatedAtDelta = String(right.updatedAt || "").localeCompare(String(left.updatedAt || ""));
        if (updatedAtDelta !== 0) {
          return updatedAtDelta;
        }
        return String(left.id || "").localeCompare(String(right.id || ""));
      }

      function roleTone(role) {
        const normalized = String(role || "default").toLowerCase();
        switch (normalized) {
          case "boss":
            return "#ffcf4d";
          case "worker":
            return "#4bd69f";
          case "explorer":
            return "#f5b74f";
          case "cloud":
            return "#98d8ff";
          case "claude":
            return "#ffab91";
          case "cursor":
            return "#9fd6a4";
          case "hermes":
            return "#f7c76b";
          case "openclaw":
            return "#7ad0b3";
          case "default":
            return "#f2ead7";
          default:
            if (normalized.includes("design") || normalized.includes("copy") || normalized.includes("writer")) {
              return "#ff9a7a";
            }
            if (normalized.includes("map") || normalized.includes("research") || normalized.includes("docs")) {
              return "#8cd5ff";
            }
            if (normalized.includes("review") || normalized.includes("qa")) {
              return "#ffd479";
            }
            return "#d7b7ff";
        }
      }

      function isBossOfficeCandidate(snapshot, agent) {
        return isLeadSession(snapshot, agent) && liveChildAgentsFor(snapshot, agent.id).length > 1;
      }

      function isRelationshipBossCandidate(snapshot, agent) {
        return isLeadSession(snapshot, agent) && childAgentsFor(snapshot, agent.id).length > 0;
      }

      function sortedBossOfficeAgents(snapshot, agents) {
        return [...agents].sort((left, right) => {
          const childDelta = liveChildAgentsFor(snapshot, right.id).length - liveChildAgentsFor(snapshot, left.id).length;
          if (childDelta !== 0) {
            return childDelta;
          }
          return compareAgentsForDeskLayout(snapshot, left, right);
        });
      }

      function previousSceneSlotId(snapshot, agent) {
        const sceneState = sceneStateForAgent(snapshot, agent.id);
        return sceneState && sceneState.slotId ? String(sceneState.slotId) : null;
      }

      function previousSceneMirrored(snapshot, agent) {
        const sceneState = sceneStateForAgent(snapshot, agent.id);
        return sceneState && typeof sceneState.mirrored === "boolean" ? sceneState.mirrored : null;
      }

      function assignAgentsToOfficeSlots(snapshot, agents, slots) {
        const sortedAgents = sortedBossOfficeAgents(snapshot, agents);
        const slotById = new Map(slots.map((slot) => [slot.id, slot]));
        const assignments = [];
        const usedSlots = new Set();
        const remaining = [];

        for (const agent of sortedAgents) {
          const previousSlotId = previousSceneSlotId(snapshot, agent);
          if (previousSlotId && slotById.has(previousSlotId) && !usedSlots.has(previousSlotId)) {
            assignments.push({ slot: slotById.get(previousSlotId), agent });
            usedSlots.add(previousSlotId);
            continue;
          }
          remaining.push(agent);
        }

        const freeSlots = slots.filter((slot) => !usedSlots.has(slot.id)).sort((left, right) => left.order - right.order);
        remaining.forEach((agent, index) => {
          const slot = freeSlots[index];
          if (slot) {
            assignments.push({ slot, agent });
          }
        });

        return assignments.sort((left, right) => left.slot.order - right.slot.order);
      }

      function assignAgentsToDeskSlots(snapshot, agents, slots) {
        const slotById = new Map(slots.map((slot) => [slot.id, slot]));
        const cubicles = new Map();
        slots.forEach((slot) => {
          const existing = cubicles.get(slot.cubicleId) || { id: slot.cubicleId, slots: [], agents: [] };
          existing.slots.push(slot);
          cubicles.set(slot.cubicleId, existing);
        });
        cubicles.forEach((cubicle) => {
          cubicle.slots.sort((left, right) => left.order - right.order);
        });

        const slotAgents = new Map();
        const remainingAgents = [];

        for (const agent of [...agents].sort((left, right) => compareAgentsForDeskLayout(snapshot, left, right))) {
          const previousSlotId = previousSceneSlotId(snapshot, agent);
          const slot = previousSlotId ? slotById.get(previousSlotId) : null;
          if (!slot) {
            remainingAgents.push(agent);
            continue;
          }
          const assigned = slotAgents.get(slot.id) || [];
          if (assigned.length >= (slot.capacity || 1)) {
            remainingAgents.push(agent);
            continue;
          }
          assigned.push(agent);
          slotAgents.set(slot.id, assigned);
          cubicles.get(slot.cubicleId)?.agents.push(agent);
        }

        const roleGroups = groupAgentsByRole(remainingAgents);
        for (const group of roleGroups) {
          const queue = [...group.agents];
          const preferredCubicles = [...cubicles.values()].sort((left, right) => {
            const leftRoles = new Set(left.agents.map((agent) => agentRole(agent)));
            const rightRoles = new Set(right.agents.map((agent) => agentRole(agent)));
            const leftMatches = leftRoles.has(group.role) ? 2 : leftRoles.size === 0 ? 1 : 0;
            const rightMatches = rightRoles.has(group.role) ? 2 : rightRoles.size === 0 ? 1 : 0;
            if (rightMatches !== leftMatches) {
              return rightMatches - leftMatches;
            }
            return left.slots[0].order - right.slots[0].order;
          });

          preferredCubicles.forEach((cubicle) => {
            while (queue.length > 0) {
              const nextSlot = cubicle.slots.find((slot) => {
                const assigned = slotAgents.get(slot.id) || [];
                return assigned.length < (slot.capacity || 1);
              });
              if (!nextSlot) {
                break;
              }
              const agent = queue.shift();
              const assigned = slotAgents.get(nextSlot.id) || [];
              assigned.push(agent);
              slotAgents.set(nextSlot.id, assigned);
              cubicle.agents.push(agent);
            }
          });
        }

        return [...slots]
          .filter((slot) => (slotAgents.get(slot.id) || []).length > 0)
          .map((slot) => ({
            slot,
            agents: slotAgents.get(slot.id)
              .slice(0, slot.capacity || 1)
              .sort((left, right) => {
                const leftMirrored = previousSceneMirrored(snapshot, left);
                const rightMirrored = previousSceneMirrored(snapshot, right);
                if (leftMirrored !== rightMirrored) {
                  if (leftMirrored === null) return 1;
                  if (rightMirrored === null) return -1;
                  return Number(leftMirrored) - Number(rightMirrored);
                }
                return compareAgentsForDeskLayout(snapshot, left, right);
              })
          }))
          .sort((left, right) => left.slot.order - right.slot.order);
      }

      function renderBossRelationshipLines(snapshot, roomId, roomPixelWidth, roomPixelHeight) {
        const lineEntries = [];
        for (const agent of snapshot.agents) {
          if (!isRelationshipBossCandidate(snapshot, agent)) {
            continue;
          }
          const bossScene = sceneStateForAgent(snapshot, agent.id);
          if (!bossScene || bossScene.roomId !== roomId) {
            continue;
          }
          const childStates = childAgentsFor(snapshot, agent.id)
            .map((child) => ({ child, sceneState: sceneStateForAgent(snapshot, child.id) }))
            .filter((entry) => entry.sceneState && entry.sceneState.roomId === roomId);
          if (childStates.length === 0) {
            continue;
          }
          const bossFocusKey = focusAgentKey(snapshot, agent);
          const startX = Math.round(Number(bossScene.avatarX) + Number(bossScene.avatarWidth || 18) * 0.62);
          const startY = Math.round(Number(bossScene.avatarY) + Number(bossScene.avatarHeight || 24) * 0.46);
          for (const entry of childStates) {
            const childScene = entry.sceneState;
            const endX = Math.round(Number(childScene.avatarX) + Number(childScene.avatarWidth || 18) * 0.4);
            const endY = Math.round(Number(childScene.avatarY) + Number(childScene.avatarHeight || 24) * 0.48);
            const controlOffset = Math.max(18, Math.round((endX - startX) * 0.35));
            const path = \`M \${startX} \${startY} C \${startX + controlOffset} \${startY}, \${endX - controlOffset} \${endY}, \${endX} \${endY}\`;
            lineEntries.push(
              \`<path class="relationship-line" data-focus-line="true" data-focus-boss-key="\${escapeHtml(bossFocusKey)}" d="\${path}" />\`
            );
          }
        }
        if (lineEntries.length === 0) {
          return "";
        }
        return \`<svg class="relationship-lines" viewBox="0 0 \${roomPixelWidth} \${roomPixelHeight}" preserveAspectRatio="none" aria-hidden="true"><defs><marker id="relationship-arrow-\${escapeHtml(roomId)}" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="rgba(255, 221, 120, 0.9)"></path></marker></defs>\${lineEntries.join("").replaceAll('class="relationship-line"', \`class="relationship-line" marker-end="url(#relationship-arrow-\${escapeHtml(roomId)})"\`)}</svg>\`;
      }

      function avatarForAgent(agent) {
        const roster = pixelOffice.avatars;
        return roster[stableHash(\`\${agent.appearance.id}:\${agentRole(agent)}:\${agent.id}\`) % roster.length];
      }

      function avatarVisualScaleForAgent(agent, baseScale = 1) {
        const normalizedBaseScale = Number.isFinite(baseScale) ? Number(baseScale) : 1;
        const rawDepth = Number(agent && agent.depth);
        const nestedDepth = Number.isFinite(rawDepth)
          ? Math.max(0, Math.min(8, Math.round(rawDepth)))
          : (agent && agent.parentThreadId ? 1 : 0);
        return normalizedBaseScale * Math.pow(0.75, nestedDepth);
      }

      function avatarVisualSizeForAgent(agent, baseScale = 1) {
        const avatar = avatarForAgent(agent);
        const scale = avatarVisualScaleForAgent(agent, baseScale);
        return {
          avatar,
          scale,
          width: Math.round(avatar.w * scale),
          height: Math.round(avatar.h * scale)
        };
      }

      function escapeHtml(value) {
        return String(value)
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;");
      }

`;
