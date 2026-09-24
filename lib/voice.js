import { readFileSync } from "node:fs";
import path from "node:path";

const VOICE_PATH = path.join(process.cwd(), "prompts", "voice.md");

let cached;

// Reads prompts/voice.md once per function instance, dropping <!-- comments -->.
export function getVoiceInstructions() {
  if (cached === undefined) {
    cached = readFileSync(VOICE_PATH, "utf8").replace(/<!--[\s\S]*?-->/g, "").trim();
  }
  return cached;
}
