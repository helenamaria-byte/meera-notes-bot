# Meera notes bot

Meera texts a note to a Telegram bot → the bot sends it to Gemini with her voice
instructions → the draft post comes back in the same chat, as a reply to her note.

```
api/telegram.js      Vercel function that receives Telegram webhooks
lib/gemini.js        Gemini API call + the fixed ghostwriting instructions
lib/telegram.js      Telegram API helpers (send, split long messages, typing)
lib/voice.js         Loads prompts/voice.md
prompts/voice.md     Meera's voice instructions  <- edit this
scripts/             set-webhook and local try-draft helpers
```

## Setup

1. **Create the bot.** In Telegram, message @BotFather, send `/newbot`, and copy the token.
2. **Get a Gemini key** at https://aistudio.google.com/apikey.
3. **Add the voice instructions** to `prompts/voice.md`.
4. **Deploy to Vercel.** Push this folder to a GitHub repo and import it in Vercel
   (or run `npx vercel` here). No build settings are needed.
5. **Add environment variables** in Vercel → Settings → Environment Variables
   (see `.env.example`): `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`,
   `GEMINI_API_KEY`, `GEMINI_MODEL`, and leave `ALLOWED_CHAT_IDS` empty for now.
   Redeploy after adding them.
6. **Connect Telegram to Vercel.** Locally, copy `.env.example` to `.env`, fill in the
   token, secret and `PUBLIC_URL` (your `https://….vercel.app` address), then run:
   ```
   npm install
   npm run set-webhook
   ```
7. **Lock it to Meera.** Have Meera send `/start` to the bot. It replies with her chat ID.
   Put that number in `ALLOWED_CHAT_IDS` in Vercel and redeploy. From then on only her
   chat gets drafts; everyone else is ignored.

## Tuning the voice

Edit `prompts/voice.md` and redeploy. To test changes without Telegram:

```
npm run try -- "note: we hit 1,000 customers today, mostly word of mouth"
```

## Troubleshooting

- `npm run webhook-info` shows Telegram's last delivery error, if any.
- Vercel → your project → Logs shows errors from the function (for example a bad
  Gemini key or model name).
- If drafts fail with a model error, set `GEMINI_MODEL` to a current model name
  from https://ai.google.dev/gemini-api/docs/models.
