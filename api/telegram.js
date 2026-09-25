import { waitUntil } from "@vercel/functions";
import { processNote, newsVerifyBlock, checksMessage } from "../lib/pipeline.js";
import { sendMessage, sendTyping, downloadFile } from "../lib/telegram.js";

// Longer recordings are rejected to stay well inside Gemini's request size limit.
const MAX_VOICE_SECONDS = 10 * 60;

function allowedChatIds() {
  return (process.env.ALLOWED_CHAT_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

async function handleMessage(message) {
  const chatId = message.chat.id;
  const text = (message.text ?? "").trim();
  const voice = message.voice ?? message.audio;

  if (!allowedChatIds().includes(String(chatId))) {
    // Lets you find Meera's chat ID during setup; strangers get nothing else.
    if (text.startsWith("/start")) {
      await sendMessage(chatId, `This bot is private. Your chat ID is ${chatId}.`);
    }
    return;
  }

  if (text.startsWith("/start") || text.startsWith("/help")) {
    await sendMessage(chatId, "Hi Meera! Send me a note as a text or voice message and I'll reply with a draft post.");
    return;
  }

  if (!text && !voice) {
    await sendMessage(chatId, "I can read text and voice notes. Please type your note or record a voice message.");
    return;
  }

  if (voice && voice.duration > MAX_VOICE_SECONDS) {
    await sendMessage(chatId, "That recording is over 10 minutes. Please send a shorter voice note.", message.message_id);
    return;
  }

  try {
    await sendTyping(chatId).catch(() => {});

    const note = voice
      ? { audio: { mimeType: voice.mime_type || "audio/ogg", base64: await downloadFile(voice.file_id) } }
      : { text };
    const result = await processNote(note);

    // For voice notes, show what was heard so Meera can spot a bad transcription.
    const heard = voice && result.text ? `🎙 I heard: "${result.text}"\n\n` : "";

    if (!result.drafted) {
      await sendMessage(
        chatId,
        `${heard}No draft for this one (${result.score}/10). ${result.reason}\n\n` +
          "Add more detail and send it again if you want a post from it.",
        message.message_id
      );
      return;
    }

    if (heard) await sendMessage(chatId, heard.trim(), message.message_id);

    // The draft (plus the news verify flag, when a news item was used) goes in its own
    // message so it can be copied straight to LinkedIn.
    const draft = result.news ? `${result.post}\n\n${newsVerifyBlock(result.news)}` : result.post;
    await sendMessage(chatId, draft, message.message_id);

    // The score and reason sit above the checks, outside the draft, so the draft stays copyable.
    const rating = `Score: ${result.score}/10. ${result.reason}`;
    const checks = checksMessage(result.checks);
    await sendMessage(chatId, checks ? `${rating}\n\n${checks}` : rating);
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
  // drafts); the Gemini calls keep running in the background until they finish.
  if (message?.chat?.id) {
    waitUntil(handleMessage(message).catch((err) => console.error("Unhandled error:", err)));
  }
  res.status(200).json({ ok: true });
}
