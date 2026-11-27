# ODDLY — UI/UX Redesign Plan

**Date:** 2026-11-27 (updated post product-audit) · Supersedes 2026-11-26 version
Cross-refs: [MASTER-PLAN.md](MASTER-PLAN.md) · [PRODUCT-ROADMAP.md](PRODUCT-ROADMAP.md) · [ODDLY-COMPLETE-PRODUCT-ROADMAP.md](ODDLY-COMPLETE-PRODUCT-ROADMAP.md) F-25 · [PRODUCT-AUDIT-FINDINGS.md](PRODUCT-AUDIT-FINDINGS.md) · [ODDLY-ADMIN-PLATFORM-PLAN.md](ODDLY-ADMIN-PLATFORM-PLAN.md)

---

## 1. Design system assessment (verified)

**Exists:** `DESIGN.md` tokens (Deep Navy primary, Electric Lime accent, Warm Amber secondary, semantic colors, type hierarchy, shadows); `src/components/ui/` — Card, Badge, Button, StatCard, EmptyState, ErrorBoundary, PageHeader, DesignSystem, Logo, skeletons; Tailwind v4; Remix Icon + Material Symbols; `font-display`/`font-mono-data`.

**Gaps (evidence-based):**
- **No chart library in deps** — `/performance`, calibration, equity curves need one (pick Recharts or similar; single decision, record in DECISIONS doc).
- **No shared data-table / probability-cell components** — tables are per-page ad-hoc; probability display inconsistent (must always show % + implied odds + EV together).
- **Token drift** — several pages use ad-hoc grays/hex instead of DESIGN.md tokens (needs audit pass per page).
- **`/Trezo` templates** — never integrated; adopt-or-remove still open.
- Loading/empty/error: components exist (`EmptyState`, skeletons, `error.tsx`/`loading.tsx` in admin) but coverage is uneven on user routes — enforce usage (see §5).

## 2. Navigation / IA proposal

**Public shell** (Navbar+Footer): `/`, `/features`, `/pricing`, `/how-it-works`?, `/predictions` (public teaser?), `/competitions`, `/about`, `/faq`, `/contact`, `/terms`, `/privacy`, `/cookies`, `/responsible-gambling`. Legal pages now public (middleware fix verified). `/features` exists but is unlinked — add nav entry or fold into anchors.

**App shell** (Sidebar+Header) — proposed groups:
- **Today:** `/dashboard`
- **Matches:** `/matches`, `/matches/upcoming`, `/matches/results`
- **Intelligence:** `/predictions`, `/performance`, `/tracking`
- **Play:** `/rollover` (primary), `/accumulator`, `/my-accumulators`, `/betting-agent` (label experimental)
- **Tools:** `/ai-chat`, `/notifications`, `/preferences`, `/settings`

**Admin shell** — reorganize 20 routes into the 11 sections per ODDLY-ADMIN-PLATFORM-PLAN.md (Overview, Users, Football Data, Providers, Prediction Ops, Model Intelligence, Settlement, Rollover, System Ops, Config, Security/Audit). Merge: db-health+system-health→Ops; scoring+model-health+walk-forward+accuracy+draw-analysis→Model Intelligence; delete convex-health.

## 3. Per-page UX notes (audited routes)

| Route | Status | UX notes / required changes |
|---|---|---|
| `/` | Complete | Real Supabase stats; remove remaining hardcodes (modelAgreement:5, activeModels:3); keep honest claims |
| `/features`,`/pricing` | Partial | Pricing: paid CTAs stay disabled until billing launch (F-24); label tiers "coming soon" honestly |
| `/about`,`/contact`,`/faq`,`/terms`,`/privacy`,`/cookies`,`/responsible-gambling` | Complete | Verify public access stays fixed; add responsible-gambling links in footer globally |
| `/login`,`/signup`,`/forgot-password`,`/reset-password`,`/auth/callback` | Complete | Reset flow fixed 2026-11-27; add password-strength hint + post-reset redirect test |
| `/dashboard` | Partial→rebuild | See §4 — rebuild around qualified picks + rollover card |
| `/matches*` | Complete | Keep filters/pagination/drawer; `[id]` → full Match Intelligence (§6) |
| `/predictions` | Complete→upgrade | Add columns: model prob, model confidence (distinct!), data-quality chip, EV, model version, timestamp; link rows to match intelligence |
| `/rollover` | Complete v1→spec | Must show per-leg qualification + "no qualifying opportunity" state prominently; simulated vs actual bankroll labelled |
| `/accumulator`,`/my-accumulators` | Complete | Secondary to rollover; persist betslip (currently console.log in betting-agent) |
| `/betting-agent` | Partial | Label experimental; History tab "Coming Soon" — ship or hide |
| `/ai-chat` | Complete | Add "verified fact vs interpretation" labelling per brief §16 |
| `/performance` | Complete→upgrade | Add calibration chart (needs chart lib), per-market/league breakdowns, n shown everywhere, CLV/ROI only with verified records, simulated-vs-real separation |
| `/tracking` | Complete | Clarify vs `/performance`; show correction audit entries |
| `/notifications`,`/preferences` | Complete | Inbox real; add empty-state copy; delivery is in-app only until F-42 |
| `/settings` | Complete | Profile, notif prefs, Stripe portal (dormant until billing) |
| `/admin/*` | Mixed | Per admin plan; settings page is static — rebuild as config/flags |

