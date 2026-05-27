import type { Progression } from './types';

// Survives Next.js hot-reloads in dev
const g = globalThis as unknown as { _chordStore?: Map<string, Progression> };
g._chordStore ??= new Map();
const mem = g._chordStore;

async function getRedis() {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.UPSTASH_REDIS_REST_REDIS_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.UPSTASH_REDIS_REST_KV_REST_API_TOKEN ?? process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  try {
    const { Redis } = await import('@upstash/redis');
    return new Redis({ url, token });
  } catch {
    return null;
  }
}

export async function saveProgression(p: Progression): Promise<void> {
  const redis = await getRedis();
  if (redis) {
    await redis.set(`p:${p.id}`, JSON.stringify(p));
  } else {
    mem.set(p.id, p);
  }
}

export async function getProgression(id: string): Promise<Progression | null> {
  const redis = await getRedis();
  if (redis) {
    const raw = await redis.get<string>(`p:${id}`);
    if (!raw) return null;
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  }
  return mem.get(id) ?? null;
}
