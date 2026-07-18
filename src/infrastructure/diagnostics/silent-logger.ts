import type { LogContext, Logger } from '../../domain/foundation/logger';

/** Default logger intentionally retains and transmits nothing. */
export class SilentLogger implements Logger {
  public debug(message: string, context?: LogContext): void {
    void message;
    void context;
  }

  public info(message: string, context?: LogContext): void {
    void message;
    void context;
  }

  public warn(message: string, context?: LogContext): void {
    void message;
    void context;
  }

  public error(message: string, context?: LogContext): void {
    void message;
    void context;
  }
}
