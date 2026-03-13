import {
  Controller,
  Get,
  Param,
  HttpException,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  // Root health-check — the simulator will hit this frequently
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  // Simulates a healthy endpoint with variable latency
  @Get('health')
  async getHealth(): Promise<{ status: string; uptime: number }> {
    return this.appService.getHealth();
  }

  // Simulates an orders lookup — occasionally slow
  @Get('orders/:id')
  async getOrder(
    @Param('id') id: string,
  ): Promise<{ orderId: string; total: number }> {
    return this.appService.getOrder(id);
  }

  // Simulates a users lookup — occasionally throws a 500
  @Get('users/:id')
  async getUser(
    @Param('id') id: string,
  ): Promise<{ userId: string; name: string }> {
    return this.appService.getUser(id);
  }

  // Debug endpoint: allocates garbage then triggers a manual full GC.
  // Requires Node to be started with --expose-gc.
  // Hit this endpoint and immediately watch the Grafana heap panel — you'll
  // see "Heap Used" spike (allocations) then sharply drop (GC reclaimed them).
  @Post('debug/gc')
  async forceGc(): Promise<object> {
    return this.appService.forceGc();
  }
}
