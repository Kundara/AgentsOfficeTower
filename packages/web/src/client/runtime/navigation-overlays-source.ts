export const CLIENT_RUNTIME_NAVIGATION_OVERLAYS_SOURCE = `
      const OFFICE_MAP_HOVER_MARGIN_PX = 12;
      let officeMapHoverLayer = null;
      let officeMapHoverTarget = null;
      let officeMapHoverKind = "";
      let officeMapHoverPositionFrame = 0;
      let officeMapHoverViewportListenersBound = false;

      function bindOfficeMapHoverViewportListeners() {
        if (officeMapHoverViewportListenersBound) {
          return;
        }
        officeMapHoverViewportListenersBound = true;
        document.addEventListener("scroll", scheduleOfficeMapHoverPosition, {
          capture: true,
          passive: true
        });
        window.addEventListener("resize", scheduleOfficeMapHoverPosition, { passive: true });
      }

      function ensureOfficeMapHoverLayer() {
        if (officeMapHoverLayer instanceof HTMLElement && officeMapHoverLayer.isConnected) {
          return officeMapHoverLayer;
        }
        const existing = document.querySelector("[data-office-map-hover-layer]");
        if (existing instanceof HTMLElement) {
          officeMapHoverLayer = existing;
        } else {
          officeMapHoverLayer = document.createElement("div");
          officeMapHoverLayer.className = "office-map-hover-layer";
          officeMapHoverLayer.dataset.officeMapHoverLayer = "true";
          document.body.appendChild(officeMapHoverLayer);
        }
        bindOfficeMapHoverViewportListeners();
        return officeMapHoverLayer;
      }

      function officeMapHoverHtmlForTarget(target) {
        return typeof target.__officeMapHoverHtml === "string" ? target.__officeMapHoverHtml : "";
      }

      function officeMapHoverKindForTarget(target) {
        return typeof target.__officeMapHoverKind === "string" && target.__officeMapHoverKind
          ? target.__officeMapHoverKind
          : target.dataset.officeMapHoverKind || "";
      }

      function clampOfficeMapHoverPosition(value, min, max) {
        const upper = Math.max(min, max);
        return Math.max(min, Math.min(upper, value));
      }

      function positionOfficeMapHover() {
        if (!(officeMapHoverLayer instanceof HTMLElement)) {
          return;
        }
        const target = officeMapHoverTarget;
        if (!(target instanceof HTMLElement) || !target.isConnected) {
          hideOfficeMapHover();
          return;
        }
        const card = officeMapHoverLayer.firstElementChild;
        if (!(card instanceof HTMLElement)) {
          hideOfficeMapHover();
          return;
        }
        const targetRect = target.getBoundingClientRect();
        if (targetRect.width <= 0 || targetRect.height <= 0) {
          hideOfficeMapHover();
          return;
        }
        const viewportWidth = Math.max(320, Math.round(window.innerWidth || document.documentElement.clientWidth || 0));
        const viewportHeight = Math.max(240, Math.round(window.innerHeight || document.documentElement.clientHeight || 0));
        const cardRect = card.getBoundingClientRect();
        const cardWidth = Math.min(Math.max(1, cardRect.width), Math.max(1, viewportWidth - OFFICE_MAP_HOVER_MARGIN_PX * 2));
        const cardHeight = Math.min(Math.max(1, cardRect.height), Math.max(1, viewportHeight - OFFICE_MAP_HOVER_MARGIN_PX * 2));
        const kind = officeMapHoverKind || officeMapHoverKindForTarget(target);
        const gap = kind === "hot" ? 26 : 8;
        const preferredLeft = kind === "hot"
          ? targetRect.left
          : targetRect.left + targetRect.width / 2 - cardWidth / 2;
        const left = clampOfficeMapHoverPosition(
          Math.round(preferredLeft),
          OFFICE_MAP_HOVER_MARGIN_PX,
          viewportWidth - cardWidth - OFFICE_MAP_HOVER_MARGIN_PX
        );
        let top = Math.round(targetRect.top - cardHeight - gap);
        let placement = "top";
        if (top < OFFICE_MAP_HOVER_MARGIN_PX && targetRect.bottom + gap + cardHeight <= viewportHeight - OFFICE_MAP_HOVER_MARGIN_PX) {
          top = Math.round(targetRect.bottom + gap);
          placement = "bottom";
        }
        top = clampOfficeMapHoverPosition(
          top,
          OFFICE_MAP_HOVER_MARGIN_PX,
          viewportHeight - cardHeight - OFFICE_MAP_HOVER_MARGIN_PX
        );
        setPixelStyleIfChanged(card, "left", left + "px");
        setPixelStyleIfChanged(card, "top", top + "px");
        card.dataset.hoverPlacement = placement;
      }

      function scheduleOfficeMapHoverPosition() {
        if (!(officeMapHoverTarget instanceof HTMLElement)) {
          return;
        }
        if (officeMapHoverPositionFrame) {
          return;
        }
        officeMapHoverPositionFrame = window.requestAnimationFrame(() => {
          officeMapHoverPositionFrame = 0;
          positionOfficeMapHover();
        });
      }

      function hideOfficeMapHover(target = null) {
        if (target instanceof HTMLElement && officeMapHoverTarget !== target) {
          return;
        }
        officeMapHoverTarget = null;
        officeMapHoverKind = "";
        if (officeMapHoverPositionFrame) {
          window.cancelAnimationFrame(officeMapHoverPositionFrame);
          officeMapHoverPositionFrame = 0;
        }
        if (officeMapHoverLayer instanceof HTMLElement) {
          officeMapHoverLayer.classList.remove("is-visible");
          officeMapHoverLayer.innerHTML = "";
          delete officeMapHoverLayer.dataset.hoverKind;
          delete officeMapHoverLayer.dataset.renderHtml;
        }
      }

      function showOfficeMapHover(target, kind = "") {
        if (!(target instanceof HTMLElement)) {
          return;
        }
        const resolvedKind = kind || officeMapHoverKindForTarget(target);
        if (resolvedKind === "hot") {
          syncOfficeWallDashboardHeatNode(target);
        }
        const html = officeMapHoverHtmlForTarget(target);
        if (!html) {
          hideOfficeMapHover(target);
          return;
        }
        const layer = ensureOfficeMapHoverLayer();
        officeMapHoverTarget = target;
        officeMapHoverKind = resolvedKind;
        layer.dataset.hoverKind = resolvedKind;
        if (layer.dataset.renderHtml !== html) {
          layer.innerHTML = html;
          layer.dataset.renderHtml = html;
        }
        layer.classList.add("is-visible");
        positionOfficeMapHover();
      }

      function bindOfficeMapHoverNode(node) {
        if (!(node instanceof HTMLElement) || node.dataset.officeMapHoverBound === "1") {
          return;
        }
        node.dataset.officeMapHoverBound = "1";
        node.addEventListener("mouseenter", () => showOfficeMapHover(node));
        node.addEventListener("mousemove", scheduleOfficeMapHoverPosition);
        node.addEventListener("mouseleave", () => hideOfficeMapHover(node));
        node.addEventListener("focusin", () => showOfficeMapHover(node));
        node.addEventListener("focusout", (event) => {
          const relatedTarget = event.relatedTarget;
          if (relatedTarget instanceof Node && node.contains(relatedTarget)) {
            return;
          }
          hideOfficeMapHover(node);
        });
      }

      function setOfficeMapHoverHtml(node, html, kind) {
        if (!(node instanceof HTMLElement)) {
          return;
        }
        const nextHtml = html || "";
        node.__officeMapHoverHtml = nextHtml;
        node.__officeMapHoverKind = nextHtml ? kind || "" : "";
        setOfficeOverlayDataset(node, "officeMapHoverKind", node.__officeMapHoverKind);
        bindOfficeMapHoverNode(node);
        if (officeMapHoverTarget === node) {
          if (nextHtml) {
            showOfficeMapHover(node, node.__officeMapHoverKind);
          } else {
            hideOfficeMapHover(node);
          }
        }
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

      function renderWallDashboardHotHover(row) {
        const label = String(row && row.label || "Hot file");
        const path = String(row && (row.displayPath || row.path) || label);
        const presentation = hotChangePresentation({
          ...(row || {}),
          fileFamily: row && (row.fileFamily || row.column)
        });
        const branches = Array.isArray(row && row.branches)
          ? row.branches.filter((value) => typeof value === "string" && value.trim().length > 0)
          : (row && row.branch ? [String(row.branch)] : []);
        const users = Array.isArray(row && row.users)
          ? row.users.filter((value) => typeof value === "string" && value.trim().length > 0)
          : [];
        const branchLabel = branches.length > 1 ? branches[0] + " +" + (branches.length - 1) : branches[0] || "";
        const heat = wallDashboardHotHeat(row);
        const heatWidth = Math.max(1, Math.min(100, heat));
        const time = row && row.updatedAt ? formatUpdatedAt(row.updatedAt) : "recent";
        const userText = users.length > 0 ? " · by " + users.join(", ") : "";
        const branchHtml = branchLabel
          ? '<span class="office-wall-hot-branch"><img class="worktree-inline-icon" src="' + escapeHtml(worktreeIconUrl()) + '" alt="" aria-hidden="true" /><span>' + escapeHtml(branchLabel) + '</span></span>'
          : "";
        const footerHtml = (path && path !== label) || branchHtml
          ? '<div class="agent-hover-meta office-wall-hot-footer"><span class="office-wall-hot-path-text">' + escapeHtml(path && path !== label ? path : "") + '</span>' + branchHtml + '</div>'
          : "";
        return '<div class="agent-hover office-wall-hot-hover">'
          + '<div class="agent-hover-title office-wall-hot-title">' + renderHotFileIcon(presentation, "office-wall-hot-hover-icon") + '<strong>' + escapeHtml(label) + '</strong><span class="office-wall-hot-format" style="--file-format-color:' + escapeHtml(presentation.formatColor) + '">' + escapeHtml(presentation.fileFormat) + '</span></div>'
          + '<div class="agent-hover-meta" data-wall-hot-meta>' + escapeHtml(presentation.label + " · " + presentation.changeKind + " · heat " + heat + "% · " + time + userText) + '</div>'
          + '<div class="office-wall-hot-heat-track"><span data-wall-hot-heat-fill style="width: ' + heatWidth + '%"></span></div>'
          + footerHtml
          + '</div>';
      }

      function wallDashboardHotHeatFromValues(score, generatedAtMs, fallbackHeat) {
        const numericScore = Number(score);
        const numericGeneratedAt = Number(generatedAtMs);
        if (Number.isFinite(numericScore) && numericScore > 0 && Number.isFinite(numericGeneratedAt) && numericGeneratedAt > 0) {
          const halfLifeMs = typeof OFFICE_WALL_HEAT_HALF_LIFE_MS === "number" ? OFFICE_WALL_HEAT_HALF_LIFE_MS : 3 * 60 * 1000;
          const ageMs = Math.max(0, Date.now() - numericGeneratedAt);
          const decay = Math.pow(0.5, ageMs / halfLifeMs);
          return Math.round(Math.max(1, Math.min(100, numericScore * decay * 4)));
        }
        return Math.round(Math.max(1, Math.min(100, Number(fallbackHeat) || 0)));
      }

      function wallDashboardHotHeat(row) {
        if (!row) {
          return 0;
        }
        return wallDashboardHotHeatFromValues(row.score, row.generatedAtMs, row.heat);
      }

      function syncOfficeWallDashboardHeatNode(node) {
        if (!(node instanceof HTMLElement)) {
          return;
        }
        const heat = wallDashboardHotHeatFromValues(
          node.dataset.wallHotScore,
          node.dataset.wallHotGeneratedAt,
          node.dataset.wallHotHeat
        );
        node.dataset.wallHotHeat = String(heat);
        const updateHoverContent = (root) => {
          if (!root || typeof root.querySelector !== "function") {
            return;
          }
          const meta = root.querySelector("[data-wall-hot-meta]");
          if (meta) {
            const familyLabel = node.dataset.wallHotFamilyLabel || node.dataset.wallHotType || "File";
            const changeKind = node.dataset.wallHotChangeKind || "modified";
            const updatedAt = node.dataset.wallHotUpdatedAt || "";
            const time = updatedAt ? formatUpdatedAt(updatedAt) : "recent";
            const users = node.dataset.wallHotUsers ? node.dataset.wallHotUsers.split(",").filter(Boolean) : [];
            const userText = users.length > 0 ? " · by " + users.join(", ") : "";
            meta.textContent = familyLabel + " · " + changeKind + " · heat " + heat + "% · " + time + userText;
          }
          const fill = root.querySelector("[data-wall-hot-heat-fill]");
          if (fill instanceof HTMLElement) {
            fill.style.width = Math.max(1, Math.min(100, heat)) + "%";
          }
        };
        if (node.__officeMapHoverHtml) {
          const template = document.createElement("template");
          template.innerHTML = node.__officeMapHoverHtml;
          updateHoverContent(template.content);
          node.__officeMapHoverHtml = template.innerHTML;
        }
        updateHoverContent(node);
        if (officeMapHoverTarget === node && officeMapHoverLayer instanceof HTMLElement) {
          updateHoverContent(officeMapHoverLayer);
          officeMapHoverLayer.dataset.renderHtml = node.__officeMapHoverHtml || officeMapHoverLayer.innerHTML;
          scheduleOfficeMapHoverPosition();
        }
      }

      function syncOfficeWallDashboardHeat() {
        document.querySelectorAll(".office-map-wall-hot-hit").forEach((node) => {
          syncOfficeWallDashboardHeatNode(node);
        });
      }

      function wallDashboardHotNodeKey(dashboard, row, itemIndex) {
        const boardKey = String(dashboard && (dashboard.id || dashboard.roomId) || "wall-dashboard");
        const rowKey = String((row && (row.path || row.label)) || itemIndex || "");
        const columnKey = String(row && (row.column || row.kind) || "");
        return boardKey + "::" + rowKey + "::" + columnKey;
      }

      function wallDashboardHotNodeRenderKey(row) {
        return JSON.stringify([
          String(row && row.label || "Hot file"),
          String(row && (row.displayPath || row.path) || ""),
          String(row && (row.column || row.kind) || "file"),
          String(row && row.fileFormat || ""),
          String(row && row.formatColor || ""),
          String(row && row.changeKind || ""),
          Array.isArray(row && row.branches) ? row.branches.join(",") : String(row && row.branch || ""),
          Array.isArray(row && row.users) ? row.users.join(",") : ""
        ]);
      }

      function syncWallDashboardHotNode(node, dashboard, row, itemIndex, scale, layout) {
        const cellX = layout.gridX + layout.column * (layout.columnWidth + layout.columnGap);
        const rowY = 5 + layout.index * layout.rowStep;
        node.className = "office-map-wall-hot-hit";
        node.dataset.wallHotKey = wallDashboardHotNodeKey(dashboard, row, itemIndex);
        node.dataset.wallHotType = String(row.column || row.kind || "file");
        node.dataset.wallHotFamilyLabel = String(row.familyLabel || row.column || "File");
        node.dataset.wallHotChangeKind = String(row.changeKind || "modified");
        node.dataset.wallHotScore = String(Number(row.score) || 0);
        node.dataset.wallHotGeneratedAt = String(Number(row.generatedAtMs || dashboard.generatedAtMs) || 0);
        node.dataset.wallHotHeat = String(wallDashboardHotHeat(row));
        node.dataset.wallHotUpdatedAt = String(row.updatedAt || "");
        node.dataset.wallHotUsers = Array.isArray(row.users) ? row.users.join(",") : "";
        node.style.left = Math.round((dashboard.x + cellX) * scale) + "px";
        node.style.top = Math.round((dashboard.y + rowY) * scale) + "px";
        node.style.width = Math.max(12, Math.round(layout.columnWidth * scale)) + "px";
        node.style.height = Math.max(8, Math.round(layout.cellHeight * scale)) + "px";
        const renderKey = wallDashboardHotNodeRenderKey(row);
        setOfficeMapHoverHtml(node, renderWallDashboardHotHover(row), "hot");
        setOfficeOverlayHtml(node, renderHotFileIcon({ ...row, fileFamily: row.fileFamily || row.column }, "office-wall-hot-cell-icon"));
        if (node.dataset.wallHotRenderKey !== renderKey) {
          node.dataset.wallHotRenderKey = renderKey;
        }
        syncOfficeWallDashboardHeatNode(node);
      }

      function collectReusableOfficeOverlayNodes(layer, selector, datasetKey) {
        const nodes = new Map();
        Array.from(layer.querySelectorAll(selector)).forEach((node) => {
          if (node instanceof HTMLElement && node.dataset[datasetKey]) {
            nodes.set(node.dataset[datasetKey], node);
          }
        });
        return nodes;
      }

      function officeOverlayNodeIsActive(node) {
        return node instanceof HTMLElement && (node.matches(":hover") || node.matches(":focus-within"));
      }

      function flushPendingOfficeOverlayHtml(node) {
        if (!(node instanceof HTMLElement) || officeOverlayNodeIsActive(node)) {
          return;
        }
        const pendingHtml = node.dataset.pendingRenderHtml;
        if (typeof pendingHtml !== "string") {
          return;
        }
        node.innerHTML = pendingHtml;
        node.dataset.renderHtml = pendingHtml;
        delete node.dataset.pendingRenderHtml;
        delete node.dataset.pendingRenderListener;
      }

      function setOfficeOverlayHtml(node, html) {
        if (!(node instanceof HTMLElement)) {
          return;
        }
        const nextHtml = String(html || "");
        if (node.dataset.renderHtml === nextHtml) {
          delete node.dataset.pendingRenderHtml;
          return;
        }
        if (officeOverlayNodeIsActive(node)) {
          node.dataset.pendingRenderHtml = nextHtml;
          if (node.dataset.pendingRenderListener !== "1") {
            node.dataset.pendingRenderListener = "1";
            const flush = () => {
              window.requestAnimationFrame(() => flushPendingOfficeOverlayHtml(node));
            };
            node.addEventListener("mouseleave", flush, { once: true });
            node.addEventListener("focusout", flush, { once: true });
          }
          return;
        }
        node.innerHTML = nextHtml;
        node.dataset.renderHtml = nextHtml;
        delete node.dataset.pendingRenderHtml;
        delete node.dataset.pendingRenderListener;
      }

      function setOfficeOverlayDataset(node, key, value) {
        if (!(node instanceof HTMLElement)) {
          return;
        }
        if (value === null || value === undefined || value === "") {
          delete node.dataset[key];
          return;
        }
        node.dataset[key] = String(value);
      }

      function syncAgentOverlayNode(node, anchor, scale) {
        const classNames = ["office-map-agent-hit"];
        if (anchor.threadOpen) {
          classNames.push("is-thread-open");
        }
        node.className = classNames.join(" ");
        node.dataset.agentKey = anchor.key;
        node.dataset.focusAgent = "true";
        setOfficeOverlayDataset(node, "threadId", anchor.threadId || "");
        setOfficeOverlayDataset(node, "focusKey", anchor.focusKey || "");
        setOfficeOverlayDataset(node, "focusKeys", Array.isArray(anchor.focusKeys) ? JSON.stringify(anchor.focusKeys) : "");
        node.style.left = Math.round((anchor.left ?? anchor.x) * scale) + "px";
        node.style.top = Math.round((anchor.top ?? anchor.y) * scale) + "px";
        node.style.width = Math.max(8, Math.round((anchor.width ?? 0) * scale)) + "px";
        node.style.height = Math.max(8, Math.round((anchor.height ?? 0) * scale)) + "px";
        const triggerHtml = anchor.replyProjectRoot && anchor.threadId
          ? '<button type="button" class="office-map-agent-trigger" data-action="open-agent-thread" data-project-root="' + escapeHtml(anchor.replyProjectRoot) + '" data-thread-id="' + escapeHtml(anchor.threadId) + '" aria-label="Open ' + escapeHtml(anchor.key) + ' chat"></button>'
          : "";
        setOfficeOverlayHtml(node, triggerHtml);
        setOfficeMapHoverHtml(node, anchor.hoverHtml || "", "agent");
        if (officeMapHoverTarget === node) {
          scheduleOfficeMapHoverPosition();
        }
      }

      function syncWorkstationOverlayNode(node, anchor, scale) {
        node.className = "office-map-anchor";
        node.dataset.workstationKey = anchor.key;
        node.style.left = Math.round(anchor.x * scale) + "px";
        node.style.top = Math.round(anchor.y * scale) + "px";
        node.style.width = "";
        node.style.height = "";
      }

      function syncFurnitureOverlayNode(node, item, model, scale) {
        const room = model.rooms.find((entry) => entry.id === item.roomId);
        node.className = "office-map-furniture-hit";
        node.dataset.furnitureId = item.id;
        node.dataset.roomId = item.roomId;
        node.style.left = Math.round(item.column * model.tile * scale) + "px";
        node.style.top = Math.round((room ? room.floorTop : 0) * scale) + "px";
        node.style.width = Math.round(item.widthTiles * model.tile * scale) + "px";
        node.style.height = Math.round(model.tile * scale) + "px";
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
        const reusableAgentNodes = collectReusableOfficeOverlayNodes(layer, ".office-map-agent-hit", "agentKey");
        const reusableWorkstationNodes = collectReusableOfficeOverlayNodes(layer, ".office-map-anchor", "workstationKey");
        const reusableFurnitureNodes = collectReusableOfficeOverlayNodes(layer, ".office-map-furniture-hit", "furnitureId");
        const reusableHotNodes = collectReusableOfficeOverlayNodes(layer, ".office-map-wall-hot-hit", "wallHotKey");
        syncThreadPanel(renderer, model);
        renderer.agentHitNodes = new Map();
        const activeAgentKeys = new Set();
        const activeWorkstationKeys = new Set();
        model.anchors.forEach((anchor) => {
          if (anchor.type === "agent") {
            activeAgentKeys.add(anchor.key);
            let node = reusableAgentNodes.get(anchor.key);
            if (!(node instanceof HTMLElement)) {
              node = document.createElement("div");
              layer.appendChild(node);
            }
            syncAgentOverlayNode(node, anchor, scale);
            renderer.agentHitNodes.set(anchor.key, node);
          } else {
            activeWorkstationKeys.add(anchor.key);
            let node = reusableWorkstationNodes.get(anchor.key);
            if (!(node instanceof HTMLElement)) {
              node = document.createElement("div");
              layer.appendChild(node);
            }
            syncWorkstationOverlayNode(node, anchor, scale);
          }
        });
        const activeHotKeys = new Set();
        (model.wallDashboards || []).forEach((dashboard) => {
          if (!dashboard || !Number.isFinite(dashboard.width) || !Number.isFinite(dashboard.height)) {
            return;
          }
          const width = Math.max(48, Math.round(dashboard.width));
          const hotRows = (Array.isArray(dashboard.hotGrid) ? dashboard.hotGrid : [])
            .filter((row) => row && row.label)
            .slice(0, 9);
          const gridInset = 3;
          const columnGap = 3;
          const cellHeight = 7;
          const contentWidth = Math.max(24, width - gridInset * 2);
          const maxCellWidth = Math.max(30, Math.floor(contentWidth / 2));
          const columnCount = hotRows.length <= 1 ? 1 : hotRows.length <= 4 ? 2 : 3;
          const columnWidth = Math.min(maxCellWidth, Math.max(24, Math.floor((contentWidth - columnGap * (columnCount - 1)) / columnCount)));
          const gridWidth = columnCount * columnWidth + columnGap * (columnCount - 1);
          const gridX = gridInset + Math.max(0, Math.floor((contentWidth - gridWidth) / 2));
          const rowStep = 8;
          hotRows.forEach((row, itemIndex) => {
            const column = itemIndex % columnCount;
            const index = Math.floor(itemIndex / columnCount);
            const hotKey = wallDashboardHotNodeKey(dashboard, row, itemIndex);
            activeHotKeys.add(hotKey);
            let node = reusableHotNodes.get(hotKey);
            if (!(node instanceof HTMLElement)) {
              node = document.createElement("div");
              layer.appendChild(node);
            }
            syncWallDashboardHotNode(node, dashboard, row, itemIndex, scale, {
              column,
              index,
              gridX,
              columnGap,
              columnWidth,
              cellHeight,
              rowStep
            });
          });
        });
        reusableHotNodes.forEach((node, key) => {
          if (!activeHotKeys.has(key)) {
            hideOfficeMapHover(node);
            node.remove();
          }
        });
        const activeFurnitureKeys = new Set();
        model.furniture.forEach((item) => {
          activeFurnitureKeys.add(item.id);
          let node = reusableFurnitureNodes.get(item.id);
          if (!(node instanceof HTMLElement)) {
            node = document.createElement("div");
            layer.appendChild(node);
          }
          syncFurnitureOverlayNode(node, item, model, scale);
        });
        reusableAgentNodes.forEach((node, key) => {
          if (!activeAgentKeys.has(key)) {
            hideOfficeMapHover(node);
            node.remove();
          }
        });
        reusableWorkstationNodes.forEach((node, key) => {
          if (!activeWorkstationKeys.has(key)) {
            node.remove();
          }
        });
        reusableFurnitureNodes.forEach((node, key) => {
          if (!activeFurnitureKeys.has(key)) {
            node.remove();
          }
        });
      }
`;
