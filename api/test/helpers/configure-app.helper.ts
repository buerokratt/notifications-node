import { ClassSerializerInterceptor, INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { App } from 'supertest/types';

import { AppType } from '../../src/enums';

export const configureApp = (app: INestApplication<App>, globalPrefix: AppType): void => {
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  app.enableVersioning({ type: VersioningType.URI });
  app.useGlobalInterceptors(
    new ClassSerializerInterceptor(app.get(Reflector), {
      excludeExtraneousValues: true,
    }),
  );
  app.setGlobalPrefix(globalPrefix, {
    exclude: ['health'],
  });
};
