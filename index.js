import "dotenv/config";
import { TelegramClient } from "teleproto";
import { StringSession } from "teleproto/sessions";
import { NewMessage } from "teleproto/events";
import input from "input";
import { forceLoadPlugins, ensurePlugins } from "./lib/plugins.js";
import { Msg } from "./lib/message.js";
import { initPairing } from "./lib/pair.js";

const apiId = Number(process.env.API_ID);
const apiHash = process.env.API_HASH || "";
const PREFIX = ".";
if (!apiId || !apiHash) {
  console.error("API_ID / API_HASH .env e dao");
  process.exit(1);
}

const client = new TelegramClient(
  new StringSession(process.env.TG_SESSION || ""),
  apiId,
  apiHash,
  { connectionRetries: 5 }
);

await client.start({
  phoneNumber: () => input.text("Phone: "),
  password: () => input.text("2FA password: "),
  phoneCode: () => input.text("Code: "),
  onError: console.error,
});

if (!process.env.TG_SESSION) {
  console.log("\nTG_SESSION (.env e rakho):\n" + client.session.save() + "\n");
}

await client.getDialogs({ limit: 100 });
await initPairing();
await forceLoadPlugins();


async function run(plugin, msg, match) {
  try {
    await plugin.exec(msg, match, client);
  } catch (err) {
    console.error(`[plugin:${plugin.name || plugin.command || "?"}]`, err?.message || err);
  }
}

client.addEventHandler(async (event) => {
  const raw = event.message;
  
  if (!raw) return;

  const msg = new Msg(client, raw);
  const { commands, text, message } = ensurePlugins();


  const body = msg.text.slice(PREFIX.length).trim();
  const [cmd, ...rest] = body.split(/\s+/);
  const plugin = commands.get(cmd?.toLowerCase());
  if (plugin) {
    msg.command = cmd.toLowerCase();
    msg.args = rest.join(" ");
    console.log("[run]", cmd);
    await run(plugin, msg, msg.args);
    console.log("[done]", cmd);
  }


  // 2) text plugins
  if (msg.text) for (const p of text) run(p, msg, msg.text);

  // 3) all-message plugins (image, sticker, video...)
  for (const p of message) run(p, msg, msg.text);
}, new NewMessage({}));

console.log("✅ Userbot running");
