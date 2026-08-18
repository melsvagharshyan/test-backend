# Acme Data Room — API

NestJS backend for the Data Room MVP: JWT auth, PostgreSQL via Prisma, Cloudinary for PDF bytes, and share-aware authorization.

Product overview, ERD, and scale answers live in the [root README](../README.md).

## Hosted URL

https://test-backend-production-382b.up.railway.app/api/health

API prefix: `/api`

## Design decisions (backend)

- **Modules by domain:** `auth`, `users`, `data-rooms`, `folders`, `files`, `shares`, `access`, `storage`, `prisma`.
- **Global JWT guard** with `@Public()` only on register/login, health, and public-link routes.
- **Authorization in `AccessService`:** owner of the room, or an active `USER` share whose resource contains the requested folder/file. Public links use the token only — no login.
- **Folder uniqueness:** `@@unique([dataRoomId, parentKey, name])`. `parentKey` is `"root"` or the parent folder id so root-level names stay unique without a nullable unique column.
- **File uniqueness:** `@@unique([folderId, name])`. Duplicate uploads/renames/moves call `resolveUniqueName` (`Report (2).pdf`).
- **Deletes:** `GET /folders/:id/delete-preview` returns counts and sample names before `DELETE`. Cascade is DB `onDelete: Cascade` plus Cloudinary cleanup.
- **PDF delivery:** Cloudinary `raw` + `authenticated`. Preview/download is proxied (`GET /files/:id/content`) so the browser is not blocked by Cloudinary iframe/auth headers.

## Setup

```bash
cp .env.example .env
pnpm install
pnpm prisma:generate
pnpm prisma:migrate:dev
pnpm start:dev
```

### Environment

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL URL (local or Railway **private** URL in the same project) |
| `JWT_SECRET` | Required. App will not boot without it |
| `FRONTEND_URL` | CORS origins, comma-separated, no trailing slash |
| `CLOUDINARY_CLOUD_NAME` | Cloudinary cloud |
| `CLOUDINARY_API_KEY` | Cloudinary key |
| `CLOUDINARY_API_SECRET` | Cloudinary secret |
| `CLOUDINARY_FOLDER` | Prefix for public IDs (`data-room`) |
| `PORT` | Defaults to `3000`; Railway injects this |

## Scripts

| Script | What it does |
| --- | --- |
| `pnpm start:dev` | Watch mode |
| `pnpm build` | `prisma generate` + `nest build` |
| `pnpm railway:start` | `prisma migrate deploy` then `node dist/main.js` |
| `pnpm test` | Unit tests (naming + share scope) |

## Railway

Postgres and this API **must be in the same Railway project** or `*.railway.internal` will not resolve.

Start command: `pnpm railway:start`  
Healthcheck: `/api/health`

## Where AI was used (backend)

Cursor generated first-pass Nest modules, Prisma models, DTO validators, and the Railway/Prisma 7 adapter wiring. I specified and then reviewed:

- Share scope rules (room vs folder subtree vs single file)
- Incremental folder aggregates
- Unique-name helper and tests
- Streaming PDFs through Nest instead of returning a Cloudinary URL to an iframe

AI also helped diagnose production boot failures (`JWT_SECRET` missing, Node 18 vs Prisma 7, `dist/src/main.js` vs `dist/main.js`). Those fixes are in `nixpacks.toml`, `tsconfig.build.json`, and `scripts/railway-start.cjs`.
