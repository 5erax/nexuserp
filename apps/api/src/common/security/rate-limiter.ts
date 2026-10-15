import { createHash } from 'node:crypto';
import { HttpException, Injectable } from '@nestjs/common';
import type { Response } from 'express';
@Injectable()
export class RateLimiter {
  // shortcut: process-local counters; use a shared store before running multiple API replicas.
  private readonly entries = new Map<string, { count: number; reset: number }>();
  take(key: string, limit: number, windowMs: number, response: Response) {
    const now = Date.now();
    const digest = createHash('sha256').update(key).digest('hex');
    for (const [id, bucket] of this.entries) if (bucket.reset <= now) this.entries.delete(id);
    let bucket = this.entries.get(digest);
    if (!bucket) {
      if (this.entries.size >= 10000) this.reject(response, 60);
      bucket = { count: 0, reset: now + windowMs };
      this.entries.set(digest, bucket);
    }
    bucket.count++;
    const remaining = Math.max(0, limit - bucket.count);
    const wait = Math.max(1, Math.ceil((bucket.reset - now) / 1000));
    response.setHeader('RateLimit-Limit', limit);
    response.setHeader('RateLimit-Remaining', remaining);
    response.setHeader('RateLimit-Reset', wait);
    if (bucket.count > limit) this.reject(response, wait);
  }
  private reject(response: Response, wait: number): never {
    response.setHeader('Retry-After', wait);
    throw new HttpException(
      { code: 'RATE_LIMITED', message: 'Đã vượt giới hạn yêu cầu, vui lòng thử lại sau' },
      429,
    );
  }
}
