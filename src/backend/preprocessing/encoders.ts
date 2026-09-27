export function encodeCategorical(
  value: string | number | undefined | null,
  mapping: Record<string, number>,
  defaultValue = 0,
): number {
  if (value === undefined || value === null) return defaultValue;
  const key = String(value).trim().toLowerCase();
  for (const [k, v] of Object.entries(mapping)) {
    if (k.toLowerCase() === key) return v;
  }
  return defaultValue;
}

export function encodeBinary(
  value: string | number | boolean | undefined | null,
  positiveValues: (string | number | boolean)[] = ["yes", "y", "true", "1", 1, true],
): number {
  if (value === undefined || value === null) return 0;
  if (typeof value === "boolean") return value ? 1 : 0;
  const str = String(value).trim().toLowerCase();
  return positiveValues.some((p) => String(p).toLowerCase() === str) ? 1 : 0;
}

export function sanitizeNumber(
  value: unknown,
  min?: number,
  max?: number,
  defaultValue: number | null = null,
): number | null {
  if (value === undefined || value === null || value === "") return defaultValue;
  const num = Number(value);
  if (!Number.isFinite(num)) return defaultValue;
  if (min !== undefined && num < min) return defaultValue;
  if (max !== undefined && num > max) return defaultValue;
  return num;
}
