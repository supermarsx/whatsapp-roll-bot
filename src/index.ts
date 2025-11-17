/**
 * Application entry point
 *
 * This module re-exports the bot's `start` function as its default export so
 * other modules can import and run the application programmatically. When the
 * file is executed directly (node ./dist/index.js) it also acts as a small
 * CLI dispatcher: if the first command-line argument matches a known
 * subcommand the script delegates to the CLI module (`./cli`), otherwise it
 * starts the bot.
 *
 * The module intentionally keeps the top-level logic minimal: the real
 * application lifecycle is implemented in `./bot` and management commands in
 * `./cli`. This file simply wires those pieces together for convenience.
 *
 * @module index
 */

import { start } from './bot';

/**
 * Default export: the bot's start function. Use this to programmatically start
 * the application: `import start from './index'; await start();`
 *
 * @type {() => Promise<void>}
 */
export default start;

/**
 * If a subcommand is provided, delegate to the CLI module which implements
 * management commands. The set contains the names of supported subcommands.
 * @constant {Set<string>}
 */
const CLI_COMMANDS = new Set([
  'check-logs',
  'purge-logs',
  'list-jailed',
  'unjail',
  'set-admin',
  'unset-admin',
  'start',
  'manage',
  'help',
]);

// When the module is the main script, either delegate to the CLI or start the
// bot. This mirrors common Node.js patterns for modules that are both usable
// as libraries and executable scripts.
if (require.main === module) {
  const argv = process.argv.slice(2);
  if (argv.length > 0 && CLI_COMMANDS.has(argv[0])) {
    // delegate to CLI script
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('./cli');
  } else {
    // default behaviour: start the bot (handles --use-pairing-code and --qr-only via bot.ts)
    start().catch(err => {
      // use application logger
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const logger = require('./logger').default;
      logger.error('Uncaught error starting bot:', err);
      process.exit(1);
    });
  }
}
