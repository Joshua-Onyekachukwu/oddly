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
  console.log("=== Prediction Result Distribution ===");
  const { data: sample } = await sb.from("predictions").select("result").limit(5);
  console.log("Sample results:", sample?.map((r) => r.result));

  const { count: settled } = await sb.from("predictions").select("*", { count: "exact", head: true }).not("settled_at", "is", null);
  console.log("Settled (has settled_at):", settled);

  const { count: correct } = await sb.from("predictions").select("*", { count: "exact", head: true }).eq("result", "correct");
  console.log("result=correct:", correct);

  const { count: wrong } = await sb.from("predictions").select("*", { count: "exact", head: true }).eq("result", "wrong");
  console.log("result=wrong:", wrong);

  const { count: pending } = await sb.from("predictions").select("*", { count: "exact", head: true }).eq("result", "pending");
  console.log("result=pending:", pending);

  const { count: incorrect } = await sb.from("predictions").select("*", { count: "exact", head: true }).eq("result", "incorrect");
  console.log("result=incorrect:", incorrect);

  const { count: voided } = await sb.from("predictions").select("*", { count: "exact", head: true }).eq("result", "void");
  console.log("result=void:", voided);

  // Check if is_correct column exists (old schema)
  const { data: testPred } = await sb.from("predictions").select("is_correct").limit(1);
  console.log("\nis_correct column exists:", testPred && testPred.length > 0 && "is_correct" in (testPred[0] || {}));

  // Check settle route uses
  console.log("\n=== DB type for predictions.result ===");
  const { data: samplePred } = await sb.from("predictions").select("id, result, settled_at, model_probability").not("settled_at", "is", null).limit(3);
  console.log("Settled samples:", JSON.stringify(samplePred, null, 2));
})();
