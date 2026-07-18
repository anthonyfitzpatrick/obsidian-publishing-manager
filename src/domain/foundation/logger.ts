export type LogContext = Readonly<Record<string, unknown>>;

/** Local diagnostic boundary. Implementations must never transmit log data. */
export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
}
