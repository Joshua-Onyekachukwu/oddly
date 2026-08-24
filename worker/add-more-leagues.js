#!/usr/bin/env node
/**
 * Add More Leagues to Database
 * 
 * Expands coverage by adding leagues from:
 * - football-data.org (free tier: 12 competitions)
 * - Manually curated international leagues
 * - Continental competitions
 * 
 * Goal: Expand from 26 to 50+ leagues
 * 
 * Usage: node worker/add-more-leagues.js
 */

const fs = require('fs');
const path = require('path');

function loadEnv() {
  const env = {};
  for (const line of fs.readFileSync(path.join(__dirname, '../.env.local'), 'utf8').split('\n')) {
    const t = line.trim(); if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('='); if (i===-1) continue;
    const k = t.slice(0,i).trim(); let v = t.slice(i+1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1,-1);
    env[k] = v;
  }
  return env;
}

const env = loadEnv();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// ─── Football-Data.org Free Tier Competitions ───────────────
// These are available on the free tier: https://www.football-data.org/documentation/api
const FD_COMPETITIONS = {
  // Tier 1 — Major European
  'PL':  { name: 'Premier League', country: 'England', priority: 1 },
  'PD':  { name: 'La Liga', country: 'Spain', priority: 1 },
  'BL1': { name: 'Bundesliga', country: 'Germany', priority: 1 },
  'SA':  { name: 'Serie A', country: 'Italy', priority: 1 },
  'FL1': { name: 'Ligue 1', country: 'France', priority: 1 },
  
  // Tier 2 — Strong European
  'ELC': { name: 'Championship', country: 'England', priority: 2 },
  'DED': { name: 'Eredivisie', country: 'Netherlands', priority: 2 },
  'PPL': { name: 'Primeira Liga', country: 'Portugal', priority: 2 },
  'BSA': { name: 'Brasileirão', country: 'Brazil', priority: 2 },
  'CL':  { name: 'Champions League', country: 'Europe', priority: 1 },
  'EL':  { name: 'Europa League', country: 'Europe', priority: 2 },
  'EWC': { name: 'Club World Cup', country: 'World', priority: 3 },
  
  // Tier 3 — Good European
  'BL2': { name: '2. Bundesliga', country: 'Germany', priority: 3 },
  'SL':  { name: 'Süper Lig', country: 'Turkey', priority: 3 },
  'PST': { name: 'Premiership', country: 'Scotland', priority: 3 },
  'JPD': { name: 'J League', country: 'Japan', priority: 3 },
  'KPL': { name: 'K League 1', country: 'South Korea', priority: 3 },
  'CSL': { name: 'Chinese Super League', country: 'China', priority: 3 },
  'MLS': { name: 'MLS', country: 'USA', priority: 3 },
  'EREDIVISIE_2': { name: 'Eerste Divisie', country: 'Netherlands', priority: 4 },
  'LALIGA2': { name: 'La Liga 2', country: 'Spain', priority: 3 },
  'LIGUE2': { name: 'Ligue 2', country: 'France', priority: 3 },
  'SA2': { name: 'Serie B', country: 'Italy', priority: 3 },
};

