"use strict";

const memory = new Map();

function redisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return { url: url.replace(/\/+$/, ""), token };
}

async function redis(command) {
  const config = redisConfig();
  if (!config) return null;
  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) throw new Error(`rate limit store ${response.status}`);
  const data = await response.json();
  if (data && data.error) throw new Error(String(data.error));
  return data ? data.result : null;
}

function memoryCheck(key, limit, windowSeconds) {
  const now = Date.now();
  const existing = memory.get(key);
  if (!existing || existing.resetAt <= now) {
    memory.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    return { allowed: true, remaining: limit - 1, retryAfter: 0 };
  }
  existing.count += 1;
  const remaining = Math.max(0, limit - existing.count);
  return {
    allowed: existing.count <= limit,
    remaining,
    retryAfter: existing.count <= limit ? 0 : Math.ceil((existing.resetAt - now) / 1000),
  };
}

async function checkLimit(key, limit, windowSeconds) {
  if (redisConfig()) {
    try {
      const count = Number(await redis(["INCR", key]));
      if (count === 1) await redis(["EXPIRE", key, String(windowSeconds)]);
      const remaining = Math.max(0, limit - count);
      return {
        allowed: count <= limit,
        remaining,
        retryAfter: count <= limit ? 0 : windowSeconds,
      };
    } catch (error) {
      console.error(JSON.stringify({ event: "rate_limit_store_error", message: error.message }));
    }
  }
  return memoryCheck(key, limit, windowSeconds);
}

async function resetLimit(key) {
  memory.delete(key);
  if (redisConfig()) {
    try {
      await redis(["DEL", key]);
    } catch (error) {
      console.error(JSON.stringify({ event: "rate_limit_store_error", message: error.message }));
    }
  }
}

module.exports = { checkLimit, resetLimit };
