const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

// Supabase direct database connection
// Format: postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres
const DATABASE_URL = process.env.DATABASE_URL;

async function runMigration() {
  if (!DATABASE_URL) {
    console.log('\n╔══════════════════════════════════════════════════╗');
    console.log('║  SUPABASE MIGRATION - Manual Instructions        ║');
    console.log('╚══════════════════════════════════════════════════╝\n');
    console.log('DATABASE_URL not set. Please run the migration manually:\n');
    console.log('1. Go to: https://supabase.com/dashboard/project/ulelicrbgicgnhmuulup/sql/new');
    console.log('2. Copy the contents of: supabase/migrations/20260819000000_initial_schema.sql');
    console.log('3. Paste into the SQL Editor');
    console.log('4. Click "Run"\n');
    console.log('Or set DATABASE_URL and re-run:');
    console.log('  DATABASE_URL="postgresql://postgres.PROJECT_REF:YOUR_DB_PASSWORD@aws-0-YOUR_REGION.pooler.supabase.com:6543/postgres" node scripts/run-migration.js\n');
    process.exit(0);
  }

  const sqlPath = path.join(__dirname, '..', 'supabase', 'migrations', '20260819000000_initial_schema.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  console.log('Connecting to Supabase database...');
  
  const client = new Client({ connectionString: DATABASE_URL });
  
  try {
    await client.connect();
    console.log('Connected! Running migration...');
    
    await client.query(sql);
    
    console.log('\n✅ Migration completed successfully!');
    console.log('Tables created: profiles, leagues, teams, team_aliases, fixtures,');
    console.log('  odds_snapshots, predictions, recommendations, user_bets,');
    console.log('  accumulators, rollover_chains, rollover_picks, model_performance,');
    console.log('  ai_cache, notifications, scoring_config, announcements, admin_activity_log');
    console.log('\nSeed data inserted: scoring_config, leagues');
    
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration();
