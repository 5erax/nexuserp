import { randomBytes } from 'node:crypto';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { Algorithm, Version, hash, verify, parseOptions } from '@node-rs/argon2';
const POLICY = {
  algorithm: Algorithm.Argon2id,
  version: Version.V0x13,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
};
@Injectable()
export class PasswordService implements OnModuleInit {
  private dummy = '';
  async onModuleInit() {
    this.dummy = await this.hash(randomBytes(32).toString('hex'));
  }
  hash(password: string) {
    return hash(password, POLICY);
  }
  async verify(password: string, encoded?: string) {
    try {
      return await verify(encoded ?? this.dummy, password);
    } catch {
      return false;
    }
  }
  needsRehash(encoded: string) {
    const params = parseOptions(encoded);
    return (
      params.algorithm !== POLICY.algorithm ||
      params.version !== POLICY.version ||
      params.memoryCost < POLICY.memoryCost ||
      params.timeCost < POLICY.timeCost ||
      params.outputLen < POLICY.outputLen ||
      params.saltLen < 16
    );
  }
}
