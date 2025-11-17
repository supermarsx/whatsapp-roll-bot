import { start } from './bot'

export default start

if (require.main === module) {
    start().catch((err) => {
        console.error('Uncaught error starting bot:', err)
        process.exit(1)
    })
}
