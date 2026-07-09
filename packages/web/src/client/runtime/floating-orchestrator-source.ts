export const CLIENT_RUNTIME_FLOATING_ORCHESTRATOR_SOURCE = `
      const hermesFloatingNodes = new Map();
      const pendingHermesAssignedTransfers = new Set();
      let lastHermesAssignedScreenRects = new Map();
      const HERMES_FLOATING_AGENT_LIMIT = 12;
      const HERMES_FLOATING_TRANSITION_MS = 760;
      const HERMES_FLOATING_FINISHED_COOLDOWN_MS = 3000;
      const HERMES_ASSIGNED_TRANSFER_SETTLE_MS = 90;
      const HERMES_ASSIGNED_TRANSFER_MS = 1080;

      function isScreenFloatingHermesAgent(agent) {
        return agent
          && (
            (agent.source === "hermes" && agent.sourceKind === "hermes:roaming")
            || (agent.source === "openclaw" && agent.sourceKind === "openclaw:roaming")
          );
      }

      function parseHermesFloatingTimestamp(value) {
        const time = Date.parse(value || "");
        return Number.isFinite(time) ? time : 0;
      }

      function isFinishedScreenFloatingHermesAgent(agent) {
        const state = String(agent && agent.state || "").toLowerCase();
        const statusText = String(agent && agent.statusText || "").toLowerCase();
        return state === "done"
          || state === "idle"
          || statusText === "done"
          || statusText === "idle";
      }

      function shouldRenderScreenFloatingHermesAgent(agent) {
        if (!isScreenFloatingHermesAgent(agent)) {
          return false;
        }
        if (isFinishedScreenFloatingHermesAgent(agent)) {
          const finishedAt = parseHermesFloatingTimestamp(agent.stoppedAt || agent.updatedAt);
          return finishedAt > 0 && Date.now() - finishedAt <= HERMES_FLOATING_FINISHED_COOLDOWN_MS;
        }
        return agent.isOngoing === true || agent.isCurrent === true;
      }

      function floatingHermesAgentKey(agent) {
        const id = String(agent && agent.id || "");
        if (id) {
          return id;
        }
        const threadId = String(agent && agent.threadId || "");
        return threadId ? "hermes:" + threadId : "";
      }

      function collectFloatingHermesEntries(projects) {
        const byKey = new Map();
        (Array.isArray(projects) ? projects : []).forEach((snapshot) => {
          if (!snapshot || !Array.isArray(snapshot.agents)) {
            return;
          }
          snapshot.agents.forEach((agent) => {
            if (!shouldRenderScreenFloatingHermesAgent(agent)) {
              return;
            }
            const key = floatingHermesAgentKey(agent);
            if (!key) {
              return;
            }
            const updatedAt = Date.parse(agent.updatedAt || "");
            const current = byKey.get(key);
            if (!current || (Number.isFinite(updatedAt) && updatedAt > current.updatedAtMs)) {
              byKey.set(key, {
                key,
                snapshot,
                agent,
                updatedAtMs: Number.isFinite(updatedAt) ? updatedAt : 0
              });
            }
          });
        });
        return [...byKey.values()]
          .sort((left, right) => right.updatedAtMs - left.updatedAtMs || left.key.localeCompare(right.key))
          .slice(0, HERMES_FLOATING_AGENT_LIMIT);
      }

      function ensureHermesFloatingLayer() {
        let layer = document.querySelector("[data-hermes-float-layer]");
        if (!(layer instanceof HTMLElement)) {
          layer = document.createElement("div");
          layer.className = "hermes-float-layer";
          layer.dataset.hermesFloatLayer = "true";
          document.body.appendChild(layer);
        }
        return layer;
      }

      function hermesFloatingViewport() {
        const doc = document.documentElement;
        const width = Math.max(320, Math.round(window.innerWidth || doc.clientWidth || 0));
        const height = Math.max(240, Math.round(window.innerHeight || doc.clientHeight || 0));
        return { width, height };
      }

      function hermesFloatingSkyBounds(size, compact, viewport) {
        const viewportLeft = compact ? 10 : 22;
        const defaultRight = Math.min(
          viewport.width - size - 10,
          compact ? 138 : Math.max(172, Math.round(viewport.width * 0.22))
        );
        const defaultTop = compact
          ? Math.max(96, Math.round(viewport.height * 0.16))
          : Math.max(220, Math.round(viewport.height * 0.24));
        const defaultBottom = Math.max(defaultTop + size, viewport.height - Math.max(compact ? 28 : 42, Math.round(viewport.height * 0.07)));
        const sceneRects = Array.from(document.querySelectorAll("[data-office-map-host]"))
          .filter((node) => node instanceof HTMLElement)
          .map((node) => node.getBoundingClientRect())
          .filter((rect) => rect.width > 0 && rect.height > 0);
        const visibleSceneRects = sceneRects
          .map((rect) => ({
            left: Math.max(0, rect.left),
            right: Math.min(viewport.width, rect.right),
            top: Math.max(compact ? 84 : 104, rect.top),
            bottom: Math.min(viewport.height - (compact ? 18 : 26), rect.bottom)
          }))
          .filter((rect) => rect.right - rect.left > size * 1.2 && rect.bottom - rect.top > size * 1.2);
        if (visibleSceneRects.length > 0) {
          const towerLeft = Math.min(...visibleSceneRects.map((rect) => rect.left));
          const viewportGutterLeft = compact ? 10 : 22;
          const gutterGap = compact ? 6 : 10;
          const minimumVisibleLeft = -Math.round(size * 0.35);
          const outsideRight = Math.max(minimumVisibleLeft, Math.round(towerLeft - size - gutterGap));
          const outsideLeft = Math.min(viewportGutterLeft, outsideRight);
          if (outsideRight >= outsideLeft && defaultBottom >= defaultTop + size) {
            return {
              left: outsideLeft,
              right: outsideRight,
              top: defaultTop,
              bottom: defaultBottom
            };
          }
        }
        if (sceneRects.length === 0) {
          return {
            left: viewportLeft,
            right: Math.max(viewportLeft, defaultRight),
            top: defaultTop,
            bottom: defaultBottom
          };
        }
        const sceneLefts = sceneRects
          .map((rect) => rect.left)
          .filter((left) => Number.isFinite(left));
        const firstSceneLeft = sceneLefts.length > 0 ? Math.min(...sceneLefts) : viewportLeft + size;
        const gutterGap = compact ? 4 : 8;
        const minimumVisibleLeft = -Math.round(size * 0.25);
        const gutterRight = Math.max(minimumVisibleLeft, Math.round(firstSceneLeft - size - gutterGap));
        const gutterLeft = Math.min(viewportLeft, Math.max(minimumVisibleLeft, gutterRight));
        return {
          left: gutterLeft,
          right: Math.max(gutterLeft, Math.min(defaultRight, gutterRight)),
          top: defaultTop,
          bottom: defaultBottom
        };
      }

      function hermesFloatingSlotLayout(entries) {
        const viewport = hermesFloatingViewport();
        const compact = viewport.width < 720;
        const size = compact ? 58 : 68;
        const minDistance = compact ? 70 : 86;
        const skyBounds = hermesFloatingSkyBounds(size, compact, viewport);
        const left = skyBounds.left;
        const right = skyBounds.right;
        const top = skyBounds.top;
        const bottom = skyBounds.bottom;
        const columns = Math.max(1, Math.floor(Math.max(1, right - left) / minDistance) + 1);
        const rows = Math.max(1, Math.floor(Math.max(1, bottom - top) / minDistance) + 1);
        const candidates = [];
        for (let row = 0; row < rows; row += 1) {
          for (let column = 0; column < columns; column += 1) {
            const seed = stableHash("hermes-float:" + row + ":" + column);
            const jitterX = (((seed % 997) / 997) - 0.5) * Math.min(18, minDistance * 0.3);
            const jitterY = ((((Math.floor(seed / 997)) % 991) / 991) - 0.5) * Math.min(22, minDistance * 0.36);
            const x = Math.max(left, Math.min(right, left + column * minDistance + jitterX));
            const y = Math.max(top, Math.min(bottom - size, top + row * minDistance + jitterY));
            candidates.push({ x, y });
          }
        }
        const placed = [];
        const layout = new Map();
        const sortedEntries = [...entries].sort((leftEntry, rightEntry) => leftEntry.key.localeCompare(rightEntry.key));
        const preferredX = left + Math.max(0, Math.min(right - left, (right - left) * 0.35));
        const preferredY = top + Math.max(0, (bottom - top - size) * 0.38);
        sortedEntries.forEach((entry, index) => {
          let best = null;
          let bestScore = -Infinity;
          const previous = hermesFloatingNodes.get(entry.key);
          const previousPoint = previous
            && Number.isFinite(previous.targetX)
            && Number.isFinite(previous.targetY)
            && previous.targetX >= left
            && previous.targetX <= right
            && previous.targetY >= top
            && previous.targetY <= bottom - size
            ? { x: previous.targetX, y: previous.targetY }
            : null;
          if (
            previousPoint
            && placed.every((point) => Math.hypot(point.x - previousPoint.x, point.y - previousPoint.y) >= minDistance * 0.72)
          ) {
            best = previousPoint;
          }
          const preservedPrevious = Boolean(best);
          candidates.forEach((candidate) => {
            if (preservedPrevious) {
              return;
            }
            const nearest = placed.length === 0
              ? minDistance * 2
              : Math.min(...placed.map((point) => Math.hypot(point.x - candidate.x, point.y - candidate.y)));
            const preference = (stableHash(entry.key + ":" + Math.round(candidate.x) + ":" + Math.round(candidate.y)) % 1000) / 100000;
            const preferredDistance = Math.hypot(candidate.x - preferredX, candidate.y - preferredY);
            const score = nearest + preference - preferredDistance * 0.018;
            if (score > bestScore) {
              best = candidate;
              bestScore = score;
            }
          });
          if (!best) {
            const row = Math.floor(index / Math.max(1, columns));
            const column = index % Math.max(1, columns);
            best = {
              x: Math.max(left, Math.min(right, left + column * minDistance)),
              y: Math.max(top, Math.min(bottom - size, top + row * minDistance))
            };
          }
          placed.push(best);
          layout.set(entry.key, {
            x: Math.round(best.x),
            y: Math.round(best.y),
            size
          });
        });
        return layout;
      }

      function hermesFloatingTransform(x, y) {
        return "translate3d(" + Math.round(x) + "px, " + Math.round(y) + "px, 0)";
      }

      function hermesFloatingVelocityTilt(fromX, fromY, toX, toY) {
        const dx = Number(toX) - Number(fromX);
        const dy = Number(toY) - Number(fromY);
        if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
          return 0;
        }
        return Math.max(-10, Math.min(10, dx * 0.12 + dy * 0.025));
      }

      function setHermesFloatStyle(node, property, value) {
        if (!node || !node.style) {
          return;
        }
        if (typeof node.style.setProperty === "function") {
          node.style.setProperty(property, value);
        } else {
          node.style[property] = value;
        }
      }

      function syncHermesFloatingMotionStyle(node, key) {
        const seed = stableHash("hermes-float-motion:" + key);
        const bob = 4 + (seed % 3);
        const sway = 2 + ((seed >>> 4) % 3);
        const duration = 4300 + ((seed >>> 8) % 1700);
        const delay = -((seed >>> 13) % duration);
        const driftBias = ((seed >>> 19) % 7) - 3;
        setHermesFloatStyle(node, "--hermes-float-duration", duration + "ms");
        setHermesFloatStyle(node, "--hermes-float-delay", delay + "ms");
        setHermesFloatStyle(node, "--hermes-float-bob-up", "-" + bob + "px");
        setHermesFloatStyle(node, "--hermes-float-bob-down", Math.max(2, Math.round(bob * 0.45)) + "px");
        setHermesFloatStyle(node, "--hermes-float-sway-left", "-" + Math.max(1, sway - driftBias * 0.2).toFixed(1) + "px");
        setHermesFloatStyle(node, "--hermes-float-sway-right", Math.max(1, sway + driftBias * 0.2).toFixed(1) + "px");
      }

      function hermesFloatingTravelDuration(fromX, fromY, toX, toY) {
        if (
          typeof window.matchMedia === "function"
          && window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ) {
          return 1;
        }
        const distance = Math.hypot(Number(toX) - Number(fromX), Number(toY) - Number(fromY));
        return Math.round(Math.max(520, Math.min(1380, 420 + distance * 0.74)));
      }

      function queueHermesFloatingTiltSettle(record, key, durationMs, tilt) {
        if (!record || !(record.node instanceof HTMLElement) || Math.abs(tilt) < 0.2) {
          return;
        }
        record.tiltTimer = window.setTimeout(() => {
          if (hermesFloatingNodes.get(key) !== record || !(record.node instanceof HTMLElement)) {
            return;
          }
          setHermesFloatStyle(record.node, "--hermes-flight-bank", "0deg");
          record.tiltTimer = null;
        }, Math.max(220, Number(durationMs) || HERMES_FLOATING_TRANSITION_MS));
      }

      function animateHermesFloatingFlight(record, key, fromX, fromY, toX, toY, tilt) {
        if (!record || !(record.node instanceof HTMLElement)) {
          return HERMES_FLOATING_TRANSITION_MS;
        }
        const node = record.node;
        const durationMs = hermesFloatingTravelDuration(fromX, fromY, toX, toY);
        const distance = Math.hypot(toX - fromX, toY - fromY);
        const arcLift = Math.max(18, Math.min(74, distance * 0.14));
        const targetTransform = hermesFloatingTransform(toX, toY);
        record.flightGeneration = (Number(record.flightGeneration) || 0) + 1;
        setHermesFloatStyle(node, "--hermes-flight-duration", durationMs + "ms");
        setHermesFloatStyle(
          node,
          "--hermes-flight-bank",
          durationMs <= 1 ? "0deg" : (Math.round(tilt * 100) / 100) + "deg"
        );
        if (record.flightAnimation && typeof record.flightAnimation.cancel === "function") {
          record.flightAnimation.cancel();
          record.flightAnimation = null;
        }
        node.style.transform = targetTransform;
        if (durationMs > 1 && typeof node.animate === "function" && distance >= 2) {
          record.flightAnimation = node.animate([
            { transform: hermesFloatingTransform(fromX, fromY), offset: 0 },
            {
              transform: hermesFloatingTransform(
                fromX + (toX - fromX) * 0.28,
                fromY + (toY - fromY) * 0.28 - arcLift
              ),
              offset: 0.32
            },
            {
              transform: hermesFloatingTransform(
                fromX + (toX - fromX) * 0.76,
                fromY + (toY - fromY) * 0.76 - arcLift * 0.38
              ),
              offset: 0.74
            },
            { transform: targetTransform, offset: 1 }
          ], {
            duration: durationMs,
            easing: "cubic-bezier(0.34, 0.08, 0.2, 1)",
            fill: "both"
          });
          record.flightAnimation.onfinish = () => {
            if (hermesFloatingNodes.get(key) === record) {
              record.flightAnimation = null;
              node.style.transform = targetTransform;
            }
          };
        }
        if (durationMs > 1) {
          queueHermesFloatingTiltSettle(record, key, durationMs, tilt);
        }
        return durationMs;
      }

      function renderFloatingHermesAgent(entry) {
        const snapshot = entry.snapshot;
        const agent = entry.agent;
        const visualHtml = renderFloatingHermesVisual(snapshot, agent, true);
        const label = displayAgentLabel(snapshot, agent);
        const projectRoot = threadViewProjectRoot(snapshot, agent) || snapshot.projectRoot || "";
        const triggerHtml = projectRoot && agent.threadId
          ? '<button type="button" class="hermes-float-trigger" data-action="open-agent-thread" data-project-root="' + escapeHtml(projectRoot) + '" data-thread-id="' + escapeHtml(agent.threadId) + '" aria-label="Open ' + escapeHtml(label) + ' history"></button>'
          : "";
        return visualHtml
          + triggerHtml
          + renderAgentHover(snapshot, agent, { className: "agent-hover hermes-float-hover" });
      }

      function renderFloatingHermesVisual(snapshot, agent, includeBubble = false) {
        const sizeAgent = agent && Number(agent.depth) > 0 ? { ...agent, depth: 0 } : agent;
        const avatarSize = avatarVisualSizeForAgent(sizeAgent, 2.05);
        const scaleUp = avatarSize && avatarSize.width > 0 && avatarSize.height > 0
          ? Math.max(1, 38 / avatarSize.width, 48 / avatarSize.height)
          : 1;
        const visualWidth = Math.max(1, Math.round((avatarSize.width || 1) * scaleUp));
        const visualHeight = Math.max(1, Math.round((avatarSize.height || 1) * scaleUp));
        const avatarUrl = avatarSize && avatarSize.avatar && avatarSize.avatar.url ? avatarSize.avatar.url : "";
        const label = displayAgentLabel(snapshot, agent);
        const visualHtml = avatarUrl
          ? '<img class="hermes-float-avatar" src="' + escapeHtml(avatarUrl) + '" alt="" aria-hidden="true" style="width:' + visualWidth + 'px;height:' + visualHeight + 'px" />'
          : '<span class="hermes-float-initial">' + escapeHtml(label.slice(0, 1) || "H") + '</span>';
        const bubbleHtml = includeBubble && agent.isOngoing === true ? '<span class="hermes-float-bubble">...</span>' : "";
        return '<div class="hermes-float-bank"><div class="hermes-float-visual">' + visualHtml + bubbleHtml + '</div></div>';
      }

      function rectTransform(rect, width, height) {
        const x = Math.round(rect.left + rect.width / 2 - width / 2);
        const y = Math.round(rect.top + rect.height / 2 - height / 2);
        return "translate3d(" + x + "px, " + y + "px, 0)";
      }

      function rememberHermesAssignedRect(rects, key, rect) {
        if (!key || !rect || rect.width <= 0 || rect.height <= 0) {
          return;
        }
        if (!rects.has(key)) {
          rects.set(key, rect);
        }
      }

      function isHermesRectMap(value) {
        return value
          && typeof value.get === "function"
          && typeof value.has === "function";
      }

      function snapshotHermesAssignedScreenRects() {
        const rects = new Map();
        document.querySelectorAll(".office-map-agent-hit").forEach((node) => {
          if (!(node instanceof HTMLElement)) {
            return;
          }
          const rect = node.getBoundingClientRect();
          const threadId = node.dataset.threadId || "";
          if (threadId) {
            rememberHermesAssignedRect(rects, threadId, rect);
            rememberHermesAssignedRect(rects, "hermes:" + threadId, rect);
            rememberHermesAssignedRect(rects, "openclaw:" + threadId, rect);
          }
          const nodeKey = node.dataset.agentKey || "";
          const hermesIndex = nodeKey.indexOf("::hermes:");
          if (hermesIndex >= 0) {
            rememberHermesAssignedRect(rects, nodeKey.slice(hermesIndex + 2), rect);
          }
          const openClawIndex = nodeKey.indexOf("::openclaw:");
          if (openClawIndex >= 0) {
            rememberHermesAssignedRect(rects, nodeKey.slice(openClawIndex + 2), rect);
          }
        });
        return rects;
      }

      function findHermesAssignedAgentRect(key, threadId) {
        const threadKey = String(threadId || "");
        for (const node of Array.from(document.querySelectorAll(".office-map-agent-hit"))) {
          if (!(node instanceof HTMLElement)) {
            continue;
          }
          const nodeThreadId = node.dataset.threadId || "";
          const nodeKey = node.dataset.agentKey || "";
          if (
            (threadKey && nodeThreadId === threadKey)
            || nodeKey === key
            || nodeKey.endsWith("::" + key)
            || (threadKey && nodeKey.endsWith("::hermes:" + threadKey))
            || (threadKey && nodeKey.endsWith("::openclaw:" + threadKey))
          ) {
            const rect = node.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              return rect;
            }
          }
        }
        return null;
      }

      function collectAssignedHermesEntries(projects) {
        const entries = [];
        (Array.isArray(projects) ? projects : []).forEach((snapshot) => {
          if (!snapshot || !Array.isArray(snapshot.agents)) {
            return;
          }
          snapshot.agents.forEach((agent) => {
            if (!agent || (agent.source !== "hermes" && agent.source !== "openclaw") || isScreenFloatingHermesAgent(agent)) {
              return;
            }
            const key = floatingHermesAgentKey(agent);
            if (!key) {
              return;
            }
            entries.push({
              key,
              threadId: agent.threadId || "",
              snapshot,
              agent
            });
          });
        });
        return entries;
      }

      function spawnHermesAssignedTransferGhosts(previousRects, projects, activeFloatingKeys = new Set(), options = {}) {
        if (!isHermesRectMap(previousRects) || state.view !== "map" || options.viewportOnly === true) {
          return;
        }
        collectAssignedHermesEntries(projects).forEach((entry) => {
          if (activeFloatingKeys.has(entry.key) || (entry.threadId && activeFloatingKeys.has(entry.threadId))) {
            return;
          }
          const previousRect = previousRects.get(entry.key)
            || (entry.threadId ? previousRects.get(entry.threadId) : null)
            || null;
          if (!previousRect || pendingHermesAssignedTransfers.has(entry.key)) {
            return;
          }
          pendingHermesAssignedTransfers.add(entry.key);
          window.setTimeout(() => {
            pendingHermesAssignedTransfers.delete(entry.key);
            if (state.view !== "map") {
              return;
            }
            const currentRect = findHermesAssignedAgentRect(entry.key, entry.threadId);
            if (!currentRect) {
              return;
            }
            const distance = Math.hypot(
              previousRect.left + previousRect.width / 2 - (currentRect.left + currentRect.width / 2),
              previousRect.top + previousRect.height / 2 - (currentRect.top + currentRect.height / 2)
            );
            if (distance < 80) {
              return;
            }
            const layer = ensureHermesFloatingLayer();
            if (Array.from(layer.children).some((child) => child instanceof HTMLElement && child.dataset.hermesFloatTransfer === entry.key)) {
              return;
            }
            const size = Math.max(36, Math.min(54, Math.round(Math.max(previousRect.width, previousRect.height, currentRect.width, currentRect.height))));
            const node = document.createElement("div");
            node.className = "hermes-float-agent is-transfer";
            node.dataset.hermesFloatTransfer = entry.key;
            node.innerHTML = renderFloatingHermesVisual(entry.snapshot, entry.agent, false);
            node.style.width = size + "px";
            node.style.height = size + "px";
            node.style.transform = rectTransform(previousRect, size, size);
            node.style.opacity = "0.9";
            layer.appendChild(node);
            window.requestAnimationFrame(() => {
              node.style.transform = rectTransform(currentRect, size, size);
            });
            window.setTimeout(() => {
              node.style.opacity = "0";
            }, Math.max(1, HERMES_ASSIGNED_TRANSFER_MS - 180));
            window.setTimeout(() => {
              node.remove();
              if (hermesFloatingNodes.size === 0 && layer.children.length === 0) {
                layer.remove();
              }
            }, HERMES_ASSIGNED_TRANSFER_MS + 220);
          }, HERMES_ASSIGNED_TRANSFER_SETTLE_MS);
        });
      }

      function syncFloatingHermesAgents(projects, options = {}) {
        if (state.view !== "map") {
          projects = [];
        }
        const entries = collectFloatingHermesEntries(projects);
        const activeKeys = new Set(entries.map((entry) => entry.key));
        if (entries.length === 0 && hermesFloatingNodes.size === 0) {
          const staleLayer = document.querySelector("[data-hermes-float-layer]");
          if (staleLayer instanceof HTMLElement) {
            staleLayer.remove();
          }
          return;
        }
        const layer = ensureHermesFloatingLayer();
        const layout = hermesFloatingSlotLayout(entries);
        const assignedRects = options && isHermesRectMap(options.assignedRects) ? options.assignedRects : new Map();
        entries.forEach((entry) => {
          const point = layout.get(entry.key);
          if (!point) {
            return;
          }
          let record = hermesFloatingNodes.get(entry.key);
          let node = record && record.node instanceof HTMLElement ? record.node : null;
          const isNew = !node;
          if (!node) {
            node = document.createElement("div");
            layer.appendChild(node);
          }
          if (record && record.removeTimer) {
            window.clearTimeout(record.removeTimer);
          }
          if (record && record.fadeTimer) {
            window.clearTimeout(record.fadeTimer);
            record.fadeTimer = null;
          }
          const html = renderFloatingHermesAgent(entry);
          const visualKey = [
            entry.key,
            entry.agent.threadId || "",
            displayAgentLabel(entry.snapshot, entry.agent),
            entry.agent.sprite || entry.agent.avatar || entry.agent.avatarId || "",
            entry.agent.isOngoing === true ? "live" : "settling"
          ].join("::");
          if (isNew || node.dataset.visualKey !== visualKey) {
            node.innerHTML = html;
            node.dataset.visualKey = visualKey;
          }
          syncHermesFloatingMotionStyle(node, entry.key);
          node.className = "hermes-float-agent";
          node.dataset.hermesFloatKey = entry.key;
          node.dataset.threadId = entry.agent.threadId || "";
          node.dataset.focusAgent = "true";
          node.dataset.focusKey = focusAgentKey(entry.snapshot, entry.agent);
          node.dataset.focusKeys = JSON.stringify(collectFocusedSessionKeys(entry.snapshot, entry.agent));
          node.style.width = point.size + "px";
          node.style.height = point.size + "px";
          const nextRecord = record && record.node === node
            ? record
            : { node, threadId: "", removeTimer: null, fadeTimer: null, tiltTimer: null, flightAnimation: null, flightGeneration: 0, syncGeneration: 0, targetX: point.x, targetY: point.y };
          nextRecord.syncGeneration = (Number(nextRecord.syncGeneration) || 0) + 1;
          const syncGeneration = nextRecord.syncGeneration;
          if (nextRecord.tiltTimer) {
            window.clearTimeout(nextRecord.tiltTimer);
            nextRecord.tiltTimer = null;
          }
          const previousX = Number.isFinite(nextRecord.targetX) ? nextRecord.targetX : point.x;
          const previousY = Number.isFinite(nextRecord.targetY) ? nextRecord.targetY : point.y;
          let tilt = hermesFloatingVelocityTilt(previousX, previousY, point.x, point.y);
          if (isNew) {
            const startRect = assignedRects.get(entry.key)
              || (entry.agent.threadId ? assignedRects.get(entry.agent.threadId) : null)
              || null;
            if (startRect) {
              const startX = Math.round(startRect.left + startRect.width / 2 - point.size / 2);
              const startY = Math.round(startRect.top + startRect.height / 2 - point.size / 2);
              tilt = hermesFloatingVelocityTilt(startX, startY, point.x, point.y);
              node.style.transform = hermesFloatingTransform(startX, startY);
              node.style.opacity = "0.82";
              window.requestAnimationFrame(() => {
                if (
                  hermesFloatingNodes.get(entry.key) !== nextRecord
                  || nextRecord.syncGeneration !== syncGeneration
                  || node.classList.contains("is-departing")
                ) {
                  return;
                }
                animateHermesFloatingFlight(nextRecord, entry.key, startX, startY, point.x, point.y, tilt);
                node.style.opacity = "1";
              });
            } else {
              node.style.transform = hermesFloatingTransform(point.x, point.y);
              setHermesFloatStyle(node, "--hermes-flight-bank", "0deg");
              node.style.opacity = "1";
            }
          } else {
            if (Math.hypot(point.x - previousX, point.y - previousY) >= 2) {
              animateHermesFloatingFlight(nextRecord, entry.key, previousX, previousY, point.x, point.y, tilt);
            } else if (!nextRecord.flightAnimation) {
              node.style.transform = hermesFloatingTransform(point.x, point.y);
            }
            node.style.opacity = "1";
          }
          nextRecord.node = node;
          nextRecord.threadId = entry.agent.threadId || "";
          nextRecord.removeTimer = null;
          nextRecord.targetX = point.x;
          nextRecord.targetY = point.y;
          hermesFloatingNodes.set(entry.key, nextRecord);
        });
        hermesFloatingNodes.forEach((record, key) => {
          if (activeKeys.has(key)) {
            return;
          }
          const node = record.node;
          if (!(node instanceof HTMLElement)) {
            hermesFloatingNodes.delete(key);
            return;
          }
          const rect = findHermesAssignedAgentRect(key, record.threadId);
          const nodeRect = node.getBoundingClientRect();
          record.syncGeneration = (Number(record.syncGeneration) || 0) + 1;
          node.classList.add("is-departing");
          let departureDurationMs = HERMES_FLOATING_TRANSITION_MS;
          if (record.tiltTimer) {
            window.clearTimeout(record.tiltTimer);
            record.tiltTimer = null;
          }
          if (rect) {
            const targetX = Math.round(rect.left + rect.width / 2 - Math.max(1, nodeRect.width) / 2);
            const targetY = Math.round(rect.top + rect.height / 2 - Math.max(1, nodeRect.height) / 2);
            departureDurationMs = animateHermesFloatingFlight(
              record,
              key,
              Number.isFinite(record.targetX) ? record.targetX : nodeRect.left,
              Number.isFinite(record.targetY) ? record.targetY : nodeRect.top,
              targetX,
              targetY,
              hermesFloatingVelocityTilt(record.targetX, record.targetY, targetX, targetY)
            );
            node.style.opacity = "1";
            record.fadeTimer = window.setTimeout(() => {
              if (hermesFloatingNodes.get(key) === record) {
                node.style.opacity = "0";
              }
            }, Math.max(1, departureDurationMs - 180));
          } else {
            node.style.opacity = "0";
          }
          if (record.removeTimer) {
            window.clearTimeout(record.removeTimer);
          }
          record.removeTimer = window.setTimeout(() => {
            node.remove();
            hermesFloatingNodes.delete(key);
            if (hermesFloatingNodes.size === 0 && layer.children.length === 0) {
              layer.remove();
            }
          }, departureDurationMs + 120);
        });
        return activeKeys;
      }
`;
