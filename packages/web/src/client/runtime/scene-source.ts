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
            .filter((agent) => {
              if (agent.source === "cloud") {
                return false;
              }
              if (shouldSeatAtWorkstation(agent)) {
                return false;
              }
              return agent.state === "idle" || agent.state === "done";
            })
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
        const titleAttr = escapeHtml(snapshot.projectRoot);
        const projectTitle = projectLabel(snapshot.projectRoot);
        const participantLabels = sharedParticipantLabelsForSnapshot(snapshot);
        const participantHtml = participantLabels.length > 0
          ? \`<div class="tower-floor-participants" title="\${escapeHtml("Active in this workspace: " + participantLabels.join(", "))}">\${participantLabels.map((label) => \`<span class="tower-floor-participant">\${escapeHtml(label)}</span>\`).join("")}</div>\`
          : "";
        const remoteOnlyTitleClass = snapshotHasLocalProject(snapshot) ? "" : " is-remote-only";
        const worktreeName = Boolean(state.globalSceneSettings && state.globalSceneSettings.splitWorktrees)
          ? worktreeNameForSnapshot(snapshot)
          : "";
        const titleHtml = worktreeName
          ? \`<div class="tower-floor-title\${remoteOnlyTitleClass}" title="\${titleAttr}"><span class="tower-floor-title-project">\${escapeHtml(projectTitle)}</span>\${participantHtml}<span class="tower-floor-title-worktree"><img class="worktree-inline-icon tower-floor-worktree-icon" src="\${escapeHtml(worktreeIconUrl())}" alt="" aria-hidden="true" /><span>\${escapeHtml(worktreeName)}</span></span></div>\`
          : \`<div class="tower-floor-title\${remoteOnlyTitleClass}" title="\${titleAttr}"><span class="tower-floor-title-project">\${escapeHtml(projectTitle)}</span>\${participantHtml}</div>\`;
        const summary = state.view === "map"
          ? (compact ? "Live floor" : "Current workload")
          : \`\${counts.total} agents · \${counts.active} active · \${counts.waiting} waiting · \${counts.blocked} blocked · \${counts.cloud} cloud\`;
        const notes = state.view === "map" ? "" : snapshot.notes.join(" | ");
        const body = state.view === "terminal"
          ? renderTerminalSnapshot(snapshot)
          : renderOfficeMapShell(snapshot, {
            showHint: false,
            compact,
            liveOnly: state.activeOnly,
            focusMode: options.focusMode === true
          });
        const shareToggleHtml = shouldRenderProjectShareToggle(snapshot)
          ? \`<button class="tower-floor-share\${projectShareEnabledForSnapshot(snapshot) ? " active" : ""}" data-action="toggle-project-share" data-project-roots="\${escapeHtml(JSON.stringify(projectShareToggleRoots(snapshot)))}" aria-pressed="\${projectShareEnabledForSnapshot(snapshot) ? "true" : "false"}" title="\${escapeHtml(projectShareEnabledForSnapshot(snapshot) ? "Shared with the room" : "Not shared with the room")}" type="button">Shared</button>\`
          : "";
        const actionHtml = options.action
          ? \`<button class="tower-floor-open" data-action="\${escapeHtml(options.action.type)}"\${options.action.projectRoot ? \` data-project-root="\${escapeHtml(options.action.projectRoot)}"\` : ""}>\${escapeHtml(options.action.label)}</button>\`
          : "";
        return \`<section class="tower-floor\${compact ? " compact" : ""}" data-project-root="\${escapeHtml(snapshot.projectRoot)}"><div class="tower-floor-strip"><div class="tower-floor-label">\${titleHtml}</div><div class="tower-floor-trailing"><div class="tower-floor-meta">\${escapeHtml(summary)}</div><div class="tower-floor-actions">\${shareToggleHtml}\${actionHtml}</div></div></div><div class="tower-floor-body">\${notes ? \`<div class="tower-floor-note">\${escapeHtml(notes)}</div>\` : ""}\${body}</div></section>\`;
      }

      function renderWorkspaceScroll(projects) {
        if (projects.length === 0) {
          return '<div class="empty">No tracked workspaces right now.</div>';
        }

        return \`<div class="workspace-tower">\${projects.map((snapshot) => renderWorkspaceFloor(snapshot, {
          compact: true,
          action: {
            type: "select-project",
            label: "Focus",
            projectRoot: snapshot.projectRoot
          }
        })).join("")}</div>\`;
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
          snapshot.agents.filter((agent) => agent.state === "waiting" && agent.source !== "cloud" && !shouldSeatAtWorkstation(agent))
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
          compact,
          tile,
          width: baseMaxX * tile,
          height: maxY * tile,
          rooms: [],
          roomDoors: [],
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

        rooms.forEach((room) => {
          const isPrimaryRoom = room.id === sceneRooms.primaryRoomId;
          const roomAgentId = (agent) => sceneRooms.roomAlias.get(agent.roomId) || (agent.source === "cloud" ? "cloud" : sceneRooms.primaryRoomId);
          const occupants = snapshot.agents.filter((agent) =>
            roomAgentId(agent) === room.id
            && agent.source !== "cloud"
            && !offDeskAgentIds.has(agent.id)
          );
          const roomPixelWidth = room.width * tile;
          const roomPixelHeight = room.height * tile;
          const roomX = room.x * tile;
          const roomY = room.y * tile;
          const floorTop = roomY + layoutConfig.deskTopY;
          model.rooms.push({
            id: room.id,
            x: roomX,
            y: roomY,
            width: roomPixelWidth,
            height: roomPixelHeight,
            wallHeight: layoutConfig.deskTopY,
            floorTop,
            name: room.name,
            path: room.path || "",
            isPrimaryRoom
          });
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
          model.tileObjects.push(
            buildSceneTileObject(room.id + "::clock", room.id, pixelOffice.props.clock, centerColumn - 2, -2, 1, 1, 3, { anchor: "wall" })
          );
          if (isPrimaryRoom) {
            model.tileObjects.push(
              buildSceneTileObject(room.id + "::plant-left", room.id, pixelOffice.props.plant, centerColumn - 3, 0, 1, 1, 3),
              buildSceneTileObject(room.id + "::plant-right", room.id, pixelOffice.props.plant, centerColumn, 0, 1, 1, 3)
            );
          }
          if (isPrimaryRoom) {
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

          const officeAgents = sortedBossOfficeAgents(snapshot, occupants.filter((agent) => isBossOfficeCandidate(snapshot, agent)));
          const deskAgents = occupants.filter((agent) => !isBossOfficeCandidate(snapshot, agent));
          const officeAssignments = assignAgentsToOfficeSlots(snapshot, officeAgents, buildBossOfficeSlots(layoutConfig, officeAgents.length));
          const deskAssignments = assignAgentsToDeskSlots(snapshot, deskAgents, buildDeskSlots(layoutConfig, roomPixelWidth, Math.ceil(deskAgents.length / 2), officeAssignments.length > 0));

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
                sprite: avatarForAgent(agent).url,
                x: avatarX,
                y: avatarY,
                width: Math.round(avatarForAgent(agent).w * (compact ? 1 : 1.08)),
                height: Math.round(avatarForAgent(agent).h * (compact ? 1 : 1.08)),
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
                width: Math.round(avatarForAgent(agent).w * (compact ? 1 : 1.08)),
                height: Math.round(avatarForAgent(agent).h * (compact ? 1 : 1.08)),
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
                sprite: avatarForAgent(agent).url,
                x: avatarX,
                y: avatarY,
                width: Math.round(avatarForAgent(agent).w * (compact ? 1 : 1.08)),
                height: Math.round(avatarForAgent(agent).h * (compact ? 1 : 1.08)),
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
                width: Math.round(avatarForAgent(agent).w * (compact ? 1 : 1.08)),
                height: Math.round(avatarForAgent(agent).h * (compact ? 1 : 1.08)),
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
          if (!isBossOfficeCandidate(snapshot, agent)) {
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

      function destroyOfficeRenderer(renderer) {
        if (!renderer) {
          return;
        }
        try {
          if (renderer.resizeObserver) {
            renderer.resizeObserver.disconnect();
          }
          if (renderer.app && renderer.animateTick) {
            renderer.app.ticker.remove(renderer.animateTick);
          }
          if (renderer.app) {
            renderer.app.destroy(true, { children: true });
          }
        } catch {}
      }

      function cleanupOfficeRenderers() {
        officeSceneRenderers.forEach((renderer, key) => {
          if (!(renderer.host instanceof HTMLElement) || !document.body.contains(renderer.host)) {
            destroyOfficeRenderer(renderer);
            officeSceneRenderers.delete(key);
          }
        });
      }

      async function ensureOfficeRenderer(host) {
        const key = host.dataset.officeMapHost || "";
        const existing = officeSceneRenderers.get(key);
        if (existing && existing.host === host) {
          return existing;
        }
        if (existing) {
          destroyOfficeRenderer(existing);
        }
        const canvasContainer = host.querySelector("[data-office-map-canvas]");
        const anchorLayer = host.querySelector("[data-office-map-anchors]");
        const threadLayer = host.querySelector("[data-office-map-thread-layer]");
        if (!(canvasContainer instanceof HTMLElement) || !(anchorLayer instanceof HTMLElement) || !window.PIXI) {
          return null;
        }
        const renderer = {
          key,
          host,
          canvasContainer,
          anchorLayer,
          threadLayer: threadLayer instanceof HTMLElement ? threadLayer : null,
          app: new window.PIXI.Application(),
          root: null,
          model: null,
          ready: null,
          resizeObserver: null,
          assetUrls: new Set(),
          animatedSprites: [],
          motionStates: new Map(),
          roomDoorStates: new Map(),
          agentHitNodes: new Map(),
          animateTick: null,
          focusables: [],
          roomById: new Map(),
          roomNavigation: new Map(),
          reservedAgentTiles: new Map(),
          updateAutonomousRestingMotion: null,
          syncHeldItemSprite: null
        };
        renderer.ready = renderer.app.init({
          backgroundAlpha: 0,
          antialias: false,
          autoDensity: true,
          resolution: Math.max(1, Number(window.devicePixelRatio || 1)),
          roundPixels: true
        }).then(() => {
          if (window.PIXI.TextureStyle && window.PIXI.SCALE_MODES) {
            window.PIXI.TextureStyle.defaultOptions.scaleMode = window.PIXI.SCALE_MODES.NEAREST;
          }
          if (window.PIXI.settings) {
            window.PIXI.settings.ROUND_PIXELS = true;
          }
          const canvas = renderer.app.canvas;
          canvasContainer.innerHTML = "";
          canvasContainer.appendChild(canvas);
          renderer.root = new window.PIXI.Container();
          renderer.root.sortableChildren = true;
          renderer.app.stage.addChild(renderer.root);
          renderer.animateTick = () => {
            const now = performance.now();
            const deltaMs = renderer.app?.ticker?.deltaMS || 16;
            renderer.animatedSprites.forEach((entry) => {
              if (!entry || (!entry.sprite && entry.kind !== "blink")) {
                return;
              }
              if (entry.kind === "motion") {
                if (entry.autonomy && !entry.exiting && typeof renderer.updateAutonomousRestingMotion === "function") {
                  renderer.updateAutonomousRestingMotion(entry, now);
                }
                const route = Array.isArray(entry.route) ? entry.route : [];
                const speed = Number(entry.speed) || 128;
                let remaining = speed * (deltaMs / 1000);
                while (remaining > 0 && entry.routeIndex < route.length) {
                  const target = route[entry.routeIndex];
                  const dx = target.x - entry.currentX;
                  const dy = target.y - entry.currentY;
                  const distance = Math.hypot(dx, dy);
                  if (distance <= Math.max(1, remaining)) {
                    entry.currentX = target.x;
                    entry.currentY = target.y;
                    if (entry.roomId) {
                      const currentRoom = renderer.model?.rooms?.find((room) => room.id === entry.roomId) || null;
                      entry.currentTile = officeAvatarFootTile(
                        currentRoom,
                        renderer.model?.tile || 16,
                        entry.currentX,
                        entry.currentY,
                        entry.width,
                        entry.height
                      );
                    }
                    entry.routeIndex += 1;
                    remaining -= distance;
                    continue;
                  }
                  const ratio = remaining / distance;
                  entry.currentX += dx * ratio;
                  entry.currentY += dy * ratio;
                  if (entry.roomId) {
                    const currentRoom = renderer.model?.rooms?.find((room) => room.id === entry.roomId) || null;
                    entry.currentTile = officeAvatarFootTile(
                      currentRoom,
                      renderer.model?.tile || 16,
                      entry.currentX,
                      entry.currentY,
                      entry.width,
                      entry.height
                    );
                  }
                  remaining = 0;
                  if (Math.abs(dx) >= 1) {
                    entry.flipX = dx < 0;
                  }
                }
                if (entry.routeIndex >= route.length && typeof entry.targetFlipX === "boolean") {
                  entry.flipX = entry.targetFlipX;
                }
                const renderOffsetX = Number.isFinite(entry.renderOffsetX) ? Number(entry.renderOffsetX) : 0;
                const renderOffsetY = Number.isFinite(entry.renderOffsetY) ? Number(entry.renderOffsetY) : 0;
                const renderWidth = Number.isFinite(entry.renderWidth) ? Number(entry.renderWidth) : pixelSnap(entry.width, 1);
                entry.sprite.x = pixelSnap(entry.currentX + renderOffsetX);
                entry.sprite.y = pixelSnap(entry.currentY + renderOffsetY);
                if (entry.flipX) {
                  entry.sprite.scale.x = -Math.abs(entry.sprite.scale.x || 1);
                  entry.sprite.x = pixelSnap(entry.currentX + renderOffsetX) + renderWidth;
                } else {
                  entry.sprite.scale.x = Math.abs(entry.sprite.scale.x || 1);
                }
                if (entry.hatSprite) {
                  const hatWidth = Number.isFinite(entry.hatWidth) ? Number(entry.hatWidth) : 0;
                  const hatCenteredOffsetX = Number.isFinite(entry.hatCenteredOffsetX) ? Number(entry.hatCenteredOffsetX) : 0;
                  const hatManualOffsetX = Number.isFinite(entry.hatManualOffsetX) ? Number(entry.hatManualOffsetX) : 0;
                  const hatOffsetY = Number.isFinite(entry.hatOffsetY) ? Number(entry.hatOffsetY) : 0;
                  const hatBaseX = entry.currentX + renderOffsetX;
                  entry.hatSprite.x = pixelSnap(
                    hatBaseX
                    + hatCenteredOffsetX
                    + (entry.flipX ? -hatManualOffsetX : hatManualOffsetX)
                  );
                  entry.hatSprite.y = pixelSnap(entry.currentY + renderOffsetY + hatOffsetY);
                  if (entry.flipX) {
                    entry.hatSprite.scale.x = -Math.abs(entry.hatSprite.scale.x || 1);
                    entry.hatSprite.x = pixelSnap(entry.hatSprite.x + hatWidth);
                  } else {
                    entry.hatSprite.scale.x = Math.abs(entry.hatSprite.scale.x || 1);
                  }
                }
                if (entry.bubbleBox && entry.bubbleText) {
                  const bubbleX = pixelSnap(entry.currentX + Math.round(entry.width * 0.2));
                  const bubbleY = pixelSnap(entry.currentY - 14);
                  entry.bubbleBox.x = bubbleX;
                  entry.bubbleBox.y = bubbleY;
                  entry.bubbleText.x = bubbleX + Math.round((entry.bubbleBox.width - entry.bubbleText.width) / 2);
                  entry.bubbleText.y = bubbleY + Math.round((entry.bubbleBox.height - entry.bubbleText.height) / 2) - 1;
                }
                if (entry.statusMarker) {
                  const markerWidth = Math.max(8, Math.round(entry.statusMarker.width || 11));
                  const markerLift = Number.isFinite(entry.statusMarkerLift) ? Number(entry.statusMarkerLift) : 0;
                  entry.statusMarker.x = pixelSnap(entry.currentX + Math.round((entry.width - markerWidth) / 2));
                  entry.statusMarker.y = pixelSnap(entry.currentY - (entry.bubbleBox ? 20 : 13) - markerLift);
                }
                if (typeof renderer.syncHeldItemSprite === "function") {
                  renderer.syncHeldItemSprite(entry);
                }
                if (typeof renderer.syncMotionStateDepth === "function") {
                  renderer.syncMotionStateDepth(entry);
                }
                syncAgentHitNodePosition(renderer, entry);
                if (entry.exiting && entry.routeIndex >= route.length) {
                  entry.sprite.alpha = Math.max(0, entry.sprite.alpha - 0.16);
                  entry.exitFadeAlpha = entry.sprite.alpha;
                  if (entry.bubbleBox) {
                    entry.bubbleBox.alpha = entry.sprite.alpha;
                  }
                  if (entry.bubbleText) {
                    entry.bubbleText.alpha = entry.sprite.alpha;
                  }
                  if (entry.statusMarker) {
                    entry.statusMarker.alpha = entry.sprite.alpha;
                  }
                  if (entry.hatSprite) {
                    entry.hatSprite.alpha = entry.sprite.alpha;
                  }
                  if (entry.heldItemSprite) {
                    entry.heldItemSprite.alpha = entry.sprite.alpha;
                  }
                }
                return;
              }
              if (entry.kind === "blink") {
                const duration = Number(entry.durationMs) || 140;
                const elapsed = now - Number(entry.startedAt || now);
                const phase = elapsed <= 0
                  ? 0
                  : elapsed >= duration
                    ? 4
                    : Math.min(4, Math.floor((elapsed / duration) * 5));
                const visible = phase === 1 || phase === 3 || phase >= 4;
                (entry.nodes || []).forEach((node) => {
                  if (!node) {
                    return;
                  }
                  node.visible = visible;
                });
                return;
              }
              if (entry.kind === "bob") {
                const bobMode = entry.mode || "busy";
                const waveSlow = Math.sin((now + entry.phase) / 260);
                const waveMid = Math.sin((now + entry.phase) / 180);
                const waveFast = Math.sin((now + entry.phase) / 110);
                const waveStep = Math.sin((now + entry.phase) / 90);
                const bobOffset =
                  bobMode === "planning" ? Math.round(waveSlow * 1)
                  : bobMode === "scanning" ? Math.round(waveMid * 1.4)
                  : bobMode === "editing" ? Math.round(waveFast * 1.6)
                  : bobMode === "running" ? Math.round((waveFast + waveStep * 0.45) * 1.7)
                  : bobMode === "validating" ? Math.round(waveMid * 0.8)
                  : bobMode === "delegating" ? Math.round((waveSlow + waveMid * 0.45) * 1.3)
                  : Math.round(waveMid * 1);
                const driftX =
                  bobMode === "scanning" ? Math.round(Math.sin((now + entry.phase) / 210) * 1.2)
                  : bobMode === "delegating" ? Math.round(Math.sin((now + entry.phase) / 320) * 1)
                  : 0;
                entry.sprite.x = entry.baseX + driftX;
                entry.sprite.y = entry.baseY + bobOffset;
                if (entry.hatSprite) {
                  entry.hatSprite.x = entry.hatBaseX + driftX;
                  entry.hatSprite.y = entry.hatBaseY + bobOffset;
                }
                if (entry.statusMarker) {
                  entry.statusMarker.x = entry.statusMarkerBaseX + driftX;
                  entry.statusMarker.y = entry.statusMarkerBaseY + bobOffset;
                }
                if (entry.bubbleBox) {
                  entry.bubbleBox.x = entry.bubbleBoxBaseX + driftX;
                  entry.bubbleBox.y = entry.bubbleBoxBaseY + bobOffset;
                }
                if (entry.bubbleText) {
                  entry.bubbleText.x = entry.bubbleTextBaseX + driftX;
                  entry.bubbleText.y = entry.bubbleTextBaseY + bobOffset;
                }
                if (typeof renderer.syncMotionStateDepth === "function") {
                  renderer.syncMotionStateDepth(entry.motionState || entry);
                }
                if (entry.motionState && typeof syncAgentHitNodePosition === "function") {
                  syncAgentHitNodePosition(renderer, entry.motionState);
                }
                return;
              }
              if (entry.kind === "workstation-glow") {
                if (!entry.node) {
                  return;
                }
                const pulse = (Math.sin((now + entry.phase) / 180) + 1) / 2;
                entry.node.alpha = Math.max(0.16, Number(entry.baseAlpha || 0.24) + pulse * 0.2);
                return;
              }
              if (entry.kind === "state-effect") {
                if (typeof syncStateEffectNode === "function") {
                  syncStateEffectNode(entry, now);
                }
                return;
              }
              if (entry.kind === "turn-signal") {
                const motionState = entry.motionState || null;
                const turnSignal = motionState && motionState.turnSignal ? motionState.turnSignal : null;
                if (!motionState || !turnSignal || !turnSignal.container) {
                  return;
                }
                const durationMs = Math.max(600, Number(turnSignal.durationMs) || 2400);
                const ageMs = Math.max(0, Date.now() - Number(turnSignal.startedAtMs || Date.now()));
                const progress = Math.min(1, ageMs / durationMs);
                const fade = progress >= 0.72
                  ? Math.max(0, 1 - (progress - 0.72) / 0.28)
                  : 1;
                const pulse = progress < 0.16
                  ? 0.86 + (progress / 0.16) * 0.14
                  : 1 + Math.sin((now + entry.phase) / 110) * 0.03 * (1 - progress);
                if (typeof syncTurnSignalNode === "function") {
                  syncTurnSignalNode(motionState, turnSignal, progress * 6);
                }
                turnSignal.container.alpha = Math.max(
                  0,
                  Math.min(1, fade * (motionState.sprite ? Number(motionState.sprite.alpha || 1) : 1))
                );
                turnSignal.container.scale.set(pulse);
                if (typeof renderer.syncMotionStateDepth === "function") {
                  renderer.syncMotionStateDepth(motionState);
                }
                return;
              }
              if (entry.kind === "activity-cue") {
                const motionState = entry.motionState || null;
                const activityCue = motionState && motionState.activityCue ? motionState.activityCue : null;
                if (!motionState || !activityCue || !activityCue.container) {
                  return;
                }
                const durationMs = Math.max(900, Number(activityCue.durationMs) || 2200);
                const ageMs = Math.max(0, Date.now() - Number(activityCue.startedAtMs || Date.now()));
                const progress = Math.min(1, ageMs / durationMs);
                const fade = progress >= 0.7
                  ? Math.max(0, 1 - (progress - 0.7) / 0.3)
                  : 1;
                const pulse = 1 + Math.sin((now + entry.phase) / 120) * 0.05 * (1 - progress);
                const driftX =
                  entry.mode === "tool" ? Math.round(Math.sin((now + entry.phase) / 140) * 2.2)
                  : entry.mode === "approval" ? Math.round(Math.sin((now + entry.phase) / 150) * 1.4)
                  : entry.mode === "input" ? Math.round(Math.sin((now + entry.phase) / 180) * 1.1)
                  : entry.mode === "command" ? Math.round(Math.sin((now + entry.phase) / 90) * 1.2)
                  : 0;
                const driftY =
                  entry.mode === "resolved" ? -Math.round(progress * 7 + Math.sin((now + entry.phase) / 150) * 1.2)
                  : entry.mode === "plan" ? -Math.round(progress * 7 + Math.sin((now + entry.phase) / 180) * 1.2)
                  : entry.mode === "file" ? -Math.round(progress * 5 + Math.sin((now + entry.phase) / 120) * 1.6)
                  : entry.mode === "approval" ? Math.round(Math.sin((now + entry.phase) / 170) * 1.4)
                  : entry.mode === "input" ? -Math.round(progress * 3 + Math.sin((now + entry.phase) / 130) * 1.4)
                  : entry.mode === "command" ? Math.round(Math.sin((now + entry.phase) / 110) * 1.2)
                  : -Math.round(progress * 4);
                if (typeof syncActivityCueNode === "function") {
                  syncActivityCueNode(motionState, activityCue, driftX, driftY);
                }
                const cueIcon = activityCue.iconContainer || null;
                const cueAccent = activityCue.iconAccent || null;
                const cueText = activityCue.textNode || null;
                if (cueIcon) {
                  cueIcon.x = Number.isFinite(activityCue.iconBaseX) ? Number(activityCue.iconBaseX) : 0;
                  cueIcon.y = Number.isFinite(activityCue.iconBaseY) ? Number(activityCue.iconBaseY) : 0;
                  cueIcon.rotation = 0;
                  cueIcon.alpha = 1;
                  cueIcon.scale.set(1);
                }
                if (cueAccent) {
                  cueAccent.alpha = 0.95;
                  cueAccent.rotation = 0;
                  cueAccent.scale.set(1);
                }
                if (cueText) {
                  cueText.x = Number.isFinite(activityCue.textBaseX) ? Number(activityCue.textBaseX) : cueText.x;
                  cueText.y = Number.isFinite(activityCue.textBaseY) ? Number(activityCue.textBaseY) : cueText.y;
                  cueText.alpha = 1;
                }
                if (cueIcon && entry.mode === "plan") {
                  cueIcon.y = (Number.isFinite(activityCue.iconBaseY) ? Number(activityCue.iconBaseY) : 0) + Math.round(Math.sin((now + entry.phase) / 180) * 0.8);
                  if (cueAccent) {
                    cueAccent.alpha = 0.72 + ((Math.sin((now + entry.phase) / 180) + 1) / 2) * 0.28;
                  }
                } else if (cueIcon && entry.mode === "command") {
                  cueIcon.x = (Number.isFinite(activityCue.iconBaseX) ? Number(activityCue.iconBaseX) : 0) + Math.round(Math.sin((now + entry.phase) / 95) * 0.9);
                  if (cueAccent) {
                    cueAccent.alpha = Math.sin((now + entry.phase) / 105) > 0 ? 0.98 : 0.24;
                  }
                } else if (cueIcon && entry.mode === "file") {
                  cueIcon.rotation = Math.sin((now + entry.phase) / 135) * 0.12;
                  if (cueAccent) {
                    cueAccent.alpha = 0.58 + ((Math.sin((now + entry.phase) / 120) + 1) / 2) * 0.38;
                  }
                } else if (cueIcon && entry.mode === "tool") {
                  cueIcon.rotation = (now + entry.phase) / 420;
                  if (cueAccent) {
                    cueAccent.alpha = 0.64 + ((Math.sin((now + entry.phase) / 140) + 1) / 2) * 0.28;
                  }
                } else if (cueIcon && entry.mode === "approval") {
                  const approvalScale = 0.92 + ((Math.sin((now + entry.phase) / 150) + 1) / 2) * 0.2;
                  cueIcon.scale.set(approvalScale);
                  if (cueAccent) {
                    cueAccent.alpha = 0.28 + (1 - progress) * 0.5;
                    cueAccent.scale.set(0.88 + progress * 0.5);
                  }
                } else if (cueIcon && entry.mode === "input") {
                  cueIcon.y = (Number.isFinite(activityCue.iconBaseY) ? Number(activityCue.iconBaseY) : 0) + Math.round(Math.sin((now + entry.phase) / 145) * 1);
                  if (cueAccent) {
                    cueAccent.alpha = 0.48 + ((Math.sin((now + entry.phase) / 130) + 1) / 2) * 0.46;
                  }
                } else if (cueIcon && entry.mode === "resolved") {
                  const resolvedLift = Math.round(progress * 1.5);
                  cueIcon.y = (Number.isFinite(activityCue.iconBaseY) ? Number(activityCue.iconBaseY) : 0) - resolvedLift;
                  cueIcon.scale.set(1 + (1 - progress) * 0.08);
                  if (cueAccent) {
                    cueAccent.alpha = 0.72 + (1 - progress) * 0.24;
                    cueAccent.rotation = (now + entry.phase) / 260;
                  }
                  if (cueText) {
                    cueText.y = (Number.isFinite(activityCue.textBaseY) ? Number(activityCue.textBaseY) : cueText.y) - resolvedLift;
                  }
                }
                activityCue.container.alpha = Math.max(
                  0,
                  Math.min(1, fade * (motionState.sprite ? Number(motionState.sprite.alpha || 1) : 1))
                );
                activityCue.container.scale.set(pulse);
                if (typeof renderer.syncMotionStateDepth === "function") {
                  renderer.syncMotionStateDepth(motionState);
                }
                return;
              }
              if (entry.kind === "workstation-cue-effect") {
                if (!entry.node) {
                  return;
                }
                const durationMs = Math.max(900, Number(entry.durationMs) || 2200);
                const ageMs = Math.max(0, Date.now() - Number(entry.startedAtMs || Date.now()));
                const progress = Math.min(1, ageMs / durationMs);
                const fade = progress >= 0.7
                  ? Math.max(0, 1 - (progress - 0.7) / 0.3)
                  : 1;
                const pulse = (Math.sin((now + entry.phase) / 130) + 1) / 2;
                entry.node.x = pixelSnap(Number(entry.baseX) || 0);
                entry.node.y = pixelSnap(Number(entry.baseY) || 0);
                entry.node.alpha = Math.max(0, 0.22 + fade * 0.9);
                entry.node.scale.set(1);
                if (entry.glowNode) {
                  entry.glowNode.alpha = 0.1 + fade * 0.24 + pulse * 0.12;
                }
                if (entry.frameNode) {
                  entry.frameNode.alpha = 0.26 + fade * 0.36;
                }
                if (entry.primaryNode) {
                  entry.primaryNode.alpha = 0.62 + fade * 0.34;
                  entry.primaryNode.rotation = 0;
                  entry.primaryNode.scale.set(1);
                }
                if (entry.secondaryNode) {
                  entry.secondaryNode.alpha = 0.54 + fade * 0.28;
                  entry.secondaryNode.rotation = 0;
                  entry.secondaryNode.scale.set(1);
                }
                (entry.accentNodes || []).forEach((node) => {
                  if (node) {
                    node.alpha = 0.52 + fade * 0.28;
                    node.rotation = 0;
                    node.scale.set(1);
                  }
                });
                (entry.dotNodes || []).forEach((node) => {
                  if (node) {
                    node.alpha = 0.54 + fade * 0.3;
                    node.scale.set(1);
                  }
                });
                (entry.detailNodes || []).forEach((node) => {
                  if (node) {
                    node.alpha = 0.5 + fade * 0.28;
                    node.rotation = 0;
                    node.scale.set(1);
                  }
                });
                if (entry.mode === "plan") {
                  entry.node.y = pixelSnap((Number(entry.baseY) || 0) - Math.round(progress * 4 + pulse * 1.2));
                  if (entry.primaryNode) {
                    entry.primaryNode.scale.x = 0.86 + pulse * 0.2;
                  }
                  if (entry.secondaryNode) {
                    entry.secondaryNode.scale.x = 0.78 + pulse * 0.24;
                  }
                } else if (entry.mode === "command") {
                  if (entry.accentNodes && entry.accentNodes[0]) {
                    const scanWidth = Math.max(5, Math.round((Number(entry.width) || 16) * 0.34));
                    entry.accentNodes[0].x = Math.round(progress * Math.max(3, (Number(entry.width) || 16) - scanWidth));
                    entry.accentNodes[0].alpha = 0.34 + (1 - progress) * 0.48;
                  }
                } else if (entry.mode === "file") {
                  entry.node.y = pixelSnap((Number(entry.baseY) || 0) - Math.round(progress * 2));
                  if (entry.secondaryNode) {
                    entry.secondaryNode.rotation = Math.sin((now + entry.phase) / 150) * 0.08;
                  }
                } else if (entry.mode === "tool") {
                  if (entry.secondaryNode) {
                    entry.secondaryNode.rotation = (now + entry.phase) / 480;
                  }
                  if (entry.primaryNode) {
                    entry.primaryNode.scale.set(0.96 + pulse * 0.12);
                  }
                } else if (entry.mode === "approval") {
                  const approvalProfile = entry.requestProfile && typeof entry.requestProfile === "object"
                    ? entry.requestProfile
                    : null;
                  if (entry.secondaryNode) {
                    entry.secondaryNode.scale.set(0.84 + progress * 0.48 + pulse * 0.1);
                    entry.secondaryNode.alpha = 0.18 + (1 - progress) * 0.46;
                  }
                  if (entry.primaryNode) {
                    entry.primaryNode.scale.set(0.94 + pulse * 0.1);
                  }
                  (entry.dotNodes || []).forEach((node, index, nodes) => {
                    if (!node) {
                      return;
                    }
                    const orbitRadius = Math.max(3, Math.round(Math.min(Number(entry.width) || 16, Number(entry.height) || 10) * 0.42));
                    const angle = -Math.PI * 0.82
                      + (index / Math.max(1, nodes.length - 1)) * Math.PI * 0.64
                      + (1 - progress) * 0.18;
                    node.x = Math.round((Number(entry.width) || 16) / 2 + Math.cos(angle) * orbitRadius);
                    node.y = Math.round((Number(entry.height) || 10) / 2 + Math.sin(angle) * orbitRadius);
                    node.alpha = 0.26 + ((Math.sin((now + entry.phase) / 140 + index * 0.7) + 1) / 2) * 0.56;
                    node.scale.set(0.86 + pulse * 0.18);
                  });
                  (entry.detailNodes || []).forEach((node, index) => {
                    if (!node) {
                      return;
                    }
                    node.alpha = 0.4 + ((Math.sin((now + entry.phase) / 160 + index * 0.9) + 1) / 2) * 0.42;
                    if (approvalProfile && approvalProfile.approvalType === "file") {
                      node.y = 2 - Math.round(Math.sin((now + entry.phase) / 170) * 0.6);
                    } else if (approvalProfile && approvalProfile.approvalType === "network") {
                      node.y = Math.max(2, (Number(entry.height) || 10) - 3) - Math.round(Math.sin((now + entry.phase) / 150 + index * 0.6) * 0.7);
                    }
                  });
                } else if (entry.mode === "input") {
                  const inputProfile = entry.requestProfile && typeof entry.requestProfile === "object"
                    ? entry.requestProfile
                    : null;
                  const questionCount = Math.max(1, Math.min(4, Number(inputProfile && inputProfile.questionCount) || (entry.dotNodes || []).length || 1));
                  const requiredCount = Math.max(0, Math.min(questionCount, Number(inputProfile && inputProfile.requiredCount) || 0));
                  (entry.dotNodes || []).forEach((node, index) => {
                    if (!node) {
                      return;
                    }
                    node.y = Math.max(3, (Number(entry.height) || 10) - 5) - Math.round(((Math.sin((now + entry.phase) / 140 + index * 0.8) + 1) / 2) * 2.2);
                    node.alpha = 0.28 + ((Math.sin((now + entry.phase) / 150 + index * 0.75) + 1) / 2) * 0.58;
                    node.scale.y = 0.82 + ((Math.sin((now + entry.phase) / 160 + index * 0.6) + 1) / 2) * 0.42;
                    node.scale.x = 1;
                  });
                  (entry.accentNodes || []).forEach((node, index) => {
                    if (!node) {
                      return;
                    }
                    node.alpha = index < requiredCount
                      ? 0.44 + ((Math.sin((now + entry.phase) / 145 + index * 0.9) + 1) / 2) * 0.46
                      : 0.24;
                    node.y = 2 - Math.round(Math.sin((now + entry.phase) / 180 + index * 0.7) * 0.8);
                  });
                  (entry.detailNodes || []).forEach((node, index) => {
                    if (!node) {
                      return;
                    }
                    node.alpha = 0.32 + ((Math.sin((now + entry.phase) / 170 + index * 0.65) + 1) / 2) * 0.44;
                  });
                } else if (entry.mode === "resolved") {
                  entry.node.y = pixelSnap((Number(entry.baseY) || 0) - Math.round(progress * 5));
                  if (entry.primaryNode) {
                    entry.primaryNode.scale.set(1 + (1 - progress) * 0.08);
                  }
                  if (entry.secondaryNode) {
                    entry.secondaryNode.rotation = (now + entry.phase) / 300;
                    entry.secondaryNode.alpha = 0.34 + (1 - progress) * 0.42;
                  }
                }
                return;
              }
              if (entry.kind === "thrown-item") {
                const duration = Math.max(1, Number(entry.durationMs) || 700);
                const elapsed = Math.max(0, now - Number(entry.startedAt || now));
                const progress = Math.min(1, elapsed / duration);
                entry.sprite.x = pixelSnap(entry.startX + (Number(entry.dx) || 0) * progress);
                entry.sprite.y = pixelSnap(entry.startY + (Number(entry.dy) || 0) * progress - Math.sin(progress * Math.PI) * (Number(entry.jumpPx) || 12));
                entry.sprite.alpha = Math.max(0, 1 - progress);
              }
            });
            const doorDefinition = sceneDefinitions && sceneDefinitions.door ? sceneDefinitions.door : {};
            const slideOffsetPx = Number.isFinite(doorDefinition.slideOffsetPx) ? Number(doorDefinition.slideOffsetPx) : 8;
            const openLerp = Number.isFinite(doorDefinition.openLerp) ? Number(doorDefinition.openLerp) : 0.24;
            const closeLerp = Number.isFinite(doorDefinition.closeLerp) ? Number(doorDefinition.closeLerp) : 0.16;
            renderer.roomDoorStates.forEach((doorState) => {
              if (!doorState) {
                return;
              }
              const targetOpen = Number(doorState.doorPulseUntil) > now ? 1 : 0;
              const lerp = targetOpen > Number(doorState.openAmount || 0) ? openLerp : closeLerp;
              doorState.openAmount = Number(doorState.openAmount || 0) + (targetOpen - Number(doorState.openAmount || 0)) * lerp;
              if (Math.abs(targetOpen - doorState.openAmount) < 0.01) {
                doorState.openAmount = targetOpen;
              }
              const slide = Math.round(slideOffsetPx * doorState.openAmount);
              if (doorState.leftSprite) {
                doorState.leftSprite.x = pixelSnap(doorState.baseLeftX - slide);
              }
              if (doorState.rightSprite) {
                doorState.rightSprite.x = pixelSnap(doorState.baseRightX + slide);
              }
            });
            renderer.animatedSprites = renderer.animatedSprites.filter((entry) => {
              if (!entry) {
                return false;
              }
              if (entry.kind === "blink") {
                const done = now - Number(entry.startedAt || now) >= Number(entry.durationMs || 140);
                if (done) {
                  (entry.nodes || []).forEach((node) => {
                    if (node) {
                      node.visible = true;
                    }
                  });
                }
                return !done;
              }
              if (entry.kind === "thrown-item") {
                const done = now - Number(entry.startedAt || now) >= Number(entry.durationMs || 700);
                if (done && entry.sprite && entry.sprite.parent) {
                  entry.sprite.parent.removeChild(entry.sprite);
                  entry.sprite.destroy?.();
                }
                return !done;
              }
              if (entry.kind === "turn-signal") {
                const motionState = entry.motionState || null;
                const turnSignal = motionState && motionState.turnSignal ? motionState.turnSignal : null;
                const done = !turnSignal
                  || !turnSignal.container
                  || Date.now() - Number(turnSignal.startedAtMs || Date.now()) >= Math.max(600, Number(turnSignal.durationMs) || 2400);
                if (done && turnSignal && turnSignal.container && turnSignal.container.parent) {
                  turnSignal.container.parent.removeChild(turnSignal.container);
                  turnSignal.container.destroy?.({ children: true });
                }
                return !done;
              }
              if (entry.kind === "activity-cue") {
                const motionState = entry.motionState || null;
                const activityCue = motionState && motionState.activityCue ? motionState.activityCue : null;
                const done = !activityCue
                  || !activityCue.container
                  || Date.now() - Number(activityCue.startedAtMs || Date.now()) >= Math.max(900, Number(activityCue.durationMs) || 2200);
                if (done && activityCue && activityCue.container && activityCue.container.parent) {
                  activityCue.container.parent.removeChild(activityCue.container);
                  activityCue.container.destroy?.({ children: true });
                }
                return !done;
              }
              if (entry.kind === "workstation-cue-effect") {
                const done = !entry.node
                  || !entry.node.parent
                  || Date.now() - Number(entry.startedAtMs || Date.now()) >= Math.max(900, Number(entry.durationMs) || 2200);
                if (done && entry.node && entry.node.parent) {
                  entry.node.parent.removeChild(entry.node);
                  entry.node.destroy?.({ children: true });
                }
                return !done;
              }
              if (entry.kind === "workstation-glow") {
                return Boolean(entry.node && entry.node.parent);
              }
              if (entry.kind === "state-effect") {
                return Boolean(
                  entry.motionState
                  && entry.motionState.sprite
                  && (!entry.motionState.exiting || entry.motionState.sprite.alpha > 0.02)
                );
              }
              return !entry.exiting || entry.sprite.alpha > 0.02;
            });
            if (notifications.length > 0 && renderer.animatedSprites.some((entry) => entry && entry.kind === "motion")) {
              renderNotifications();
            }
          };
          renderer.app.ticker.add(renderer.animateTick);
          renderer.resizeObserver = new ResizeObserver(() => {
            if (renderer.model) {
              syncOfficeRendererScene(renderer, renderer.model);
            }
          });
          renderer.resizeObserver.observe(host);
        });
        officeSceneRenderers.set(key, renderer);
        await renderer.ready;
        return renderer;
      }

      function collectOfficeSceneAssetUrls(model) {
        const urls = new Set();
        model.roomDoors.forEach((door) => {
          if (door && door.leftSprite) {
            urls.add(door.leftSprite);
          }
          if (door && door.rightSprite) {
            urls.add(door.rightSprite);
          }
        });
        model.tileObjects.forEach((object) => {
          if (object && object.sprite) {
            urls.add(object.sprite);
          }
        });
        model.desks.forEach((desk) => {
          desk.shell.forEach((item) => {
            if (item && item.kind === "sprite" && item.sprite) {
              urls.add(item.sprite);
            }
          });
          desk.agents.forEach((agent) => {
            if (agent && agent.sprite) {
              urls.add(agent.sprite);
            }
            const hat = hatDefinitionById(agent && agent.hatId);
            if (hat && hat.url) {
              urls.add(hat.url);
            }
            if (agent && agent.statusMarkerIconUrl) {
              urls.add(agent.statusMarkerIconUrl);
            }
          });
        });
        model.offices.forEach((office) => {
          office.shell.forEach((item) => {
            if (item && item.kind === "sprite" && item.sprite) {
              urls.add(item.sprite);
            }
          });
          if (office.agent && office.agent.sprite) {
            urls.add(office.agent.sprite);
          }
          const officeHat = hatDefinitionById(office.agent && office.agent.hatId);
          if (officeHat && officeHat.url) {
            urls.add(officeHat.url);
          }
          if (office.agent && office.agent.statusMarkerIconUrl) {
            urls.add(office.agent.statusMarkerIconUrl);
          }
        });
        model.recAgents.forEach((agent) => {
          if (agent && agent.sprite) {
            urls.add(agent.sprite);
          }
          const hat = hatDefinitionById(agent && agent.hatId);
          if (hat && hat.url) {
            urls.add(hat.url);
          }
          if (agent && agent.statusMarkerIconUrl) {
            urls.add(agent.statusMarkerIconUrl);
          }
        });
        model.facilities.forEach((facility) => {
          (facility.items || []).forEach((itemId) => {
            const itemDefinition = sceneHeldItemDefinition(itemId);
            if (itemDefinition && itemDefinition.sprite && itemDefinition.sprite.url) {
              urls.add(itemDefinition.sprite.url);
            }
          });
        });
        return [...urls];
      }

      async function ensureOfficeSceneAssets(model) {
  if (!window.PIXI) {
    return;
  }
  const pending = collectOfficeSceneAssetUrls(model).filter((url) => !loadedOfficeAssetUrls.has(url));
  if (pending.length === 0) {
    return;
  }
  const loadTimeoutMs = 4000;
  const preloadAsset = (url) => new Promise((resolve, reject) => {
    const image = new window.Image();
    let settled = false;
    const finish = (callback) => {
      if (settled) {
        return;
      }
      settled = true;
      window.clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      callback();
    };
    const timer = window.setTimeout(() => {
      finish(() => reject(new Error("Asset load timed out: " + url)));
    }, loadTimeoutMs);
    image.onload = () => {
      finish(() => {
        try {
          window.PIXI.Texture.from(url);
        } catch {}
        loadedOfficeAssetImages.set(url, image);
        resolve(url);
      });
    };
    image.onerror = () => {
      finish(() => reject(new Error("Asset load failed: " + url)));
    };
    image.src = url;
  });
  const results = await Promise.allSettled(pending.map((url) => preloadAsset(url)));
  const failures = [];
  results.forEach((result, index) => {
    const url = pending[index];
    if (result.status === "fulfilled") {
      loadedOfficeAssetUrls.add(url);
      return;
    }
    failures.push({
      url,
      message: result.reason instanceof Error ? result.reason.message : String(result.reason)
    });
  });
  if (failures.length > 0) {
    console.warn("office scene asset load degraded", failures);
  }
}

function roleTint(role) {
        const tone = roleTone(role).replace("#", "");
        return Number.parseInt(tone, 16);
      }

      function pixelSnap(value, minimum = 0) {
        const snapped = Math.round(Number(value) || 0);
        return minimum > 0 ? Math.max(minimum, snapped) : snapped;
      }

      function pixiTextResolution(renderer) {
        const deviceScale = Math.max(1, Number(window.devicePixelRatio || 1));
        const sceneScale = Math.max(1, Number(renderer?.scale || 1));
        return Math.max(2, deviceScale * sceneScale);
      }

      function createPixiText(renderer, text, style) {
        const label = new window.PIXI.Text({
          text,
          style
        });
        label.resolution = pixiTextResolution(renderer);
        label.roundPixels = true;
        return label;
      }

      function tileBoundsLabel(width, height, tileSize) {
        const tileWidth = Math.max(1, Math.round(width / tileSize));
        const tileHeight = Math.max(1, Math.round(height / tileSize));
        return \`\${tileWidth}x\${tileHeight}\`;
      }

      function officeAvatarFootTile(room, tileSize, x, y, width, height) {
        if (!room) {
          return null;
        }
        const footX = x + width / 2;
        const footY = y + height - 1;
        const column = Math.max(0, Math.min(Math.floor(room.width / tileSize) - 1, Math.floor((footX - room.x) / tileSize)));
        const row = Math.max(0, Math.min(Math.floor((room.height - room.wallHeight) / tileSize) - 1, Math.floor((footY - room.floorTop) / tileSize)));
        return { column, row };
      }



      function buildPixiSpriteDef(sprite, x, y, scale, z, options = {}) {
        return {
          kind: "sprite",
          sprite: sprite.url,
          x: Math.round(x),
          y: Math.round(y),
          width: Math.round(sprite.w * scale),
          height: Math.round(sprite.h * scale),
          flipX: options.flipX === true,
          enteringReveal: options.enteringReveal === true,
          alpha: options.alpha ?? 1,
          depthFootY: Number.isFinite(options.depthFootY) ? Math.round(options.depthFootY) : null,
          depthBaseY: Number.isFinite(options.depthBaseY) ? Math.round(options.depthBaseY) : null,
          depthRow: Number.isFinite(options.depthRow) ? Math.round(options.depthRow) : null,
          depthBias: Number.isFinite(options.depthBias) ? Number(options.depthBias) : null,
          z
        };
      }

      function shouldRevealWorkstation(projectRoot, agent, slotId) {
        if (screenshotMode || !agent || typeof slotId !== "string" || slotId.length === 0) {
          return false;
        }
        const key = agentKey(projectRoot, agent);
        if (enteringAgentKeys.has(key)) {
          return true;
        }
        const previousSceneState = renderedAgentSceneState.get(key) || null;
        const previousSlotId = previousSceneState && typeof previousSceneState.slotId === "string"
          ? previousSceneState.slotId
          : null;
        return previousSlotId !== slotId;
      }`;
