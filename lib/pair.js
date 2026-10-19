import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  Browsers
} from "baileys";

import pino from "pino";
import fs from "node:fs";
import path from "node:path";

// ==========================================
// CONFIGURATION
// ==========================================

const SESSIONS_DIR = path.resolve(
  process.cwd(),
  "sessions"
);

const getPositiveInt = (name, fallback) => {
  const value = Number.parseInt(process.env[name] || "", 10);

  return Number.isSafeInteger(value) && value > 0
    ? value
    : fallback;
};

const MAX_CONCURRENT = 100;
const MAX_QUEUE = 5000;

/*
// সর্বোচ্চ একসঙ্গে কতগুলো pairing পরিচালনা হবে
const MAX_CONCURRENT = getPositiveInt(
  "PAIR_MAX_CONCURRENT",
  40
);

// সর্বোচ্চ কতগুলো request queue-তে অপেক্ষা করতে পারবে
const MAX_QUEUE = getPositiveInt(
  "PAIR_MAX_QUEUE",
  2000
);
*/
// তোমার আগের cleanup time বজায় রাখা হয়েছে
const SOCKET_TTL_MS = getPositiveInt(
  "PAIR_SOCKET_TTL_MS",
  3000
);

// ==========================================
// GLOBAL STATE
// ==========================================

let warm = null;

// Baileys version-এর জন্য একই Promise reuse হবে
let versionPromise = null;

// Concurrency manager
let activePairs = 0;
const waitingQueue = [];

// ==========================================
// VERSION CACHE
// ==========================================

async function getCachedVersion() {
  if (!versionPromise) {
    versionPromise = fetchLatestBaileysVersion()
      .then(({ version }) => version)
      .catch((err) => {
        // ব্যর্থ হলে পরের request-এ পুনরায় চেষ্টা করবে
        versionPromise = null;
        throw err;
      });
  }

  return versionPromise;
}

// ==========================================
// ASYNC FOLDER CLEANUP
// ==========================================

function clean(dir) {
  fs.promises
    .rm(dir, {
      recursive: true,
      force: true
    })
    .catch((err) => {
      console.error(
        "[pairing] Folder cleanup failed:",
        err.message
      );
    });
}

// ==========================================
// CONCURRENCY MANAGER
// ==========================================

function createRelease() {
  let released = false;

  return () => {
    if (released) return;

    released = true;

    // অপেক্ষারত request থাকলে পরবর্তীটিকে slot দাও
    const next = waitingQueue.shift();

    if (next) {
      next(createRelease());
      return;
    }

    activePairs--;
  };
}

function acquireSlot() {
  // এখনই slot পাওয়া গেলে queue এড়িয়ে যাও
  if (activePairs < MAX_CONCURRENT) {
    activePairs++;

    return Promise.resolve(createRelease());
  }

  // Waiting queue-এর সর্বোচ্চ সীমা
  if (waitingQueue.length >= MAX_QUEUE) {
    return Promise.reject(
      new Error(
        "PAIR_QUEUE_FULL: Server is busy. Please retry later."
      )
    );
  }

  // FIFO queue-তে অপেক্ষা করো
  return new Promise((resolve) => {
    waitingQueue.push(resolve);
  });
}

// ==========================================
// DESTROY SOCKET
// ==========================================

function destroy(entry) {
  if (!entry || entry.dead) return;

  entry.dead = true;

  if (entry.timer) {
    clearTimeout(entry.timer);
    entry.timer = null;
  }

  try {
    entry.sock.ev.removeAllListeners();
  } catch {}

  try {
    entry.sock.end(undefined);
  } catch {}

  clean(entry.dir);

  // একই slot যেন দুইবার release না হয়
  if (entry.release) {
    entry.release();
    entry.release = null;
  }
}

// ==========================================
// CREATE SOCKET
// ==========================================

