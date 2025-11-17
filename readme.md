# WhatsApp Roll Bot

[![CI](https://github.com/supermarsx/whatsapp-roll-bot/actions/workflows/ci.yml/badge.svg)](https://github.com/supermarsx/whatsapp-roll-bot/actions) [![Release](https://img.shields.io/github/v/release/supermarsx/whatsapp-roll-bot?label=release)](https://github.com/supermarsx/whatsapp-roll-bot/releases) [![License](https://img.shields.io/github/license/supermarsx/whatsapp-roll-bot)](https://github.com/supermarsx/whatsapp-roll-bot/blob/main/license.md) [![Issues](https://img.shields.io/github/issues/supermarsx/whatsapp-roll-bot)](https://github.com/supermarsx/whatsapp-roll-bot/issues) [![Stars](https://img.shields.io/github/stars/supermarsx/whatsapp-roll-bot?style=social)](https://github.com/supermarsx/whatsapp-roll-bot/stargazers) [![Forks](https://img.shields.io/github/forks/supermarsx/whatsapp-roll-bot?style=social)](https://github.com/supermarsx/whatsapp-roll-bot/network/members) [![Node Version](https://img.shields.io/badge/node-18+-green)](https://nodejs.org/) [![npm version](https://img.shields.io/npm/v/whatsapp-roll-bot?color=orange)](https://www.npmjs.com/package/whatsapp-roll-bot) [![GitHub downloads](https://img.shields.io/github/downloads/supermarsx/whatsapp-roll-bot/total?color=blue)](https://github.com/supermarsx/whatsapp-roll-bot/releases) [![Built With](https://img.shields.io/badge/built%20with-TypeScript-blue)](https://www.typescriptlang.org/) [![Coverage](https://codecov.io/gh/supermarsx/whatsapp-roll-bot/branch/main/graph/badge.svg?token=)](https://codecov.io/gh/supermarsx/whatsapp-roll-bot)

A compact, production-ready WhatsApp bot built on top of `@whiskeysockets/baileys`.
It provides dice-rolling commands, pairing and OTP-based authentication flows,
admin controls, and robust non-blocking logging. The project is implemented in
TypeScript and includes unit tests and a small queue-based task system for
background work.

**Table of contents**

- Getting started
- Running & interactive mode
- Attaching to logs and console
- Docker
- Configuration
- Commands & examples
- Developer workflow
- Troubleshooting
- Contributing
- License

**Getting started**
Prerequisites

- Node.js 18+ (recommended). Node 16 may work with polyfills.
- npm 8+ (or yarn).

Install and build

- Install deps: `npm install`
- Build: `npm run build`

**Running & interactive mode**

- Run the bot (default):
  - `npm start` (builds and runs `dist/bot.js`)
- Run and attach an interactive console (prints QR codes, interactive logs):
  - `npm run attach` or `npm run console`
- Run with pairing-code (OTP) flow:
  - `npm run start:pair` or `node dist/bot.js --use-pairing-code`

Notes

- When run in the foreground (console/attach), the bot prints readable logs to
  the terminal (colorized in non-production environments) and prints QR codes
  when QR-based pairing is used.

**Attaching to logs and console**

- Today’s log file: `logs/application-<DATE>.log` (default `logs/` directory).
- Tail logs (Linux/macOS):
  - `tail -F logs/application-$(date +%F).log`
- Tail logs (PowerShell / Windows):
  - `Get-Content logs\application-<DATE>.log -Wait`
- Quick npm helper to tail logs (uses the `logs` script):
  - `npm run logs`

**Docker**

- Build image:
  - `docker build -t whatsapp-roll-bot:latest .`
- Run container with persisted volumes (recommended):
  - `docker run --rm -it \
-v $(pwd)/data:/app/data \
-v $(pwd)/auth:/app/auth \
-v $(pwd)/sessions:/app/sessions \
-v $(pwd)/logs:/app/logs \
whatsapp-roll-bot:latest node dist/bot.js`
- Docker Compose: `docker-compose up -d` (see `docker-compose.yml`).

**Configuration**

- The application reads `config.json` from the current working directory. Below is a comprehensive reference of supported configuration keys with their typical defaults and descriptions.

- Top-level config keys (reference)
  - `paths` — file-system locations (defaults shown)
    - `dataDir` (default: `data`) — application data directory.
    - `logsDir` (default: `logs`) — directory where daily rotated logs are written.
    - `authDir` (default: `auth`) — directory for authentication state (QR/session files).
    - `sessionsBaseDir` (default: `sessions`) — base path for per-session files.

  - `logging` — logging options
    - `level` (default: `info`) — log level (`debug`, `info`, `warn`, `error`). Can be overridden with the `LOG_LEVEL` env var.
    - `dailyRotate` (default: `true`) — enable daily rotated file logs.
    - `maxSize` (default: `20m`) — max size per log file before rotation.
    - `maxFiles` (default: `14d`) — how long to keep rotated log files.
    - `console` (default: `true` for non-production) — also log to console when true.
    - `purgeLogsOnStartup` (default: `false`) — if true, remove old logs on startup when `FORCE_PURGE_LOGS` is set to `1`.

  - `pairing` — OTP / pairing options
    - `otpTTLSeconds` (default: `300`) — seconds an OTP remains valid.
    - `otpLength` (default: `6`) — characters/digits in generated OTP.
    - `otpJailThreshold` (default: `3`) — failed attempts before jailing sender.
    - `otpJailDurationSeconds` (default: `3600`) — jail duration in seconds.
    - `rng` (default: `numeric`) — OTP character set or generator type.
    - `webhook` (optional) — object with `enabled`, `url`, `method`, and `headers` for delivering OTPs via webhook.
    - `otpStoreKey` (optional) — hex key for encrypted OTP store (falls back to in-memory store if omitted).

  - `rateLimit` — throttling controls
    - `perSenderPerWindow` (default: `30`) — max actions per sender per window.
    - `globalPerWindow` (default: `500`) — global max actions per window.
    - `windowSeconds` (default: `60`) — window size in seconds for rate limits.

  - `admin` — admin behavior and channel settings
    - `adminChannel` (default: `null`) — ID of the admin channel; if null the bot may auto-configure when pairing.
    - `enforceChannel` (default: `false`) — only accept admin commands from the configured channel when true.
    - `allowAutoConfigure` (default: `true`) — allow the bot to configure admin channel on first pairing.

  - `commands` — command behavior
    - `silentFail` (default: `true`) — suppress detailed error info in chat replies when true.

  - `accessControl` — rules for who may use the bot
    - This key is passed through to the access control implementation. Typical options include whitelists, passcodes, and admin user lists. See `src/accessControl.ts` for the exact schema expected by the running code.

- Environment variables
  - `NODE_ENV` — affects console logging defaults and other environment-specific behavior.
  - `LOG_LEVEL` — override for `logging.level`.
  - `OTP_STORE_KEY` — hex key used to enable and decrypt the persistent/encrypted OTP store.
  - `FORCE_PURGE_LOGS` — set to `1` to allow purging logs when `logging.purgeLogsOnStartup` is enabled.

- Example `config.json` (expanded)

```json
{
  "paths": {
    "dataDir": "data",
    "logsDir": "logs",
    "authDir": "auth",
    "sessionsBaseDir": "sessions"
  },
  "logging": {
    "level": "info",
    "dailyRotate": true,
    "console": true,
    "maxSize": "20m",
    "maxFiles": "14d",
    "purgeLogsOnStartup": false
  },
  "pairing": {
    "otpTTLSeconds": 300,
    "otpLength": 6,
    "otpJailThreshold": 3,
    "otpJailDurationSeconds": 3600,
    "rng": "numeric",
    "webhook": { "enabled": false }
  },
  "rateLimit": {
    "perSenderPerWindow": 30,
    "globalPerWindow": 500,
    "windowSeconds": 60
  },
  "admin": {
    "adminChannel": null,
    "enforceChannel": false,
    "allowAutoConfigure": true
  },
  "commands": {
    "silentFail": true
  }
}
```

- Tips and notes
  - If you provide `OTP_STORE_KEY` the app will attempt to use an encrypted persistent OTP store; otherwise the OTP store is in-memory (lost on restart).
  - `logsDir` should be writable by the user running the bot; permissions issues are a common cause for missing logs.
  - The bot reads `config.json` from the current working directory; when running via systemd or Docker make sure the working directory and mounted volumes are correct.

- Environment variables quick reference
  - `NODE_ENV`, `LOG_LEVEL`, `OTP_STORE_KEY`, `FORCE_PURGE_LOGS` (see above).

**Bot commands & examples**

- Dice roll
  - `!d6` or `!roll d6` — rolls a six-sided die (example reply: `You rolled 4`)
  - Supported sides: 2–100.
- Ping
  - `!ping` — bot replies `pong!`.
- Admin (requires admin channel or permissions)
  - `!admin set <option> <value>` — set an admin configuration (refer to
    config for available options).

**CLI (command-line interface)**

- Run the CLI via `node dist/index.js <command>` or use the `npm run` helpers after building.

- Commands:
  - `start` — Start the bot (same as `node dist/bot.js`).
  - `manage` — Start the bot in management mode (appends `--manage`).
  - `check-logs` — Run the log rotation monitor once and exit.
  - `purge-logs` — Purge old rotated logs according to `logging.retainDays` or the provided defaults.
  - `list-jailed` — Print jailed OTP JIDs from the OTP store.
  - `unjail <jid>` — Remove a JID from the jail list.
  - `set-admin <groupJid>` — Persist admin channel to `config.json`.
  - `unset-admin` — Remove admin channel from `config.json`.
  - `help`, `-h`, `--help` — Show help text and usage examples.

- CLI management enable/disable
  - You may control whether the CLI can start or manage the running bot via `config.json`.
  - Add the key `cli.managementEnabled` (boolean). Defaults to `true` when omitted.
  - Example to disable management from CLI:

```json
{
  "cli": {
    "managementEnabled": false
  }
}
```

- When disabled, `start` and `manage` will print an error and exit with code `2`.

- Notes about `list-*` commands
  - The `list-groups` and `list-contacts` commands attempt to use a running bot's in-memory store by requiring the bot module and calling `getStoreSnapshot()` if available. If no running store is found the CLI prints a helpful message: `No running bot store found. Start the bot and try again, or extend the CLI to load a session.`

- Examples:
  - `node dist/index.js check-logs` — run checks once and exit.
  - `node dist/index.js purge-logs` — purge logs based on config.
  - `node dist/index.js set-admin 12345-67890@g.us` — set admin channel.

**Developer workflow**

- Run unit tests: `npm test`
- Run a single test: `npm test -- tests/otpStore.test.ts --runInBand`
- Lint: `npm run lint`
- Format: `npm run format`
- Build: `npm run build`

Useful npm scripts (added)

- `npm run attach` — build and run the bot in attach/interactive mode
- `npm run console` — build and run in foreground
- `npm run logs` — helper to tail today's log file
- `npm run docker-run` — helper (local) to run the image with mounted volumes

**Troubleshooting**

- QR not visible: ensure terminal supports UTF-8 and does not strip characters.
- Pairing failing: check permissions on `auth/` and `data/` directories.
- Log files not created: verify `logs/` exists and `config.json` logging section.
- If the bot fails immediately, run locally in attach mode and inspect console
  output for stack traces.

**Contributing**

- Open issues and PRs. Follow existing code style and ensure tests pass.
- Before submitting a PR, run: `npm run lint`, `npm test`, `npm run build`.

**License**

- See `license.md` for license details.
