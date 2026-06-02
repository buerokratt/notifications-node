import { join } from 'path';

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { appConfigFactory } from './app-config.factory';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      envFilePath: join(process.cwd(), 'config', `${process.env.NODE_ENV || 'development'}.env`),
      expandVariables: true,
    }),
    ConfigModule.forFeature(appConfigFactory),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
