import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { getAppDataDirectory } from "./app-settings";

const HERMES_PLUGIN_NAME = "codex-agents-office";

export interface HermesHookInstallResult {
  hermesHome: string;
  pluginDir: string;
  hookDir: string;
  configPath: string;
}

function expandHomePath(path: string): string {
  if (path === "~") {
    return homedir();
  }
  if (path.startsWith("~/") || path.startsWith("~\\")) {
    return join(homedir(), path.slice(2));
  }
  return path;
}

export function getHermesHooksDir(): string {
  return join(getAppDataDirectory(), "hermes-hooks");
}

export function resolveHermesHome(input?: string | null): string {
  const explicit = input && input.trim().length > 0
    ? input
    : process.env.HERMES_HOME;
  return resolve(expandHomePath(explicit && explicit.trim().length > 0 ? explicit : join(homedir(), ".hermes")));
}

function pluginManifestSource(): string {
  return `name: ${HERMES_PLUGIN_NAME}
version: "0.1.0"
description: "Streams Hermes Agent lifecycle hooks into Agents Office."
author: "Codex Agents Office"
kind: standalone
provides_hooks:
  - on_session_start
  - pre_gateway_dispatch
  - pre_llm_call
  - post_llm_call
  - transform_llm_output
  - pre_tool_call
  - post_tool_call
  - transform_tool_result
  - transform_terminal_output
  - pre_api_request
  - post_api_request
  - pre_approval_request
  - post_approval_response
  - on_session_end
  - on_session_finalize
  - on_session_reset
  - subagent_stop
`;
}

function pluginPythonSource(): string {
  return String.raw`import datetime
import json
import os
from pathlib import Path

_PLUGIN_DIR = Path(__file__).resolve().parent
_CONFIG_PATH = _PLUGIN_DIR / "agents_office_config.json"
_HOOKS = [
    "on_session_start",
    "pre_gateway_dispatch",
    "pre_llm_call",
    "post_llm_call",
    "transform_llm_output",
    "pre_tool_call",
    "post_tool_call",
    "transform_tool_result",
    "transform_terminal_output",
    "pre_api_request",
    "post_api_request",
    "pre_approval_request",
    "post_approval_response",
    "on_session_end",
    "on_session_finalize",
    "on_session_reset",
    "subagent_stop",
]


def _load_config():
    try:
        with _CONFIG_PATH.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
        if isinstance(data, dict):
            return data
    except Exception:
        pass
    return {}


def _configured_hook_dir():
    config = _load_config()
    return config.get("hook_dir") or os.environ.get("CODEX_AGENTS_OFFICE_HERMES_HOOK_DIR")


def _write_status(event_name, error=None):
    try:
        hook_dir = _configured_hook_dir()
        if not hook_dir:
            return None
        path = Path(hook_dir)
        path.mkdir(parents=True, exist_ok=True)
        status = {
            "hook_source": "hermes-plugin-hooks",
            "status_event_name": event_name,
            "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "plugin_dir": str(_PLUGIN_DIR),
            "config_path": str(_CONFIG_PATH),
            "hook_dir": str(path),
            "process_cwd": os.getcwd(),
            "hermes_home": os.environ.get("HERMES_HOME"),
            "pid": os.getpid(),
            "hooks": list(_HOOKS),
        }
        if error is not None:
            status["error"] = str(error)
        with (path / "codex-agents-office.status.json").open("w", encoding="utf-8") as handle:
            json.dump(status, handle, ensure_ascii=False, default=repr, indent=2)
            handle.write("\n")
    except Exception:
        return None
    return None


def _jsonable(value, depth=0):
    if depth > 5:
        return repr(value)
    if isinstance(value, str):
        return value if len(value) <= 3000 else value[:3000] + "...[truncated]"
    if value is None or isinstance(value, (int, float, bool)):
        return value
    if isinstance(value, (list, tuple, set)):
        return [_jsonable(entry, depth + 1) for entry in list(value)[:20]]
    if isinstance(value, dict):
        return {
            str(key): _jsonable(entry, depth + 1)
            for key, entry in list(value.items())[:60]
        }
    if hasattr(value, "__dict__"):
        return {
            "_type": value.__class__.__name__,
            **{
                str(key): _jsonable(entry, depth + 1)
                for key, entry in list(vars(value).items())[:60]
                if not str(key).startswith("_")
            },
        }
    return repr(value)


def _session_id_from(event_name, payload):
    for key in ("session_id", "session_key", "task_id", "tool_call_id"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    event = payload.get("event")
    if isinstance(event, dict):
        for key in ("session_id", "session_key", "conversation_id", "id"):
            value = event.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    return "process-%s" % os.getpid()


def _record(event_name, **kwargs):
    try:
        hook_dir = _configured_hook_dir()
        if not hook_dir:
            return None

        payload = {str(key): _jsonable(value) for key, value in kwargs.items()}
        session_id = _session_id_from(event_name, payload)
        cwd = (
            os.environ.get("HERMES_CWD")
            or os.environ.get("TERMINAL_CWD")
            or os.getcwd()
        )
        record = {
            "hook_source": "hermes-plugin-hooks",
            "hook_event_name": event_name,
            "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "session_id": session_id,
            "cwd": cwd,
            "process_cwd": os.getcwd(),
            "hermes_home": os.environ.get("HERMES_HOME"),
            "pid": os.getpid(),
            "payload": payload,
        }

        path = Path(hook_dir)
        path.mkdir(parents=True, exist_ok=True)
        out = path / ("%s.jsonl" % session_id.replace("/", "_").replace("\\", "_"))
        with out.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(record, ensure_ascii=False, default=repr) + "\n")
    except Exception as exc:
        _write_status("record_error", exc)
        return None
    return None


def _make_hook(event_name):
    def _hook(**kwargs):
        return _record(event_name, **kwargs)
    return _hook


def register(ctx):
    try:
        for event_name in _HOOKS:
            ctx.register_hook(event_name, _make_hook(event_name))
        _write_status("registered")
    except Exception as exc:
        _write_status("register_error", exc)
        raise
`;
}

