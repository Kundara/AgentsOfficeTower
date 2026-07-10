export const CLIENT_RUNTIME_SCENE_CUSTOMIZATION_SOURCE = `
      function loadScenePaletteSettings() {
        try {
          const parsed = JSON.parse(window.localStorage.getItem(SCENE_PALETTE_STORAGE_KEY) || "{}");
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            return {};
          }
          return Object.fromEntries(Object.entries(parsed)
            .filter(([key, value]) => Boolean(key) && value && typeof value === "object" && !Array.isArray(value))
            .map(([key, value]) => [key, normalizeScenePaletteInput(value)]));
        } catch {
          return {};
        }
      }

      function saveScenePaletteSettings() {
        try {
          window.localStorage.setItem(SCENE_PALETTE_STORAGE_KEY, JSON.stringify(state.projectScenePalettes));
        } catch {}
      }

      function scenePaletteKey(snapshot) {
        if (!snapshot) {
          return "";
        }
        return snapshot.sceneKind === "street-cafe" ? STREET_CAFE_PROJECT_ROOT : snapshotGroupKey(snapshot);
      }

      function scenePaletteForKey(key, sceneKind = "workspace") {
        const defaults = sceneKind === "street-cafe" ? DEFAULT_CAFE_SCENE_COLORS : DEFAULT_WORKSPACE_SCENE_COLORS;
        return deriveScenePalette(state.projectScenePalettes[key], defaults);
      }

      function scenePaletteForSnapshot(snapshot) {
        return scenePaletteForKey(scenePaletteKey(snapshot), snapshot && snapshot.sceneKind);
      }

      function scenePaletteToken(snapshot) {
        const palette = scenePaletteForSnapshot(snapshot).base;
        return [scenePaletteKey(snapshot), palette.floor, palette.wall, palette.board].join("|");
      }

      function scenePaletteRampStyle(palette, role) {
        const dark = role === "floor" ? palette.hex.floorDark : role === "wall" ? palette.hex.wallBorder : palette.hex.boardDark;
        const base = palette.base[role];
        const light = role === "floor" ? palette.hex.floorLight : role === "wall" ? palette.hex.wallMural : palette.hex.boardLight;
        return \`--scene-ramp-dark:\${dark};--scene-ramp-base:\${base};--scene-ramp-light:\${light}\`;
      }

      function sceneCustomizerDomId(projectRoot) {
        let hash = 2166136261;
        for (const character of String(projectRoot || "")) {
          hash ^= character.charCodeAt(0);
          hash = Math.imul(hash, 16777619);
        }
        return "scene-customizer-" + (hash >>> 0).toString(36);
      }

      function focusSceneCustomizer(projectRoot, open) {
        window.requestAnimationFrame(() => {
          const floor = document.querySelector(\`section.tower-floor[data-project-root="\${CSS.escape(projectRoot || "")}"]\`);
          const target = open
            ? floor && floor.querySelector("input[data-scene-color-role=\\"floor\\"]")
            : floor && floor.querySelector("button[data-action=\\"toggle-floor-customize\\"]");
          if (target instanceof HTMLElement) target.focus();
        });
      }

      function renderSceneColorField(paletteKey, palette, role, label) {
        return \`<label class="scene-color-field"><span>\${escapeHtml(label)}</span><span class="scene-color-control"><input type="color" value="\${escapeHtml(palette.base[role])}" data-scene-palette-key="\${escapeHtml(paletteKey)}" data-scene-color-role="\${escapeHtml(role)}" aria-label="\${escapeHtml(label + " color")}" /><span class="scene-color-ramp" data-scene-ramp-role="\${escapeHtml(role)}" style="\${escapeHtml(scenePaletteRampStyle(palette, role))}" aria-hidden="true"><i></i><i></i><i></i></span></span></label>\`;
      }

      function renderFloorCustomization(snapshot) {
        if (!snapshot || snapshot.sceneKind === "street-cafe" || !snapshotHasLocalProject(snapshot)) {
          return { button: "", panel: "" };
        }
        const paletteKey = scenePaletteKey(snapshot);
        const domId = sceneCustomizerDomId(snapshot.projectRoot);
        const open = state.customizeFloorRoot === snapshot.projectRoot;
        const palette = scenePaletteForSnapshot(snapshot);
        const button = \`<button id="\${escapeHtml(domId + "-trigger")}" class="tower-floor-customize\${open ? " active" : ""}" data-action="toggle-floor-customize" data-project-root="\${escapeHtml(snapshot.projectRoot)}" data-palette-key="\${escapeHtml(paletteKey)}" aria-controls="\${escapeHtml(domId + "-panel")}" aria-expanded="\${open ? "true" : "false"}" type="button">Customize</button>\`;
        if (!open) {
          return { button, panel: "" };
        }
        const panel = \`<div id="\${escapeHtml(domId + "-panel")}" class="tower-floor-customizer" data-scene-customizer="\${escapeHtml(paletteKey)}" role="region" aria-label="Customize workspace colors"><div class="tower-floor-customizer-fields">\${renderSceneColorField(paletteKey, palette, "floor", "Floor")}\${renderSceneColorField(paletteKey, palette, "wall", "Wall")}\${renderSceneColorField(paletteKey, palette, "board", "Board")}</div><div class="tower-floor-customizer-actions"><button type="button" data-action="reset-floor-customize" data-palette-key="\${escapeHtml(paletteKey)}">Reset</button><button type="button" data-action="close-floor-customize">Close</button></div></div>\`;
        return { button, panel };
      }

      function refreshScenePalettePreview(paletteKey, panel) {
        const projects = Array.isArray(latestOfficeMapProjects) ? latestOfficeMapProjects : [];
        const snapshot = projects.find((project) => scenePaletteKey(project) === paletteKey);
        if (!snapshot) {
          return;
        }
        const palette = scenePaletteForSnapshot(snapshot);
        if (panel instanceof HTMLElement) {
          panel.querySelectorAll("[data-scene-ramp-role]").forEach((node) => {
            if (!(node instanceof HTMLElement)) return;
            const role = node.dataset.sceneRampRole;
            if (role === "floor" || role === "wall" || role === "board") {
              node.setAttribute("style", scenePaletteRampStyle(palette, role));
            }
          });
        }
        void syncOfficeMapScenes(projects, latestFloatingHermesProjects);
      }

      function handleSceneCustomizationAction(target, action) {
        if (action === "toggle-floor-customize" && target.dataset.projectRoot) {
          const projectRoot = target.dataset.projectRoot;
          const open = state.customizeFloorRoot !== projectRoot;
          state.customizeFloorRoot = open ? projectRoot : null;
          lastSceneRenderToken = null;
          render();
          focusSceneCustomizer(projectRoot, open);
          return true;
        }
        if (action === "close-floor-customize") {
          const projectRoot = state.customizeFloorRoot;
          state.customizeFloorRoot = null;
          lastSceneRenderToken = null;
          render();
          focusSceneCustomizer(projectRoot, false);
          return true;
        }
        if (action === "reset-floor-customize" && target.dataset.paletteKey) {
          const next = { ...state.projectScenePalettes };
          delete next[target.dataset.paletteKey];
          state.projectScenePalettes = next;
          saveScenePaletteSettings();
          lastSceneRenderToken = null;
          render();
          focusSceneCustomizer(state.customizeFloorRoot, true);
          return true;
        }
        return false;
      }

      document.body.addEventListener("click", (event) => {
        const target = event.target instanceof HTMLElement ? event.target.closest("[data-action]") : null;
        if (!(target instanceof HTMLElement)) return;
        if (handleSceneCustomizationAction(target, target.dataset.action || "")) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      });

      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && state.customizeFloorRoot) {
          const projectRoot = state.customizeFloorRoot;
          state.customizeFloorRoot = null;
          lastSceneRenderToken = null;
          render();
          focusSceneCustomizer(projectRoot, false);
        }
      });

      document.body.addEventListener("input", (event) => {
        const input = event.target instanceof HTMLInputElement
          ? event.target.closest("input[type=color][data-scene-palette-key][data-scene-color-role]")
          : null;
        if (!(input instanceof HTMLInputElement)) return;
        const key = input.dataset.scenePaletteKey || "";
        const role = input.dataset.sceneColorRole;
        if (!key || (role !== "floor" && role !== "wall" && role !== "board")) return;
        const current = normalizeScenePaletteInput(state.projectScenePalettes[key]);
        state.projectScenePalettes = {
          ...state.projectScenePalettes,
          [key]: normalizeScenePaletteInput({ ...current, [role]: input.value })
        };
        saveScenePaletteSettings();
        refreshScenePalettePreview(key, input.closest("[data-scene-customizer]"));
      });
`;
