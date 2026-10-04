import { describe, expect, it } from 'vitest';
import { hitTest, scaleFor, screenToWorld, worldToScreen } from './coordinates';
describe('Camera coordinates', () => {
  it('round trips with pan, zoom and either desktop resolution', () => {
    for (const [width, height] of [
      [1440, 900],
      [1920, 1080],
    ])
      for (const zoom of [0.5, 1, 3]) {
        const camera = { x: 13, y: 8, zoom },
          point = { x: 17, y: 2 };
        const result = screenToWorld(
          worldToScreen(point, camera, width, height),
          camera,
          width,
          height,
        );
        expect(result.x).toBeCloseTo(point.x);
        expect(result.y).toBeCloseTo(point.y);
      }
  });
  it('positive world y points upward on the screen', () => {
    const camera = { x: 12, y: 7, zoom: 1 };
    expect(worldToScreen({ x: 12, y: 8 }, camera, 1000, 600).y).toBeLessThan(300);
  });
  it('fits the complete scene with margins', () => {
    expect(scaleFor(280, 170)).toBe(10);
  });
});
describe('Selection geometry', () => {
  it('picks a circle only inside its radius', () => {
    const circle = {
      position: { x: 3, y: 4 },
      rotation: 0,
      shape: 'circle',
      radius: 1,
      width: 1,
      height: 1,
    };
    expect(hitTest({ x: 3.5, y: 4 }, circle)).toBe(true);
    expect(hitTest({ x: 5, y: 4 }, circle)).toBe(false);
  });
  it('respects rotated ramp geometry', () => {
    const ramp = {
      position: { x: 0, y: 0 },
      rotation: Math.PI / 2,
      shape: 'ramp',
      radius: 1,
      width: 4,
      height: 0.2,
    };
    expect(hitTest({ x: 0, y: 1.5 }, ramp)).toBe(true);
    expect(hitTest({ x: 1.5, y: 0 }, ramp)).toBe(false);
  });
});
