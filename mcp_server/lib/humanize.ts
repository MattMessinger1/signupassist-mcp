// Minimal humanization utilities for browser automation
export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export function jitter(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export async function humanPause(baseMin = 250, baseMax = 900): Promise<void> {
  await sleep(jitter(baseMin, baseMax));
}
