export const CLIENT_RUNTIME_SCENE_SOURCE = `      function buildLeadClusters(occupants) {
        const ordered = sortAgentsStably("lead-clusters", occupants);
        const byId = new Map(ordered.map((agent) => [agent.id, agent]));
        const buckets = new Map();
        const leads = [];

        for (const agent of ordered) {
          if (agent.parentThreadId && byId.has(agent.parentThreadId)) {
            const list = buckets.get(agent.parentThreadId) || [];
            list.push(agent);
            buckets.set(agent.parentThreadId, list);
            continue;
          }
          leads.push(agent);
        }

        return leads.map((lead) => ({
          lead,
          children: [...(buckets.get(lead.id) || [])].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        }));
      }

      const stableSceneOrderMemory = new Map();
      const OFFICE_MOTION_DEFAULT_DELTA_MS = 16;
      const OFFICE_MOTION_MAX_DELTA_MS = 50;
      const OFFICE_MOTION_REBUILD_DELTA_CLAMP_MS = 120;
      const OFFICE_MOTION_SAMPLE_LIMIT = 90;
      const OFFICE_MOTION_WARN_SPEED_MULTIPLIER = 1.8;
      const OFFICE_MOTION_WARN_ABSOLUTE_SPEED = 360;

      function officeMotionFrameDeltaMs(renderer, now) {
        const rawDeltaMs = Number(renderer && renderer.app && renderer.app.ticker && renderer.app.ticker.deltaMS);
        const clampedDeltaMs = Number.isFinite(rawDeltaMs) && rawDeltaMs > 0
          ? Math.min(rawDeltaMs, OFFICE_MOTION_MAX_DELTA_MS)
          : OFFICE_MOTION_DEFAULT_DELTA_MS;
        const clampUntil = Number(renderer && renderer.motionDeltaClampUntil) || 0;
        if (Number.isFinite(now) && now < clampUntil) {
          return Math.min(clampedDeltaMs, OFFICE_MOTION_DEFAULT_DELTA_MS);
        }
        return clampedDeltaMs;
      }

      function recordOfficeMotionSample(renderer, entry, mode, beforeX, beforeY, afterX, afterY, deltaMs, expectedSpeed) {
        const distancePx = Math.hypot(Number(afterX) - Number(beforeX), Number(afterY) - Number(beforeY));
        if (!renderer || !entry || !Number.isFinite(distancePx) || distancePx <= 0.05) {
          return;
        }
        const safeDeltaMs = Math.max(1, Number(deltaMs) || OFFICE_MOTION_DEFAULT_DELTA_MS);
        const speedPxPerSec = distancePx * 1000 / safeDeltaMs;
        const routeLength = Array.isArray(entry.route) ? entry.route.length : 0;
        const sample = {
          at: new Date().toISOString(),
          key: String(entry.key || ""),
          mode: String(mode || "motion"),
          distancePx: Math.round(distancePx * 10) / 10,
          deltaMs: Math.round(safeDeltaMs * 10) / 10,
          speedPxPerSec: Math.round(speedPxPerSec),
          expectedSpeed: Math.round(Number(expectedSpeed) || 0),
          routeIndex: Number.isFinite(entry.routeIndex) ? Number(entry.routeIndex) : 0,
          routeLength
        };
        const samples = Array.isArray(renderer.motionDebugSamples) ? renderer.motionDebugSamples : [];
        samples.push(sample);
        while (samples.length > OFFICE_MOTION_SAMPLE_LIMIT) {
          samples.shift();
        }
        renderer.motionDebugSamples = samples;
        if (typeof window !== "undefined") {
          window.__agentsOfficeMotionSamples = samples;
        }
        const expected = Math.max(Number(expectedSpeed) || 0, OFFICE_MOTION_WARN_ABSOLUTE_SPEED);
        const shouldWarn = speedPxPerSec > expected * OFFICE_MOTION_WARN_SPEED_MULTIPLIER;
        if (!shouldWarn) {
          return;
        }
        const warnKey = String(entry.key || "") + "::" + String(mode || "motion");
        const nowMs = Date.now();
        renderer.motionDebugWarnedAt = renderer.motionDebugWarnedAt || new Map();
        const lastWarnedAt = Number(renderer.motionDebugWarnedAt.get(warnKey) || 0);
        if (nowMs - lastWarnedAt < 2000) {
          return;
        }
        renderer.motionDebugWarnedAt.set(warnKey, nowMs);
        console.warn("office avatar motion spike", sample);
      }

      function sortAgentsStably(bucketKey, agents) {
        const cacheKey = String(bucketKey || "default");
        const previousOrder = stableSceneOrderMemory.get(cacheKey);
        const ordered = [...agents].sort((left, right) => {
          const leftIndex = previousOrder ? previousOrder.get(left.id) : undefined;
          const rightIndex = previousOrder ? previousOrder.get(right.id) : undefined;
          if (leftIndex !== undefined || rightIndex !== undefined) {
            if (leftIndex === undefined) {
              return 1;
            }
            if (rightIndex === undefined) {
              return -1;
            }
            if (leftIndex !== rightIndex) {
              return leftIndex - rightIndex;
            }
          }
          return compareAgentsByRecencyStable(left, right);
        });
        stableSceneOrderMemory.set(cacheKey, new Map(ordered.map((agent, index) => [agent.id, index])));
        return ordered;
      }

      function partitionAgents(agents, size) {
        const rows = [];
        for (let index = 0; index < agents.length; index += size) {
          rows.push(agents.slice(index, index + size));
        }
        return rows;
      }

      function buildClusterLayout(cluster, compact, leadBoothWidth, leadBoothHeight, childBoothWidth, childBoothHeight, availableWidth) {
        const labelHeight = compact ? 12 : 14;
        const roleGapY = compact ? 8 : 10;
        const boothGap = 6;
        const childCols = 2;
        const stripWidth = Math.min(
          availableWidth,
          Math.max(
            Math.round(leadBoothWidth * (compact ? 1.8 : 2)),
            childCols * childBoothWidth + (childCols - 1) * boothGap + (compact ? 10 : 14)
          )
        );
        const roleGroups = groupAgentsByRole(cluster.children);
        let cursorY = leadBoothHeight + (roleGroups.length > 0 ? roleGapY : 0);

        const groups = roleGroups.map((group) => {
          const columns = childCols;
          const rows = Math.max(1, Math.ceil(group.agents.length / childCols));
          const showLabel = group.agents.length > 1;
          const visibleLabelHeight = showLabel ? labelHeight + 2 : 0;
          const width = stripWidth;
          const height = visibleLabelHeight + rows * childBoothHeight + (rows - 1) * boothGap;
          const layout = {
            ...group,
            x: 0,
            y: cursorY,
            width,
            height,
            columns,
            labelHeight,
            showLabel,
            labelOffset: visibleLabelHeight
          };
          cursorY += height + roleGapY;
          return layout;
        });

        return {
          lead: cluster.lead,
          children: cluster.children,
          groups,
          width: stripWidth,
          height: groups.length > 0 ? cursorY - roleGapY : leadBoothHeight
        };
      }

      function restingAgentsFor(snapshot, compact) {
        return sortAgentsStably(
          \`\${snapshot.projectRoot}::\${compact ? "compact-resting" : "resting"}\`,
          snapshot.agents
            .filter((agent) => isFinishedLeadForRec(agent) && !isFloatingOrchestratorAgent(agent))
        );
      }

      function isFloatingOrchestratorAgent(agent) {
        return agent
          && (
            (agent.source === "hermes" && agent.sourceKind === "hermes:roaming")
            || (agent.source === "openclaw" && agent.sourceKind === "openclaw:roaming")
          );
      }

      function chairSpriteForAgent(agent) {
        return pixelOffice.chairs[stableHash(agent.id) % pixelOffice.chairs.length];
      }

      function wallsideWaitingSlotAt(index, compact, roomPixelWidth, walkwayY) {
        const columns = compact ? 4 : 5;
        const column = index % columns;
        const row = Math.floor(index / columns);
        const startX = compact ? 78 : 96;
        const stepX = compact ? 26 : 32;
        const stepY = compact ? 14 : 17;
        return {
          x: Math.min(roomPixelWidth - (compact ? 118 : 144), startX + column * stepX),
          y: walkwayY + (compact ? 2 : 4) + row * stepY + (column % 2 === 0 ? 0 : 2),
          flip: (index + row) % 2 === 1
        };
      }

      const OFFICE_WALL_HEAT_HALF_LIFE_MS = 3 * 60 * 1000;

      function officeWallGeneratedAtMs(snapshot) {
        const activityGeneratedAt = Date.parse(snapshot && snapshot.activity && snapshot.activity.generatedAt || "");
        if (Number.isFinite(activityGeneratedAt)) {
          return activityGeneratedAt;
        }
        const snapshotGeneratedAt = Date.parse(snapshot && snapshot.generatedAt || "");
        return Number.isFinite(snapshotGeneratedAt) ? snapshotGeneratedAt : Date.now();
      }

      function officeWallDecayedHeat(snapshot, entry) {
        const ageMs = Math.max(0, Date.now() - officeWallGeneratedAtMs(snapshot));
        const decay = Math.pow(0.5, ageMs / OFFICE_WALL_HEAT_HALF_LIFE_MS);
        const score = Number(entry && entry.score);
        const rawHeat = Number.isFinite(score)
          ? score * decay * 4
          : (Number(entry && entry.heat) || 0) * decay;
        const clamped = Math.max(1, Math.min(100, rawHeat));
        return Math.round(clamped * 10) / 10;
      }

      function buildOfficeWallDashboardData(snapshot) {
        const counts = countsForSnapshot(snapshot);
        const activity = activityWallSnapshot(snapshot);
        const hotChanges = activity.hotChanges;
        const hotGrid = [];
        const columns = ["script", "doc", "media"];

        columns.forEach((column) => {
          hotChanges
            .filter((entry) => (entry && entry.fileType) === column)
            .slice(0, 3)
            .forEach((entry, index) => {
              const label = activityWallItemName(entry.label || entry.path, activityWallPath(snapshot, entry.path));
              hotGrid.push({
                kind: "file",
                column,
                label,
                path: entry.path || "",
                displayPath: activityWallPath(snapshot, entry.path),
                branch: entry.branch || null,
                branches: Array.isArray(entry.branches) ? entry.branches : [],
                users: Array.isArray(entry.users) ? entry.users : [],
                updatedAt: entry.lastChangedAt || "",
                tone: column,
                heat: officeWallDecayedHeat(snapshot, entry),
                score: Number(entry.score) || 0,
                generatedAtMs: officeWallGeneratedAtMs(snapshot),
                colorIndex: index
              });
            });
        });

        return {
          title: "Hot",
          counts,
          generatedAtMs: officeWallGeneratedAtMs(snapshot),
          fileCount: hotChanges.length,
          hotGrid
        };
      }

      function buildOfficeWallDashboardModel(snapshot, room, roomX, roomY, roomPixelWidth, wallHeight, entrance, tile, compact) {
        const leftEdge = roomX + Math.round(tile * 0.75);
        const rightEdge = roomX + Math.round(entrance.centerDoorX - tile * 0.6);
        const availableWidth = Math.max(0, rightEdge - leftEdge);
        if (availableWidth < tile * 5) {
          return null;
        }
        const width = Math.min(availableWidth, compact ? tile * 8 : tile * 9);
        const height = Math.min(compact ? 34 : 38, Math.max(32, wallHeight - 16));
        const x = leftEdge + Math.max(0, Math.round((availableWidth - width) / 2));
        const y = roomY + Math.max(5, Math.round((wallHeight - height) / 2));
        return {
          id: room.id + "::wall-dashboard",
          roomId: room.id,
          x,
          y,
          width,
          height,
          ...buildOfficeWallDashboardData(snapshot)
        };
      }

      function officeWallDashboardSceneToken(snapshot) {
        const data = buildOfficeWallDashboardData(snapshot);
        return JSON.stringify({
          title: data.title,
          counts: data.counts,
          fileCount: data.fileCount,
          hotGrid: data.hotGrid.map((row) => ({
            kind: row.kind,
            column: row.column,
            label: row.label,
            path: row.path,
            displayPath: row.displayPath,
            branch: row.branch,
            branches: row.branches,
            users: row.users,
            updatedAt: row.updatedAt,
            tone: row.tone,
            score: row.score,
            colorIndex: row.colorIndex
          }))
        });
      }

      function isUtilityRoom(room) {
        if (!room || room.path === ".") {
          return false;
        }
        const label = \`\${room.name || ""} \${room.path || ""}\`.toLowerCase();
        return ["docs", "packages"].some((segment) => label === segment || label.includes(\` \${segment}\`) || label.includes(\`/\${segment}\`));
      }

      function buildSceneRooms(rooms) {
        const visibleRooms = [];
        const roomAlias = new Map();

        function visit(room, parentVisibleId = null) {
          const suppress = parentVisibleId !== null && isUtilityRoom(room);
          const visibleId = suppress ? parentVisibleId : room.id;
          roomAlias.set(room.id, visibleId);
          if (!suppress) {
            visibleRooms.push(room);
          }
          if (Array.isArray(room.children)) {
            room.children.forEach((child) => visit(child, visibleId));
          }
        }

        rooms.forEach((room) => visit(room, null));

        const primaryRoomId = visibleRooms.find((room) => room.path === "." || room.id === "root")?.id || visibleRooms[0]?.id || null;
        visibleRooms.sort((left, right) => (right.width * right.height) - (left.width * left.height));
        return { visibleRooms, roomAlias, primaryRoomId };
      }

      const OFFICE_WALL_FILE_MAX_AGE_MS = 10 * 60 * 1000;
      const OFFICE_WALL_COMMAND_MAX_AGE_MS = 12 * 60 * 1000;
      const OFFICE_WALL_FILE_LIMIT = 3;
      const OFFICE_WALL_COMMAND_LIMIT = 2;

      function officeWallEventTimeMs(event) {
        const createdAtMs = Date.parse(event && event.createdAt || "");
        return Number.isFinite(createdAtMs) ? createdAtMs : 0;
      }

      function officeWallShortText(value, maxLength = 32) {
        const normalized = String(value || "").replace(/\\s+/g, " ").trim();
        const limit = Math.max(8, Number(maxLength) || 32);
        if (normalized.length <= limit) {
          return normalized;
        }
        return normalized.slice(0, limit - 3).trimEnd() + "...";
      }

      function officeWallPathRoomId(snapshot, location, rooms, primaryRoomId) {
        const clean = relativeLocation(snapshot && snapshot.projectRoot, String(location || ""));
        if (!clean || clean === ".") {
          return primaryRoomId;
        }
        let bestRoomId = primaryRoomId;
        let bestScore = -1;
        for (const room of rooms || []) {
          const roomPath = String(room && room.path || ".");
          if (roomPath === ".") {
            continue;
          }
          if (clean === roomPath || clean.startsWith(roomPath + "/")) {
            const score = roomPath.length;
            if (score > bestScore) {
              bestRoomId = room.id;
              bestScore = score;
            }
          }
        }
        return bestRoomId;
      }

      function officeWallEventRoomId(snapshot, event, agentsByThreadId, rooms, roomAlias, primaryRoomId) {
        const agent = event && event.threadId ? agentsByThreadId.get(event.threadId) : null;
        if (agent && agent.roomId) {
          return roomAlias.get(agent.roomId) || agent.roomId || primaryRoomId;
        }
        return officeWallPathRoomId(snapshot, event && (event.path || event.cwd || event.grantRoot), rooms, primaryRoomId);
      }

      function officeWallFileEntry(snapshot, event, createdAtMs) {
        const path = event && event.path ? event.path : null;
        const fallback = event && (event.detail || event.title) ? (event.detail || event.title) : "Files";
        const label = notificationFileName(snapshot.projectRoot, path || fallback, fallback) || "files";
        const deltas = [];
        if (Number.isFinite(event && event.linesAdded) && Number(event.linesAdded) > 0) {
          deltas.push("+" + Math.max(0, Number(event.linesAdded)));
        }
        if (Number.isFinite(event && event.linesRemoved) && Number(event.linesRemoved) > 0) {
          deltas.push("-" + Math.max(0, Number(event.linesRemoved)));
        }
        return {
          key: "file::" + (path || event.itemId || event.id || label),
          text: officeWallShortText(label, 28),
          meta: deltas.join(" "),
          at: createdAtMs
        };
      }

      function officeWallCommandEntry(snapshot, key, text, createdAtMs, active = false) {
        const normalized = normalizeDisplayText(snapshot.projectRoot, text || "Command") || "Command";
        return {
          key,
          text: officeWallShortText(normalized, 34),
          meta: active ? "now" : "",
          at: createdAtMs
        };
      }

      function buildOfficeWallActivity(snapshot, roomId, rooms, roomAlias, primaryRoomId) {
        const now = Date.now();
        const agentsByThreadId = new Map(
          (snapshot.agents || [])
            .filter((agent) => agent && agent.threadId)
            .map((agent) => [agent.threadId, agent])
        );
        const filesByKey = new Map();
        const commandGroups = new Map();

        for (const event of snapshot.events || []) {
          if (!event) {
            continue;
          }
          const createdAtMs = officeWallEventTimeMs(event);
          const ageMs = now - createdAtMs;
          const eventRoomId = officeWallEventRoomId(snapshot, event, agentsByThreadId, rooms, roomAlias, primaryRoomId);
          if (eventRoomId !== roomId) {
            continue;
          }
          if ((event.kind === "fileChange" || event.method === "turn/diff/updated") && ageMs >= 0 && ageMs <= OFFICE_WALL_FILE_MAX_AGE_MS) {
            const entry = officeWallFileEntry(snapshot, event, createdAtMs);
            const previous = filesByKey.get(entry.key);
            if (!previous || entry.at > previous.at) {
              filesByKey.set(entry.key, entry);
            }
          }
          if (event.kind === "command" && ageMs >= 0 && ageMs <= OFFICE_WALL_COMMAND_MAX_AGE_MS) {
            const groupKey = event.itemId || event.threadId || event.id;
            const previous = commandGroups.get(groupKey) || {
              key: "cmd::" + groupKey,
              text: "",
              at: 0,
              latestPhase: "started"
            };
            const text = event.command || event.detail || event.title || previous.text || "Command";
            if (createdAtMs >= previous.at) {
              commandGroups.set(groupKey, {
                key: previous.key,
                text,
                at: createdAtMs,
                latestPhase: event.phase || "updated"
              });
            } else if (!previous.text && text) {
              previous.text = text;
            }
          }
        }

        const commandsByKey = new Map();
        for (const agent of snapshot.agents || []) {
          if (!agent || !agent.roomId) {
            continue;
          }
          const agentRoomId = roomAlias.get(agent.roomId) || agent.roomId;
          if (agentRoomId !== roomId) {
            continue;
          }
          const isCommandAgent = agent.activityEvent && agent.activityEvent.type === "commandExecution";
          if (!isCommandAgent && agent.state !== "running" && agent.state !== "validating") {
            continue;
          }
          if (agent.isCurrent !== true && agent.isOngoing !== true) {
            continue;
          }
          const updatedAtMs = Date.parse(agent.updatedAt || "");
          const text = (agent.activityEvent && agent.activityEvent.title) || agent.detail || "Command";
          const entry = officeWallCommandEntry(snapshot, "agent::" + agent.id, text, Number.isFinite(updatedAtMs) ? updatedAtMs : now, true);
          commandsByKey.set(entry.key, entry);
        }

        for (const group of commandGroups.values()) {
          if (["completed", "failed", "interrupted"].includes(group.latestPhase)) {
            continue;
          }
          const entry = officeWallCommandEntry(snapshot, group.key, group.text, group.at, false);
          const duplicate = Array.from(commandsByKey.values()).some((current) => current.text === entry.text);
          if (!duplicate) {
            commandsByKey.set(entry.key, entry);
          }
        }

        return {
          files: Array.from(filesByKey.values())
            .sort((left, right) => right.at - left.at)
            .slice(0, OFFICE_WALL_FILE_LIMIT),
          commands: Array.from(commandsByKey.values())
            .sort((left, right) => right.at - left.at)
            .slice(0, OFFICE_WALL_COMMAND_LIMIT)
        };
      }

      function officeWallSceneToken(snapshot) {
        const now = Date.now();
        const eventTokens = (snapshot.events || [])
          .filter((event) => {
            const createdAtMs = officeWallEventTimeMs(event);
            const ageMs = now - createdAtMs;
            if (!Number.isFinite(createdAtMs) || ageMs < 0) {
              return false;
            }
            if (event.kind === "fileChange" || event.method === "turn/diff/updated") {
              return ageMs <= OFFICE_WALL_FILE_MAX_AGE_MS;
            }
            if (event.kind === "command") {
              return ageMs <= OFFICE_WALL_COMMAND_MAX_AGE_MS;
            }
            return false;
          })
          .slice(0, 48)
          .map(eventSnapshotToken);
        const commandAgentTokens = (snapshot.agents || [])
          .filter((agent) =>
            agent
            && (agent.state === "running" || agent.state === "validating" || (agent.activityEvent && agent.activityEvent.type === "commandExecution"))
            && (agent.isCurrent === true || agent.isOngoing === true)
          )
          .map((agent) => [
            agent.id,
            agent.roomId || "",
            agent.state || "",
            agent.updatedAt || "",
            agent.detail || "",
            agent.activityEvent && agent.activityEvent.title || ""
          ].join(":"));
        return eventTokens.concat(commandAgentTokens).join("||");
      }

      function renderTerminalSnapshot(snapshot) {
        const rooms = flattenRooms(snapshot.rooms.rooms);
        const lines = [
          \`$ codex-agents-office watch \${projectLabel(snapshot.projectRoot)}\`,
          "",
          \`PROJECT \${projectLabel(snapshot.projectRoot)}\`,
          \`UPDATED \${snapshot.generatedAt}\`,
          ""
        ];

        for (const room of rooms) {
          const occupants = snapshot.agents.filter((agent) => agent.roomId === room.id);
          lines.push(\`ROOM \${room.id}  path=\${room.path}  size=\${room.width}x\${room.height}  occupants=\${occupants.length}\`);
          if (occupants.length === 0) {
            lines.push("  (empty)");
          } else {
            for (const agent of occupants) {
              const leader = parentLabelFor(snapshot, agent);
              lines.push(\`  [\${agent.state}] \${agentRankLabel(snapshot, agent)}/\${agentRole(agent)} :: \${agent.label} :: \${normalizeDisplayText(snapshot.projectRoot, agent.detail)}\${leader ? \` :: lead=\${leader}\` : ""}\`);
            }
          }
          lines.push("");
        }

        const cloudAgents = snapshot.agents.filter((agent) => agent.source === "cloud");
        lines.push(\`CLOUD \${cloudAgents.length}\`);
        if (cloudAgents.length === 0) {
          lines.push("  (none)");
        } else {
          for (const agent of cloudAgents) {
            lines.push(\`  [cloud] \${agentRole(agent)} :: \${agent.label} :: \${normalizeDisplayText(snapshot.projectRoot, agent.detail)}\`);
          }
        }

        if (snapshot.notes.length > 0) {
          lines.push("", "NOTES");
          for (const note of snapshot.notes) {
            lines.push(\`  ! \${note}\`);
          }
        }

        const html = lines.map((line) => {
          const className = line.startsWith("$ ") ? "terminal-hot"
            : line.startsWith("  ! ") ? "terminal-warn"
            : /^[A-Z]/.test(line) ? "terminal-dim"
            : "";
          return \`<div class="\${className}">\${escapeHtml(line)}</div>\`;
        }).join("");

        return \`<div class="terminal-shell">\${html}</div>\`;
      }

      function renderWorkspaceFloor(snapshot, options = {}) {
        const counts = countsForSnapshot(snapshot);
        const compact = options.compact === true;
        const streetCafe = snapshot.sceneKind === "street-cafe";
        const titleAttr = escapeHtml(streetCafe ? "Chat Café. Codex Quick Chat appears after you choose Add to task." : snapshot.projectRoot);
        const projectTitle = streetCafe ? "Chat Café" : projectLabel(snapshot.projectRoot);
        const participantLabels = sharedParticipantLabelsForSnapshot(snapshot);
        const participantHtml = participantLabels.length > 0
          ? \`<div class="tower-floor-participants" title="\${escapeHtml("Active in this workspace: " + participantLabels.join(", "))}">\${participantLabels.map((label) => \`<span class="tower-floor-participant">\${escapeHtml(label)}</span>\`).join("")}</div>\`
          : "";
        const remoteOnlyTitleClass = streetCafe || snapshotHasLocalProject(snapshot) ? "" : " is-remote-only";
        const worktreeName = Boolean(state.globalSceneSettings && state.globalSceneSettings.splitWorktrees)
          ? worktreeNameForSnapshot(snapshot)
          : "";
        const titleHtml = worktreeName
          ? \`<div class="tower-floor-title\${remoteOnlyTitleClass}" title="\${titleAttr}"><span class="tower-floor-title-project">\${escapeHtml(projectTitle)}</span>\${participantHtml}<span class="tower-floor-title-worktree"><img class="worktree-inline-icon tower-floor-worktree-icon" src="\${escapeHtml(worktreeIconUrl())}" alt="" aria-hidden="true" /><span>\${escapeHtml(worktreeName)}</span></span></div>\`
          : \`<div class="tower-floor-title\${remoteOnlyTitleClass}" title="\${titleAttr}"><span class="tower-floor-title-project">\${escapeHtml(projectTitle)}</span>\${participantHtml}</div>\`;
        const summary = streetCafe
          ? \`Chat · Home · Work · \${counts.active} live · Quick Chat: Add to task\`
          : state.view === "map"
          ? \`\${counts.active} live · \${counts.waiting} waiting · \${counts.blocked} blocked\`
          : \`\${counts.total} agents · \${counts.active} active · \${counts.waiting} waiting · \${counts.blocked} blocked · \${counts.cloud} cloud\`;
        const floorMarker = streetCafe
          ? "G"
          : Number.isFinite(options.floorNumber)
          ? "F" + String(Math.max(1, Number(options.floorNumber))).padStart(2, "0")
          : "LIVE";
        const notes = state.view === "map" ? "" : snapshot.notes.join(" | ");
        const body = state.view === "terminal"
          ? renderTerminalSnapshot(snapshot)
          : renderOfficeMapShell(snapshot, {
            showHint: false,
            compact,
            liveOnly: state.activeOnly,
            focusMode: options.focusMode === true
          });
        const shareToggleHtml = !streetCafe && shouldRenderProjectShareToggle(snapshot)
          ? \`<button class="tower-floor-share\${projectShareEnabledForSnapshot(snapshot) ? " active" : ""}" data-action="toggle-project-share" data-project-roots="\${escapeHtml(JSON.stringify(projectShareToggleRoots(snapshot)))}" aria-pressed="\${projectShareEnabledForSnapshot(snapshot) ? "true" : "false"}" title="\${escapeHtml(projectShareEnabledForSnapshot(snapshot) ? "Shared with the room" : "Not shared with the room")}" type="button">Shared</button>\`
          : "";
        const actionHtml = options.action
          ? \`<button class="tower-floor-open" data-action="\${escapeHtml(options.action.type)}"\${options.action.projectRoot ? \` data-project-root="\${escapeHtml(options.action.projectRoot)}"\` : ""}>\${escapeHtml(options.action.label)}</button>\`
          : "";
        const customization = renderFloorCustomization(snapshot);
        return \`<section class="tower-floor\${compact ? " compact" : ""}\${streetCafe ? " street-cafe-floor" : ""}" data-project-root="\${escapeHtml(snapshot.projectRoot)}"><div class="tower-floor-strip"><span class="tower-floor-index" aria-hidden="true">\${escapeHtml(floorMarker)}</span><div class="tower-floor-label">\${titleHtml}</div><div class="tower-floor-trailing"><div class="tower-floor-meta">\${escapeHtml(summary)}</div><div class="tower-floor-actions">\${shareToggleHtml}\${customization.button}\${actionHtml}</div></div></div>\${customization.panel}<div class="tower-floor-body">\${notes ? \`<div class="tower-floor-note">\${escapeHtml(notes)}</div>\` : ""}\${body}</div></section>\`;
      }

      function renderWorkspaceTower(floorHtml, extraClass = "") {
        return \`<div class="workspace-tower\${extraClass ? " " + escapeHtml(extraClass) : ""}"><div class="tower-crown" aria-hidden="true"><span class="tower-roof-unit"></span><span class="tower-roof-vent"></span><span class="tower-beacon"></span><span class="tower-crown-mark">AOT</span></div><div class="tower-shaft">\${floorHtml}</div><div class="tower-foundation" aria-hidden="true"></div></div>\`;
      }

      function renderWorkspaceScroll(projects) {
        if (projects.length === 0) {
          return '<div class="empty">No tracked workspaces right now.</div>';
        }

        const floors = projects.map((snapshot, index) => renderWorkspaceFloor(snapshot, {
          compact: true,
          floorNumber: projects.length - index,
          action: snapshot.sceneKind === "street-cafe" ? null : {
            type: "select-project",
            label: "Focus",
            projectRoot: snapshot.projectRoot
          }
        })).join("");
        return renderWorkspaceTower(floors);
      }

      function officeSceneHostKey(projectRoot, compact, focusMode) {
        return [projectRoot, compact ? "compact" : "default", focusMode ? "focus" : "standard"].join("::");
      }

      function renderOfficeMapShell(snapshot, options = {}) {
        const compact = options.compact === true;
        const focusMode = options.focusMode === true;
        const shellKey = officeSceneHostKey(snapshot.projectRoot, compact, focusMode);
        const hint = options.showHint === false || focusMode
          ? ""
          : (options.liveOnly
            ? '<div class="muted">Showing live agents plus the 4 most recent lead sessions. Recent leads cool down in the rec area while live subagents stay on the floor.</div>'
            : '<div class="muted">Room shells come from the project XML, while booths are generated live from Codex sessions and grouped by parent session and subagent role.</div>');
        return \`<div class="scene-shell" data-scene-shell="\${focusMode ? "focus" : "default"}">\${hint}<div class="scene-fit \${compact ? "compact" : ""}" data-scene-fit data-scene-mode="\${focusMode ? "focus" : "default"}" data-scene-fitted="\${focusMode ? "false" : "true"}"><div class="scene-notifications" data-scene-notifications></div><div class="office-map-host" data-office-map-host="\${escapeHtml(shellKey)}" data-project-root="\${escapeHtml(snapshot.projectRoot)}" data-compact="\${compact ? "1" : "0"}" data-focus-mode="\${focusMode ? "1" : "0"}"><div class="office-map-canvas" data-office-map-canvas></div><div class="office-map-anchors" data-office-map-anchors></div><div class="office-map-thread-layer" data-office-map-thread-layer></div></div></div></div>\`;
      }

      function sceneShellToken(projects, focusMode = false) {
        return projects.map((project) => officeSceneHostKey(project.projectRoot, focusMode ? false : true, focusMode)).join("||");
      }

      function buildOfficeSceneModel(snapshot, options = {}) {
        const sceneRooms = buildSceneRooms(snapshot.rooms.rooms);
        const rooms = sceneRooms.visibleRooms;
        if (rooms.length === 0) {
          return null;
        }

        const compact = options.compact === true;
        const layoutConfig = fixedSceneLayoutConfig(compact);
        const tile = layoutConfig.tileSize;
        const baseMaxX = Math.max(...rooms.map((room) => room.x + room.width), 24);
        const maxY = Math.max(...rooms.map((room) => room.y + room.height), 16);
        const waitingAgents = sortAgentsStably(
          \`\${snapshot.projectRoot}::\${compact ? "compact-waiting" : "waiting"}\`,
          snapshot.agents.filter((agent) => agent.state === "waiting" && agent.source !== "cloud" && !isFloatingOrchestratorAgent(agent) && !shouldSeatAtWorkstation(agent))
        );
        const allRestingAgents = restingAgentsFor(snapshot, compact);
        const restingAgents = allRestingAgents
          .filter((agent) =>
            !agent.parentThreadId
            && agent.source !== "presence"
            && Boolean(agent.threadId || agent.taskId || agent.url || agent.source === "claude")
          )
          .slice(0, 4);
        const offDeskAgentIds = new Set([...waitingAgents, ...allRestingAgents].map((agent) => agent.id));
        const model = {
          projectRoot: snapshot.projectRoot,
          sceneKind: snapshot.sceneKind || "workspace",
          palette: scenePaletteForSnapshot(snapshot).pixi,
          compact,
          tile,
          width: baseMaxX * tile,
          fitWidth: baseMaxX * tile,
          height: maxY * tile,
          rooms: [],
          roomDoors: [],
          wallDashboards: [],
          tileObjects: [],
          furniture: [],
          facilities: [],
          workstations: [],
          desks: [],
          offices: [],
          recAgents: [],
          relationshipLines: [],
          anchors: [],
          threadPanel: null
        };
        const agentPositions = new Map();
        const openThreadSuppressesHover = Boolean(state.openAgentThread || state.closingAgentThread);

        function expandRoomVisualWidth(roomModel, nextVisualWidth) {
          if (!roomModel || !Number.isFinite(nextVisualWidth)) {
            return;
          }
          const visualWidth = Math.max(roomModel.width, Math.ceil(nextVisualWidth / tile) * tile);
          roomModel.visualWidth = Math.max(roomModel.visualWidth || roomModel.width, visualWidth);
          model.width = Math.max(model.width, roomModel.x + roomModel.visualWidth);
        }

        function sceneThreadPanelState(agent) {
          const projectRoot = threadViewProjectRoot(snapshot, agent);
          if (!projectRoot || !agent || !agent.threadId) {
            return null;
          }
          if (
            state.openAgentThread
            && state.openAgentThread.projectRoot === projectRoot
            && state.openAgentThread.threadId === agent.threadId
          ) {
            return "open";
          }
          if (
            state.closingAgentThread
            && state.closingAgentThread.projectRoot === projectRoot
            && state.closingAgentThread.threadId === agent.threadId
          ) {
            return "closing";
          }
          return null;
        }

        function registerThreadPanel(agent) {
          if (model.threadPanel) {
            return;
          }
          const panelState = sceneThreadPanelState(agent);
          if (!panelState) {
            return;
          }
          model.threadPanel = {
            state: panelState,
            key: agentKey(snapshot.projectRoot, agent),
            html: renderAgentThreadCard(snapshot, agent, { closing: panelState === "closing" })
          };
        }

        function openThreadStageOffset(agent) {
          if (sceneThreadPanelState(agent) !== "open" || hasReplyThreadWorkIntent(agent)) {
            return { x: 0, y: 0 };
          }
          return { x: compact ? -18 : -26, y: compact ? 10 : 16 };
        }

        const streetCafe = snapshot.sceneKind === "street-cafe";
        rooms.forEach((room) => {
          const isPrimaryRoom = room.id === sceneRooms.primaryRoomId;
          const roomAgentId = (agent) => sceneRooms.roomAlias.get(agent.roomId) || (agent.source === "cloud" ? "cloud" : sceneRooms.primaryRoomId);
          const occupants = snapshot.agents.filter((agent) =>
            roomAgentId(agent) === room.id
            && agent.source !== "cloud"
            && !isFloatingOrchestratorAgent(agent)
            && !offDeskAgentIds.has(agent.id)
          );
          const roomPixelWidth = room.width * tile;
          const roomPixelHeight = room.height * tile;
          const roomX = room.x * tile;
          const roomY = room.y * tile;
          const floorTop = roomY + layoutConfig.deskTopY;
          const roomModel = {
            id: room.id,
            x: roomX,
            y: roomY,
            width: roomPixelWidth,
            visualWidth: roomPixelWidth,
            height: roomPixelHeight,
            wallHeight: layoutConfig.deskTopY,
            floorTop,
            name: room.name,
            path: room.path || "",
            isPrimaryRoom
          };
          model.rooms.push(roomModel);
          const centerColumn = Math.floor(room.width / 2);
          const entrance = roomEntranceLayout(roomPixelWidth, tile, compact, floorTop);
          const doorWidth = Math.round(pixelOffice.props.boothDoor.w * entrance.doorScale);
          const doorHeight = Math.round(pixelOffice.props.boothDoor.h * entrance.doorScale);
          const doorBackdrop = sceneDefinitions && sceneDefinitions.door ? sceneDefinitions.door : {};
          const backdropWidth = Math.max(tile * 2, Math.round((Number(doorBackdrop.backdropWidthTiles) || 2) * tile));
          const backdropHeight = Math.max(tile * 2, Math.round((Number(doorBackdrop.backdropHeightTiles) || 2) * tile));
          model.roomDoors.push({
            id: room.id + "::door",
            roomId: room.id,
            leftSprite: pixelOffice.props.boothDoor.url,
            rightSprite: pixelOffice.props.boothDoor.url,
            leftX: roomX + entrance.centerDoorX,
            rightX: roomX + entrance.centerDoorX + doorWidth,
            y: roomY + entrance.centerDoorY,
            width: doorWidth,
            height: doorHeight,
            backdropX: roomX + Math.round(entrance.entryX - backdropWidth / 2),
            backdropY: floorTop - backdropHeight,
            backdropWidth,
            backdropHeight
          });
          if (isPrimaryRoom && !streetCafe) {
            const wallDashboard = buildOfficeWallDashboardModel(
              snapshot,
              room,
              roomX,
              roomY,
              roomPixelWidth,
              layoutConfig.deskTopY,
              entrance,
              tile,
              compact
            );
            if (wallDashboard) {
              model.wallDashboards.push(wallDashboard);
            }
          }
          if (streetCafe && isPrimaryRoom && pixelOffice.cafe) {
            model.tileObjects.push(
              buildSceneTileObject(room.id + "::storefront-left", room.id, pixelOffice.cafe.storefrontOrange, 1, 0, 3, 5, 2.7, { anchor: "wall" }),
              buildSceneTileObject(room.id + "::storefront-center", room.id, pixelOffice.cafe.storefrontOrange, 10, 0, 3, 5, 2.7, { anchor: "wall" }),
              buildSceneTileObject(room.id + "::storefront-right", room.id, pixelOffice.cafe.storefrontOrange, 20, 0, 3, 5, 2.7, { anchor: "wall" }),
              buildSceneTileObject(room.id + "::cafe-shelf", room.id, pixelOffice.cafe.shelf, 0, 1, 2, 3, 3),
              buildSceneTileObject(room.id + "::coffee-machine", room.id, pixelOffice.cafe.coffeeMachine, 4, 0, 1, 2, 3),
              buildSceneTileObject(room.id + "::cafe-plant-left", room.id, pixelOffice.cafe.plant, 6, 0, 1, 2, 3),
              buildSceneTileObject(room.id + "::cafe-plant-right", room.id, pixelOffice.cafe.plant, room.width - 7, 0, 1, 2, 3)
            );
            if (occupants.length === 0) {
              [
                { column: 2, row: 3, tone: "Red" },
                { column: 7, row: 3, tone: "Blue" },
                { column: 17, row: 3, tone: "Green" },
                { column: 21, row: 3, tone: "Red" },
                { column: 2, row: 8, tone: "Blue" },
                { column: 7, row: 8, tone: "Green" },
                { column: 17, row: 8, tone: "Red" },
                { column: 21, row: 8, tone: "Blue" }
              ].forEach((placement, index) => {
                const chairSprite = pixelOffice.cafe["chair" + placement.tone];
                model.tileObjects.push(
                  buildSceneTileObject(room.id + "::cafe-table-" + index, room.id, pixelOffice.cafe.table, placement.column, placement.row, 3, 3, 4),
                  buildSceneTileObject(room.id + "::cafe-chair-left-" + index, room.id, chairSprite, Math.max(0, placement.column - 1), placement.row, 1, 1, 4.1),
                  buildSceneTileObject(room.id + "::cafe-chair-right-" + index, room.id, chairSprite, Math.min(room.width - 1, placement.column + 3), placement.row, 1, 1, 4.1, { flipX: true })
                );
              });
            }
          } else {
            model.tileObjects.push(
              buildSceneTileObject(room.id + "::clock", room.id, pixelOffice.props.clock, centerColumn - 2, -2, 1, 1, 3, { anchor: "wall" })
            );
          }
          if (isPrimaryRoom && !streetCafe) {
            model.tileObjects.push(
              buildSceneTileObject(room.id + "::plant-left", room.id, pixelOffice.props.plant, centerColumn - 3, 0, 1, 1, 3),
              buildSceneTileObject(room.id + "::plant-right", room.id, pixelOffice.props.plant, centerColumn, 0, 1, 1, 3)
            );
          }
          if (isPrimaryRoom && !streetCafe) {
            const furnitureLayout = resolveFurnitureLayout(snapshot, room, tile);
            const sofaColumns = {
              left: furnitureLayout.find((item) => item.id === "sofa-left")?.column ?? (room.width - 10),
              right: furnitureLayout.find((item) => item.id === "sofa-right")?.column ?? (room.width - 7)
            };
            model.tileObjects.push(
              ...furnitureLayout.map((item) =>
                buildSceneTileObject(
                  room.id + "::" + item.id,
                  room.id,
                  item.sprite,
                  item.column,
                  item.baseRow,
                  item.widthTiles,
                  item.heightTiles,
                  item.z,
                  { furniture: true, furnitureId: item.id }
                )
              )
            );
            model.furniture.push(...furnitureLayout.map((item) => ({ ...item, roomId: room.id, projectRoot: snapshot.projectRoot })));
            model.facilities.push(
              ...furnitureLayout
                .map((item) => buildFacilityProviderModel(room, item))
                .filter(Boolean)
            );
            room.__sofaColumns = sofaColumns;
          }

          const officeAgents = streetCafe
            ? []
            : sortedBossOfficeAgents(snapshot, occupants.filter((agent) => isBossOfficeCandidate(snapshot, agent)));
          const deskAgents = streetCafe
            ? occupants
            : occupants.filter((agent) => !isBossOfficeCandidate(snapshot, agent));
          const officeAssignments = assignAgentsToOfficeSlots(snapshot, officeAgents, buildBossOfficeSlots(layoutConfig, officeAgents.length));
          const deskSlots = buildDeskSlots(layoutConfig, roomPixelWidth, Math.ceil(deskAgents.length / 2), officeAssignments.length > 0);
          const deskAssignments = assignAgentsToDeskSlots(snapshot, deskAgents, deskSlots);
          expandRoomVisualWidth(
            roomModel,
            deskSlots.reduce((rightEdge, slot) => Math.max(rightEdge, slot.x + slot.width + tile), roomPixelWidth)
          );

          deskAssignments.forEach((entry) => {
            const pod = {
              id: entry.slot.id,
              roomId: room.id,
              x: roomX + entry.slot.x,
              y: roomY + entry.slot.y,
              width: entry.slot.width,
              height: entry.slot.height,
              role: agentRole(entry.agents[0]),
              agents: [],
              shell: []
            };
            entry.agents.forEach((agent, index) => {
              const tile = sceneTileSize(compact);
              const cellWidth = Math.min(entry.slot.width, tile * 3);
              const hasBothSides = Boolean(entry.agents[0] && entry.agents[1]);
              const leftCellX = 0;
              const rightCellX = Math.max(0, entry.slot.width - cellWidth);
              const seatMirrored = hasBothSides
                ? index === 1
                : previousSceneMirrored(snapshot, agent) === true;
              const cellX = seatMirrored ? rightCellX : leftCellX;
              const visual = buildCubicleCellVisualModel(
                snapshot,
                agent,
                pod.role,
                cellX,
                0,
                cellWidth,
                entry.slot.height,
                compact,
                {
                  sharedCenter: hasBothSides,
                  mirrored: seatMirrored,
                  lead: false,
                  slotId: entry.slot.id,
                  enteringReveal: shouldRevealWorkstation(snapshot.projectRoot, agent, entry.slot.id),
                  depthBaseY: room.floorTop,
                  absoluteX: pod.x + cellX,
                  absoluteY: pod.y
                }
              );
              pod.shell.push(...visual.shell);
              if (visual.glow) {
                pod.shell.push({ kind: "glow", z: 10, ...visual.glow });
              }
              if (visual.avatar) {
                pod.agents.push({
                  id: agent.id,
                  key: agentKey(snapshot.projectRoot, agent),
                  parentThreadId: agent.parentThreadId || null,
                  parentKey: parentAgentKey(snapshot.projectRoot, agent),
                  roomId: room.id,
                  label: agent.label,
                  state: agent.state,
                  role: agentRole(agent),
                  focusKey: focusAgentKey(snapshot, agent),
                  focusKeys: collectFocusedSessionKeys(snapshot, agent),
                  appearance: agent.appearance,
                  hatId: effectiveHatIdForAgent(agent),
                  needsUser: agent.needsUser || null,
                  turnSignal: recentTurnSignalForAgent(snapshot, agent),
                  activityCue: recentActivityCueForAgent(snapshot, agent),
                  statusMarkerIconUrl: stateMarkerIconUrlForAgent(agent),
                  slotId: entry.slot.id,
                  mirrored: seatMirrored,
                  ...visual.avatar,
                  bubble: visual.bubble
                });
              }
              agentPositions.set(agent.id, { roomId: room.id, x: visual.anchorX, y: visual.anchorY });
              model.workstations.push({
                id: "workstation::" + agentKey(snapshot.projectRoot, agent),
                roomId: room.id,
                key: agentKey(snapshot.projectRoot, agent),
                ...visual.workstationBounds
              });
              registerThreadPanel(agent);
              model.anchors.push(
                {
                  id: "agent::" + agentKey(snapshot.projectRoot, agent),
                  type: "agent",
                  key: agentKey(snapshot.projectRoot, agent),
                  x: visual.anchorX,
                  y: visual.anchorY,
                  left: visual.avatar ? visual.avatar.x : visual.anchorX,
                  top: visual.avatar ? visual.avatar.y : visual.anchorY,
                  width: visual.avatar ? visual.avatar.width : tile,
                  height: visual.avatar ? visual.avatar.height : tile,
                  threadId: agent.threadId || "",
                  replyProjectRoot: threadViewProjectRoot(snapshot, agent) || "",
                  focusKey: focusAgentKey(snapshot, agent),
                  focusKeys: collectFocusedSessionKeys(snapshot, agent),
                  hoverHtml: openThreadSuppressesHover ? "" : renderAgentHover(snapshot, agent),
                  threadOpen: Boolean(sceneThreadPanelState(agent))
                },
                { id: "workstation::" + agentKey(snapshot.projectRoot, agent), type: "workstation", key: agentKey(snapshot.projectRoot, agent), x: pod.x + Math.round(pod.width / 2), y: pod.y + Math.round(pod.height * 0.72) }
              );
            });
            model.desks.push(pod);
          });

          officeAssignments.forEach((entry) => {
            const officeX = roomX + entry.slot.x;
            const officeY = roomY + entry.slot.y;
            const role = agentRole(entry.agent);
            const tile = sceneTileSize(compact);
            const cellWidth = Math.min(entry.slot.width, tile * 3);
            const cellX = Math.round((entry.slot.width - cellWidth) / 2);
            const visual = buildCubicleCellVisualModel(
              snapshot,
              entry.agent,
              role,
              cellX,
              0,
              cellWidth,
              entry.slot.height,
              compact,
              {
                mirrored: false,
                lead: true,
                slotId: entry.slot.id,
                enteringReveal: shouldRevealWorkstation(snapshot.projectRoot, entry.agent, entry.slot.id),
                depthBaseY: room.floorTop,
                absoluteX: officeX + cellX,
                absoluteY: officeY
              }
            );
            model.offices.push({
              id: entry.slot.id,
              roomId: room.id,
              x: officeX,
              y: officeY,
              width: entry.slot.width,
              height: entry.slot.height,
              role: "boss",
              badgeLabel: liveChildAgentsFor(snapshot, entry.agent.id).length + " spawned",
              shell: visual.shell,
              glow: visual.glow,
              agent: visual.avatar
                ? {
                    id: entry.agent.id,
                    key: agentKey(snapshot.projectRoot, entry.agent),
                    parentThreadId: entry.agent.parentThreadId || null,
                    parentKey: parentAgentKey(snapshot.projectRoot, entry.agent),
                    roomId: room.id,
                    label: entry.agent.label,
                    state: entry.agent.state,
                    role,
                    focusKey: focusAgentKey(snapshot, entry.agent),
                    focusKeys: collectFocusedSessionKeys(snapshot, entry.agent),
                    appearance: entry.agent.appearance,
                    hatId: effectiveHatIdForAgent(entry.agent),
                    needsUser: entry.agent.needsUser || null,
                    turnSignal: recentTurnSignalForAgent(snapshot, entry.agent),
                    activityCue: recentActivityCueForAgent(snapshot, entry.agent),
                    statusMarkerIconUrl: stateMarkerIconUrlForAgent(entry.agent),
                    slotId: entry.slot.id,
                    mirrored: false,
                    ...visual.avatar,
                    bubble: visual.bubble
                  }
                : null
            });
            agentPositions.set(entry.agent.id, { roomId: room.id, x: visual.anchorX, y: visual.anchorY });
            model.workstations.push({
              id: "workstation::" + agentKey(snapshot.projectRoot, entry.agent),
              roomId: room.id,
              key: agentKey(snapshot.projectRoot, entry.agent),
              ...visual.workstationBounds
            });
            registerThreadPanel(entry.agent);
            model.anchors.push(
              {
                id: "agent::" + agentKey(snapshot.projectRoot, entry.agent),
                type: "agent",
                key: agentKey(snapshot.projectRoot, entry.agent),
                x: visual.anchorX,
                y: visual.anchorY,
                left: visual.avatar ? visual.avatar.x : visual.anchorX,
                top: visual.avatar ? visual.avatar.y : visual.anchorY,
                width: visual.avatar ? visual.avatar.width : tile,
                height: visual.avatar ? visual.avatar.height : tile,
                threadId: entry.agent.threadId || "",
                replyProjectRoot: threadViewProjectRoot(snapshot, entry.agent) || "",
                focusKey: focusAgentKey(snapshot, entry.agent),
                focusKeys: collectFocusedSessionKeys(snapshot, entry.agent),
                hoverHtml: openThreadSuppressesHover ? "" : renderAgentHover(snapshot, entry.agent),
                threadOpen: Boolean(sceneThreadPanelState(entry.agent))
              },
              { id: "workstation::" + agentKey(snapshot.projectRoot, entry.agent), type: "workstation", key: agentKey(snapshot.projectRoot, entry.agent), x: visual.anchorX, y: visual.anchorY }
            );
          });

          if (isPrimaryRoom) {
            const waitingAssignments = stableSceneSlotAssignments(snapshot.projectRoot, "waiting", waitingAgents);
            const restingAssignments = stableSceneSlotAssignments(snapshot.projectRoot, "resting", restingAgents, 4);
            waitingAssignments.forEach(({ agent, slotIndex }) => {
              const slot = wallsideWaitingSlotAt(slotIndex, compact, roomPixelWidth, layoutConfig.recAreaWalkwayGridY);
              const stagedOffset = openThreadStageOffset(agent);
              const avatarX = roomX + slot.x + stagedOffset.x;
              const avatarY = roomY + slot.y + stagedOffset.y;
              const anchorX = avatarX + Math.round(tile * 0.4);
              const anchorY = avatarY + Math.round(tile * 0.6);
              const avatarSize = avatarVisualSizeForAgent(agent, compact ? 1 : 1.08);
              model.recAgents.push({
                id: agent.id,
                key: agentKey(snapshot.projectRoot, agent),
                roomId: room.id,
                kind: "waiting",
                label: agent.label,
                state: agent.state,
                role: agentRole(agent),
                focusKey: focusAgentKey(snapshot, agent),
                focusKeys: collectFocusedSessionKeys(snapshot, agent),
                appearance: agent.appearance,
                hatId: effectiveHatIdForAgent(agent),
                needsUser: agent.needsUser || null,
                turnSignal: recentTurnSignalForAgent(snapshot, agent),
                activityCue: recentActivityCueForAgent(snapshot, agent),
                statusMarkerIconUrl: stateMarkerIconUrlForAgent(agent),
                sprite: avatarSize.avatar.url,
                x: avatarX,
                y: avatarY,
                width: avatarSize.width,
                height: avatarSize.height,
                depthBaseY: room.floorTop,
                bubble: "...",
                flip: slot.flip
              });
              agentPositions.set(agent.id, { roomId: room.id, x: anchorX, y: anchorY });
              registerThreadPanel(agent);
              model.anchors.push({
                id: "agent::" + agentKey(snapshot.projectRoot, agent),
                type: "agent",
                key: agentKey(snapshot.projectRoot, agent),
                x: anchorX,
                y: anchorY,
                left: avatarX,
                top: avatarY,
                width: avatarSize.width,
                height: avatarSize.height,
                threadId: agent.threadId || "",
                replyProjectRoot: threadViewProjectRoot(snapshot, agent) || "",
                focusKey: focusAgentKey(snapshot, agent),
                focusKeys: collectFocusedSessionKeys(snapshot, agent),
                hoverHtml: openThreadSuppressesHover ? "" : renderAgentHover(snapshot, agent),
                threadOpen: Boolean(sceneThreadPanelState(agent))
              });
            });
            restingAssignments.forEach(({ agent, slotIndex }) => {
              const slot = recRoomSeatSlotAt(agent, slotIndex, compact, roomPixelWidth, layoutConfig.recAreaGridTopY, room.__sofaColumns || null);
              const stagedOffset = openThreadStageOffset(agent);
              const avatarX = roomX + slot.x + stagedOffset.x;
              const avatarY = roomY + slot.y + stagedOffset.y;
              const anchorX = avatarX + Math.round(tile * 0.4);
              const anchorY = avatarY + Math.round(tile * 0.6);
              const avatarSize = avatarVisualSizeForAgent(agent, compact ? 1 : 1.08);
              model.recAgents.push({
                id: agent.id,
                key: agentKey(snapshot.projectRoot, agent),
                roomId: room.id,
                kind: "resting",
                label: agent.label,
                state: agent.state,
                role: agentRole(agent),
                focusKey: focusAgentKey(snapshot, agent),
                focusKeys: collectFocusedSessionKeys(snapshot, agent),
                appearance: agent.appearance,
                hatId: effectiveHatIdForAgent(agent),
                needsUser: agent.needsUser || null,
                turnSignal: recentTurnSignalForAgent(snapshot, agent),
                activityCue: recentActivityCueForAgent(snapshot, agent),
                statusMarkerIconUrl: stateMarkerIconUrlForAgent(agent),
                sprite: avatarSize.avatar.url,
                x: avatarX,
                y: avatarY,
                width: avatarSize.width,
                height: avatarSize.height,
                depthBaseY: room.floorTop,
                bubble: null,
                flip: slot.flip
              });
              agentPositions.set(agent.id, { roomId: room.id, x: anchorX, y: anchorY });
              registerThreadPanel(agent);
              model.anchors.push({
                id: "agent::" + agentKey(snapshot.projectRoot, agent),
                type: "agent",
                key: agentKey(snapshot.projectRoot, agent),
                x: anchorX,
                y: anchorY,
                left: avatarX,
                top: avatarY,
                width: avatarSize.width,
                height: avatarSize.height,
                threadId: agent.threadId || "",
                replyProjectRoot: threadViewProjectRoot(snapshot, agent) || "",
                focusKey: focusAgentKey(snapshot, agent),
                focusKeys: collectFocusedSessionKeys(snapshot, agent),
                hoverHtml: openThreadSuppressesHover ? "" : renderAgentHover(snapshot, agent),
                threadOpen: Boolean(sceneThreadPanelState(agent))
              });
            });
          }
        });

        snapshot.agents.forEach((agent) => {
          if (!isRelationshipBossCandidate(snapshot, agent)) {
            return;
          }
          const bossPos = agentPositions.get(agent.id);
          if (!bossPos) {
            return;
          }
          childAgentsFor(snapshot, agent.id).forEach((child) => {
            const childPos = agentPositions.get(child.id);
            if (!childPos || childPos.roomId !== bossPos.roomId) {
              return;
            }
            model.relationshipLines.push({
              id: agent.id + "::" + child.id,
              x1: bossPos.x,
              y1: bossPos.y,
              x2: childPos.x,
              y2: childPos.y,
              focusKey: focusAgentKey(snapshot, agent),
              focusKeys: collectFocusedSessionKeys(snapshot, agent)
            });
          });
        });

        return model;
      }
`;
