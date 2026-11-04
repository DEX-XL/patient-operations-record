import type { ReplayEvent } from "./events";

export const REPLAY_SPEEDS = [1, 60, 2000] as const;
export type ReplaySpeed = typeof REPLAY_SPEEDS[number];
export type ReplayClock = {
  seed: number; cursor: number; simulatedMs: number; playing: boolean;
  speed: ReplaySpeed; lastWallMs: number; pauseReason: "manual" | "trigger" | "complete" | null;
};
function tieRank(seed: number, id: string) {
  let hash = seed >>> 0;
  for (const char of id) hash = (Math.imul(hash, 16777619) ^ char.charCodeAt(0)) >>> 0;
  return hash;
}
export function orderedEvents(events: readonly ReplayEvent[], seed: number) {
  if (new Set(events.map((event) => event.id)).size !== events.length) throw new Error("DUPLICATE_EVENT_ID");
  return [...events].sort((a, b) => a.atMs - b.atMs || tieRank(seed, a.id) - tieRank(seed, b.id) || a.id.localeCompare(b.id));
}
export function newClock(seed: number, now: number): ReplayClock {
  if (!Number.isSafeInteger(seed) || !Number.isFinite(now)) throw new Error("INVALID_CLOCK_INPUT");
  return { seed, cursor: 0, simulatedMs: 0, playing: false, speed: 1, lastWallMs: now, pauseReason: "manual" };
}
export function advanceClock(clock: ReplayClock, events: readonly ReplayEvent[], now: number) {
  if (!Number.isFinite(now) || now < clock.lastWallMs) throw new Error("CLOCK_MOVED_BACKWARD");
  const next = { ...clock, lastWallMs: now };
  const applied: ReplayEvent[] = [];
  if (!clock.playing) return { clock: next, applied };
  const ordered = orderedEvents(events, clock.seed);
  const target = clock.simulatedMs + (now - clock.lastWallMs) * clock.speed;
  while (next.cursor < ordered.length && ordered[next.cursor].atMs <= target) {
    const event = ordered[next.cursor++]; applied.push(event);
    if (event.trigger) {
      next.simulatedMs = event.atMs; next.playing = false; next.pauseReason = "trigger";
      return { clock: next, applied };
    }
  }
  const complete = next.cursor === ordered.length;
  next.simulatedMs = complete ? Math.max(clock.simulatedMs, ordered.at(-1)?.atMs ?? 0) : target;
  next.playing = !complete;
  next.pauseReason = complete ? "complete" : null;
  return { clock: next, applied };
}
export function controlClock(clock: ReplayClock, events: readonly ReplayEvent[], action: "play" | "pause" | "step" | ReplaySpeed, now: number) {
  const current = advanceClock(clock, events, now);
  if (current.clock.pauseReason === "trigger" && clock.playing) return current; // Never step past an unseen trigger.
  if (typeof action === "number") {
    if (!(REPLAY_SPEEDS as readonly number[]).includes(action)) throw new Error("INVALID_REPLAY_SPEED");
    current.clock.speed = action;
  } else if (action === "pause") { current.clock.playing = false; current.clock.pauseReason = "manual"; }
  else if (action === "play") {
    if (current.clock.cursor < events.length) { current.clock.playing = true; current.clock.pauseReason = null; }
  } else {
    const event = orderedEvents(events, clock.seed)[current.clock.cursor];
    current.clock.playing = false;
    if (event) {
      current.clock.cursor++; current.clock.simulatedMs = event.atMs; current.applied.push(event);
      current.clock.pauseReason = event.trigger ? "trigger" : current.clock.cursor === events.length ? "complete" : "manual";
    } else current.clock.pauseReason = "complete";
  }
  return current;
}
