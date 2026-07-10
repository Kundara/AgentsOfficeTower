export const CLIENT_RUNTIME_FURNITURE_INTERACTION_SOURCE = `
      function furnitureDragRendererForTarget(target, host) {
        const renderer = rendererForHost(host);
        if (renderer && renderer.model && Number.isFinite(renderer.scale)) {
          return renderer;
        }
        if (!(host instanceof HTMLElement)) {
          return null;
        }
        const projectRoot = host.dataset.projectRoot || target?.dataset?.projectRoot || "";
        const snapshot = latestOfficeMapProjects.find((project) => project && project.projectRoot === projectRoot);
        if (!snapshot) {
          return null;
        }
        const model = buildOfficeSceneModel(snapshot, {
          compact: host.dataset.compact === "1",
          focusMode: host.dataset.focusMode === "1",
          liveOnly: state.activeOnly
        });
        if (!model) {
          return null;
        }
        const availableWidth = Math.max(Math.round(host.getBoundingClientRect().width || host.clientWidth || model.width), 1);
        const fitWidth = Math.max(1, Number(model.fitWidth) || model.width);
        const scale = Math.min(Math.max(availableWidth / fitWidth, 0.5), 3.5);
        const scaledWidth = Math.max(1, Math.round(model.width * scale));
        return {
          host,
          model,
          scale,
          leftOffset: Math.max(0, Math.round((availableWidth - scaledWidth) / 2))
        };
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
        const pointerX = event.clientX - furnitureDragState.hostRect.left + (renderer.host.scrollLeft || 0) - (renderer.leftOffset || 0);
        const nextColumn = Math.round(pointerX / (renderer.scale * renderer.model.tile) - furnitureDragState.pointerOffsetTiles);
        if (!Number.isFinite(nextColumn) || nextColumn === furnitureDragState.currentColumn) {
          return;
        }
        if (!canPlaceFurniture(renderer.model, furnitureDragState.item, nextColumn)) {
          return;
        }
        furnitureDragState.currentColumn = nextColumn;
        furnitureDragState.dirty = true;
        setFurnitureColumnOverride(furnitureDragState.projectRoot, furnitureDragState.item.roomId, furnitureDragState.item.id, nextColumn, { persist: false });
        render();
      }

      function stopFurnitureDrag() {
        if (!furnitureDragState) {
          return;
        }
        window.removeEventListener("pointermove", handleFurnitureDragMove);
        window.removeEventListener("pointerup", stopFurnitureDrag);
        window.removeEventListener("pointercancel", stopFurnitureDrag);
        if (furnitureDragState.dirty) {
          saveFurnitureLayoutOverrides();
        }
        furnitureDragState = null;
      }
`;
