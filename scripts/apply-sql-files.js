// Applies specific loose SQL files from supabase/ (not migrations/) in the
// order given on the command line. Same env loading as apply-migrations.js.
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const root = path.join(__dirname, '..');
for (const line of fs.readFileSync(path.join(root, '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const password = process.env.SUPABASE_DB_PASSWORD || '';
const host = process.env.SUPABASE_POOLER_HOST || 'aws-0-eu-west-1.pooler.supabase.com';
const user = `${process.env.SUPABASE_DB_USER || 'postgres'}.${process.env.SUPABASE_PROJECT_REF || 'xruhvekcowdwocydqnmp'}`;

const files = process.argv.slice(2);
if (!files.length) { console.error('usage: node scripts/apply-sql-files.js file1.sql file2.sql ...'); process.exit(1); }

(async () => {
  const client = new Client({ host, port: 5432, user, password, database: 'postgres', ssl: { rejectUnauthorized: false } });
  await client.connect();
  for (const f of files) {
    const fp = path.join(root, 'supabase', f);
    try {
      await client.query(fs.readFileSync(fp, 'utf8'));
      console.log(`OK   ${f}`);
    } catch (err) {
      console.log(`FAIL ${f}: ${err.message}`);
    }
  }
  await client.end();
})();
