import { getVoiceInstructions } from "./voice.js";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

// Notes scoring below this are not drafted.
export const MIN_SCORE = 6;

const SCREENING_INSTRUCTIONS = `You screen notes that Meera, founder of the skincare brand Skinstinct,
sends to her ghostwriting bot as text or voice messages. Most notes should become LinkedIn
posts, but she also sends reminders, fragments and other things that are not worth a post.
Your job is to be a strict filter so that only notes with real substance get drafted.

If the note is a voice recording, first transcribe exactly what she says (clean up filler
words like "um" but do not add, reword or summarise anything). Judge the transcript.

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

Output a JSON object:
- "transcript": for a voice note, the transcript; for a text note, an empty string.
- "score": integer 0-10.
- "reason": one short sentence addressed to Meera as "you", saying why it scored that way.
- "search_phrase": if the score is 6 or more, a Google News search phrase of 3-5 terms for
  the broader industry, market or regulatory topic the note touches, worded the way news
  headlines would put it (e.g. "cosmetics labelling rules India", "skincare humidity India",
  "sunscreen SPF claims"). Avoid lab or formulation jargon that journalists don't use
  ("occlusive ratio", "panelists"). Otherwise an empty string.`;

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

News items:
- You may be given a numbered list of recent news items alongside the note. Pick at most
  one. If a news item is genuinely relevant, use it to make the post timely. If none fits
  naturally, ignore them all. Most notes are better with no news than with a forced link.
- You only have each item's headline, publication and date, not the article. Refer only to
  what the headline itself says; do not describe the article's contents, figures or quotes.
- Do not include the link or a source line in the post; that is added separately.

Output: a JSON object with three fields.
- "post": the post text only, with no preamble or surrounding quotes.
- "news_used": the number of the news item the post refers to, or 0 if it uses none.
- "checks": a list of short notes to Meera (one sentence each, addressed to her as "you")
  about anything in the post she should verify because it is not stated in her note:
  an interpretation of something ambiguous, a detail or lesson you filled in, a scientific
  claim she should confirm. Be honest and specific. Use an empty list only if every
  statement in the post comes directly from her note.

--- STYLE GUIDE ---`;

const SCREEN_SCHEMA = {
  type: "OBJECT",
  properties: {
    transcript: { type: "STRING" },
    score: { type: "INTEGER" },
    reason: { type: "STRING" },
    search_phrase: { type: "STRING" },
  },
  required: ["transcript", "score", "reason", "search_phrase"],
};

const DRAFT_SCHEMA = {
  type: "OBJECT",
  properties: {
    post: { type: "STRING" },
    news_used: { type: "INTEGER" },
    checks: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["post", "news_used", "checks"],
};

const RETRYABLE_STATUSES = new Set([429, 500, 503]);
const RETRY_DELAYS_MS = [2000, 5000, 10000];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Sends one request to Gemini and returns the raw response text.
async function generate({ system, parts, schema, temperature }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  const model = process.env.GEMINI_MODEL || "gemini-3.6-flash";

  const request = {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts }],
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

// note is { text } or { audio: { mimeType, base64 } } for a voice message.
// Returns { text, score, reason, searchPhrase }, where text is the note or its transcript.
export async function screenNote(note) {
  const parts = note.audio
    ? [
        { text: "Voice note:" },
        { inline_data: { mime_type: note.audio.mimeType, data: note.audio.base64 } },
      ]
    : [{ text: `Note:\n\n${note.text}` }];

  const raw = await generate({
    system: SCREENING_INSTRUCTIONS,
    parts,
    schema: SCREEN_SCHEMA,
    temperature: 0, // the same note should get the same score
  });

  const parsed = JSON.parse(raw);
  const score = Math.round(Number(parsed.score));
  if (!Number.isFinite(score)) throw new Error(`Gemini returned an invalid score: ${raw}`);
  const text = note.audio ? String(parsed.transcript ?? "").trim() : note.text;
  return {
    text,
    score: Math.min(10, Math.max(0, score)),
    reason: String(parsed.reason ?? "").trim(),
    searchPhrase: String(parsed.search_phrase ?? "").trim(),
  };
}

// newsItems is the result of findNews() (possibly empty).
// Returns { post, news, checks }: the draft, the news item it uses (or null), and things
// Meera should verify before posting.
export async function draftPost(noteText, newsItems = []) {
  const newsBlock = newsItems.length
    ? "\n\nRecent news items (use at most one, only if genuinely relevant):\n" +
      newsItems
        .map((n, i) => `${i + 1}. ${n.headline} (${n.source}, ${n.date})` + (n.summary ? `: ${n.summary}` : ""))
        .join("\n")
    : "";

  const raw = await generate({
    system: `${DRAFTING_INSTRUCTIONS}\n${getVoiceInstructions()}`,
    parts: [{ text: `Here is my note:\n\n${noteText}${newsBlock}` }],
    schema: DRAFT_SCHEMA,
  });

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Shouldn't happen with a response schema, but a plain-text draft is still usable.
    // checks: null means "unknown", so the bot doesn't claim there's nothing to check.
    // Without the JSON we can't tell which news item was used; the pipeline flags that.
    return { post: raw, news: null, newsUnknown: newsItems.length > 0, checks: null };
  }

  const post = String(parsed.post ?? "").trim();
  if (!post) throw new Error("Gemini returned an empty draft");
  const checks = Array.isArray(parsed.checks)
    ? parsed.checks.map((c) => String(c).trim()).filter(Boolean)
    : [];
  const index = Math.round(Number(parsed.news_used));
  const news = index >= 1 && index <= newsItems.length ? newsItems[index - 1] : null;
  return { post, news, newsUnknown: false, checks };
}
