// Generates a draft locally, without Telegram — handy for tuning prompts/voice.md.
//   npm run try -- "note text here"
import { draftPost } from "../lib/gemini.js";

const note = process.argv.slice(2).join(" ").trim();
if (!note) {
  console.error('Usage: npm run try -- "your note here"');
  process.exit(1);
}

const { post, checks } = await draftPost(note);
console.log(post);
console.log("\n--- Check before posting ---");
console.log(
  !checks ? "(unavailable)" : checks.length ? checks.map((c) => `• ${c}`).join("\n") : "(nothing to check)"
);
