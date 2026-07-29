import 'reflect-metadata';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import { router } from './routes';
import { vnpayRouter } from './routes/vnpay.routes';
import {
  createVnpayPayment,
  handleVnpayIpn,
  handleVnpayReturn,
} from './controllers/vnpay.controller';
import { env } from './config/env';
import { authenticate } from './middlewares/auth.middleware';
import { createOpenApiSpec } from './config/swagger';
import { errorMiddleware } from './middlewares/error.middleware';
import { requestLogger } from './middlewares/logger.middleware';

const app = express();

app.set('trust proxy', 1);
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(requestLogger);
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: env.NODE_ENV === 'production' ? 100 : 5000,
    skip: (req) => /^\/api\/v1\/cafes\/[^/]+\/availability$/.test(req.path),
  }),
);

app.use('/api/v1', router);
app.use('/api/payments/vnpay', vnpayRouter);
app.post('/api/payments/vnpay/create-payment-url', authenticate, createVnpayPayment);
app.get('/api/payments/vnpay-return', handleVnpayReturn);
app.get('/api/payments/vnpay-ipn', handleVnpayIpn);

app.get('/api-docs.json', (_req, res) => {
  res.json(createOpenApiSpec(app));
});
app.get('/api-docs', (_req, res) => {
  res.type('html').send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>RCField API Docs</title>
    <link
      rel="stylesheet"
      href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css"
      crossorigin="anonymous"
    />
    <style>
      body { margin: 0; background: #fafafa; }
      .topbar { display: none; }
    </style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js" crossorigin="anonymous"></script>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-standalone-preset.js" crossorigin="anonymous"></script>
    <script>
      window.ui = SwaggerUIBundle({
        url: '/api-docs.json',
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
        layout: 'BaseLayout',
      });
    </script>
  </body>
</html>`);
});

app.use(errorMiddleware);

export { app };
