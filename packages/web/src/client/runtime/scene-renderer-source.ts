export const CLIENT_RUNTIME_SCENE_RENDERER_SOURCE = `
      function destroyOfficeRenderer(renderer) {
        if (!renderer) {
          return;
        }
        if (renderer.destroyed) {
          return;
        }
        renderer.destroyed = true;
        try {
          if (renderer.host && officeMapHoverTarget instanceof HTMLElement && renderer.host.contains(officeMapHoverTarget)) {
            hideOfficeMapHover(officeMapHoverTarget);
          }
          if (renderer.resizeObserver) {
            renderer.resizeObserver.disconnect();
            renderer.resizeObserver = null;
          }
          if (renderer.app && renderer.animateTick) {
            renderer.app.ticker.remove(renderer.animateTick);
            renderer.animateTick = null;
          }
          if (renderer.app) {
            renderer.app.destroy(true, { children: true });
          }
          if (renderer.canvasContainer instanceof HTMLElement) {
            renderer.canvasContainer.innerHTML = "";
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
          if (!existing.root && existing.ready) {
            await existing.ready;
          }
          if (existing.destroyed || existing.initError || !existing.root) {
            if (officeSceneRenderers.get(key) === existing) {
              officeSceneRenderers.delete(key);
            }
            return null;
          }
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
          destroyed: false,
          initError: null,
          root: null,
          model: null,
          ready: null,
          resizeObserver: null,
          assetUrls: new Set(),
          animatedSprites: [],
          motionStates: new Map(),
          roomDoorStates: new Map(),
          workstationLayoutStates: new Map(),
          agentHitNodes: new Map(),
          animateTick: null,
          focusables: [],
          roomById: new Map(),
          roomNavigation: new Map(),
          reservedAgentTiles: new Map(),
          motionDeltaClampUntil: 0,
          motionDebugSamples: [],
          motionDebugWarnedAt: new Map(),
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
          if (renderer.destroyed) {
            try {
              renderer.app.destroy(true, { children: true });
            } catch {}
            return;
          }
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
            const deltaMs = officeMotionFrameDeltaMs(renderer, now);
            renderer.animatedSprites.forEach((entry) => {
              if (!entry || (!entry.sprite && entry.kind !== "blink" && entry.kind !== "wall-dashboard-row" && entry.kind !== "layout-shift")) {
                return;
              }
              if (entry.kind === "wall-dashboard-row") {
                if (!entry.node || !entry.node.parent) {
                  return;
                }
                const duration = Math.max(120, Number(entry.durationMs) || 420);
                const elapsed = Math.max(0, now - Number(entry.startedAt || now));
                const progress = Math.min(1, elapsed / duration);
                const eased = 1 - Math.pow(1 - progress, 3);
                entry.node.y = pixelSnap((Number(entry.fromY) || 0) + ((Number(entry.toY) || 0) - (Number(entry.fromY) || 0)) * eased);
                entry.node.alpha = Math.min(1, 0.62 + eased * 0.38);
                return;
              }
              if (entry.kind === "layout-shift") {
                const duration = Math.max(120, Number(entry.durationMs) || 420);
                const elapsed = Math.max(0, now - Number(entry.startedAt || now));
                const progress = Math.min(1, elapsed / duration);
                const eased = 1 - Math.pow(1 - progress, 3);
                (entry.nodes || []).forEach((nodeEntry) => {
                  if (!nodeEntry || !nodeEntry.node || !nodeEntry.node.parent) {
                    return;
                  }
                  nodeEntry.node.x = pixelSnap((Number(nodeEntry.fromX) || 0) + ((Number(nodeEntry.targetX) || 0) - (Number(nodeEntry.fromX) || 0)) * eased);
                  nodeEntry.node.y = pixelSnap((Number(nodeEntry.fromY) || 0) + ((Number(nodeEntry.targetY) || 0) - (Number(nodeEntry.fromY) || 0)) * eased);
                });
                return;
              }
              if (entry.kind === "motion") {
                const motionBeforeX = Number(entry.currentX);
                const motionBeforeY = Number(entry.currentY);
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
                recordOfficeMotionSample(
                  renderer,
                  entry,
                  entry.autonomy ? "autonomy-route" : "route",
                  motionBeforeX,
                  motionBeforeY,
                  Number(entry.currentX),
                  Number(entry.currentY),
                  deltaMs,
                  speed
                );
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
              if (entry.kind === "wall-dashboard-row") {
                const done = !entry.node
                  || !entry.node.parent
                  || now - Number(entry.startedAt || now) >= Number(entry.durationMs || 420);
                if (done && entry.node) {
                  entry.node.y = pixelSnap(Number(entry.toY) || 0);
                  entry.node.alpha = 1;
                }
                return !done;
              }
              if (entry.kind === "layout-shift") {
                const done = !Array.isArray(entry.nodes)
                  || entry.nodes.length === 0
                  || now - Number(entry.startedAt || now) >= Number(entry.durationMs || 420);
                if (done) {
                  (entry.nodes || []).forEach((nodeEntry) => {
                    if (!nodeEntry || !nodeEntry.node || !nodeEntry.node.parent) {
                      return;
                    }
                    nodeEntry.node.x = pixelSnap(Number(nodeEntry.targetX) || 0);
                    nodeEntry.node.y = pixelSnap(Number(nodeEntry.targetY) || 0);
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
            if (renderer.resizeSyncQueued) {
              return;
            }
            renderer.resizeSyncQueued = true;
            window.requestAnimationFrame(() => {
              renderer.resizeSyncQueued = false;
              if (renderer.destroyed || !renderer.model) {
                return;
              }
              syncOfficeRendererViewport(renderer, renderer.model);
              syncOfficeAnchors(renderer, renderer.model, renderer.scale || 1);
            });
          });
          renderer.resizeObserver.observe(host);
        }).catch((error) => {
          renderer.initError = error;
          destroyOfficeRenderer(renderer);
        });
        officeSceneRenderers.set(key, renderer);
        await renderer.ready;
        if (renderer.destroyed || renderer.initError) {
          if (officeSceneRenderers.get(key) === renderer) {
            officeSceneRenderers.delete(key);
          }
          if (renderer.initError) {
            console.error("office scene renderer init failed", renderer.initError);
          }
          return null;
        }
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
