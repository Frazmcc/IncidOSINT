// JSON can be null, a scalar or an array. Callers validate individual fields
// after this shared boundary, before using them in storage or provider calls.
export function parseJsonObject(text: string): Record<string, unknown> | null {
  const value: unknown = JSON.parse(text);
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
