import type { IncomingMessage, ServerResponse } from 'node:http';
import { buildApp } from '../src/app.js'; // resolved as .ts by esbuild at bundle time

// Singleton — reused across requests in Fluid Compute
let appPromise: ReturnType<typeof buildApp> | null = null;

function getApp() {
  if (!appPromise) {
    appPromise = buildApp();
  }
  return appPromise;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const app = await getApp();
  app.server.emit('request', req, res);
}
