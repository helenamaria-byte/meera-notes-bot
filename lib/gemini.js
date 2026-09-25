import { getVoiceInstructions } from "./voice.js";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

// Notes scoring below this are not drafted.
export const MIN_SCORE = 6;

const SCORING_INSTRUCTIONS = `You screen notes that Meera, founder of the skincare brand Skinstinct,
texts to her ghostwriting bot. Most notes should become LinkedIn posts, but she also sends
reminders, fragments and other things that are not worth a post. Your job is to be a strict
filter so that only notes with real substance get drafted.

Score the note from 0 to 10 for how much usable substance it gives for a LinkedIn post in her
voice. Her posts are about formulation science, ingredients, customer experiences, industry
practices, and honest founder lessons, grounded in specific situations, data and admitted
mistakes.

Scale:
- 0-1: Not an idea at all: a task, reminder, logistics, errand, meeting time, shopping or
  to-do item ("call the manufacturer tomorrow", "send invoice to Priya").
- 2-3: An abandoned or unclear fragment, a bare topic with nothing said about it
  ("niacinamide thing", "post about pH?"), or something personal with no business angle.
- 4-5: There is a real seed of an idea, but it is too thin to write from without inventing
  most of the content: no situation, observation, opinion or detail.
- 6-7: Enough for a short post: a specific situation, observation, customer interaction,
  opinion or lesson that can be written up without making things up.
- 8-10: Strong: a specific story, data point, test result or clear argument, the kind of
  material her best posts are built on.

Judge only what the note actually contains, not what a good writer could invent around it.
When unsure between two bands, choose the lower one.

Output a JSON object: "score" (integer 0-10) and "reason" (one short sentence addressed to
Meera as "you", saying why it scored that way).`;

const DRAFTING_INSTRUCTIONS = `You are Meera's ghostwriter. She is a founder who sends you rough notes,
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
- If the note is ambiguous, keep the post equally ambiguous or pick the reading that is
  least damaging to her and her company. Never state or imply that her products caused
  harm, a reaction or a complaint unless the note clearly says so. (Example: "all products
  giving her pimples" does not say whose products.)
- If the note hints at something without saying it (e.g. "learned from my mistake" without
  saying what the lesson was), keep that part brief and general rather than inventing
  specifics.
- Use plain text in the post. Do not use Markdown formatting such as **bold** or # headings.

Output: a JSON object with two fields.
- "post": the post text only, with no preamble or surrounding quotes.
- "checks": a list of short notes to Meera (one sentence each, addressed to her as "you")
  about anything in the post she should verify because it is not stated in her note:
  an interpretation of something ambiguous, a detail or lesson you filled in, a scientific
  claim she should confirm. Be honest and specific. Use an empty list only if every
  statement in the post comes directly from her note.

--- STYLE GUIDE ---`;

const SCORE_SCHEMA = {
  type: "OBJECT",
  properties: {
    score: { type: "INTEGER" },
    reason: { type: "STRING" },
  },
  required: ["score", "reason"],
};

const DRAFT_SCHEMA = {
  type: "OBJECT",
  properties: {
    post: { type: "STRING" },
    checks: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["post", "checks"],
};

const RETRYABLE_STATUSES = new Set([429, 500, 503]);
const RETRY_DELAYS_MS = [2000, 5000, 10000];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Sends one request to Gemini and returns the raw response text.
async function generate({ system, user, schema, temperature }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  const model = process.env.GEMINI_MODEL || "gemini-3.6-flash";

  const request = {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: schema,
        ...(temperature !== undefined ? { temperature } : {}),
      },
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
    throw new Error(`Gemini returned no content (${reason})`);
  }
  return text;
}

// Returns { score, reason }: how much substance the note has for a post, 0-10.
export async function scoreNote(note) {
  const text = await generate({
    system: SCORING_INSTRUCTIONS,
    user: `Note:\n\n${note}`,
    schema: SCORE_SCHEMA,
    temperature: 0, // the same note should get the same score
  });

  const parsed = JSON.parse(text);
  const score = Math.round(Number(parsed.score));
  if (!Number.isFinite(score)) throw new Error(`Gemini returned an invalid score: ${text}`);
  return {
    score: Math.min(10, Math.max(0, score)),
    reason: String(parsed.reason ?? "").trim(),
  };
}

// Returns { post, checks }: the draft, plus things Meera should verify before posting.
export async function draftPost(note) {
  const text = await generate({
    system: `${DRAFTING_INSTRUCTIONS}\n${getVoiceInstructions()}`,
    user: `Here is my note:\n\n${note}`,
    schema: DRAFT_SCHEMA,
  });

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Shouldn't happen with a response schema, but a plain-text draft is still usable.
    // checks: null means "unknown", so the bot doesn't claim there's nothing to check.
    return { post: text, checks: null };
  }

  const post = String(parsed.post ?? "").trim();
  if (!post) throw new Error("Gemini returned an empty draft");
  const checks = Array.isArray(parsed.checks)
    ? parsed.checks.map((c) => String(c).trim()).filter(Boolean)
    : [];
  return { post, checks };
}
