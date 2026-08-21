"use client";

import React, { useState } from "react";

const GLOSSARY: Record<string, { label: string; description: string }> = {
  // Markets
  "1X2": { label: "Match Result", description: "Predict the final outcome: Home win (1), Draw (X), or Away win (2)" },
  "DC": { label: "Double Chance", description: "Cover two outcomes in one bet — Home or Draw (1X), Draw or Away (X2), or Home or Away (12)" },
  "DNB": { label: "Draw No Bet", description: "Bet on a team to win — if it's a draw, your stake is returned" },
  "BTTS": { label: "Both Teams To Score", description: "Both teams must score at least one goal for the bet to win" },
  "OU": { label: "Over/Under Goals", description: "Predict whether total goals will be above or below a line (e.g. Over 2.5 = 3+ goals)" },
  "HomeGoals": { label: "Home Team Goals", description: "Predict how many goals the home team will score" },
  "AwayGoals": { label: "Away Team Goals", description: "Predict how many goals the away team will score" },

  // Selections
  "Home": { label: "Home Win", description: "The home team wins the match" },
  "Away": { label: "Away Win", description: "The away team wins the match" },
  "Draw": { label: "Draw", description: "The match ends in a draw" },
  "1X": { label: "Home or Draw", description: "Home team wins OR the match is a draw" },
  "X2": { label: "Draw or Away", description: "Match is a draw OR away team wins" },
  "12": { label: "No Draw", description: "Either team wins — no draw" },
  "Home_DNB": { label: "Home (No Draw)", description: "Home team wins; draw returns stake" },
  "Away_DNB": { label: "Away (No Draw)", description: "Away team wins; draw returns stake" },
  "Yes": { label: "Yes", description: "The condition is met (e.g. both teams score)" },
  "No": { label: "No", description: "The condition is not met" },

  // Goals
  "Over_0.5": { label: "Over 0.5 Goals", description: "At least 1 goal in the match (very common ~94%)" },
  "Under_0.5": { label: "Under 0.5 Goals", description: "No goals — the match ends 0-0" },
  "Over_1.5": { label: "Over 1.5 Goals", description: "At least 2 goals in the match" },
  "Under_1.5": { label: "Under 1.5 Goals", description: "1 or fewer goals in the match" },
  "Over_2.5": { label: "Over 2.5 Goals", description: "At least 3 goals in the match" },
  "Under_2.5": { label: "Under 2.5 Goals", description: "2 or fewer goals in the match" },
  "Over_3.5": { label: "Over 3.5 Goals", description: "At least 4 goals in the match" },
  "Under_3.5": { label: "Under 3.5 Goals", description: "3 or fewer goals in the match" },
  "Over_4.5": { label: "Over 4.5 Goals", description: "At least 5 goals in the match" },
  "Under_4.5": { label: "Under 4.5 Goals", description: "4 or fewer goals in the match" },
};

// Short labels for compact display
export const SHORT_LABELS: Record<string, string> = {
  "1X2": "Match Result",
  "DC": "Double Chance",
  "DNB": "Draw No Bet",
  "BTTS": "BTTS",
  "OU": "Goals",
  "HomeGoals": "Home Goals",
  "AwayGoals": "Away Goals",
  "Home": "Home Win",
  "Away": "Away Win",
  "Draw": "Draw",
  "1X": "Home or Draw",
  "X2": "Draw or Away",
  "12": "No Draw",
  "Home_DNB": "Home (DNB)",
  "Away_DNB": "Away (DNB)",
  "Over_0.5": "Over 0.5",
  "Under_0.5": "Under 0.5",
  "Over_1.5": "Over 1.5",
  "Under_1.5": "Under 1.5",
  "Over_2.5": "Over 2.5",
  "Under_2.5": "Under 2.5",
  "Over_3.5": "Over 3.5",
  "Under_3.5": "Under 3.5",
  "Over_4.5": "Over 4.5",
  "Under_4.5": "Under 4.5",
};

// Abbreviated display for compact cards
export const ABBREV_LABELS: Record<string, string> = {
  "Over_0.5": "O0.5",
  "Under_0.5": "U0.5",
  "Over_1.5": "O1.5",
  "Under_1.5": "U1.5",
  "Over_2.5": "O2.5",
  "Under_2.5": "U2.5",
  "Over_3.5": "O3.5",
  "Under_3.5": "U3.5",
  "Over_4.5": "O4.5",
  "Under_4.5": "U4.5",
  "Home_DNB": "Home DNB",
  "Away_DNB": "Away DNB",
};

interface BettingTooltipProps {
  term: string;
  children?: React.ReactNode;
  className?: string;
  showAbbrev?: boolean;
}

export function BettingTooltip({ term, children, className = "", showAbbrev = false }: BettingTooltipProps) {
  const [show, setShow] = useState(false);
  const info = GLOSSARY[term];
  const displayLabel = showAbbrev ? (ABBREV_LABELS[term] || SHORT_LABELS[term] || term) : (SHORT_LABELS[term] || term);

  if (!info) {
    return <span className={`pointer-events-none ${className}`}>{children || term}</span>;
  }

  return (
    <span
      className={`relative inline-block pointer-events-none ${className}`}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      <span
        aria-describedby={`tooltip-${term}`}
        className="border-b border-dashed border-current opacity-80"
      >
        {children || displayLabel}
      </span>
      {show && (
        <span
          id={`tooltip-${term}`}
          role="tooltip"
          className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-[#0A0F1C] text-white text-[11px] leading-[1.4] rounded-lg shadow-lg whitespace-nowrap max-w-[260px] text-left pointer-events-none"
          style={{ width: "max-content", maxWidth: 260 }}
        >
          <span className="font-semibold text-[#BFFF00]">{info.label}</span>
          <br />
          <span className="text-gray-300">{info.description}</span>
          <span className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-[5px] border-r-[5px] border-t-[5px] border-l-transparent border-r-transparent border-t-[#0A0F1C]" />
        </span>
      )}
    </span>
  );
}

// Helper to get a human-readable label for any market/selection
export function getMarketLabel(market: string): string {
  return SHORT_LABELS[market] || market;
}

export function getSelectionLabel(selection: string): string {
  return SHORT_LABELS[selection] || selection.replace(/_/g, " ");
}

export function getAbbrevLabel(selection: string): string {
  return ABBREV_LABELS[selection] || SHORT_LABELS[selection] || selection.replace(/_/g, " ");
}
