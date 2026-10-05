import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { Prediction } from './types';

export default function PredictionChart({
  prediction,
  selectedId,
  step,
}: {
  prediction: Prediction;
  selectedId: string | null;
  step: number;
}) {
  const hasSelected = prediction.metrics.objects.some((body) => body.id === selectedId);
  const data = [
    { step: 0, mean: 0, selected: 0 },
    ...prediction.metrics.horizons.map((row) => ({
      step: row.step,
      mean: row.displacement_m,
      selected: row.objects.find((body) => body.id === selectedId)?.displacement_m,
    })),
  ];
  return (
    <div
      className="forecast-chart"
      role="img"
      aria-label="Measured displacement error versus forecast step"
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 7, right: 7, left: -26, bottom: -6 }}>
          <CartesianGrid vertical={false} stroke="#25313e" />
          <XAxis
            dataKey="step"
            type="number"
            domain={[0, prediction.horizon]}
            tickLine={false}
            axisLine={false}
            stroke="#738594"
            fontSize={8}
            tickCount={5}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            stroke="#738594"
            fontSize={8}
            tickFormatter={(value: number) => value.toFixed(1)}
          />
          <Tooltip
            cursor={{ stroke: '#a79ad7', strokeDasharray: '3 3' }}
            contentStyle={{
              background: '#18222e',
              border: '1px solid #25313e',
              borderRadius: 6,
              fontSize: 10,
            }}
            labelFormatter={(value) => `Step ${value}`}
            formatter={(value) => `${Number(value).toFixed(3)} m`}
          />
          <ReferenceLine x={step} stroke="#dfb978" strokeDasharray="3 3" />
          <Line
            dataKey="mean"
            name="All objects"
            stroke="#a79ad7"
            strokeWidth={1.7}
            dot={false}
            isAnimationActive={false}
          />
          {hasSelected && (
            <Line
              dataKey="selected"
              name={selectedId || 'Selected'}
              stroke="#93e3eb"
              strokeWidth={1.4}
              dot={false}
              isAnimationActive={false}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
