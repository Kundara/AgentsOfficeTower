import { readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDir, "..");

const RUNTIME_SECTIONS = [
  ["src/client/runtime/bootstrap-source.ts", "CLIENT_RUNTIME_BOOTSTRAP_SOURCE"],
  ["src/client/runtime/settings-source.ts", "CLIENT_RUNTIME_SETTINGS_SOURCE"],
  ["src/client/runtime/health-source.ts", "CLIENT_RUNTIME_HEALTH_SOURCE"],
  ["src/client/runtime/evidence-source.ts", "CLIENT_RUNTIME_EVIDENCE_SOURCE"],
  ["src/client/runtime/scene-customization-source.ts", "CLIENT_RUNTIME_SCENE_CUSTOMIZATION_SOURCE"],
  ["src/client/scene-grid-source.ts", "SCENE_GRID_SCRIPT"],
  ["src/client/toast-source.ts", "TOAST_SCRIPT"],
  ["src/client/multiplayer-source.ts", "MULTIPLAYER_SCRIPT"],
  ["src/client/runtime/layout-source.ts", "CLIENT_RUNTIME_LAYOUT_SOURCE"],
  ["src/client/runtime/display-text-source.ts", "CLIENT_RUNTIME_DISPLAY_TEXT_SOURCE"],
  ["src/client/runtime/seating-source.ts", "CLIENT_RUNTIME_SEATING_SOURCE"],
  ["src/client/runtime/cafe-scene-source.ts", "CLIENT_RUNTIME_CAFE_SCENE_SOURCE"],
  ["src/client/runtime/render-source.ts", "CLIENT_RUNTIME_RENDER_SOURCE"],
  ["src/client/runtime/scene-source.ts", "CLIENT_RUNTIME_SCENE_SOURCE"],
  ["src/client/runtime/scene-renderer-source.ts", "CLIENT_RUNTIME_SCENE_RENDERER_SOURCE"],
  ["src/client/runtime/navigation-pathing-source.ts", "CLIENT_RUNTIME_NAVIGATION_PATHING_SOURCE"],
  ["src/client/runtime/navigation-overlays-source.ts", "CLIENT_RUNTIME_NAVIGATION_OVERLAYS_SOURCE"],
  ["src/client/runtime/floating-orchestrator-source.ts", "CLIENT_RUNTIME_FLOATING_ORCHESTRATOR_SOURCE"],
  ["src/client/runtime/navigation-source.ts", "CLIENT_RUNTIME_NAVIGATION_SOURCE"],
  ["src/client/runtime/office-scene-lifecycle-source.ts", "CLIENT_RUNTIME_OFFICE_SCENE_LIFECYCLE_SOURCE"],
  ["src/client/runtime/furniture-interaction-source.ts", "CLIENT_RUNTIME_FURNITURE_INTERACTION_SOURCE"],
  ["src/client/runtime/attention-panel-source.ts", "CLIENT_RUNTIME_ATTENTION_PANEL_SOURCE"],
  ["src/client/runtime/ui-source.ts", "CLIENT_RUNTIME_UI_SOURCE"]
];

function extractLiteralValue(source, exportName, filePath) {
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) {
      continue;
    }
    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name)
        && declaration.name.text === exportName
        && declaration.initializer
        && (ts.isStringLiteral(declaration.initializer) || ts.isNoSubstitutionTemplateLiteral(declaration.initializer))
      ) {
        return declaration.initializer.text;
      }
    }
  }
  throw new Error(`Could not find string literal export ${exportName} in ${filePath}`);
}

export async function generateRuntimeModuleSource() {
  const sectionBodies = await Promise.all(
    RUNTIME_SECTIONS.map(async ([relativePath, exportName]) => {
      const absolutePath = resolve(packageRoot, relativePath);
      const source = await readFile(absolutePath, "utf8");
      const value = extractLiteralValue(source, exportName, relativePath);
      return `  // ${relative(packageRoot, absolutePath).replace(/\\/g, "/")}\n${value}`;
    })
  );

  return `// Generated in memory by packages/web/scripts/generate-runtime-module.mjs.
// Edit the runtime section sources, not this assembled module.

declare global {
  interface Window {
    __AGENTS_OFFICE_CLIENT_CONFIG__?: {
      projects?: unknown[];
      pixelOffice?: Record<string, unknown>;
      sceneDefinitions?: Record<string, unknown>;
      eventIconUrls?: Record<string, string>;
      threadItemIconUrls?: Record<string, string>;
      defaultGlobalSceneSettings?: Record<string, unknown>;
      internalSceneSettings?: Record<string, unknown>;
    };
  }
}

export function startClientApp(): void {
${sectionBodies.join("\n\n")}
}
`;
}
