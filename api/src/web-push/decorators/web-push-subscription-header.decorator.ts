import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';
import type { Request } from 'express';

import { ParseWebPushSubscriptionPipe } from '../pipes';
import { WEB_PUSH_SUBSCRIPTION_HEADER } from '../web-push.constants';

const apiWebPushSubscriptionHeader: ParameterDecorator = (target, propertyKey) => {
  if (!propertyKey) return;

  const descriptor = Object.getOwnPropertyDescriptor(target, propertyKey);
  if (!descriptor) return;

  ApiHeader({
    name: WEB_PUSH_SUBSCRIPTION_HEADER,
    description: 'Base64url-encoded browser PushSubscription JSON',
    required: false,
    example:
      'eyJlbmRwb2ludCI6Imh0dHBzOi8vZmNtLmdvb2dsZWFwaXMuY29tL2ZjbS9zZW5kL2NBNE1vMXBneS1NOk1PQ0tfYkhVaGFhVGV1Z1dSQXpZLTZzWFpZMTdyaWxOWWVRYndkazFWSU1HTF8wLWFZN0w1SGNrek5qSnJ3aThWck1qVkJQNFB6a0JpS1c0RkUtcTUxN0FXZk9zYldTU0dkdU4zcFBPTnpoMXQ4a2Yyd1NxMV9jMWQzc1g3Mk9ERUMzR0JZMDdIV0FNIiwiZXhwaXJhdGlvblRpbWUiOm51bGwsImtleXMiOnsicDI1NmRoIjoiTU9DS183Qm5uSHNwbUxEaHRFWnhHQXY4ZzM0bVI5LTZPYW5zQXlhM3ozWUlidDZhRl9LcGdPQldWUUtPM0RScTN0MTB3bTRmdGlkUXNLTWQwTlVLWlljIiwiYXV0aCI6Ik1PQ0tfYTJpQ1JuUnVqdlp1a1VqZ3cifX0=',
  })(target, propertyKey, descriptor);
};

export const WebPushSubscriptionHeader = (): ParameterDecorator =>
  createParamDecorator(
    // eslint-disable-next-line @typescript-eslint/naming-convention
    (_: unknown, context: ExecutionContext): string | undefined => {
      const request = context.switchToHttp().getRequest<Request>();
      return request.get(WEB_PUSH_SUBSCRIPTION_HEADER);
    },
    [apiWebPushSubscriptionHeader],
  )(ParseWebPushSubscriptionPipe);
