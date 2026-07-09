export const CLIENT_RUNTIME_CAFE_SCENE_SOURCE = `
      function buildCafeTableVisualModel(snapshot, agent, x, y, boothWidth, boothHeight, compact, options = {}) {
        const sceneTile = sceneTileSize(compact);
        const state = agent?.state || "idle";
        const mirrored = options.mirrored === true;
        const cafe = pixelOffice.cafe;
        const table = cafe.table;
        const chairOptions = [cafe.chairRed, cafe.chairBlue, cafe.chairGreen].filter(Boolean);
        const chair = chairOptions[stableHash(agent?.id || options.slotId || "cafe") % chairOptions.length];
        const computer = computerSpriteForAgent(agent, mirrored);
        const avatarSize = agent ? avatarVisualSizeForAgent(agent, compact ? 1.22 : 1.42) : null;
        const tableScale = compact ? 0.72 : 0.86;
        const chairScale = compact ? 1.12 : 1.28;
        const computerScale = compact ? 1.02 : 1.18;
        const tableWidth = Math.round(table.w * tableScale);
        const tableHeight = Math.round(table.h * tableScale);
        const chairWidth = Math.round(chair.w * chairScale);
        const chairHeight = Math.round(chair.h * chairScale);
        const computerWidth = Math.round(computer.w * computerScale);
        const computerHeight = Math.round(computer.h * computerScale);
        const tableX = Math.round((boothWidth - tableWidth) / 2);
        const tableY = Math.max(1, Math.round(boothHeight - tableHeight - (compact ? 5 : 7)));
        const chairX = mirrored
          ? Math.min(boothWidth - chairWidth, tableX + tableWidth - Math.round(chairWidth * 0.25))
          : Math.max(0, tableX - Math.round(chairWidth * 0.75));
        const chairY = Math.round(tableY + tableHeight * 0.52);
        const computerX = Math.round(tableX + (mirrored ? tableWidth * 0.23 : tableWidth * 0.56) - computerWidth / 2);
        const computerY = Math.round(tableY + tableHeight * 0.26 - computerHeight * 0.48);
        const absoluteCellX = Math.round(options.absoluteX ?? x);
        const absoluteCellY = Math.round(options.absoluteY ?? y);
        const depthBaseY = Number.isFinite(options.depthBaseY) ? Number(options.depthBaseY) : 0;
        const tableFootY = absoluteCellY + tableY + tableHeight;
        const chairFootY = absoluteCellY + chairY + chairHeight;
        const tableDepthRow = Math.floor((tableFootY - depthBaseY) / sceneTile);
        const chairDepthRow = Math.floor((chairFootY - depthBaseY) / sceneTile);
        const avatarWidth = avatarSize ? avatarSize.width : 0;
        const avatarHeight = avatarSize ? avatarSize.height : 0;
        const avatarX = mirrored
          ? absoluteCellX + Math.min(boothWidth - avatarWidth, chairX + Math.round(chairWidth * 0.32))
          : absoluteCellX + Math.max(0, chairX + Math.round(chairWidth * 0.18));
        const avatarY = absoluteCellY + Math.max(0, chairY + chairHeight - avatarHeight + (compact ? 2 : 3));
        const shell = [
          buildPixiSpriteDef(table, absoluteCellX + tableX, absoluteCellY + tableY, tableScale, 7, {
            enteringReveal: options.enteringReveal === true,
            depthBaseY: options.depthBaseY,
            depthRow: tableDepthRow,
            depthFootY: tableFootY,
            depthBias: 160
          }),
          buildPixiSpriteDef(chair, absoluteCellX + chairX, absoluteCellY + chairY, chairScale, 8, {
            flipX: mirrored,
            enteringReveal: options.enteringReveal === true,
            depthBaseY: options.depthBaseY,
            depthRow: chairDepthRow,
            depthFootY: chairFootY,
            depthBias: 190
          }),
          buildPixiSpriteDef(computer, absoluteCellX + computerX, absoluteCellY + computerY, computerScale, 9, {
            flipX: mirrored,
            enteringReveal: options.enteringReveal === true,
            depthBaseY: options.depthBaseY,
            depthRow: tableDepthRow,
            depthFootY: tableFootY,
            depthBias: 620
          })
        ];
        return {
          shell,
          glow: agent && isBusyAgent(agent) && state !== "waiting" && state !== "blocked"
            ? {
                x: absoluteCellX + computerX + Math.round(computerWidth * 0.2),
                y: absoluteCellY + computerY + 2,
                width: Math.max(7, Math.round(computerWidth * 0.55)),
                height: 4,
                color: state === "validating" ? 0x69c7ff : 0x4bd69f,
                alpha: 0.28,
                pulse: state === "validating",
                enteringReveal: options.enteringReveal === true
              }
            : null,
          avatar: avatarSize
            ? {
                sprite: avatarSize.avatar.url,
                x: avatarX,
                y: avatarY,
                width: Math.round(avatarWidth),
                height: Math.round(avatarHeight),
                flipX: mirrored,
                depthBaseY: Number.isFinite(options.depthBaseY) ? Math.round(options.depthBaseY) : null,
                depthRow: tableDepthRow,
                depthFootY: tableFootY,
                depthBias: 760,
                pivotX: avatarX + Math.round(avatarWidth / 2),
                pivotY: tableFootY,
                state,
                appearance: agent.appearance
              }
            : null,
          workstationBounds: {
            x: absoluteCellX + tableX,
            y: absoluteCellY + tableY,
            width: tableWidth,
            height: tableHeight,
            tileWidth: Math.max(2, Math.ceil(tableWidth / sceneTile)),
            tileHeight: Math.max(2, Math.ceil(tableHeight / sceneTile)),
            pivotX: absoluteCellX + tableX + Math.round(tableWidth / 2),
            pivotY: tableFootY,
            pivotWidth: tableWidth
          },
          anchorX: absoluteCellX + tableX + Math.round(tableWidth / 2),
          anchorY: tableFootY,
          bubble: state === "waiting" ? "..." : null
        };
      }
`;
