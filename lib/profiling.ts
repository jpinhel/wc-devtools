import type { TreePatch } from '../types/wc';

export const MAX_FRAMES = 500;

export interface ProfilingFrame {
  at: number;
  counts: Map<string, number>;
}

export interface ProfilingState {
  frames: ProfilingFrame[];
}

export function createProfilingState(): ProfilingState {
  return { frames: [] };
}

export function recordPatches(
  state: ProfilingState,
  patches: TreePatch[],
  now: number,
): ProfilingState {
  const counts = new Map<string, number>();
  for (const p of patches) {
    if (p.op !== 'update') continue;
    counts.set(p.id, (counts.get(p.id) ?? 0) + 1);
  }
  // Skip frames with no updates: keeps the ring buffer dense.
  if (counts.size === 0) return state;
  const frames =
    state.frames.length >= MAX_FRAMES
      ? [...state.frames.slice(state.frames.length - MAX_FRAMES + 1), { at: now, counts }]
      : [...state.frames, { at: now, counts }];
  return { frames };
}

export function framesInWindow(
  state: ProfilingState,
  windowMs: number,
  now: number,
): ProfilingFrame[] {
  const since = now - windowMs;
  return state.frames.filter((f) => f.at >= since && f.at <= now);
}
