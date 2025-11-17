# WhatsApp Roll Bot - Feature Specification

Purpose

- Provide a small WhatsApp bot that responds to simple commands.

Commands

- `!d<N>` where 2 <= N <= 100
  - Behavior: reply with a random integer from 1..N inclusive.
  - Response example: `🎲 You rolled a *7* on the d20!`
- `!roll d<N>` same behavior as `!d<N>`.
- `!ping`
  - Reply: `pong! 🏓`.
- `!marco`
  - Reply: `polo... ou seria Paulo? 🧲🎤`.
- Pairing/Auth
  - Default flow displays QR in terminal (if `printQRInTerminal` is true).
  - Pairing code flow (`--use-pairing-code`): requests phone number and prints pairing code.

Constraints & Notes

- The bot ignores:
  - messages without message body
  - messages from itself (`fromMe`)
  - newsletters and system messages
- Maximum die sides: 100.
- Uses `@whiskeysockets/baileys` for WhatsApp connection and `ts-qrcode-terminal` for QR printing.

Extensibility

- Central message handler is in `bot.ts` and can be extended for more commands.
