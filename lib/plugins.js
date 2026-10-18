import fs from "fs-extra";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const commandMap = new Map();
const textPlugins = [];
const msgPlugins = [];
const allPlugins = [];

let _snapshot = null;
let _loadingPromise = null;
let _loadedDir = null;

/**
 * Module(meta)(exec)
 * meta: { name, command?, aliases?, on?: "text"|"message", description?, package? }
 * command/on kichu na dile default "message" (sob message e fire hobe)
 * exec(msg, match, client)
 */
export function Module(meta = {}) {
  return (exec) => {
    if (typeof exec !== "function") {
      console.warn("[plugins] exec function nai:", meta);
      return;
    }

    const hasCmd = meta.command || (Array.isArray(meta.aliases) && meta.aliases.length);
    const on = meta.on || (hasCmd ? undefined : "message");
    const plugin = Object.freeze({ ...meta, on, exec });

    if (plugin.command) {
      if (commandMap.has(plugin.command))
        console.warn(`[plugins] ⚠️ Duplicate command "${plugin.command}"`);
      commandMap.set(plugin.command, plugin);
    }
    if (Array.isArray(plugin.aliases)) {
      for (const a of plugin.aliases) commandMap.set(a, plugin);
    }
    if (plugin.on === "text") textPlugins.push(plugin);
    if (plugin.on === "message") msgPlugins.push(plugin);
    allPlugins.push(plugin);
  };
}

function getSnapshot() {
  return {
    commands: new Map(commandMap),
    text: [...textPlugins],
    message: [...msgPlugins],
    all: [...allPlugins],
  };
}

/** plugins folder er sob .js file auto load */
export async function loadPlugins(dir = path.join(__dirname, "..", "plugins")) {
  const resolved = path.resolve(dir);

  if (allPlugins.length > 0 && _loadedDir === resolved) {
    _snapshot = getSnapshot();
    return _snapshot;
  }

  let files = [];
  try {
    files = (await fs.readdir(resolved)).filter((f) => f.endsWith(".js")).sort();
  } catch (err) {
    console.error("[plugins] folder read hoy nai:", resolved, err?.message || err);
    _snapshot = getSnapshot();
    return _snapshot;
  }

  let failed = 0;
  for (const file of files) {
    try {
      await import(pathToFileURL(path.join(resolved, file)).href);
      console.log(`[plugins] ✅ ${file}`);
    } catch (err) {
      failed++;
      console.error(`[plugins] ❌ ${file}:`, err?.message || err);
    }
  }

  console.log(
    `[plugins] 📦 Commands: ${commandMap.size} | Text: ${textPlugins.length} | Message: ${msgPlugins.length} | Total: ${allPlugins.length}` +
      (failed ? ` | Failed: ${failed}` : "")
  );

  _loadedDir = resolved;
  _snapshot = getSnapshot();
  _loadingPromise = null;
  return _snapshot;
}

/** hot-path sync getter (await korbe na) */
export function ensurePlugins() {
  if (_snapshot) return _snapshot;
  if (!_loadingPromise) {
    _loadingPromise = loadPlugins().catch((e) => {
      console.error("[plugins] load failed:", e?.message || e);
      _loadingPromise = null;
    });
  }
  return { commands: new Map(), text: [], message: [], all: [] };
}

/** startup e await koro */
export async function forceLoadPlugins(dir) {
  if (_snapshot && (!dir || path.resolve(dir) === _loadedDir)) return _snapshot;
  if (_loadingPromise) return _loadingPromise;
  _loadingPromise = loadPlugins(dir);
  return _loadingPromise;
}

export const commands = commandMap;
export const getCommands = () => [...allPlugins];
export const getPluginInfo = () => ({
  commands: [...commandMap.keys()],
  total: allPlugins.length,
  loadedDir: _loadedDir,
});
