import { getPairCode , initPairing} from "./lib/pair.js";
// t.js

async function testPairing() {
  console.log("🚀 1000+ User Pairing Test শুরু হয়েছে...\n");

  const startTime = Date.now();

  console.log("🔄 initPairing() কল করা হচ্ছে...");
  await initPairing();
  console.log("✅ initPairing() সম্পন্ন\n");

  const requests = [];

  for (let i = 1; i <= 1000; i++) {
    const number = Math.floor(100000000000 + Math.random() * 900000000000);

    requests.push(
      (async () => {
        try {
          const code = await getPairCode(number);
          console.log(`✅ ${i}. ${number} -> ${code}`);
        } catch (err) {
          console.error(`❌ ${i}. ${number} -> Error:`, err.message);
        }
      })()
    );
  }

  await Promise.all(requests);

  const totalTime = Date.now() - startTime;

  console.log("\n🎉 TEST সম্পন্ন হয়েছে!");
  console.log(`⏱️ Total time: ${Math.round(totalTime / 1000)} seconds`);
  console.log(`📊 Total requests: 1000`);
  console.log(`✅ Success: ${requests.filter(r => !r.error).length}`);
}

testPairing().catch(console.error);