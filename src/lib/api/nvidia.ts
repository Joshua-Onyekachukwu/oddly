/**
 * NVIDIA NIM API Client
 * 
 * Uses 10 API keys with automatic rotation when quota is hit.
 * Supports chat completions, embeddings, and inference endpoints.
 */

const NVIDIA_KEYS = Array.from({ length: 10 }, (_, i) => 
  process.env[`NVIDIA_KEY_${i + 1}`] || ""
).filter(Boolean);

let currentKeyIndex = 0;

function getNextKey(): string {
  if (NVIDIA_KEYS.length === 0) {
    throw new Error("No NVIDIA API keys configured. Check NVIDIA_KEY_* in .env.local");
  }
  const key = NVIDIA_KEYS[currentKeyIndex % NVIDIA_KEYS.length];
  currentKeyIndex = (currentKeyIndex + 1) % NVIDIA_KEYS.length;
  return key;
}

function resetKeyIndex() {
  currentKeyIndex = 0;
}

const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";

interface NvidiaChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface NvidiaChatRequest {
  model: string;
  messages: NvidiaChatMessage[];
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  stream?: boolean;
}

interface NvidiaChatResponse {
  id: string;
  choices: {
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * Send a chat completion request to NVIDIA NIM API.
 * Automatically rotates keys on 429 (rate limit) errors.
 */
export async function nvidiaChat(
  request: NvidiaChatRequest,
  retries = NVIDIA_KEYS.length
): Promise<NvidiaChatResponse> {
  for (let attempt = 0; attempt < retries; attempt++) {
    const key = getNextKey();
    
    const response = await fetch(`${NVIDIA_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        ...request,
        stream: false,
      }),
    });

    if (response.status === 429) {
      console.warn(`NVIDIA key ${currentKeyIndex} rate limited, rotating...`);
      continue;
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`NVIDIA API error ${response.status}: ${errorText}`);
    }

    return response.json();
  }

  throw new Error("All NVIDIA API keys exhausted or rate limited");
}

/**
 * Analyze a football match using NVIDIA AI.
 * Returns structured prediction data.
 */
export async function analyzeMatch(matchData: {
  homeTeam: string;
  awayTeam: string;
  league: string;
  kickoff: string;
  odds?: Record<string, number>;
  form?: { home: string[]; away: string[] };
}): Promise<{
  predictions: Array<{
    market: string;
    probability: number;
    confidence: number;
    edge: number;
    reasoning: string;
  }>;
  summary: string;
  riskLevel: "low" | "medium" | "high";
}> {
  const prompt = `You are an expert football analyst. Analyze this match and provide predictions.

Match: ${matchData.homeTeam} vs ${matchData.awayTeam}
League: ${matchData.league}
Kickoff: ${matchData.kickoff}
${matchData.odds ? `Market Odds: ${JSON.stringify(matchData.odds)}` : ""}
${matchData.form ? `Home Form: ${matchData.form.home.join(", ")}\nAway Form: ${matchData.form.away.join(", ")}` : ""}

Return a JSON object with:
1. predictions[] - array of {market, probability (0-1), confidence (0-1), edge (probability - implied_odds_probability), reasoning}
2. summary - 2 sentence match analysis
3. riskLevel - "low", "medium", or "high"

Markets to analyze: Over/Under 2.5, BTTS, Match Result, Both Teams to Score Over 1.5, Correct Score ranges.
Only include markets where confidence > 0.65. Sort by confidence descending.

Return ONLY valid JSON, no markdown.`;

  const response = await nvidiaChat({
    model: "meta/llama-3.1-70b-instruct",
    messages: [
      {
        role: "system",
        content: "You are a precise football prediction analyst. Always return valid JSON only, no markdown fences.",
      },
      { role: "user", content: prompt },
    ],
    temperature: 0.3,
    max_tokens: 2048,
  });

  const content = response.choices[0]?.message?.content || "{}";
  
  try {
    // Strip markdown fences if present
    const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    return JSON.parse(cleaned);
  } catch {
    throw new Error(`Failed to parse NVIDIA response: ${content.substring(0, 200)}`);
  }
}

/**
 * Get the number of available NVIDIA API keys.
 */
export function getNvidiaKeyCount(): number {
  return NVIDIA_KEYS.length;
}
