# Database & Supabase Guide

## Purpose

Mie-kelar uses Supabase PostgreSQL as its persistent data layer. The application should not use browser `localStorage` as the primary source of business data.

## Recommended setup flow

1. Create or select the Supabase project that will own the application data.
2. Open **SQL Editor** in that project.
3. Review the SQL files under `supabase/` and use the current schema/setup appropriate to the project version.
4. Configure Authentication and Storage as required by the application.
5. Configure the application environment variables with credentials from the same Supabase project.
6. Sign in with a test account and verify that the application can create, read, update, and delete test records.

### SQL files

| File | Role |
|---|---|
| `supabase/schema.sql` | Main schema entry point maintained with the project |
| `supabase/MIEFLOW-SUPABASE-SETUP-FINAL.sql` | Historical/final setup script retained for reference |
| `supabase/MIEFLOW-MULTI-USER-FIX.sql` | Historical multi-user migration/fix |
| `supabase/APPLY-FINAL-FIX.sql` | Historical final-fix migration |
| `supabase/REPAIR-EXISTING.sql` | Repair/migration utility |
| `supabase/schema-v5-original.sql` | Original schema reference |

**Do not blindly run every SQL file in sequence on an existing production database.** Some files are migrations or historical repair scripts and may overlap. Review the intended schema and migration path first.

## Multi-user security model

The expected model is tenant isolation by authenticated Supabase user:

```text
Authenticated user
        │
        └── auth.uid()
              │
              └── owner_id on tenant-owned records
```

For tenant-owned tables, Row Level Security (RLS) should prevent one account from reading or modifying another account's records.

Typical policy logic is conceptually:

```sql
owner_id = auth.uid()
```

The exact policy must match the current schema and application requirements.

## Core data domains

The application contains business domains for products, categories, customers, orders/order items, inventory, and related operational records. The authoritative column names must always be taken from the current SQL schema and the current application code together.

## Storage

Product images are stored through Supabase Storage. New uploads should remain scoped to the authenticated user's namespace where the application expects per-user storage isolation.

## Verification checklist

After database setup:

- [ ] Authentication can create/sign in a test user.
- [ ] Product create/read/update/delete works.
- [ ] Category create/read/update/delete works.
- [ ] Customer create/read/update/delete works.
- [ ] Inventory adjustments persist correctly.
- [ ] Checkout creates the expected order records.
- [ ] Order items are associated with the correct order/product.
- [ ] Transaction history shows the correct user's records.
- [ ] Analytics uses the intended user's data.
- [ ] RLS blocks cross-user access.
- [ ] Product image upload works with the configured Storage bucket/policies.

## Production safety

Always test migrations against a backup or staging database before applying them to a production project. Do not disable RLS merely to make the frontend work.
