/** Stable identifier guard for future domain entities. */
export function requireId(value: string): string {
  const id = value.trim();
  if (id.length === 0) throw new Error('An identifier is required');
  return id;
}
