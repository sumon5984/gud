import fs from "fs";
import path from "path";
import { Api } from "teleproto";
import { Module } from "../lib/plugins.js";

const CFG = {
  groupsOnly: true,      // channel skip
  maxQueue: 100,
  maxTries: 2,
  gapMin: 8000,
  gapMax: 15000,
  seenLimit: 5000,
  file: path.join(process.cwd(), "autojoin_seen.json"),
};

const INVITE_RE = /(?:https?:\/\/)?(?:t|telegram)\.(?:me|dog)\/(?:\+|joinchat\/)([\w-]{16,})/gi;
const TG_INVITE_RE = /tg:\/\/join\?invite=([\w-]{16,})/gi;
const TG_RESOLVE_RE = /tg:\/\/resolve\?domain=([a-zA-Z]\w{3,31})/gi;
const PUBLIC_RE = /(?:https?:\/\/)?(?:t|telegram)\.(?:me|dog)\/([a-zA-Z]\w{3,31})(?:[/?\s]|$)/gi;
const RESERVED = new Set(["joinchat", "addstickers", "share", "proxy", "socks", "c", "s", "iv", "login", "addlist", "boost", "giftcode"]);

const PERMANENT = [
  "INVITE_HASH_EXPIRED", "INVITE_HASH_INVALID", "INVITE_HASH_EMPTY",
  "USERNAME_NOT_OCCUPIED", "USERNAME_INVALID", "USER_BANNED_IN_CHANNEL",
  "CHANNEL_PRIVATE", "CHANNEL_INVALID",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = (a, b) => a + Math.random() * (b - a);

// ---------- seen (persistent) ----------
let seen = new Set();
try {
  seen = new Set(JSON.parse(fs.readFileSync(CFG.file, "utf8")));
} catch {}

let saveTimer = null;
function saveSeen() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.writeFileSync(CFG.file, JSON.stringify([...seen].slice(-CFG.seenLimit)));
    } catch (e) {
      console.log("[autojoin] save fail", e.message);
    }
  }, 2000);
}

// ---------- notify (nijer Saved Messages-e) ----------
async function notify(client, text) {
  console.log("[autojoin]", text.replace(/\n/g, " | "));
  try {
    await client.sendMessage("me", { message: text, linkPreview: false });
  } catch (e) {
    console.log("[autojoin] notify fail", e?.message);
  }
}

const linkOf = (j) => (j.type === "invite" ? `https://t.me/+${j.key}` : `https://t.me/${j.key}`);

// ---------- state ----------
const queue = [];
let working = false;

// ---------- link collect ----------
function collectText(msg, text) {
  const parts = [text || ""];
  const srcs = [msg, msg?.raw, msg?.originalMessage].filter((o) => o && typeof o === "object");
  for (const s of srcs) {
    if (typeof s.message === "string") parts.push(s.message);
    for (const e of s.entities || []) if (e?.url) parts.push(e.url);
    for (const row of s.replyMarkup?.rows || [])
      for (const b of row.buttons || []) if (b?.url) parts.push(b.url);
    const wp = s.media?.webpage;
    if (wp?.url) parts.push(wp.url);
    if (wp?.displayUrl) parts.push(wp.displayUrl);
  }
  return parts.join("\n");
}

function extractJobs(all) {
  const jobs = [];
  for (const m of all.matchAll(INVITE_RE)) jobs.push({ type: "invite", key: m[1] });
  for (const m of all.matchAll(TG_INVITE_RE)) jobs.push({ type: "invite", key: m[1] });
  for (const m of all.matchAll(TG_RESOLVE_RE)) jobs.push({ type: "public", key: m[1] });
  for (const m of all.matchAll(PUBLIC_RE)) {
    if (!RESERVED.has(m[1].toLowerCase())) jobs.push({ type: "public", key: m[1] });
  }
  return jobs;
}

const seenKey = (j) => (j.type === "invite" ? `i:${j.key}` : `p:${j.key.toLowerCase()}`);

// ---------- join logic ----------
async function doInvite(client, hash) {
  const info = await client.invoke(new Api.messages.CheckChatInvite({ hash }));
  if (info instanceof Api.ChatInviteAlready) return { status: "already", title: info.chat?.title };
  const title = info.title;
  if (CFG.groupsOnly && info.broadcast) return { status: "notgroup", title };
  await client.invoke(new Api.messages.ImportChatInvite({ hash }));
  return { status: info.requestNeeded ? "requested" : "joined", title };
}

async function doPublic(client, username) {
  const ent = await client.getEntity(username);
  if (!(ent instanceof Api.Channel)) return { status: "notgroup", title: ent?.firstName || username };
  const title = ent.title;
  if (CFG.groupsOnly && !ent.megagroup) return { status: "notgroup", title };
  if (ent.left === false) return { status: "already", title };
  await client.invoke(new Api.channels.JoinChannel({ channel: ent }));
  return { status: ent.joinRequest ? "requested" : "joined", title };
}

const LABEL = {
  joined: "✅ Joined",
  requested: "📨 Join request pathano hoyeche (admin accept korle join hobe)",
  already: "ℹ️ Already member",
  notgroup: "⏭ Skip (group na)",
};

async function worker(client) {
  if (working) return;
  working = true;
  while (queue.length) {
    const job = queue.shift();
    let real = false;
    try {
      const { status, title } =
        job.type === "invite" ? await doInvite(client, job.key) : await doPublic(client, job.key);
      real = status === "joined" || status === "requested";
      await notify(client, `${LABEL[status]}\n${title ? title + "\n" : ""}${linkOf(job)}`);
    } catch (e) {
      const m = e?.errorMessage || e?.message || String(e);
      if (m.includes("INVITE_REQUEST_SENT")) {
        real = true;
        await notify(client, `${LABEL.requested}\n${linkOf(job)}`);
      } else if (m.includes("USER_ALREADY_PARTICIPANT")) {
        await notify(client, `${LABEL.already}\n${linkOf(job)}`);
      } else if (m.includes("CHANNELS_TOO_MUCH")) {
        await notify(client, `🛑 Limit sesh (CHANNELS_TOO_MUCH), queue bondho. Kichu group chharo.\n${linkOf(job)}`);
        queue.length = 0;
        break;
      } else if (m.includes("FLOOD")) {
        const s = Number(e?.seconds) || 60;
        await notify(client, `⏳ Flood wait ${s}s\n${linkOf(job)}`);
        await sleep((s + 5) * 1000);
        queue.unshift(job);
        continue;
      } else if (PERMANENT.some((p) => m.includes(p))) {
        await notify(client, `⏭ Skip: ${m}\n${linkOf(job)}`);
      } else {
        job.tries = (job.tries || 0) + 1;
        if (job.tries < CFG.maxTries) {
          await notify(client, `⚠️ Error (abar try hobe): ${m}\n${linkOf(job)}`);
          queue.push(job);
        } else {
          await notify(client, `❌ Fail: ${m}\n${linkOf(job)}`);
        }
      }
    }
    await sleep(real ? rnd(CFG.gapMin, CFG.gapMax) : rnd(1000, 2500));
  }
  working = false;
}

// ---------- plugin ----------
Module({
  name: "autojoin",
  on: "text",
  description: "Group link dekhle auto join",
})(async (msg, text, client) => {
  const jobs = extractJobs(collectText(msg, text));
  let added = false;
  for (const j of jobs) {
    const k = seenKey(j);
    if (seen.has(k)) continue;
    if (queue.length >= CFG.maxQueue) break;
    seen.add(k);
    queue.push(j);
    added = true;
  }
  if (added) saveSeen();
  if (queue.length) worker(client);
});