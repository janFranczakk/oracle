import { Container, Graphics } from 'pixi.js';
import { frameAt, ghostAlpha, ghostSteps, pairedBodies, trajectory } from '../prediction/forecast';
import type { Prediction } from '../prediction/types';
import { ghostGraphic } from './graphics';
import { intervalGraphic } from './uncertainty';

type ForecastDisplay = {
  prediction: Prediction | null;
  forecastStep: number;
  selectedId: string | null;
  ghosts: boolean;
  reference: boolean;
  errorVectors: boolean;
};

export class ForecastLayer {
  readonly paths = new Graphics();
  readonly bodies = new Container();
  readonly gaps = new Graphics();
  private lastForecast = '';
  update(s: ForecastDisplay) {
    const prediction = s.prediction;
    const forecastKey = `${prediction?.created_at}-${s.forecastStep}-${s.selectedId}-${s.ghosts}-${s.reference}-${s.errorVectors}`;
    if (forecastKey !== this.lastForecast) {
      this.lastForecast = forecastKey;
      this.paths.clear();
      this.gaps.clear();
      for (const child of this.bodies.removeChildren()) child.destroy();
      if (prediction) {
        if (s.ghosts && prediction.uncertainty && s.forecastStep > 0)
          this.bodies.addChild(
            intervalGraphic(
              prediction.uncertainty,
              prediction.frames[s.forecastStep - 1].tick,
              s.selectedId,
            ),
          );
        const dynamic = prediction.anchor_frame.objects.filter((body) => !body.static);
        for (const body of dynamic) {
          const focus = !s.selectedId || body.id === s.selectedId;
          for (const actual of [false, true]) {
            if (actual ? !s.reference : !s.ghosts) continue;
            const points = trajectory(prediction, body.id, actual);
            this.paths.moveTo(points[0].x, points[0].y);
            for (const point of points.slice(1)) this.paths.lineTo(point.x, point.y);
            this.paths.stroke({
              color: actual ? 0x93e3eb : 0xa79ad7,
              width: actual ? 0.025 : 0.04,
              alpha: focus ? (actual ? 0.4 : 0.65) : 0.16,
            });
          }
        }
        if (s.ghosts)
          for (const step of ghostSteps(prediction.horizon)) {
            for (const body of frameAt(prediction, step).objects.filter((body) => !body.static))
              this.bodies.addChild(
                ghostGraphic(
                  body,
                  0xa79ad7,
                  ghostAlpha(step, prediction.horizon) *
                    (!s.selectedId || s.selectedId === body.id ? 1 : 0.4),
                ),
              );
          }
        for (const pair of pairedBodies(prediction, s.forecastStep)) {
          const focus = !s.selectedId || pair.actual.id === s.selectedId;
          if (s.ghosts)
            this.bodies.addChild(ghostGraphic(pair.predicted, 0xc3b6f1, focus ? 0.85 : 0.28, true));
          if (s.reference)
            this.bodies.addChild(ghostGraphic(pair.actual, 0x93e3eb, focus ? 0.75 : 0.25, true));
          if (s.errorVectors && s.forecastStep > 0) {
            const a = pair.actual.position,
              p = pair.predicted.position;
            this.gaps
              .moveTo(a.x, a.y)
              .lineTo(p.x, p.y)
              .stroke({ color: 0xdfb978, width: 0.025, alpha: focus ? 0.8 : 0.15 });
            this.gaps.circle(p.x, p.y, 0.065).fill({ color: 0xdfb978, alpha: focus ? 0.8 : 0.15 });
          }
        }
      }
    }
  }
}
