// Deduplicate leagues (and teams) by name, keeping the row with the most
// references. Reassigns fixtures.league_id and teams.league_id first.
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
  await c.query('begin');
  try {
    // Canonical league per name: most fixture refs, then most team refs, then oldest
    const { rows: dups } = await c.query(`
      with ranked as (
        select l.id, l.name, l.created_at,
          (select count(*) from fixtures f where f.league_id = l.id) fc,
          (select count(*) from teams t where t.league_id = l.id) tc,
          row_number() over (partition by l.name order by
            (select count(*) from fixtures f where f.league_id = l.id) desc,
            (select count(*) from teams t where t.league_id = l.id) desc,
            l.created_at asc) rn
        from leagues l
      )
      select id, name from ranked where rn > 1`);
    console.log(`dup league rows to remove: ${dups.length}`);
    for (const d of dups) {
      const { rows: [canon] } = await c.query(`
        with ranked as (
          select l.id,
            row_number() over (order by
              (select count(*) from fixtures f where f.league_id = l.id) desc,
              (select count(*) from teams t where t.league_id = l.id) desc,
              l.created_at asc) rn
          from leagues l where l.name = $1
        ) select id from ranked where rn = 1`, [d.name]);
      if (!canon) continue;
      await c.query('update fixtures set league_id=$1 where league_id=$2', [canon.id, d.id]);
      await c.query('update teams set league_id=$1 where league_id=$2', [canon.id, d.id]);
      await c.query('delete from leagues where id=$1', [d.id]);
    }
    // Teams dedupe by canonical_name (keep most fixture refs, then oldest)
    const { rows: tdups } = await c.query(`
      with ranked as (
        select t.id, t.canonical_name,
          (select count(*) from fixtures f where f.home_team_id=t.id or f.away_team_id=t.id) fc,
          row_number() over (partition by lower(t.canonical_name) order by
            (select count(*) from fixtures f where f.home_team_id=t.id or f.away_team_id=t.id) desc,
            t.created_at asc) rn
        from teams t
      )
      select id, canonical_name from ranked where rn > 1`);
    console.log(`dup team rows to remove: ${tdups.length}`);
    for (const d of tdups) {
      const { rows: [canon] } = await c.query(`
        with ranked as (
          select t.id,
            row_number() over (order by
              (select count(*) from fixtures f where f.home_team_id=t.id or f.away_team_id=t.id) desc,
              t.created_at asc) rn
          from teams t where lower(t.canonical_name) = lower($1)
        ) select id from ranked where rn = 1`, [d.canonical_name]);
      if (!canon) continue;
      await c.query('update fixtures set home_team_id=$1 where home_team_id=$2', [canon.id, d.id]);
      await c.query('update fixtures set away_team_id=$1 where away_team_id=$2', [canon.id, d.id]);
      await c.query('delete from team_aliases where canonical_name=$1', [d.canonical_name]);
      await c.query('delete from teams where id=$1', [d.id]);
    }
    await c.query('commit');
    const l = await c.query('select count(*) c, count(distinct name) d from leagues');
    const t = await c.query('select count(*) c, count(distinct lower(canonical_name)) d from teams');
    console.log('leagues:', l.rows[0], 'teams:', t.rows[0]);
  } catch (e) {
    await c.query('rollback');
    console.error('ROLLED BACK:', e.message);
  }
  await c.end();
})();
