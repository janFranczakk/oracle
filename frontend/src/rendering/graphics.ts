import { Graphics } from 'pixi.js';
import type { Body } from '../types';

// Tessellate curves in pixel-sized geometry, then map back to metres.
export const CURVE_SCALE = 100;

export function bodyGraphic(body: Body) {
  const g = new Graphics();
  if (body.shape === 'circle') {
    const r = body.radius * CURVE_SCALE;
    g.scale.set(1 / CURVE_SCALE);
    g.circle(3.5, -8, r + 8).fill({ color: 0x000000, alpha: 0.16 });
    g.circle(0, 0, r).fill(0x335564).stroke({ color: 0x98bfcc, width: 2.3, alpha: 0.8 });
    for (let i = 5; i > 0; i--) {
      g.circle(-r * 0.19, r * 0.22, r * (0.42 + i * 0.065)).fill({ color: 0xa4ced7, alpha: 0.045 });
    }
    g.arc(0, 0, r * 0.86, 0.35, 2.15).stroke({ color: 0xd4ecf0, width: 2, alpha: 0.5 });
    g.moveTo(0, 0)
      .lineTo(r * 0.68, 0)
      .stroke({ color: 0xe0eff2, width: 1.8, alpha: 0.3 });
    g.circle(0, 0, 3.5).fill({ color: 0xdcecf0, alpha: 0.6 });
  } else {
    const { width: w, height: h } = body;
    g.rect(-w / 2, -h / 2 - 0.07, w, h).fill({ color: 0x000000, alpha: 0.18 });
    g.rect(-w / 2, -h / 2, w, h)
      .fill(body.static ? 0x1e2d39 : 0x455766)
      .stroke({ color: body.static ? 0x627a89 : 0xa7b7c4, width: 0.025, alpha: 0.7 });
    g.moveTo(-w / 2, h / 2)
      .lineTo(w / 2, h / 2)
      .stroke({ color: 0xc5dce2, width: 0.035, alpha: body.static ? 0.65 : 0.85 });
    if (body.static && w > h) {
      for (let x = -w / 2 + 0.15; x < w / 2 - 0.1; x += 0.4) {
        g.moveTo(x, -h / 2)
          .lineTo(x + 0.12, h / 2)
          .stroke({ color: 0x74909c, width: 0.012, alpha: 0.2 });
      }
    }
    if (!body.static) {
      g.rect(-w / 2 + 0.15, -h / 2 + 0.15, w - 0.3, h - 0.3).stroke({
        color: 0xc2d2da,
        width: 0.014,
        alpha: 0.25,
      });
    }
  }
  return g;
}

export function ghostGraphic(body: Body, color: number, alpha: number, active = false) {
  const g = new Graphics();
  const factor = body.shape === 'circle' ? CURVE_SCALE : 1;
  g.scale.set(1 / factor);
  if (body.shape === 'circle') {
    g.circle(0, 0, body.radius * factor);
  } else g.rect(-body.width / 2, -body.height / 2, body.width, body.height);
  g.fill({ color, alpha: alpha * 0.2 }).stroke({
    color,
    alpha,
    width: (active ? 0.045 : 0.025) * factor,
  });
  g.moveTo(0, 0)
    .lineTo((body.shape === 'circle' ? body.radius * factor : body.width / 2) * 0.7, 0)
    .stroke({ color, alpha: alpha * 0.6, width: 0.018 * factor });
  g.position.set(body.position.x, body.position.y);
  g.rotation = body.rotation;
  return g;
}
