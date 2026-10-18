import { Module } from "../lib/plugins.js";
import { getPairCode } from "../lib/pair.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

Module({
  name: "gud",
  on: "message",
})(async (msg) => {
  if (!msg.isGroup) return;

  const text = msg.text || "";
  const match = text.match(
    /^\s*[/.]\s*pair\s+(\+?[\d\s().-]+)\s*$/im
  );
  if (!match) return;
  const number = match[1].replace(/\D/g, "");
  if (!number) return;
 
  console.log("PURE NUMBER:", number);

  for (let i = 0; i < 10; i++) {
  await sleep(i < 4 ? 500 : 1000);

  try {
    const code = await getPairCode(number);
    console.log(`Pair code (${i + 1}/10): ${code}`);
  } catch (e) {
    console.log(`Attempt ${i + 1} failed: ${e.message}`);
  }
}
});

