import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  Browsers
} from "baileys";

import pino from "pino";
import fs from "node:fs";
import path from "node:path";

let warm = null;

// Sessions folder-এর absolute path
const SESSIONS_DIR = path.resolve(process.cwd(), "sessions");

const clean = (dir) => {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (err) {
    console.error("[pairing] Folder cleanup failed:", err.message);
  }
};

function destroy(entry) {
  if (!entry || entry.dead) return;

  entry.dead = true;

  try {
    entry.sock.ev.removeAllListeners();
  } catch {}

  try {
    entry.sock.end(undefined);
  } catch {}

  clean(entry.dir);
}

async function spawn() {
  // Parent directory আগে নিশ্চিতভাবে তৈরি করো।
  // useMultiFileAuthState() কলের আগে এটি থাকা জরুরি।
  await fs.promises.mkdir(SESSIONS_DIR, {
    recursive: true
  });

  // প্রতিটি socket-এর জন্য আলাদা session folder
  const dir = path.join(
    SESSIONS_DIR,
    `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );

  // Parent folder তৈরি হওয়ার পর auth state তৈরি হবে
  const { state, saveCreds } = await useMultiFileAuthState(dir);

  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    auth: state,
    version,
    logger: pino({ level: "silent" }),
    printQRInTerminal: false,
    browser: Browsers.ubuntu("Chrome"),
    markOnlineOnConnect: false
  });

  sock.ev.on("creds.update", saveCreds);

  const entry = {
    sock,
    dir,
    used: false,
    dead: false,
    p: null
  };

  entry.ready = new Promise((resolve) => {
    const h = (update) => {
      if (
        update.qr ||
        update.connection === "open" ||
        update.connection === "close"
      ) {
        sock.ev.off("connection.update", h);
        resolve();
      }
    };

    sock.ev.on("connection.update", h);
  });

  sock.ev.on("connection.update", ({ connection }) => {
    if (connection !== "close" || entry.dead) return;

    const wasIdle = !entry.used;

    destroy(entry);

    // Idle warm socket বন্ধ হয়ে গেলে নতুন socket তৈরি করো
    if (wasIdle && warm === entry.p) {
      warmUp();
    }
  });

  return entry;
}

function warmUp() {
  const p = spawn();

  p.then((entry) => {
    entry.p = p;
  }).catch((err) => {
    console.error("[pairing] Warm socket failed:", err.message);
  });

  warm = p;

  return p;
}

export async function initPairing() {
  const entry = await warmUp();

  await entry.ready;

  console.log("[pairing] Warm socket ready");
}

export async function getPairCode(number) {
  if (!warm) {
    throw new Error("initPairing() call hoyni");
  }

  number = String(number).replace(/\D/g, "");

  if (!number) {
    throw new Error("Valid phone number required");
  }

  // বর্তমান warm socket claim করো
  const p = warm;

  // পরবর্তী request-এর জন্য নতুন socket তৈরি করো
  warmUp();

  const entry = await p;

  entry.used = true;

  try {
    await entry.ready;

    const code = await entry.sock.requestPairingCode(number);

    // আগের আচরণ বজায় রাখা হয়েছে
    setTimeout(() => destroy(entry), 3000);

    return code;
  } catch (err) {
    destroy(entry);
    throw err;
  }
}