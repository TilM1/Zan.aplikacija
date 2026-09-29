-- =============================================================================
-- Remove ALL demo data (customers.is_demo / profiles.is_demo) before go-live.
-- Safe: aborts if any demo user is linked to real (non-demo) data.
-- Run in Supabase SQL editor or: npm run demo:cleanup
-- =============================================================================
select public.crm_purge_demo_data();
