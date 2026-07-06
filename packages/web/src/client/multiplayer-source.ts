export const MULTIPLAYER_SCRIPT = `
      const multiplayerPeerId = loadMultiplayerPeerId();
      const multiplayerDeviceId = loadMultiplayerDeviceId();
      const multiplayerPeers = new Map();
      let multiplayerSocket = null;
      let multiplayerModulePromise = null;
      let multiplayerBroadcastTimer = null;
      let multiplayerPruneTimer = null;
      let webCliTeamFleetSyncTimer = null;
      let pendingWebCliTeamFleet = null;
      const MULTIPLAYER_STALE_MS = 30000;
      const MULTIPLAYER_BROADCAST_DEBOUNCE_MS = 700;
      const WEB_CLI_TEAM_FLEET_SYNC_DEBOUNCE_MS = 1000;
      const MULTIPLAYER_NICKNAME_MAX_LENGTH = 12;
      const MULTIPLAYER_ACTIVE_AGENT_STATES = new Set([
        "editing",
        "running",
        "validating",
        "scanning",
        "thinking",
        "planning",
        "delegating",
        "waiting",
        "blocked"
      ]);

      function sanitizeMultiplayerField(value) {
        return typeof value === "string" ? value.trim() : "";
      }

      function sanitizeMultiplayerNickname(value) {
        return sanitizeMultiplayerField(value).slice(0, MULTIPLAYER_NICKNAME_MAX_LENGTH);
      }

      function hasMultiplayerCredentials(settings) {
        return Boolean(
          sanitizeMultiplayerField(settings && settings.host)
          && sanitizeMultiplayerField(settings && settings.room)
        );
      }

      function normalizeMultiplayerSettings(settings, options = {}) {
        const host = sanitizeMultiplayerField(settings && settings.host);
        const room = sanitizeMultiplayerField(settings && settings.room);
        const deviceId = sanitizeMultiplayerField(settings && settings.deviceId);
        const hasCredentials = Boolean(host && room);
        const fallbackEnabled = options && typeof options.fallbackEnabled === "boolean"
          ? options.fallbackEnabled
          : true;
        return {
          enabled: hasCredentials && (
            typeof (settings && settings.enabled) === "boolean"
              ? Boolean(settings && settings.enabled)
              : fallbackEnabled
          ),
          host,
          room,
          nickname: sanitizeMultiplayerNickname(settings && settings.nickname),
          deviceId,
          configured: hasCredentials
        };
      }

      function loadMultiplayerProjectShares() {
        try {
          const raw = window.localStorage.getItem(multiplayerProjectShareStorageKey);
          if (!raw) {
            return {};
          }
          const parsed = JSON.parse(raw);
          if (!parsed || typeof parsed !== "object") {
            return {};
          }
          const next = {};
          for (const [projectRoot, shared] of Object.entries(parsed)) {
            const normalizedRoot = sanitizeMultiplayerField(projectRoot);
            if (!normalizedRoot || shared !== true) {
              continue;
            }
            next[normalizedRoot] = true;
          }
          return next;
        } catch {
          return {};
        }
      }

      function saveMultiplayerProjectShares() {
        try {
          window.localStorage.setItem(
            multiplayerProjectShareStorageKey,
            JSON.stringify(state.multiplayerProjectShares || {})
          );
        } catch {}
      }

      function isProjectSharedWithRoom(projectRoot) {
        const normalizedRoot = sanitizeMultiplayerField(projectRoot);
        if (!normalizedRoot) {
          return false;
        }
        return state.multiplayerProjectShares?.[normalizedRoot] === true;
      }

      function setProjectRootsSharedWithRoom(projectRoots, shared) {
        const normalizedRoots = Array.from(new Set((Array.isArray(projectRoots) ? projectRoots : [])
          .map((projectRoot) => sanitizeMultiplayerField(projectRoot))
          .filter(Boolean)));
        if (normalizedRoots.length === 0) {
          return;
        }
        const nextShares = { ...(state.multiplayerProjectShares || {}) };
        for (const projectRoot of normalizedRoots) {
          if (shared === true) {
            nextShares[projectRoot] = true;
          } else {
            delete nextShares[projectRoot];
          }
        }
        state.multiplayerProjectShares = nextShares;
        saveMultiplayerProjectShares();
        applyFleet(state.localFleet);
        render();
        scheduleMultiplayerBroadcast();
      }

      function loadMultiplayerPeerId() {
        try {
          const existing = sanitizeMultiplayerField(window.sessionStorage.getItem(multiplayerPeerIdStorageKey));
          if (existing) {
            return existing;
          }
        } catch {}
        const generated = crypto && crypto.randomUUID ? crypto.randomUUID() : "peer-" + Math.random().toString(36).slice(2, 10);
        try {
          window.sessionStorage.setItem(multiplayerPeerIdStorageKey, generated);
        } catch {}
        return generated;
      }

      function loadMultiplayerDeviceId() {
        try {
          const existing = sanitizeMultiplayerField(window.localStorage.getItem(multiplayerDeviceIdStorageKey));
          if (existing) {
            return existing;
          }
        } catch {}
        const generated = crypto && crypto.randomUUID ? crypto.randomUUID() : "device-" + Math.random().toString(36).slice(2, 10);
        try {
          window.localStorage.setItem(multiplayerDeviceIdStorageKey, generated);
        } catch {}
        return generated;
      }

      function cloneValue(value) {
        if (typeof structuredClone === "function") {
          return structuredClone(value);
        }
        return JSON.parse(JSON.stringify(value));
      }

      function normalizeWorkspaceName(value) {
        return String(value || "").trim().toLowerCase();
      }

      function normalizeSharedRepoIdentity(value) {
        const trimmed = String(value || "").trim();
        if (!trimmed) {
          return "";
        }
        const sshMatch = trimmed.match(/^git@([^:]+):(.+)$/i);
        const normalized = sshMatch
          ? "https://" + sshMatch[1] + "/" + sshMatch[2]
          : trimmed;
        return normalized
          .replace(/\\.git$/i, "")
          .replace(/[\\\\/]+$/g, "")
          .toLowerCase();
      }

      function sharedRepoIdentityForSnapshot(snapshot) {
        const explicitRepoUrl = normalizeSharedRepoIdentity(snapshot && snapshot.projectIdentity && snapshot.projectIdentity.repoUrl || "");
        if (explicitRepoUrl) {
          return explicitRepoUrl;
        }
        const agents = Array.isArray(snapshot && snapshot.agents) ? snapshot.agents : [];
        for (const agent of agents) {
          const repoUrl = normalizeSharedRepoIdentity(agent && agent.git && agent.git.originUrl || "");
          if (repoUrl) {
            return repoUrl;
          }
        }
        return "";
      }

      function snapshotWorkspaceName(snapshot) {
        if (snapshot && typeof snapshot.projectLabel === "string" && snapshot.projectLabel.trim().length > 0) {
          return snapshot.projectLabel.trim();
        }
        const projectRoot = snapshot && typeof snapshot.projectRoot === "string" ? snapshot.projectRoot : "";
        const segments = projectRoot.split(/[\\\\/]/).filter(Boolean);
        return segments[segments.length - 1] || projectRoot || "workspace";
      }

      function snapshotWorkspaceKeys(snapshot) {
        const keys = [];
        const repoIdentity = sharedRepoIdentityForSnapshot(snapshot);
        if (repoIdentity) {
          keys.push("git-repo:" + repoIdentity);
        }
        const workspaceName = normalizeWorkspaceName(snapshotWorkspaceName(snapshot));
        if (workspaceName) {
          keys.push("workspace:" + workspaceName);
        }
        return keys;
      }

      function indexSharedSnapshotsByWorkspaceKey(snapshots) {
        const snapshotsByKey = new Map();
        for (const snapshot of Array.isArray(snapshots) ? snapshots : []) {
          for (const key of snapshotWorkspaceKeys(snapshot)) {
            if (!snapshotsByKey.has(key)) {
              snapshotsByKey.set(key, snapshot);
            }
          }
        }
        return snapshotsByKey;
      }

      function matchingLocalSharedSnapshot(localProjectsByKey, remoteSnapshot) {
        for (const key of snapshotWorkspaceKeys(remoteSnapshot)) {
          const localSnapshot = localProjectsByKey.get(key);
          if (localSnapshot) {
            return localSnapshot;
          }
        }
        return null;
      }

      function normalizeSharedPathCandidate(value) {
        let normalized = String(value || "").split("\\\\").join("/");
        while (normalized.endsWith("/")) {
          normalized = normalized.slice(0, -1);
        }
        return normalized;
      }

      function trimLeadingDotSegment(value) {
        if (value === "./") {
          return "";
        }
        if (value === ".") {
          return "";
        }
        if (value.startsWith("./")) {
          return value.slice(2);
        }
        return value;
      }

      function remapSharedPath(remoteProjectRoot, localProjectRoot, value) {
        if (typeof value !== "string" || value.trim().length === 0) {
          return null;
        }
        const normalizedValue = normalizeSharedPathCandidate(value);
        const normalizedRemoteRoot = normalizeSharedPathCandidate(remoteProjectRoot || "");
        const normalizedLocalRoot = normalizeSharedPathCandidate(localProjectRoot || "");
        if (!normalizedValue || !normalizedRemoteRoot || !normalizedLocalRoot) {
          return value;
        }
        if (normalizedValue === normalizedRemoteRoot) {
          return normalizedLocalRoot;
        }
        if (normalizedValue.startsWith(normalizedRemoteRoot + "/")) {
          return normalizedLocalRoot + normalizedValue.slice(normalizedRemoteRoot.length);
        }
        return value;
      }

      function remapSharedPaths(remoteProjectRoot, localProjectRoot, paths) {
        return Array.from(new Set((Array.isArray(paths) ? paths : [])
          .map((path) => remapSharedPath(remoteProjectRoot, localProjectRoot, path))
          .filter((path) => typeof path === "string" && path.length > 0)));
      }

      function roomMatchesRelativePath(roomPath, relativePathValue) {
        const roomCandidate = trimLeadingDotSegment(normalizeSharedPathCandidate(roomPath || "."));
        const relativeCandidate = trimLeadingDotSegment(normalizeSharedPathCandidate(relativePathValue || "."));
        if (!roomCandidate) {
          return true;
        }
        return relativeCandidate === roomCandidate || relativeCandidate.startsWith(roomCandidate + "/");
      }

      function roomIdForSharedPaths(snapshot, paths) {
        if (!snapshot || !snapshot.rooms || !Array.isArray(snapshot.rooms.rooms) || !Array.isArray(paths)) {
          return null;
        }
        const rooms = flattenRooms(snapshot.rooms.rooms);
        let bestRoom = null;
        let bestDepth = -1;
        for (const path of paths) {
          const relative = relativeLocation(snapshot.projectRoot, path);
          if (!relative) {
            continue;
          }
          for (const room of rooms) {
            if (!roomMatchesRelativePath(room.path, relative)) {
              continue;
            }
            const depth = trimLeadingDotSegment(normalizeSharedPathCandidate(room.path || ".")).split("/").filter(Boolean).length;
            if (depth > bestDepth) {
              bestRoom = room;
              bestDepth = depth;
            }
          }
        }
        return bestRoom ? bestRoom.id : null;
      }

      function sharedPeerLabel() {
        const nickname = sanitizeMultiplayerNickname(state.multiplayerSettings.nickname);
        return nickname || "Peer " + multiplayerPeerId.slice(0, 6);
      }

      function currentMultiplayerDeviceId() {
        return sanitizeMultiplayerField(state.multiplayerSettings && state.multiplayerSettings.deviceId) || multiplayerDeviceId;
      }

      function sharedLocalParticipantLabel() {
        const nickname = sanitizeMultiplayerNickname(state.multiplayerSettings.nickname);
        return nickname || "You";
      }

      function sharedRoomNote(peerCount) {
        const roomName = state.multiplayerSettings.room;
        return roomName
          ? "Shared room " + roomName + " · " + peerCount + " remote peer" + (peerCount === 1 ? "" : "s")
          : "Shared room connected · " + peerCount + " remote peer" + (peerCount === 1 ? "" : "s");
      }

      function ensureSnapshotNotes(snapshot) {
        if (!Array.isArray(snapshot.notes)) {
          snapshot.notes = [];
        }
        return snapshot.notes;
      }

      function ensureSnapshotSharedParticipants(snapshot) {
        if (!Array.isArray(snapshot.sharedParticipantLabels)) {
          snapshot.sharedParticipantLabels = [];
        }
        return snapshot.sharedParticipantLabels;
      }

      function setSnapshotSharedParticipants(snapshot, participantLabels) {
        snapshot.sharedParticipantLabels = Array.from(new Set((Array.isArray(participantLabels) ? participantLabels : [])
          .map((label) => sanitizeMultiplayerNickname(label) || sanitizeMultiplayerField(label))
          .filter(Boolean)))
          .sort((left, right) => left.localeCompare(right));
      }

      function setSnapshotSharedPeerCount(snapshot, peerCount) {
        const notes = ensureSnapshotNotes(snapshot).filter((note) =>
          typeof note !== "string"
          || (!note.startsWith("Shared room ") && !note.startsWith("Shared room connected"))
        );
        notes.push(sharedRoomNote(peerCount));
        snapshot.notes = notes;
      }

      function snapshotShareRoots(snapshot) {
        if (!snapshot) {
          return [];
        }
        if (typeof projectShareToggleRoots === "function") {
          return projectShareToggleRoots(snapshot);
        }
        const root = sanitizeMultiplayerField(snapshot.projectRoot);
        return root ? [root] : [];
      }

      function isSnapshotSharedWithRoom(snapshot) {
        const roots = snapshotShareRoots(snapshot);
        return roots.length > 0 && roots.every((projectRoot) => isProjectSharedWithRoom(projectRoot));
      }

      function isActiveSharedAgent(agent) {
        if (!agent || typeof agent !== "object") {
          return false;
        }
        if (agent.isCurrent === true || agent.isOngoing === true || agent.needsUser) {
          return true;
        }
        const state = String(agent.state || "").toLowerCase();
        if (MULTIPLAYER_ACTIVE_AGENT_STATES.has(state)) {
          return true;
        }
        return String(agent.statusText || "").toLowerCase() === "active"
          && state !== "idle"
          && state !== "done";
      }

      function snapshotActiveSharedAgents(snapshot) {
        return (Array.isArray(snapshot && snapshot.agents) ? snapshot.agents : [])
          .filter((agent) => isActiveSharedAgent(agent));
      }

      function snapshotHasActiveSharedAgents(snapshot) {
        return snapshotActiveSharedAgents(snapshot).length > 0;
      }

      function snapshotHasSharedData(snapshot) {
        if (!snapshot || typeof snapshot !== "object") {
          return false;
        }
        if (Array.isArray(snapshot.sharedParticipantLabels) && snapshot.sharedParticipantLabels.length > 0) {
          return true;
        }
        return Array.isArray(snapshot.agents) && snapshot.agents.some((agent) => agent && agent.network);
      }

      function fleetHasSharedData(fleet) {
        return Boolean(
          fleet
          && Array.isArray(fleet.projects)
          && fleet.projects.some((snapshot) => snapshotHasSharedData(snapshot))
        );
      }

      function scheduleWebCliTeamFleetSync(fleet) {
        if (screenshotMode || !fleet || typeof fetch !== "function") {
          return;
        }
        pendingWebCliTeamFleet = cloneValue(fleet);
        if (webCliTeamFleetSyncTimer) {
          clearTimeout(webCliTeamFleetSyncTimer);
        }
        webCliTeamFleetSyncTimer = setTimeout(() => {
          webCliTeamFleetSyncTimer = null;
          void syncWebCliTeamFleetNow();
        }, WEB_CLI_TEAM_FLEET_SYNC_DEBOUNCE_MS);
      }

      async function syncWebCliTeamFleetNow() {
        const fleet = pendingWebCliTeamFleet;
        pendingWebCliTeamFleet = null;
        if (!fleet) {
          return;
        }
        const hasSharedData = fleetHasSharedData(fleet);
        const payloadFleet = hasSharedData
          ? fleet
          : { generatedAt: fleet.generatedAt || new Date().toISOString(), projects: [] };
        try {
          await fetch("/api/web-cli/team-fleet", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-agents-office-web-cli-cache": "1"
            },
            body: JSON.stringify({
              fleet: payloadFleet,
              hasSharedData
            })
          });
        } catch {}
      }

      function activeSharedPeerCount() {
        const cutoff = Date.now() - MULTIPLAYER_STALE_MS;
        let count = 0;
        for (const peer of multiplayerPeers.values()) {
          if (peer.receivedAt >= cutoff) {
            count += 1;
          }
        }
        return count;
      }

      function multiplayerTransportRoom(value) {
        return encodeURIComponent(sanitizeMultiplayerField(value));
      }

      function setMultiplayerStatus(nextState, detail) {
        state.multiplayerStatus = {
          state: String(nextState || "disabled"),
          detail: String(detail || "")
        };
        syncMultiplayerSettingsUi();
      }

      function multiplayerLiveStatusDetail(room, host, peerCount) {
        const peerText = peerCount + " peer" + (peerCount === 1 ? "" : "s");
        const hiddenPeerText = peerCount > 0 && !fleetHasSharedData(state.fleet)
          ? " - no shared active matching projects"
          : "";
        return "Connected to " + room + " on " + host + " - " + peerText + hiddenPeerText;
      }

      function syncStoredMultiplayerSettings(settings) {
        const normalized = normalizeMultiplayerSettings(settings);
        state.multiplayerSettings = normalized;
        if (state.multiplayerDraftDirty !== true) {
          state.multiplayerDraft = {
            enabled: normalized.enabled,
            host: normalized.host,
            room: normalized.room,
            nickname: normalized.nickname,
            deviceId: normalized.deviceId,
            configured: normalized.configured
          };
        }
        syncMultiplayerSettingsUi();
        void refreshMultiplayerConnection();
      }

      function syncMultiplayerSettingsUi() {
        const draft = normalizeMultiplayerSettings(state.multiplayerDraft || state.multiplayerSettings);
        if (multiplayerEnabledButton instanceof HTMLButtonElement) {
          const enabled = state.multiplayerSettings.enabled === true;
          multiplayerEnabledButton.classList.toggle("active", enabled);
          multiplayerEnabledButton.setAttribute("aria-pressed", enabled ? "true" : "false");
          multiplayerEnabledButton.textContent = enabled ? "Sharing On" : "Sharing Off";
        }
        if (multiplayerHostInput instanceof HTMLInputElement && multiplayerHostInput.value !== draft.host) {
          multiplayerHostInput.value = draft.host;
        }
        if (multiplayerRoomInput instanceof HTMLInputElement && multiplayerRoomInput.value !== draft.room) {
          multiplayerRoomInput.value = draft.room;
        }
        if (multiplayerNicknameInput instanceof HTMLInputElement && multiplayerNicknameInput.value !== draft.nickname) {
          multiplayerNicknameInput.value = draft.nickname;
        }
        if (multiplayerSaveButton instanceof HTMLButtonElement) {
          multiplayerSaveButton.disabled = state.integrationSettingsPending === true;
        }
        if (multiplayerClearButton instanceof HTMLButtonElement) {
          multiplayerClearButton.disabled = state.integrationSettingsPending === true || !state.multiplayerSettings.configured;
        }
        if (multiplayerStatus instanceof HTMLElement) {
          multiplayerStatus.textContent = state.multiplayerStatus.detail;
          multiplayerStatus.dataset.state = state.multiplayerStatus.state;
        }
      }

      function isStaleSharedOngoingAgent(agent) {
        if (!agent || agent.isOngoing !== true) {
          return false;
        }
        const updatedAt = Date.parse(agent.updatedAt || "");
        return !Number.isFinite(updatedAt) || Date.now() - updatedAt > RESTING_DORMANT_MS;
      }

      function idleStatusTextForStaleSharedAgent(agent) {
        const activeStatuses = new Set(["active", "running", "editing", "validating", "planning", "thinking", "scanning", "claude"]);
        return activeStatuses.has(String(agent && agent.statusText || "")) ? "idle" : agent.statusText;
      }

      function mergeSharedAgent(localSnapshot, remoteSnapshot, agent, peer) {
        const cwd = remapSharedPath(remoteSnapshot.projectRoot, localSnapshot.projectRoot, agent.cwd);
        const paths = remapSharedPaths(remoteSnapshot.projectRoot, localSnapshot.projectRoot, agent.paths);
        const staleOngoing = isStaleSharedOngoingAgent(agent);
        return {
          ...agent,
          id: "shared:" + peer.peerId + ":" + agent.id,
          parentThreadId: agent.parentThreadId ? "shared:" + peer.peerId + ":" + agent.parentThreadId : null,
          threadId: agent.threadId ? "shared:" + peer.peerId + ":" + agent.threadId : null,
          taskId: agent.taskId ? "shared:" + peer.peerId + ":" + agent.taskId : null,
          cwd,
          paths,
          roomId: roomIdForSharedPaths(localSnapshot, paths.length > 0 ? paths : cwd ? [cwd] : []),
          resumeCommand: null,
          isCurrent: staleOngoing ? false : agent.isCurrent,
          isOngoing: staleOngoing ? false : agent.isOngoing,
          state: staleOngoing ? "idle" : agent.state,
          statusText: staleOngoing ? idleStatusTextForStaleSharedAgent(agent) : agent.statusText,
          stoppedAt: staleOngoing ? (agent.stoppedAt || agent.updatedAt || new Date().toISOString()) : agent.stoppedAt,
          goal: agent.goal || null,
          activityEvent: !staleOngoing && agent.activityEvent
            ? {
              ...agent.activityEvent,
              path: remapSharedPath(remoteSnapshot.projectRoot, localSnapshot.projectRoot, agent.activityEvent.path)
            }
            : null,
          needsUser: !staleOngoing && agent.needsUser
            ? {
              ...agent.needsUser,
              cwd: remapSharedPath(remoteSnapshot.projectRoot, localSnapshot.projectRoot, agent.needsUser.cwd) || undefined,
              grantRoot: remapSharedPath(remoteSnapshot.projectRoot, localSnapshot.projectRoot, agent.needsUser.grantRoot) || undefined
            }
            : null,
          network: {
            transport: "partykit",
            peerId: peer.peerId,
            peerLabel: peer.peerLabel,
            peerHost: state.multiplayerSettings.host || null,
            peerRoom: state.multiplayerSettings.room || null
          }
        };
      }

      function mergeSharedEvent(localSnapshot, remoteSnapshot, event, peer) {
        return {
          ...event,
          id: "shared:" + peer.peerId + ":" + event.id,
          threadId: event.threadId ? "shared:" + peer.peerId + ":" + event.threadId : null,
          path: remapSharedPath(remoteSnapshot.projectRoot, localSnapshot.projectRoot, event.path),
          cwd: remapSharedPath(remoteSnapshot.projectRoot, localSnapshot.projectRoot, event.cwd) || undefined,
          grantRoot: remapSharedPath(remoteSnapshot.projectRoot, localSnapshot.projectRoot, event.grantRoot) || undefined
        };
      }

      function uniqueSharedList(values) {
        return Array.from(new Set((Array.isArray(values) ? values : [])
          .map((value) => sanitizeMultiplayerField(value))
          .filter(Boolean)));
      }

      function mergeSharedHotChange(localSnapshot, remoteSnapshot, change, peer) {
        const branches = uniqueSharedList(change && change.branches);
        const branch = sanitizeMultiplayerField(change && change.branch) || branches[0] || null;
        const users = uniqueSharedList([...(change && Array.isArray(change.users) ? change.users : []), peer.peerLabel]);
        return {
          ...change,
          path: remapSharedPath(remoteSnapshot.projectRoot, localSnapshot.projectRoot, change && change.path) || (change && change.path) || "",
          branch,
          branches: branch && !branches.includes(branch) ? [branch, ...branches] : branches,
          users
        };
      }

      function mergeSharedActivity(localSnapshot, remoteSnapshot, peer) {
        const remoteHotChanges = remoteSnapshot && remoteSnapshot.activity && Array.isArray(remoteSnapshot.activity.hotChanges)
          ? remoteSnapshot.activity.hotChanges
          : [];
        if (remoteHotChanges.length === 0) {
          return;
        }
        if (!localSnapshot.activity || typeof localSnapshot.activity !== "object") {
          localSnapshot.activity = {
            generatedAt: localSnapshot.generatedAt || new Date().toISOString(),
            hotChanges: [],
            hotTools: [],
            runningCommands: []
          };
        }
        const currentHotChanges = Array.isArray(localSnapshot.activity.hotChanges) ? localSnapshot.activity.hotChanges : [];
        localSnapshot.activity.hotChanges = currentHotChanges
          .concat(remoteHotChanges.map((change) => mergeSharedHotChange(localSnapshot, remoteSnapshot, change, peer)))
          .sort((left, right) => Number(right && right.score || 0) - Number(left && left.score || 0))
          .slice(0, 12);
      }

      function sharedAgentIdentityKeys(agent) {
        const keys = [];
        if (!agent || typeof agent !== "object") {
          return keys;
        }
        if (typeof agent.id === "string" && agent.id.length > 0) {
          keys.push("id:" + agent.id);
        }
        if (typeof agent.threadId === "string" && agent.threadId.length > 0) {
          keys.push("thread:" + agent.threadId);
        }
        if (typeof agent.taskId === "string" && agent.taskId.length > 0) {
          keys.push("task:" + agent.taskId);
        }
        return keys;
      }

      function collectSharedAgentIdentityKeys(agents) {
        const keys = new Set();
        for (const agent of Array.isArray(agents) ? agents : []) {
          for (const key of sharedAgentIdentityKeys(agent)) {
            keys.add(key);
          }
        }
        return keys;
      }

      function buildSharedFleet(localFleet) {
        if (!localFleet) {
          return null;
        }
        const mergedFleet = cloneValue(localFleet);
        const localProjectsByKey = indexSharedSnapshotsByWorkspaceKey(mergedFleet.projects);
        let sharedPeerCount = 0;

        for (const peer of multiplayerPeers.values()) {
          if (Date.now() - peer.receivedAt > MULTIPLAYER_STALE_MS) {
            continue;
          }
          sharedPeerCount += 1;
          for (const remoteSnapshot of peer.projects) {
            const localSnapshot = matchingLocalSharedSnapshot(localProjectsByKey, remoteSnapshot);
            if (!localSnapshot || !isSnapshotSharedWithRoom(localSnapshot)) {
              continue;
            }
            const remoteAgents = snapshotActiveSharedAgents(remoteSnapshot);
            if (remoteAgents.length === 0) {
              continue;
            }
            const localAgentIdentityKeys = collectSharedAgentIdentityKeys(localSnapshot.agents);
            const mergedAgents = remoteAgents
              .filter((agent) => !sharedAgentIdentityKeys(agent).some((key) => localAgentIdentityKeys.has(key)))
              .map((agent) => mergeSharedAgent(localSnapshot, remoteSnapshot, agent, peer));
            const mergedEvents = (Array.isArray(remoteSnapshot.events) ? remoteSnapshot.events : [])
              .map((event) => mergeSharedEvent(localSnapshot, remoteSnapshot, event, peer));
            const remoteHotChanges = remoteSnapshot && remoteSnapshot.activity && Array.isArray(remoteSnapshot.activity.hotChanges)
              ? remoteSnapshot.activity.hotChanges
              : [];
            if (mergedAgents.length === 0 && mergedEvents.length === 0 && remoteHotChanges.length === 0) {
              continue;
            }
            localSnapshot.agents = localSnapshot.agents.concat(mergedAgents);
            localSnapshot.events = localSnapshot.events.concat(mergedEvents).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
            mergeSharedActivity(localSnapshot, remoteSnapshot, peer);
            const participantLabels = new Set(ensureSnapshotSharedParticipants(localSnapshot));
            participantLabels.add(peer.peerLabel);
            setSnapshotSharedParticipants(localSnapshot, [...participantLabels]);
          }
        }

        for (const snapshot of mergedFleet.projects) {
          if (Array.isArray(snapshot.sharedParticipantLabels) && snapshot.sharedParticipantLabels.length > 0) {
            setSnapshotSharedPeerCount(snapshot, sharedPeerCount);
          }
        }

        return {
          generatedAt: localFleet.generatedAt,
          projects: mergedFleet.projects
        };
      }

      function notificationFleetView(fleet) {
        if (!fleet) {
          return null;
        }
        return {
          ...fleet,
          projects: mergeWorktreeProjects(Array.isArray(fleet.projects) ? fleet.projects : [])
        };
      }

      function applyFleet(localFleet) {
        const fleet = buildSharedFleet(localFleet);
        if (!fleet) {
          return;
        }
        const nextFleetSemanticToken = fleetSemanticToken(fleet);
        if (nextFleetSemanticToken && nextFleetSemanticToken === lastFleetSemanticToken) {
          return;
        }
        const previousFleet = state.fleet;
        const previousNotificationFleet = notificationFleetView(previousFleet);
        const nextNotificationFleet = notificationFleetView(fleet);
        queueSnapshotEvents(previousNotificationFleet, nextNotificationFleet);
        queueAgentNotifications(previousNotificationFleet, nextNotificationFleet);
        state.fleet = fleet;
        scheduleWebCliTeamFleetSync(fleet);
        lastFleetSemanticToken = nextFleetSemanticToken;
        if (state.selected !== "all") {
          const exists = state.fleet.projects.some((project) => project.projectRoot === state.selected);
          if (!exists) {
            state.selected = "all";
            state.workspaceFullscreen = false;
            syncUrl();
          }
        }
        render();
      }

      function pruneMultiplayerPeers() {
        const cutoff = Date.now() - MULTIPLAYER_STALE_MS;
        let changed = false;
        for (const [peerId, peer] of multiplayerPeers.entries()) {
          if (peer.receivedAt < cutoff) {
            multiplayerPeers.delete(peerId);
            changed = true;
          }
        }
        if (changed) {
          applyFleet(state.localFleet);
        }
        if (!state.multiplayerSettings.enabled) {
          setMultiplayerStatus("disabled", "Shared room sync is off.");
          return;
        }
        if (!state.multiplayerSettings.host || !state.multiplayerSettings.room) {
          setMultiplayerStatus("disabled", "Shared room sync is off.");
          return;
        }
        if (multiplayerSocket && multiplayerSocket.readyState === 1) {
          const peerCount = activeSharedPeerCount();
          setMultiplayerStatus("live", multiplayerLiveStatusDetail(state.multiplayerSettings.room, state.multiplayerSettings.host, peerCount));
        }
      }

      async function loadPartySocket() {
        if (!multiplayerModulePromise) {
          multiplayerModulePromise = import("/vendor/partysocket/index.js");
        }
        const module = await multiplayerModulePromise;
        return module.default || module.PartySocket || module;
      }

      function disconnectMultiplayer(options = {}) {
        if (multiplayerBroadcastTimer) {
          clearTimeout(multiplayerBroadcastTimer);
          multiplayerBroadcastTimer = null;
        }
        if (multiplayerSocket) {
          const socket = multiplayerSocket;
          multiplayerSocket = null;
          socket.close(1000, "reconfigure");
        }
        multiplayerPeers.clear();
        applyFleet(state.localFleet);
        if (!options.preserveStatus) {
          setMultiplayerStatus("disabled", "Shared room sync is off.");
        }
      }

      function buildMultiplayerPayload() {
        if (!state.localFleet) {
          return null;
        }
        const nickname = sanitizeMultiplayerNickname(state.multiplayerSettings.nickname);
        const localHatId = currentSelectedHatId();
        const sharedProjects = state.localFleet.projects
          .filter((snapshot) => isSnapshotSharedWithRoom(snapshot) && snapshotHasActiveSharedAgents(snapshot))
          .map((snapshot) => {
            const cloned = cloneValue(snapshot);
            cloned.agents = snapshotActiveSharedAgents(cloned).map((agent) => ({
              ...agent,
              hatId: localHatId
            }));
            return cloned;
          });
        return {
          type: "fleet-sync",
          peerId: multiplayerPeerId,
          deviceId: currentMultiplayerDeviceId(),
          peerLabel: nickname || sharedPeerLabel(),
          nickname,
          sentAt: new Date().toISOString(),
          projects: sharedProjects
        };
      }

      function broadcastLocalFleetNow() {
        if (!multiplayerSocket || multiplayerSocket.readyState !== 1) {
          return;
        }
        const payload = buildMultiplayerPayload();
        if (!payload) {
          return;
        }
        multiplayerSocket.send(JSON.stringify(payload));
      }

      function scheduleMultiplayerBroadcast() {
        if (!multiplayerSocket || multiplayerSocket.readyState !== 1) {
          return;
        }
        if (multiplayerBroadcastTimer) {
          clearTimeout(multiplayerBroadcastTimer);
        }
        multiplayerBroadcastTimer = setTimeout(() => {
          multiplayerBroadcastTimer = null;
          broadcastLocalFleetNow();
        }, MULTIPLAYER_BROADCAST_DEBOUNCE_MS);
      }

      function handleMultiplayerMessage(raw) {
        let payload = null;
        try {
          payload = JSON.parse(raw);
        } catch {
          return;
        }
        if (
          !payload
          || payload.type !== "fleet-sync"
          || payload.peerId === multiplayerPeerId
          || payload.deviceId === currentMultiplayerDeviceId()
          || !Array.isArray(payload.projects)
        ) {
          return;
        }
        const peerLabel = sanitizeMultiplayerNickname(payload.nickname) || sanitizeMultiplayerField(payload.peerLabel) || "Peer";
        multiplayerPeers.set(payload.peerId, {
          peerId: String(payload.peerId),
          peerLabel,
          receivedAt: Date.now(),
          projects: payload.projects
        });
        applyFleet(state.localFleet);
        pruneMultiplayerPeers();
      }

      async function refreshMultiplayerConnection() {
        if (screenshotMode) {
          disconnectMultiplayer({ preserveStatus: true });
          setMultiplayerStatus("disabled", "Shared room sync is disabled in screenshot mode.");
          return;
        }
        if (!state.multiplayerSettings.enabled) {
          disconnectMultiplayer();
          return;
        }
        const host = sanitizeMultiplayerField(state.multiplayerSettings.host);
        const room = sanitizeMultiplayerField(state.multiplayerSettings.room);
        const transportRoom = multiplayerTransportRoom(room);
        if (!host || !room) {
          disconnectMultiplayer();
          return;
        }

        disconnectMultiplayer({ preserveStatus: true });
        setMultiplayerStatus("connecting", "Connecting to " + room + " on " + host + "…");

        try {
          const PartySocket = await loadPartySocket();
          const socket = new PartySocket({
            host,
            room: transportRoom,
            id: multiplayerPeerId
          });
          multiplayerSocket = socket;
          socket.addEventListener("open", () => {
            if (multiplayerSocket !== socket) {
              return;
            }
            const peerCount = activeSharedPeerCount();
            setMultiplayerStatus("live", multiplayerLiveStatusDetail(room, host, peerCount));
            broadcastLocalFleetNow();
          });
          socket.addEventListener("message", (event) => {
            if (multiplayerSocket !== socket) {
              return;
            }
            handleMultiplayerMessage(event.data);
          });
          socket.addEventListener("close", () => {
            if (multiplayerSocket !== socket) {
              return;
            }
            setMultiplayerStatus("reconnecting", "Reconnecting to " + room + " on " + host + "…");
          });
          socket.addEventListener("error", () => {
            if (multiplayerSocket !== socket) {
              return;
            }
            setMultiplayerStatus("error", "Shared room connection failed for " + room + " on " + host + ".");
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          setMultiplayerStatus("error", "Shared room setup failed: " + message);
        }
      }

      function commitMultiplayerSettings(nextSettings) {
        const previousConfigured = Boolean(
          (state.multiplayerDraft && state.multiplayerDraft.configured)
          || (state.multiplayerSettings && state.multiplayerSettings.configured)
        );
        const fallbackEnabled = previousConfigured
          ? Boolean(
            (state.multiplayerDraft && state.multiplayerDraft.enabled)
            || (state.multiplayerSettings && state.multiplayerSettings.enabled)
          )
          : true;
        const normalized = normalizeMultiplayerSettings(nextSettings, { fallbackEnabled });
        state.multiplayerDraft = {
          enabled: normalized.enabled,
          host: normalized.host,
          room: normalized.room,
          nickname: normalized.nickname,
          deviceId: normalized.deviceId,
          configured: normalized.configured
        };
        state.multiplayerDraftDirty = true;
        syncMultiplayerSettingsUi();
      }
`;