async function spawn() {
  await fs.promises.mkdir(SESSIONS_DIR, {
    recursive: true
  });

  const dir = path.join(
    SESSIONS_DIR,
    `tmp-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 10)}`
  );

  try {
    // প্রতিবার version fetch না করে cache ব্যবহার
    const version = await getCachedVersion();

    await fs.promises.mkdir(dir, {
      recursive: true
    });

    const {
      state,
      saveCreds
    } = await useMultiFileAuthState(dir);

    const sock = makeWASocket({
      auth: state,
      version,

      logger: pino({
        level: "silent"
      }),

      printQRInTerminal: false,

      browser: Browsers.ubuntu("Chrome"),

      markOnlineOnConnect: false
    });

    const entry = {
      sock,
      dir,

      used: false,
      dead: false,

      p: null,
      timer: null,
      release: null,

      ready: null
    };

    sock.ev.on(
      "creds.update",
      saveCreds
    );

    // Socket ready হওয়া পর্যন্ত অপেক্ষা
    entry.ready = new Promise((resolve) => {
      const handler = (update) => {
        if (
          update.qr ||
          update.connection === "open" ||
          update.connection === "close"
        ) {
          sock.ev.off(
            "connection.update",
            handler
          );

          resolve(update);
        }
      };

      sock.ev.on(
        "connection.update",
        handler
      );
    });

    // Socket বন্ধ হলে cleanup
    sock.ev.on(
      "connection.update",
      ({ connection }) => {
        if (
          connection !== "close" ||
          entry.dead
        ) {
          return;
        }

        // ব্যবহার না হওয়া Warm Socket বন্ধ হলে
        // stale Promise সরিয়ে দাও
        if (
          !entry.used &&
          warm === entry.p
        ) {
          warm = null;
        }

        destroy(entry);
      }
    );

    return entry;

  } catch (err) {
    clean(dir);
    throw err;
  }
}

// ==========================================
// WARM SOCKET MANAGER
// ==========================================

function warmUp() {
  // একই সময়ে একাধিক Warm Socket তৈরি আটকাও
  if (warm) {
    return warm;
  }

  const p = spawn();

  warm = p;

  p.then(
    (entry) => {
      entry.p = p;

      // Socket তৈরি হওয়ার আগেই বন্ধ হয়ে গেলে
      // stale Warm Socket রাখা হবে না
      if (
        entry.dead &&
        warm === p
      ) {
        warm = null;
      }
    },

    (err) => {
      if (warm === p) {
        warm = null;
      }

      console.error(
        "[pairing] Warm socket failed:",
        err.message
      );
    }
  );

  return p;
}

// ==========================================
// INITIALIZE
// ==========================================

export async function initPairing() {
  const entry = await warmUp();

  await entry.ready;

  if (entry.dead) {
    throw new Error(
      "Warm socket closed before becoming ready"
    );
  }

  console.log(
    "[pairing] Warm socket ready"
  );
}

// ==========================================
// GET PAIRING CODE
// ==========================================

export async function getPairCode(number) {
  number = String(number ?? "")
    .replace(/\D/g, "");

  if (!number) {
    throw new Error(
      "Valid phone number required"
    );
  }

  // Pairing শুরু করার আগে একটি concurrency slot নাও
  const releaseSlot = await acquireSlot();

  let entry = null;
  let released = false;

  // Slot মাত্র একবার release হবে
  const releaseOnce = () => {
    if (released) return;

    released = true;
    releaseSlot();
  };

  try {
    // বর্তমান Warm Socket নাও
    const p = warmUp();

    // Socket-টি claim করো
    if (warm === p) {
      warm = null;
    }

    // পরবর্তী request-এর জন্য নতুন Warm Socket শুরু করো
    warmUp();

    entry = await p;

    if (entry.dead) {
      throw new Error(
        "Warm socket closed before pairing"
      );
    }

    entry.used = true;
    entry.release = releaseOnce;

    await entry.ready;

    if (entry.dead) {
      throw new Error(
        "Socket disconnected before pairing"
      );
    }

    // Pairing code তৈরি
    const code = await entry.sock.requestPairingCode(
      number
    );

    // আগের আচরণ বজায় রাখা হয়েছে
    entry.timer = setTimeout(() => {
      destroy(entry);
    }, SOCKET_TTL_MS);

    entry.timer.unref?.();

    return code;

  } catch (err) {
    if (entry && !entry.dead) {
      // destroy-এর মাধ্যমে slot release হবে
      if (!entry.release) {
        entry.release = releaseOnce;
      }

      destroy(entry);
    } else {
      releaseOnce();
    }

    throw err;
  }
}