## 4. Dashboard rebuild (priority page — unchanged intent, updated deps)

Top→bottom: header (date/league/market filters) → Today's Rollover card (ticket legs, combined odds ~2.00, combined prob, EV, QUALIFIED/WAIT/SKIP badges, or explicit "No qualifying opportunity") → Featured picks (top EV with confidence + data-quality chips) → Fixtures strip → Performance snapshot (7/30/90d accuracy/Brier/ROI each with n) → Recent settlements feed → Alerts.

**Updated dependency note:** rollover engine v1 exists now — dashboard can ship the rollover card against real engine output; honest empty state required regardless.

## 5. State standards (loading / empty / error)

- **Loading:** skeletons matching final layout (components exist) — never spinners-only on data pages; poll indicators show last-updated timestamp.
- **Empty:** `EmptyState` component mandatory; copy explains *why* empty ("No settled predictions yet — first settle runs after tonight's fixtures") and offers next action.
- **Error:** `ErrorBoundary` + inline retry; error states never show raw stack/SQL; log correlation ID.
- **Data honesty:** every metric shows sample size; probabilities always as % + implied odds + EV; confidence uses calibrated language (never "sure thing"); missing data labelled "unavailable" not hidden.

## 6. Component gaps to build

1. Chart wrapper (single lib decision) — calibration, accuracy trend, equity curve.
2. `DataTable` — sortable, dense, mono numerals, sticky header, mobile card fallback.
3. `ProbabilityCell` — prob% + implied odds + EV + data-quality chip, one component everywhere.
4. `ConfidenceBadge` / `QualificationBadge` (QUALIFIED/WAIT/SKIP) — shared user+admin.
5. `DataQualityIndicator` — freshness/completeness score display.
6. `MissingInfoLabel` — "lineups unconfirmed", "odds stale >2h" etc.

## 7. Mobile strategy (brief §20 — intentional, not shrunk desktop)

- **App shell:** bottom tab bar on mobile (Today / Matches / Picks / Rollover / More); sidebar becomes drawer.
- **Tables → cards:** DataTable must have card-mode breakpoint; admin is desktop-first but must not break (horizontal scroll + sticky first column acceptable).
- **Match/prediction cards** designed mobile-first; odds/probability stacks vertically.
- **Touch targets** ≥44px; filters collapse into bottom-sheet pattern.
- Verify: rollover ticket, accumulator builder, ai-chat input, notification list on 360px width.

## 8. Accessibility checklist

- [ ] Focus visible on all interactive elements; logical tab order; skip-to-content link.
- [ ] Icon-only buttons have `aria-label`; decorative icons `aria-hidden`.
- [ ] Win/loss/tier/probability never colour-only — always text/symbol + colour.
- [ ] Contrast: Lime accent on Navy must meet WCAG AA for text; check `DESIGN.md` tokens.
- [ ] Form errors associated via `aria-describedby`; auth flows labelled.
- [ ] `prefers-reduced-motion` respected (polling indicators, transitions).
- [ ] Tables have `<th scope>`; charts have text summaries.
- [ ] No information conveyed by hover-only (tooltips need focus/tap equivalents).

## 9. Content rules (carried forward, still binding)

- No "guaranteed"/"sure"/"can't lose"/"NN% accurate" without measured backing + n.
- Every probability: model prob + implied prob (if odds) + EV + data-quality.
- Rollover page explains qualification per leg; "no qualifying opportunity" prominent.
- Responsible gambling: visible disclaimer, bankroll context, no stake-size encouragement; link in footer + rollover + betting-agent.

## 10. Implementation order (updated)

1. Chart-lib decision + shared components (DataTable, ProbabilityCell, badges, DataQuality).
2. Token-drift audit sweep + state-coverage pass on user routes.
3. Dashboard rebuild (rollover card can use real engine v1 now).
4. Match Intelligence page → Predictions upgrade → Analytics → Results consolidation.
5. Rollover UI spec-completeness (v2 engine lands Phase 3).
6. Admin reorganization (per admin plan, Phase 4).
7. Marketing copy rewrite (verified claims only, after F-19 metrics).
8. Mobile pass + a11y checklist verification (can run parallel from step 2).
