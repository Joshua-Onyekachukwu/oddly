#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const injuries = [];
const teams = {
  "AFC Bournemouth": [
    { p: "Julian Araujo", r: "Thigh Injury", s: "injured", d: "21/11/2026" },
    { p: "Eli Kroupi", r: "Ankle/Foot Injury", s: "injured", d: "07/11/2026" },
    { p: "Amine Adli", r: "Calf/Shin/Heel Injury", s: "injured", d: "20/09/2026" },
    { p: "Ryan Christie", r: "Suspended", s: "suspended", d: "29/08/2026" },
    { p: "Julio Soler", r: "Other", s: "doubtful_25", d: "29/08/2026" },
    { p: "David Brooks", r: "Other", s: "doubtful_25", d: "23/08/2026" },
    { p: "Alvaro Rodriguez", r: "Other", s: "likely_75", d: "23/08/2026" },
    { p: "Juanlu Sanchez", r: "Other", s: "doubtful_50", d: "23/08/2026" },
    { p: "Veljko Milosavljevic", r: "Knee Injury", s: "injured", d: "No Return Date" },
  ],
  "Arsenal": [
    { p: "Jurrien Timber", r: "Groin/Hip/Pelvic Injury", s: "injured", d: "12/09/2026" },
    { p: "Bruno Guimaraes", r: "Groin/Hip/Pelvic Injury", s: "doubtful_25", d: "31/08/2026" },
    { p: "William Saliba", r: "Lower Back Injury", s: "injured", d: "No Return Date" },
  ],
  "Aston Villa": [
    { p: "Amadou Onana", r: "Knee Injury (ACL)", s: "injured", d: "01/06/2027" },
    { p: "Brian Madjo", r: "Ankle/Foot Injury", s: "injured", d: "19/09/2026" },
    { p: "Johan Manzambi", r: "Knee Injury", s: "injured", d: "05/09/2026" },
    { p: "Leon Bailey", r: "Muscular Injury", s: "injured", d: "No Return Date" },
    { p: "Tammy Abraham", r: "Groin/Hip/Pelvic Injury", s: "doubtful_50", d: "No Return Date" },
    { p: "Joao Gomes", r: "Suspended", s: "suspended", d: "No Return Date" },
  ],
  "Brentford": [
    { p: "Antoni Milambo", r: "Knee Injury (ACL)", s: "injured", d: "10/10/2026" },
    { p: "Sepp van den Berg", r: "Groin/Hip/Pelvic Injury", s: "injured", d: "10/10/2026" },
  ],
  "Brighton": [
    { p: "Yankuba Minteh", r: "Calf/Shin/Heel Injury", s: "injured", d: "24/10/2026" },
    { p: "Stefanos Tzimas", r: "Knee Injury", s: "injured", d: "12/09/2026" },
    { p: "Matthew ORiley", r: "Illness", s: "doubtful_25", d: "23/08/2026" },
    { p: "Ferdi Kadioglu", r: "Knock", s: "doubtful_50", d: "No Return Date" },
    { p: "Kaoru Mitoma", r: "Thigh Injury", s: "doubtful_50", d: "No Return Date" },
    { p: "Evan Ferguson", r: "Ankle/Foot Injury", s: "injured", d: "No Return Date" },
    { p: "Carlos Baleba", r: "Ankle Ligament Injury", s: "injured", d: "No Return Date" },
  ],
  "Chelsea": [
    { p: "Wesley Fofana", r: "Suspended", s: "suspended", d: "06/09/2026" },
    { p: "Jordan Henderson", r: "Wrist/Hand Injury", s: "injured", d: "06/09/2026" },
    { p: "Emmanuel Emegha", r: "Hamstring Strain", s: "injured", d: "30/08/2026" },
    { p: "Aaron Anselmino", r: "Knock", s: "doubtful_50", d: "24/08/2026" },
    { p: "Danny Welbeck", r: "Minor Issue", s: "likely_75", d: "24/08/2026" },
  ],
  "Crystal Palace": [
    { p: "Ismaila Sarr", r: "Groin Pain", s: "doubtful_50", d: "28/08/2026" },
    { p: "Chadi Riad", r: "Knee Injury", s: "injured", d: "No Return Date" },
  ],
  "Everton": [
    { p: "Timothy Iroegbunam", r: "Groin/Hip/Pelvic Injury", s: "injured", d: "11/10/2026" },
    { p: "Christian Norgaard", r: "Not Fit", s: "doubtful_25", d: "29/08/2026" },
  ],
  "Fulham": [
    { p: "Tom Cairney", r: "Knee Surgery", s: "injured", d: "17/10/2026" },
    { p: "Joachim Andersen", r: "Suspended (Red Card)", s: "suspended", d: "30/08/2026" },
  ],
  "Liverpool": [
    { p: "Conor Bradley", r: "Knee Injury", s: "injured", d: "01/01/2027" },
    { p: "Hugo Ekitike", r: "Calf/Shin/Heel Injury", s: "injured", d: "12/10/2026" },
    { p: "Joe Gomez", r: "Muscle Injury", s: "injured", d: "04/09/2026" },
    { p: "Jayden Danns", r: "Thigh Injury", s: "injured", d: "No Return Date" },
    { p: "Curtis Jones", r: "Groin/Hip/Pelvic Injury", s: "doubtful_50", d: "No Return Date" },
    { p: "Giovanni Leoni", r: "ACL Tear", s: "injured", d: "No Return Date" },
  ],
  "Manchester City": [
    { p: "Jeremy Doku", r: "Calf/Shin/Heel Injury", s: "injured", d: "05/09/2026" },
  ],
  "Manchester United": [
    { p: "Matthijs de Ligt", r: "Lower Back Injury", s: "injured", d: "06/09/2026" },
    { p: "Mason Mount", r: "Ankle/Foot Injury", s: "doubtful_50", d: "30/08/2026" },
    { p: "Manuel Ugarte", r: "Knee Surgery", s: "injured", d: "No Return Date" },
    { p: "Thomas Heaton", r: "Knock", s: "doubtful_25", d: "No Return Date" },
    { p: "Amad Diallo", r: "Training Niggle", s: "injured", d: "No Return Date" },
  ],
  "Newcastle United": [
    { p: "Joelinton", r: "Groin/Hip/Pelvic Injury", s: "injured", d: "14/09/2026" },
    { p: "Valentino Livramento", r: "Calf/Shin/Heel Injury", s: "doubtful_25", d: "29/08/2026" },
    { p: "Dan Burn", r: "Ankle Ligament Injury", s: "injured", d: "No Return Date" },
    { p: "William Osula", r: "Ankle Injury", s: "doubtful_25", d: "No Return Date" },
  ],
  "Nottingham Forest": [
    { p: "Nicolo Savona", r: "Knee Injury", s: "injured", d: "11/10/2026" },
    { p: "Ryan Yates", r: "Not Available", s: "injured", d: "05/09/2026" },
  ],
  "Sunderland": [
    { p: "Simon Adingra", r: "Ankle/Foot Injury", s: "injured", d: "12/09/2026" },
  ],
  "Tottenham Hotspur": [
    { p: "Xavi Simons", r: "ACL Rupture", s: "injured", d: "20/02/2027" },
    { p: "Wilson Odobert", r: "ACL Rupture", s: "injured", d: "28/11/2026" },
    { p: "Mohammed Kudus", r: "Thigh Injury", s: "injured", d: "05/09/2026" },
    { p: "Micky van de Ven", r: "Knock", s: "doubtful_25", d: "29/08/2026" },
    { p: "Pedro Porro", r: "Not Available", s: "doubtful_25", d: "29/08/2026" },
    { p: "Pape Matar Sarr", r: "Thigh Injury", s: "doubtful_25", d: "29/08/2026" },
    { p: "Dejan Kulusevski", r: "Knee Injury", s: "injured", d: "No Return Date" },
  ],
};