function pluginConfigSource(hookDir: string): string {
  return `${JSON.stringify({ hook_dir: hookDir }, null, 2)}\n`;
}

function enablePluginInConfig(raw: string): string {
  if (new RegExp(`(^|\\n)\\s*-\\s*${HERMES_PLUGIN_NAME}\\s*(\\n|$)`).test(raw)) {
    return raw.endsWith("\n") ? raw : `${raw}\n`;
  }

  const lines = raw.split(/\r?\n/);
  const pluginsIndex = lines.findIndex((line) => /^plugins:\s*$/.test(line));
  if (pluginsIndex < 0) {
    return `${raw.replace(/\s*$/, "")}\n\nplugins:\n  enabled:\n    - ${HERMES_PLUGIN_NAME}\n`;
  }

  const enabledIndex = lines.findIndex((line, index) =>
    index > pluginsIndex && /^  enabled:\s*$/.test(line)
  );
  if (enabledIndex >= 0) {
    lines.splice(enabledIndex + 1, 0, `    - ${HERMES_PLUGIN_NAME}`);
    return `${lines.join("\n").replace(/\s*$/, "")}\n`;
  }

  lines.splice(pluginsIndex + 1, 0, "  enabled:", `    - ${HERMES_PLUGIN_NAME}`);
  return `${lines.join("\n").replace(/\s*$/, "")}\n`;
}

export async function installHermesAgentsOfficePlugin(input: {
  hermesHome?: string | null;
  hookDir?: string | null;
} = {}): Promise<HermesHookInstallResult> {
  const hermesHome = resolveHermesHome(input.hermesHome);
  const hookDir = resolve(expandHomePath(input.hookDir && input.hookDir.trim().length > 0
    ? input.hookDir
    : getHermesHooksDir()));
  const pluginDir = join(hermesHome, "plugins", HERMES_PLUGIN_NAME);
  const configPath = join(hermesHome, "config.yaml");

  await mkdir(pluginDir, { recursive: true });
  await mkdir(hookDir, { recursive: true });
  await writeFile(join(pluginDir, "plugin.yaml"), pluginManifestSource(), "utf8");
  await writeFile(join(pluginDir, "__init__.py"), pluginPythonSource(), "utf8");
  await writeFile(join(pluginDir, "agents_office_config.json"), pluginConfigSource(hookDir), "utf8");

  await mkdir(dirname(configPath), { recursive: true });
  const existingConfig = await readFile(configPath, "utf8").catch(() => "");
  await writeFile(configPath, enablePluginInConfig(existingConfig), "utf8");

  return {
    hermesHome,
    pluginDir,
    hookDir,
    configPath
  };
}
