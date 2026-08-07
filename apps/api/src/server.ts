import { buildApp } from './app.js';
import { loadConfig } from './config.js';

/** Entry point: load config, build the app, and start listening. */
async function main(): Promise<void> {
  const config = loadConfig();
  const app = await buildApp(config);

  try {
    await app.listen({ port: config.port, host: config.host });
    app.log.info(
      { aiConfigured: config.azureOpenAI !== null },
      `API listening on http://${config.host}:${config.port}`,
    );
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void main();
