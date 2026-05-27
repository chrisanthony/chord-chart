import type { Progression } from './types';

// Survives Next.js hot-reloads in dev
const g = globalThis as unknown as { _chordStore?: Map<string, Progression> };
g._chordStore ??= new Map();
const mem = g._chordStore;

async function getRedis() {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.UPSTASH_REDIS_REST_REDIS_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.UPSTASH_REDIS_REST_KV_REST_API_TOKEN ?? process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    console.error('[store] Redis env vars missing — url:', !!url, 'token:', !!token);
    return null;
  }
  try {
    const { Redis } = await import('@upstash/redis');
    return new Redis({ url, token });
  } catch (e) {
    console.error('[store] Redis init failed:', e);
    return null;
  }
}

export async function saveProgression(p: Progression): Promise<void> {
  const redis = await getRedis();
  if (redis) {
    try {
      await redis.set(`p:${p.id}`, JSON.stringify(p));
      console.log('[store] saved to Redis:', p.id);
    } catch (e) {
      console.error('[store] Redis set failed:', e);
      mem.set(p.id, p);
    }
  } else {
    console.warn('[store] no Redis — saving to memory:', p.id);
    mem.set(p.id, p);
  }
}

export async function getProgression(id: string): Promise<Progression | null> {
  const redis = await getRedis();
  if (redis) {
    try {
      const raw = await redis.get<string>(`p:${id}`);
      console.log('[store] Redis get:', id, '→', raw ? 'found' : 'null');
      if (!raw) return null;
      return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (e) {
      console.error('[store] Redis get failed:', e);
      return null;
    }
  }
  console.warn('[store] no Redis — checking memory:', id);
  return mem.get(id) ?? null;
}
