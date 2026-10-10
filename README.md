# Mie-kelar POS

Modern web-based Point of Sale (POS) and business management dashboard built with **Next.js, React, TypeScript, and Supabase**.

Mie-kelar is designed as a reusable POS foundation for restaurants, cafes, retail stores, and UMKM businesses. The application provides a responsive workflow from product management and inventory through checkout, transactions, customers, notifications, receipts, and analytics.

## Highlights

- Responsive UI for mobile, tablet, and desktop
- POS / cashier workflow
- Product and category management
- Inventory and stock adjustments
- Customer management
- Order and transaction history
- Sales analytics and reporting
- Payment methods: Cash, E-Wallet, ATM
- Receipt / thermal-print workflow
- Product image upload through Supabase Storage
- Supabase Authentication and database integration
- Multi-user data isolation with `owner_id` and Row Level Security (RLS)
- Search and filtering across operational modules
- Realtime-oriented data updates where supported by the application

## Technology

| Layer | Technology |
|---|---|
| Framework | Next.js 13.5.1 |
| UI | React 18 + Tailwind CSS |
| Language | TypeScript |
| Backend / Database | Supabase + PostgreSQL |
| Authentication | Supabase Auth |
| Charts | Recharts |
| Animation | Framer Motion |
| Validation | Zod / React Hook Form |
| Deployment | Vercel or compatible Next.js hosting |

## Project structure

```text
app/            Application pages and main UI
components/     Reusable UI components
lib/            Supabase and application utilities
supabase/       Database schema, migrations and SQL setup
docs/           Deployment, database and operational documentation
```

## Quick start

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Create `.env.local` from `.env.local.example` and provide the credentials for the **same Supabase project** used by the application.

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your_supabase_publishable_key
```

The application also contains compatibility handling for the legacy anonymous-key variable where applicable.

### 3. Prepare Supabase

Review `docs/DATABASE.md` before running SQL. The recommended schema/setup files are located under `supabase/`.

### 4. Run locally

```bash
npm run dev
```

Open the local development URL shown by Next.js.

### 5. Validate before deployment

```bash
npm run typecheck
npm run build
```

Both checks should be treated as release gates. Do not use a deployment warning as evidence that the application is production-ready.

## Deployment

For the complete Vercel/environment-variable procedure, see:

- `docs/DEPLOYMENT.md`
- `docs/TROUBLESHOOTING.md`

## Database and security

Supabase is the system of record for application data. Browser-side publishable credentials do **not** grant permission to create arbitrary PostgreSQL tables.

For multi-user deployments, database policies must restrict tenant-owned records to the authenticated user. See `docs/DATABASE.md` for the expected security model and SQL workflow.

## Documentation

- **Database:** `docs/DATABASE.md`
- **Deployment:** `docs/DEPLOYMENT.md`
- **Operations / release checklist:** `docs/OPERATIONS.md`
- **Troubleshooting:** `docs/TROUBLESHOOTING.md`
- **Historical fixes:** `docs/archive/`

## Important note

This repository contains historical setup/fix notes in `docs/archive/` for traceability. They are retained as reference only; follow the current documentation in `docs/` for new deployments.

## License

This project is private and intended for authorized use only.
