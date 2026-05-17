import 'dotenv/config';
import Fastify from 'fastify';

const PORT = Number(process.env.PORT ?? 4000);
const HOST = process.env.HOST ?? '0.0.0.0';

const app = Fastify({
  logger: {
    transport:
      process.env.NODE_ENV === 'production'
        ? undefined
        : { target: 'pino-pretty', options: { translateTime: 'SYS:HH:MM:ss.l', ignore: 'pid,hostname' } },
  },
});

app.get('/healthz', async () => ({
  status: 'ok',
  service: 'aegis-api',
  version: '0.0.1',
  network: process.env.STELLAR_NETWORK ?? 'testnet',
}));

async function main() {
  try {
    await app.listen({ port: PORT, host: HOST });
    app.log.info(`Aegis API listening on http://${HOST}:${PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
