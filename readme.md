# WhatsApp Roll Bot (TypeScript)

Overview
- A small WhatsApp bot using `@whiskeysockets/baileys` that listens for messages and responds to commands:
  - `!d<number>` or `!roll d<number>` — rolls a die with the given sides (supported sides: 2–100).
  - `!ping` — replies `pong! 🏓`.
  - `!marco` — replies `polo... ou seria Paulo? 🧲🎤`.
- Supports two authentication modes:
  - QR code (default) — prints QR in terminal.
  - Pairing code — pass `--use-pairing-code` to use the pairing code flow.

Source
- TypeScript source lives in `bot.ts`. Build output is written to `dist/`.

Quickstart
1. Install dependencies:
   - `npm install`
2. Upgrade packages (optional, recommended): see "Upgrade to latest" below.
3. Build and run:
   - `npm run run` (builds to `dist/` and runs `node dist/bot.js`).
   - `npm start` (alias).
4. For pairing code auth:
   - `node dist/bot.js --use-pairing-code`

Scripts
- `npm run compile` — compiles TypeScript to `dist/`.
- `npm run build` — alias for compile.
- `npm run run` — build then run compiled app.
- `npm run start` — same as run.
- `npm test` — runs unit tests (Jest).
- `npm run lint` — runs ESLint.
- `npm run format` — runs Prettier to format code.

Configuration & Logs
- Logs are written by the app to `./wa-logs.txt` (configured in the source logger).
- Authentication data (by default) stored under `baileys_auth_info`.

CI
- The repository includes a GitHub Actions workflow at `.github/workflows/ci.yml` which runs format, lint, tests, and build.

Contributing
- Please open PRs against TypeScript source and ensure `npm run lint`, `npm test`, and `npm run build` pass.
