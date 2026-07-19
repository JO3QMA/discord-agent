import { loadConfig } from "./config.js";
import { startDiscordBot } from "./discord/bot.js";

async function main() {
  const cfg = loadConfig();
  await startDiscordBot(cfg);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
