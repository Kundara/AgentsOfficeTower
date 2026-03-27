import { CLIENT_RUNTIME_SOURCE } from "./runtime-source";
import "./styles.css";

declare global {
  interface Window {
    __AGENTS_OFFICE_CLIENT_CONFIG__?: {
      projects?: unknown[];
      pixelOffice?: Record<string, unknown>;
      eventIconUrls?: Record<string, string>;
      threadItemIconUrls?: Record<string, string>;
      defaultGlobalSceneSettings?: Record<string, unknown>;
      internalSceneSettings?: Record<string, unknown>;
    };
  }
}

new Function(CLIENT_RUNTIME_SOURCE)();

