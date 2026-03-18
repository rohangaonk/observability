/**
 * OtelLoggerService — bridges NestJS logging to the OpenTelemetry Logs API.
 *
 * WHY THIS EXISTS:
 * The OTel SDK's log processor (BatchLogRecordProcessor) is set up in telemetry.ts,
 * but it doesn't automatically intercept console.log or NestJS's built-in Logger.
 * Those go straight to stdout and are never exported via OTLP.
 *
 * To send structured logs through the OTel pipeline (→ Collector → Loki),
 * we need to call the OTel Logs API explicitly. That's what this service does.
 *
 * This service implements NestJS's LoggerService interface, so it can be
 * registered as the app-wide logger and all calls to `Logger.log()`, etc.
 * will be intercepted here and emitted as OTel LogRecords.
 *
 * KEY CONCEPT — Trace Correlation:
 * When a log is emitted inside an active span (e.g. during an HTTP request),
 * the OTel SDK automatically attaches the current trace_id and span_id to
 * the LogRecord. This is what enables you to click a log line in Loki and jump
 * to the corresponding trace in Tempo (Phase 7).
 */

import { LoggerService, LogLevel } from '@nestjs/common';
import { logs, SeverityNumber } from '@opentelemetry/api-logs';
import { trace, context } from '@opentelemetry/api';

/**
 * Maps NestJS log levels to OTel SeverityNumber values.
 *
 * OTel defines severity numbers in the spec (https://opentelemetry.io/docs/specs/otel/logs/data-model/#field-severitynumber):
 *   TRACE=1-4, DEBUG=5-8, INFO=9-12, WARN=13-16, ERROR=17-20, FATAL=21-24
 *
 * Flink's classify_log_batch() filters on severityNumber >= 17 (ERROR+).
 * These mappings must stay consistent with that threshold.
 */
const SEVERITY_MAP: Record<string, { number: SeverityNumber; text: string }> = {
  verbose: { number: SeverityNumber.TRACE, text: 'TRACE' },
  debug: { number: SeverityNumber.DEBUG, text: 'DEBUG' },
  log: { number: SeverityNumber.INFO, text: 'INFO' },
  warn: { number: SeverityNumber.WARN, text: 'WARN' },
  error: { number: SeverityNumber.ERROR, text: 'ERROR' },
  fatal: { number: SeverityNumber.FATAL, text: 'FATAL' },
};

export class OtelLoggerService implements LoggerService {
  /**
   * Lazily resolve the OTel logger at emit-time.
   *
   * Why this matters:
   * If we resolve logs.getLogger(...) during module import, it may happen before
   * telemetry.ts finishes sdk.start() and registers the global LoggerProvider.
   * In that race, we'd bind to the default no-op provider and emits are dropped.
   * Resolving here avoids that startup-order hazard.
   */
  private get otelLogger() {
    return logs.getLogger('nestjs-app', '1.0.0');
  }

  /**
   * Core emit method. All log level methods delegate here.
   *
   * A LogRecord contains:
   *   - body: the log message (human-readable string)
   *   - severityNumber + severityText: the log level in OTel terms
   *   - attributes: structured key-value metadata (NestJS context, trace IDs)
   *   - timestamp: set automatically by the SDK
   *
   * The SDK also automatically injects trace_id and span_id from the active
   * OTel context — so logs emitted during an HTTP request are correlated to
   * the request's trace. This happens via the `observedTimestamp` field and
   * the active context propagation built into the SDK.
   */
  private emit(level: string, message: unknown, nestContext?: string): void {
    const { number: severityNumber, text: severityText } =
      SEVERITY_MAP[level] ?? SEVERITY_MAP['log'];

    // Get the current active span from OTel context (if any).
    // This is how we attach trace_id / span_id to logs for Loki → Tempo correlation.
    const activeSpan = trace.getActiveSpan();
    const spanContext = activeSpan?.spanContext();

    // Derived fields in Grafana Loki are regex-based over the rendered log line.
    // Include trace_id in the body when a span is active so logs become clickable
    // and can jump directly to Tempo traces.
    const renderedMessage =
      typeof message === 'string' ? message : JSON.stringify(message);
    const bodyWithTrace = spanContext
      ? `trace_id=${spanContext.traceId} ${renderedMessage}`
      : renderedMessage;

    this.otelLogger.emit({
      severityNumber,
      severityText,
      // body is the main log message. OTel allows any type, but strings work
      // best in Loki's log viewer.
      body: bodyWithTrace,
      attributes: {
        // NestJS context string (e.g. "SimulatorService", "AppController")
        // This becomes a queryable attribute in Loki structured metadata.
        ...(nestContext && { 'nestjs.context': nestContext }),

        // Explicitly attach trace context so it shows up even in environments
        // where automatic injection isn't working.
        ...(spanContext && {
          trace_id: spanContext.traceId,
          span_id: spanContext.spanId,
        }),
      },
    });

    // Also write to stdout so local development still shows logs in the terminal.
    // Without this, running `npm run start:dev` would show no logs at all.
    const prefix = nestContext ? `[${nestContext}]` : '';
    console.log(`[${severityText}] ${prefix} ${message}`);
  }

  log(message: unknown, context?: string) {
    this.emit('log', message, context);
  }
  error(message: unknown, _trace?: string, context?: string) {
    this.emit('error', message, context);
  }
  warn(message: unknown, context?: string) {
    this.emit('warn', message, context);
  }
  debug(message: unknown, context?: string) {
    this.emit('debug', message, context);
  }
  verbose(message: unknown, context?: string) {
    this.emit('verbose', message, context);
  }
  fatal(message: unknown, context?: string) {
    this.emit('fatal', message, context);
  }

  /**
   * setLogLevels is part of the LoggerService interface.
   * We're not implementing log level filtering here — all levels are forwarded
   * to OTel where Loki and Flink handle filtering on their end.
   */
  setLogLevels(_levels: LogLevel[]) {
    /* no-op */
  }
}
