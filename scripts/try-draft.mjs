// Runs a note through the same screen -> news -> draft steps as the bot, without Telegram.
//   npm run try -- "note text here"
//   npm run try -- --audio path/to/voice.ogg
import { readFileSync } from "node:fs";
import { processNote, newsVerifyBlock, checksMessage } from "../lib/pipeline.js";

const args = process.argv.slice(2);
let note;
if (args[0] === "--audio" && args[1]) {
  const mimeType = args[1].endsWith(".mp3") ? "audio/mpeg" : args[1].endsWith(".wav") ? "audio/wav" : "audio/ogg";
  note = { audio: { mimeType, base64: readFileSync(args[1]).toString("base64") } };
} else if (args.join(" ").trim()) {
  note = { text: args.join(" ").trim() };
} else {
  console.error('Usage: npm run try -- "your note here"   or   npm run try -- --audio voice.ogg');
  process.exitCode = 1;
}

// No process.exit() after a fetch: exiting while fetch is still closing crashes Node on Windows.
if (note) {
  const r = await processNote(note);
  if (note.audio) console.log(`Heard: "${r.text}"`);
  console.log(`Score: ${r.score}/10 (${r.drafted ? "drafted" : "no draft"}) - ${r.reason}`);
  if (r.drafted) {
    console.log(`\n${r.post}`);
    if (r.news) console.log(`\n${newsVerifyBlock(r.news)}`);
    console.log(`\n${checksMessage(r.checks) ?? "(checks unavailable)"}`);
  }
}
