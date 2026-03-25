export const MULTIPLAYER_SCRIPT = `
      const multiplayerPeerId = loadMultiplayerPeerId();
      const multiplayerPeers = new Map();
      let multiplayerSocket = null;
      let multiplayerModulePromise = null;
      let multiplayerBroadcastTimer = null;
      let multiplayerPruneTimer = null;
      const MULTIPLAYER_STALE_MS = 30000;
      const MULTIPLAYER_BROADCAST_DEBOUNCE_MS = 700;
      const MULTIPLAYER_NICKNAME_MAX_LENGTH = 12;

      function sanitizeMultiplayerField(value) {
        return typeof value === "string" ? value.trim() : "";
      }

      function sanitizeMultiplayerNickname(value) {
        return sanitizeMultiplayerField(value).slice(0, MULTIPLAYER_NICKNAME_MAX_LENGTH);
      }

      function loadMultiplayerSettings() {
        try {
          const raw = window.localStorage.getItem(multiplayerSettingsStorageKey);
          if (!raw) {
            return { host: "", room: "", nickname: "" };
          }
          const parsed = JSON.parse(raw);
          return {
            host: sanitizeMultiplayerField(parsed && parsed.host),
            room: sanitizeMultiplayerField(parsed && parsed.room),
            nickname: sanitizeMultiplayerNickname(parsed && parsed.nickname)
          };
        } catch {
          return { host: "", room: "", nickname: "" };
        }
      }

      function saveMultiplayerSettings() {
        try {
          window.localStorage.setItem(multiplayerSettingsStorageKey, JSON.stringify(state.multiplayerSettings));
        } catch {}
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

      function cloneValue(value) {
        if (typeof structuredClone === "function") {
          return structuredClone(value);
        }
        return JSON.parse(JSON.stringify(value));
      }

      function normalizeWorkspaceName(value) {
        return String(value || "").trim().toLowerCase();
      }

      function snapshotWorkspaceName(snapshot) {
        if (snapshot && typeof snapshot.projectLabel === "string" && snapshot.projectLabel.trim().length > 0) {
          return snapshot.projectLabel.trim();
        }
        const projectRoot = snapshot && typeof snapshot.projectRoot === "string" ? snapshot.projectRoot : "";
        const segments = projectRoot.split(/[\\\\/]/).filter(Boolean);
        return segments[segments.length - 1] || projectRoot || "workspace";
      }

      function snapshotWorkspaceKey(snapshot) {
        return normalizeWorkspaceName(snapshotWorkspaceName(snapshot));
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

      function setMultiplayerStatus(nextState, detail) {
        state.multiplayerStatus = {
          state: String(nextState || "disabled"),
          detail: String(detail || "")
        };
        syncMultiplayerSettingsUi();
      }

      function syncMultiplayerSettingsUi() {
        if (multiplayerHostInput instanceof HTMLInputElement && multiplayerHostInput.value !== state.multiplayerSettings.host) {
          multiplayerHostInput.value = state.multiplayerSettings.host;
        }
        if (multiplayerRoomInput instanceof HTMLInputElement && multiplayerRoomInput.value !== state.multiplayerSettings.room) {
          multiplayerRoomInput.value = state.multiplayerSettings.room;
        }
        if (multiplayerNicknameInput instanceof HTMLInputElement && multiplayerNicknameInput.value !== state.multiplayerSettings.nickname) {
          multiplayerNicknameInput.value = state.multiplayerSettings.nickname;
        }
        if (multiplayerStatus instanceof HTMLElement) {
          multiplayerStatus.textContent = state.multiplayerStatus.detail;
          multiplayerStatus.dataset.state = state.multiplayerStatus.state;
        }
      }

      function mergeSharedAgent(localSnapshot, remoteSnapshot, agent, peer) {
        const cwd = remapSharedPath(remoteSnapshot.projectRoot, localSnapshot.projectRoot, agent.cwd);
        const paths = remapSharedPaths(remoteSnapshot.projectRoot, localSnapshot.projectRoot, agent.paths);
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
          activityEvent: agent.activityEvent
            ? {
              ...agent.activityEvent,
              path: remapSharedPath(remoteSnapshot.projectRoot, localSnapshot.projectRoot, agent.activityEvent.path)
            }
            : null,
          needsUser: agent.needsUser
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
            peerHost: state.multiplayerSettings.host || null
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

      function buildSharedFleet(localFleet) {
        if (!localFleet) {
          return null;
        }
        const mergedFleet = cloneValue(localFleet);
        const localProjectsByKey = new Map(mergedFleet.projects.map((snapshot) => [snapshotWorkspaceKey(snapshot), snapshot]));
        const roomName = state.multiplayerSettings.room;
        let sharedPeerCount = 0;

        for (const peer of multiplayerPeers.values()) {
          if (Date.now() - peer.receivedAt > MULTIPLAYER_STALE_MS) {
            continue;
          }
          sharedPeerCount += 1;
          for (const remoteSnapshot of peer.projects) {
            const localSnapshot = localProjectsByKey.get(snapshotWorkspaceKey(remoteSnapshot));
            if (!localSnapshot) {
              continue;
            }
            const mergedAgents = (Array.isArray(remoteSnapshot.agents) ? remoteSnapshot.agents : [])
              .map((agent) => mergeSharedAgent(localSnapshot, remoteSnapshot, agent, peer));
            const mergedEvents = (Array.isArray(remoteSnapshot.events) ? remoteSnapshot.events : [])
              .map((event) => mergeSharedEvent(localSnapshot, remoteSnapshot, event, peer));
            if (mergedAgents.length === 0 && mergedEvents.length === 0) {
              continue;
            }
            localSnapshot.agents = localSnapshot.agents.concat(mergedAgents);
            localSnapshot.events = localSnapshot.events.concat(mergedEvents).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
            const sharedNote = roomName
              ? "Shared room " + roomName + " · " + sharedPeerCount + " remote peer" + (sharedPeerCount === 1 ? "" : "s")
              : "Shared room connected · " + sharedPeerCount + " remote peer" + (sharedPeerCount === 1 ? "" : "s");
            if (!localSnapshot.notes.includes(sharedNote)) {
              localSnapshot.notes.push(sharedNote);
            }
          }
        }

        return {
          generatedAt: localFleet.generatedAt,
          projects: mergedFleet.projects
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
        queueSnapshotEvents(previousFleet, fleet);
        queueAgentNotifications(previousFleet, fleet);
        state.fleet = fleet;
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
        if (!state.multiplayerSettings.host || !state.multiplayerSettings.room) {
          setMultiplayerStatus("disabled", "Shared room sync is off.");
          return;
        }
        if (multiplayerSocket && multiplayerSocket.readyState === 1) {
          const peerCount = activeSharedPeerCount();
          setMultiplayerStatus("live", "Connected to " + state.multiplayerSettings.room + " on " + state.multiplayerSettings.host + " · " + peerCount + " peer" + (peerCount === 1 ? "" : "s"));
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
        return {
          type: "fleet-sync",
          peerId: multiplayerPeerId,
          peerLabel: nickname || sharedPeerLabel(),
          nickname,
          sentAt: new Date().toISOString(),
          projects: state.localFleet.projects
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
        if (!payload || payload.type !== "fleet-sync" || payload.peerId === multiplayerPeerId || !Array.isArray(payload.projects)) {
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
        const host = sanitizeMultiplayerField(state.multiplayerSettings.host);
        const room = sanitizeMultiplayerField(state.multiplayerSettings.room);
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
            room,
            id: multiplayerPeerId
          });
          multiplayerSocket = socket;
          socket.addEventListener("open", () => {
            if (multiplayerSocket !== socket) {
              return;
            }
            const peerCount = activeSharedPeerCount();
            setMultiplayerStatus("live", "Connected to " + room + " on " + host + " · " + peerCount + " peer" + (peerCount === 1 ? "" : "s"));
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
        state.multiplayerSettings = {
          host: sanitizeMultiplayerField(nextSettings && nextSettings.host),
          room: sanitizeMultiplayerField(nextSettings && nextSettings.room),
          nickname: sanitizeMultiplayerNickname(nextSettings && nextSettings.nickname)
        };
        saveMultiplayerSettings();
        syncMultiplayerSettingsUi();
        void refreshMultiplayerConnection();
      }
`;
