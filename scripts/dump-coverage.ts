import * as fs from "fs";
import * as path from "path";
import { createClient } from "@supabase/supabase-js";
import { normalizeTeamName } from "../src/lib/football/team-normalizer";
function loadEnv(){const e:Record<string,string>={};for(const l of fs.readFileSync(path.join(__dirname,"..",".env.local"),"utf8").split("\n")){const t=l.trim();if(!t||t.startsWith("#"))continue;const i=t.indexOf("=");if(i<0)continue;let v=t.slice(i+1).trim();if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);e[t.slice(0,i).trim()]=v;}return e;}
async function main(){
  const env=loadEnv();const s=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY);
  const {data:tr}=await s.from("teams").select("canonical_name").limit(1000);
  const our=new Map<string,string>();for(const t of tr||[]){const k=normalizeTeamName(t.canonical_name||"");if(k)our.set(k,t.canonical_name||"");}
  const app=new Map<string,string>();
  for(let f=0;;f+=1000){const {data}=await s.from("player_appearances").select("team_name,team_name_normalized").eq("source","statsbomb-open-data").range(f,f+999);if(!data||!data.length)break;for(const r of data)if(r.team_name_normalized&&!app.has(r.team_name_normalized))app.set(r.team_name_normalized,r.team_name||"");if(data.length<1000)break;}
  const missing=[...our.entries()].filter(([k])=>!app.has(k));
  fs.writeFileSync("data/statsbomb-open/missing-teams.txt",missing.map(([k,n])=>`${k}\t${n}`).join("\n"));
  fs.writeFileSync("data/statsbomb-open/app-teams.txt",[...app.entries()].map(([k,n])=>`${k}\t${n}`).join("\n"));
  console.log("missing",missing.length,"appKeys",app.size);
}
main().catch(e=>{console.error(e);process.exit(1)});
