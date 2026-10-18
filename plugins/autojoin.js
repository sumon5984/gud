import { Api } from "teleproto";
import { Module } from "../lib/plugins.js";

const INVITE_RE = /(?:https?:\/\/)?(?:t|telegram)\.me\/(?:\+|joinchat\/)([\w-]{16,})/gi;
const PUBLIC_RE = /(?:https?:\/\/)?(?:t|telegram)\.me\/([a-zA-Z][\w]{3,31})(?:[/?\s]|$)/gi;
const RESERVED = new Set(["joinchat", "addstickers", "share", "proxy", "socks", "c", "s", "iv", "login"]);

const seen = new Set();
const queue = [];
let working = false;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function joinInvite(client, hash) {
  await client.invoke(new Api.messages.ImportChatInvite({ hash }));
}

async function joinPublic(client, username) {
  const ent = await client.getEntity(username);
  if (!(ent instanceof Api.Channel) || !ent.megagroup) return false; // shudhu group
  await client.invoke(new Api.channels.JoinChannel({ channel: ent }));
  return true;
}

async function worker(client) {
  if (working) return;
  working = true;
  while (queue.length) {
    const job = queue.shift();
    try {
      if (job.type === "invite") await joinInvite(client, job.key);
      else await joinPublic(client, job.key);
      console.log("[autojoin] joined", job.key);
    } catch (e) {
      const m = e?.errorMessage || e?.message || String(e);
      if (m.startsWith("FLOOD_WAIT") || m.includes("FLOOD")) {
        const s = Number(e?.seconds) || 60;
        console.warn(`[autojoin] flood wait ${s}s`);
        await sleep((s + 5) * 1000);
        queue.unshift(job); // abar try
        continue;
      }
      console.log("[autojoin] skip", job.key, m);
    }
    await sleep(8000 + Math.random() * 7000); // 8-15s gap
  }
  working = false;
}

Module({
  name: "autojoin",
  on: "text",
  description: "Group link dekhle auto join",
})(async (msg, text, client) => {
  const jobs = [];
  for (const m of text.matchAll(INVITE_RE)) jobs.push({ type: "invite", key: m[1] });
  for (const m of text.matchAll(PUBLIC_RE)) {
    const u = m[1];
    if (!RESERVED.has(u.toLowerCase()) && !/^\+/.test(u)) jobs.push({ type: "public", key: u });
  }

  for (const j of jobs) {
    const k = `${j.type}:${j.key.toLowerCase()}`;
    if (seen.has(k)) continue;
    seen.add(k);
    queue.push(j);
  }
  if (queue.length) worker(client);
});