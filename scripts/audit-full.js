// load env manually
const env={};require('fs').readFileSync('.env.local','utf8').split('\n').forEach(l=>{const t=l.trim();if(!t||t.startsWith('#'))return;const i=t.indexOf('=');if(i===-1)return;env[t.slice(0,i).trim()]=t.slice(i+1).trim().replace(/^"|"$/g,'')});process.env={...process.env,...env};
const {createClient}=require('@supabase/supabase-js');
const fs=require('fs');
const path=require('path');
const s=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);

(async()=>{
  const {count:total}=await s.from('predictions').select('id',{count:'exact',head:true});
  const {count:settled}=await s.from('predictions').select('id',{count:'exact',head:true}).not('result','is',null);
  const {count:correct}=await s.from('predictions').select('id',{count:'exact',head:true}).eq('result','correct');
  const {count:wrong}=await s.from('predictions').select('id',{count:'exact',head:true}).eq('result','wrong');
  const {count:pending}=await s.from('predictions').select('id',{count:'exact',head:true}).is('result',null);
  const {count:fixtures}=await s.from('fixtures').select('id',{count:'exact',head:true});
  const {count:finished}=await s.from('fixtures').select('id',{count:'exact',head:true}).eq('status','finished');
  const {count:leagues}=await s.from('leagues').select('id',{count:'exact',head:true});
  const {count:teams}=await s.from('teams').select('id',{count:'exact',head:true});
  let oddsCount=0;try{const r=await s.from('odds_snapshots').select('id',{count:'exact',head:true});oddsCount=r.count||0;}catch(e){}

  // Sample model versions
  const {data:versions}=await s.from('predictions').select('model_version').not('result','is',null).limit(2000);
  const vCounts={};
  (versions||[]).forEach(v=>{vCounts[v.model_version]=(vCounts[v.model_version]||0)+1});

  // Sample markets
  const {data:markets}=await s.from('predictions').select('market,selection,model_probability,result').not('result','is',null).limit(5000);
  const mCounts={};
  (markets||[]).forEach(m=>{mCounts[m.market]=(mCounts[m.market]||0)+1});

  // 1X2 accuracy
  const {data:x12}=await s.from('predictions').select('selection,result,model_probability').eq('market','1X2').not('result','is',null).limit(5000);
  let x12Total=0,x12Correct=0,x12Home=0,x12HomeCorrect=0,x12Draw=0,x12DrawCorrect=0,x12Away=0,x12AwayCorrect=0;
  (x12||[]).forEach(p=>{
    x12Total++;
    if(p.result==='correct')x12Correct++;
    if(p.selection==='Home'){x12Home++;if(p.result==='correct')x12HomeCorrect++;}
    if(p.selection==='Draw'){x12Draw++;if(p.result==='correct')x12DrawCorrect++;}
    if(p.selection==='Away'){x12Away++;if(p.result==='correct')x12AwayCorrect++;}
  });

  // ELITE accuracy
  const {data:elite}=await s.from('predictions').select('result,model_probability').not('result','is',null).gte('model_probability',0.70).limit(5000);
  let eliteTotal=0,eliteCorrect=0;
  (elite||[]).forEach(p=>{eliteTotal++;if(p.result==='correct')eliteCorrect++;});

  // xG data
  let xgTeams=0,understatTeams=0;
  try{const d=JSON.parse(fs.readFileSync(path.join(__dirname,'data/statsbomb-xg.json'),'utf8'));xgTeams=Object.keys(d.features||{}).length;}catch{}
  try{const d=JSON.parse(fs.readFileSync(path.join(__dirname,'data/understat-xg.json'),'utf8'));understatTeams=Object.keys(d.teams||{}).length;}catch{}

  // Injuries
  let injuryTeams=0;
  try{const d=JSON.parse(fs.readFileSync(path.join(__dirname,'data/premier-injuries.json'),'utf8'));injuryTeams=new Set((d.injuries||[]).map(i=>i.team_name)).size;}catch{}

  // Referees
  let refProfiles=0,refMatches=0;
  try{const d=JSON.parse(fs.readFileSync(path.join(__dirname,'data/referee-profiles.json'),'utf8'));refProfiles=Object.keys(d.profiles||{}).length;}catch{}
  try{const d=JSON.parse(fs.readFileSync(path.join(__dirname,'data/referee-matches.json'),'utf8'));refMatches=(d.matches||[]).length;}catch{}

  // Odds features
  let oddsFixtures=0;
  try{const d=JSON.parse(fs.readFileSync(path.join(__dirname,'data/odds-features.json'),'utf8'));oddsFixtures=Object.keys(d.features||{}).length;}catch{}

  // XGBoost models
  const modelFiles=fs.readdirSync(path.join(__dirname,'..','models')).filter(f=>f.endsWith('.json'));

  console.log('\n=== AUDIT: Current Prediction System ===\n');
  console.log('Dataset:');
  console.log(`  Total fixtures:      ${(fixtures||0).toLocaleString()}`);
  console.log(`  Finished fixtures:   ${(finished||0).toLocaleString()}`);
  console.log(`  Leagues:             ${(leagues||0).toLocaleString()}`);
  console.log(`  Teams:               ${(teams||0).toLocaleString()}`);
  console.log(`  Odds snapshots:      ${oddsCount.toLocaleString()}`);
  console.log('');
  console.log('Predictions:');
  console.log(`  Total:               ${(total||0).toLocaleString()}`);
  console.log(`  Settled:             ${(settled||0).toLocaleString()}`);
  console.log(`  Correct:             ${(correct||0).toLocaleString()}`);
  console.log(`  Wrong:               ${(wrong||0).toLocaleString()}`);
  console.log(`  Pending:             ${(pending||0).toLocaleString()}`);
  console.log(`  Overall accuracy:    ${settled>0?((correct/settled)*100).toFixed(1):'N/A'}%`);
  console.log('');
  console.log('Model versions (sample):', JSON.stringify(vCounts,null,2));
  console.log('');
  console.log('Markets (sample):', JSON.stringify(mCounts,null,2));
  console.log('');
  console.log('1X2 Performance (sample 5K):');
  console.log(`  Total:    ${x12Total}`);
  console.log(`  Correct:  ${x12Correct} (${x12Total>0?((x12Correct/x12Total)*100).toFixed(1):0}%)`);
  console.log(`  Home:     ${x12Home} correct: ${x12HomeCorrect} (${x12Home>0?((x12HomeCorrect/x12Home)*100).toFixed(1):0}%)`);
  console.log(`  Draw:     ${x12Draw} correct: ${x12DrawCorrect} (${x12Draw>0?((x12DrawCorrect/x12Draw)*100).toFixed(1):0}%)`);
  console.log(`  Away:     ${x12Away} correct: ${x12AwayCorrect} (${x12Away>0?((x12AwayCorrect/x12Away)*100).toFixed(1):0}%)`);
  console.log('');
  console.log('ELITE Performance (prob>=0.70, sample 5K):');
  console.log(`  Total:    ${eliteTotal}`);
  console.log(`  Correct:  ${eliteCorrect} (${eliteTotal>0?((eliteCorrect/eliteTotal)*100).toFixed(1):0}%)`);
  console.log('');
  console.log('Data Sources:');
  console.log(`  StatsBomb xG teams:  ${xgTeams}`);
  console.log(`  Understat xG teams:  ${understatTeams}`);
  console.log(`  Injury teams:        ${injuryTeams}`);
  console.log(`  Referee profiles:    ${refProfiles}`);
  console.log(`  Referee matches:     ${refMatches.toLocaleString()}`);
  console.log(`  Odds features:       ${oddsFixtures}`);
  console.log('');
  console.log('XGBoost models:', modelFiles.length, 'files');
  modelFiles.forEach(f=>console.log(`  ${f}`));
  console.log('');
})();
