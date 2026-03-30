import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface AppSettings {
  version: 1;
  integrations: {
    cursorApiKey: string | null;
  };
  multiplayer: {
    enabled: boolean;
    host: string | null;
    room: string | null;
    nickname: string | null;
  };
}

export interface CursorIntegrationSettings {
  configured: boolean;
  source: "none" | "env" | "stored";
  maskedKey: string | null;
  storedConfigured: boolean;
  storedMaskedKey: string | null;
}

export interface MultiplayerSettings {
  enabled: boolean;
  host: string;
  room: string;
  nickname: string;
  configured: boolean;
}

const DEFAULT_APP_SETTINGS: AppSettings = {
  version: 1,
  integrations: {
    cursorApiKey: null
  },
  multiplayer: {
    enabled: false,
    host: null,
    room: null,
    nickname: null
  }
};

let cachedSettings: AppSettings | null = null;

function normalizeSecret(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeAppSettings(input: unknown): AppSettings {
  const record = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const integrations = record.integrations && typeof record.integrations === "object"
    ? record.integrations as Record<string, unknown>
    : {};
  const multiplayer = record.multiplayer && typeof record.multiplayer === "object"
    ? record.multiplayer as Record<string, unknown>
    : {};
  const host = normalizeSecret(multiplayer.host);
  const room = normalizeSecret(multiplayer.room);
  const hasCredentials = Boolean(host && room);

  return {
    version: 1,
    integrations: {
      cursorApiKey: normalizeSecret(integrations.cursorApiKey)
    },
    multiplayer: {
      enabled: Boolean(multiplayer.enabled) && hasCredentials,
      host,
      room,
      nickname: normalizeSecret(multiplayer.nickname)
    }
  };
}

function configRootDirectory(): string {
  const codexHome = normalizeSecret(process.env.CODEX_HOME);
  if (codexHome) {
    return join(codexHome, "codex-agents-office");
  }

  if (process.platform === "win32") {
    const localAppData = normalizeSecret(process.env.LOCALAPPDATA) ?? normalizeSecret(process.env.APPDATA);
    if (localAppData) {
      return join(localAppData, "CodexAgentsOffice");
    }
  }

  const xdgConfigHome = normalizeSecret(process.env.XDG_CONFIG_HOME);
  if (xdgConfigHome) {
    return join(xdgConfigHome, "codex-agents-office");
  }

  return join(homedir(), ".codex-agents-office");
}

export function getAppSettingsFilePath(): string {
  return join(configRootDirectory(), "settings.json");
}

function readStoredAppSettingsSync(): AppSettings {
  if (cachedSettings) {
    return cachedSettings;
  }

  const filePath = getAppSettingsFilePath();
  try {
    if (!existsSync(filePath)) {
      cachedSettings = {
        ...DEFAULT_APP_SETTINGS,
        integrations: { ...DEFAULT_APP_SETTINGS.integrations },
        multiplayer: { ...DEFAULT_APP_SETTINGS.multiplayer }
      };
      return cachedSettings;
    }

    const raw = readFileSync(filePath, "utf8");
    cachedSettings = normalizeAppSettings(JSON.parse(raw));
    return cachedSettings;
  } catch {
    cachedSettings = {
      ...DEFAULT_APP_SETTINGS,
      integrations: { ...DEFAULT_APP_SETTINGS.integrations },
      multiplayer: { ...DEFAULT_APP_SETTINGS.multiplayer }
    };
    return cachedSettings;
  }
}

async function writeStoredAppSettings(settings: AppSettings): Promise<void> {
  const filePath = getAppSettingsFilePath();
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(settings, null, 2) + "\n", "utf8");
  cachedSettings = settings;
}

export function getStoredCursorApiKeySync(): string | null {
  return readStoredAppSettingsSync().integrations.cursorApiKey;
}

export async function setStoredCursorApiKey(apiKey: string | null): Promise<void> {
  const currentSettings = readStoredAppSettingsSync();
  const nextSettings: AppSettings = {
    version: 1,
    integrations: {
      cursorApiKey: normalizeSecret(apiKey)
    },
    multiplayer: { ...currentSettings.multiplayer }
  };
  await writeStoredAppSettings(nextSettings);
}

export function getStoredMultiplayerSettingsSync(): MultiplayerSettings {
  const stored = readStoredAppSettingsSync().multiplayer;
  const host = stored.host ?? "";
  const room = stored.room ?? "";
  const nickname = stored.nickname ?? "";
  const configured = Boolean(host && room);
  return {
    enabled: configured && stored.enabled === true,
    host,
    room,
    nickname,
    configured
  };
}

export async function setStoredMultiplayerSettings(settings: {
  enabled?: boolean;
  host?: string | null;
  room?: string | null;
  nickname?: string | null;
} | null): Promise<void> {
  const currentSettings = readStoredAppSettingsSync();
  const host = normalizeSecret(settings?.host);
  const room = normalizeSecret(settings?.room);
  const nickname = normalizeSecret(settings?.nickname);
  const configured = Boolean(host && room);
  const nextSettings: AppSettings = {
    version: 1,
    integrations: { ...currentSettings.integrations },
    multiplayer: {
      enabled: configured && settings?.enabled === true,
      host,
      room,
      nickname
    }
  };
  await writeStoredAppSettings(nextSettings);
}

function maskSecret(secret: string | null): string | null {
  if (!secret) {
    return null;
  }
  if (secret.length <= 8) {
    return "*".repeat(Math.max(secret.length, 4));
  }
  return `${secret.slice(0, 4)}...${secret.slice(-4)}`;
}

export function describeCursorIntegrationSettings(): CursorIntegrationSettings {
  const envKey = normalizeSecret(process.env.CURSOR_API_KEY);
  const storedKey = getStoredCursorApiKeySync();
  if (envKey) {
    return {
      configured: true,
      source: "env",
      maskedKey: maskSecret(envKey),
      storedConfigured: storedKey !== null,
      storedMaskedKey: maskSecret(storedKey)
    };
  }

  if (storedKey) {
    return {
      configured: true,
      source: "stored",
      maskedKey: maskSecret(storedKey),
      storedConfigured: true,
      storedMaskedKey: maskSecret(storedKey)
    };
  }

  return {
    configured: false,
    source: "none",
    maskedKey: null,
    storedConfigured: false,
    storedMaskedKey: null
  };
}

export function describeStoredMultiplayerSettings(): MultiplayerSettings {
  return getStoredMultiplayerSettingsSync();
}

export function resetAppSettingsCacheForTest(): void {
  cachedSettings = null;
}
