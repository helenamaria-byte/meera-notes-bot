import { getVoiceInstructions } from "./voice.js";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

const TASK_INSTRUCTIONS = `You are Meera's ghostwriter. She is a founder who sends you rough notes,
and you turn each note into a finished draft post she can publish.

Rules:
- Write exactly in the voice described in the style guide below.
- Keep her ideas, facts and opinions; do not invent claims, numbers, names or events.
- The style guide's examples (figures, products, stories) describe past posts. Only use
  them if the note mentions them. If the note has no specific data, do not make any up.
- Reply with the post text only: no preamble, no explanation, no surrounding quotes.
- Use plain text. Do not use Markdown formatting such as **bold** or # headings.

--- STYLE GUIDE ---`;

export async function draftPost(note) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";

  const res = await fetch(`${API_BASE}/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      system_instruction: {
        parts: [{ text: `${TASK_INSTRUCTIONS}\n${getVoiceInstructions()}` }],
      },
      contents: [{ role: "user", parts: [{ text: `Here is my note:\n\n${note}` }] }],
    }),
  });

  const data = await res.json().catch(() => ({}));
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
