import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common';
// @opentelemetry/api is the STABLE PUBLIC API for OTel instrumentation.
// Key design principle: your business code only ever imports from @opentelemetry/api,
// never from the SDK. The SDK is wired up once in telemetry.ts and implements
// the API behind the scenes. This means you can swap SDK versions or vendors
// without touching any of your service code.
import { trace, SpanStatusCode, SpanKind } from '@opentelemetry/api';

// A Tracer is the factory for creating spans. The name here ('observability-app')
// is the "instrumentation scope" — it appears in the span's instrumentationScope
// field and tells you which tracer produced it. Use your service/library name.
const tracer = trace.getTracer('observability-app', '1.0.0');

@Injectable()
export class AppService {
  private readonly logger = new Logger(AppService.name);

  getHello(): string {
    return 'Hello World!';
  }

  async getHealth(): Promise<{ status: string; uptime: number }> {
    await this.simulateLatency(10, 100);
    this.logger.log('Health check OK');
    return { status: 'ok', uptime: process.uptime() };
  }

  async getOrder(id: string): Promise<{ orderId: string; total: number }> {
    // tracer.startActiveSpan() creates a new span AND sets it as the "active" span
    // in the current async context. Any child spans created inside the callback
    // (e.g. from an http call or another startActiveSpan) will automatically
    // link to this one as their parent via the AsyncLocalStorage context.
    return tracer.startActiveSpan(
      'AppService.getOrder', // Span name — shows up as the label in Jaeger's waterfall
      {
        kind: SpanKind.INTERNAL, // INTERNAL = work happening inside this service
        // (vs SERVER for incoming requests, CLIENT for outgoing ones)
        attributes: {
          // Attributes set at span START — things you know before the work runs
          'order.id': id,
        },
      },
      async (span) => {
        try {
          const delay = Math.floor(Math.random() * (400 - 50 + 1)) + 50;

          // span.addEvent() records a discrete moment with a timestamp.
          // Think of events as log lines that are *attached to a span* rather
          // than floating in a log file. They carry the same traceId context.
          span.addEvent('db.query.start', { 'db.simulated_delay_ms': delay });

          await this.simulateLatency(50, 400);

          span.addEvent('db.query.end');

          const total = Math.floor(Math.random() * 500) + 10;

          // Attributes set at span END — things you only know after the work completes
          span.setAttributes({
            'order.total': total,
            'order.currency': 'USD',
          });

          this.logger.log(`Fetched order ${id}`);
          return { orderId: id, total };
        } finally {
          // ALWAYS call span.end() — a span that is never ended is never exported.
          // The finally block guarantees this even if an exception is thrown.
          span.end();
        }
      },
    );
  }

  async getUser(id: string): Promise<{ userId: string; name: string }> {
    return tracer.startActiveSpan(
      'AppService.getUser',
      { kind: SpanKind.INTERNAL, attributes: { 'user.id': id } },
      async (span) => {
        try {
          if (Math.random() < 0.2) {
            const err = new HttpException(
              'Internal server error',
              HttpStatus.INTERNAL_SERVER_ERROR,
            );

            // span.recordException() attaches the full exception (type, message,
            // stack trace) as a structured event on the span. This is what Jaeger
            // surfaces when you click on a red (errored) span.
            span.recordException(err);

            // SpanStatusCode.ERROR marks the span as failed. Without this,
            // even if you record an exception, the span status stays OK —
            // Jaeger would not highlight it as an error.
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: err.message,
            });

            this.logger.error(`Failed to fetch user ${id}: internal error`);
            throw err;
          }

          await this.simulateLatency(20, 200);
          span.setStatus({ code: SpanStatusCode.OK });
          this.logger.log(`Fetched user ${id}`);
          return { userId: id, name: `User_${id}` };
        } finally {
          span.end();
        }
      },
    );
  }

  forceGc(): object {
    // Step 1: snapshot heap BEFORE we do anything
    const before = process.memoryUsage();

    // Step 2: allocate ~50 MB of garbage deliberately.
    // We create 500 arrays of 10 000 numbers each. Numbers in V8 are 8-byte doubles,
    // so 500 × 10 000 × 8 bytes = ~40 MB on the heap. These arrays go out of scope
    // the instant the loop ends — making them eligible for collection immediately.
    // This is the "spike" you'll see on the Grafana heap graph before the drop.
    const garbage: number[][] = [];
    for (let i = 0; i < 500; i++) {
      garbage.push(new Array(10_000).fill(Math.random()));
    }
    // Touch the array so the compiler doesn't optimize it away
    this.logger.debug(`Allocated ${garbage.length} garbage arrays`);

    // Step 3: snapshot heap AFTER allocation (the "spike" moment)
    const afterAlloc = process.memoryUsage();

    // Step 4: release references — garbage arrays are now collectable
    garbage.length = 0;

    // Step 5: force a synchronous, full "stop-the-world" GC.
    // global.gc() is ONLY available when Node is started with --expose-gc.
    // Without it, this function is undefined and we skip gracefully.
    const gcAvailable = typeof (global as any).gc === 'function';
    if (gcAvailable) {
      (global as any).gc();
    }

    // Step 6: snapshot heap AFTER GC (the "drop" moment)
    const afterGc = process.memoryUsage();

    const toMB = (b: number) => (b / 1024 / 1024).toFixed(2) + ' MB';

    this.logger.log(
      `GC triggered — heap: ${toMB(before.heapUsed)} → ${toMB(afterAlloc.heapUsed)} (alloc) → ${toMB(afterGc.heapUsed)} (after GC)`,
    );

    return {
      gcAvailable,
      heapUsed: {
        before: toMB(before.heapUsed),
        afterAllocation: toMB(afterAlloc.heapUsed),
        afterGc: toMB(afterGc.heapUsed),
        reclaimed: toMB(afterAlloc.heapUsed - afterGc.heapUsed),
      },
      heapTotal: {
        before: toMB(before.heapTotal),
        afterGc: toMB(afterGc.heapTotal),
      },
    };
  }

  private simulateLatency(min: number, max: number): Promise<void> {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    return new Promise((resolve) => setTimeout(resolve, delay));
  }
}
