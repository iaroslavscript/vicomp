import { describe, expect, it } from 'vitest';
import { alongCandidates, clippedLength, crosses, labelCandidates, overlap, place, type Item, type Rect } from './labels';

const bounds: Rect = { x: 0, y: 0, w: 100, h: 62.5 };
const label = (x: number, y: number, w = 20): Item => ({ candidates: labelCandidates(x, y, w, 4, 1), avoidSegments: true });

describe('label placement', () => {
  it('geometry helpers', () => {
    expect(overlap({ x: 0, y: 0, w: 4, h: 4 }, { x: 2, y: 3, w: 4, h: 4 })).toBe(2);
    expect(overlap({ x: 0, y: 0, w: 1, h: 1 }, { x: 2, y: 2, w: 1, h: 1 })).toBe(0);
    expect(clippedLength({ x1: -5, y1: 1, x2: 5, y2: 1 }, { x: 0, y: 0, w: 2, h: 2 })).toBeCloseTo(2);
    expect(clippedLength({ x1: -5, y1: 5, x2: 5, y2: 5 }, { x: 0, y: 0, w: 2, h: 2 })).toBe(0);
    expect(clippedLength({ x1: 1, y1: 1, x2: 1.5, y2: 1 }, { x: 0, y: 0, w: 2, h: 2 })).toBeCloseTo(0.5);
    expect(crosses({ x1: 0, y1: 0, x2: 2, y2: 2 }, { x1: 0, y1: 2, x2: 2, y2: 0 })).toBe(true);
    expect(crosses({ x1: 0, y1: 0, x2: 2, y2: 2 }, { x1: 3, y1: 3, x2: 5, y2: 1 })).toBe(false);
    expect(crosses({ x1: 0, y1: 0, x2: 1, y2: 1 }, { x1: 0, y1: 2, x2: 2, y2: 4 })).toBe(false);
    expect(crosses({ x1: 0, y1: 0, x2: 1, y2: 1 }, { x1: 2, y1: 0, x2: 1, y2: 1 })).toBe(true);
  });

  it('keeps the preferred spot when there is room', () => {
    const [only] = place([label(50, 30)], { bounds, obstacles: [], segments: [], points: [] });
    expect(only).toEqual(label(50, 30).candidates[0]);
    expect(only.leader).toBeNull();
  });

  it('separates labels of nearby stops', () => {
    // Clustered stops, like Essen and Dortmund in a regional route.
    const points = [
      { x: 40, y: 30 },
      { x: 43, y: 31 },
      { x: 41, y: 33 },
      { x: 44, y: 28 },
    ];
    const placed = place(
      points.map((p) => label(p.x, p.y)),
      { bounds, obstacles: [], segments: [], points },
    );
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const [a, b] = [placed[i], placed[j]];
        expect(overlap(a, b), `${i}/${j}`).toBe(0);
        if (a.leader && b.leader) expect(crosses(a.leader, b.leader), `leaders ${i}/${j}`).toBe(false);
      }
    }
    // Each label is nearest to its own stop, so it is clear which stop it belongs to.
    const dist = (r: Rect, p: { x: number; y: number }) =>
      Math.hypot(Math.max(r.x - p.x, 0, p.x - r.x - r.w), Math.max(r.y - p.y, 0, p.y - r.y - r.h));
    placed.forEach((r, i) => points.forEach((p, j) => expect(dist(r, points[i]), `${i} vs ${j}`).toBeLessThanOrEqual(dist(r, p))));
  });

  it('stays inside the map and away from obstacles', () => {
    const inset = { x: 70, y: 47, w: 30, h: 15.5 };
    const placed = place([label(96, 2), label(65, 45)], { bounds, obstacles: [inset], segments: [], points: [] });
    for (const r of placed) {
      expect(overlap(r, bounds)).toBeCloseTo(r.w * r.h);
      expect(overlap(r, inset)).toBe(0);
    }
  });

  it('avoids covering route lines', () => {
    const segment = { x1: 50, y1: 30, x2: 90, y2: 5 };
    const [r] = place([label(50, 30)], { bounds, obstacles: [], segments: [segment], points: [] });
    expect(clippedLength(segment, r)).toBe(0);
  });

  it('moves leg emoji off a stop marker', () => {
    const stop = { x: 48, y: 28, w: 4, h: 4 };
    const [r] = place([{ candidates: alongCandidates({ x1: 30, y1: 30, x2: 70, y2: 30 }, 4, 4), avoidSegments: false }], {
      bounds,
      obstacles: [stop],
      segments: [],
      points: [],
    });
    expect(overlap(r, stop)).toBe(0);
  });
});

describe('leg emoji on short legs', () => {
  it('moves beside the line instead of covering both ends', () => {
    const seg = { x1: 40, y1: 30, x2: 45, y2: 30 };
    const stops = [
      { x: 38.5, y: 28.5, w: 3, h: 3 },
      { x: 43.5, y: 28.5, w: 3, h: 3 },
    ];
    const [r] = place([{ candidates: alongCandidates(seg, 4, 4), avoidSegments: false }], { bounds, obstacles: stops, segments: [], points: [] });
    for (const s of stops) expect(overlap(r, s)).toBe(0);
  });
});
