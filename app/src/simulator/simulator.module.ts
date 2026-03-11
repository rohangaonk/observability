import { Module } from '@nestjs/common';
import { SimulatorService } from './simulator.service';

// A self-contained module — all simulator concerns live here.
// AppModule imports this as a black box; it doesn't need to know how it works.
@Module({
  providers: [SimulatorService],
})
export class SimulatorModule {}
