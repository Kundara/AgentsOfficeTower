export const CLIENT_RUNTIME_CAFE_SCENE_SOURCE = `
      function buildCafeTableVisualModel(snapshot, agent, x, y, boothWidth, boothHeight, compact, options = {}) {
        const sceneTile = sceneTileSize(compact);
        const state = agent?.state || "idle";
        const mirrored = options.mirrored === true;
        const cafe = pixelOffice.cafe;
        const table = cafe.tableRound || cafe.table;
        const chairOptions = [cafe.chairRed, cafe.chairBlue, cafe.chairGreen].filter(Boolean);
        const chair = chairOptions[stableHash(agent?.id || options.slotId || "cafe") % chairOptions.length];
        const computer = computerSpriteForAgent(agent, mirrored);
        const avatarSize = agent ? avatarVisualSizeForAgent(agent, compact ? 1.06 : 1.28) : null;
        const tableScale = compact ? 1.12 : 1.3;
        const chairScale = compact ? 1.12 : 1.28;
        const computerScale = compact ? 0.92 : 1.04;
        const tableWidth = Math.round(table.w * tableScale);
        const tableHeight = Math.round(table.h * tableScale);
        const chairWidth = Math.round(chair.w * chairScale);
        const chairHeight = Math.round(chair.h * chairScale);
        const computerWidth = Math.round(computer.w * computerScale);
        const computerHeight = Math.round(computer.h * computerScale);
        const tableX = Math.round((boothWidth - tableWidth) / 2);
        const tableY = Math.max(1, Math.round(boothHeight - tableHeight - (compact ? 3 : 4)));
        const seatShift = Math.round(tableWidth * 0.16) * (mirrored ? 1 : -1);
        const chairX = Math.round(tableX + (tableWidth - chairWidth) / 2 + seatShift);
        const chairFootLocalY = tableY + Math.round(tableHeight * 0.3);
        const chairY = chairFootLocalY - chairHeight;
        const absoluteCellX = Math.round(options.absoluteX ?? x);
        const absoluteCellY = Math.round(options.absoluteY ?? y);
        const depthBaseY = Number.isFinite(options.depthBaseY) ? Number(options.depthBaseY) : 0;
        const tableFootY = absoluteCellY + tableY + tableHeight;
        const chairFootY = absoluteCellY + chairFootLocalY;
        const tableDepthRow = Math.floor((tableFootY - depthBaseY) / sceneTile);
        const chairDepthRow = Math.floor((chairFootY - depthBaseY) / sceneTile);
        const tableTopEdgeY = tableY + Math.round(tableHeight * 0.6);
        const computerX = Math.round(tableX + (tableWidth - computerWidth) / 2 - seatShift * 0.4);
        const computerY = tableTopEdgeY - computerHeight;
        const avatarWidth = avatarSize ? avatarSize.width : 0;
        const avatarHeight = avatarSize ? avatarSize.height : 0;
        const avatarX = absoluteCellX + Math.round(chairX + (chairWidth - avatarWidth) / 2);
        const avatarY = absoluteCellY + Math.max(0, chairFootLocalY - avatarHeight + (compact ? 2 : 3));
        const shell = [
          buildPixiSpriteDef(chair, absoluteCellX + chairX, absoluteCellY + chairY, chairScale, 7, {
            flipX: mirrored,
            enteringReveal: options.enteringReveal === true,
            depthBaseY: options.depthBaseY,
            depthRow: chairDepthRow,
            depthFootY: chairFootY,
            depthBias: 190
          }),
          buildPixiSpriteDef(table, absoluteCellX + tableX, absoluteCellY + tableY, tableScale, 8, {
            enteringReveal: options.enteringReveal === true,
            depthBaseY: options.depthBaseY,
            depthRow: tableDepthRow,
            depthFootY: tableFootY,
            depthBias: 160
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
                depthRow: chairDepthRow,
                depthFootY: chairFootY,
                depthBias: 760,
                pivotX: avatarX + Math.round(avatarWidth / 2),
                pivotY: chairFootY,
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