const flatInjuries = [];
const teamImpact = {};

for (const [team, players] of Object.entries(teams)) {
  let impactScore = 0;
  const impactPlayers = [];
  for (const pl of players) {
    const impact = pl.s === "injured" ? 5 : pl.s === "suspended" ? 4 : pl.s.startsWith("doubtful") ? 2 : 1;
    impactScore += impact;
    impactPlayers.push({ name: pl.p, status: pl.s, injury: pl.r, impact });
    flatInjuries.push({
      player_name: pl.p, team_name: team, injury_type: pl.r,
      status: pl.s.split("_")[0], expected_return: pl.d,
      source: "premierinjuries.com", fetched_at: new Date().toISOString(),
    });
  }
  teamImpact[team] = {
    team_name: team, total_injured: players.length,
    ruled_out: players.filter(p => p.s === "injured").length,
    total_suspended: players.filter(p => p.s === "suspended").length,
    total_doubtful: players.filter(p => p.s.startsWith("doubtful")).length,
    impact_score: Math.min(10, impactScore / 3),
    players: impactPlayers,
  };
}

fs.writeFileSync("data/premier-injuries.json", JSON.stringify({
  source: "premierinjuries.com", fetched_at: new Date().toISOString(),
  total: flatInjuries.length, injuries: flatInjuries,
}, null, 2));

const existing = fs.existsSync("data/team-injury-impact.json") ? JSON.parse(fs.readFileSync("data/team-injury-impact.json", "utf8")) : {};
for (const [t, d] of Object.entries(teamImpact)) existing[t] = d;
fs.writeFileSync("data/team-injury-impact.json", JSON.stringify(existing, null, 2));

console.log("Injuries:", flatInjuries.length, "from", Object.keys(teams).length, "teams");
console.log("\nBy team:");
for (const [t, d] of Object.entries(teamImpact).sort((a, b) => b[1].impact_score - a[1].impact_score)) {
  console.log("  " + t.padEnd(22) + d.impact_score.toFixed(1) + " impact | " + d.ruled_out + " out, " + d.total_suspended + " susp, " + d.total_doubtful + " doubt");
}
