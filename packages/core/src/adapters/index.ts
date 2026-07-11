import { claudeAdapter } from "./claude";
import { codexCloudAdapter } from "./codex-cloud";
import { codexLocalAdapter } from "./codex-local";
import { cursorCloudAdapter } from "./cursor-cloud";
import { cursorLocalAdapter } from "./cursor-local";
import { hermesAdapter } from "./hermes";
import { openClawAdapter } from "./openclaw";
import { presenceAdapter } from "./presence";

export * from "./types";
export * from "./contract-harness";

export const PROJECT_ADAPTERS = [
  codexLocalAdapter,
  claudeAdapter,
  cursorLocalAdapter,
  cursorCloudAdapter,
  hermesAdapter,
  openClawAdapter,
  presenceAdapter,
  codexCloudAdapter
] as const;
