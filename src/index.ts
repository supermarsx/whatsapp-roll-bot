import { start } from './bot';

export default start;

// If a subcommand is provided, delegate to the CLI module which implements management commands
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
