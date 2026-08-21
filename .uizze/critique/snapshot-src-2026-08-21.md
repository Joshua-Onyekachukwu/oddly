---
target: src
slug: src
total_score: 24
max_score: 40
na_heuristics: ""
p0_count: 0
p1_count: 3
p2_count: 2
p3_count: 1
date: 2026-08-21
---

# Uizze Critique: ODDLY Application (src)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Loading skeletons work, but no progress indicators for data sync/cron operations in admin |
| 2 | Match Between System and Real World | 3 | Betting terminology well-handled with tooltips; "Golden Picks" is clear |
| 3 | User Control and Freedom | 3 | Filters have clear/reset; match detail drawer has close; nav has back-to-app |
| 4 | Consistency and Standards | 2 | Match cards, prediction cards, admin cards use different card patterns; spacing inconsistent between dashboard and admin |
| 5 | Error Prevention | 2 | No confirmation before destructive actions in admin; accumulator max 10 legs enforced but no warning before hitting limit |
| 6 | Recognition Rather Than Recall | 3 | Team logos + league badges help recognition; BettingTooltip on all market terms |
| 7 | Flexibility and Efficiency of Use | 2 | No keyboard shortcuts; no bulk actions in admin; no drag-to-reorder accumulator legs |
| 8 | Aesthetic and Minimalist Design | 3 | Landing page is clean and premium; dashboard cards are information-dense but well-organized; admin accuracy page is cluttered |
| 9 | Error Recovery | 2 | Error states exist but generic ("Something went wrong"); no retry on failed logo images; admin has no undo for settings changes |
| 10 | Help and Documentation | 1 | No contextual help beyond BettingTooltip; no guided tours; no help section in admin; FAQ is landing-only |

**Total: 24/40 — Acceptable**

## Priority Issues

### [P1] Inconsistent card/spacing system across surfaces
The match card uses rounded-[14px], px-[14px], gap-[12px]. The prediction card uses rounded-[16px], p-[16px], gap-[10px]. The admin accuracy page uses rounded-[14px] but with different padding. The accumulator builder uses rounded-[10px] for inner items. This inconsistency makes the app feel like 3 different products.

### [P1] Admin sidebar is visually disconnected from dashboard
The admin sidebar has a white background with dark active states. The user dashboard sidebar uses a dark navy background with lime accents. These are visually opposite.

### [P1] Admin accuracy page is a data wall without hierarchy
The accuracy page loads 1000+ predictions and computes stats client-side. The result is a wall of numbers at equal visual weight with no way to quickly understand model performance.

### [P2] Landing page has no dark mode toggle for dashboard preview
The landing page hero shows a dashboard preview image but the actual dashboard is dark-themed. The landing page itself is light. Users experience a jarring theme switch.

### [P2] Match card hover animation uses transition-all
The MatchCard uses transition-all duration-300 which transitions every property including layout-triggering ones.

### [P3] Emoji used as icons in stat cards
The predictions page uses emoji as stat card icons. The rest of the app uses Remix Icons consistently.
