# Deployment Guide

## Supported deployment model

Mie-kelar can be deployed as a Next.js application on Vercel or another compatible hosting platform, with Supabase providing authentication, PostgreSQL, and Storage services.

## Environment variables

Configure these variables in the hosting provider:

```env
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
```

Use values from the **same Supabase project**. Mixing a URL from one project with a key from another is a common source of connection and data-loading failures.

For local development, keep secrets and local configuration in `.env.local`. Do not commit real credentials to Git.

## Vercel procedure

1. Import the Git repository into Vercel.
2. Open **Project Settings → Environment Variables**.
3. Add the required Supabase variables.
4. Enable the variables for the environments you use: Production, Preview, and Development.
5. Deploy the project.
6. Open the newly created deployment URL.
7. Sign in with a test account.
8. Run the verification checklist in `docs/OPERATIONS.md`.

## Local release validation

Run:

```bash
npm install
npm run typecheck
npm run build
```

If `typecheck` or `build` fails, fix the underlying error before treating the deployment as ready.

## Post-deployment smoke test

At minimum verify:

1. Login/logout
2. Product listing
3. Product create/edit/delete
4. Category management
5. Customer management
6. Inventory adjustment
7. POS search and cart
8. Checkout and payment method
9. Transaction history
10. Receipt workflow
11. Analytics
12. Mobile/tablet layout
13. Cross-user data isolation

## Rollback

If a deployment introduces a regression:

1. Keep the failing deployment available for investigation.
2. Reassign the production deployment to the last known-good build using the hosting provider's deployment controls.
3. Record the cause and corrective change.
4. Re-test in Preview before promoting the fix.
