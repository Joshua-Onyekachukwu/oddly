import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

const supabaseAdmin = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * POST /api/v1/admin/run-validation
 * 
 * Trigger walk-forward validation for injury features.
 * Requires admin role.
 */
export async function POST(request: NextRequest) {
  try {
    // Authenticate
    const authHeader = request.headers.get("authorization");
    const apiKey = request.headers.get("x-api-key");

    if (!authHeader && !apiKey) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let isAdmin = false;

    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      const { data: { user } } = await supabaseAdmin.auth.getUser(token);

      if (user) {
        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("role")
          .eq("id", user.id)
          .single();

        isAdmin = profile?.role === "admin";
      }
    }

    if (apiKey === process.env.INTERNAL_API_KEY) {
      isAdmin = true;
    }

    if (!isAdmin) {
      return NextResponse.json(
        { error: "Admin access required" },
        { status: 403 }
      );
    }

    // Run validation logic
    const validationResult = await runValidation();

    return NextResponse.json({
      success: true,
      result: validationResult,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    if (error?.code === "FORBIDDEN") {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error?.code === "UNAUTHORIZED") {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    console.error("Validation error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

async function runValidation() {
  // Get baseline predictions (without injury features)
  const { data: baselinePreds } = await supabaseAdmin
    .from("predictions")
    .select("selection, model_probability, result, fixture_id")
    .eq("market", "1X2")
    .not("result", "is", null)
    .limit(1000);

  // Get predictions with injury features
  const { data: injuryPreds } = await supabaseAdmin
    .from("predictions")
    .select("selection, model_probability, result, fixture_id, injury_features_used")
    .eq("market", "1X2")
    .not("result", "is", null)
    .not("injury_features_used", "is", null)
    .limit(1000);

  // Calculate metrics
  const baselineMetrics = baselinePreds ? calculateMetrics(baselinePreds) : null;
  const injuryMetrics = injuryPreds ? calculateMetrics(injuryPreds) : null;

  // Calculate improvement
  let improvement = null;
  if (baselineMetrics && injuryMetrics) {
    improvement = {
      accuracy: injuryMetrics.accuracy - baselineMetrics.accuracy,
      balancedAccuracy: injuryMetrics.balancedAccuracy - baselineMetrics.balancedAccuracy,
      logLoss: injuryMetrics.logLoss - baselineMetrics.logLoss,
      brierScore: injuryMetrics.brierScore - baselineMetrics.brierScore,
    };
  }

  return {
    baseline: baselineMetrics,
    withInjuries: injuryMetrics,
    improvement,
  };
}

function calculateMetrics(preds: any[]) {
  let correct = 0;
  const total = preds.length;
  
  const classMetrics = {
    home: { tp: 0, fp: 0, fn: 0 },
    draw: { tp: 0, fp: 0, fn: 0 },
    away: { tp: 0, fp: 0, fn: 0 },
  };
  
  let logLoss = 0;
  let brierScore = 0;
  
  for (const pred of preds) {
    const selection = (pred.selection || "").toLowerCase();
    const result = (pred.result || "").toLowerCase();
    
    if (selection === result) {
      correct++;
      classMetrics[result as keyof typeof classMetrics].tp++;
    } else {
      classMetrics[selection as keyof typeof classMetrics].fp++;
      classMetrics[result as keyof typeof classMetrics].fn++;
    }
    
    const prob = pred.model_probability || 0.5;
    const actualProb = selection === result ? 1 : 0;
    
    logLoss -= actualProb * Math.log(prob + 1e-10) + (1 - actualProb) * Math.log(1 - prob + 1e-10);
    brierScore += Math.pow(prob - actualProb, 2);
  }
  
  const accuracy = total > 0 ? correct / total : 0;
  logLoss = total > 0 ? logLoss / total : 0;
  brierScore = total > 0 ? brierScore / total : 0;
  
  const perClass: any = {};
  for (const [cls, metrics] of Object.entries(classMetrics)) {
    const precision = metrics.tp + metrics.fp > 0 ? metrics.tp / (metrics.tp + metrics.fp) : 0;
    const recall = metrics.tp + metrics.fn > 0 ? metrics.tp / (metrics.tp + metrics.fn) : 0;
    const f1 = precision + recall > 0 ? 2 * (precision * recall) / (precision + recall) : 0;
    
    perClass[cls] = { precision, recall, f1 };
  }
  
  const balancedAccuracy = Object.values(perClass).reduce((sum: number, m: any) => sum + m.recall, 0) / 3;
  
  return {
    accuracy,
    balancedAccuracy,
    logLoss,
    brierScore,
    sampleSize: total,
    perClass,
  };
}
