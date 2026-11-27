const fs=require('fs');const path=require('path');const {Client}=require('pg');const ts=require('typescript');const Module=require('module');
const ROOT=path.join(__dirname,'..');
for(const line of fs.readFileSync(path.join(ROOT,'.env.local'),'utf8').split(/\r?\n/)){const m=line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2].replace(/^["']|["']$/g,'');}
const src=fs.readFileSync(path.join(ROOT,'src/lib/football/team-normalizer.ts'),'utf8');
const js=ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
const m=new Module();m.paths=module.paths;m._compile(js,path.join(ROOT,'src/lib/football/team-normalizer.js'));
const norm=m.exports.normalizeTeamName;
(async()=>{
const c=new Client({host:process.env.SUPABASE_POOLER_HOST||'aws-0-eu-west-1.pooler.supabase.com',port:5432,user:'postgres.'+(process.env.SUPABASE_PROJECT_REF||'xruhvekcowdwocydqnmp'),password:process.env.SUPABASE_DB_PASSWORD,database:'postgres',ssl:{rejectUnauthorized:false}});
await c.connect();
const {rows:fx}=await c.query("select distinct t.canonical_name from fixtures f join teams t on t.id in (f.home_team_id,f.away_team_id) where f.status='scheduled'");
const {rows:xg}=await c.query('select distinct team_name_normalized from xg_features where match_date is not null');
const xgset=new Set(xg.map(r=>r.team_name_normalized));
let have=0;const miss=[];
for(const f of fx){const k=norm(f.canonical_name);if(xgset.has(k))have++;else miss.push(f.canonical_name);}
console.log('scheduled-fixture teams:',fx.length,'| with xG history:',have,'('+(100*have/fx.length).toFixed(1)+'%) | missing:',miss.length);
// also: of the 159 fixtures, how many have BOTH teams covered
const {rows:fx2}=await c.query("select f.id, ht.canonical_name h, at.canonical_name a from fixtures f join teams ht on ht.id=f.home_team_id join teams at on at.id=f.away_team_id where f.status='scheduled'");
let both=0,one=0,none=0;
for(const f of fx2){const h=xgset.has(norm(f.h)),a=xgset.has(norm(f.a));if(h&&a)both++;else if(h||a)one++;else none++;}
console.log('fixtures(159): both teams xG:',both,'| one team:',one,'| neither:',none);
await c.end();})().catch(e=>{console.error(e);process.exit(1)});
