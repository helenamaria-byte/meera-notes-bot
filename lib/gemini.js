import { getVoiceInstructions } from "./voice.js";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

const TASK_INSTRUCTIONS = `You are Meera's ghostwriter. She is a founder who sends you rough notes,
and you turn each note into a finished draft post she can publish.

Rules:
- Write exactly in the voice described in the style guide below.
- Keep her ideas, facts and opinions; do not invent claims, numbers, names or events.
- The style guide's examples (figures, products, stories) describe past posts. Only use
  them if the note mentions them. If the note has no specific data, do not make any up.
- Stick strictly to what the note says. Do not add details about how something happened
  (e.g. "a customer emailed us" when the note only says "a customer said"), extra test
  results, or claims about her products, company or customers that the note doesn't make.
- You may briefly explain well-established chemistry to walk through a mechanism, but do
  not state how common an effect is ("frequently", "most people") without a figure from
  the note.
- A short note should become a short post. Do not pad it out.
- Reply with the post text only: no preamble, no explanation, no surrounding quotes.
- Use plain text. Do not use Markdown formatting such as **bold** or # headings.

--- STYLE GUIDE ---`;

const RETRYABLE_STATUSES = new Set([429, 500, 503]);
const RETRY_DELAYS_MS = [2000, 5000, 10000];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function draftPost(note) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  const model = process.env.GEMINI_MODEL || "gemini-3.6-flash";

  const request = {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      system_instruction: {
        parts: [{ text: `${TASK_INSTRUCTIONS}\n${getVoiceInstructions()}` }],
      },
      contents: [{ role: "user", parts: [{ text: `Here is my note:\n\n${note}` }] }],
    }),
  };

  // Gemini is sometimes briefly overloaded (503) or rate-limited (429); wait and
  // retry instead of failing. Total wait stays well inside Vercel's 60s limit.
  let res, data;
  for (const delay of [0, ...RETRY_DELAYS_MS]) {
    if (delay) await sleep(delay);
    res = await fetch(`${API_BASE}/${encodeURIComponent(model)}:generateContent`, request);
    data = await res.json().catch(() => ({}));
    if (!RETRYABLE_STATUSES.has(res.status)) break;
    console.warn(`Gemini ${res.status}, retrying: ${data?.error?.message ?? ""}`);
  }

  if (!res.ok) {
    throw new Error(`Gemini API ${res.status}: ${data?.error?.message ?? "unknown error"}`);
  }

  const candidate = data.candidates?.[0];
  const text = candidate?.content?.parts
    ?.map((p) => p.text ?? "")
    .join("")
    .trim();

  if (!text) {
    const reason = candidate?.finishReason ?? data.promptFeedback?.blockReason ?? "no content";
    throw new Error(`Gemini returned no draft (${reason})`);
  }
  return text;
}
