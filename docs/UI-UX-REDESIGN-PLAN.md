# ODDLY — UI/UX Redesign Plan

**Date:** 2026-11-26

---

## 1. Design Foundation (exists)

- `DESIGN.md` specifies: Deep Navy primary, Electric Lime accent, Warm Amber secondary, semantic colors, defined type hierarchy, shadow vocabulary, component specs (Match Card, Tier Badges).
- `src/components/ui/`: Card, Badge, Button, StatCard, EmptyState, ErrorBoundary, PageHeader, DesignSystem, Logo, skeletons.
- Tailwind CSS v4, Remix Icon + Material Symbols, custom fonts (`font-display`, `font-mono-data`).
- Trezo templates exist in `/Trezo` but were never integrated — decide: adopt selectively or remove folder (open question).

## 2. Page Inventory & Disposition

### Marketing (keep, refresh copy)
`/`, `/features`, `/pricing` — verify all claims against shipped features; remove unverified accuracy/ROI numbers.

### Auth (keep)
`/login`, `/signup`, `/forgot-password`, `/auth/callback`.

### User app (reorganize)
| Route | Disposition |
|---|---|
| `/dashboard` | Rebuild as intelligence overview (see below) |
| `/matches`, `/matches/upcoming`, `/matches/results`, `/matches/[id]` | Keep; `[id]` becomes full Match Intelligence page |
| `/predictions` | Keep; add quality/EV columns + qualification status |
| `/rollover` | **Rebuild** around engine ticket (not user chains) |
| `/accumulator`, `/accumulator/my-accumulators` | Keep; secondary to rollover |
| `/performance`, `/tracking` | Merge or clarify distinction; both show prediction performance — consolidate into `/analytics` + `/history` |
| `/notifications`, `/notifications/preferences` | Keep |
| `/settings` | Keep |
| `/ai-chat` | Keep as "Ask ODDLY" explanation interface |
| `/betting-agent` | Keep but label experimental; Nigerian-market focus |

### Admin (reorganize into 9 sections per PRODUCT-ROADMAP Module C)
Existing 19 admin pages map onto: Overview, Data, Predictions, Models, Rollover, Competitions, Operations, Users, Security. Merge duplicates (convex-health → Data; db-health + system-health → Overview/Operations; scoring → Models config).

## 3. Dashboard Redesign (priority page)

Top→bottom:
1. **Header**: date, league filter, market filter.
2. **Today's Rollover** card: ticket legs, combined odds, combined prob, EV, qualification badges — or explicit "No qualifying opportunity."
3. **Featured picks**: top qualified selections by EV with confidence + data-quality chips.
4. **Fixtures strip**: today's matches with prediction status.
5. **Performance snapshot**: 7/30/90-day accuracy, Brier, ROI — each with sample size.
6. **Recent settlements**: live feed (Convex or Supabase Realtime).
7. **Alerts**: odds movements, injury news affecting watched matches.

## 4. Design System Work

- Audit every page against DESIGN.md tokens; fix drift (many pages use ad-hoc grays/hex).
- Standardize: data tables (sortable, dense, mono numerals), probability displays (always % + implied odds + EV together), confidence badges (calibrated language, never "sure thing"), empty/error/loading states (components exist — ensure used everywhere).
- Charts: introduce a single charting approach (Recharts or similar — decide; currently no chart lib in deps!) for calibration, equity curve, accuracy trends.
- Mobile: verify all tables/cards responsive; admin can be desktop-first but must not break.
- Accessibility: focus states, aria labels on icon buttons, color+text (not color-only) for win/loss/tier.

## 5. Content Rules

- No "guaranteed", "sure", "can't lose", "NN% accurate" without measured backing + sample size.
- Every probability shown with: model prob, implied prob (if odds shown), EV, data-quality indicator.
- Rollover page must explain qualification per leg and show "no qualifying opportunity" state prominently.
- Responsible gambling: visible disclaimer, bankroll context, no stake-size encouragement.

## 6. Implementation Order

1. Design-token audit + shared component gaps (charts, data table, probability cell).
2. Dashboard rebuild (depends on rollover engine for card #2 — can ship with placeholder-free "engine pending" state initially? **No** — ship dashboard after rollover engine OR show honest empty state).
3. Match Intelligence page.
4. Predictions/Odds/Analytics pages.
5. Rollover UI (with engine).
6. Admin reorganization.
7. Marketing copy rewrite.
