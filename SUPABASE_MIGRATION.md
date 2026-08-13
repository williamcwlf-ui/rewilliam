# Supabase migration

- Fastify has been removed from the application runtime.
- REST and tRPC are served by `supabase/functions/api`.
- The Mongo compatibility layer now maps each legacy collection to its own `readmin_*` Postgres table.
- 93 collection tables are created with JSONB payloads, primary `id`, timestamps, GIN indexes and RLS.
- `mongo_documents` is no longer used and is removed by migration.
- `scripts/migrate-mongo-to-supabase.ts` imports legacy Mongo data into the matching `readmin_*` tables.

API base URL:
`https://comcofuyhdisjxespbom.supabase.co/functions/v1/api`

Set `NEXT_PUBLIC_API_URL` in Vercel to that value after the Edge Function is deployed.

Required Edge secrets:
- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`

Feature-specific secrets continue to use the same names as the Vercel environment. The one-time Mongo importer additionally needs `MONGODB_URI` and `MONGODB_DATABASE`.
