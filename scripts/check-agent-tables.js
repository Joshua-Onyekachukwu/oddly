const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");

const env = {};
fs.readFileSync(".env.local", "utf8").split("\n").forEach((l) => {
  if (l.startsWith("#") || !l.includes("=")) return;
  const i = l.indexOf("=");
  let v = l.slice(i + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
    v = v.slice(1, -1);
  env[l.slice(0, i).trim()] = v;
});

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  // Check if agent_audit_log table exists
  const { data, error } = await sb.from("agent_audit_log").select("*").limit(1);
  if (error) {
    console.log("Table error:", error.message);
  } else {
    console.log("Table exists, rows:", data.length);
  }

  const { count } = await sb.from("agent_audit_log").select("*", { count: "exact", head: true });
  console.log("Total audit rows:", count);

  // Check upcoming fixtures count
  const { data: fixtures } = await sb.from("fixtures").select("id", { count: "exact" }).eq("status", "scheduled").gte("kickoff_time", new Date().toISOString());
  console.log("Upcoming fixtures:", fixtures?.length || 0);

  // Check predictions with model_probability
  const { count: predCount } = await sb.from("predictions").select("*", { count: "exact", head: true }).not("model_probability", "is", null);
  console.log("Predictions with model_probability:", predCount);

  // Check odds snapshots
  const { count: oddsCount } = await sb.from("odds_snapshots").select("*", { count: "exact", head: true });
  console.log("Odds snapshots:", oddsCount);
})();
