/**
 * CRITICAL: This file must be imported BEFORE anything else in main.ts.
 *
 * Why? Auto-instrumentation works by monkey-patching Node.js modules (http, express, etc.)
 * at require-time. If NestJS or the http module loads first, the patch is too late —
 * those calls will never be traced. The import order IS the feature.
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
// In OTel SDK v2, the `Resource` class was replaced by the `resourceFromAttributes` function.
// The concept is the same: attach key-value metadata to everything this process emits.
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

// --- Resource ---
// A Resource describes *what* is producing the telemetry.
// This metadata attaches to every single span and metric this process emits.
// In Jaeger you'll filter by service.name. In Prometheus you'll group by it.
const resource = resourceFromAttributes({
  [ATTR_SERVICE_NAME]: 'observability-app', // How this service appears in Jaeger / Grafana
  [ATTR_SERVICE_VERSION]: '1.0.0',
});

// --- Trace Exporter ---
// OTLPTraceExporter sends completed spans over HTTP to the OTel Collector.
// The Collector listens on 4318 for OTLP/HTTP; /v1/traces is the standard path.
// We default to localhost:4318 so the app works out of the box whether run
// directly or inside Docker (override via OTEL_EXPORTER_OTLP_ENDPOINT).
// ConsoleSpanExporter has been removed — at 10 RPS it would produce ~100 JSON
// objects per second in the terminal, making the output unreadable.
const otlpEndpoint =
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318';

const traceExporter = new OTLPTraceExporter({
  url: `${otlpEndpoint}/v1/traces`,
});

// --- Metric Exporter ---
// Metrics follow the same exporter pattern as traces.
// We push metrics to the Collector every 10 seconds (PeriodicExportingMetricReader).
// If no Collector is configured, metrics are simply not exported (no console equivalent).
const metricReader = new PeriodicExportingMetricReader({
  exporter: new OTLPMetricExporter({
    url: `${otlpEndpoint}/v1/metrics`,
  }),
  exportIntervalMillis: 10_000, // Push metrics every 10 seconds
});

// --- Auto-Instrumentation ---
// getNodeAutoInstrumentations() returns a bundle of instrumentations that
// automatically create spans for: HTTP calls (incoming + outgoing), Express,
// NestJS, DNS, and more — zero manual code required.
//
// We selectively disable a few noisy ones to keep the output clean for learning:
// - fs (filesystem): would produce spans for every file read NestJS does internally
// - dns: too low-level, clutters the trace view
const instrumentations = [
  getNodeAutoInstrumentations({
    '@opentelemetry/instrumentation-fs': { enabled: false },
    '@opentelemetry/instrumentation-dns': { enabled: false },
  }),
];

// --- SDK Assembly ---
// NodeSDK is the batteries-included entry point for Node.js.
// It wires together: resource + exporters + instrumentations + a BatchSpanProcessor
// (which buffers spans and flushes them in batches for efficiency).
const sdk = new NodeSDK({
  resource,
  traceExporter,
  metricReader,
  instrumentations,
});

// Start the SDK synchronously before any other module loads.
// This is what actually installs the monkey-patches on http, express, etc.
sdk.start();
console.log(`[OTel] SDK started — exporting to: ${otlpEndpoint}`);

// Graceful shutdown: flush any buffered spans before the process exits.
// Without this, spans in the buffer are lost when you Ctrl+C the app.
process.on('SIGTERM', () => {
  sdk.shutdown().then(() => console.log('[OTel] SDK shut down cleanly'));
});
