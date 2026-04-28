export const CLIENT_RUNTIME_NAVIGATION_SOURCE = `const stableAgentTileReservations = new Map();

      function reserveAgentTiles(model, roomById) {
        const reservations = new Map();
        const collect = (agent) => {
          if (!agent || !(agent.key || agent.id)) {
            return;
          }
          const room = roomById.get(agent.roomId);
          const tilePoint = officeAvatarFootTile(room, model.tile, agent.x, agent.y, agent.width, agent.height);
          if (!tilePoint) {
            return;
          }
          const reservationKey = agent.key || agent.id;
          const previousReservation = stableAgentTileReservations.get(reservationKey);
          const reservation = previousReservation
            && previousReservation.roomId === agent.roomId
            && Math.abs(previousReservation.column - tilePoint.column) <= 1
            && Math.abs(previousReservation.row - tilePoint.row) <= 1
            ? previousReservation
            : {
              roomId: agent.roomId,
              column: tilePoint.column,
              row: tilePoint.row
            };
          reservations.set(reservationKey, reservation);
          stableAgentTileReservations.set(reservationKey, reservation);
        };
        return reservations;
      }

      function officeAvatarPositionForTile(room, tileSize, tilePoint, width, height) {
        return {
          x: room.x + tilePoint.column * tileSize + Math.round((tileSize - width) / 2),
          y: room.floorTop + (tilePoint.row + 1) * tileSize - height
        };
      }

      function officeAvatarPositionForFacility(room, tileSize, serviceTile, width, height) {
        const position = officeAvatarPositionForTile(room, tileSize, serviceTile, width, height);
        const approachOffset = serviceTile && serviceTile.approachOffsetPx ? serviceTile.approachOffsetPx : null;
        if (!approachOffset) {
          return position;
        }
        return {
          x: position.x + (Number.isFinite(approachOffset.x) ? Number(approachOffset.x) : 0),
          y: position.y + (Number.isFinite(approachOffset.y) ? Number(approachOffset.y) : 0)
        };
      }

      function roomDoorTile(room, tileSize) {
        return {
          column: Math.max(0, Math.min(Math.floor(room.width / tileSize) - 1, Math.floor(room.width / tileSize / 2))),
          row: 0
        };
      }

      function markNavigationRect(grid, startColumn, startRow, widthTiles, heightTiles) {
        for (let row = startRow; row < startRow + heightTiles; row += 1) {
          if (!grid[row]) {
            continue;
          }
          for (let column = startColumn; column < startColumn + widthTiles; column += 1) {
            if (grid[row][column] === undefined) {
              continue;
            }
            grid[row][column] = 1;
          }
        }
      }

      function buildOfficeNavigation(model) {
        const roomById = new Map(model.rooms.map((room) => [room.id, room]));
        const navigation = new Map();
        model.rooms.forEach((room) => {
          const columns = Math.max(1, Math.round(room.width / model.tile));
          const rows = Math.max(1, Math.round((room.height - room.wallHeight) / model.tile));
          navigation.set(room.id, {
            room,
            columns,
            rows,
            grid: Array.from({ length: rows }, () => Array.from({ length: columns }, () => 0))
          });
        });

        model.tileObjects.forEach((object) => {
          if (!object || object.anchor === "wall") {
            return;
          }
          const nav = navigation.get(object.roomId);
          if (!nav) {
            return;
          }
          markNavigationRect(nav.grid, object.column, Math.max(0, object.baseRow), Math.max(1, object.widthTiles), Math.max(1, object.heightTiles));
        });

        model.workstations.forEach((workstation) => {
          const nav = navigation.get(workstation.roomId);
          const room = roomById.get(workstation.roomId);
          if (!nav || !room) {
            return;
          }
          const column = Math.max(0, Math.floor((workstation.x - room.x) / model.tile));
          const row = Math.max(0, Math.floor((workstation.y - room.floorTop) / model.tile));
          markNavigationRect(nav.grid, column, row, Math.max(1, workstation.tileWidth || 1), Math.max(1, workstation.tileHeight || 1));
        });

        return navigation;
      }

      function cloneNavigation(nav) {
        if (!nav) {
          return null;
        }
        return {
          ...nav,
          grid: nav.grid.map((row) => row.slice())
        };
      }

      function reserveAgentTiles(model, roomById) {
        const reservations = new Map();
        const collect = (agent) => {
          if (!agent || !(agent.key || agent.id)) {
            return;
          }
          const room = roomById.get(agent.roomId);
          const tilePoint = officeAvatarFootTile(room, model.tile, agent.x, agent.y, agent.width, agent.height);
          if (!tilePoint) {
            return;
          }
          reservations.set(agent.key || agent.id, {
            roomId: agent.roomId,
            column: tilePoint.column,
            row: tilePoint.row
          });
        };
        model.desks.forEach((desk) => desk.agents.forEach(collect));
        model.offices.forEach((office) => {
          if (office.agent) {
            collect(office.agent);
          }
        });
        model.recAgents.forEach(collect);
        return reservations;
      }

      function navigationForAgent(roomNavigation, reservations, roomId, agentKey) {
        const baseNav = roomNavigation.get(roomId);
        const nav = cloneNavigation(baseNav);
        if (!nav) {
          return null;
        }
        reservations.forEach((entry, key) => {
          if (!entry || key === agentKey || entry.roomId !== roomId) {
            return;
          }
          if (nav.grid[entry.row]?.[entry.column] !== undefined) {
            nav.grid[entry.row][entry.column] = 1;
          }
        });
        return nav;
      }

      function nearestWalkableTile(nav, desiredTile) {
        if (!nav || !desiredTile) {
          return null;
        }
        const inBounds = (column, row) => row >= 0 && row < nav.rows && column >= 0 && column < nav.columns;
        const walkable = (column, row) => inBounds(column, row) && nav.grid[row][column] === 0;
        if (walkable(desiredTile.column, desiredTile.row)) {
          return desiredTile;
        }
        for (let radius = 1; radius <= Math.max(nav.columns, nav.rows); radius += 1) {
          for (let row = desiredTile.row - radius; row <= desiredTile.row + radius; row += 1) {
            for (let column = desiredTile.column - radius; column <= desiredTile.column + radius; column += 1) {
              if (Math.abs(column - desiredTile.column) + Math.abs(row - desiredTile.row) > radius) {
                continue;
              }
              if (walkable(column, row)) {
                return { column, row };
              }
            }
          }
        }
        return null;
      }

      function solveEasyStarPath(nav, startTile, endTile) {
        const EasyStarConstructor = window.EasyStar && typeof window.EasyStar.js === "function"
          ? window.EasyStar.js
          : null;
        if (!EasyStarConstructor || !nav || !startTile || !endTile) {
          return null;
        }
        const pathfinder = new EasyStarConstructor();
        const grid = nav.grid.map((row) => row.slice());
        grid[startTile.row][startTile.column] = 0;
        grid[endTile.row][endTile.column] = 0;
        pathfinder.setGrid(grid);
        pathfinder.setAcceptableTiles([0]);
        pathfinder.setIterationsPerCalculation(Math.max(1000, nav.columns * nav.rows * 4));
        let resolved = false;
        let result = null;
        pathfinder.findPath(startTile.column, startTile.row, endTile.column, endTile.row, (path) => {
          result = Array.isArray(path) ? path : null;
          resolved = true;
        });
        let guard = 0;
        while (!resolved && guard < 128) {
          pathfinder.calculate();
          guard += 1;
        }
        return result;
      }

      function buildAgentPixelRoute(nav, startTile, endTile, room, tileSize, width, height, exactTarget) {
        if (!nav || !startTile || !endTile || !room) {
          return exactTarget ? [exactTarget] : [];
        }
        const tilePath = solveEasyStarPath(nav, startTile, endTile) || [startTile, endTile];
        const route = tilePath.map((step) =>
          officeAvatarPositionForTile(room, tileSize, { column: step.x ?? step.column, row: step.y ?? step.row }, width, height)
        );
        if (exactTarget) {
          const last = route[route.length - 1];
          if (!last || last.x !== exactTarget.x || last.y !== exactTarget.y) {
            route.push({ x: exactTarget.x, y: exactTarget.y });
          }
        }
        return route;
      }

      function syncAgentHitNodePosition(renderer, motionState) {
        if (!renderer || !motionState || !motionState.anchorNode) {
          return;
        }
        motionState.anchorNode.style.left = Math.round(motionState.currentX * renderer.scale) + "px";
        motionState.anchorNode.style.top = Math.round(motionState.currentY * renderer.scale) + "px";
        motionState.anchorNode.style.width = Math.max(8, Math.round(motionState.width * renderer.scale)) + "px";
        motionState.anchorNode.style.height = Math.max(8, Math.round(motionState.height * renderer.scale)) + "px";
      }

      function threadHistoryAtBottom(history) {
        if (!(history instanceof HTMLElement)) {
          return true;
        }
        return history.scrollHeight - history.scrollTop - history.clientHeight <= 12;
      }

      function scrollThreadHistoryToBottom(history) {
        if (!(history instanceof HTMLElement)) {
          return;
        }
        history.scrollTop = history.scrollHeight;
        window.requestAnimationFrame(() => {
          history.scrollTop = history.scrollHeight;
        });
      }

      function replacePanelSectionIfChanged(card, nextCard, selector) {
        const current = card.querySelector(selector);
        const next = nextCard.querySelector(selector);
        if (!(current instanceof HTMLElement) || !(next instanceof HTMLElement)) {
          return;
        }
        const nextHtml = next.innerHTML;
        if (current.dataset.renderHtml !== nextHtml) {
          current.innerHTML = nextHtml;
          current.dataset.renderHtml = nextHtml;
        }
      }

      function syncThreadHistory(history, nextHistory) {
        if (!(history instanceof HTMLElement) || !(nextHistory instanceof HTMLElement)) {
          return;
        }
        const wasAtBottom = threadHistoryAtBottom(history);
        const nextNodes = Array.from(nextHistory.children).filter((node) => node instanceof HTMLElement);
        const currentByKey = new Map(
          Array.from(history.children)
            .filter((node) => node instanceof HTMLElement)
            .map((node) => [node.dataset.threadEntryKey || node.dataset.threadEmpty || node.outerHTML, node])
        );
        const nextKeys = new Set();
        nextNodes.forEach((nextNode) => {
          const key = nextNode.dataset.threadEntryKey || nextNode.dataset.threadEmpty || nextNode.outerHTML;
          nextKeys.add(key);
          const existing = currentByKey.get(key);
          if (existing instanceof HTMLElement) {
            const nextHtml = nextNode.innerHTML;
            if (existing.dataset.renderHtml !== nextHtml) {
              existing.className = nextNode.className;
              existing.innerHTML = nextHtml;
              existing.dataset.renderHtml = nextHtml;
            } else if (existing.className !== nextNode.className) {
              existing.className = nextNode.className;
            }
            history.appendChild(existing);
            return;
          }
          const fresh = nextNode.cloneNode(true);
          if (fresh instanceof HTMLElement) {
            fresh.dataset.renderHtml = fresh.innerHTML;
            if (fresh.dataset.threadEntryKey) {
              fresh.classList.add("is-new");
              fresh.addEventListener("animationend", () => fresh.classList.remove("is-new"), { once: true });
            }
            history.appendChild(fresh);
          }
        });
        Array.from(history.children).forEach((node) => {
          if (!(node instanceof HTMLElement)) {
            return;
          }
          const key = node.dataset.threadEntryKey || node.dataset.threadEmpty || node.outerHTML;
          if (!nextKeys.has(key)) {
            node.remove();
          }
        });
        if (wasAtBottom) {
          scrollThreadHistoryToBottom(history);
        }
      }

      function syncThreadPanel(renderer, model) {
        if (!renderer.threadLayer) {
          renderer.host.classList.toggle("has-thread-panel", Boolean(model.threadPanel));
          return;
        }
        renderer.threadLayer.classList.toggle("has-thread-panel", Boolean(model.threadPanel));
        renderer.host.classList.toggle("has-thread-panel", Boolean(model.threadPanel));
        if (!model.threadPanel || !model.threadPanel.html) {
          renderer.threadLayer.innerHTML = "";
          return;
        }
        let slot = renderer.threadLayer.querySelector("[data-thread-panel-slot]");
        const panelKey = model.threadPanel.key || "";
        const panelState = model.threadPanel.state || "open";
        if (!(slot instanceof HTMLElement) || slot.dataset.threadPanelKey !== panelKey) {
          if (!(slot instanceof HTMLElement)) {
            slot = document.createElement("div");
            renderer.threadLayer.appendChild(slot);
          }
          slot.className = "office-map-thread-panel-slot";
          slot.dataset.threadPanelSlot = panelState;
          slot.dataset.threadPanelKey = panelKey;
          slot.innerHTML = model.threadPanel.html;
          scrollThreadHistoryToBottom(slot.querySelector(".office-map-thread-history"));
          return;
        }
        slot.dataset.threadPanelSlot = panelState;
        const template = document.createElement("template");
        template.innerHTML = model.threadPanel.html;
        const card = slot.querySelector("[data-agent-thread-card]");
        const nextCard = template.content.querySelector("[data-agent-thread-card]");
        if (!(card instanceof HTMLElement) || !(nextCard instanceof HTMLElement)) {
          slot.innerHTML = model.threadPanel.html;
          return;
        }
        if (card.className !== nextCard.className) {
          card.className = nextCard.className;
        }
        replacePanelSectionIfChanged(card, nextCard, ".office-map-thread-card-header");
        replacePanelSectionIfChanged(card, nextCard, ".office-map-thread-card-tag");
        syncThreadHistory(card.querySelector(".office-map-thread-history"), nextCard.querySelector(".office-map-thread-history"));
      }

      function syncOfficeAnchors(renderer, model, scale) {
        const layer = renderer.anchorLayer;
        layer.innerHTML = "";
        syncThreadPanel(renderer, model);
        renderer.agentHitNodes = new Map();
        model.anchors.forEach((anchor) => {
          const node = document.createElement("div");
          if (anchor.type === "agent") {
            node.className = "office-map-agent-hit";
            node.dataset.agentKey = anchor.key;
            node.dataset.focusAgent = "true";
            if (anchor.threadOpen) {
              node.classList.add("is-thread-open");
            }
            if (anchor.focusKey) {
              node.dataset.focusKey = anchor.focusKey;
            }
            if (Array.isArray(anchor.focusKeys)) {
              node.dataset.focusKeys = JSON.stringify(anchor.focusKeys);
            }
            node.style.left = Math.round((anchor.left ?? anchor.x) * scale) + "px";
            node.style.top = Math.round((anchor.top ?? anchor.y) * scale) + "px";
            node.style.width = Math.max(8, Math.round((anchor.width ?? 0) * scale)) + "px";
            node.style.height = Math.max(8, Math.round((anchor.height ?? 0) * scale)) + "px";
            const triggerHtml = anchor.replyProjectRoot && anchor.threadId
              ? \`<button type="button" class="office-map-agent-trigger" data-action="open-agent-thread" data-project-root="\${escapeHtml(anchor.replyProjectRoot)}" data-thread-id="\${escapeHtml(anchor.threadId)}" aria-label="Open \${escapeHtml(anchor.key)} chat"></button>\`
              : "";
            node.innerHTML = triggerHtml + (anchor.hoverHtml || "");
            renderer.agentHitNodes.set(anchor.key, node);
          } else {
            node.className = "office-map-anchor";
            node.dataset.workstationKey = anchor.key;
            node.style.left = Math.round(anchor.x * scale) + "px";
            node.style.top = Math.round(anchor.y * scale) + "px";
          }
          layer.appendChild(node);
        });
        model.furniture.forEach((item) => {
          const node = document.createElement("div");
          node.className = "office-map-furniture-hit";
          node.dataset.furnitureId = item.id;
          node.dataset.roomId = item.roomId;
          node.style.left = Math.round(item.column * model.tile * scale) + "px";
          node.style.top = Math.round(model.rooms.find((room) => room.id === item.roomId).floorTop * scale) + "px";
          node.style.width = Math.round(item.widthTiles * model.tile * scale) + "px";
          node.style.height = Math.round(model.tile * scale) + "px";
          layer.appendChild(node);
        });
      }

      function sceneFootDepth(y, height, bias = 0, tileSize = 16, depthBaseY = 0, depthRow = null) {
        const footY = Number(y) + Number(height);
        const unit = Number.isFinite(tileSize) && tileSize > 0 ? Number(tileSize) : 16;
        const depthBase = Number.isFinite(depthBaseY) ? Number(depthBaseY) : 0;
        const relativeFootY = footY - depthBase;
        const tileRow = Number.isFinite(depthRow) ? Number(depthRow) : Math.floor(relativeFootY / unit);
        const intraTileY = relativeFootY - tileRow * unit;
        return (100000 + Math.round(depthBase)) * 1000000 + (1000 + tileRow) * 1000 + Math.round(intraTileY * 10) + (Number.isFinite(bias) ? Number(bias) : 0);
      }

      function applyFootDepth(node, y, height, bias = 0, tileSize = 16, depthBaseY = 0, depthRow = null) {
        if (!node) {
          return;
        }
        node.zIndex = sceneFootDepth(y, height, bias, tileSize, depthBaseY, depthRow);
      }

      function syncOfficeRendererScene(renderer, model) {
        if (!renderer || !renderer.root || !window.PIXI) {
          return;
        }
        renderer.model = model;
        const availableWidth = Math.max(Math.round(renderer.host.getBoundingClientRect().width || renderer.host.clientWidth || model.width), 1);
        const scale = Math.min(Math.max(availableWidth / model.width, 0.5), 3.5);
        const scaledWidth = Math.max(1, Math.min(availableWidth, Math.round(model.width * scale)));
        const scaledHeight = Math.max(180, Math.round(model.height * scale));
        const leftOffset = Math.max(0, Math.round((availableWidth - scaledWidth) / 2));
        renderer.scale = scale;
        renderer.leftOffset = leftOffset;
        renderer.host.style.height = scaledHeight + "px";
        renderer.canvasContainer.style.left = leftOffset + "px";
        renderer.canvasContainer.style.width = scaledWidth + "px";
        renderer.canvasContainer.style.height = scaledHeight + "px";
        renderer.anchorLayer.style.left = leftOffset + "px";
        renderer.anchorLayer.style.width = scaledWidth + "px";
        renderer.anchorLayer.style.height = scaledHeight + "px";
        if (renderer.threadLayer) {
          renderer.threadLayer.style.left = leftOffset + "px";
          renderer.threadLayer.style.width = scaledWidth + "px";
          renderer.threadLayer.style.height = scaledHeight + "px";
        }
        renderer.app.renderer.resize(scaledWidth, scaledHeight);
        const previousMotionStates = new Map(renderer.motionStates || []);
        const previousDoorStates = new Map(renderer.roomDoorStates || []);
        renderer.motionStates = new Map();
        renderer.roomDoorStates = new Map();
        renderer.root.removeChildren();
        renderer.root.scale.set(scale, scale);
        renderer.animatedSprites = [];
        renderer.focusables = [];

        const PIXI = window.PIXI;
        const roomById = new Map(model.rooms.map((room) => [room.id, room]));
        const roomNavigation = buildOfficeNavigation(model);
        syncOfficeAnchors(renderer, model, scale);
        const reservedAgentTiles = reserveAgentTiles(model, roomById);
        renderer.roomById = roomById;
        renderer.roomNavigation = roomNavigation;
        renderer.reservedAgentTiles = reservedAgentTiles;
        renderer.debugWorkstationNodes = [];
        renderer.debugDepthWarnings = new Set();
        const workstationByKey = new Map(
          (Array.isArray(model.workstations) ? model.workstations : [])
            .filter((workstation) => workstation && workstation.key)
            .map((workstation) => [workstation.key, workstation])
        );
        const background = new PIXI.Graphics()
          .roundRect(0, 0, model.width, model.height, 14)
          .fill({ color: 0x0b1b2b })
          .stroke({ color: 0x2e5c7b, width: 2 });
        background.zIndex = 0;
        renderer.root.addChild(background);

        function parseSceneColor(value, fallback) {
          if (typeof value === "string" && value.startsWith("#")) {
            const parsed = Number.parseInt(value.slice(1), 16);
            if (Number.isFinite(parsed)) {
              return parsed;
            }
          }
          if (Number.isFinite(value)) {
            return Number(value);
          }
          return fallback;
        }

        function sceneDoorConfig() {
          const door = sceneDefinitions && sceneDefinitions.door ? sceneDefinitions.door : {};
          return {
            backdropColor: parseSceneColor(door.backdropColor, 0x071018),
            backdropAlpha: Number.isFinite(door.backdropAlpha) ? Number(door.backdropAlpha) : 0.96,
            holdOpenMs: Number.isFinite(door.holdOpenMs) ? Number(door.holdOpenMs) : 520,
            slideOffsetPx: Number.isFinite(door.slideOffsetPx) ? Number(door.slideOffsetPx) : 8
          };
        }

        function sceneIdleBehaviorConfig() {
          const idle = sceneDefinitions && sceneDefinitions.idleBehavior ? sceneDefinitions.idleBehavior : {};
          return {
            flipIntervalMs: idle.flipIntervalMs || { min: 1000, max: 12000 },
            facilityVisitIntervalMs: idle.facilityVisitIntervalMs || { min: 7000, max: 16000 },
            restingSpeedScale: Number.isFinite(idle.restingSpeedScale) ? Number(idle.restingSpeedScale) : 1,
            itemDurationMs: Number.isFinite(idle.itemDurationMs) ? Number(idle.itemDurationMs) : 15000,
            throwAwayDurationMs: Number.isFinite(idle.throwAwayDurationMs) ? Number(idle.throwAwayDurationMs) : 700,
            throwAwayJumpPx: Number.isFinite(idle.throwAwayJumpPx) ? Number(idle.throwAwayJumpPx) : 13
          };
        }

        function randomBetween(range, fallbackMin, fallbackMax) {
          const min = Number.isFinite(range?.min) ? Number(range.min) : fallbackMin;
          const max = Number.isFinite(range?.max) ? Number(range.max) : fallbackMax;
          if (max <= min) {
            return min;
          }
          return min + Math.round(Math.random() * (max - min));
        }

        function nextIdleFlipAt(now = performance.now()) {
          return now + randomBetween(sceneIdleBehaviorConfig().flipIntervalMs, 1000, 12000);
        }

        function nextIdleTripAt(now = performance.now()) {
          return now + randomBetween(sceneIdleBehaviorConfig().facilityVisitIntervalMs, 7000, 16000);
        }

        function isAutonomousRestingAgent(agent) {
          return agent && agent.kind === "resting" && (agent.state === "idle" || agent.state === "done");
        }

        function ensureHeldItemSprite(motionState) {
          const autonomy = motionState && motionState.autonomy ? motionState.autonomy : null;
          const itemDefinition = autonomy && autonomy.carriedItemId ? sceneHeldItemDefinition(autonomy.carriedItemId) : null;
          if (!itemDefinition) {
            if (motionState && motionState.heldItemSprite && motionState.heldItemSprite.parent) {
              motionState.heldItemSprite.parent.removeChild(motionState.heldItemSprite);
              motionState.heldItemSprite.destroy?.();
            }
            if (motionState) {
              motionState.heldItemSprite = null;
            }
            return null;
          }
          if (motionState.heldItemSprite && motionState.heldItemSprite.__itemId === itemDefinition.id) {
            return motionState.heldItemSprite;
          }
          if (motionState.heldItemSprite && motionState.heldItemSprite.parent) {
            motionState.heldItemSprite.parent.removeChild(motionState.heldItemSprite);
            motionState.heldItemSprite.destroy?.();
          }
          const sprite = PIXI.Sprite.from(loadedOfficeAssetImages.get(itemDefinition.sprite.url) || itemDefinition.sprite.url);
          sprite.width = itemDefinition.renderWidth;
          sprite.height = itemDefinition.renderHeight;
          sprite.zIndex = (motionState.sprite?.zIndex || 12) + 1;
          sprite.__itemId = itemDefinition.id;
          renderer.root.addChild(sprite);
          motionState.heldItemSprite = sprite;
          return sprite;
        }

        function syncHeldItemSprite(motionState) {
          const autonomy = motionState && motionState.autonomy ? motionState.autonomy : null;
          const itemDefinition = autonomy && autonomy.carriedItemId ? sceneHeldItemDefinition(autonomy.carriedItemId) : null;
          if (!itemDefinition) {
            ensureHeldItemSprite(motionState);
            return;
          }
          const sprite = ensureHeldItemSprite(motionState);
          if (!sprite) {
            return;
          }
          const itemWidth = itemDefinition.renderWidth;
          const handX = motionState.flipX
            ? motionState.currentX + motionState.width - itemDefinition.handOffsetPx.x - itemWidth
            : motionState.currentX + itemDefinition.handOffsetPx.x;
          sprite.x = pixelSnap(handX);
          sprite.y = pixelSnap(motionState.currentY + itemDefinition.handOffsetPx.y);
          sprite.alpha = motionState.sprite && Number.isFinite(motionState.sprite.alpha) ? motionState.sprite.alpha : 1;
        }

        function spawnThrownHeldItem(motionState) {
          const autonomy = motionState && motionState.autonomy ? motionState.autonomy : null;
          const itemDefinition = autonomy && autonomy.carriedItemId ? sceneHeldItemDefinition(autonomy.carriedItemId) : null;
          if (!motionState || !itemDefinition) {
            return;
          }
          syncHeldItemSprite(motionState);
          const itemSprite = motionState.heldItemSprite || ensureHeldItemSprite(motionState);
          if (!itemSprite) {
            return;
          }
          const idleConfig = sceneIdleBehaviorConfig();
          const thrownSprite = PIXI.Sprite.from(loadedOfficeAssetImages.get(itemDefinition.sprite.url) || itemDefinition.sprite.url);
          thrownSprite.width = itemDefinition.renderWidth;
          thrownSprite.height = itemDefinition.renderHeight;
          thrownSprite.x = itemSprite.x;
          thrownSprite.y = itemSprite.y;
          thrownSprite.zIndex = itemSprite.zIndex;
          renderer.root.addChild(thrownSprite);
          renderer.animatedSprites.push({
            kind: "thrown-item",
            sprite: thrownSprite,
            startedAt: performance.now(),
            durationMs: idleConfig.throwAwayDurationMs,
            jumpPx: idleConfig.throwAwayJumpPx,
            startX: itemSprite.x,
            startY: itemSprite.y,
            dx: motionState.flipX ? -10 : 10,
            dy: 6
          });
          if (itemSprite.parent) {
            itemSprite.parent.removeChild(itemSprite);
            itemSprite.destroy?.();
          }
          motionState.heldItemSprite = null;
          autonomy.carriedItemId = null;
          autonomy.holdUntil = 0;
        }

        function routeMotionStateTo(motionState, room, nav, targetTile, exactTarget, speed = null) {
          if (!motionState || !room || !nav || !targetTile) {
            return;
          }
          const startTile = nearestWalkableTile(
            nav,
            motionState.currentTile || officeAvatarFootTile(room, model.tile, motionState.currentX, motionState.currentY, motionState.width, motionState.height)
          );
          const endTile = nearestWalkableTile(nav, targetTile) || targetTile;
          const route = startTile && endTile
            ? buildAgentPixelRoute(nav, startTile, endTile, room, model.tile, motionState.width, motionState.height, exactTarget)
            : [exactTarget || { x: motionState.currentX, y: motionState.currentY }];
          motionState.route = route;
          motionState.routeIndex = route.length > 1 ? 1 : route.length;
          motionState.currentTile = startTile || endTile || motionState.currentTile;
          motionState.targetX = exactTarget?.x ?? motionState.targetX;
          motionState.targetY = exactTarget?.y ?? motionState.targetY;
          if (Number.isFinite(speed)) {
            motionState.speed = Number(speed);
          }
        }

        function motionTargetDistance(previousState, agent) {
          if (!previousState || !agent) {
            return Number.POSITIVE_INFINITY;
          }
          const previousTargetX = Number.isFinite(previousState.targetX) ? Number(previousState.targetX) : Number(previousState.currentX);
          const previousTargetY = Number.isFinite(previousState.targetY) ? Number(previousState.targetY) : Number(previousState.currentY);
          return Math.hypot(previousTargetX - Number(agent.x), previousTargetY - Number(agent.y));
        }

        function sameSlotAssignment(previousState, agent) {
          if (!previousState || !agent) {
            return false;
          }
          const previousSlotId = previousState.slotId ? String(previousState.slotId) : null;
          const nextSlotId = agent.slotId ? String(agent.slotId) : null;
          const previousMirrored = typeof previousState.mirrored === "boolean" ? previousState.mirrored : null;
          const nextMirrored = typeof agent.mirrored === "boolean" ? agent.mirrored : null;
          return previousSlotId === nextSlotId && previousMirrored === nextMirrored;
        }

        function shouldReuseMotionTarget(previousState, agent, preserveAutonomyRoute = false) {
          if (!previousState || !agent || previousState.exiting === true || previousState.roomId !== agent.roomId) {
            return false;
          }
          if (preserveAutonomyRoute) {
            return true;
          }
          if (previousState.targetX === agent.x && previousState.targetY === agent.y) {
            return true;
          }
          const distance = motionTargetDistance(previousState, agent);
          if (!Number.isFinite(distance) || distance > 3) {
            return false;
          }
          if (sameSlotAssignment(previousState, agent)) {
            return true;
          }
          return !previousState.slotId && !agent.slotId;
        }

        function buildExitGhostMotion(key, motionState, roomNavigation, reservations) {
          if (!motionState || !key) {
            return null;
          }
          const room = roomById.get(motionState.roomId);
          const nav = navigationForAgent(roomNavigation, reservations, motionState.roomId, key);
          if (!room || !nav) {
            return null;
          }
          const routeFinished = motionState.exiting === true
            && motionState.routeIndex >= ((motionState.route && motionState.route.length) || 0);
          const exitTile = nearestWalkableTile(nav, roomDoorTile(room, model.tile));
          const startTile = nearestWalkableTile(
            nav,
            motionState.currentTile || officeAvatarFootTile(room, model.tile, motionState.currentX, motionState.currentY, motionState.width, motionState.height)
          );
          const targetPoint = exitTile
            ? officeAvatarPositionForTile(room, model.tile, exitTile, motionState.width, motionState.height)
            : { x: motionState.currentX, y: motionState.currentY };
          const ghostAgent = {
            id: motionState.key,
            key,
            roomId: motionState.roomId,
            sprite: motionState.spriteUrl,
            width: motionState.width,
            height: motionState.height,
            x: motionState.currentX,
            y: motionState.currentY,
            flipX: motionState.flipX,
            state: motionState.state || "idle",
            bubble: null
          };
          const ghostVisual = addAvatarNode(ghostAgent, 12);
          const ghostRoute = routeFinished
            ? [{ x: motionState.currentX, y: motionState.currentY }]
            : (startTile && exitTile
              ? buildAgentPixelRoute(nav, startTile, exitTile, room, model.tile, motionState.width, motionState.height, targetPoint)
              : [targetPoint]);
          const exitFadeAlpha = Number.isFinite(motionState.exitFadeAlpha)
            ? Math.max(0, Math.min(1, Number(motionState.exitFadeAlpha)))
            : 1;
          ghostVisual.avatar.alpha = exitFadeAlpha;
          return {
            kind: "motion",
            key,
            roomId: motionState.roomId,
            sprite: ghostVisual.avatar,
            statusMarker: null,
            bubbleBox: null,
            bubbleText: null,
            width: motionState.width,
            height: motionState.height,
            currentX: motionState.currentX,
            currentY: motionState.currentY,
            currentTile: startTile,
            route: ghostRoute,
            routeIndex: routeFinished ? ghostRoute.length : 0,
            speed: Number(motionState.speed) || 216,
            flipX: motionState.flipX,
            targetFlipX: motionState.targetFlipX,
            anchorNode: null,
            exiting: true,
            spriteUrl: motionState.spriteUrl,
            state: motionState.state || "idle",
            exitFadeAlpha
          };
        }

        function pickFacilityProvider(roomId) {
          const facilities = model.facilities.filter((facility) => facility && facility.roomId === roomId && Array.isArray(facility.items) && facility.items.length > 0);
          if (facilities.length === 0) {
            return null;
          }
          return facilities[Math.floor(Math.random() * facilities.length)] || null;
        }

        function updateAutonomousRestingMotion(motionState, now) {
          const autonomy = motionState && motionState.autonomy ? motionState.autonomy : null;
          if (!autonomy) {
            return;
          }
          const room = renderer.roomById.get(motionState.roomId);
          const nav = navigationForAgent(renderer.roomNavigation, renderer.reservedAgentTiles, motionState.roomId, motionState.key);
          if (!room || !nav) {
            return;
          }
          if (autonomy.carriedItemId && Number.isFinite(autonomy.holdUntil) && now >= autonomy.holdUntil) {
            autonomy.carriedItemId = null;
            autonomy.holdUntil = 0;
          }
          const routeFinished = motionState.routeIndex >= ((motionState.route && motionState.route.length) || 0);
          if (!routeFinished) {
            return;
          }
          if (autonomy.phase === "to-facility" && autonomy.facility) {
            const items = Array.isArray(autonomy.facility.items) ? autonomy.facility.items : [];
            const itemId = items[Math.floor(Math.random() * items.length)] || null;
            const itemDefinition = itemId ? sceneHeldItemDefinition(itemId) : null;
            const idleConfig = sceneIdleBehaviorConfig();
            const restingSpeedScale = Math.max(0.1, idleConfig.restingSpeedScale);
            autonomy.carriedItemId = itemDefinition ? itemDefinition.id : null;
            autonomy.holdUntil = itemDefinition
              ? now + (Number.isFinite(itemDefinition.durationMs) ? itemDefinition.durationMs : idleConfig.itemDurationMs)
              : 0;
            autonomy.phase = "returning";
            const homeTile = officeAvatarFootTile(room, model.tile, autonomy.homeX, autonomy.homeY, motionState.width, motionState.height);
            routeMotionStateTo(
              motionState,
              room,
              nav,
              homeTile,
              { x: autonomy.homeX, y: autonomy.homeY },
              176 * restingSpeedScale
            );
            motionState.targetFlipX = autonomy.homeFlip;
            return;
          }
          if (autonomy.phase === "returning") {
            autonomy.phase = "seated";
            autonomy.facility = null;
            autonomy.nextFlipAt = nextIdleFlipAt(now);
            autonomy.nextTripAt = nextIdleTripAt(now);
            motionState.targetFlipX = autonomy.homeFlip;
            return;
          }
          if (now >= autonomy.nextFlipAt) {
            autonomy.homeFlip = !autonomy.homeFlip;
            motionState.targetFlipX = autonomy.homeFlip;
            autonomy.nextFlipAt = nextIdleFlipAt(now);
          }
          if (now >= autonomy.nextTripAt) {
            const idleConfig = sceneIdleBehaviorConfig();
            const restingSpeedScale = Math.max(0.1, idleConfig.restingSpeedScale);
            const facility = pickFacilityProvider(motionState.roomId);
            if (!facility) {
              autonomy.nextTripAt = nextIdleTripAt(now);
              return;
            }
            autonomy.phase = "to-facility";
            autonomy.facility = facility;
            const serviceTile = facility.serviceTile;
            routeMotionStateTo(
              motionState,
              room,
              nav,
              serviceTile,
              officeAvatarPositionForFacility(room, model.tile, serviceTile, motionState.width, motionState.height),
              164 * restingSpeedScale
            );
            autonomy.nextTripAt = nextIdleTripAt(now);
          }
        }

        renderer.updateAutonomousRestingMotion = updateAutonomousRestingMotion;
        renderer.syncHeldItemSprite = syncHeldItemSprite;
        renderer.syncMotionStateDepth = syncMotionStateDepth;

        function addSpriteNode(definition) {
          const sprite = PIXI.Sprite.from(loadedOfficeAssetImages.get(definition.sprite) || definition.sprite);
          const deskShellScale = definition && definition.z >= 7 && definition.z <= 9 ? 0.86 : 1;
          const deskShellLift = definition && definition.z === 8 ? 4 : 0;
          const snappedWidth = pixelSnap(definition.width * deskShellScale, 1);
          const snappedHeight = pixelSnap(definition.height * deskShellScale, 1);
          const offsetX = pixelSnap((definition.width - snappedWidth) / 2);
          const offsetY = pixelSnap(definition.height - snappedHeight) - deskShellLift;
          sprite.x = pixelSnap(definition.x) + offsetX;
          sprite.y = pixelSnap(definition.y) + offsetY;
          sprite.width = snappedWidth;
          sprite.height = snappedHeight;
          sprite.alpha = Number.isFinite(definition.alpha) ? definition.alpha : 1;
          if (definition.flipX) {
            sprite.scale.x = -Math.abs(sprite.scale.x || 1);
            sprite.x += snappedWidth;
          }
          if (Number.isFinite(definition.depthFootY)) {
            applyFootDepth(
              sprite,
              Number(definition.depthFootY) - snappedHeight,
              snappedHeight,
              Number.isFinite(definition.depthBias) ? Number(definition.depthBias) : 0,
              model.tile,
              Number.isFinite(definition.depthBaseY) ? Number(definition.depthBaseY) : 0,
              Number.isFinite(definition.depthRow) ? Number(definition.depthRow) : null
            );
          } else {
            sprite.zIndex = definition.z || 5;
          }
          if (!screenshotMode && definition.enteringReveal === true) {
            sprite.visible = false;
          }
          renderer.root.addChild(sprite);
          return sprite;
        }

        function registerFocusNodes(keys, nodes) {
          if (!Array.isArray(keys) || keys.length === 0 || !Array.isArray(nodes) || nodes.length === 0) {
            return;
          }
          renderer.focusables.push({
            keys,
            nodes: nodes.filter(Boolean).map((node) => ({
              node,
              baseAlpha: Number.isFinite(node.alpha) ? node.alpha : 1
            }))
          });
        }

        const STATE_MARKER_SIZE = 11;
        const STATE_MARKER_Y_OFFSET = 13;
        const STATE_MARKER_BUBBLE_Y_OFFSET = 20;
        const TURN_SIGNAL_PADDING_X = 4;
        const TURN_SIGNAL_MIN_WIDTH = 24;
        const TURN_SIGNAL_MIN_HEIGHT = 12;
        const TURN_SIGNAL_AVATAR_Y_OFFSET = 22;
        const TURN_SIGNAL_MARKER_Y_OFFSET = 30;
        const TURN_SIGNAL_BUBBLE_Y_OFFSET = 38;
        const ACTIVITY_CUE_MIN_WIDTH = 16;
        const ACTIVITY_CUE_MIN_HEIGHT = 12;
        const ACTIVITY_CUE_AVATAR_Y_OFFSET = 20;
        const ACTIVITY_CUE_SIDE_OFFSET_X = 6;
        const ACTIVITY_CUE_SIDE_OFFSET_Y = 5;
        const ACTIVITY_CUE_PADDING_X = 4;
        const ACTIVITY_CUE_ICON_WIDTH = 8;
        const ACTIVITY_CUE_ICON_GAP = 3;

        function statusMarkerPosition(agent, markerWidth = STATE_MARKER_SIZE) {
          return {
            x: pixelSnap(agent.x + Math.round((agent.width - markerWidth) / 2)),
            y: pixelSnap(agent.y - (agent.bubble ? STATE_MARKER_BUBBLE_Y_OFFSET : STATE_MARKER_Y_OFFSET))
          };
        }

        function turnSignalPalette(signal) {
          switch (signal && signal.tone) {
            case "completed":
              return {
                fillColor: 0x1f5a2a,
                strokeColor: 0x9fe28a,
                glowColor: 0xd7ffcc,
                textColor: 0xf7fff3
              };
            case "interrupted":
              return {
                fillColor: 0x62410d,
                strokeColor: 0xffc76c,
                glowColor: 0xffe1ac,
                textColor: 0xfff7df
              };
            case "failed":
              return {
                fillColor: 0x6d1f24,
                strokeColor: 0xff8f88,
                glowColor: 0xffd1cc,
                textColor: 0xfff1ef
              };
            case "started":
            default:
              return {
                fillColor: 0x183a72,
                strokeColor: 0x8cbcff,
                glowColor: 0xc7dcff,
                textColor: 0xf2f7ff
              };
          }
        }

        function turnSignalPosition(agent, signalWidth, signalHeight, anchorMode = "avatar") {
          const yOffset =
            anchorMode === "bubble"
              ? TURN_SIGNAL_BUBBLE_Y_OFFSET
              : anchorMode === "marker"
                ? TURN_SIGNAL_MARKER_Y_OFFSET
                : TURN_SIGNAL_AVATAR_Y_OFFSET;
          return {
            x: pixelSnap(agent.x + Math.round((agent.width - signalWidth) / 2)),
            y: pixelSnap(agent.y - signalHeight - yOffset)
          };
        }

        function activityCuePalette(cue) {
          switch (cue && cue.mode) {
            case "plan":
              return {
                fillColor: 0x335e2a,
                strokeColor: 0xb8e07e,
                glowColor: 0xe8ffca,
                textColor: 0xf7fff1
              };
            case "file":
              return {
                fillColor: 0x101714,
                strokeColor: 0x4bd69f,
                glowColor: 0x79f0c1,
                textColor: 0xdfffee,
                accentColor: 0xffd27a
              };
            case "tool":
              return {
                fillColor: 0x4a3278,
                strokeColor: 0xd0b1ff,
                glowColor: 0xf0e0ff,
                textColor: 0xfaf4ff
              };
            case "approval":
              return {
                fillColor: 0x6b5214,
                strokeColor: 0xffde7c,
                glowColor: 0xffefba,
                textColor: 0xfffae8
              };
            case "input":
              return {
                fillColor: 0x23593d,
                strokeColor: 0x94efb8,
                glowColor: 0xd6ffe4,
                textColor: 0xf4fff7
              };
            case "resolved":
              return {
                fillColor: 0x22556a,
                strokeColor: 0x91ddff,
                glowColor: 0xd9f5ff,
                textColor: 0xf3fcff
              };
            case "command":
            default:
              return {
                fillColor: 0x080c10,
                strokeColor: 0x7bcbff,
                glowColor: 0x1c3342,
                textColor: 0xd6ecff,
                accentColor: 0x78d787
              };
          }
        }

        function activityCueFrameRadius(mode) {
          return mode === "command" || mode === "file" ? 1 : 4;
        }

        function activityCueFrameAlpha(mode) {
          return mode === "command" || mode === "file" ? 0.32 : 0.58;
        }

        function activityCueStrokeWidth(mode) {
          return mode === "command" || mode === "file" ? 1 : 2;
        }

        function activityCueAnchorMode(agent, cue) {
          if (!cue) {
            return "avatar";
          }
          if (cue.mode === "approval" || cue.mode === "input") {
            return agent && agent.slotId ? "side" : "avatar";
          }
          if (cue.mode === "resolved") {
            return "avatar";
          }
          return cue.mode === "plan"
            ? "avatar"
            : (agent && agent.slotId ? "side" : "avatar");
        }

        function activityCuePosition(agent, cueWidth, cueHeight, anchorMode = "avatar", flipX = false) {
          if (anchorMode === "side") {
            const sideX = flipX
              ? agent.x - cueWidth - ACTIVITY_CUE_SIDE_OFFSET_X
              : agent.x + agent.width + ACTIVITY_CUE_SIDE_OFFSET_X;
            return {
              x: pixelSnap(sideX),
              y: pixelSnap(agent.y + Math.round(agent.height * 0.24) + ACTIVITY_CUE_SIDE_OFFSET_Y)
            };
          }
          return {
            x: pixelSnap(agent.x + Math.round((agent.width - cueWidth) / 2)),
            y: pixelSnap(agent.y - cueHeight - ACTIVITY_CUE_AVATAR_Y_OFFSET)
          };
        }

        function buildActivityCueAdornment(mode, palette) {
          const iconContainer = new PIXI.Container();
          let accentNode = null;

          if (mode === "plan") {
            const board = new PIXI.Graphics()
              .roundRect(1, 2, 6, 5, 2)
              .fill({ color: palette.textColor, alpha: 0.18 })
              .stroke({ color: palette.textColor, width: 1, alpha: 0.96 });
            const clip = new PIXI.Graphics()
              .roundRect(2, 0, 4, 2, 1)
              .fill({ color: palette.strokeColor, alpha: 0.95 });
            accentNode = clip;
            iconContainer.addChild(board);
            iconContainer.addChild(clip);
          } else if (mode === "command") {
            const prompt = new PIXI.Graphics()
              .moveTo(1, 1)
              .lineTo(4, 4)
              .lineTo(1, 7)
              .stroke({ color: palette.accentColor || palette.textColor, width: 1.2, alpha: 0.98 });
            const cursor = new PIXI.Graphics()
              .rect(5, 6, 2, 1)
              .fill({ color: palette.textColor, alpha: 0.95 });
            accentNode = cursor;
            iconContainer.addChild(prompt);
            iconContainer.addChild(cursor);
          } else if (mode === "file") {
            const page = new PIXI.Graphics()
              .rect(1, 1, 5, 6)
              .fill({ color: palette.textColor, alpha: 0.16 })
              .stroke({ color: palette.textColor, width: 1, alpha: 0.96 });
            const fold = new PIXI.Graphics()
              .moveTo(4, 1)
              .lineTo(6, 1)
              .lineTo(6, 3)
              .stroke({ color: palette.strokeColor, width: 1, alpha: 0.94 });
            const slash = new PIXI.Graphics()
              .moveTo(2, 6)
              .lineTo(6, 2)
              .stroke({ color: palette.accentColor || palette.strokeColor, width: 1.2, alpha: 0.96 });
            accentNode = slash;
            iconContainer.addChild(page);
            iconContainer.addChild(fold);
            iconContainer.addChild(slash);
          } else if (mode === "tool") {
            const spokes = new PIXI.Graphics()
              .moveTo(4, 0)
              .lineTo(4, 2)
              .moveTo(4, 6)
              .lineTo(4, 8)
              .moveTo(0, 4)
              .lineTo(2, 4)
              .moveTo(6, 4)
              .lineTo(8, 4)
              .stroke({ color: palette.strokeColor, width: 1.1, alpha: 0.94 });
            const core = new PIXI.Graphics()
              .circle(4, 4, 2)
              .fill({ color: palette.textColor, alpha: 0.14 })
              .stroke({ color: palette.textColor, width: 1, alpha: 0.96 });
            accentNode = spokes;
            iconContainer.addChild(spokes);
            iconContainer.addChild(core);
          } else if (mode === "approval") {
            const ring = new PIXI.Graphics()
              .circle(4, 4, 2.5)
              .stroke({ color: palette.textColor, width: 1.1, alpha: 0.96 });
            const pulseRing = new PIXI.Graphics()
              .circle(4, 4, 3.5)
              .stroke({ color: palette.glowColor, width: 1, alpha: 0.62 });
            accentNode = pulseRing;
            iconContainer.addChild(pulseRing);
            iconContainer.addChild(ring);
          } else if (mode === "input") {
            const bubble = new PIXI.Graphics()
              .roundRect(1, 1, 6, 5, 2)
              .fill({ color: palette.textColor, alpha: 0.15 })
              .stroke({ color: palette.textColor, width: 1, alpha: 0.96 });
            const tail = new PIXI.Graphics()
              .moveTo(3, 6)
              .lineTo(2, 8)
              .lineTo(4, 6)
              .fill({ color: palette.textColor, alpha: 0.92 });
            const dot = new PIXI.Graphics()
              .circle(4, 4, 0.9)
              .fill({ color: palette.strokeColor, alpha: 0.95 });
            accentNode = dot;
            iconContainer.addChild(bubble);
            iconContainer.addChild(tail);
            iconContainer.addChild(dot);
          } else if (mode === "resolved") {
            const check = new PIXI.Graphics()
              .moveTo(1, 4)
              .lineTo(3, 6)
              .lineTo(7, 1)
              .stroke({ color: palette.textColor, width: 1.4, alpha: 0.98 });
            const spark = new PIXI.Graphics()
              .moveTo(6, 0)
              .lineTo(6, 2)
              .moveTo(5, 1)
              .lineTo(7, 1)
              .stroke({ color: palette.glowColor, width: 1, alpha: 0.86 });
            accentNode = spark;
            iconContainer.addChild(check);
            iconContainer.addChild(spark);
          }

          return {
            iconContainer,
            accentNode
          };
        }

        function syncTurnSignalNode(motionState, turnSignal, liftPx = 0) {
          if (!motionState || !turnSignal || !turnSignal.container) {
            return;
          }
          const agentLike = {
            x: Number.isFinite(motionState.currentX) ? Number(motionState.currentX) : Number(motionState.targetX) || 0,
            y: Number.isFinite(motionState.currentY) ? Number(motionState.currentY) : Number(motionState.targetY) || 0,
            width: Number.isFinite(motionState.width) ? Number(motionState.width) : 0
          };
          const topLeft = turnSignalPosition(
            agentLike,
            Number.isFinite(turnSignal.width) ? Number(turnSignal.width) : TURN_SIGNAL_MIN_WIDTH,
            Number.isFinite(turnSignal.height) ? Number(turnSignal.height) : TURN_SIGNAL_MIN_HEIGHT,
            turnSignal.anchorMode || "avatar"
          );
          turnSignal.container.x = topLeft.x + Math.round((Number(turnSignal.width) || TURN_SIGNAL_MIN_WIDTH) / 2);
          turnSignal.container.y = topLeft.y + Math.round((Number(turnSignal.height) || TURN_SIGNAL_MIN_HEIGHT) / 2) - Math.round(liftPx);
        }

        function syncActivityCueNode(motionState, activityCue, driftX = 0, driftY = 0) {
          if (!motionState || !activityCue || !activityCue.container) {
            return;
          }
          const agentLike = {
            x: Number.isFinite(motionState.currentX) ? Number(motionState.currentX) : Number(motionState.targetX) || 0,
            y: Number.isFinite(motionState.currentY) ? Number(motionState.currentY) : Number(motionState.targetY) || 0,
            width: Number.isFinite(motionState.width) ? Number(motionState.width) : 0,
            height: Number.isFinite(motionState.height) ? Number(motionState.height) : 0
          };
          const topLeft = activityCuePosition(
            agentLike,
            Number.isFinite(activityCue.width) ? Number(activityCue.width) : ACTIVITY_CUE_MIN_WIDTH,
            Number.isFinite(activityCue.height) ? Number(activityCue.height) : ACTIVITY_CUE_MIN_HEIGHT,
            activityCue.anchorMode || "avatar",
            motionState.flipX === true
          );
          activityCue.container.x = topLeft.x + Math.round((Number(activityCue.width) || ACTIVITY_CUE_MIN_WIDTH) / 2) + Math.round(driftX);
          activityCue.container.y = topLeft.y + Math.round((Number(activityCue.height) || ACTIVITY_CUE_MIN_HEIGHT) / 2) + Math.round(driftY);
        }

        function buildWorkstationCueEffectNode(effect) {
          const palette = activityCuePalette(effect || { mode: "command" });
          const width = Math.max(12, Math.round(Number(effect && effect.width) || 18));
          const height = Math.max(9, Math.round(Number(effect && effect.height) || 10));
          const requestProfile = effect && effect.requestProfile && typeof effect.requestProfile === "object"
            ? effect.requestProfile
            : null;
          const container = new PIXI.Container();
          container.x = pixelSnap(Number(effect && effect.x) || 0);
          container.y = pixelSnap(Number(effect && effect.y) || 0);
          const frame = new PIXI.Graphics()
            .roundRect(0, 0, width, height, 4)
            .stroke({ color: palette.strokeColor, width: 1, alpha: 0.34 });
          const glow = new PIXI.Graphics()
            .roundRect(1, 1, Math.max(2, width - 2), Math.max(2, height - 2), 3)
            .fill({ color: palette.fillColor, alpha: 0.12 });
          container.addChild(glow);
          container.addChild(frame);

          const mode = effect && effect.mode ? effect.mode : "command";
          const accentNodes = [];
          const dotNodes = [];
          const detailNodes = [];
          let primaryNode = null;
          let secondaryNode = null;

          if (mode === "plan") {
            primaryNode = new PIXI.Graphics()
              .roundRect(2, 2, Math.max(6, width - 4), 2, 1)
              .fill({ color: palette.strokeColor, alpha: 0.86 });
            secondaryNode = new PIXI.Graphics()
              .roundRect(4, Math.max(4, Math.round(height * 0.48)), Math.max(5, width - 8), 2, 1)
              .fill({ color: palette.textColor, alpha: 0.72 });
            const marker = new PIXI.Graphics()
              .circle(Math.max(5, width - 4), Math.max(4, Math.round(height * 0.48) + 1), 1.25)
              .fill({ color: palette.glowColor, alpha: 0.94 });
            accentNodes.push(marker);
            container.addChild(primaryNode);
            container.addChild(secondaryNode);
            container.addChild(marker);
          } else if (mode === "command") {
            primaryNode = new PIXI.Graphics()
              .roundRect(2, Math.max(2, Math.round(height * 0.3)), Math.max(6, Math.round(width * 0.42)), 2, 1)
              .fill({ color: palette.textColor, alpha: 0.9 });
            secondaryNode = new PIXI.Graphics()
              .roundRect(2, Math.max(5, Math.round(height * 0.64)), Math.max(4, Math.round(width * 0.26)), 2, 1)
              .fill({ color: palette.strokeColor, alpha: 0.82 });
            const scan = new PIXI.Graphics()
              .roundRect(0, Math.max(1, Math.round(height * 0.5)), Math.max(5, Math.round(width * 0.34)), 1, 1)
              .fill({ color: palette.glowColor, alpha: 0.88 });
            accentNodes.push(scan);
            container.addChild(primaryNode);
            container.addChild(secondaryNode);
            container.addChild(scan);
          } else if (mode === "file") {
            primaryNode = new PIXI.Graphics()
              .rect(3, 2, Math.max(6, width - 7), Math.max(5, height - 4))
              .stroke({ color: palette.textColor, width: 1, alpha: 0.94 });
            secondaryNode = new PIXI.Graphics()
              .moveTo(4, Math.max(4, height - 3))
              .lineTo(Math.max(7, width - 3), 3)
              .stroke({ color: palette.strokeColor, width: 1.3, alpha: 0.94 });
            accentNodes.push(secondaryNode);
            container.addChild(primaryNode);
            container.addChild(secondaryNode);
          } else if (mode === "tool") {
            primaryNode = new PIXI.Graphics()
              .circle(Math.round(width / 2), Math.round(height / 2), Math.max(3, Math.round(Math.min(width, height) * 0.28)))
              .stroke({ color: palette.textColor, width: 1, alpha: 0.94 });
            secondaryNode = new PIXI.Graphics()
              .moveTo(Math.round(width / 2), 1)
              .lineTo(Math.round(width / 2), Math.max(2, Math.round(height * 0.28)))
              .moveTo(Math.round(width / 2), Math.max(2, height - Math.round(height * 0.28)))
              .lineTo(Math.round(width / 2), Math.max(3, height - 1))
              .moveTo(1, Math.round(height / 2))
              .lineTo(Math.max(2, Math.round(width * 0.28)), Math.round(height / 2))
              .moveTo(Math.max(2, width - Math.round(width * 0.28)), Math.round(height / 2))
              .lineTo(Math.max(3, width - 1), Math.round(height / 2))
              .stroke({ color: palette.strokeColor, width: 1.1, alpha: 0.9 });
            accentNodes.push(secondaryNode);
            container.addChild(primaryNode);
            container.addChild(secondaryNode);
          } else if (mode === "approval") {
            primaryNode = new PIXI.Graphics()
              .circle(Math.round(width / 2), Math.round(height / 2), Math.max(3, Math.round(Math.min(width, height) * 0.24)))
              .stroke({ color: palette.textColor, width: 1.1, alpha: 0.94 });
            secondaryNode = new PIXI.Graphics()
              .circle(Math.round(width / 2), Math.round(height / 2), Math.max(4, Math.round(Math.min(width, height) * 0.38)))
              .stroke({ color: palette.glowColor, width: 1, alpha: 0.48 });
            const decisionCount = Math.max(2, Math.min(4, Number(requestProfile && requestProfile.decisionCount) || 3));
            const orbitRadius = Math.max(3, Math.round(Math.min(width, height) * 0.42));
            for (let index = 0; index < decisionCount; index += 1) {
              const angle = -Math.PI * 0.82 + (index / Math.max(1, decisionCount - 1)) * Math.PI * 0.64;
              const dot = new PIXI.Graphics()
                .circle(
                  Math.round(width / 2 + Math.cos(angle) * orbitRadius),
                  Math.round(height / 2 + Math.sin(angle) * orbitRadius),
                  0.9
                )
                .fill({ color: palette.strokeColor, alpha: 0.9 });
              dotNodes.push(dot);
              container.addChild(dot);
            }
            if (requestProfile && requestProfile.approvalType === "file") {
              const page = new PIXI.Graphics()
                .rect(Math.max(1, width - 5), 2, 3, 4)
                .stroke({ color: palette.glowColor, width: 1, alpha: 0.9 });
              detailNodes.push(page);
              container.addChild(page);
            } else if (requestProfile && requestProfile.approvalType === "network") {
              [0, 1, 2].forEach((index) => {
                const node = new PIXI.Graphics()
                  .circle(2 + index * 3, Math.max(2, height - 3), 0.8)
                  .fill({ color: palette.glowColor, alpha: 0.86 });
                detailNodes.push(node);
                container.addChild(node);
              });
            } else {
              const prompt = new PIXI.Graphics()
                .moveTo(2, Math.max(2, height - 4))
                .lineTo(4, Math.max(2, height - 2))
                .lineTo(2, height)
                .stroke({ color: palette.glowColor, width: 1, alpha: 0.9 });
              detailNodes.push(prompt);
              container.addChild(prompt);
            }
            accentNodes.push(secondaryNode);
            container.addChild(primaryNode);
            container.addChild(secondaryNode);
          } else if (mode === "input") {
            primaryNode = new PIXI.Graphics()
              .roundRect(2, 2, Math.max(7, width - 5), Math.max(5, height - 5), 3)
              .stroke({ color: palette.textColor, width: 1, alpha: 0.92 });
            container.addChild(primaryNode);
            const questionCount = Math.max(1, Math.min(4, Number(requestProfile && requestProfile.questionCount) || 3));
            const requiredCount = Math.max(0, Math.min(questionCount, Number(requestProfile && requestProfile.requiredCount) || 0));
            const optionCount = Math.max(0, Math.min(questionCount, Number(requestProfile && requestProfile.optionCount) || 0));
            const secretCount = Math.max(0, Math.min(2, Number(requestProfile && requestProfile.secretCount) || 0));
            const contentLeft = 4;
            const contentWidth = Math.max(6, width - 8);
            const barGap = questionCount > 1 ? Math.max(1, Math.floor(contentWidth / Math.max(2, questionCount * 2))) : 0;
            const barWidth = Math.max(1, Math.floor((contentWidth - barGap * Math.max(0, questionCount - 1)) / questionCount));
            for (let index = 0; index < questionCount; index += 1) {
              const bar = new PIXI.Graphics()
                .roundRect(contentLeft + index * (barWidth + barGap), Math.max(3, height - 5), barWidth, 2, 1)
                .fill({ color: palette.strokeColor, alpha: 0.78 });
              dotNodes.push(bar);
              container.addChild(bar);
              if (index < requiredCount) {
                const requiredDot = new PIXI.Graphics()
                  .circle(contentLeft + index * (barWidth + barGap) + Math.round(barWidth / 2), 2, 0.8)
                  .fill({ color: palette.glowColor, alpha: 0.92 });
                accentNodes.push(requiredDot);
                container.addChild(requiredDot);
              }
              if (index < optionCount) {
                const optionDot = new PIXI.Graphics()
                  .circle(contentLeft + index * (barWidth + barGap) + Math.round(barWidth / 2), Math.max(4, height - 2), 0.7)
                  .fill({ color: palette.textColor, alpha: 0.7 });
                detailNodes.push(optionDot);
                container.addChild(optionDot);
              }
            }
            for (let index = 0; index < secretCount; index += 1) {
              const lockNode = new PIXI.Graphics()
                .rect(Math.max(1, width - 3 - index * 2), 2, 1, 2)
                .fill({ color: palette.glowColor, alpha: 0.92 });
              detailNodes.push(lockNode);
              container.addChild(lockNode);
            }
          } else if (mode === "resolved") {
            primaryNode = new PIXI.Graphics()
              .moveTo(Math.max(3, Math.round(width * 0.22)), Math.max(4, Math.round(height * 0.56)))
              .lineTo(Math.max(5, Math.round(width * 0.4)), Math.max(6, height - 3))
              .lineTo(Math.max(8, width - 3), 3)
              .stroke({ color: palette.textColor, width: 1.3, alpha: 0.96 });
            secondaryNode = new PIXI.Graphics()
              .moveTo(Math.round(width / 2), 0)
              .lineTo(Math.round(width / 2), 2)
              .moveTo(0, Math.round(height / 2))
              .lineTo(2, Math.round(height / 2))
              .moveTo(width - 2, Math.round(height / 2))
              .lineTo(width, Math.round(height / 2))
              .moveTo(Math.round(width / 2), height - 2)
              .lineTo(Math.round(width / 2), height)
              .stroke({ color: palette.glowColor, width: 1, alpha: 0.8 });
            accentNodes.push(secondaryNode);
            container.addChild(primaryNode);
            container.addChild(secondaryNode);
          }

          return {
            container,
            frameNode: frame,
            glowNode: glow,
            primaryNode,
            secondaryNode,
            accentNodes,
            dotNodes,
            detailNodes,
            requestProfile,
            mode,
            width,
            height,
            baseX: container.x,
            baseY: container.y
          };
        }

        function stateEffectModeForAgent(agent) {
          if (!agent) {
            return null;
          }
          if (agent.state === "waiting") {
            return "waiting";
          }
          if (agent.state === "blocked") {
            return "blocked";
          }
          return null;
        }

        function syncStateEffectNode(entry, now) {
          const motionState = entry && entry.motionState ? entry.motionState : null;
          if (!motionState || !motionState.sprite) {
            return;
          }
          const mode = entry.mode || "";
          const renderOffsetX = Number.isFinite(motionState.renderOffsetX) ? Number(motionState.renderOffsetX) : 0;
          const renderOffsetY = Number.isFinite(motionState.renderOffsetY) ? Number(motionState.renderOffsetY) : 0;
          const renderWidth = Number.isFinite(motionState.renderWidth) ? Number(motionState.renderWidth) : pixelSnap(motionState.width, 1);
          const renderHeight = Number.isFinite(motionState.renderHeight) ? Number(motionState.renderHeight) : pixelSnap(motionState.height, 1);
          const baseSpriteX = motionState.flipX
            ? pixelSnap(motionState.currentX + renderOffsetX) + renderWidth
            : pixelSnap(motionState.currentX + renderOffsetX);
          const baseSpriteY = pixelSnap(motionState.currentY + renderOffsetY);
          const statusMarkerWidth = motionState.statusMarker ? Math.max(8, Math.round(motionState.statusMarker.width || 11)) : STATE_MARKER_SIZE;
          const statusMarkerPositionValue = statusMarkerPosition({
            x: motionState.currentX,
            y: motionState.currentY,
            width: motionState.width,
            bubble: Boolean(motionState.bubbleBox)
          }, statusMarkerWidth);
          const statusMarkerLift = Number.isFinite(motionState.statusMarkerLift) ? Number(motionState.statusMarkerLift) : 0;
          const bubbleX = pixelSnap(motionState.currentX + Math.round(motionState.width * 0.2));
          const bubbleY = pixelSnap(motionState.currentY - 14);
          const hatBaseX = motionState.hatSprite
            ? pixelSnap(
              motionState.currentX
              + renderOffsetX
              + (Number.isFinite(motionState.hatCenteredOffsetX) ? Number(motionState.hatCenteredOffsetX) : 0)
              + (motionState.flipX ? -(Number.isFinite(motionState.hatManualOffsetX) ? Number(motionState.hatManualOffsetX) : 0) : (Number.isFinite(motionState.hatManualOffsetX) ? Number(motionState.hatManualOffsetX) : 0))
            )
            : 0;
          const hatBaseY = motionState.hatSprite
            ? pixelSnap(motionState.currentY + renderOffsetY + (Number.isFinite(motionState.hatOffsetY) ? Number(motionState.hatOffsetY) : 0))
            : 0;
          if (mode === "waiting") {
            const pulse = (Math.sin((now + entry.phase) / 220) + 1) / 2;
            const lift = Math.round(Math.sin((now + entry.phase) / 260) * 1.2);
            const avatarLift = Math.max(0, lift);
            motionState.sprite.y = baseSpriteY - avatarLift;
            if (motionState.hatSprite) {
              motionState.hatSprite.y = hatBaseY - avatarLift;
            }
            if (motionState.statusMarker) {
              motionState.statusMarker.x = statusMarkerPositionValue.x;
              motionState.statusMarker.y = statusMarkerPositionValue.y - statusMarkerLift - avatarLift;
              motionState.statusMarker.alpha = 0.72 + pulse * 0.28;
            }
            if (motionState.bubbleBox) {
              motionState.bubbleBox.x = bubbleX;
              motionState.bubbleBox.y = bubbleY - avatarLift;
              motionState.bubbleBox.alpha = 0.72 + pulse * 0.2;
            }
            if (motionState.bubbleText) {
              motionState.bubbleText.x = bubbleX + Math.round((motionState.bubbleBox.width - motionState.bubbleText.width) / 2);
              motionState.bubbleText.y = bubbleY + Math.round((motionState.bubbleBox.height - motionState.bubbleText.height) / 2) - 1 - avatarLift;
              motionState.bubbleText.alpha = 0.76 + pulse * 0.24;
            }
          } else if (mode === "blocked") {
            const shakeX = Math.round(Math.sin((now + entry.phase) / 58) * 1.8);
            motionState.sprite.x = baseSpriteX + shakeX;
            if (motionState.hatSprite) {
              motionState.hatSprite.x = motionState.flipX
                ? pixelSnap(hatBaseX + (Number.isFinite(motionState.hatWidth) ? Number(motionState.hatWidth) : 0) + shakeX)
                : hatBaseX + shakeX;
            }
            if (motionState.statusMarker) {
              motionState.statusMarker.x = statusMarkerPositionValue.x + shakeX;
              motionState.statusMarker.y = statusMarkerPositionValue.y - statusMarkerLift;
              motionState.statusMarker.alpha = 0.82 + ((Math.sin((now + entry.phase) / 120) + 1) / 2) * 0.18;
            }
            if (motionState.bubbleBox) {
              motionState.bubbleBox.x = bubbleX + shakeX;
              motionState.bubbleBox.y = bubbleY;
            }
            if (motionState.bubbleText) {
              motionState.bubbleText.x = bubbleX + Math.round((motionState.bubbleBox.width - motionState.bubbleText.width) / 2) + shakeX;
              motionState.bubbleText.y = bubbleY + Math.round((motionState.bubbleBox.height - motionState.bubbleText.height) / 2) - 1;
            }
          }
          if (typeof renderer.syncMotionStateDepth === "function") {
            renderer.syncMotionStateDepth(motionState);
          }
        }

        function avatarRenderMetrics(agent) {
          const avatarScale = agent && agent.slotId ? 0.86 : 1;
          const width = pixelSnap(agent.width * avatarScale, 1);
          const height = pixelSnap(agent.height * avatarScale, 1);
          return {
            width,
            height,
            offsetX: pixelSnap((agent.width - width) / 2),
            offsetY: pixelSnap(agent.height - height)
          };
        }

        function assetImageDimensions(url, fallbackWidth = 16, fallbackHeight = 16) {
          const image = loadedOfficeAssetImages.get(url);
          const width = Number(image && image.naturalWidth) || fallbackWidth;
          const height = Number(image && image.naturalHeight) || fallbackHeight;
          return {
            width: Math.max(1, width),
            height: Math.max(1, height)
          };
        }

        function hatRenderMetrics(agent, avatarMetrics) {
          const hat = hatDefinitionById(agent && agent.hatId);
          if (!hat || !hat.url || !avatarMetrics) {
            return null;
          }
          const avatarDefinition = Array.isArray(pixelOffice && pixelOffice.avatars)
            ? pixelOffice.avatars.find((entry) => entry && entry.url === agent.sprite) || null
            : null;
          const avatarSourceHeight = Math.max(1, Number(avatarDefinition && avatarDefinition.h) || Number(avatarMetrics.height) || 16);
          const avatarRenderScale = Math.max(0.1, Number(avatarMetrics.height) / avatarSourceHeight);
          const hatDimensions = assetImageDimensions(hat.url);
          const hatScale = Math.max(0.1, avatarRenderScale * (Number.isFinite(hat.scale) ? Number(hat.scale) : 1));
          const width = pixelSnap(hatDimensions.width * hatScale, 1);
          const height = pixelSnap(hatDimensions.height * hatScale, 1);
          const centeredOffsetX = pixelSnap(Math.round((avatarMetrics.width - width) / 2));
          const manualOffsetX = pixelSnap(
            (Number.isFinite(hat.offsetPx && hat.offsetPx.x) ? Number(hat.offsetPx.x) : 0) * avatarRenderScale
          );
          const offsetY = pixelSnap(
            -Math.round(height * 0.42)
            + (Number.isFinite(hat.offsetPx && hat.offsetPx.y) ? Number(hat.offsetPx.y) : 0) * avatarRenderScale
          );
          return {
            url: hat.url,
            width,
            height,
            offsetX: centeredOffsetX + manualOffsetX,
            centeredOffsetX,
            manualOffsetX,
            offsetY,
            markerLift: Math.max(0, Math.round(height * 0.34))
          };
        }

        function hatRenderX(baseX, centeredOffsetX, manualOffsetX, flipX) {
          return pixelSnap(baseX + centeredOffsetX + (flipX ? -manualOffsetX : manualOffsetX));
        }

        function addAvatarNode(agent, zIndex = 12) {
          const avatar = PIXI.Sprite.from(loadedOfficeAssetImages.get(agent.sprite) || agent.sprite);
          const createdNodes = [];
          const renderMetrics = avatarRenderMetrics(agent);
          const snappedWidth = renderMetrics.width;
          const snappedHeight = renderMetrics.height;
          const offsetX = renderMetrics.offsetX;
          const offsetY = renderMetrics.offsetY;
          const hatMetrics = hatRenderMetrics(agent, renderMetrics);
          avatar.x = pixelSnap(agent.x) + offsetX;
          avatar.y = pixelSnap(agent.y) + offsetY;
          avatar.width = snappedWidth;
          avatar.height = snappedHeight;
          if (agent.flipX) {
            avatar.scale.x = -Math.abs(avatar.scale.x || 1);
            avatar.x += snappedWidth;
          }
          const fixedZ = Number.isFinite(agent.z) ? Number(agent.z) : null;
          if (Number.isFinite(agent.depthFootY)) {
            applyFootDepth(
              avatar,
              Number(agent.depthFootY) - snappedHeight,
              snappedHeight,
              Number.isFinite(agent.depthBias) ? Number(agent.depthBias) : zIndex,
              model.tile,
              Number.isFinite(agent.depthBaseY) ? Number(agent.depthBaseY) : 0,
              Number.isFinite(agent.depthRow) ? Number(agent.depthRow) : null
            );
          } else if (fixedZ !== null) {
            avatar.zIndex = fixedZ;
          } else {
            applyFootDepth(
              avatar,
              avatar.y,
              snappedHeight,
              zIndex,
              model.tile,
              Number.isFinite(agent.depthBaseY) ? Number(agent.depthBaseY) : 0,
              Number.isFinite(agent.depthRow) ? Number(agent.depthRow) : null
            );
          }
          renderer.root.addChild(avatar);
          createdNodes.push(avatar);
          let hatSprite = null;
          if (hatMetrics) {
            hatSprite = PIXI.Sprite.from(loadedOfficeAssetImages.get(hatMetrics.url) || hatMetrics.url);
            hatSprite.x = hatRenderX(
              agent.x + offsetX,
              hatMetrics.centeredOffsetX,
              hatMetrics.manualOffsetX,
              agent.flipX === true
            );
            hatSprite.y = pixelSnap(agent.y + offsetY + hatMetrics.offsetY);
            hatSprite.width = hatMetrics.width;
            hatSprite.height = hatMetrics.height;
            if (agent.flipX) {
              hatSprite.scale.x = -Math.abs(hatSprite.scale.x || 1);
              hatSprite.x = pixelSnap(hatSprite.x + hatMetrics.width);
            }
            if (Number.isFinite(agent.depthFootY)) {
              hatSprite.zIndex = sceneFootDepth(
                Number(agent.depthFootY) - snappedHeight,
                snappedHeight,
                (Number(agent.depthBias) || zIndex) + 0.5,
                model.tile,
                Number.isFinite(agent.depthBaseY) ? Number(agent.depthBaseY) : 0,
                Number.isFinite(agent.depthRow) ? Number(agent.depthRow) : null
              );
            } else if (fixedZ !== null) {
              hatSprite.zIndex = fixedZ + 0.5;
            } else {
              hatSprite.zIndex = sceneFootDepth(
                avatar.y,
                snappedHeight,
                zIndex + 0.5,
                model.tile,
                Number.isFinite(agent.depthBaseY) ? Number(agent.depthBaseY) : 0,
                Number.isFinite(agent.depthRow) ? Number(agent.depthRow) : null
              );
            }
            renderer.root.addChild(hatSprite);
            createdNodes.push(hatSprite);
          }
          let statusMarker = null;
          const statusMarkerUrl = agent.statusMarkerIconUrl || stateMarkerIconUrlForAgent(agent);
          if (statusMarkerUrl) {
            statusMarker = PIXI.Sprite.from(loadedOfficeAssetImages.get(statusMarkerUrl) || statusMarkerUrl);
            const markerWidth = STATE_MARKER_SIZE;
            const markerHeight = STATE_MARKER_SIZE;
            const markerPosition = statusMarkerPosition(agent, markerWidth);
            statusMarker.x = markerPosition.x;
            statusMarker.y = markerPosition.y - (hatMetrics ? hatMetrics.markerLift : 0);
            statusMarker.width = markerWidth;
            statusMarker.height = markerHeight;
            statusMarker.zIndex = Number.isFinite(agent.depthFootY)
              ? sceneFootDepth(Number(agent.depthFootY) - snappedHeight, snappedHeight, (Number(agent.depthBias) || zIndex) + 1, model.tile, Number.isFinite(agent.depthBaseY) ? Number(agent.depthBaseY) : 0, Number.isFinite(agent.depthRow) ? Number(agent.depthRow) : null)
              : (fixedZ !== null ? fixedZ + 1 : sceneFootDepth(avatar.y, snappedHeight, zIndex + 1, model.tile, Number.isFinite(agent.depthBaseY) ? Number(agent.depthBaseY) : 0, Number.isFinite(agent.depthRow) ? Number(agent.depthRow) : null));
            renderer.root.addChild(statusMarker);
            createdNodes.push(statusMarker);
          }
          let bubbleBox = null;
          let bubbleText = null;
          if (agent.bubble) {
            const bubbleX = pixelSnap(agent.x + Math.round(agent.width * 0.2));
            const bubbleY = pixelSnap(agent.y - 14);
            const bubbleWidth = Math.max(18, pixelSnap(agent.width * 0.8, 18));
            bubbleBox = new PIXI.Graphics()
              .roundRect(0, 0, bubbleWidth, 12, 3)
              .fill({ color: agent.state === "waiting" ? 0xe9f5eb : 0xf4efdf, alpha: 0.92 })
              .stroke({ color: 0x1f2e29, width: 2, alpha: 0.8 });
            bubbleBox.x = bubbleX;
            bubbleBox.y = bubbleY;
            bubbleBox.zIndex = Number.isFinite(agent.depthFootY)
              ? sceneFootDepth(Number(agent.depthFootY) - snappedHeight, snappedHeight, (Number(agent.depthBias) || zIndex) + 2, model.tile, Number.isFinite(agent.depthBaseY) ? Number(agent.depthBaseY) : 0, Number.isFinite(agent.depthRow) ? Number(agent.depthRow) : null)
              : (fixedZ !== null ? fixedZ + 2 : sceneFootDepth(avatar.y, snappedHeight, zIndex + 2, model.tile, Number.isFinite(agent.depthBaseY) ? Number(agent.depthBaseY) : 0, Number.isFinite(agent.depthRow) ? Number(agent.depthRow) : null));
            renderer.root.addChild(bubbleBox);
            createdNodes.push(bubbleBox);
            bubbleText = createPixiText(renderer, agent.bubble, {
              fill: 0x1f2e29,
              fontFamily: "IBM Plex Mono",
              fontSize: Math.max(8, Math.round(8 * state.globalSceneSettings.textScale)),
              fontWeight: "700"
            });
            bubbleText.x = bubbleX + Math.round((bubbleWidth - bubbleText.width) / 2);
            bubbleText.y = bubbleY + Math.round((12 - bubbleText.height) / 2) - 1;
            bubbleText.zIndex = Number.isFinite(agent.depthFootY)
              ? sceneFootDepth(Number(agent.depthFootY) - snappedHeight, snappedHeight, (Number(agent.depthBias) || zIndex) + 3, model.tile, Number.isFinite(agent.depthBaseY) ? Number(agent.depthBaseY) : 0, Number.isFinite(agent.depthRow) ? Number(agent.depthRow) : null)
              : (fixedZ !== null ? fixedZ + 3 : sceneFootDepth(avatar.y, snappedHeight, zIndex + 3, model.tile, Number.isFinite(agent.depthBaseY) ? Number(agent.depthBaseY) : 0, Number.isFinite(agent.depthRow) ? Number(agent.depthRow) : null));
            renderer.root.addChild(bubbleText);
            createdNodes.push(bubbleText);
          }
          let turnSignal = null;
          if (agent.turnSignal && agent.turnSignal.label) {
            const palette = turnSignalPalette(agent.turnSignal);
            const turnSignalText = createPixiText(renderer, agent.turnSignal.label, {
              fill: palette.textColor,
              fontFamily: "IBM Plex Mono",
              fontSize: Math.max(7, Math.round(7 * state.globalSceneSettings.textScale)),
              fontWeight: "700"
            });
            const turnSignalWidth = Math.max(TURN_SIGNAL_MIN_WIDTH, Math.round(turnSignalText.width) + TURN_SIGNAL_PADDING_X * 2);
            const turnSignalHeight = Math.max(TURN_SIGNAL_MIN_HEIGHT, Math.round(turnSignalText.height) + 4);
            const turnSignalContainer = new PIXI.Container();
            turnSignalContainer.pivot.set(Math.round(turnSignalWidth / 2), Math.round(turnSignalHeight / 2));
            const turnSignalFrame = new PIXI.Graphics()
              .roundRect(-1, -1, turnSignalWidth + 2, turnSignalHeight + 2, 4)
              .stroke({ color: palette.glowColor, width: 1, alpha: 0.6 });
            const turnSignalBg = new PIXI.Graphics()
              .roundRect(0, 0, turnSignalWidth, turnSignalHeight, 4)
              .fill({ color: palette.fillColor, alpha: 0.94 })
              .stroke({ color: palette.strokeColor, width: 2, alpha: 0.95 });
            turnSignalText.x = Math.round((turnSignalWidth - turnSignalText.width) / 2);
            turnSignalText.y = Math.round((turnSignalHeight - turnSignalText.height) / 2) - 1;
            turnSignalContainer.addChild(turnSignalFrame);
            turnSignalContainer.addChild(turnSignalBg);
            turnSignalContainer.addChild(turnSignalText);
            turnSignal = {
              container: turnSignalContainer,
              width: turnSignalWidth,
              height: turnSignalHeight,
              startedAtMs: Number.isFinite(agent.turnSignal.startedAtMs) ? Number(agent.turnSignal.startedAtMs) : Date.now(),
              durationMs: Number.isFinite(agent.turnSignal.durationMs) ? Number(agent.turnSignal.durationMs) : 2800,
              phase: stableHash(agent.turnSignal.key || agent.id || agent.label || "turn-signal") % 1000,
              anchorMode: bubbleBox ? "bubble" : (statusMarker ? "marker" : "avatar")
            };
            syncTurnSignalNode(
              {
                currentX: agent.x,
                currentY: agent.y,
                targetX: agent.x,
                targetY: agent.y,
                width: agent.width
              },
              turnSignal
            );
            turnSignalContainer.zIndex = Number.isFinite(agent.depthFootY)
              ? sceneFootDepth(Number(agent.depthFootY) - snappedHeight, snappedHeight, (Number(agent.depthBias) || zIndex) + 4.5, model.tile, Number.isFinite(agent.depthBaseY) ? Number(agent.depthBaseY) : 0, Number.isFinite(agent.depthRow) ? Number(agent.depthRow) : null)
              : (fixedZ !== null ? fixedZ + 4.5 : sceneFootDepth(avatar.y, snappedHeight, zIndex + 4.5, model.tile, Number.isFinite(agent.depthBaseY) ? Number(agent.depthBaseY) : 0, Number.isFinite(agent.depthRow) ? Number(agent.depthRow) : null));
            renderer.root.addChild(turnSignalContainer);
            createdNodes.push(turnSignalContainer);
          }
          let activityCue = null;
          if (agent.activityCue && agent.activityCue.label) {
            const palette = activityCuePalette(agent.activityCue);
            const adornment = buildActivityCueAdornment(agent.activityCue.mode || "command", palette);
            const activityCueText = createPixiText(renderer, agent.activityCue.label, {
              fill: palette.textColor,
              fontFamily: "IBM Plex Mono",
              fontSize: Math.max(6, Math.round(6 * state.globalSceneSettings.textScale)),
              fontWeight: "700"
            });
            const activityCueWidth = Math.max(
              ACTIVITY_CUE_MIN_WIDTH,
              Math.round(activityCueText.width) + ACTIVITY_CUE_PADDING_X * 2 + ACTIVITY_CUE_ICON_WIDTH + ACTIVITY_CUE_ICON_GAP
            );
            const activityCueHeight = Math.max(ACTIVITY_CUE_MIN_HEIGHT, Math.round(activityCueText.height) + 4);
            const activityCueRadius = activityCueFrameRadius(agent.activityCue.mode || "command");
            const activityCueContainer = new PIXI.Container();
            activityCueContainer.pivot.set(Math.round(activityCueWidth / 2), Math.round(activityCueHeight / 2));
            const activityCueFrame = new PIXI.Graphics()
              .roundRect(-1, -1, activityCueWidth + 2, activityCueHeight + 2, activityCueRadius)
              .stroke({ color: palette.glowColor, width: 1, alpha: activityCueFrameAlpha(agent.activityCue.mode || "command") });
            const activityCueBg = new PIXI.Graphics()
              .roundRect(0, 0, activityCueWidth, activityCueHeight, activityCueRadius)
              .fill({ color: palette.fillColor, alpha: agent.activityCue.mode === "command" || agent.activityCue.mode === "file" ? 0.96 : 0.9 })
              .stroke({ color: palette.strokeColor, width: activityCueStrokeWidth(agent.activityCue.mode || "command"), alpha: 0.94 });
            const activityCueIconX = ACTIVITY_CUE_PADDING_X;
            const activityCueIconY = Math.max(1, Math.round((activityCueHeight - ACTIVITY_CUE_ICON_WIDTH) / 2));
            adornment.iconContainer.x = activityCueIconX;
            adornment.iconContainer.y = activityCueIconY;
            activityCueText.x = ACTIVITY_CUE_PADDING_X + ACTIVITY_CUE_ICON_WIDTH + ACTIVITY_CUE_ICON_GAP;
            activityCueText.y = Math.round((activityCueHeight - activityCueText.height) / 2) - 1;
            activityCueContainer.addChild(activityCueFrame);
            activityCueContainer.addChild(activityCueBg);
            activityCueContainer.addChild(adornment.iconContainer);
            activityCueContainer.addChild(activityCueText);
            activityCue = {
              container: activityCueContainer,
              mode: agent.activityCue.mode || "command",
              iconContainer: adornment.iconContainer,
              iconAccent: adornment.accentNode,
              iconBaseX: activityCueIconX,
              iconBaseY: activityCueIconY,
              textNode: activityCueText,
              textBaseX: activityCueText.x,
              textBaseY: activityCueText.y,
              width: activityCueWidth,
              height: activityCueHeight,
              startedAtMs: Number.isFinite(agent.activityCue.startedAtMs) ? Number(agent.activityCue.startedAtMs) : Date.now(),
              durationMs: Number.isFinite(agent.activityCue.durationMs) ? Number(agent.activityCue.durationMs) : 2200,
              phase: stableHash(agent.activityCue.key || agent.id || agent.label || "activity-cue") % 1000,
              anchorMode: activityCueAnchorMode(agent, agent.activityCue)
            };
            syncActivityCueNode(
              {
                currentX: agent.x,
                currentY: agent.y,
                targetX: agent.x,
                targetY: agent.y,
                width: agent.width,
                height: agent.height,
                flipX: agent.flipX === true
              },
              activityCue
            );
            activityCueContainer.zIndex = Number.isFinite(agent.depthFootY)
              ? sceneFootDepth(Number(agent.depthFootY) - snappedHeight, snappedHeight, (Number(agent.depthBias) || zIndex) + 4.25, model.tile, Number.isFinite(agent.depthBaseY) ? Number(agent.depthBaseY) : 0, Number.isFinite(agent.depthRow) ? Number(agent.depthRow) : null)
              : (fixedZ !== null ? fixedZ + 4.25 : sceneFootDepth(avatar.y, snappedHeight, zIndex + 4.25, model.tile, Number.isFinite(agent.depthBaseY) ? Number(agent.depthBaseY) : 0, Number.isFinite(agent.depthRow) ? Number(agent.depthRow) : null));
            renderer.root.addChild(activityCueContainer);
            createdNodes.push(activityCueContainer);
          }
          return {
            nodes: createdNodes,
            avatar,
            hatSprite,
            statusMarker,
            bubbleBox,
            bubbleText,
            turnSignal,
            activityCue,
            renderWidth: snappedWidth,
            renderHeight: snappedHeight,
            renderOffsetX: offsetX,
            renderOffsetY: offsetY,
            depthBias: Number.isFinite(agent.depthBias) ? Number(agent.depthBias) : (fixedZ !== null ? fixedZ : zIndex),
            depthFootY: Number.isFinite(agent.depthFootY) ? Number(agent.depthFootY) : null,
            depthBaseY: Number.isFinite(agent.depthBaseY) ? Number(agent.depthBaseY) : 0,
            depthRow: Number.isFinite(agent.depthRow) ? Number(agent.depthRow) : null,
            hatWidth: hatMetrics ? hatMetrics.width : 0,
            hatHeight: hatMetrics ? hatMetrics.height : 0,
            hatOffsetX: hatMetrics ? hatMetrics.offsetX : 0,
            hatCenteredOffsetX: hatMetrics ? hatMetrics.centeredOffsetX : 0,
            hatManualOffsetX: hatMetrics ? hatMetrics.manualOffsetX : 0,
            hatOffsetY: hatMetrics ? hatMetrics.offsetY : 0,
            statusMarkerLift: hatMetrics ? hatMetrics.markerLift : 0,
            turnSignalWidth: turnSignal ? turnSignal.width : 0,
            turnSignalHeight: turnSignal ? turnSignal.height : 0,
            turnSignalStartedAtMs: turnSignal ? turnSignal.startedAtMs : 0,
            turnSignalDurationMs: turnSignal ? turnSignal.durationMs : 0,
            turnSignalPhase: turnSignal ? turnSignal.phase : 0,
            turnSignalAnchorMode: turnSignal ? turnSignal.anchorMode : "avatar",
            activityCueWidth: activityCue ? activityCue.width : 0,
            activityCueHeight: activityCue ? activityCue.height : 0,
            activityCueStartedAtMs: activityCue ? activityCue.startedAtMs : 0,
            activityCueDurationMs: activityCue ? activityCue.durationMs : 0,
            activityCuePhase: activityCue ? activityCue.phase : 0,
            activityCueAnchorMode: activityCue ? activityCue.anchorMode : "avatar"
          };
        }

        function syncMotionStateDepth(motionState) {
          if (!motionState || !motionState.sprite) {
            return;
          }
          const routeLength = Array.isArray(motionState.route) ? motionState.route.length : 0;
          const settledAtTarget = motionState.exiting !== true
            && routeLength > 0
            && motionState.routeIndex >= routeLength;
          const effectiveDepthFootY = settledAtTarget && Number.isFinite(motionState.settledDepthFootY)
            ? Number(motionState.settledDepthFootY)
            : (Number.isFinite(motionState.depthFootY) ? Number(motionState.depthFootY) : null);
          const effectiveDepthBias = settledAtTarget && Number.isFinite(motionState.settledDepthBias)
            ? Number(motionState.settledDepthBias)
            : (Number.isFinite(motionState.depthBias) ? Number(motionState.depthBias) : 0);
          const effectiveDepthRow = settledAtTarget && Number.isFinite(motionState.settledDepthRow)
            ? Number(motionState.settledDepthRow)
            : (Number.isFinite(motionState.depthRow) ? Number(motionState.depthRow) : null);
          const renderHeight = Number.isFinite(motionState.renderHeight) ? Number(motionState.renderHeight) : Number(motionState.height);
          const renderTopY = Number.isFinite(motionState.currentY)
            ? Number(motionState.currentY) + (Number.isFinite(motionState.renderOffsetY) ? Number(motionState.renderOffsetY) : 0)
            : Number(motionState.sprite.y);
          if (Number.isFinite(effectiveDepthFootY)) {
            applyFootDepth(
              motionState.sprite,
              Number(effectiveDepthFootY) - renderHeight,
              renderHeight,
              effectiveDepthBias,
              model.tile,
              Number.isFinite(motionState.depthBaseY) ? Number(motionState.depthBaseY) : 0,
              effectiveDepthRow
            );
            if (motionState.statusMarker) {
              motionState.statusMarker.zIndex = sceneFootDepth(
                Number(effectiveDepthFootY) - renderHeight,
                renderHeight,
                effectiveDepthBias + 1,
                model.tile,
                Number.isFinite(motionState.depthBaseY) ? Number(motionState.depthBaseY) : 0,
                effectiveDepthRow
              );
            }
            if (motionState.bubbleBox) {
              motionState.bubbleBox.zIndex = sceneFootDepth(
                Number(effectiveDepthFootY) - renderHeight,
                renderHeight,
                effectiveDepthBias + 2,
                model.tile,
                Number.isFinite(motionState.depthBaseY) ? Number(motionState.depthBaseY) : 0,
                effectiveDepthRow
              );
            }
            if (motionState.bubbleText) {
              motionState.bubbleText.zIndex = sceneFootDepth(
                Number(effectiveDepthFootY) - renderHeight,
                renderHeight,
                effectiveDepthBias + 3,
                model.tile,
                Number.isFinite(motionState.depthBaseY) ? Number(motionState.depthBaseY) : 0,
                effectiveDepthRow
              );
            }
            if (motionState.hatSprite) {
              motionState.hatSprite.zIndex = sceneFootDepth(
                Number(effectiveDepthFootY) - renderHeight,
                renderHeight,
                effectiveDepthBias + 0.5,
                model.tile,
                Number.isFinite(motionState.depthBaseY) ? Number(motionState.depthBaseY) : 0,
                effectiveDepthRow
              );
            }
            if (motionState.heldItemSprite) {
              motionState.heldItemSprite.zIndex = sceneFootDepth(
                Number(effectiveDepthFootY) - renderHeight,
                renderHeight,
                effectiveDepthBias + 4,
                model.tile,
                Number.isFinite(motionState.depthBaseY) ? Number(motionState.depthBaseY) : 0,
                effectiveDepthRow
              );
            }
            if (motionState.turnSignal && motionState.turnSignal.container) {
              motionState.turnSignal.container.zIndex = sceneFootDepth(
                Number(effectiveDepthFootY) - renderHeight,
                renderHeight,
                effectiveDepthBias + 4.5,
                model.tile,
                Number.isFinite(motionState.depthBaseY) ? Number(motionState.depthBaseY) : 0,
                effectiveDepthRow
              );
            }
            if (motionState.activityCue && motionState.activityCue.container) {
              motionState.activityCue.container.zIndex = sceneFootDepth(
                Number(effectiveDepthFootY) - renderHeight,
                renderHeight,
                effectiveDepthBias + 4.25,
                model.tile,
                Number.isFinite(motionState.depthBaseY) ? Number(motionState.depthBaseY) : 0,
                effectiveDepthRow
              );
            }
            return;
          }
          if (Number.isFinite(motionState.fixedZ)) {
            const fixedZ = Number(motionState.fixedZ);
            motionState.sprite.zIndex = fixedZ;
            if (motionState.statusMarker) {
              motionState.statusMarker.zIndex = fixedZ + 1;
            }
            if (motionState.hatSprite) {
              motionState.hatSprite.zIndex = fixedZ + 0.5;
            }
            if (motionState.bubbleBox) {
              motionState.bubbleBox.zIndex = fixedZ + 2;
            }
            if (motionState.bubbleText) {
              motionState.bubbleText.zIndex = fixedZ + 3;
            }
            if (motionState.heldItemSprite) {
              motionState.heldItemSprite.zIndex = fixedZ + 4;
            }
            if (motionState.turnSignal && motionState.turnSignal.container) {
              motionState.turnSignal.container.zIndex = fixedZ + 4.5;
            }
            if (motionState.activityCue && motionState.activityCue.container) {
              motionState.activityCue.container.zIndex = fixedZ + 4.25;
            }
            return;
          }
          const depthBias = effectiveDepthBias;
          const currentRoom = motionState.roomId ? renderer.roomById?.get(motionState.roomId) || null : null;
          const movingDepthRow = currentRoom
            ? officeAvatarFootTile(
                currentRoom,
                model.tile,
                Number(motionState.currentX),
                Number(motionState.currentY),
                Number(motionState.width),
                Number(motionState.height)
              )?.row
            : null;
          applyFootDepth(motionState.sprite, renderTopY, renderHeight, depthBias, model.tile, Number.isFinite(motionState.depthBaseY) ? Number(motionState.depthBaseY) : 0, movingDepthRow);
          if (motionState.hatSprite) {
            applyFootDepth(motionState.hatSprite, renderTopY, renderHeight, depthBias + 0.5, model.tile, Number.isFinite(motionState.depthBaseY) ? Number(motionState.depthBaseY) : 0, movingDepthRow);
          }
          if (motionState.statusMarker) {
            applyFootDepth(motionState.statusMarker, renderTopY, renderHeight, depthBias + 1, model.tile, Number.isFinite(motionState.depthBaseY) ? Number(motionState.depthBaseY) : 0, movingDepthRow);
          }
          if (motionState.bubbleBox) {
            applyFootDepth(motionState.bubbleBox, renderTopY, renderHeight, depthBias + 2, model.tile, Number.isFinite(motionState.depthBaseY) ? Number(motionState.depthBaseY) : 0, movingDepthRow);
          }
          if (motionState.bubbleText) {
            applyFootDepth(motionState.bubbleText, renderTopY, renderHeight, depthBias + 3, model.tile, Number.isFinite(motionState.depthBaseY) ? Number(motionState.depthBaseY) : 0, movingDepthRow);
          }
          if (motionState.heldItemSprite) {
            applyFootDepth(motionState.heldItemSprite, renderTopY, renderHeight, depthBias + 4, model.tile, Number.isFinite(motionState.depthBaseY) ? Number(motionState.depthBaseY) : 0, movingDepthRow);
          }
          if (motionState.turnSignal && motionState.turnSignal.container) {
            applyFootDepth(motionState.turnSignal.container, renderTopY, renderHeight, depthBias + 4.5, model.tile, Number.isFinite(motionState.depthBaseY) ? Number(motionState.depthBaseY) : 0, movingDepthRow);
          }
          if (motionState.activityCue && motionState.activityCue.container) {
            applyFootDepth(motionState.activityCue.container, renderTopY, renderHeight, depthBias + 4.25, model.tile, Number.isFinite(motionState.depthBaseY) ? Number(motionState.depthBaseY) : 0, movingDepthRow);
          }
          if (
            state.globalSceneSettings.debugTiles
            && motionState.roomId
            && motionState.sprite
            && Array.isArray(renderer.debugWorkstationNodes)
          ) {
            const agentFootY = renderTopY + renderHeight;
            const agentLeft = Number(motionState.sprite.x) || 0;
            const agentRight = agentLeft + (Number(motionState.sprite.width) || 0);
            renderer.debugWorkstationNodes.forEach((entry) => {
              if (
                !entry
                || entry.roomId !== motionState.roomId
                || !entry.node
                || !Number.isFinite(entry.pivotY)
              ) {
                return;
              }
              const workstationLeft = Number.isFinite(entry.boundsX) ? Number(entry.boundsX) : (Number(entry.node.x) || 0);
              const workstationRight = workstationLeft + (Number.isFinite(entry.boundsWidth) ? Number(entry.boundsWidth) : (Number(entry.node.width) || 0));
              const overlapsX = agentRight > workstationLeft && agentLeft < workstationRight;
              if (!overlapsX) {
                return;
              }
              const agentZ = Number(motionState.sprite.zIndex) || 0;
              const workstationZ = Number(entry.node.zIndex) || 0;
              if (agentFootY >= Number(entry.pivotY) || agentZ <= workstationZ) {
                return;
              }
              const warningKey = [
                motionState.key,
                entry.key || "workstation",
                Math.round(agentFootY),
                Math.round(entry.pivotY),
                Math.round(agentZ),
                Math.round(workstationZ)
              ].join(":");
              if (renderer.debugDepthWarnings.has(warningKey)) {
                return;
              }
              renderer.debugDepthWarnings.add(warningKey);
              console.debug("scene depth violation", {
                agent: motionState.key,
                roomId: motionState.roomId,
                agentX: Math.round(Number(motionState.currentX) || 0),
                agentY: Math.round(Number(motionState.currentY) || 0),
                agentFootY: Math.round(agentFootY),
                agentZ: Math.round(agentZ),
                workstation: entry.key || null,
                workstationPivotY: Math.round(Number(entry.pivotY)),
                workstationZ: Math.round(workstationZ),
                workstationBounds: {
                  x: Math.round(workstationLeft),
                  width: Math.round(workstationRight - workstationLeft)
                }
              });
            });
          }
        }

        function buildBobAnimationEntry(agent, avatarVisual, motionState) {
          const stateValue = String((agent && agent.state) || "").toLowerCase();
          const mode =
            stateValue === "planning" ? "planning"
            : stateValue === "scanning" ? "scanning"
            : stateValue === "editing" ? "editing"
            : stateValue === "running" ? "running"
            : stateValue === "validating" ? "validating"
            : stateValue === "delegating" ? "delegating"
            : "busy";
          return {
            kind: "bob",
            motionState,
            sprite: avatarVisual.avatar,
            hatSprite: avatarVisual.hatSprite,
            statusMarker: avatarVisual.statusMarker,
            bubbleBox: avatarVisual.bubbleBox,
            bubbleText: avatarVisual.bubbleText,
            baseY: pixelSnap(avatarVisual.avatar && avatarVisual.avatar.y),
            hatBaseY: pixelSnap(avatarVisual.hatSprite && avatarVisual.hatSprite.y),
            statusMarkerBaseY: pixelSnap(avatarVisual.statusMarker && avatarVisual.statusMarker.y),
            bubbleBoxBaseY: pixelSnap(avatarVisual.bubbleBox && avatarVisual.bubbleBox.y),
            bubbleTextBaseY: pixelSnap(avatarVisual.bubbleText && avatarVisual.bubbleText.y),
            baseX: pixelSnap(avatarVisual.avatar && avatarVisual.avatar.x),
            hatBaseX: pixelSnap(avatarVisual.hatSprite && avatarVisual.hatSprite.x),
            statusMarkerBaseX: pixelSnap(avatarVisual.statusMarker && avatarVisual.statusMarker.x),
            bubbleBoxBaseX: pixelSnap(avatarVisual.bubbleBox && avatarVisual.bubbleBox.x),
            bubbleTextBaseX: pixelSnap(avatarVisual.bubbleText && avatarVisual.bubbleText.x),
            mode,
            phase: stableHash(agent.id || agent.label || "") % 1000
          };
        }

        function buildStateEffectAnimationEntry(agent, motionState) {
          const mode = stateEffectModeForAgent(agent);
          if (!mode || !motionState || !motionState.sprite) {
            return null;
          }
          return {
            kind: "state-effect",
            motionState,
            mode,
            phase: stableHash((agent.id || agent.label || "") + "::" + mode) % 1000
          };
        }

        function buildTurnSignalAnimationEntry(motionState) {
          if (!motionState || !motionState.turnSignal || !motionState.turnSignal.container) {
            return null;
          }
          return {
            kind: "turn-signal",
            motionState,
            phase: Number.isFinite(motionState.turnSignalPhase) ? Number(motionState.turnSignalPhase) : 0
          };
        }

        function buildActivityCueAnimationEntry(motionState) {
          if (!motionState || !motionState.activityCue || !motionState.activityCue.container) {
            return null;
          }
          return {
            kind: "activity-cue",
            motionState,
            mode: motionState.activityCue.mode || "command",
            phase: Number.isFinite(motionState.activityCuePhase) ? Number(motionState.activityCuePhase) : 0
          };
        }

        function registerAgentMotion(agent, avatarVisual, roomNavigation, reservations, previousMotionState = null, options = {}) {
          if (!agent || !avatarVisual || !avatarVisual.avatar) {
            return avatarVisual.nodes;
          }
          const room = roomById.get(agent.roomId);
          const agentKey = agent.key || agent.id;
          const nav = navigationForAgent(roomNavigation, reservations, agent.roomId, agentKey);
          const targetTile = officeAvatarFootTile(room, model.tile, agent.x, agent.y, agent.width, agent.height);
          const previousRoomState = previousMotionState && previousMotionState.roomId !== agent.roomId
            ? previousMotionState
            : null;
          const enteringFromDoor = !previousMotionState
            ? enteringAgentKeys.has(agent.key || agent.id)
            : previousRoomState !== null;
          const autonomousResting = isAutonomousRestingAgent(agent);
          const previousState = previousMotionState && previousMotionState.roomId === agent.roomId
            ? previousMotionState
            : null;
          if (previousRoomState && previousRoomState.exiting !== true) {
            const transitionGhostKey = agentKey + "::transition-exit::" + previousRoomState.roomId;
            const transitionGhost = buildExitGhostMotion(transitionGhostKey, previousRoomState, roomNavigation, reservations);
            if (transitionGhost) {
              renderer.motionStates.set(transitionGhostKey, transitionGhost);
              renderer.animatedSprites.push(transitionGhost);
              const previousDoorState = renderer.roomDoorStates.get(previousRoomState.roomId);
              if (previousDoorState) {
                previousDoorState.doorPulseUntil = performance.now() + sceneDoorConfig().holdOpenMs;
              }
            }
          }
          if (previousState && previousState.autonomy && previousState.autonomy.carriedItemId && !autonomousResting) {
            spawnThrownHeldItem(previousState);
          }
          const preserveAutonomyRoute = Boolean(
            autonomousResting
            && previousState
            && previousState.autonomy
            && previousState.autonomy.phase !== "seated"
            && previousState.exiting !== true
          );
          const sameTarget = shouldReuseMotionTarget(previousState, agent, preserveAutonomyRoute);
          if (sameTarget) {
            previousState.sprite = avatarVisual.avatar;
            previousState.hatSprite = avatarVisual.hatSprite;
            previousState.statusMarker = avatarVisual.statusMarker;
            previousState.bubbleBox = avatarVisual.bubbleBox;
            previousState.bubbleText = avatarVisual.bubbleText;
            previousState.turnSignal = avatarVisual.turnSignal;
            previousState.activityCue = avatarVisual.activityCue;
            previousState.heldItemSprite = null;
            previousState.anchorNode = renderer.agentHitNodes.get(agentKey) || null;
            previousState.width = agent.width;
            previousState.height = agent.height;
            previousState.renderWidth = avatarVisual.renderWidth;
            previousState.renderHeight = avatarVisual.renderHeight;
            previousState.renderOffsetX = avatarVisual.renderOffsetX;
            previousState.renderOffsetY = avatarVisual.renderOffsetY;
            previousState.hatWidth = avatarVisual.hatWidth;
            previousState.hatHeight = avatarVisual.hatHeight;
            previousState.hatOffsetX = avatarVisual.hatOffsetX;
            previousState.hatCenteredOffsetX = avatarVisual.hatCenteredOffsetX;
            previousState.hatManualOffsetX = avatarVisual.hatManualOffsetX;
            previousState.hatOffsetY = avatarVisual.hatOffsetY;
            previousState.statusMarkerLift = avatarVisual.statusMarkerLift;
            previousState.turnSignalWidth = avatarVisual.turnSignalWidth;
            previousState.turnSignalHeight = avatarVisual.turnSignalHeight;
            previousState.turnSignalStartedAtMs = avatarVisual.turnSignalStartedAtMs;
            previousState.turnSignalDurationMs = avatarVisual.turnSignalDurationMs;
            previousState.turnSignalPhase = avatarVisual.turnSignalPhase;
            previousState.turnSignalAnchorMode = avatarVisual.turnSignalAnchorMode;
            previousState.activityCueWidth = avatarVisual.activityCueWidth;
            previousState.activityCueHeight = avatarVisual.activityCueHeight;
            previousState.activityCueStartedAtMs = avatarVisual.activityCueStartedAtMs;
            previousState.activityCueDurationMs = avatarVisual.activityCueDurationMs;
            previousState.activityCuePhase = avatarVisual.activityCuePhase;
            previousState.activityCueAnchorMode = avatarVisual.activityCueAnchorMode;
            previousState.activityCueIconContainer = avatarVisual.activityCue && avatarVisual.activityCue.iconContainer ? avatarVisual.activityCue.iconContainer : null;
            previousState.activityCueIconAccent = avatarVisual.activityCue && avatarVisual.activityCue.iconAccent ? avatarVisual.activityCue.iconAccent : null;
            previousState.activityCueIconBaseX = avatarVisual.activityCue && Number.isFinite(avatarVisual.activityCue.iconBaseX) ? Number(avatarVisual.activityCue.iconBaseX) : 0;
            previousState.activityCueIconBaseY = avatarVisual.activityCue && Number.isFinite(avatarVisual.activityCue.iconBaseY) ? Number(avatarVisual.activityCue.iconBaseY) : 0;
            previousState.activityCueTextNode = avatarVisual.activityCue && avatarVisual.activityCue.textNode ? avatarVisual.activityCue.textNode : null;
            previousState.activityCueTextBaseX = avatarVisual.activityCue && Number.isFinite(avatarVisual.activityCue.textBaseX) ? Number(avatarVisual.activityCue.textBaseX) : 0;
            previousState.activityCueTextBaseY = avatarVisual.activityCue && Number.isFinite(avatarVisual.activityCue.textBaseY) ? Number(avatarVisual.activityCue.textBaseY) : 0;
            previousState.state = agent.state || "idle";
            previousState.spriteUrl = agent.sprite;
            previousState.depthBaseY = avatarVisual.depthBaseY;
            previousState.depthRow = avatarVisual.depthRow;
            previousState.settledDepthFootY = Number.isFinite(avatarVisual.depthFootY) ? Number(avatarVisual.depthFootY) : null;
            previousState.settledDepthBias = Number.isFinite(avatarVisual.depthBias) ? Number(avatarVisual.depthBias) : null;
            previousState.settledDepthRow = Number.isFinite(avatarVisual.depthRow) ? Number(avatarVisual.depthRow) : null;
            const isMoving = (Boolean(previousState && previousState.routeIndex < (previousState.route?.length || 0))
              || previousState.exiting === true);
            const movingDepthFootY = isMoving ? null : avatarVisual.depthFootY;
            const movingDepthBias = isMoving ? null : avatarVisual.depthBias;
            if (state.globalSceneSettings.debugTiles && isMoving && Number.isFinite(avatarVisual.depthFootY)) {
              console.debug("scene depth: clearing fixed foot depth for moving agent", {
                agent: agentKey,
                state: agent.state,
                target: { x: agent.x, y: agent.y },
                current: { x: previousState.currentX, y: previousState.currentY },
                foot: avatarVisual.depthFootY
              });
            }
            previousState.depthBias = movingDepthBias;
            previousState.depthFootY = movingDepthFootY;
            previousState.fixedZ = Number.isFinite(agent.z) ? Number(agent.z) : null;
            previousState.targetFlipX = agent.flipX === true;
            previousState.slotId = agent.slotId || previousState.slotId || null;
            previousState.mirrored = typeof agent.mirrored === "boolean"
              ? agent.mirrored
              : (typeof previousState.mirrored === "boolean" ? previousState.mirrored : null);
            if (autonomousResting) {
              previousState.autonomy = previousState.autonomy || {
                phase: "seated",
                homeX: agent.x,
                homeY: agent.y,
                homeFlip: agent.flipX === true,
                nextFlipAt: nextIdleFlipAt(),
                nextTripAt: nextIdleTripAt(),
                facility: null,
                carriedItemId: null,
                holdUntil: 0
              };
              previousState.autonomy.homeX = agent.x;
              previousState.autonomy.homeY = agent.y;
              previousState.autonomy.homeFlip = agent.flipX === true;
            } else {
              previousState.autonomy = null;
            }
            renderer.motionStates.set(agentKey, previousState);
            const previousStateEffectEntry = buildStateEffectAnimationEntry(agent, previousState);
            if (autonomousResting) {
              renderer.animatedSprites.push(previousState);
            } else if (["editing", "running", "validating", "scanning", "thinking", "planning", "delegating"].includes(agent.state) && previousState.routeIndex >= (previousState.route?.length || 0)) {
              renderer.animatedSprites.push(buildBobAnimationEntry(agent, avatarVisual, previousState));
            } else {
              renderer.animatedSprites.push(previousState);
            }
            if (previousStateEffectEntry) {
              renderer.animatedSprites.push(previousStateEffectEntry);
            }
            const previousTurnSignalEntry = buildTurnSignalAnimationEntry(previousState);
            if (previousTurnSignalEntry) {
              renderer.animatedSprites.push(previousTurnSignalEntry);
            }
            const previousActivityCueEntry = buildActivityCueAnimationEntry(previousState);
            if (previousActivityCueEntry) {
              renderer.animatedSprites.push(previousActivityCueEntry);
            }
            syncMotionStateDepth(previousState);
            syncAgentHitNodePosition(renderer, previousState);
            return avatarVisual.nodes;
          }
          const startTile = previousState
            ? nearestWalkableTile(nav, officeAvatarFootTile(room, model.tile, previousState.currentX, previousState.currentY, previousState.width, previousState.height))
            : enteringFromDoor
              ? nearestWalkableTile(nav, roomDoorTile(room, model.tile))
              : targetTile;
          const route = startTile && targetTile
            ? buildAgentPixelRoute(
              nav,
              startTile,
              targetTile,
              room,
              model.tile,
              agent.width,
              agent.height,
              { x: agent.x, y: agent.y }
            )
            : [{ x: agent.x, y: agent.y }];
          const isMoving = route.length > 1 || options.exiting === true;
          const movingDepthFootY = isMoving ? null : avatarVisual.depthFootY;
          const movingDepthBias = isMoving ? null : avatarVisual.depthBias;
          if (state.globalSceneSettings.debugTiles && isMoving && Number.isFinite(avatarVisual.depthFootY)) {
            console.debug('scene depth: clearing fixed foot depth for moving agent', {
              agent: agentKey,
              state: agent.state,
              target: { x: agent.x, y: agent.y },
              current: { x: previousState ? previousState.currentX : agent.x, y: previousState ? previousState.currentY : agent.y },
              foot: avatarVisual.depthFootY
            });
          }
          const motionState = {
            kind: "motion",
            key: agentKey,
            roomId: agent.roomId,
            sprite: avatarVisual.avatar,
            hatSprite: avatarVisual.hatSprite,
            statusMarker: avatarVisual.statusMarker,
            spriteUrl: agent.sprite,
            bubbleBox: avatarVisual.bubbleBox,
            bubbleText: avatarVisual.bubbleText,
            turnSignal: avatarVisual.turnSignal,
            activityCue: avatarVisual.activityCue,
            width: agent.width,
            height: agent.height,
            renderWidth: avatarVisual.renderWidth,
            renderHeight: avatarVisual.renderHeight,
            renderOffsetX: avatarVisual.renderOffsetX,
            renderOffsetY: avatarVisual.renderOffsetY,
            hatWidth: avatarVisual.hatWidth,
            hatHeight: avatarVisual.hatHeight,
            hatOffsetX: avatarVisual.hatOffsetX,
            hatCenteredOffsetX: avatarVisual.hatCenteredOffsetX,
            hatManualOffsetX: avatarVisual.hatManualOffsetX,
            hatOffsetY: avatarVisual.hatOffsetY,
            statusMarkerLift: avatarVisual.statusMarkerLift,
            turnSignalWidth: avatarVisual.turnSignalWidth,
            turnSignalHeight: avatarVisual.turnSignalHeight,
            turnSignalStartedAtMs: avatarVisual.turnSignalStartedAtMs,
            turnSignalDurationMs: avatarVisual.turnSignalDurationMs,
            turnSignalPhase: avatarVisual.turnSignalPhase,
            turnSignalAnchorMode: avatarVisual.turnSignalAnchorMode,
            activityCueWidth: avatarVisual.activityCueWidth,
            activityCueHeight: avatarVisual.activityCueHeight,
            activityCueStartedAtMs: avatarVisual.activityCueStartedAtMs,
            activityCueDurationMs: avatarVisual.activityCueDurationMs,
            activityCuePhase: avatarVisual.activityCuePhase,
            activityCueAnchorMode: avatarVisual.activityCueAnchorMode,
            activityCueIconContainer: avatarVisual.activityCue && avatarVisual.activityCue.iconContainer ? avatarVisual.activityCue.iconContainer : null,
            activityCueIconAccent: avatarVisual.activityCue && avatarVisual.activityCue.iconAccent ? avatarVisual.activityCue.iconAccent : null,
            activityCueIconBaseX: avatarVisual.activityCue && Number.isFinite(avatarVisual.activityCue.iconBaseX) ? Number(avatarVisual.activityCue.iconBaseX) : 0,
            activityCueIconBaseY: avatarVisual.activityCue && Number.isFinite(avatarVisual.activityCue.iconBaseY) ? Number(avatarVisual.activityCue.iconBaseY) : 0,
            activityCueTextNode: avatarVisual.activityCue && avatarVisual.activityCue.textNode ? avatarVisual.activityCue.textNode : null,
            activityCueTextBaseX: avatarVisual.activityCue && Number.isFinite(avatarVisual.activityCue.textBaseX) ? Number(avatarVisual.activityCue.textBaseX) : 0,
            activityCueTextBaseY: avatarVisual.activityCue && Number.isFinite(avatarVisual.activityCue.textBaseY) ? Number(avatarVisual.activityCue.textBaseY) : 0,
            currentX: previousState
              ? previousState.currentX
              : (route[0]?.x ?? agent.x),
            currentY: previousState
              ? previousState.currentY
              : (route[0]?.y ?? agent.y),
            currentTile: startTile || targetTile,
            targetX: agent.x,
            targetY: agent.y,
            route,
            routeIndex: previousState ? 0 : 1,
            speed: options.speed || 198,
            flipX: previousState ? previousState.flipX : agent.flipX === true,
            targetFlipX: agent.flipX === true,
            anchorNode: renderer.agentHitNodes.get(agentKey) || null,
            exiting: options.exiting === true,
            state: agent.state || "idle",
            slotId: agent.slotId || previousState?.slotId || null,
            mirrored: typeof agent.mirrored === "boolean"
              ? agent.mirrored
              : (typeof previousState?.mirrored === "boolean" ? previousState.mirrored : null),
            heldItemSprite: null,
            depthBaseY: avatarVisual.depthBaseY,
            depthRow: avatarVisual.depthRow,
            depthBias: movingDepthBias,
            depthFootY: movingDepthFootY,
            settledDepthBias: Number.isFinite(avatarVisual.depthBias) ? Number(avatarVisual.depthBias) : null,
            settledDepthFootY: Number.isFinite(avatarVisual.depthFootY) ? Number(avatarVisual.depthFootY) : null,
            settledDepthRow: Number.isFinite(avatarVisual.depthRow) ? Number(avatarVisual.depthRow) : null,
            fixedZ: Number.isFinite(agent.z) ? Number(agent.z) : null,
            autonomy: autonomousResting
              ? (previousState && previousState.autonomy
                ? {
                    ...previousState.autonomy,
                    homeX: agent.x,
                    homeY: agent.y,
                    homeFlip: agent.flipX === true
                  }
                : {
                    phase: "seated",
                    homeX: agent.x,
                    homeY: agent.y,
                    homeFlip: agent.flipX === true,
                    nextFlipAt: nextIdleFlipAt(),
                    nextTripAt: nextIdleTripAt(),
                    facility: null,
                    carriedItemId: null,
                    holdUntil: 0
                  })
              : null
          };
          if (enteringFromDoor) {
            const doorState = renderer.roomDoorStates.get(agent.roomId);
            if (doorState) {
              doorState.doorPulseUntil = performance.now() + sceneDoorConfig().holdOpenMs;
            }
          }
          if (["editing", "running", "validating", "scanning", "thinking", "planning", "delegating"].includes(agent.state) && route.length <= 1) {
            motionState.currentX = agent.x;
            motionState.currentY = agent.y;
            motionState.route = [{ x: agent.x, y: agent.y }];
            motionState.routeIndex = 1;
            renderer.motionStates.set(motionState.key, motionState);
            renderer.animatedSprites.push(buildBobAnimationEntry(agent, avatarVisual, motionState));
            const bobStateEffectEntry = buildStateEffectAnimationEntry(agent, motionState);
            if (bobStateEffectEntry) {
              renderer.animatedSprites.push(bobStateEffectEntry);
            }
            const bobTurnSignalEntry = buildTurnSignalAnimationEntry(motionState);
            if (bobTurnSignalEntry) {
              renderer.animatedSprites.push(bobTurnSignalEntry);
            }
            const bobActivityCueEntry = buildActivityCueAnimationEntry(motionState);
            if (bobActivityCueEntry) {
              renderer.animatedSprites.push(bobActivityCueEntry);
            }
            syncMotionStateDepth(motionState);
            syncAgentHitNodePosition(renderer, motionState);
            return avatarVisual.nodes;
          }
          if (route.length <= 1 && !motionState.exiting) {
            motionState.currentX = agent.x;
            motionState.currentY = agent.y;
            motionState.route = [{ x: agent.x, y: agent.y }];
            motionState.routeIndex = 1;
            renderer.motionStates.set(motionState.key, motionState);
            const restingStateEffectEntry = buildStateEffectAnimationEntry(agent, motionState);
            if (autonomousResting || restingStateEffectEntry) {
              renderer.animatedSprites.push(motionState);
            }
            if (restingStateEffectEntry) {
              renderer.animatedSprites.push(restingStateEffectEntry);
            }
            const restingTurnSignalEntry = buildTurnSignalAnimationEntry(motionState);
            if (restingTurnSignalEntry) {
              renderer.animatedSprites.push(restingTurnSignalEntry);
            }
            const restingActivityCueEntry = buildActivityCueAnimationEntry(motionState);
            if (restingActivityCueEntry) {
              renderer.animatedSprites.push(restingActivityCueEntry);
            }
            syncMotionStateDepth(motionState);
            syncAgentHitNodePosition(renderer, motionState);
            return avatarVisual.nodes;
          }
          renderer.motionStates.set(motionState.key, motionState);
          renderer.animatedSprites.push(motionState);
          const motionStateEffectEntry = buildStateEffectAnimationEntry(agent, motionState);
          if (motionStateEffectEntry) {
            renderer.animatedSprites.push(motionStateEffectEntry);
          }
          const motionTurnSignalEntry = buildTurnSignalAnimationEntry(motionState);
          if (motionTurnSignalEntry) {
            renderer.animatedSprites.push(motionTurnSignalEntry);
          }
          const activityCueEntry = buildActivityCueAnimationEntry(motionState);
          if (activityCueEntry) {
            renderer.animatedSprites.push(activityCueEntry);
          }
          syncMotionStateDepth(motionState);
          syncAgentHitNodePosition(renderer, motionState);
          return avatarVisual.nodes;
        }

        function addDebugBounds(x, y, width, height, color, label) {
          const outline = new PIXI.Graphics()
            .rect(pixelSnap(x), pixelSnap(y), pixelSnap(width, 1), pixelSnap(height, 1))
            .stroke({ color, width: 1, alpha: 0.95 });
          outline.zIndex = 98;
          renderer.root.addChild(outline);
          if (!label) {
            return;
          }
          const labelWidth = Math.max(24, label.length * 5 + 6);
          const labelBg = new PIXI.Graphics()
            .roundRect(pixelSnap(x), pixelSnap(y) - 10, labelWidth, 10, 2)
            .fill({ color: 0x061019, alpha: 0.86 })
            .stroke({ color, width: 1, alpha: 0.95 });
          labelBg.zIndex = 99;
          renderer.root.addChild(labelBg);
          const labelText = createPixiText(renderer, label, {
            fill: color,
            fontFamily: "IBM Plex Mono",
            fontSize: 7,
            fontWeight: "700"
          });
          labelText.x = pixelSnap(x) + 3;
          labelText.y = pixelSnap(y) - 9;
          labelText.zIndex = 100;
          renderer.root.addChild(labelText);
        }

        function addDebugPivot(x, y, color) {
          const pivotX = pixelSnap(x);
          const pivotY = pixelSnap(y);
          const pivotHalo = new PIXI.Graphics()
            .circle(pivotX, pivotY, 4)
            .fill({ color: 0xffffff, alpha: 0.92 });
          pivotHalo.zIndex = 101;
          renderer.root.addChild(pivotHalo);
          const pivotDot = new PIXI.Graphics()
            .circle(pivotX, pivotY, 2)
            .fill({ color, alpha: 1 })
            .stroke({ color: 0x061019, width: 1, alpha: 0.95 });
          pivotDot.zIndex = 102;
          renderer.root.addChild(pivotDot);
        }

        model.rooms.forEach((room) => {
          const roomBox = new PIXI.Graphics()
            .roundRect(room.x, room.y, room.width, room.height, 10)
            .fill({ color: room.isPrimary ? 0x1f7fcf : 0x256fa8, alpha: 0.95 })
            .stroke({ color: 0x365a76, width: 3 });
          roomBox.zIndex = 1;
          renderer.root.addChild(roomBox);

          const wallBand = new PIXI.Graphics()
            .rect(room.x, room.y, room.width, room.wallHeight)
            .fill({ color: 0xdceefe, alpha: 0.92 });
          wallBand.zIndex = 2;
          renderer.root.addChild(wallBand);

          const mural = new PIXI.Graphics()
            .rect(room.x + 8, room.y + 8, room.width - 16, Math.max(16, room.wallHeight - 16))
            .fill({ color: 0x9dd6ff, alpha: 0.32 });
          mural.zIndex = 2;
          renderer.root.addChild(mural);

          const roomDoor = model.roomDoors.find((entry) => entry.roomId === room.id) || null;
          if (roomDoor) {
            const doorConfig = sceneDoorConfig();
            const backdrop = new PIXI.Graphics()
              .rect(roomDoor.backdropX, roomDoor.backdropY, roomDoor.backdropWidth, roomDoor.backdropHeight)
              .fill({ color: doorConfig.backdropColor, alpha: doorConfig.backdropAlpha });
            backdrop.zIndex = 2.2;
            renderer.root.addChild(backdrop);

            const leftDoor = PIXI.Sprite.from(loadedOfficeAssetImages.get(roomDoor.leftSprite) || roomDoor.leftSprite);
            leftDoor.width = roomDoor.width;
            leftDoor.height = roomDoor.height;
            leftDoor.scale.x = -Math.abs(leftDoor.scale.x || 1);
            leftDoor.x = roomDoor.leftX + roomDoor.width;
            leftDoor.y = roomDoor.y;
            leftDoor.zIndex = 2.6;
            renderer.root.addChild(leftDoor);

            const rightDoor = PIXI.Sprite.from(loadedOfficeAssetImages.get(roomDoor.rightSprite) || roomDoor.rightSprite);
            rightDoor.width = roomDoor.width;
            rightDoor.height = roomDoor.height;
            rightDoor.x = roomDoor.rightX;
            rightDoor.y = roomDoor.y;
            rightDoor.zIndex = 2.6;
            renderer.root.addChild(rightDoor);

            const previousDoorState = previousDoorStates.get(room.id) || null;
            renderer.roomDoorStates.set(room.id, {
              roomId: room.id,
              backdrop,
              leftSprite: leftDoor,
              rightSprite: rightDoor,
              baseLeftX: roomDoor.leftX + roomDoor.width,
              baseRightX: roomDoor.rightX,
              openAmount: Number(previousDoorState?.openAmount) || 0,
              doorPulseUntil: Number(previousDoorState?.doorPulseUntil) || 0
            });
          }

          const floorTop = room.floorTop;
          for (let y = floorTop; y < room.y + room.height; y += 48) {
            const band = new PIXI.Graphics()
              .rect(room.x, y, room.width, 22)
              .fill({ color: 0x48a7ee, alpha: 0.96 });
            band.zIndex = 1.5;
            renderer.root.addChild(band);
            const seam = new PIXI.Graphics()
              .rect(room.x, Math.min(y + 22, room.y + room.height - 2), room.width, 2)
              .fill({ color: 0x7eeaff, alpha: 0.86 });
            seam.zIndex = 1.6;
            renderer.root.addChild(seam);
            const shadowBand = new PIXI.Graphics()
              .rect(room.x, Math.min(y + 24, room.y + room.height - 22), room.width, 22)
              .fill({ color: 0x2f8fdf, alpha: 0.94 });
            shadowBand.zIndex = 1.55;
            renderer.root.addChild(shadowBand);
          }

          if (state.globalSceneSettings.debugTiles) {
            for (let x = room.x; x <= room.x + room.width; x += model.tile) {
              const vertical = new PIXI.Graphics()
                .moveTo(x, floorTop)
                .lineTo(x, room.y + room.height)
                .stroke({ color: 0xffffff, width: 1, alpha: 0.18 });
              vertical.zIndex = 96;
              renderer.root.addChild(vertical);
            }
            for (let y = floorTop; y <= room.y + room.height; y += model.tile) {
              const horizontal = new PIXI.Graphics()
                .moveTo(room.x, y)
                .lineTo(room.x + room.width, y)
                .stroke({ color: 0xffffff, width: 1, alpha: 0.18 });
              horizontal.zIndex = 96;
              renderer.root.addChild(horizontal);
            }
          }

        });

        renderer.relationshipLineEntries = [];
        model.relationshipLines.forEach((line) => {
          const dx = line.x2 - line.x1;
          const dy = line.y2 - line.y1;
          const distance = Math.max(1, Math.hypot(dx, dy));
          const direction = dx >= 0 ? 1 : -1;
          const controlReach = Math.max(26, Math.min(88, Math.round(distance * 0.34)));
          const controlLift = Math.max(18, Math.min(54, Math.round(distance * 0.16)));
          const apexY = Math.min(line.y1, line.y2) - controlLift;
          const control1X = line.x1 + controlReach * direction;
          const control1Y = apexY;
          const control2X = line.x2 - controlReach * direction;
          const control2Y = apexY;

          const path = new PIXI.Graphics()
            .moveTo(line.x1, line.y1)
            .bezierCurveTo(control1X, control1Y, control2X, control2Y, line.x2, line.y2)
            .stroke({ color: 0xffde73, width: 3, alpha: 0.72, cap: "round", join: "round" });
          path.zIndex = 20000;
          path.visible = false;
          renderer.root.addChild(path);

          const tangentX = line.x2 - control2X;
          const tangentY = line.y2 - control2Y;
          const tangentAngle = Math.atan2(tangentY, tangentX);
          const arrowLength = 11;
          const arrowWidth = 5;
          const arrowBaseX = line.x2 - Math.cos(tangentAngle) * arrowLength;
          const arrowBaseY = line.y2 - Math.sin(tangentAngle) * arrowLength;
          const arrowHead = new PIXI.Graphics()
            .moveTo(line.x2, line.y2)
            .lineTo(
              arrowBaseX + Math.cos(tangentAngle + Math.PI / 2) * arrowWidth,
              arrowBaseY + Math.sin(tangentAngle + Math.PI / 2) * arrowWidth
            )
            .lineTo(
              arrowBaseX + Math.cos(tangentAngle - Math.PI / 2) * arrowWidth,
              arrowBaseY + Math.sin(tangentAngle - Math.PI / 2) * arrowWidth
            )
            .closePath()
            .fill({ color: 0xffde73, alpha: 0.88 });
          arrowHead.zIndex = 20000;
          arrowHead.visible = false;
          renderer.root.addChild(arrowHead);

          renderer.relationshipLineEntries.push({
            bossKey: line.focusKey,
            nodes: [
              { node: path, baseAlpha: 1 },
              { node: arrowHead, baseAlpha: 1 }
            ]
          });
        });

        model.tileObjects.forEach((object) => {
          const prop = compileTileObject(model, roomById, object);
          if (!prop) {
            return;
          }
          addSpriteNode(prop);
          if (state.globalSceneSettings.debugTiles) {
            addDebugBounds(
              prop.x,
              prop.y,
              prop.width,
              prop.height,
              0xffd64d,
              Number.isFinite(prop.tileWidth) && Number.isFinite(prop.tileHeight)
                ? \`\${prop.tileWidth}x\${prop.tileHeight}\`
                : tileBoundsLabel(prop.width, prop.height, model.tile)
            );
          }
        });

        model.workstations.forEach((workstation) => {
          if (!state.globalSceneSettings.debugTiles) {
            return;
          }
          addDebugBounds(
            workstation.x,
            workstation.y,
            workstation.width,
            workstation.height,
            0x4dd8ff,
            \`\${workstation.tileWidth}x\${workstation.tileHeight}\`
          );
          if (Number.isFinite(workstation.pivotX) && Number.isFinite(workstation.pivotY)) {
            addDebugPivot(
              workstation.pivotX,
              workstation.pivotY,
              0xffb347
            );
          }
        });

        const currentAgentKeys = new Set();

        model.desks.forEach((desk) => {
          const deskNodes = [];
          const enteringRevealNodes = [];
          const workstationKey = desk.agents[0]?.key || desk.agents[0]?.id || null;
          const workstationMeta = workstationKey ? workstationByKey.get(workstationKey) || null : null;
          desk.shell.forEach((item) => {
            if (item.kind === "sprite") {
              const node = addSpriteNode(item);
              deskNodes.push(node);
              if (item.z === 9 && workstationMeta) {
                renderer.debugWorkstationNodes.push({
                  key: workstationMeta.key,
                  roomId: workstationMeta.roomId,
                  node,
                  pivotY: workstationMeta.pivotY,
                  boundsX: workstationMeta.x,
                  boundsWidth: workstationMeta.width
                });
              }
              if (!screenshotMode && item.enteringReveal === true) {
                enteringRevealNodes.push(node);
              }
              return;
            }
            if (item.kind === "glow") {
              const glow = new PIXI.Graphics()
                .roundRect(item.x, item.y, item.width, item.height, 3)
                .fill({ color: Number.isFinite(item.color) ? Number(item.color) : 0x4bd69f, alpha: Number.isFinite(item.alpha) ? Number(item.alpha) : 0.24 });
              glow.zIndex = item.z || 10;
              if (!screenshotMode && item.enteringReveal === true) {
                glow.visible = false;
                enteringRevealNodes.push(glow);
              }
              renderer.root.addChild(glow);
              deskNodes.push(glow);
              if (item.pulse === true) {
                renderer.animatedSprites.push({
                  kind: "workstation-glow",
                  node: glow,
                  baseAlpha: Number.isFinite(item.alpha) ? Number(item.alpha) : 0.24,
                  phase: stableHash(String(workstationKey || desk.id || item.x || 0) + "::glow") % 1000
                });
              }
              return;
            }
            if (item.kind === "cue-effect") {
              const cueEffect = buildWorkstationCueEffectNode(item);
              cueEffect.container.zIndex = item.z || 10.5;
              if (!screenshotMode && item.enteringReveal === true) {
                cueEffect.container.visible = false;
                enteringRevealNodes.push(cueEffect.container);
              }
              renderer.root.addChild(cueEffect.container);
              deskNodes.push(cueEffect.container);
              renderer.animatedSprites.push({
                kind: "workstation-cue-effect",
                node: cueEffect.container,
                mode: item.mode || "command",
                startedAtMs: Number.isFinite(item.startedAtMs) ? Number(item.startedAtMs) : Date.now(),
                durationMs: Number.isFinite(item.durationMs) ? Number(item.durationMs) : 2200,
                phase: stableHash(String(item.key || workstationKey || desk.id || item.x || 0) + "::cue-effect") % 1000,
                baseX: cueEffect.baseX,
                baseY: cueEffect.baseY,
                width: cueEffect.width,
                height: cueEffect.height,
                primaryNode: cueEffect.primaryNode,
                secondaryNode: cueEffect.secondaryNode,
                frameNode: cueEffect.frameNode,
                glowNode: cueEffect.glowNode,
                accentNodes: cueEffect.accentNodes,
                dotNodes: cueEffect.dotNodes,
                detailNodes: cueEffect.detailNodes,
                requestProfile: cueEffect.requestProfile
              });
            }
          });
          if (enteringRevealNodes.length > 0) {
            renderer.animatedSprites.push({
              kind: "blink",
              nodes: enteringRevealNodes,
              startedAt: performance.now(),
              durationMs: 140
            });
          }

          const deskFocusKeys = [];
          desk.agents.forEach((agent) => {
            deskFocusKeys.push(...(agent.focusKeys || []));
            currentAgentKeys.add(agent.key || agent.id);
            deskNodes.push(
              ...registerAgentMotion(
                agent,
                addAvatarNode(agent, 12),
                roomNavigation,
                reservedAgentTiles,
                previousMotionStates.get(agent.key || agent.id) || null
              )
            );
          });
          registerFocusNodes([...new Set(deskFocusKeys)], deskNodes);
        });

        model.offices.forEach((office) => {
          const officeNodes = [];
          const enteringRevealNodes = [];
          const workstationKey = office.agent?.key || office.agent?.id || null;
          const workstationMeta = workstationKey ? workstationByKey.get(workstationKey) || null : null;
          if (state.globalSceneSettings.debugTiles) {
            addDebugBounds(office.x, office.y, office.width, office.height, 0xff8d4d, tileBoundsLabel(office.width, office.height, model.tile));
          }
          const wallHeight = Math.max(model.tile + 8, Math.round(office.height * 0.42));
          const shell = new PIXI.Graphics()
            .rect(office.x, office.y, office.width, office.height)
            .fill({ color: 0x1b2b33, alpha: 0.96 })
            .stroke({ color: 0xffcf4d, width: 2, alpha: 0.42 });
          shell.zIndex = 5;
          renderer.root.addChild(shell);
          officeNodes.push(shell);

          const wall = new PIXI.Graphics()
            .rect(office.x + 2, office.y + 2, Math.max(0, office.width - 4), Math.max(0, wallHeight - 2))
            .fill({ color: 0xdceefe, alpha: 0.92 });
          wall.zIndex = 6;
          renderer.root.addChild(wall);
          officeNodes.push(wall);

          const divider = new PIXI.Graphics()
            .rect(office.x + 2, office.y + wallHeight, Math.max(0, office.width - 4), 2)
            .fill({ color: 0x8ed6ff, alpha: 0.76 });
          divider.zIndex = 7;
          renderer.root.addChild(divider);
          officeNodes.push(divider);

          const floor = new PIXI.Graphics()
            .rect(office.x + 2, office.y + wallHeight + 2, Math.max(0, office.width - 4), Math.max(0, office.height - wallHeight - 4))
            .fill({ color: 0x357bb0, alpha: 0.9 });
          floor.zIndex = 6;
          renderer.root.addChild(floor);
          officeNodes.push(floor);

          const doorwayWidth = Math.max(model.tile + 2, Math.round(office.width * 0.28));
          const doorwayX = office.x + Math.round((office.width - doorwayWidth) / 2);
          const doorway = new PIXI.Graphics()
            .rect(doorwayX, office.y + office.height - 2, doorwayWidth, 2)
            .fill({ color: 0x0b1b2b, alpha: 1 });
          doorway.zIndex = 7;
          renderer.root.addChild(doorway);
          officeNodes.push(doorway);

          office.shell.forEach((item) => {
            if (item.kind === "sprite") {
              const node = addSpriteNode(item);
              officeNodes.push(node);
              if (item.z === 9 && workstationMeta) {
                renderer.debugWorkstationNodes.push({
                  key: workstationMeta.key,
                  roomId: workstationMeta.roomId,
                  node,
                  pivotY: workstationMeta.pivotY,
                  boundsX: workstationMeta.x,
                  boundsWidth: workstationMeta.width
                });
              }
              if (!screenshotMode && item.enteringReveal === true) {
                enteringRevealNodes.push(node);
              }
              return;
            }
            if (item.kind === "glow") {
              const glow = new PIXI.Graphics()
                .roundRect(item.x, item.y, item.width, item.height, 3)
                .fill({ color: Number.isFinite(item.color) ? Number(item.color) : 0x4bd69f, alpha: Number.isFinite(item.alpha) ? Number(item.alpha) : 0.24 });
              glow.zIndex = item.z || 10;
              if (!screenshotMode && item.enteringReveal === true) {
                glow.visible = false;
                enteringRevealNodes.push(glow);
              }
              renderer.root.addChild(glow);
              officeNodes.push(glow);
              if (item.pulse === true) {
                renderer.animatedSprites.push({
                  kind: "workstation-glow",
                  node: glow,
                  baseAlpha: Number.isFinite(item.alpha) ? Number(item.alpha) : 0.24,
                  phase: stableHash(String(workstationKey || office.id || item.x || 0) + "::glow") % 1000
                });
              }
              return;
            }
            if (item.kind === "cue-effect") {
              const cueEffect = buildWorkstationCueEffectNode(item);
              cueEffect.container.zIndex = item.z || 10.5;
              if (!screenshotMode && item.enteringReveal === true) {
                cueEffect.container.visible = false;
                enteringRevealNodes.push(cueEffect.container);
              }
              renderer.root.addChild(cueEffect.container);
              officeNodes.push(cueEffect.container);
              renderer.animatedSprites.push({
                kind: "workstation-cue-effect",
                node: cueEffect.container,
                mode: item.mode || "command",
                startedAtMs: Number.isFinite(item.startedAtMs) ? Number(item.startedAtMs) : Date.now(),
                durationMs: Number.isFinite(item.durationMs) ? Number(item.durationMs) : 2200,
                phase: stableHash(String(item.key || workstationKey || office.id || item.x || 0) + "::cue-effect") % 1000,
                baseX: cueEffect.baseX,
                baseY: cueEffect.baseY,
                width: cueEffect.width,
                height: cueEffect.height,
                primaryNode: cueEffect.primaryNode,
                secondaryNode: cueEffect.secondaryNode,
                frameNode: cueEffect.frameNode,
                glowNode: cueEffect.glowNode,
                accentNodes: cueEffect.accentNodes,
                dotNodes: cueEffect.dotNodes,
                detailNodes: cueEffect.detailNodes,
                requestProfile: cueEffect.requestProfile
              });
            }
          });
          if (enteringRevealNodes.length > 0) {
            renderer.animatedSprites.push({
              kind: "blink",
              nodes: enteringRevealNodes,
              startedAt: performance.now(),
              durationMs: 140
            });
          }

          if (office.badgeLabel) {
            const badgeBg = new PIXI.Graphics()
              .roundRect(office.x + 4, office.y + 4, Math.max(32, office.badgeLabel.length * 4 + 6), 10, 2)
              .fill({ color: 0x0c1210, alpha: 0.62 })
              .stroke({ color: 0xffffff, width: 1, alpha: 0.14 });
            badgeBg.zIndex = 11;
            renderer.root.addChild(badgeBg);
            const badgeText = createPixiText(renderer, office.badgeLabel, {
              fill: 0xf6eed9,
              fontFamily: "IBM Plex Mono",
              fontSize: Math.max(7, Math.round(7 * state.globalSceneSettings.textScale))
            });
            badgeText.x = office.x + 7;
            badgeText.y = office.y + 5;
            badgeText.zIndex = 12;
            renderer.root.addChild(badgeText);
            officeNodes.push(badgeBg, badgeText);
          }

          if (office.agent) {
            currentAgentKeys.add(office.agent.key || office.agent.id);
            officeNodes.push(
              ...registerAgentMotion(
                office.agent,
                addAvatarNode(office.agent, 12),
                roomNavigation,
                reservedAgentTiles,
                previousMotionStates.get(office.agent.key || office.agent.id) || null
              )
            );
            registerFocusNodes(office.agent.focusKeys, officeNodes);
          }
        });

        model.recAgents.forEach((agent) => {
          currentAgentKeys.add(agent.key || agent.id);
          const recNodes = registerAgentMotion(
            agent,
            addAvatarNode(agent, 12),
            roomNavigation,
            reservedAgentTiles,
            previousMotionStates.get(agent.key || agent.id) || null
          );
          if (state.globalSceneSettings.debugTiles) {
            addDebugBounds(agent.x, agent.y, agent.width, agent.height, 0x9eff6a, tileBoundsLabel(agent.width, agent.height, model.tile));
            addDebugPivot(
              Number.isFinite(agent.pivotX) ? agent.pivotX : agent.x + agent.width / 2,
              Number.isFinite(agent.pivotY) ? agent.pivotY : agent.y + agent.height - 1,
              0xff5d9e
            );
          }
          registerFocusNodes(agent.focusKeys, recNodes);
        });

        previousMotionStates.forEach((motionState, key) => {
          if (!motionState || motionState.exiting !== true || currentAgentKeys.has(key) || renderer.motionStates.has(key)) {
            return;
          }
          const preservedExitMotion = buildExitGhostMotion(key, motionState, roomNavigation, reservedAgentTiles);
          if (!preservedExitMotion) {
            return;
          }
          renderer.motionStates.set(key, preservedExitMotion);
          renderer.animatedSprites.push(preservedExitMotion);
        });

        const departingAgentKeys = new Set(departingAgents.map((agent) => agent.key));
        previousMotionStates.forEach((motionState, key) => {
          if (!motionState || currentAgentKeys.has(key) || motionState.exiting || !departingAgentKeys.has(key)) {
            return;
          }
          const ghostMotion = buildExitGhostMotion(key, motionState, roomNavigation, reservedAgentTiles);
          if (!ghostMotion) {
            return;
          }
          renderer.motionStates.set(key, ghostMotion);
          renderer.animatedSprites.push(ghostMotion);
          const doorState = renderer.roomDoorStates.get(motionState.roomId);
          if (doorState) {
            doorState.doorPulseUntil = performance.now() + sceneDoorConfig().holdOpenMs;
          }
        });

        const projectSceneKeyPrefix = model.projectRoot + "::";
        for (const key of [...renderedAgentSceneState.keys()]) {
          if (key.startsWith(projectSceneKeyPrefix)) {
            renderedAgentSceneState.delete(key);
          }
        }
        renderer.motionStates.forEach((motionState, key) => {
          if (!motionState || motionState.exiting === true) {
            return;
          }
          renderedAgentSceneState.set(key, {
            roomId: motionState.roomId,
            slotId: motionState.slotId || null,
            mirrored: typeof motionState.mirrored === "boolean" ? motionState.mirrored : null,
            avatarX: Number.isFinite(motionState.targetX) ? motionState.targetX : motionState.currentX,
            avatarY: Number.isFinite(motionState.targetY) ? motionState.targetY : motionState.currentY,
            avatarWidth: motionState.width,
            avatarHeight: motionState.height
          });
        });

        applyOfficeRendererFocus(renderer);
      }

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
          recentActivitySceneToken(snapshot),
          officeSceneInteractionToken(snapshot),
          options.compact ? "compact" : "wide",
          options.focusMode ? "focus" : "normal",
          options.liveOnly ? "live" : "all"
        ].join("::");
      }

      async function syncOfficeMapScenes(projects) {
  cleanupOfficeRenderers();
  const hostNodes = Array.from(document.querySelectorAll("[data-office-map-host]"));
  for (const host of hostNodes) {
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
        syncOfficeRendererScene(renderer, model);
        renderer.sceneRenderToken = renderToken;
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
          tileObjects: model.tileObjects.length,
          desks: model.desks.length,
          offices: model.offices.length,
          recAgents: model.recAgents.length
        }
      });
    }
  }
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

      function canPlaceFurniture(model, movingItem, nextColumn) {
        const room = model.rooms.find((entry) => entry.id === movingItem.roomId);
        if (!room) {
          return false;
        }
        const roomWidthTiles = Math.round(room.width / model.tile);
        if (nextColumn < 0 || nextColumn + movingItem.widthTiles > roomWidthTiles) {
          return false;
        }
        return !model.furniture.some((item) =>
          item.id !== movingItem.id
          && item.roomId === movingItem.roomId
          && rectanglesOverlap({ ...movingItem, column: nextColumn }, item)
        );
      }

      function handleFurnitureDragMove(event) {
        if (!furnitureDragState) {
          return;
        }
        const renderer = furnitureDragState.renderer;
        if (!renderer || !renderer.model) {
          return;
        }
        const pointerX = event.clientX - furnitureDragState.hostRect.left - (renderer.leftOffset || 0);
        const nextColumn = Math.round(pointerX / (renderer.scale * renderer.model.tile) - furnitureDragState.pointerOffsetTiles);
        if (!Number.isFinite(nextColumn) || nextColumn === furnitureDragState.currentColumn) {
          return;
        }
        if (!canPlaceFurniture(renderer.model, furnitureDragState.item, nextColumn)) {
          return;
        }
        furnitureDragState.currentColumn = nextColumn;
        setFurnitureColumnOverride(furnitureDragState.projectRoot, furnitureDragState.item.roomId, furnitureDragState.item.id, nextColumn);
        render();
      }

      function stopFurnitureDrag() {
        if (!furnitureDragState) {
          return;
        }
        window.removeEventListener("pointermove", handleFurnitureDragMove);
        window.removeEventListener("pointerup", stopFurnitureDrag);
        window.removeEventListener("pointercancel", stopFurnitureDrag);
        furnitureDragState = null;
      }

      function renderFleetTerminal(fleet) {
        const lines = ["$ codex-agents-office fleet", ""];
        for (const snapshot of fleet.projects) {
          const counts = countsForSnapshot(snapshot);
          lines.push(\`PROJECT \${projectLabel(snapshot.projectRoot)}\`);
          lines.push(\`  total=\${counts.total} active=\${counts.active} waiting=\${counts.waiting} blocked=\${counts.blocked} cloud=\${counts.cloud}\`);
          if (snapshot.notes.length > 0) {
            for (const note of snapshot.notes) {
              lines.push(\`  ! \${note}\`);
            }
          }
          lines.push("");
        }

        return \`<div class="terminal-shell">\${lines.map((line) => {
          const className = line.startsWith("$ ") ? "terminal-hot"
            : line.startsWith("  ! ") ? "terminal-warn"
            : /^[A-Z]/.test(line) ? "terminal-dim"
            : "";
          return \`<div class="\${className}">\${escapeHtml(line)}</div>\`;
        }).join("")}</div>\`;
      }

      function agentsNeedingUser(projects) {
        return projects.flatMap((snapshot) =>
          snapshot.agents
            .filter((agent) => agent.needsUser)
            .map((agent) => ({ snapshot, agent }))
        ).sort((left, right) => right.agent.updatedAt.localeCompare(left.agent.updatedAt));
      }

      function needsUserActionProjectRoot(snapshot, agent) {
        if (!snapshot || !agent || !agent.needsUser) {
          return null;
        }
        const isLocalCodex = !agent.network && agent.provenance === "codex" && agent.source === "local";
        const isTypedClaude = !agent.network && agent.provenance === "claude" && agent.confidence === "typed" && agent.source === "claude";
        if (!isLocalCodex && !isTypedClaude) {
          return null;
        }
        const preferredRoot = typeof agent.sourceProjectRoot === "string" && agent.sourceProjectRoot.length > 0
          ? agent.sourceProjectRoot
          : snapshot.projectRoot;
        const localRoots = localProjectRootsForSnapshot(snapshot);
        if (localRoots.includes(preferredRoot)) {
          return preferredRoot;
        }
        return localRoots[0] || preferredRoot;
      }

      function approvalDecisionEntries(need) {
        const supported = ["accept", "acceptForSession", "decline", "cancel"];
        const available = Array.isArray(need && need.availableDecisions)
          ? need.availableDecisions.filter((decision) => supported.includes(decision))
          : [];
        const selected = available.length > 0 ? available : ["accept", "decline", "cancel"];
        return selected.map((decision) => ({
          decision,
          label:
            decision === "accept" ? "Accept"
            : decision === "acceptForSession" ? "Always for session"
            : decision === "decline" ? "Decline"
            : "Cancel"
        }));
      }

      function needsUserActionError(requestId) {
        const errors = state.needsUserActionErrorsByRequestId;
        if (!errors || typeof errors !== "object") {
          return "";
        }
        const value = errors[requestId];
        return typeof value === "string" ? value : "";
      }

      function needsUserInputDraft(requestId, questionId) {
        const drafts = state.needsUserInputDrafts;
        if (!drafts || typeof drafts !== "object") {
          return { selected: "", other: "" };
        }
        const requestDraft = drafts[requestId];
        if (!requestDraft || typeof requestDraft !== "object") {
          return { selected: "", other: "" };
        }
        const questionDraft = requestDraft[questionId];
        if (!questionDraft || typeof questionDraft !== "object") {
          return { selected: "", other: "" };
        }
        return {
          selected: typeof questionDraft.selected === "string" ? questionDraft.selected : "",
          other: typeof questionDraft.other === "string" ? questionDraft.other : ""
        };
      }

      function needsUserInputAnswerValues(question, draft) {
        const options = Array.isArray(question && question.options) ? question.options : [];
        const selected = String(draft && draft.selected || "").trim();
        const other = String(draft && draft.other || "").trim();
        if (options.length === 0) {
          return other ? [other] : [];
        }
        if (!selected) {
          return [];
        }
        if (selected === "__other__") {
          return other ? [other] : [];
        }
        return [selected];
      }

      function needsUserInputQuestionLabel(question, questionIndex = 0) {
        const header = typeof (question && question.header) === "string" ? question.header.trim() : "";
        return header || "Question " + (questionIndex + 1);
      }

      function needsUserInputCompletion(need) {
        const questions = Array.isArray(need && need.questions) ? need.questions : [];
        let answered = 0;
        let requiredAnswered = 0;
        let requiredTotal = 0;
        const missingRequired = [];
        questions.forEach((question, questionIndex) => {
          const hasAnswer = needsUserInputAnswerValues(
            question,
            needsUserInputDraft(need.requestId, question.id)
          ).length > 0;
          if (hasAnswer) {
            answered += 1;
          }
          if (question.required === false) {
            return;
          }
          requiredTotal += 1;
          if (hasAnswer) {
            requiredAnswered += 1;
            return;
          }
          missingRequired.push(needsUserInputQuestionLabel(question, questionIndex));
        });
        return {
          total: questions.length,
          answered,
          requiredTotal,
          requiredAnswered,
          missingRequired
        };
      }

      function needsUserInputReady(need) {
        const completion = needsUserInputCompletion(need);
        if (completion.total === 0) {
          return false;
        }
        return completion.missingRequired.length === 0;
      }

      function needsUserInputSummary(need) {
        const completion = needsUserInputCompletion(need);
        if (completion.total === 0) {
          return "";
        }
        if (completion.requiredTotal > 0) {
          return completion.requiredAnswered + "/" + completion.requiredTotal + " required answered"
            + (completion.total > completion.requiredTotal
              ? " · " + completion.answered + "/" + completion.total + " total answered"
              : "");
        }
        return completion.answered + "/" + completion.total + " optional answered";
      }

      function needsUserInputPendingHint(need) {
        const completion = needsUserInputCompletion(need);
        if (completion.missingRequired.length === 0) {
          return completion.requiredTotal > 0
            ? "All required questions are answered."
            : "Optional answers can be left blank.";
        }
        if (completion.missingRequired.length === 1) {
          return "Still needed: " + completion.missingRequired[0];
        }
        return completion.missingRequired.length + " required questions still need answers.";
      }

      function needsUserInputSubmitLabel(need, isPending) {
        if (isPending) {
          return "Sending...";
        }
        const completion = needsUserInputCompletion(need);
        if (completion.missingRequired.length === 0) {
          return "Send";
        }
        return "Complete " + completion.missingRequired.length + " required "
          + (completion.missingRequired.length === 1 ? "question" : "questions");
      }

      function renderNeedsUserInputQuestion(requestId, question, questionIndex, isPending) {
        const options = Array.isArray(question && question.options) ? question.options : [];
        const draft = needsUserInputDraft(requestId, question.id);
        const selected = String(draft.selected || "");
        const showOther = options.length === 0 || selected === "__other__";
        const questionLabel = needsUserInputQuestionLabel(question, questionIndex);
        const requirementLabel = question.required === false ? "Optional" : "Required";
        const helperLabel = options.length > 0
          ? (question.isOther === true ? "Choose one option or use Other." : "Choose one option.")
          : (question.isSecret === true ? "Enter one value." : "Type your answer.");
        const hasDraftValue = Boolean(selected || String(draft.other || "").trim());
        const selectorBase = \`data-needs-user-request-id="\${escapeHtml(requestId)}" data-needs-user-question-id="\${escapeHtml(question.id)}"\`;
        const optionButtons = options.length > 0
          ? \`<div class="needs-you-options">\${options.map((option) => {
              const isSelected = selected === option.label;
              return \`<button type="button" class="needs-you-option\${isSelected ? " is-selected" : ""}" data-action="select-needs-user-option" \${selectorBase} data-answer="\${escapeHtml(option.label)}" title="\${escapeHtml(option.description || option.label)}"\${isPending ? " disabled" : ""}>\${escapeHtml(option.label)}</button>\`;
            }).join("")}\${question.isOther === true
              ? \`<button type="button" class="needs-you-option\${selected === "__other__" ? " is-selected" : ""}" data-action="select-needs-user-option" \${selectorBase} data-answer="__other__"\${isPending ? " disabled" : ""}>Other</button>\`
              : ""}</div>\`
          : "";
        const otherField = showOther
          ? (question.isSecret === true
            ? \`<input class="needs-you-field" type="password" \${selectorBase} data-needs-user-text="true" placeholder="Type your answer..."\${isPending ? " disabled" : ""} value="\${escapeHtml(draft.other || "")}" />\`
            : \`<textarea class="needs-you-field" rows="2" \${selectorBase} data-needs-user-text="true" placeholder="Type your answer..."\${isPending ? " disabled" : ""}>\${escapeHtml(draft.other || "")}</textarea>\`)
          : "";
        const clearButton = hasDraftValue
          ? \`<div class="needs-you-question-actions"><button type="button" data-action="clear-needs-user-answer" \${selectorBase}\${isPending ? " disabled" : ""}>Clear</button></div>\`
          : "";
        return \`<div class="needs-you-question"><div class="needs-you-question-head"><strong>\${escapeHtml(questionLabel)}</strong><span>\${escapeHtml(requirementLabel)}</span></div><div class="needs-you-question-text">\${escapeHtml(question.question || questionLabel)}</div><div class="needs-you-question-help">\${escapeHtml(helperLabel)}</div>\${optionButtons}\${otherField}\${clearButton}</div>\`;
      }

      function renderNeedsAttention(projects) {
        const entries = agentsNeedingUser(projects);
        if (entries.length === 0) {
          return "";
        }

        const pendingRequestIds = new Set(Array.isArray(state.needsUserActionRequestIds) ? state.needsUserActionRequestIds : []);

        return \`<section class="session-card needs-you-panel"><div class="needs-you-panel-head"><strong>Needs You</strong><span>\${escapeHtml(String(entries.length))}</span></div><div class="needs-you-list">\${entries.map(({ snapshot, agent }) => {
          const need = agent.needsUser;
          const scope = normalizeDisplayText(snapshot.projectRoot, need?.command || need?.reason || need?.grantRoot || agent.detail);
          const actionProjectRoot = needsUserActionProjectRoot(snapshot, agent);
          const canActOnApproval = Boolean(
            actionProjectRoot
            && need
            && need.kind === "approval"
            && typeof need.requestId === "string"
            && need.requestId.length > 0
          );
          const canActOnInput = Boolean(
            actionProjectRoot
            && need
            && need.kind === "input"
            && typeof need.requestId === "string"
            && need.requestId.length > 0
            && Array.isArray(need.questions)
            && need.questions.length > 0
          );
          const replyProjectRoot = replyActionProjectRoot(snapshot, agent);
          const canReplyToInput = Boolean(
            need
            && need.kind === "input"
            && (!Array.isArray(need.questions) || need.questions.length === 0)
            && replyProjectRoot
            && agent.threadId
          );
          const isPending = Boolean(need && pendingRequestIds.has(need.requestId));
          const requestError = need ? needsUserActionError(need.requestId) : "";
          const errorHtml = requestError
            ? \`<div class="chat-composer-error">\${escapeHtml(requestError)}</div>\`
            : "";
          const actionsHtml = canActOnApproval
            ? \`<div class="needs-you-actions">\${approvalDecisionEntries(need).map(({ decision, label }) =>
              \`<button type="button" data-action="respond-needs-user" data-project-root="\${escapeHtml(actionProjectRoot)}" data-request-id="\${escapeHtml(need.requestId)}" data-decision="\${escapeHtml(decision)}"\${isPending ? " disabled" : ""}>\${escapeHtml(isPending ? "Sending..." : label)}</button>\`
            ).join("")}</div>\${errorHtml}\`
            : canActOnInput
              ? \`<div class="needs-you-form"><div class="needs-you-summary">\${escapeHtml(needsUserInputSummary(need))}</div>\${need.questions.map((question, questionIndex) =>
                renderNeedsUserInputQuestion(need.requestId, question, questionIndex, isPending)
              ).join("")}<div class="needs-you-submit-row"><div class="needs-you-submit-hint">\${escapeHtml(needsUserInputPendingHint(need))}</div><button type="button" class="primary-action" data-action="submit-needs-user-input" data-project-root="\${escapeHtml(actionProjectRoot)}" data-request-id="\${escapeHtml(need.requestId)}"\${isPending || !needsUserInputReady(need) ? " disabled" : ""}>\${escapeHtml(needsUserInputSubmitLabel(need, isPending))}</button></div>\${errorHtml}</div>\`
            : canReplyToInput
              ? \`<div class="needs-you-form"><div class="needs-you-actions"><button type="button" data-action="open-reply-composer" data-project-root="\${escapeHtml(replyProjectRoot)}" data-thread-id="\${escapeHtml(agent.threadId)}">\${escapeHtml(replyComposerMatchesThread(replyProjectRoot, agent.threadId) ? "Editing reply..." : "Reply")}</button></div>\${renderReplyComposerForThread(replyProjectRoot, agent.threadId, "Reply to this input...")}\${need?.kind === "input" && agent.resumeCommand ? \`<div class="needs-you-fallback">Terminal fallback: <code>\${escapeHtml(agent.resumeCommand)}</code></div>\` : ""}\${errorHtml}</div>\`
            : (need?.kind === "input" && agent.resumeCommand
              ? \`<div class="needs-you-fallback">Reply in Codex: <code>\${escapeHtml(agent.resumeCommand)}</code></div>\`
              : "");
          return \`<article class="needs-you-item" data-needs-user-project-root="\${escapeHtml(actionProjectRoot || "")}"><div class="needs-you-item-meta"><span>\${escapeHtml(projectLabel(snapshot.projectRoot))}</span><span>\${escapeHtml(agent.label)}</span><span>\${escapeHtml(need?.kind || "input")}</span></div><div class="needs-you-item-scope">\${escapeHtml(scope)}</div>\${actionsHtml}</article>\`;
        }).join("")}</div></section>\`;
      }`;
