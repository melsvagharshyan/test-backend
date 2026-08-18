export function normalizeDatabaseUrl(raw: string): string {
  const normalized = raw.replace(/^postgres:\/\//, 'postgresql://');
  const parsed = new URL(normalized);
  const isPrivate = parsed.hostname.endsWith('.railway.internal');

  if (!parsed.searchParams.has('sslmode')) {
    parsed.searchParams.set('sslmode', isPrivate ? 'disable' : 'require');
  }
  if (!parsed.searchParams.has('connect_timeout')) {
    parsed.searchParams.set('connect_timeout', '30');
  }

  return parsed.toString();
}
