import { Graphics } from 'pixi.js';
import type { Distribution } from '../prediction/diagnostics';

// Axis-aligned marginal quantiles, not an ellipse pretending to have joint coverage.
export function intervalGraphic(distribution: Distribution, tick: number, selected: string | null) {
  const graphic = new Graphics();
  const frame = distribution.steps.find((step) => step.tick === tick);
  for (const body of frame?.objects || []) {
    if (selected && body.id !== selected) continue;
    const [x, y] = body.lower;
    const width = body.upper[0] - x,
      height = body.upper[1] - y;
    if (width < 1e-8 && height < 1e-8) continue;
    graphic
      .rect(x, y, Math.max(width, 0.008), Math.max(height, 0.008))
      .fill({ color: 0xab8de5, alpha: 0.1 })
      .stroke({ color: 0xab8de5, width: 0.02, alpha: 0.6 });
    graphic.circle(body.mean[0], body.mean[1], 0.055).fill({ color: 0xceafff, alpha: 0.8 });
  }
  return graphic;
}
