import { HttpModule } from '@nestjs/axios';
import { type DynamicModule, Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { lifecycleConfigFactory } from './lifecycle-config.factory';
import { LifecycleService, LifecycleWorkerService } from './services';
import { ValkeyModule } from '../valkey/valkey.module';

@Global()
@Module({})
export class LifecycleModule {
  public static register({ workerEnabled }: { readonly workerEnabled: boolean }): DynamicModule {
    return {
      module: LifecycleModule,
      imports: [ConfigModule.forFeature(lifecycleConfigFactory), HttpModule, ValkeyModule],
      providers: [LifecycleService, ...(workerEnabled ? [LifecycleWorkerService] : [])],
      exports: [LifecycleService],
    };
  }
}
