// Quick DB inspection helper: node scripts/dbq.js "SQL" [paramsJson]
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const root = path.join(__dirname, '..');
for (const line of fs.readFileSync(path.join(root, '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
(async () => {
  const c = new Client({
    host: process.env.SUPABASE_POOLER_HOST || 'aws-0-eu-west-1.pooler.supabase.com',
    port: 5432,
    user: `postgres.${process.env.SUPABASE_PROJECT_REF || 'xruhvekcowdwocydqnmp'}`,
    password: process.env.SUPABASE_DB_PASSWORD,
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
  });
  await c.connect();
  const sql = process.argv[2];
  const params = process.argv[3] ? JSON.parse(process.argv[3]) : [];
  try {
    const r = await c.query(sql, params);
    console.log(JSON.stringify(r.rows, null, 1));
  } catch (e) {
    console.error('ERR:', e.message);
    if (e.position) console.error('pos:', e.position);
  }
  await c.end();
})();
