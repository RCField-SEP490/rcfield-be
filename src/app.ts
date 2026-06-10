import 'reflect-metadata';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import swaggerUi from 'swagger-ui-express';
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
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
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
app.use(
  '/api-docs',
  swaggerUi.serve,
  swaggerUi.setup(undefined, {
    swaggerOptions: {
      url: '/api-docs.json',
    },
  }),
);

app.use(errorMiddleware);

export { app };
