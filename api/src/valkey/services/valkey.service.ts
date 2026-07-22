import { BeforeApplicationShutdown, Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus';
import { Batch, GlideClient, type GlideReturnType, Script, TimeUnit } from '@valkey/valkey-glide';

import { valkeyConfigFactory } from '../valkey-config.factory';
import { VALKEY_HEALTH_KEY } from '../valkey.constants';

@Injectable()
export class ValkeyService implements OnModuleInit, BeforeApplicationShutdown {
  private readonly logger = new Logger(ValkeyService.name);
  private glideClient?: GlideClient;

  constructor(
    @Inject(valkeyConfigFactory.KEY)
    private readonly config: ConfigType<typeof valkeyConfigFactory>,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  public async onModuleInit(): Promise<void> {
    const client = await GlideClient.createClient({
      addresses: [{ host: this.config.host, port: this.config.port }],
      advancedConfiguration: { connectionTimeout: this.config.connectTimeoutMs },
      ...(this.config.password
        ? {
            credentials: {
              password: this.config.password,
              ...(this.config.username ? { username: this.config.username } : {}),
            },
          }
        : {}),
      requestTimeout: this.config.requestTimeoutMs,
      useTLS: this.config.useTls,
    });

    try {
      await client.ping();
      this.glideClient = client;
      this.logger.log('Valkey connection initialized');
    } catch (error) {
      client.close();
      throw error;
    }
  }

  public beforeApplicationShutdown(signal?: string): void {
    this.logger.log(`Closing Valkey connection. Signal: ${signal ?? 'unknown'}`);
    this.glideClient?.close();
    this.glideClient = undefined;
  }

  /**
   * Returns the current Valkey connection health status.
   */
  public async isHealthy(): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(VALKEY_HEALTH_KEY);

    try {
      await this.client.ping();
      return indicator.up();
    } catch {
      return indicator.down();
    }
  }

  /**
   * Gets a string value by key, or undefined when the key does not exist.
   */
  public async get(key: string): Promise<string | undefined> {
    const value = await this.client.get(key);
    if (value === null) return;
    return value.toString();
  }

  /**
   * Stores a string value under the given key.
   */
  public async set(key: string, value: string): Promise<void> {
    await this.client.set(key, value);
  }

  /**
   * Stores a string value with an expiry only when the key does not exist.
   *
   * Returns true when the value was stored and false when the key already existed.
   */
  public async setIfAbsent(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.client.set(key, value, {
      conditionalSet: 'onlyIfDoesNotExist',
      expiry: {
        type: TimeUnit.Seconds,
        count: Math.max(1, ttlSeconds),
      },
    });

    return result === 'OK';
  }

  /**
   * Deletes the provided keys. An empty key list is ignored.
   */
  public async delete(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    await this.client.del(keys);
  }

  /**
   * Adds unique members to a set and optionally refreshes the set's expiry.
   * Existing members are left unchanged.
   */
  public async addSetMembers(key: string, members: string[], options?: { readonly ttlSeconds: number }): Promise<void> {
    if (members.length === 0) return;

    if (!options) {
      await this.client.sadd(key, members);
      return;
    }

    const transaction = new Batch(true).sadd(key, members).expire(key, Math.max(1, options.ttlSeconds));

    await this.client.exec(transaction, true);
  }

  /**
   * Removes the provided members from a set. Missing members are ignored.
   */
  public async removeSetMembers(key: string, members: string[]): Promise<void> {
    if (members.length === 0) return;
    await this.client.srem(key, members);
  }

  /**
   * Returns all members of a set as strings.
   */
  public async getSetMembers(key: string): Promise<string[]> {
    const members = await this.client.smembers(key);
    return [...members].map((member) => member.toString());
  }

  /**
   * Executes a Lua script atomically.
   */
  public async executeScript(source: string, keys: string[], args: string[]): Promise<GlideReturnType> {
    const script = new Script(source);

    try {
      return await this.client.invokeScript(script, { keys, args });
    } finally {
      script.release();
    }
  }

  private get client(): GlideClient {
    if (!this.glideClient) throw new Error('Valkey client is not initialized');

    return this.glideClient;
  }
}
