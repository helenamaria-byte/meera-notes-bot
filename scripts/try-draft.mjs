// Generates a draft locally, without Telegram — handy for tuning prompts/voice.md.
//   npm run try -- "note text here"
import { draftPost } from "../lib/gemini.js";

const note = process.argv.slice(2).join(" ").trim();
if (!note) {
  console.error('Usage: npm run try -- "your note here"');
  process.exit(1);
}

console.log(await draftPost(note));
