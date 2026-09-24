import { waitUntil } from "@vercel/functions";
import { draftPost } from "../lib/gemini.js";
import { sendMessage, sendTyping } from "../lib/telegram.js";

function allowedChatIds() {
  return (process.env.ALLOWED_CHAT_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

async function handleMessage(message) {
  const chatId = message.chat.id;
  const text = (message.text ?? "").trim();

  if (!allowedChatIds().includes(String(chatId))) {
    // Lets you find Meera's chat ID during setup; strangers get nothing else.
    if (text.startsWith("/start")) {
      await sendMessage(chatId, `This bot is private. Your chat ID is ${chatId}.`);
    }
    return;
  }

  if (text.startsWith("/start") || text.startsWith("/help")) {
    await sendMessage(chatId, "Hi Meera! Send me a note as a text message and I'll reply with a draft post.");
    return;
  }

  if (!text) {
    await sendMessage(chatId, "I can only read text notes for now. Please type or paste your note.");
    return;
  }

  try {
    await sendTyping(chatId).catch(() => {});
    const { post, checks } = await draftPost(text);
    // The draft goes alone in its own message so it can be copied straight to LinkedIn.
    await sendMessage(chatId, post, message.message_id);
    if (checks) {
      await sendMessage(
        chatId,
        checks.length
          ? `Check before posting:\n${checks.map((c) => `• ${c}`).join("\n")}`
          : "Nothing to check: everything in the draft comes from your note."
      );
    }
  } catch (err) {
    console.error("Drafting failed:", err);
    await sendMessage(chatId, "Sorry, I couldn't write a draft for that note. Please try again in a minute.")
      .catch((e) => console.error("Could not send error message:", e));
  }
}

export default function handler(req, res) {
  if (req.method !== "POST") {
    res.status(200).send("Meera notes bot is running.");
    return;
  }

  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret || req.headers["x-telegram-bot-api-secret-token"] !== secret) {
    res.status(401).send("Unauthorized");
    return;
  }

  const message = req.body?.message;

  // Answer Telegram right away so it never retries (which would create duplicate
  // drafts); the Gemini call keeps running in the background until it finishes.
  if (message?.chat?.id) {
    waitUntil(handleMessage(message).catch((err) => console.error("Unhandled error:", err)));
  }
  res.status(200).json({ ok: true });
}
