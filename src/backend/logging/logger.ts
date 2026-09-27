export type LogLevel = "INFO" | "WARN" | "ERROR";

export type LogEvent =
  | "SERVER_STARTUP"
  | "SERVER_ERROR"
  | "AUTH_SUCCESS"
  | "AUTH_FAILURE"
  | "FAILED_MODEL_LOADING"
  | "FAILED_PREDICTION"
  | "DATABASE_ERROR"
  | "DATABASE_BACKUP"
  | "UPLOAD_FAILURE"
  | "REPORT_PROCESSED"
  | "SCREENING_COMPLETED";

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  event: LogEvent;
  message: string;
  details?: Record<string, unknown>;
}

class StructuredLogger {
  private formatLog(
    level: LogLevel,
    event: LogEvent,
    message: string,
    details?: Record<string, unknown>,
  ): string {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      event,
      message,
      ...(details ? { details: this.sanitizeDetails(details) } : {}),
    };
    return JSON.stringify(entry);
  }

  /**
   * Ensure NO sensitive personal health information (PHI) or passwords are logged
   */
  private sanitizeDetails(details: Record<string, unknown>): Record<string, unknown> {
    const sanitized: Record<string, unknown> = {};
    const sensitiveKeys = new RegExp(
      "password|secret|token|hash|salt|name|contact|email|address|phone|ssn",
      "i",
    );

    for (const [key, val] of Object.entries(details)) {
      if (sensitiveKeys.test(key)) {
        sanitized[key] = "[REDACTED]";
      } else if (typeof val === "object" && val !== null) {
        sanitized[key] = Array.isArray(val) ? `[Array(${val.length})]` : "[Object]";
      } else {
        sanitized[key] = val;
      }
    }
    return sanitized;
  }

  info(event: LogEvent, message: string, details?: Record<string, unknown>) {
    console.log(this.formatLog("INFO", event, message, details));
  }

  warn(event: LogEvent, message: string, details?: Record<string, unknown>) {
    console.warn(this.formatLog("WARN", event, message, details));
  }

  error(event: LogEvent, message: string, details?: Record<string, unknown>) {
    console.error(this.formatLog("ERROR", event, message, details));
  }
}

export const serverLogger = new StructuredLogger();