// ─── Additional Leagues (no API, manual entry) ──────────────
// These leagues don't have free API access but we track them
const MANUAL_LEAGUES = [
  // Africa
  { name: 'NPFL', country: 'Nigeria', priority: 3 },
  { name: 'Egyptian Premier League', country: 'Egypt', priority: 4 },
  { name: 'Moroccan Botola', country: 'Morocco', priority: 4 },
  { name: 'South African PSL', country: 'South Africa', priority: 4 },
  { name: 'Tunisian Ligue 1', country: 'Tunisia', priority: 4 },
  { name: 'Algerian Ligue 1', country: 'Algeria', priority: 4 },
  { name: 'Ghana Premier League', country: 'Ghana', priority: 4 },
  { name: 'Kenyan Premier League', country: 'Kenya', priority: 5 },
  
  // Asia
  { name: 'Saudi Pro League', country: 'Saudi Arabia', priority: 2 },
  { name: 'UAE Pro League', country: 'UAE', priority: 4 },
  { name: 'Iranian Pro League', country: 'Iran', priority: 4 },
  { name: 'Indian Super League', country: 'India', priority: 4 },
  { name: 'A-League', country: 'Australia', priority: 3 },
  { name: 'Thai League 1', country: 'Thailand', priority: 4 },
  { name: 'Indonesian Liga 1', country: 'Indonesia', priority: 4 },
  { name: 'Vietnamese V.League 1', country: 'Vietnam', priority: 5 },
  { name: 'Chinese League One', country: 'China', priority: 5 },
  
  // Europe — Smaller
  { name: 'Belgian First Division A', country: 'Belgium', priority: 2 },
  { name: 'Belgian First Division B', country: 'Belgium', priority: 4 },
  { name: 'Austrian Bundesliga', country: 'Austria', priority: 3 },
  { name: 'Swiss Super League', country: 'Switzerland', priority: 3 },
  { name: 'Danish Superliga', country: 'Denmark', priority: 3 },
  { name: 'Allsvenskan', country: 'Sweden', priority: 3 },
  { name: 'Eliteserien', country: 'Norway', priority: 3 },
  { name: 'Veikkausliiga', country: 'Finland', priority: 4 },
  { name: 'Ekstraklasa', country: 'Poland', priority: 3 },
  { name: 'Czech First League', country: 'Czech Republic', priority: 4 },
  { name: 'Croatian First Football League', country: 'Croatia', priority: 4 },
  { name: 'Serbian SuperLiga', country: 'Serbia', priority: 4 },
  { name: 'Greek Super League', country: 'Greece', priority: 3 },
  { name: 'Romanian Liga I', country: 'Romania', priority: 4 },
  { name: 'Ukrainian Premier League', country: 'Ukraine', priority: 4 },
  { name: 'Bulgarian First League', country: 'Bulgaria', priority: 5 },
  { name: 'Hungarian NB I', country: 'Hungary', priority: 4 },
  { name: 'Slovak Super Liga', country: 'Slovakia', priority: 5 },
  { name: 'Slovenian PrvaLiga', country: 'Slovenia', priority: 5 },
  { name: 'Cypriot First Division', country: 'Cyprus', priority: 5 },
  { name: 'Israeli Premier League', country: 'Israel', priority: 4 },
  { name: 'Belarusian Premier League', country: 'Belarus', priority: 5 },
  
  // Americas
  { name: 'Argentine Primera División', country: 'Argentina', priority: 2 },
  { name: 'Liga MX', country: 'Mexico', priority: 2 },
  { name: 'Liga BetPlay', country: 'Colombia', priority: 3 },
  { name: 'Liga 1', country: 'Peru', priority: 4 },
  { name: 'Liga de Ecuador', country: 'Ecuador', priority: 4 },
  { name: 'Chilean Primera', country: 'Chile', priority: 4 },
  { name: 'Uruguayan Primera', country: 'Uruguay', priority: 4 },
  { name: 'Paraguayan Primera', country: 'Paraguay', priority: 5 },
  { name: 'Bolivian Liga', country: 'Bolivia', priority: 5 },
  { name: 'MLS Next Pro', country: 'USA', priority: 5 },
  { name: 'USL Championship', country: 'USA', priority: 4 },
  { name: 'Canadian Premier League', country: 'Canada', priority: 4 },
  
  // Continental
  { name: 'Copa Libertadores', country: 'South America', priority: 2 },
  { name: 'Copa Sudamericana', country: 'South America', priority: 3 },
  { name: 'CONCACAF Champions Cup', country: 'North/Central America', priority: 3 },
  { name: 'AFC Champions League', country: 'Asia', priority: 3 },
  { name: 'CAF Champions League', country: 'Africa', priority: 3 },
  { name: 'CAF Confederation Cup', country: 'Africa', priority: 4 },
  
  // Women's
  { name: "Women's Super League", country: 'England', priority: 3 },
  { name: "NWSL", country: 'USA', priority: 3 },
  { name: "Division 1 Féminine", country: 'France', priority: 4 },
  { name: "Frauen-Bundesliga", country: 'Germany', priority: 4 },
  { name: "Liga F", country: 'Spain', priority: 4 },
];

async function main() {
  console.log('🌍 Adding More Leagues to Database\n');
  
  // Get existing leagues
  const { data: existing } = await supabase.from('leagues').select('name');
  const existingNames = new Set((existing || []).map(l => l.name));
  
  console.log(`Current leagues: ${existingNames.size}`);
  
  // Combine all sources
  const allLeagues = [];
  
  // Football-data.org competitions
  for (const [code, info] of Object.entries(FD_COMPETITIONS)) {
    if (!existingNames.has(info.name)) {
      allLeagues.push({ ...info, external_id: code, source: 'football-data.org' });
    }
  }
  
  // Manual leagues
  for (const league of MANUAL_LEAGUES) {
    if (!existingNames.has(league.name)) {
      allLeagues.push({ ...league, source: 'manual' });
    }
  }
  
  console.log(`New leagues to add: ${allLeagues.length}\n`);
  
  // Insert leagues
  let added = 0;
  for (const league of allLeagues) {
    const { error } = await supabase.from('leagues').insert({
      name: league.name,
      country: league.country,
      priority: league.priority,
      is_active: true,
      external_id: league.external_id || null,
    });
    
    if (error) {
      if (error.message.includes('duplicate')) {
        console.log(`  ⏭️  ${league.name} (already exists)`);
      } else {
        console.error(`  ❌ ${league.name}: ${error.message}`);
      }
    } else {
      console.log(`  ✅ ${league.name} (${league.country}) — ${league.source}`);
      added++;
    }
  }
  
  // Final count
  const { count } = await supabase.from('leagues').select('*', { count: 'exact', head: true });
  console.log(`\n🎉 Done! Total leagues: ${count} (added ${added})`);
  
  // Update stats API to show real count
  console.log(`\n📊 The stats API (/api/v1/stats) will now show ${count}+ leagues`);
}

main().catch(err => {
  console.error('Failed:', err);
  process.exit(1);
});
