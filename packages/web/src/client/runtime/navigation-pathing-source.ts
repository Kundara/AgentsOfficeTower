export const CLIENT_RUNTIME_NAVIGATION_PATHING_SOURCE = `function officeAvatarPositionForTile(room, tileSize, tilePoint, width, height) {
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
        pathfinder.enableDiagonals();
        pathfinder.disableCornerCutting();
        pathfinder.enableSync();
        let result = null;
        pathfinder.findPath(startTile.column, startTile.row, endTile.column, endTile.row, (path) => {
          result = Array.isArray(path) ? path : null;
        });
        pathfinder.calculate();
        return result;
      }

      function dedupeRoutePoints(points) {
        return (Array.isArray(points) ? points : []).filter((point, index, route) => {
          if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
            return false;
          }
          const previous = route[index - 1];
          return !previous || previous.x !== point.x || previous.y !== point.y;
        });
      }

      function buildAgentPixelRoute(nav, startTile, endTile, room, tileSize, width, height, exactTarget, exactStart = null) {
        if (!nav || !startTile || !endTile || !room) {
          return exactStart ? [exactStart] : [];
        }
        const tilePath = solveEasyStarPath(nav, startTile, endTile);
        if (!Array.isArray(tilePath) || tilePath.length === 0) {
          return exactStart
            ? [{ x: exactStart.x, y: exactStart.y }]
            : [officeAvatarPositionForTile(room, tileSize, startTile, width, height)];
        }
        const route = tilePath.map((step) =>
          officeAvatarPositionForTile(room, tileSize, { column: step.x ?? step.column, row: step.y ?? step.row }, width, height)
        );
        if (exactStart && Number.isFinite(exactStart.x) && Number.isFinite(exactStart.y)) {
          const exactStartTile = officeAvatarFootTile(room, tileSize, exactStart.x, exactStart.y, width, height);
          if (
            exactStartTile
            && exactStartTile.column === startTile.column
            && exactStartTile.row === startTile.row
          ) {
            route[0] = { x: exactStart.x, y: exactStart.y };
          } else {
            route.unshift({ x: exactStart.x, y: exactStart.y });
          }
        }
        if (exactTarget) {
          const last = route[route.length - 1];
          if (!last || last.x !== exactTarget.x || last.y !== exactTarget.y) {
            route.push({ x: exactTarget.x, y: exactTarget.y });
          }
        }
        return dedupeRoutePoints(route);
      }

      function syncAgentHitNodePosition(renderer, motionState) {
        if (!renderer || !motionState || !motionState.anchorNode) {
          return;
        }
        motionState.anchorNode.style.left = Math.round(motionState.currentX * renderer.scale) + "px";
        motionState.anchorNode.style.top = Math.round(motionState.currentY * renderer.scale) + "px";
        motionState.anchorNode.style.width = Math.max(8, Math.round(motionState.width * renderer.scale)) + "px";
        motionState.anchorNode.style.height = Math.max(8, Math.round(motionState.height * renderer.scale)) + "px";
        if (officeMapHoverTarget === motionState.anchorNode) {
          scheduleOfficeMapHoverPosition();
        }
      }
`;
