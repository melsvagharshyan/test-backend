import 'dotenv/config';
import { defineConfig } from 'prisma/config';

const raw = process.env['DATABASE_URL'];
if (!raw) {
  throw new Error(
    'DATABASE_URL is not set. On Railway, add it as a service variable referencing your Postgres instance.',
  );
}

function normalizeDatabaseUrl(value: string): string {
  const normalized = value.replace(/^postgres:\/\//, 'postgresql://');
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

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: { url: normalizeDatabaseUrl(raw) },
});
