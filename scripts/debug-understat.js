#!/usr/bin/env node
/**
 * Debug Understat HTML to find the correct data extraction pattern.
 */
const https = require("https");

function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetch(res.headers.location).then(resolve).catch(reject);
        return;
      }
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => resolve({ status: res.statusCode, html: data, headers: res.headers }));
    }).on("error", reject);
  });
}

async function main() {
  const { status, html, headers } = await fetch("https://understat.com/league/EPL");
  console.log("Status:", status);
  console.log("Content-Type:", headers["content-type"]);
  console.log("HTML length:", html.length);
  
  // Check for Cloudflare or bot detection
  if (html.includes("cf-browser-verification") || html.includes("challenge-platform")) {
    console.log("\n⚠️  Cloudflare protection detected!");
    console.log(html.substring(0, 500));
    return;
  }
  
  // Find all script tags
  const scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  let scriptIdx = 0;
  while ((match = scriptRegex.exec(html)) !== null) {
    const content = match[1].trim();
    if (content.length > 20) {
      scriptIdx++;
      console.log(`\nScript #${scriptIdx} (${content.length} chars):`);
      console.log(content.substring(0, 400));
      console.log("...");
    }
  }
  
  // Search for data patterns
  const searchTerms = ["teamsData", "datesData", "playersData", "JSON.parse", "\\x", "xG", "xg"];
  for (const term of searchTerms) {
    const idx = html.indexOf(term);
    if (idx > -1) {
      console.log(`\n=== Found "${term}" at index ${idx} ===`);
      console.log(html.substring(Math.max(0, idx - 40), idx + 200));
      console.log("===");
    }
  }
  
  // Check if it's a React/SPA page
  if (html.includes("__NEXT_DATA__") || html.includes("__NUXT__") || html.includes("window.__data")) {
    console.log("\n⚠️  SPA detected — data loaded client-side");
  }
  
  // Save full HTML for inspection
  require("fs").writeFileSync("data/understat-debug.html", html);
  console.log("\nFull HTML saved to data/understat-debug.html");
}

main().catch(console.error);
