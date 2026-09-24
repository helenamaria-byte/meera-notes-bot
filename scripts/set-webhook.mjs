// Points the Telegram bot at the deployed Vercel function.
//   npm run set-webhook    -> register the webhook
//   npm run webhook-info   -> show current webhook status and last error
import { callTelegram } from "../lib/telegram.js";

if (process.argv.includes("--info")) {
  console.log(await callTelegram("getWebhookInfo", {}));
  process.exit(0);
}

const publicUrl = process.env.PUBLIC_URL?.replace(/\/+$/, "");
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
if (!publicUrl || !secret) {
  console.error("Set PUBLIC_URL and TELEGRAM_WEBHOOK_SECRET in .env first.");
  process.exit(1);
}

const url = `${publicUrl}/api/telegram`;
await callTelegram("setWebhook", {
  url,
  secret_token: secret,
  allowed_updates: ["message"],
  drop_pending_updates: true,
});
console.log(`Webhook set to ${url}`);
