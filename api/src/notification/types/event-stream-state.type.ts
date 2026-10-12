import type { MessageEvent } from '@nestjs/common';
import type { Subject } from 'rxjs';

export type EventStreamState = {
  readonly eventStream: Subject<MessageEvent>;
  subscriberCount: number;
};
