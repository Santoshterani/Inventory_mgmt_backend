# Asset Management System — Backend

Express.js + MySQL API implementing `requirements.md`, in an MVC-ish
layered structure: **routes → middleware → controllers → services → db**.

## Structure

```
src/
├── config/env.js          # loads and validates .env
├── db/
│   ├── schema.sql         # full MySQL schema (embedded, see below)
│   ├── seed.sql           # reference data (bases, equipment types)
│   ├── init.js            # creates DB, applies schema+seed, bootstraps an admin
│   └── pool.js            # mysql2 connection pool + withTransaction helper
├── middleware/
│   ├── auth.js            # JWT authentication (FR-01)
│   ├── authorize.js       # role allow-list (section 3.5)
│   ├── baseScope.js       # base-scope enforcement helpers (section 3.5)
│   └── errorHandler.js    # central error formatting
├── controllers/           # one per module, thin — parse req, call service, respond
├── services/               # business rules + transactions (one per module)
├── routes/                 # one file per module + index.js aggregator
├── utils/                  # ApiError, asyncHandler, password hashing
├── app.js                  # express app wiring
└── server.js                # entrypoint
```

## Setup

```bash
npm install
cp .env.example .env      # then edit DB_USER/DB_PASSWORD/JWT_SECRET etc.
npm run db:init            # creates the DB, applies schema.sql + seed.sql,
                            # and creates a bootstrap ADMIN user
npm run dev                 # http://localhost:5000
```

`CORS_ORIGIN` is a comma-separated list of allowed origins. For local
development, `http://localhost:*` allows the frontend's localhost port to vary
(for example, when Vite selects a port other than 5173). Set `FRONTEND_URL` to
the frontend's actual origin when configuring the password-reset link; it
defaults to `http://localhost:5173`.

Bootstrap admin credentials come from `BOOTSTRAP_ADMIN_USERNAME` /
`BOOTSTRAP_ADMIN_PASSWORD` in `.env` (defaults: `admin` / `ChangeMe123!`).
Sign in and change the password immediately in a real deployment.

## Database schema

The full schema lives in `src/db/schema.sql` and is applied automatically by
`npm run db:init`. Tables: `roles`, `bases`, `users`, `equipment_types`,
`inventory`, `purchases`, `transfers`, `transfer_items`,
`transfer_status_history`, `assignments`, `expenditures`, `audit_logs`.

Notable additions beyond the bare entity list in requirements.md §8:
- `inventory.reserved_quantity` — stock earmarked by a PENDING/IN_TRANSIT
  outbound transfer, so "available stock" (`total − assigned − reserved`)
  can never go negative and two concurrent transfers can't double-spend the
  same units (FR-05, NFR-03).
- `transfer_status_history` — durable log backing the UI's status-history
  view and reinforcing the audit trail (NFR-04).
- A DB-level `CHECK` constraint on `inventory` as a last line of defense
  against negative/overcommitted stock, on top of the application checks.

