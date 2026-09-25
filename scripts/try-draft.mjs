// Runs a note through the same score-then-draft steps as the bot, without Telegram.
//   npm run try -- "note text here"
//   npm run try -- --score-only "note text here"   (1 Gemini request instead of 2)
import { draftPost, scoreNote, MIN_SCORE } from "../lib/gemini.js";

const args = process.argv.slice(2);
const scoreOnly = args[0] === "--score-only";
const note = (scoreOnly ? args.slice(1) : args).join(" ").trim();
if (!note) {
  console.error('Usage: npm run try -- [--score-only] "your note here"');
  process.exit(1);
}

const { score, reason } = await scoreNote(note);
const drafted = score >= MIN_SCORE;
console.log(`Score: ${score}/10 (${drafted ? "will draft" : "no draft"}) - ${reason}`);

// No process.exit() here: exiting while fetch is still closing crashes Node on Windows.
if (drafted && !scoreOnly) {
  const { post, checks } = await draftPost(note);
  console.log(`\n${post}`);
  console.log("\n--- Check before posting ---");
  console.log(
    !checks ? "(unavailable)" : checks.length ? checks.map((c) => `• ${c}`).join("\n") : "(nothing to check)"
  );
}
