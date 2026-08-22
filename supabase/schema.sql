-- ═══════════════════════════════════════════════════════
-- PartnerIQ — Supabase PostgreSQL Schema
-- Run this script in the Supabase SQL Editor
-- ═══════════════════════════════════════════════════════

-- 1. Table for Company Profiles (Multi-versioning)
CREATE TABLE IF NOT EXISTS public.company_profiles (
  id TEXT NOT NULL,
  version INT NOT NULL,
  official_name TEXT NOT NULL,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  PRIMARY KEY (id, version)
);

-- Index for querying latest version quickly
CREATE INDEX IF NOT EXISTS idx_company_profiles_lookup 
ON public.company_profiles (id, version DESC);

-- Index for ordering by last updated
CREATE INDEX IF NOT EXISTS idx_company_profiles_updated 
ON public.company_profiles (updated_at DESC);

-- 2. Table for Profile Diffs
CREATE TABLE IF NOT EXISTS public.company_diffs (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  from_version INT NOT NULL,
  to_version INT NOT NULL,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Index for fetching diffs by company
CREATE INDEX IF NOT EXISTS idx_company_diffs_company 
ON public.company_diffs (company_id, created_at DESC);

-- 3. Enable Row Level Security (RLS) - Optional for Public/Service Access
ALTER TABLE public.company_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_diffs ENABLE ROW LEVEL SECURITY;

-- Allow all operations for anon/service role (Public access for the app)
CREATE POLICY "Allow anon read/write company_profiles"
ON public.company_profiles FOR ALL
TO anon, authenticated, service_role
USING (true)
WITH CHECK (true);

CREATE POLICY "Allow anon read/write company_diffs"
ON public.company_diffs FOR ALL
TO anon, authenticated, service_role
USING (true)
WITH CHECK (true);
