# ODDLY Supabase Setup

## Overview

This directory contains the Supabase configuration and database migrations for the ODDLY Betting Intelligence Platform.

## Prerequisites

1. **Supabase CLI** - Install globally:
   ```bash
   npm install -g supabase
   ```

2. **Supabase Account** - Create at [supabase.com](https://supabase.com)

3. **Project Created** - Create a new project in Supabase dashboard

## Quick Start

### Option 1: Using Supabase CLI (Recommended)

1. **Login to Supabase:**
   ```bash
   supabase login
   ```

2. **Link your project:**
   ```bash
   supabase link --project-ref ulelicrbgicgnhmuulup
   ```

3. **Run migrations:**
   ```bash
   supabase db push
   ```

4. **Generate types (optional):**
   ```bash
   supabase gen types typescript --local > src/types/supabase.ts
   ```

### Option 2: Manual SQL Execution

1. **Go to Supabase Dashboard:**
   - Navigate to [app.supabase.com](https://app.supabase.com)
   - Select your project: `ulelicrbgicgnhmuulup`

2. **Open SQL Editor:**
   - Click on "SQL Editor" in the left sidebar
   - Create a new query

3. **Run the migration:**
   - Copy the contents of `migrations/20260819000000_initial_schema.sql`
   - Paste into the SQL Editor
   - Click "Run" to execute

4. **Verify tables created:**
   - Go to "Table Editor" in the left sidebar
   - You should see all 15 tables created

## Database Tables

### Core Tables
- `profiles` - User profiles with role-based access
- `leagues` - Football leagues and competitions
- `teams` - Football teams with canonical names
- `team_aliases` - Alternative team names for normalization
- `fixtures` - Football matches and fixtures

### Data Tables
- `odds_snapshots` - Historical odds data
- `predictions` - AI-generated predictions
- `recommendations` - Value bet recommendations

### User Tables
- `user_bets` - User-tracked external bets
- `accumulators` - User-built accumulator slips
- `rollover_chains` - Rollover challenge chains
- `rollover_picks` - Daily picks for rollover chains

### System Tables
- `model_performance` - Model accuracy metrics
- `ai_cache` - Cached AI responses
- `notifications` - User notifications
- `scoring_config` - Configurable scoring weights
- `announcements` - Admin announcements
- `admin_activity_log` - Admin action audit trail

## Row Level Security (RLS)

All tables have RLS enabled with the following policies:

- **User-specific tables** (user_bets, accumulators, etc.): Users can only see their own data
- **Public tables** (fixtures, predictions, etc.): Anyone can read, admins can write
- **Admin tables** (admin_activity_log): Only admins can access

## Environment Variables

Add these to your `.env.local`:

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://ulelicrbgicgnhmuulup.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
```

## Seeding Data

The migration includes seed data for:
- Default scoring configuration (weights, thresholds, tiers)
- Sample leagues (Premier League, La Liga, etc.)

To add more seed data, create a new migration file.

## Creating New Migrations

1. **Generate a new migration:**
   ```bash
   supabase migration new <migration_name>
   ```

2. **Edit the migration file:**
   - Located in `migrations/<timestamp>_<name>.sql`
   - Add your SQL changes

3. **Test locally:**
   ```bash
   supabase start
   supabase db reset
   ```

4. **Push to production:**
   ```bash
   supabase db push
   ```

## Troubleshooting

### Migration fails
- Check SQL syntax in the migration file
- Ensure all referenced tables exist
- Verify UUID extension is enabled

### RLS policies not working
- Verify RLS is enabled on the table
- Check policy conditions match your auth setup
- Test with `supabase local` first

### Types not generating
- Ensure Supabase CLI is up to date
- Run `supabase gen types typescript --local` with local instance running

## Useful Commands

```bash
# Start local Supabase
supabase start

# Reset local database
supabase db reset

# Generate types
supabase gen types typescript --local > src/types/supabase.ts

# Check migration status
supabase migration list

# Link to remote project
supabase link --project-ref ulelicrbgicgnhmuulup

# Push migrations to production
supabase db push
```

## Resources

- [Supabase Documentation](https://supabase.com/docs)
- [Supabase CLI Reference](https://supabase.com/docs/reference/cli)
- [Row Level Security Guide](https://supabase.com/docs/guides/auth/row-level-security)
- [TypeScript Generation](https://supabase.com/docs/reference/cli/gen-types)

---

*Last Updated: August 2026*
