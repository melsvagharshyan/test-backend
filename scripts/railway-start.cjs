const { spawnSync } = require('node:child_process');

function normalizeDatabaseUrl(raw) {
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

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

process.env.DATABASE_URL = normalizeDatabaseUrl(process.env.DATABASE_URL);
console.log(
  `Connecting to Postgres at ${new URL(process.env.DATABASE_URL).host}`,
);

const maxAttempts = 12;
for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  const result = spawnSync(
    'pnpm',
    ['exec', 'prisma', 'migrate', 'deploy'],
    { stdio: 'inherit', env: process.env },
  );

  if (result.status === 0) {
    const fs = require('node:fs');
    const entry = ['dist/main.js', 'dist/src/main.js'].find((file) =>
      fs.existsSync(file),
    );
    if (!entry) {
      console.error('Built app not found. Expected dist/main.js');
      process.exit(1);
    }
    const app = spawnSync('node', [entry], {
      stdio: 'inherit',
      env: process.env,
    });
    process.exit(app.status ?? 1);
  }

  console.error(
    `Migration attempt ${attempt}/${maxAttempts} failed. Retrying in 5s...`,
  );
  spawnSync('sleep', ['5']);
}

process.exit(1);
