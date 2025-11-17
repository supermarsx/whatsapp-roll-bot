import start from './src/index';

if (require.main === module) {
  start().catch(err => {
    console.error('Uncaught error starting bot:', err);
    process.exit(1);
  });
}

export default start;
