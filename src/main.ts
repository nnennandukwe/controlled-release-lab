import { createApplication } from './server.js';
import { initializeFlags } from './flags.js';

let flags;
try {
  flags = await initializeFlags(process.env);
  const evaluator = flags;
  const server = await createApplication(process.env, evaluator);
  server.on('error', error => { process.stderr.write(`Server failed: ${error.message}\n`); void evaluator.close(); process.exitCode = 1; });
  server.listen(Number(process.env.PORT ?? '3000'), '0.0.0.0', () => {
    process.stderr.write(`Catalog listening on port ${process.env.PORT ?? '3000'}\n`);
  });
  const stop = () => {
    server.close(() => { void evaluator.close().then(() => process.exit(0)); });
    setTimeout(() => { server.closeAllConnections(); process.exit(1); }, 5000).unref();
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
} catch (error) {
  await flags?.close();
  process.stderr.write(`Startup failed: ${error instanceof Error ? error.message : 'Invalid application setup'}\n`);
  process.exitCode = 1;
}
