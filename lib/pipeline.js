import { screenNote, draftPost, MIN_SCORE } from "./gemini.js";
import { findNews } from "./news.js";

// Screen -> news -> draft. note is { text } or { audio: { mimeType, base64 } }.
// Returns either
//   { drafted: false, text, score, reason }
//   { drafted: true,  text, score, reason, post, news, checks }   (news is null if unused)
export async function processNote(note) {
  const { text, score, reason, searchPhrase } = await screenNote(note);
  console.log(`Note scored ${score}/10: ${reason}`);
  if (score < MIN_SCORE || !text) return { drafted: false, text, score, reason };

  // A missing news angle shouldn't cost Meera her draft, so failures here are non-fatal.
  let newsItems = [];
  try {
    newsItems = await findNews(searchPhrase);
    console.log(`News for "${searchPhrase}": ${newsItems.length} items`);
  } catch (err) {
    console.warn("News lookup failed:", err.message);
  }

  const { post, news, newsUnknown, checks } = await draftPost(text, newsItems);
  console.log("News used:", news?.headline ?? "none");
  // If we can't tell whether news was used, never let that pass silently.
  const finalChecks = newsUnknown
    ? ["This draft may refer to a news story, but I couldn't confirm which one: check any news claim before posting."]
    : checks;
  return { drafted: true, text, score, reason, post, news, checks: finalChecks };
}

// The verify flag required on every draft that uses a news item.
export function newsVerifyBlock(news) {
  return [
    "────────────",
    `NEWS SOURCE: ${news.headline}`,
    `FROM: ${news.source} · ${news.date}`,
    `LINK: ${news.link}`,
    "⚠️ Check this before publishing - you are the author of this claim",
  ].join("\n");
}

export function checksMessage(checks) {
  if (!checks) return null;
  return checks.length
    ? `Check before posting:\n${checks.map((c) => `• ${c}`).join("\n")}`
    : "Nothing to check: everything in the draft comes from your note.";
}
