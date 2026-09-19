/* Minimal structured logger. Never logs secrets or ciphertext content. */

type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const effectiveLevel: Level =
  process.env.LOG_LEVEL === 'debug'
    ? 'debug'
    : process.env.LOG_LEVEL === 'warn'
      ? 'warn'
      : process.env.LOG_LEVEL === 'error'
        ? 'error'
        : 'info';

function emit(level: Level, scope: string, message: string, extra?: unknown): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[effectiveLevel]) return;
  const line = [
    new Date().toISOString(),
    level.toUpperCase().padEnd(5),
    `[${scope}]`,
    message,
  ];
  if (extra !== undefined) line.push(JSON.stringify(extra));
  const out = line.join(' ');
  if (level === 'error') process.stderr.write(out + '\n');
  else process.stdout.write(out + '\n');
}

export const logger = {
  debug: (scope: string, message: string, extra?: unknown) => emit('debug', scope, message, extra),
  info: (scope: string, message: string, extra?: unknown) => emit('info', scope, message, extra),
  warn: (scope: string, message: string, extra?: unknown) => emit('warn', scope, message, extra),
  error: (scope: string, message: string, extra?: unknown) => emit('error', scope, message, extra),
};