// Brier score and calibration. Mirror of databricks/lib/clout.py.

export const brier = (forecast: number, outcome: 0 | 1 | number) => (forecast - outcome) ** 2;

export function meanBrier(pairs: readonly (readonly [number, number])[]): number | null {
  if (pairs.length === 0) return null;
  return pairs.reduce((a, [f, o]) => a + brier(f, o), 0) / pairs.length;
}

/** 10% bins: 0 -> [0,0.1), ..., 9 -> [0.9,1.0]. */
export const calibrationBucket = (f: number) => Math.min(9, Math.max(0, Math.floor(f * 10)));

export type CalibrationBin = { bucket: number; n: number; mean_forecast: number; hit_rate: number };

export function calibrationCurve(pairs: readonly (readonly [number, number])[]): CalibrationBin[] {
  const bins = new Map<number, (readonly [number, number])[]>();
  for (const p of pairs) {
    const k = calibrationBucket(p[0]);
    bins.set(k, [...(bins.get(k) ?? []), p]);
  }
  return [...bins.entries()]
    .sort(([a], [b]) => a - b)
    .map(([bucket, v]) => ({
      bucket,
      n: v.length,
      mean_forecast: v.reduce((a, [f]) => a + f, 0) / v.length,
      hit_rate: v.reduce((a, [, o]) => a + o, 0) / v.length,
    }));
}
