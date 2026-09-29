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

## Business rules implemented

- **FR-01 Auth**: bcrypt password hashes, JWT bearer tokens, inactive
  accounts rejected on every request (not just at login).
- **FR-03/NFR-03 Inventory integrity**: every quantity-changing write runs
  inside a DB transaction; `SELECT ... FOR UPDATE` row-locks the relevant
  `inventory` row before checking available stock, so concurrent requests
  can't both pass the same check.
- **FR-04 Purchases**: insert + inventory update happen in one transaction.
- **FR-05 Transfers**: creating a transfer reserves stock at the source
  base immediately (`reserved_quantity`); moving to `COMPLETED` moves the
  quantity from source to destination; moving to `CANCELLED` releases the
  reservation. Status changes are idempotent — an `UPDATE ... WHERE status
  = <expected>` guard means a retried or duplicate request can never apply
  the same inventory effect twice.
- **FR-06 Assignments** / **FR-07 Expenditures**: stock/remaining-quantity
  checks run inside the same transaction as the write.
- **FR-08 Users**: Admins can create any role; a Base Commander can only
  create Logistics Officer accounts at their own base, and only if their
  account has `can_create_users` set (section 3.4's "configurable"
  permission is a per-user flag, not a global toggle).
- **FR-09 Audit**: every state-changing action writes an `audit_logs` row
  inside the same transaction as the business write it documents.
- **Section 3.5**: every route runs `authenticate` (401 if missing/invalid
  token) and, where relevant, `authorize(...)` (403 if wrong role). Base
  scope is enforced in the service layer via `resolveReadBaseId` /
  `assertWritableBase`, so a base-scoped user can't read or write another
  base's data by editing a request parameter.

## Open questions (requirements.md §13)

A few defaults were chosen to keep this framework runnable; confirm and
adjust before relying on them:
- Transfer lifecycle: `PENDING → IN_TRANSIT → COMPLETED`, or `→ CANCELLED`
  from `PENDING`/`IN_TRANSIT`. Inventory moves at `COMPLETED`.
- Base Commander user creation is off by default (`can_create_users = 0`);
  flip it per account once approved.
- Returns are not yet implemented — `assignments.status` has a `RETURNED`
  value reserved for that workflow, but nothing sets it yet.
- No serial-number tracking; equipment is tracked by type + quantity only.

## API

See `requirements.md` §7 for the full endpoint list — every route there is
implemented. All list endpoints accept `page`/`pageSize` and return
`{ items, total, ...lookups }`.
