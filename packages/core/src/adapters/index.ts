import { claudeAdapter } from "./claude";
import { codexCloudAdapter } from "./codex-cloud";
import { codexLocalAdapter } from "./codex-local";
import { cursorCloudAdapter } from "./cursor-cloud";
import { cursorLocalAdapter } from "./cursor-local";
import { openClawAdapter } from "./openclaw";
import { presenceAdapter } from "./presence";

export * from "./types";

export const PROJECT_ADAPTERS = [
  codexLocalAdapter,
  claudeAdapter,
  cursorLocalAdapter,
  cursorCloudAdapter,
  openClawAdapter,
  presenceAdapter,
  codexCloudAdapter
] as const;
