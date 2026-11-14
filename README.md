# Fatura Desk

Billing · Inventory · Accounts for multi-store retail (India, GST). Phase 1 = **GRN (Goods Receipt Note)**.

Stack: Next.js 15 (App Router, TypeScript) · PostgreSQL 16 · Drizzle ORM · Auth.js v5 (credentials) · Tailwind CSS v4 + shadcn/ui · zod · Docker Compose + Caddy.

## Build progress

| Step | Scope | Status |
|---|---|---|
| 1 | Project setup, Docker Compose, schema + migrations, seed, login/roles | ✅ |
| 2 | Settings masters | ✅ |
| 3 | GRN header card + validations | ✅ |
| 4 | Add Item panel, camera/image upload, Pending list, Populate | ✅ |
| 5 | Summary calculations | ✅ |
| 6 | Barcode generation + label printing | ✅ |
| 7 | Save GRN, GRN List, View/Print, Edit/Delete | ✅ |
| 8 | Concurrency test, backup/restore, VPS deployment | — |

## Run locally with Docker (recommended)

Needs Docker Desktop.

```bash
cp .env.example .env          # then edit POSTGRES_PASSWORD and AUTH_SECRET
docker compose build
docker compose up -d fatura-db
docker compose run --rm fatura-migrate                   # apply migrations
docker compose run --rm fatura-migrate npm run db:seed   # seed data (first time only)
docker compose up -d
```

Open **http://localhost:3000** (direct to the app) or **https://localhost** (through Caddy; accept the local certificate once).
Sign in as `admin` / `Admin@123` (or the `SEED_ADMIN_PASSWORD` you set) and change the password once user management lands in step 2.

Health check: `GET /api/health` → `{"status":"ok","db":"ok"}`.

## Run the app with `npm run dev` (hot reload)

Start only the database in Docker, published on `127.0.0.1:5433`:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d fatura-db
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

`DATABASE_URL` in `.env` must point at `localhost:5433` with the same password as `POSTGRES_PASSWORD`.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Unit + integration tests (`tests/`, Node test runner, throwaway in-memory Postgres) |
| `npm run db:generate` | Create a new migration from `src/db/schema.ts` changes |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:seed` | Idempotent seed (roles, admin, 2 locations, 2 suppliers, 3 departments, Style/Color/Size/Type values, barcode + GRN numbering settings) |
| `npm run db:studio` | Drizzle Studio |

## Project layout

```
drizzle/                  SQL migrations (0001 is hand-written: pg_trgm + current_stock view)
scripts/migrate.ts        migration runner (also used by the fatura-migrate container)
scripts/seed.ts           seed data
src/db/schema.ts          all tables
src/db/index.ts           shared pg pool (max 10) + Drizzle client
src/auth.ts               Auth.js credentials provider (bcrypt)
src/auth.config.ts        edge-safe config used by middleware
src/lib/permissions.ts    role → permission map (ADMIN / GRN_ENTRY / VIEWER)
src/lib/session.ts        getCurrentUser / requirePermission / assertPermission
src/components/shell/     sidebar, top bar, app shell
src/app/(app)/            signed-in pages
src/app/login/            sign-in screen
```

## Data model notes

- Money `NUMERIC(14,2)`, quantity `INTEGER`, timestamps `TIMESTAMPTZ` shown in Asia/Kolkata.
- `products` is the shared SKU master (Dept + Item + Cat1–4 + MRP, unique) used later by Sales/Returns.
- `stock_ledger` holds every stock movement; `current_stock` view = `SUM(qty_in − qty_out)` per product/location.
- `counters (name, fy)` rows are locked with `SELECT … FOR UPDATE` for gap-free GRN and barcode numbers.
- Supplier + invoice no. is unique among non-cancelled GRNs (case- and space-insensitive), so a deleted GRN's invoice can be entered again.
- Roles and allowed locations are re-read from the database on every request, so deactivating a user or changing their role takes effect immediately.

## Settings (Admin only)

Company Profile · Suppliers · Transport · Departments · Categories · Barcode · GRN Numbering · Locations · Users.
Masters are deactivated, never deleted. Every create/update writes an `audit_log` row (old/new values, passwords stripped).
Uploaded images go to `UPLOAD_DIR` and are served at `/uploads/...` to signed-in users only (JPEG/PNG/WebP, checked by file signature).

## Docker services

| Service | Purpose |
|---|---|
| `fatura-db` | Postgres 16; **no published port** (internal network only) |
| `fatura-app` | Next.js standalone server; port 3000 bound to 127.0.0.1 only |
| `fatura-caddy` | HTTPS reverse proxy for `APP_DOMAIN` |
| `fatura-migrate` | one-off migrations/seed (`tools` profile; not started by `up`) |

VPS hardening, backups, `deploy.sh` and restore docs come in step 8.
