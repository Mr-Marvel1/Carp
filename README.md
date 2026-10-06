# Harshit International

A local carpet storefront for Mirzapur, Bhadohi, Varanasi and nearby areas. Customers can browse and build a bag without an account; an account is required only to place an order. Local development uses SQLite. Production uses Supabase PostgreSQL through the `pg` driver.

The catalog contains no fabricated business inventory. A separate, explicitly marked development seed can add 24 demo carpet examples; production APIs hide those records and reject demo items at checkout.

## Requirements

- Node.js 22.13 or newer. Node 24 is recommended for its built-in SQLite driver.
- Dependencies are declared in `package.json`; install them with `npm install` after a fresh checkout.

## Run locally

Copy `.env.example` to `.env`, set a strong admin password and session secret, then start the app:

```powershell
Copy-Item .env.example .env
npm start
```

Open `http://127.0.0.1:3000`. The first startup creates the admin user from `ADMIN_EMAIL` and `ADMIN_PASSWORD`; open **Store admin** in the footer and sign in to add the real catalog. Use `npm run dev` to restart on server file changes.

## Development demo catalog

Start the app once so the local SQLite schema exists. Then run the seed command with its explicit development-only opt-in:

```powershell
$env:ALLOW_DEMO_SEED = '1'
npm run seed:demo
Remove-Item Env:ALLOW_DEMO_SEED
```

The script adds up to 24 `[DEMO]` records, labels their descriptions as not for sale, and is safe to rerun. Keep `NODE_ENV` unset or set it to `development`; seeding refuses production mode. Demo products remain hidden from public catalog, detail, category, and checkout endpoints when `NODE_ENV=production`, and remain labeled in the admin product list. The seed script writes only to the configured development `DATABASE_PATH`.

For production, set `NODE_ENV=production`, use a stable random `SESSION_SECRET` (at least 32 characters), and configure the hosting environment with `SUPABASE_DB_URL`. Production session cookies are marked `Secure`.

## Store details

Set `STORE_NAME`, `STORE_PHONE`, `STORE_WHATSAPP`, `STORE_ADDRESS`, and `SERVICE_AREAS` in `.env` to the verified business details. Contact fields are intentionally blank until supplied. The interface uses **Harshit International**, following the business name in the request; “Farzet International” was also mentioned there and should be confirmed before launch.

## Ordering

Checkout stores the customer’s delivery details and order in the configured database, validates stock on the server, and reserves stock atomically. Online payment is not enabled: the store team confirms delivery timing and payment directly with the customer. Cancelling an order in the admin dashboard returns its reserved stock.

## Supabase production database

1. Create a Supabase PostgreSQL project and set `SUPABASE_DB_URL` in `.env` to its connection string. Keep this secret out of source control and chat. The pooler/session connection string is appropriate for serverless use.
2. Keep `DATABASE_PATH` set to the existing local SQLite file. Set a stable production `SESSION_SECRET`; reuse the original value if existing sessions must remain valid.
3. Stop local app writes and run `npm run migrate:postgres`. The command applies the PostgreSQL schema to an empty target, copies users, password hashes, sessions, real products, orders and order items from one consistent SQLite snapshot, preserves IDs, and advances identity sequences. It refuses to copy into any target containing rows and skips `[DEMO]` products; historical item snapshots remain intact.
4. Run `npm run build`. The production build checks source syntax, connects to Supabase, and verifies that the PostgreSQL migrations have been applied. It fails closed when credentials, connectivity or schema are missing.
5. Set `NODE_ENV=production`, `SUPABASE_DB_URL`, `SESSION_SECRET`, `ADMIN_EMAIL` and `ADMIN_PASSWORD` in the hosting environment. The app refuses to start in production without PostgreSQL; the build gate requires all four secrets/settings.

Keep a backup of the SQLite source and verify the row counts reported by the migration command before switching production traffic. The current SQLite-to-Supabase data copy and read-only row-count verification are complete. The guarded transfer script refuses to copy into an already populated target.

If PostgreSQL TLS fails with `SELF_SIGNED_CERT_IN_CHAIN` on a managed or inspected network, set `PG_CA_CERT_PATH` to the PEM root certificate file that issued the trusted connection. The client continues to verify the server certificate; do not disable certificate verification to work around this error.

## Deployment gate

The SQLite-to-PostgreSQL transfer and row-count verification are complete. Re-run `npm run build` against the configured Supabase project after setting the Vercel environment variables; deployment has not been started.

## Vercel configuration

`vercel.json` routes API requests through `api/[...route].mjs`, serves the static storefront from `public/`, bundles the PostgreSQL migrations, and runs `npm run build` before deployment.

Add these variables to the Vercel **Production** environment:

- `SUPABASE_DB_URL`: Supabase PostgreSQL connection string.
- `PG_CA_CERT`: full PEM contents of the trusted Supabase CA certificate. Paste the PEM, or provide newline characters as `\n`. The local `PG_CA_CERT_PATH` is not used on Vercel because local certificates are excluded from Git.
- `SESSION_SECRET`: stable random value, at least 32 characters.
- `ADMIN_EMAIL`: administrator sign-in email.
- `ADMIN_PASSWORD`: administrator password, at least 12 characters.

Vercel sets `NODE_ENV=production` for Production deployments. The store display settings `STORE_NAME`, `STORE_PHONE`, `STORE_WHATSAPP`, `STORE_ADDRESS`, and `SERVICE_AREAS` are optional and use the documented defaults when omitted. Do not set `ALLOW_DEMO_SEED` in Vercel.

Never add `.env`, database files, or local certificate files to Git. No Vercel project is linked in this workspace, and no deployment has been started.

## Checks

```powershell
npm test
```

The integration tests use an isolated temporary database and do not add sample items to the store database.