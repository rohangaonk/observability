// ⚠️  THIS MUST BE THE FIRST IMPORT — see telemetry.ts for why
import './telemetry/telemetry';

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { OtelLoggerService } from './telemetry/otel-logger.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    // Replace NestJS's default ConsoleLogger with our OtelLoggerService.
    // All Logger.log(), Logger.error(), etc. calls throughout the app now
    // flow through OTel → Collector → Loki, while still printing to stdout.
    logger: new OtelLoggerService(),
  });
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
