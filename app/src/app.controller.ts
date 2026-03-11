import {
  Controller,
  Get,
  Param,
  HttpException,
  HttpStatus,
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
}
