# Harshit International

A local carpet storefront for Mirzapur, Bhadohi, Varanasi and nearby areas. Customers can browse and build a bag without an account; an account is required only to place an order. Store inventory and orders live in SQLite and are managed in the admin dashboard.

The catalog is intentionally empty on a fresh install. There are no sample products: an administrator enters Harshit International’s actual carpet details and image links.

## Requirements

- Node.js 22.13 or newer. Node 24 is recommended for its built-in SQLite driver.
- No package installation is needed.

## Run locally

Copy `.env.example` to `.env`, set a strong admin password and session secret, then start the app:

```powershell
Copy-Item .env.example .env
npm start
```

Open `http://127.0.0.1:3000`. The first startup creates the admin user from `ADMIN_EMAIL` and `ADMIN_PASSWORD`; open **Store admin** in the footer and sign in to add the real catalog. Use `npm run dev` to restart on server file changes.

For production, set `NODE_ENV=production`, use a long random `SESSION_SECRET`, configure an HTTPS reverse proxy, and change `HOST` to the appropriate interface. Production session cookies are marked `Secure`. Back up the SQLite database at the path in `DATABASE_PATH`.

## Store details

Set `STORE_NAME`, `STORE_PHONE`, `STORE_WHATSAPP`, `STORE_ADDRESS`, and `SERVICE_AREAS` in `.env` to the verified business details. Contact fields are intentionally blank until supplied. The interface uses **Harshit International**, following the business name in the request; “Farzet International” was also mentioned there and should be confirmed before launch.

## Ordering

Checkout stores the customer’s delivery details and order in SQLite, validates stock on the server, and reserves stock atomically. Online payment is not enabled: the store team confirms delivery timing and payment directly with the customer. Cancelling an order in the admin dashboard returns its reserved stock.

## Checks

```powershell
npm test
```

The integration tests use an isolated temporary database and do not add sample items to the store database.