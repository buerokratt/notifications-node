import { IsNotEmpty, IsOptional, IsString, IsUrl } from 'class-validator';

export class RabbitmqConfigSchema {
  @IsString()
  @IsNotEmpty()
  @IsUrl({ require_tld: false, protocols: ['amqp', 'amqps'] })
  readonly url!: string;

  @IsString()
  @IsOptional()
  readonly prefix?: string;
}
