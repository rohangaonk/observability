import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common';

@Injectable()
export class AppService {
  // NestJS built-in logger — we'll replace this with OTel structured logging in Step 3
  private readonly logger = new Logger(AppService.name);

  getHello(): string {
    return 'Hello World!';
  }

  async getHealth(): Promise<{ status: string; uptime: number }> {
    // Simulate a small random latency (10–100ms) to make traces look realistic
    await this.simulateLatency(10, 100);
    this.logger.log('Health check OK');
    return { status: 'ok', uptime: process.uptime() };
  }

  async getOrder(id: string): Promise<{ orderId: string; total: number }> {
    // Orders endpoint is sometimes slow (50–400ms) — models a DB query
    await this.simulateLatency(50, 400);
    this.logger.log(`Fetched order ${id}`);
    return { orderId: id, total: Math.floor(Math.random() * 500) + 10 };
  }

  async getUser(id: string): Promise<{ userId: string; name: string }> {
    // 20% chance of a 500 error — gives us error traces to observe in Jaeger
    if (Math.random() < 0.2) {
      this.logger.error(`Failed to fetch user ${id}: internal error`);
      throw new HttpException(
        'Internal server error',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    await this.simulateLatency(20, 200);
    this.logger.log(`Fetched user ${id}`);
    return { userId: id, name: `User_${id}` };
  }

  // Helper: waits a random number of ms between [min, max]
  // This is the core trick that makes our traces look like real production traffic
  private simulateLatency(min: number, max: number): Promise<void> {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    return new Promise((resolve) => setTimeout(resolve, delay));
  }
}
