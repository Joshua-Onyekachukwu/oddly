---
name: ODDLY
description: Football prediction intelligence platform — data-driven, premium, dark-first
colors:
  primary: "#1B2A4A"
  primary-light: "#627D98"
  accent: "#BFFF00"
  secondary: "#D97706"
  background: "#FAFBFC"
  foreground: "#0A0F1C"
  card: "#FFFFFF"
  muted: "#F1F5F9"
  success: "#22C55E"
  danger: "#EF4444"
  warning: "#F59E0B"
  border: "#E2E8F0"
  gray-100: "#F1F5F9"
  gray-200: "#E2E8F0"
  gray-300: "#CBD5E1"
  gray-400: "#94A3B8"
  gray-500: "#64748B"
  gray-600: "#475569"
  gray-800: "#1E293B"
  gray-900: "#0F172A"
typography:
  display:
    fontFamily: "Space Grotesk, system-ui, sans-serif"
    fontWeight: 700
  body:
    fontFamily: "DM Sans, system-ui, sans-serif"
    fontWeight: 400
    lineHeight: 1.6
  mono:
    fontFamily: "JetBrains Mono, monospace"
rounded:
  sm: "0.375rem"
  md: "0.5rem"
  lg: "0.75rem"
  xl: "1rem"
  2xl: "1.5rem"
  full: "9999px"
spacing:
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
  2xl: "48px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.lg}"
    padding: "10px 24px"
  card:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.xl}"
    padding: "24px"
  chip-elite:
    backgroundColor: "#FEF3C7"
    textColor: "#92400E"
    rounded: "{rounded.full}"
    padding: "4px 12px"
---

# Design System: ODDLY

## Overview

**Creative North Star: "The Trading Terminal"**

ODDLY's visual language borrows from financial trading platforms — clean data density, monospaced numbers, information hierarchy that rewards scanning. The aesthetic is premium-but-not-precious: dark navy foundations, electric lime accents for action and confidence, warm amber for secondary highlights. Every screen should feel like a well-organized control room where data speaks first and decoration is earned.

The system operates in two modes: a light public-facing mode (landing page, auth) and a dark dashboard mode for the core product experience. Dark mode is the primary register — it's where the product lives.

