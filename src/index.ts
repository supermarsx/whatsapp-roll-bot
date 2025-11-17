/**
 * Module entrypoint: export the `start` function and run it when invoked
 * directly from node. This keeps the program modular for testing while
 * allowing `node dist/bot.js` to start the bot in production.
 */
import { start } from './bot'

export default start

if (require.main === module) {
    start().catch((err) => {
        // use application logger
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const logger = require('./logger').default
        logger.error('Uncaught error starting bot:', err)
        process.exit(1)
    })
}
