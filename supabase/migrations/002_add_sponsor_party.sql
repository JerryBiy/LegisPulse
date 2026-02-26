-- Migration: add sponsor_party column to bills
-- Run in the Supabase SQL Editor if you already applied 001_initial_schema.sql.

alter table public.bills
  add column if not exists sponsor_party text;
