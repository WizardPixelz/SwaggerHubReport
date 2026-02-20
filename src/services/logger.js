/**
 * Structured Logger - JSON-formatted logging for CloudWatch Insights
 *
 * Replaces plain console.log() with structured JSON output so logs can be
 * queried in CloudWatch Insights using fields like:
 *   fields @timestamp, level, event, apiName, owner, score
 *   | filter level = "ERROR"
 *   | sort @timestamp desc
 *
 * In local/test mode, falls back to readable console output.
 */

class Logger {
  /**
   * @param {object} context - Base context fields included in every log entry
   * @param {string} context.service - Service name (e.g., 'swaggerhub-validation')
   * @param {string} [context.requestId] - Lambda request ID
   * @param {string} [context.owner] - API owner
   * @param {string} [context.apiName] - API name
   * @param {string} [context.version] - API version
   */
  constructor(context = {}) {
    this.context = {
      service: 'swaggerhub-validation',
      ...context,
    };
    this.isLocal = process.env.IS_LOCAL === 'true' || !process.env.AWS_LAMBDA_FUNCTION_NAME;
  }

  /**
   * Create a child logger with additional context fields
   */
  child(additionalContext) {
    return new Logger({ ...this.context, ...additionalContext });
  }

  /**
   * Log at INFO level
   */
  info(event, data = {}) {
    this._log('INFO', event, data);
  }

  /**
   * Log at WARN level
   */
  warn(event, data = {}) {
    this._log('WARN', event, data);
  }

  /**
   * Log at ERROR level
   */
  error(event, data = {}) {
    if (data instanceof Error) {
      data = {
        errorMessage: data.message,
        errorName: data.name,
        stackTrace: data.stack,
      };
    }
    this._log('ERROR', event, data);
  }

  /**
   * Log at DEBUG level (only in local mode or when LOG_LEVEL=DEBUG)
   */
  debug(event, data = {}) {
    if (this.isLocal || process.env.LOG_LEVEL === 'DEBUG') {
      this._log('DEBUG', event, data);
    }
  }

  /**
   * Internal: format and output the log entry
   */
  _log(level, event, data) {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      event,
      ...this.context,
      ...data,
    };

    // Remove undefined values
    Object.keys(entry).forEach((key) => {
      if (entry[key] === undefined) delete entry[key];
    });

    if (this.isLocal) {
      // Readable format for local development
      const prefix = `[${level}]`;
      const dataStr = Object.keys(data).length > 0 ? ` ${JSON.stringify(data)}` : '';
      console.log(`${prefix} ${event}${dataStr}`);
    } else {
      // Single-line JSON for CloudWatch Insights
      console.log(JSON.stringify(entry));
    }
  }
}

/**
 * Create a root logger instance
 * @param {object} [context] - Optional initial context
 * @returns {Logger}
 */
function createLogger(context) {
  return new Logger(context);
}

module.exports = { Logger, createLogger };
