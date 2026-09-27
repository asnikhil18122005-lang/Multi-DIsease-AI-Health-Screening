export interface ScalerParams {
  mean: number[];
  scale: number[];
}

export function standardScale(values: number[], params: ScalerParams): number[] {
  return values.map((val, idx) => {
    const mean = params.mean[idx] ?? 0;
    const scale = params.scale[idx] ?? 1;
    return scale === 0 ? 0 : (val - mean) / scale;
  });
}

export function minMaxScale(values: number[], min: number[], max: number[]): number[] {
  return values.map((val, idx) => {
    const minVal = min[idx] ?? 0;
    const maxVal = max[idx] ?? 1;
    const range = maxVal - minVal;
    return range === 0 ? 0 : (val - minVal) / range;
  });
}
