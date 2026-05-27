// ProviderIQ — API Core Server Entry
// Express + tRPC headless service
// Powered by Inquantic.Ai

import { config } from 'dotenv';
import { resolve } from 'node:path';

// Load .env from monorepo root
config({ path: resolve(import.meta.dirname, '../../../.env') });

import express from 'express';
import cors from 'cors';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { createContext } from './trpc/context.js';
import { appRouter } from './trpc/router.js';

import type { Express } from 'express';

const app: Express = express();
const port = process.env['API_PORT'] ?? 4000;

app.use(cors({ origin: '*' }));
app.use(express.json());

// Inquantic.Ai Branding header middleware
app.use((req, res, next) => {
  res.setHeader('X-Powered-By', 'Inquantic.Ai ProviderIQ');
  next();
});

// tRPC express gateway
app.use(
  ['/trpc', '/api/trpc'],
  createExpressMiddleware({
    router: appRouter,
    createContext,
  })
);

// Simple healthcheck endpoints
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    engine: 'Inquantic.Ai Provider Intelligence Platform API',
    timestamp: new Date(),
  });
});

if (process.env['NODE_ENV'] !== 'production') {
  app.listen(port, () => {
    console.log(`[ProviderIQ Server] Live & listening on http://localhost:${port}`);
    console.log(`[ProviderIQ Server] tRPC endpoints exposed at http://localhost:${port}/trpc`);
  });
}

export default app;
