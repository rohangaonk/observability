import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule'; // Enables @Cron / @Interval decorators globally
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { SimulatorModule } from './simulator/simulator.module';

@Module({
  imports: [
    ScheduleModule.forRoot(), // Must be registered at root — schedules only work when this is loaded
    SimulatorModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
