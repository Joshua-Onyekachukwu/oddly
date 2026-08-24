const fs = require("fs");
const env = {};
fs.readFileSync(".env.local", "utf8").split("\n").forEach((l) => {
  if (l.startsWith("#") || !l.includes("=")) return;
  const i = l.indexOf("=");
  let v = l.slice(i + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
    v = v.slice(1, -1);
  env[l.slice(0, i).trim()] = v;
});
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  // Check tables
  try {
    const { data, error } = await sb.from("referee_profiles").select("*").limit(1);
    console.log("referee_profiles:", error ? "MISSING" : `exists (${data?.length || 0} rows)`);
  } catch (e) { console.log("referee_profiles: MISSING"); }

  try {
    const { data, error } = await sb.from("referee_match_history").select("*").limit(1);
    console.log("referee_match_history:", error ? "MISSING" : `exists (${data?.length || 0} rows)`);
  } catch (e) { console.log("referee_match_history: MISSING"); }

  try {
    const { data, error } = await sb.from("fixtures").select("referee_name").limit(1);
    if (error) {
      console.log("fixtures.referee_name: MISSING (column doesn't exist)");
    } else {
      console.log("fixtures.referee_name: exists");
    }
  } catch (e) { console.log("fixtures.referee_name: MISSING"); }

  // Check current referee match history count
  try {
    const { count } = await sb.from("referee_match_history").select("*", { count: "exact", head: true });
    console.log("referee_match_history count:", count);
  } catch (e) { console.log("referee_match_history count: table missing"); }
})();
