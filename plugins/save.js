import fs from "fs-extra";
import { Module } from "../lib/plugins.js";

// kono media message e reply diye .save likho -> downloads/ e save hobe
Module({
  name: "save-media",
  command: "save",
  description: "reply kora media download",
  package: "tools",
})(async (msg) => {
  const target = await msg.getReply();
  if (!target?.hasMedia) return msg.send("Media te reply koro");

  await fs.ensureDir("downloads");
  const file = `downloads/${target.chatId}_${target.id}`;
  await target.download(file);
  await msg.send(`saved: ${file}`);

  // upload/send back example:
  // await msg.sendFile(file, { caption: "done" });
  // await msg.sendFile("me", file);
});
