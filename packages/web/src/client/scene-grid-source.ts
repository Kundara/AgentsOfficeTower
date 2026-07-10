export const SCENE_GRID_SCRIPT = `
      function sceneTileSize(compact) {
        return compact ? internalSceneSettings.compactTileSizePx : internalSceneSettings.tileSizePx;
      }

      function gridUnitsToPixels(tileSize, units) {
        return Math.round(Number(tileSize) * Number(units));
      }

      function fixedSceneLayoutConfig(compact) {
        const tileSize = sceneTileSize(compact);
        const floorGridStartY = gridUnitsToPixels(tileSize, internalSceneSettings.wallDepthTiles);
        const floorGridRowOffset = gridUnitsToPixels(tileSize, 1);
        return {
          tileSize,
          deskStartRatio: internalSceneSettings.deskAreaStartRatio,
          deskColumnGapTiles: internalSceneSettings.deskColumnGapTiles,
          deskColumnGap: gridUnitsToPixels(tileSize, internalSceneSettings.deskColumnGapTiles),
          deskRowGap: 0,
          deskCubicleGapTiles: internalSceneSettings.deskGroupGapTiles,
          deskCubicleGap: gridUnitsToPixels(tileSize, internalSceneSettings.deskGroupGapTiles),
          cubiclesPerColumn: 1,
          cubicleRows: internalSceneSettings.deskRowsPerColumn,
          deskTopRow: internalSceneSettings.wallDepthTiles,
          deskTopY: gridUnitsToPixels(tileSize, internalSceneSettings.wallDepthTiles),
          podWidthTiles: internalSceneSettings.deskPodWidthTiles,
          podWidth: gridUnitsToPixels(tileSize, internalSceneSettings.deskPodWidthTiles),
          podHeightTiles: internalSceneSettings.deskPodHeightTiles,
          podHeight: gridUnitsToPixels(tileSize, internalSceneSettings.deskPodHeightTiles),
          bossLaneX: gridUnitsToPixels(tileSize, internalSceneSettings.bossLaneStartTiles),
          bossLaneWidth: gridUnitsToPixels(tileSize, internalSceneSettings.bossLaneWidthTiles),
          bossOfficeGapToDesk: gridUnitsToPixels(tileSize, internalSceneSettings.bossGapToDeskTiles),
          bossOfficeTopRow: internalSceneSettings.wallDepthTiles + internalSceneSettings.bossOfficeTopInsetTiles,
          bossOfficeTopY: gridUnitsToPixels(
            tileSize,
            internalSceneSettings.wallDepthTiles + internalSceneSettings.bossOfficeTopInsetTiles
          ),
          bossOfficeGapY: gridUnitsToPixels(tileSize, internalSceneSettings.bossBoothGapTiles),
          bossOfficeWidthTiles: internalSceneSettings.bossBoothWidthTiles,
          bossOfficeWidth: gridUnitsToPixels(tileSize, internalSceneSettings.bossBoothWidthTiles),
          bossOfficeHeightTiles: internalSceneSettings.bossBoothHeightTiles,
          bossOfficeHeight: gridUnitsToPixels(tileSize, internalSceneSettings.bossBoothHeightTiles),
          deskPodCapacity: internalSceneSettings.deskPodCapacity,
          recAreaFurnitureTopY: gridUnitsToPixels(tileSize, internalSceneSettings.recAreaFurnitureRow),
          recAreaWalkwayY: gridUnitsToPixels(tileSize, internalSceneSettings.recAreaWalkwayRow),
          recAreaMaxDepthPx: gridUnitsToPixels(tileSize, internalSceneSettings.recAreaMaxDepthTiles),
          recAreaGridTopY: floorGridStartY + gridUnitsToPixels(tileSize, internalSceneSettings.recAreaFurnitureRow) - floorGridRowOffset,
          recAreaWalkwayGridY: floorGridStartY + gridUnitsToPixels(tileSize, internalSceneSettings.recAreaWalkwayRow) - floorGridRowOffset
        };
      }

      function buildSceneTileObject(id, roomId, sprite, column, baseRow, widthTiles, heightTiles, z, options = {}) {
        return {
          id,
          roomId,
          furnitureId: options.furnitureId || null,
          furniture: options.furniture === true,
          sprite: sprite.url,
          spriteWidth: sprite.w,
          spriteHeight: sprite.h,
          column,
          baseRow,
          widthTiles,
          heightTiles,
          preserveAspect: options.preserveAspect !== false,
          anchor: options.anchor || "floor",
          flipX: options.flipX === true,
          z
        };
      }

      function buildBossOfficeSlots(config, count) {
        return Array.from({ length: count }, (_, index) => ({
          id: \`office-\${index}\`,
          kind: "office",
          order: index,
          x: config.bossLaneX,
          y: config.bossOfficeTopY + index * (config.bossOfficeHeight + config.bossOfficeGapY),
          width: config.bossOfficeWidth,
          height: config.bossOfficeHeight
        }));
      }

      function buildDeskSlots(config, roomPixelWidth, podCount, hasBossLane) {
        const slotsPerColumn = config.cubiclesPerColumn * config.cubicleRows;
        const columnCount = Math.max(1, Math.ceil(Math.max(1, podCount) / slotsPerColumn));
        const deskStartColumn = Math.max(
          Math.round((roomPixelWidth * config.deskStartRatio) / config.tileSize),
          hasBossLane
            ? Math.ceil((config.bossLaneX + config.bossLaneWidth + config.bossOfficeGapToDesk) / config.tileSize)
            : 0
        );
        const deskStartX = deskStartColumn * config.tileSize;
        const slots = [];
        for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
          const columnX = deskStartX + columnIndex * (config.podWidth + config.deskColumnGap);
          for (let cubicleIndex = 0; cubicleIndex < config.cubiclesPerColumn; cubicleIndex += 1) {
            const cubicleBaseY = config.deskTopY
              + cubicleIndex * (config.cubicleRows * config.podHeight + (config.cubicleRows - 1) * config.deskRowGap + config.deskCubicleGap);
            for (let rowIndex = 0; rowIndex < config.cubicleRows; rowIndex += 1) {
              slots.push({
                id: \`pod-\${columnIndex}-\${cubicleIndex}-\${rowIndex}\`,
                kind: "desk",
                capacity: config.deskPodCapacity,
                order: columnIndex * slotsPerColumn + cubicleIndex * config.cubicleRows + rowIndex,
                columnIndex,
                cubicleIndex,
                rowIndex,
                cubicleId: \`cubicle-\${columnIndex}-\${cubicleIndex}\`,
                x: columnX,
                y: cubicleBaseY + rowIndex * (config.podHeight + config.deskRowGap),
                width: config.podWidth,
                height: config.podHeight
              });
            }
          }
        }
        return slots;
      }

      function deskSlotStartColumn(config, roomPixelWidth, hasBossLane) {
        return Math.max(
          Math.round((roomPixelWidth * config.deskStartRatio) / config.tileSize),
          hasBossLane
            ? Math.ceil((config.bossLaneX + config.bossLaneWidth + config.bossOfficeGapToDesk) / config.tileSize)
            : 0
        );
      }

      const DESK_GROUP_MAX_TOUCHING_PODS = 6;
      const DESK_GROUP_PASSAGE_TILES = 1;

      function deskFamilyLeadId(snapshot, agent) {
        const agentsById = new Map(snapshot.agents.map((entry) => [entry.id, entry]));
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
        return familyAgent.parentThreadId || familyAgent.id || agent.parentThreadId || agent.id;
      }

      function buildDeskAgentGroups(snapshot, agents, podCapacity) {
        const capacity = Math.max(1, Number(podCapacity) || 1);
        const sorted = [...agents].sort((left, right) => compareAgentsForDeskLayout(snapshot, left, right));
        const groups = [];
        const groupsByParent = new Map();
        sorted.forEach((agent) => {
          if (agent.parentThreadId) {
            const parentKey = "boss" + stableHash(String(deskFamilyLeadId(snapshot, agent)));
            let group = groupsByParent.get(parentKey);
            if (!group) {
              group = { key: parentKey, agents: [] };
              groupsByParent.set(parentKey, group);
              groups.push(group);
            }
            group.agents.push(agent);
            return;
          }
          const last = groups.length > 0 ? groups[groups.length - 1] : null;
          if (last && last.solo === true && last.agents.length < capacity) {
            last.agents.push(agent);
            return;
          }
          groups.push({ key: "solo" + stableHash(String(agent.id)), solo: true, agents: [agent] });
        });
        return groups;
      }

      function deskGroupPodCounts(snapshot, groups, podCapacity) {
        const capacity = Math.max(1, Number(podCapacity) || 1);
        return groups.map((group) => ({
          key: group.key,
          podCount: Math.max(
            1,
            Math.ceil(group.agents.length / capacity),
            ...group.agents.map((agent) => {
              const previousSlotId = previousSceneSlotId(snapshot, agent);
              const prefix = "pod-" + group.key + "-";
              if (!previousSlotId || !previousSlotId.startsWith(prefix)) return 0;
              const previousIndex = Number(previousSlotId.slice(prefix.length));
              return Number.isInteger(previousIndex) && previousIndex >= 0 ? previousIndex + 1 : 0;
            })
          )
        }));
      }

      function assignGroupedDeskAgents(snapshot, groups, slots, podCapacity) {
        const capacity = Math.max(1, Number(podCapacity) || 1);
        const slotsByGroup = new Map();
        slots.forEach((slot) => {
          const groupSlots = slotsByGroup.get(slot.groupKey) || [];
          groupSlots.push(slot);
          slotsByGroup.set(slot.groupKey, groupSlots);
        });
        const assignments = [];
        groups.forEach((group) => {
          const groupSlots = (slotsByGroup.get(group.key) || []).sort((left, right) => left.order - right.order);
          const slotById = new Map(groupSlots.map((slot) => [slot.id, slot]));
          const slotAgents = new Map();
          const remaining = [];
          group.agents.forEach((agent) => {
            const previousSlot = slotById.get(previousSceneSlotId(snapshot, agent));
            const assigned = previousSlot ? slotAgents.get(previousSlot.id) || [] : [];
            if (!previousSlot || assigned.length >= capacity) {
              remaining.push(agent);
              return;
            }
            assigned.push(agent);
            slotAgents.set(previousSlot.id, assigned);
          });
          remaining.forEach((agent) => {
            const slot = groupSlots.find((candidate) => (slotAgents.get(candidate.id) || []).length < capacity);
            if (!slot) return;
            const assigned = slotAgents.get(slot.id) || [];
            assigned.push(agent);
            slotAgents.set(slot.id, assigned);
          });
          groupSlots.forEach((slot) => {
            const assigned = slotAgents.get(slot.id) || [];
            if (assigned.length === 0) return;
            assignments.push({
              slot,
              agents: assigned.sort((left, right) => {
                const leftMirrored = previousSceneMirrored(snapshot, left);
                const rightMirrored = previousSceneMirrored(snapshot, right);
                if (leftMirrored !== rightMirrored) {
                  if (leftMirrored === null) return 1;
                  if (rightMirrored === null) return -1;
                  return Number(leftMirrored) - Number(rightMirrored);
                }
                return compareAgentsForDeskLayout(snapshot, left, right);
              })
            });
          });
        });
        return assignments.sort((left, right) => left.slot.order - right.slot.order);
      }

      function buildGroupedDeskSlots(config, roomPixelWidth, groups, maxContentRowTiles, hasBossLane) {
        const podRows = config.podHeightTiles;
        const columnRows = Math.max(podRows, Number(maxContentRowTiles) || podRows);
        const deskStartX = deskSlotStartColumn(config, roomPixelWidth, hasBossLane === true) * config.tileSize;
        const slots = [];
        let column = 0;
        let rowCursor = 0;
        let touchingRun = 0;
        let order = 0;
        groups.forEach((group) => {
          if (rowCursor > 0) {
            rowCursor += DESK_GROUP_PASSAGE_TILES;
            touchingRun = 0;
          }
          for (let podIndex = 0; podIndex < group.podCount; podIndex += 1) {
            if (touchingRun >= DESK_GROUP_MAX_TOUCHING_PODS) {
              rowCursor += DESK_GROUP_PASSAGE_TILES;
              touchingRun = 0;
            }
            if (rowCursor + podRows > columnRows) {
              column += 1;
              rowCursor = 0;
              touchingRun = 0;
            }
            slots.push({
              id: \`pod-\${group.key}-\${podIndex}\`,
              kind: "desk",
              capacity: config.deskPodCapacity,
              order,
              groupKey: group.key,
              cubicleId: \`cubicle-\${group.key}\`,
              x: deskStartX + column * (config.podWidth + config.deskColumnGap),
              y: config.deskTopY + rowCursor * config.tileSize,
              width: config.podWidth,
              height: podRows * config.tileSize
            });
            order += 1;
            rowCursor += podRows;
            touchingRun += 1;
          }
        });
        return slots;
      }

      function groupedDeskRowsDemand(config, groups) {
        const podRows = config.podHeightTiles;
        let rows = 0;
        let touchingRun = 0;
        groups.forEach((group) => {
          if (rows > 0) {
            rows += DESK_GROUP_PASSAGE_TILES;
            touchingRun = 0;
          }
          for (let podIndex = 0; podIndex < group.podCount; podIndex += 1) {
            if (touchingRun >= DESK_GROUP_MAX_TOUCHING_PODS) {
              rows += DESK_GROUP_PASSAGE_TILES;
              touchingRun = 0;
            }
            rows += podRows;
            touchingRun += 1;
          }
        });
        return rows;
      }

      function compileTileObject(model, roomById, object) {
        const room = roomById.get(object.roomId);
        if (!room) {
          return null;
        }
        const spriteWidth = Number(object.spriteWidth) || model.tile;
        const spriteHeight = Number(object.spriteHeight) || model.tile;
        const tileWidth = Math.max(1, Math.ceil(spriteWidth / model.tile));
        const tileHeight = Math.max(1, Math.ceil(spriteHeight / model.tile));
        const footprintX = room.x + object.column * model.tile;
        const footprintWidth = tileWidth * model.tile;
        const bottomY = object.anchor === "wall"
          ? room.floorTop + object.baseRow * model.tile
          : room.floorTop + (object.baseRow + 1) * model.tile;
        const width = spriteWidth;
        const height = spriteHeight;
        const x = footprintX + Math.floor((footprintWidth - width) / 2);
        const y = bottomY - height;
        return {
          id: object.id,
          sprite: object.sprite,
          x,
          y,
          width,
          height,
          tileWidth,
          tileHeight,
          flipX: object.flipX === true,
          z: object.z || 5
        };
      }
`;
