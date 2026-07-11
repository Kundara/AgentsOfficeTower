import { build } from "esbuild";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { generateRuntimeModuleSource } from "./generate-runtime-module.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDir, "..");

const runtimeModuleSource = await generateRuntimeModuleSource();

await build({
  stdin: {
    contents: `import "./src/client/styles.css";\nimport "./src/client/tower-visuals.css";\nimport "./src/client/notifications.css";\nimport "./src/client/health.css";\nimport { createEventPresentation } from "./src/client/runtime/event-presentation";\nimport { latestTypedMessageEvent } from "./src/client/runtime/latest-typed-message-event";\nimport { officeMapHorizontalMaxScrollLeft, officeMapHorizontalWheelTarget, wheelDeltaPixels } from "./src/client/runtime/horizontal-wheel";\nimport { captureSessionFocus, restoreSessionFocus } from "./src/client/runtime/session-focus";\nimport { DEFAULT_CAFE_SCENE_COLORS, DEFAULT_WORKSPACE_SCENE_COLORS, deriveScenePalette, normalizeScenePaletteInput } from "./src/client/runtime/scene-palette";\nimport { isCodexChatProjectRootForStreetCafe } from "./src/client/runtime/street-cafe";\n${runtimeModuleSource}\nstartClientApp();\n`,
    loader: "ts",
    resolveDir: packageRoot,
    sourcefile: "src/client/generated-entry.ts"
  },
  outfile: resolve(packageRoot, "dist/client/app.js"),
  bundle: true,
  platform: "browser",
  format: "iife",
  target: ["es2022"],
  external: ["/vendor/partysocket/index.js"],
  sourcemap: true,
  logLevel: "info"
});
