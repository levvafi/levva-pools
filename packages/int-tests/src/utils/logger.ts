import pino, { Logger } from 'pino';

export function createTestLogger(): Logger {
  return pino({
    level: 'debug',
    transport: {
      target: 'pino-pretty',
      options: {
        sync: false,
      },
    },
  });
}
