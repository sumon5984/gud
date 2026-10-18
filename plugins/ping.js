import { Module } from "../lib/plugins.js";
import { getPairCode } from "../lib/pair.js";

Module({
  name: "ping",
  command: "ping",
  aliases: ["p"],
  description: "bot alive check",
  package: "general",
})(async (msg) => {
if (msg.isGroup) return;
  console.log("[ping] exec start");
  const t = Date.now();
  const r = await Promise.race([
    msg.send("pong"),
    new Promise((_, rej) => setTimeout(() => rej(new Error("send timeout 10s")), 10000)),
  ]);
  console.log("[sent]", r?.id);
  await msg.send("me", `latency: ${Date.now() - t}ms`);
});

Module({
  command: "pair",
  description: "Get WhatsApp pairing code",
  package: "general",
})(async (msg, match) => {
if (msg.isGroup) return;
  try {
    const number = String(match || "").replace(/\D/g, "");

    // Number required
    if (!number) {
      return await msg.send(
        "❌ Please provide a WhatsApp number.\n\nExample:\n.pair 919876543210"
      );
    }

    // Basic number validation
    if (number.length < 10 || number.length > 15) {
      return await msg.send(
        "❌ Invalid phone number.\n\nPlease use country code.\nExample: .pair 919876543210"
      );
    }

    const code = await getPairCode(number);

    if (!code) {
      return await msg.send("❌ Failed to generate pairing code.");
    }

    await msg.send(
      `╭───〔 PAIRING CODE 〕───╮\n` +
      `│ 📱 Number: ${number}\n` +
      `│ 🔑 Code: ${code}\n` +
      `╰────────────────────╯`
    );

  } catch (e) {
    console.error("Pair Error:", e);

    await msg.send(
      `❌ Pairing failed.\n\n${e?.message || "Unknown error"}`
    );
  }
});