**Key Characteristics:**
- Dark-first with navy (#0A0F1C) backgrounds
- Electric lime (#BFFF00) as the signature accent — rare, high-impact
- Warm amber (#D97706) for secondary warmth and Nigerian heritage nods
- Space Grotesk for headings (geometric, data-forward)
- DM Sans for body (clean, readable)
- JetBrains Mono for numbers and data values
- Generous card spacing with ambient shadows (not hard borders)
- Edge indicator (3px left border) as a recurring signature motif
- Glass-card effect for overlays and floating panels

## Colors

The palette is split between a trustworthy navy core and high-energy accents. Color usage is disciplined — lime appears on ≤15% of any screen to preserve its impact.

### Primary — Deep Navy
- **Navy Core** (#1B2A4A): Primary backgrounds, headers, sidebar. The foundation of trust and data seriousness.
- **Navy Light** (#627D98): Secondary text, borders, subtle elements.
- **Navy Dark** (#102A43): Deepest backgrounds, card hover states.

### Accent — Electric Lime
- **Lime Primary** (#BFFF00): CTA buttons, active states, ELITE tier badges, focus rings, progress indicators. The "energy" color — use sparingly for maximum impact.
- **Lime Muted** (#ECFFB3): Hover states, subtle highlights, tinted backgrounds.

### Secondary — Warm Amber
- **Amber Core** (#D97706): Secondary actions, warnings, warm highlights. Carries Nigerian warmth into the palette.
- **Amber Light** (#FEF3C7): Backgrounds for tier badges, toast notifications.
- **Amber Dark** (#92400E): Text on amber backgrounds.

### Semantic
- **Success** (#22C55E): Correct predictions, positive outcomes, green indicators.
- **Danger** (#EF4444): Incorrect predictions, errors, negative outcomes.
- **Warning** (#F59E0B): Pending states, caution, yellow cards.

### Neutral
- **Background** (#FAFBFC → #0A0F1C dark): Page canvas.
- **Card** (#FFFFFF → #111827 dark): Card surfaces.
- **Muted** (#F1F5F9 → #1E293B dark): Subtle backgrounds, disabled states.
- **Border** (#E2E8F0 → #1E293B dark): Card borders, dividers.
- **Gray scale** (#F8FAFC through #020617): Text hierarchy, borders, backgrounds.

### Named Rules
**The Lime Rarity Rule.** Electric lime (#BFFF00) appears on ≤15% of any viewport. Its rarity creates visual hierarchy — when lime appears, the eye goes there first. Overuse destroys the accent's power.

**The Dark-Mode-First Rule.** The dashboard is designed dark. Light mode exists for public-facing pages only. When designing new dashboard surfaces, start with dark mode colors.

## Typography

**Display Font:** Space Grotesk (with system-ui fallback)
**Body Font:** DM Sans (with system-ui fallback)
**Mono/Data Font:** JetBrains Mono (with monospace fallback)

**Character:** Space Grotesk gives headings a geometric, slightly futuristic feel that signals precision. DM Sans provides warm readability for body text. JetBrains Mono ensures numbers align perfectly and data feels technical.

### Hierarchy
- **Display** (700, clamp(1.5rem, 4vw, 2.5rem), 1.1): Page titles ("Golden Picks", "Upcoming Matches")
- **Headline** (600, 1.25rem, 1.3): Section headers ("Today's Top Picks", "Match Details")
- **Title** (600, 1rem, 1.4): Card titles, team names
- **Body** (400, 0.875rem, 1.6): Descriptions, match info, predictions
- **Label** (500, 0.75rem, 0.05em, uppercase): Tier badges ("ELITE", "HIGH"), category tags
- **Data** (JetBrains Mono, 500, 0.875rem, tabular-nums): Odds, probabilities, percentages, scores

### Named Rules
**The Tabular Numbers Rule.** All numeric data (odds, percentages, scores, time) uses JetBrains Mono with `font-variant-numeric: tabular-nums` so columns align and scanning is effortless.

## Layout

The product uses a sidebar + main content layout. The sidebar is fixed-width (280px) with navigation. Main content is fluid with max-width containers.

**Grid:** Card grids use a responsive flexbox/grid system — 3-4 cards per row on desktop (>1200px), 2 on tablet (768-1200px), 1 on mobile (<768px).

**Spacing rhythm:** 8px base unit. Cards use 24px internal padding. Gaps between cards are 16-24px. Section margins are 32-48px.

**Container:** Main content uses `max-w-7xl mx-auto` with 24px horizontal padding.

**Density:** Information-dense but not cramped. Cards have breathing room. Match cards show team logos, names, time, odds, and prediction in a single row without feeling crowded.

## Elevation & Depth

The system uses ambient shadows exclusively — no hard drop shadows. Depth is conveyed through layered box-shadows that create a soft, floating effect.

### Shadow Vocabulary
- **Card rest** (`shadow-ambient`): Subtle 4-layer shadow — `0 0 0 1px rgba(0,0,0,0.02), 0 2px 4px rgba(0,0,0,0.02), 0 8px 24px rgba(0,0,0,0.04), 0 24px 48px rgba(0,0,0,0.02)` — Used on all cards at rest.
- **Card hover** (`shadow-ambient-lg`): Elevated 4-layer shadow — heavier spread — Used on card hover and floating panels.
- **Glass effect** (`glass-card`): `backdrop-filter: blur(20px)` with semi-transparent background — Used for overlays, modals, floating panels.

### Named Rules
**The Flat-By-Default Rule.** Cards are flat at rest with minimal ambient shadow. Shadows intensify only on hover or elevation (modals, dropdowns). This keeps the interface clean and prevents visual noise.

## Shapes

The form language is gently rounded — not sharp, not bubbly. Radius values are conservative to maintain the data-forward, professional feel.

- **Cards:** `rounded-xl` (1rem) — generous but not pill-like.
- **Buttons:** `rounded-lg` (0.75rem) — slightly softer than cards.
- **Inputs:** `rounded-lg` (0.75rem) — matching buttons.
- **Chips/Badges:** `rounded-full` (9999px) — pill-shaped for tier badges, tags.
- **Avatars:** `rounded-full` — always circular.
- **Icons:** Remix Icons (`ri-*`) — consistent 20-24px sizing.

## Components

### Match Card
The primary content unit. Shows two teams, league badge, kickoff time, odds, and prediction confidence.

- **Corner Style:** `rounded-xl` (1rem)
- **Background:** Card color (#FFFFFF light / #111827 dark)
- **Shadow:** `shadow-ambient` at rest, `shadow-ambient-lg` on hover
- **Border:** 1px border in muted color
- **Internal Padding:** 16-20px
- **Signature:** 3px left accent border (edge-indicator) on ELITE picks

### Tier Badges (ELITE / HIGH / MEDIUM / LOW)
Color-coded confidence indicators.

- **ELITE:** Amber background (#FEF3C7), dark amber text (#92400E), `rounded-full`
- **HIGH:** Green background (#DCFCE7), dark green text (#166534), `rounded-full`
- **MEDIUM:** Blue background (#DBEAFE), dark blue text (#1E40AF), `rounded-full`
- **LOW:** Gray background (#F1F5F9), gray text (#64748B), `rounded-full`

### Primary Button
- **Shape:** `rounded-lg` (0.75rem)
- **Primary:** Navy (#1B2A4A) background, white text, 10px 24px padding
- **Hover:** Slight lift + shadow intensification
- **Active:** Scale(0.97) press feedback
- **Accent variant:** Lime (#BFFF00) background, dark text — for primary CTAs in dark mode

### Stat Cards
Summary metric cards on dashboards.

- **Corner Style:** `rounded-xl` (1rem)
- **Background:** Card color
- **Internal Padding:** 20-24px
- **Typography:** Label (uppercase, small) for category, Display (large, bold) for number
- **Optional:** Colored top border or left accent strip

### Sidebar Navigation
Fixed left sidebar with nav items.

- **Width:** 280px
- **Background:** Dark navy (#0A0F1C)
- **Items:** Rounded hover states, lime active indicator
- **Typography:** Body weight 500, 0.875rem
- **Active state:** Lime text + subtle lime background tint

### Odds Display
Bookmaker odds shown in monospaced data font.

- **Typography:** JetBrains Mono, tabular-nums
- **Format:** Three columns (Home / Draw / Away)
- **Styling:** Gray background chips with centered numbers

### Confidence Percentage
Large probability display on prediction cards.

- **Typography:** JetBrains Mono, 700 weight, 1.5rem+
- **Color:** Matches tier (lime for ELITE, green for HIGH, etc.)
- **Format:** `94%` — no decimals shown on cards

## Do's and Don'ts

### Do:
- **Do** use the edge-indicator (3px lime left border) on ELITE prediction cards — it's the signature motif.
- **Do** use JetBrains Mono for all numeric data — odds, percentages, scores, time.
- **Do** keep lime accent usage under 15% of any viewport — its rarity creates hierarchy.
- **Do** use the ambient shadow system (4-layer box-shadows) instead of hard borders for cards.
- **Do** show real team logos on every match card — never use generic placeholders.
- **Do** maintain the stagger animation pattern for lists of cards (80ms delay between items).
- **Do** respect `prefers-reduced-motion` — the system already handles this.

### Don't:
- **Don't** use `transition: all` — always specify exact properties (`transform`, `opacity`, `box-shadow`).
- **Don't** animate from `scale(0)` — start from `scale(0.95)` with opacity for natural entrances.
- **Don't** use `ease-in` for UI animations — always `ease-out` or the custom drawer curve `cubic-bezier(0.32, 0.72, 0, 1)`.
- **Don't** put more than 4 cards per row on desktop — information density has limits.
- **Don't** use lime (#BFFF00) as a background for large surfaces — it overwhelms.
- **Don't** show prediction confidence without context — always show the market, selection, and edge alongside.
- **Don't** use mock/placeholder data in any production-facing component.
- **Don't** create generic AI-slop card walls — use the right layout for the content (grid for comparable items, tables for dense data, charts for trends).
