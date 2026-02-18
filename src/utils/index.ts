import pino from 'pino';

// ==================== Custom Error Classes ====================

export class DatabaseError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'DatabaseError';
  }
}

export class ValidationError extends Error {
  constructor(
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class WhatsAppError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly retryable: boolean = false
  ) {
    super(message);
    this.name = 'WhatsAppError';
  }
}

export class ConnectionError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'ConnectionError';
  }
}

// ==================== Logger ====================

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV !== 'production' 
    ? {
        target: 'pino-pretty',
        options: { 
          colorize: true,
          translateTime: 'SYS:standard'
        }
      }
    : undefined,
  timestamp: pino.stdTimeFunctions.isoTime
});

// Create child loggers for different modules
export const createLogger = (module: string) => logger.child({ module });

// ==================== Retry Utility ====================

export interface RetryOptions {
  maxRetries?: number;
  initialDelay?: number;
  maxDelay?: number;
  backoffFactor?: number;
  shouldRetry?: (error: unknown) => boolean;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelay = 1000,
    maxDelay = 30000,
    backoffFactor = 2,
    shouldRetry = () => true
  } = options;

  let lastError: unknown;
  let delay = initialDelay;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt === maxRetries || !shouldRetry(error)) {
        throw error;
      }

      logger.warn({
        attempt: attempt + 1,
        maxRetries,
        delay,
        error: error instanceof Error ? error.message : String(error)
      }, 'Retrying after error');

      await new Promise(resolve => setTimeout(resolve, delay));
      delay = Math.min(delay * backoffFactor, maxDelay);
    }
  }

  throw lastError;
}

// ==================== Cleanup Manager ====================

export class CleanupManager {
  private intervals: NodeJS.Timeout[] = [];
  private timeouts: NodeJS.Timeout[] = [];
  private cleanupFns: (() => Promise<void>)[] = [];

  addInterval(id: NodeJS.Timeout): void {
    this.intervals.push(id);
  }

  addTimeout(id: NodeJS.Timeout): void {
    this.timeouts.push(id);
  }

  addCleanupFn(fn: () => Promise<void>): void {
    this.cleanupFns.push(fn);
  }

  clearInterval(id: NodeJS.Timeout): void {
    clearTimeout(id);
    this.intervals = this.intervals.filter(i => i !== id);
  }

  clearTimeout(id: NodeJS.Timeout): void {
    clearTimeout(id);
    this.timeouts = this.timeouts.filter(t => t !== id);
  }

  async cleanup(): Promise<void> {
    // Clear all intervals
    this.intervals.forEach(id => clearInterval(id));
    this.intervals = [];

    // Clear all timeouts
    this.timeouts.forEach(id => clearTimeout(id));
    this.timeouts = [];

    // Run cleanup functions
    for (const fn of this.cleanupFns) {
      try {
        await fn();
      } catch (error) {
        logger.warn({ error }, 'Cleanup function failed');
      }
    }
    this.cleanupFns = [];
  }
}
