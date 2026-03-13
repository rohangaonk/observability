import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import * as http from 'http';

// The list of endpoints the simulator will randomly choose from.
// Each entry reflects a realistic route in our AppController.
const ENDPOINTS = [
  { path: '/health', weight: 3 }, // High frequency — health checks are common
  { path: '/orders/42', weight: 2 }, // Medium frequency — typical API traffic
  { path: '/orders/99', weight: 2 },
  { path: '/users/7', weight: 2 }, // Lower frequency — triggers ~20% 500 errors
  { path: '/users/13', weight: 1 },
];

// Build a weighted pool so that endpoints with higher weight are picked more often.
// e.g. weight:3 means /health appears 3 times in the pool → 3x more likely to be chosen
const WEIGHTED_POOL = ENDPOINTS.flatMap((e) => Array(e.weight).fill(e.path));

@Injectable()
export class SimulatorService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SimulatorService.name);

  // Fires once when all modules are initialized — confirms the simulator is live
  onApplicationBootstrap() {
    this.logger.log('Traffic simulator started — firing 10 requests/s (every 100ms)');
  }

  // @Interval fires this method every 100ms → 10 requests per second.
  // At this rate the terminal log line per request would be overwhelming,
  // so consider log-sampling or reducing NestJS log verbosity if needed.
  @Interval(100)
  async fireRequest(): Promise<void> {
    // Pick a random endpoint from the weighted pool
    const path =
      WEIGHTED_POOL[Math.floor(Math.random() * WEIGHTED_POOL.length)];

    try {
      const statusCode = await this.get(path);
      this.logger.log(`GET ${path} → ${statusCode}`);
    } catch (err) {
      // Network-level errors (e.g. app not ready yet) — not the same as HTTP 500s
      this.logger.warn(
        `GET ${path} → request failed: ${(err as Error).message}`,
      );
    }
  }

  // Simple HTTP GET using Node's built-in http module — no axios dep needed
  // Returns the HTTP status code so we can log it
  private get(path: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const req = http.get(
        { hostname: 'localhost', port: 3000, path },
        (res) => {
          // Drain the response body — required or the socket will hang
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on('error', reject);
      // Abort after 5s to avoid piling up stale connections
      req.setTimeout(5000, () => {
        req.destroy();
        reject(new Error('timeout'));
      });
    });
  }
}
