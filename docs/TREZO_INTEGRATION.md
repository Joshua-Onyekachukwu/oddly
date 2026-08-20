# Trezo Template Integration Plan for ODDLY

**Version:** 1.0
**Date:** 19 August 2026

---

## Executive Summary

This document outlines how to integrate the Trezo admin dashboard and landing page templates into the ODDLY betting intelligence platform. The goal is to use Trezo as a **design reference and component library** rather than copying wholesale — adapting patterns, components, and styling to match the ODDLY brand identity.

---

## 1. Template Analysis

### 1.1 Admin Dashboard Template

**Location:** `Trezo/admin templae/react-nextjs-tailwindcss/`

| Aspect | Details |
|--------|---------|
| **Framework** | Next.js 15.3.1 (App Router) |
| **Styling** | Tailwind CSS 4 + SASS |
| **UI Library** | Headless UI 2.2.2 |
| **Charts** | ApexCharts 4.7.0 |
| **Icons** | Material Symbols + Remix Icons |
| **Components** | 40+ component categories |
| **Pages** | 50+ page templates |

#### Key Components Available

| Category | Components | ODDLY Usage |
|----------|------------|-------------|
| **Layout** | SidebarMenu, Header, Footer | ✅ Admin panel layout |
| **Dashboard** | 30 variants (SaaS, Finance, CRM, etc.) | ⚠️ Customize for betting |
| **Charts** | Area, Line, Column, Pie, Radar, RadialBar | ✅ Model performance, P&L |
| **Tables** | DataTable, RecentOrders, ToDoList | ✅ Predictions, user bets |
| **Forms** | Input, Checkboxes, RichTextEditor | ✅ Settings, config |
| **UI Elements** | Accordion, Alerts, Badges, Buttons, Modal | ✅ All pages |
| **Users** | UsersList, AddUser, TeamMembers | ✅ Admin user management |
| **Settings** | Full settings pages | ✅ Platform settings |

#### Architecture Pattern

```
src/
├── app/
│   ├── layout.tsx          # Root layout with metadata
│   ├── dashboard/          # 30 dashboard variants
│   ├── authentication/     # Sign in/up/forgot password
│   ├── users/              # User management
│   ├── settings/           # Settings pages
│   └── ...
├── components/
│   ├── Layout/             # Sidebar, Header, Footer
│   ├── Dashboard/          # Dashboard widgets
│   ├── Charts/             # Chart components
│   ├── Tables/             # Table components
│   ├── Forms/              # Form components
│   └── UIElements/         # Reusable UI components
└── providers/
    └── LayoutProvider.tsx  # Layout state management
```

### 1.2 SaaS Landing Page Template

**Location:** `Trezo/react-nextjs-tailwindcss/saas-landing/`

| Aspect | Details |
|--------|---------|
| **Framework** | Next.js 15.3.2 (App Router) |
| **Styling** | Tailwind CSS 4 |
| **Icons** | Material Symbols + Remix Icons |
| **Components** | Hero, Features, Pricing, Testimonials |
| **Pages** | Home, Features, Pricing, Use Cases |

#### Key Sections Available

| Section | Component | ODDLY Usage |
|---------|-----------|-------------|
| **Hero** | HeroBanner.tsx | ✅ Main landing hero |
| **About** | About.tsx | ✅ Platform overview |
| **Features** | UsefulFeatures.tsx | ✅ Prediction features |
| **Dashboard Preview** | Dashboard.tsx | ✅ Admin preview |
| **Pricing** | PricingPlans.tsx | ✅ Subscription tiers |
| **Testimonials** | Testimonials.tsx | ✅ User testimonials |
| **Partners** | Partners.tsx | ✅ Bookmaker logos |
| **Fun Facts** | FunFacts.tsx | ✅ Stats counters |
| **CTA** | FreeTrail.tsx | ✅ Sign up CTA |

#### Navigation Pattern

```tsx
const menuItems = [
  { label: "Home", href: "/" },
  { label: "Features", href: "/features/" },
  { label: "Dashboard", href: "/dashboard", isExternal: true },
  { label: "Use Cases", href: "/use-cases/" },
  { label: "Pricing", href: "/pricing/" },
];
```

---

## 2. Integration Strategy

### 2.1 Approach: Adapt, Don't Copy

**DO:**
- Extract component patterns and styling approaches
- Use the layout system (sidebar, header, footer) as a base
- Reuse chart configurations and table patterns
- Adapt color schemes to ODDLY brand

**DON'T:**
- Copy entire template wholesale
- Keep all 30+ dashboard variants (we need ~5)
- Use all 40+ component categories (we need ~15)
- Keep unrelated pages (hotel, restaurant, etc.)

### 2.2 Version Alignment

| Component | Trezo Version | ODDLY Current | Action |
|-----------|---------------|---------------|--------|
| Next.js | 15.3.x | 14.2.x | ⬆️ Upgrade to 15 |
| React | 19.x | 18.x | ⬆️ Upgrade to 19 |
| Tailwind CSS | 4.x | 3.4.x | ⬆️ Upgrade to 4 |
| TypeScript | 5.x | 5.5.x | ✅ Compatible |

### 2.3 Component Mapping

#### ODDLY Admin Panel → Trezo Components

| ODDLY Page | Trezo Reference | Customization Needed |
|------------|-----------------|----------------------|
| **Admin Dashboard** | Dashboard/Saas/ | Replace charts with betting metrics |
| **User Management** | Users/ | Add role-based access (user/admin) |
| **Model Health** | Dashboard/Analytics/ | Custom charts for calibration |
| **Data Pipeline** | Dashboard/ProjectManagement/ | Pipeline status tracking |
| **Scoring Config** | Forms/ | Custom scoring weight sliders |
| **AI Monitor** | Dashboard/CryptoTrader/ | NVIDIA API usage tracking |
| **Announcements** | Tables/RecentOrders/ | Content management |
| **Settings** | Settings/ | Platform configuration |

#### ODDLY User Dashboard → Trezo Components

| ODDLY Page | Trezo Reference | Customization Needed |
|------------|-----------------|----------------------|
| **Dashboard Home** | Dashboard/Saas/ | Betting-specific metrics |
| **Matches** | Tables/ | Prediction cards |
| **Match Detail** | Dashboard/Finance/ | Detailed probability breakdown |
| **Accumulator Builder** | Forms/ + Tables/ | Slip builder UI |
| **AI Chat** | Apps/Chat/ | Chat interface with streaming |
| **Tracking/P&L** | Dashboard/Sales/ | Profit/loss charts |
| **Rollover Challenge** | Dashboard/ProjectManagement/ | Chain progress UI |

#### ODDLY Landing Page → Trezo Components

| ODDLY Section | Trezo Reference | Customization Needed |
|---------------|-----------------|----------------------|
| **Hero** | HeroBanner | Betting-focused copy |
| **How It Works** | UsefulFeatures | Prediction pipeline |
| **Features** | About + Features | Model capabilities |
| **Dashboard Preview** | Dashboard | ODDLY dashboard screenshot |
| **Pricing** | PricingPlans | 3 tiers (Free/Premium/Elite) |
| **Testimonials** | Testimonials | Betting community quotes |
| **Stats** | FunFacts | Prediction accuracy stats |
| **CTA** | FreeTrail | "Start Winning" CTA |

---

## 3. Implementation Plan

### Phase 1: Foundation (Week 1)

```bash
# 1. Upgrade dependencies
npm install next@15 react@19 react-dom@19
npm install tailwindcss@4 @tailwindcss/postcss@4
npm install @headlessui/react apexcharts react-apexcharts

# 2. Update configuration
# - next.config.ts (remove static export, add Sass)
# - tailwind.config.js → tailwind.config.ts (v4 format)
# - postcss.config.js → postcss.config.mjs

# 3. Create base layout
# - Adapt LayoutProvider.tsx
# - Create SidebarMenu for ODDLY
# - Create Header with ODDLY branding
```

### Phase 2: Admin Panel (Weeks 2-3)

```bash
# 1. Create admin layout
src/app/admin/layout.tsx          # Admin layout wrapper
src/components/admin/Sidebar.tsx  # Admin sidebar
src/components/admin/Header.tsx   # Admin header

# 2. Create admin pages
src/app/admin/page.tsx            # Dashboard overview
src/app/admin/users/page.tsx      # User management
src/app/admin/model-health/page.tsx
src/app/admin/pipeline/page.tsx
src/app/admin/scoring/page.tsx
src/app/admin/ai-monitor/page.tsx
src/app/admin/announcements/page.tsx
src/app/admin/settings/page.tsx

# 3. Create admin components
src/components/admin/charts/      # Chart components
src/components/admin/tables/      # Table components
src/components/admin/forms/       # Form components
```

### Phase 3: User Dashboard (Weeks 3-4)

```bash
# 1. Create user layout
src/app/(dashboard)/layout.tsx    # User dashboard layout
src/components/dashboard/Sidebar.tsx
src/components/dashboard/Header.tsx

# 2. Create user pages
src/app/(dashboard)/page.tsx      # Dashboard home
src/app/(dashboard)/matches/page.tsx
src/app/(dashboard)/matches/[id]/page.tsx
src/app/(dashboard)/accumulator/page.tsx
src/app/(dashboard)/ai-chat/page.tsx
src/app/(dashboard)/tracking/page.tsx
src/app/(dashboard)/rollover/page.tsx
src/app/(dashboard)/performance/page.tsx
src/app/(dashboard)/settings/page.tsx
```

### Phase 4: Landing Page (Week 4)

```bash
# 1. Create landing layout
src/app/(marketing)/layout.tsx   # Landing page layout

# 2. Create landing sections
src/components/landing/Hero.tsx
src/components/landing/HowItWorks.tsx
src/components/landing/Features.tsx
src/components/landing/DashboardPreview.tsx
src/components/landing/Pricing.tsx
src/components/landing/Testimonials.tsx
src/components/landing/Stats.tsx
src/components/landing/CTA.tsx
src/components/landing/Footer.tsx
```

---

## 4. ODDLY Brand Customization

### 4.1 Color System

```css
/* Trezo Default */
--primary-500: #3B82F6;  /* Blue */
--primary-600: #2563EB;

/* ODDLY Brand */
--oddly-orange: #F97316;     /* Electric Orange */
--oddly-orange-dark: #EA580C;
--oddly-navy: #0F172A;       /* Deep Navy */
--oddly-navy-light: #1E293B;
--oddly-success: #10B981;
--oddly-warning: #F59E0B;
--oddly-danger: #EF4444;
```

### 4.2 Typography

```css
/* Keep Trezo's Inter font family */
--font-body: 'Inter', sans-serif;

/* Add monospace for odds display */
--font-mono: 'JetBrains Mono', monospace;
```

### 4.3 Component Styling

```tsx
// Trezo button pattern
<button className="rounded-[7px] bg-primary-500 text-white py-[11.5px] px-[25px]">

// ODDLY adapted
<button className="rounded-lg bg-oddly-orange text-white py-2.5 px-6 font-medium hover:bg-oddly-orange-dark transition-colors">
```

---

## 5. Key Patterns to Reuse

### 5.1 LayoutProvider Pattern

```tsx
// From Trezo - excellent pattern for layout state
const LayoutProvider = ({ children }) => {
  const [active, setActive] = useState(false);
  const toggleActive = () => setActive(!active);
  
  return (
    <div className={`main-content-wrap ${active ? "active" : ""}`}>
      <SidebarMenu toggleActive={toggleActive} />
      <Header toggleActive={toggleActive} />
      <div className="main-content">{children}</div>
    </div>
  );
};
```

### 5.2 Sidebar Accordion Pattern

```tsx
// From Trezo - accordion menu with active state
const [openIndex, setOpenIndex] = useState<number | null>(0);
const toggleAccordion = (index: number) => {
  setOpenIndex(prevIndex => prevIndex === index ? null : index);
};
```

### 5.3 Chart Configuration Pattern

```tsx
// From Trezo - ApexCharts configuration
const chartOptions = {
  chart: { type: 'area', toolbar: { show: false } },
  colors: ['#F97316'],  // ODDLY orange
  fill: { type: 'gradient' },
  // ...
};
```

### 5.4 Dark Mode Pattern

```tsx
// From Trezo - Tailwind dark mode
<div className="bg-white dark:bg-[#0c1427]">
  <span className="text-black dark:text-white">
```

---

## 6. Dependencies to Add

### From Trezo Admin

```json
{
  "@headlessui/react": "^2.2.2",
  "apexcharts": "^4.7.0",
  "react-apexcharts": "^1.7.0",
  "material-symbols": "^0.31.2",
  "remixicon": "^4.6.0",
  "tailwind-scrollbar": "^4.0.2"
}
```

### From Trezo Landing

```json
{
  "swiper": "^11.2.8"
}
```

### Additional ODDLY Needs

```json
{
  "@supabase/supabase-js": "^2.45.0",
  "@supabase/ssr": "^0.5.0",
  "zustand": "^4.5.0",
  "swr": "^2.2.0",
  "recharts": "^2.12.0",
  "framer-motion": "^11.3.0",
  "date-fns": "^3.6.0",
  "clsx": "^2.1.0",
  "tailwind-merge": "^2.4.0",
  "jose": "^5.6.0"
}
```

---

## 7. File Structure (Final)

```
oddly/
├── src/
│   ├── app/
│   │   ├── (marketing)/           # Landing pages
│   │   │   ├── layout.tsx
│   │   │   ├── page.tsx
│   │   │   ├── features/page.tsx
│   │   │   ├── pricing/page.tsx
│   │   │   └── use-cases/page.tsx
│   │   ├── (auth)/                # Auth pages
│   │   │   ├── login/page.tsx
│   │   │   ├── signup/page.tsx
│   │   │   └── forgot-password/page.tsx
│   │   ├── (dashboard)/           # User dashboard
│   │   │   ├── layout.tsx
│   │   │   ├── page.tsx
│   │   │   ├── matches/
│   │   │   ├── accumulator/
│   │   │   ├── ai-chat/
│   │   │   ├── tracking/
│   │   │   ├── rollover/
│   │   │   ├── performance/
│   │   │   └── settings/
│   │   ├── admin/                 # Admin panel
│   │   │   ├── layout.tsx
│   │   │   ├── page.tsx
│   │   │   ├── users/
│   │   │   ├── model-health/
│   │   │   ├── pipeline/
│   │   │   ├── scoring/
│   │   │   ├── ai-monitor/
│   │   │   ├── announcements/
│   │   │   └── settings/
│   │   ├── api/                   # API routes
│   │   │   ├── predictions/
│   │   │   ├── accumulator/
│   │   │   ├── ai-analyst/
│   │   │   ├── rollover/
│   │   │   ├── tracking/
│   │   │   └── admin/
│   │   ├── layout.tsx             # Root layout
│   │   └── globals.css
│   ├── components/
│   │   ├── ui/                    # Reusable UI (from Trezo)
│   │   │   ├── Accordion/
│   │   │   ├── Alerts/
│   │   │   ├── Badges/
│   │   │   ├── Buttons/
│   │   │   ├── Cards/
│   │   │   ├── Dropdowns/
│   │   │   ├── Forms/
│   │   │   ├── Modals/
│   │   │   ├── Pagination/
│   │   │   ├── Tables/
│   │   │   └── Tooltips/
│   │   ├── layout/                # Layout components
│   │   │   ├── Sidebar/
│   │   │   ├── Header/
│   │   │   └── Footer/
│   │   ├── landing/               # Landing page sections
│   │   │   ├── Hero.tsx
│   │   │   ├── Features.tsx
│   │   │   ├── Pricing.tsx
│   │   │   └── ...
│   │   ├── dashboard/             # Dashboard widgets
│   │   │   ├── MatchCard.tsx
│   │   │   ├── PredictionBadge.tsx
│   │   │   ├── OddsDisplay.tsx
│   │   │   ├── ProbabilityBar.tsx
│   │   │   ├── AccumulatorSlip.tsx
│   │   │   └── ...
│   │   ├── admin/                 # Admin components
│   │   │   ├── StatsCard.tsx
│   │   │   ├── ModelHealthChart.tsx
│   │   │   ├── PipelineStatus.tsx
│   │   │   └── ...
│   │   └── shared/                # Shared components
│   │       ├── BrandLogo.tsx
│   │       ├── LoadingSpinner.tsx
│   │       └── EmptyState.tsx
│   ├── lib/
│   │   ├── supabase/
│   │   │   ├── client.ts
│   │   │   ├── server.ts
│   │   │   └── middleware.ts
│   │   ├── nvidia/
│   │   │   └── client.ts
│   │   └── utils.ts
│   ├── hooks/
│   │   ├── useSupabase.ts
│   │   ├── usePredictions.ts
│   │   └── useAccumulator.ts
│   ├── store/
│   │   ├── accumulatorStore.ts
│   │   └── dashboardStore.ts
│   └── types/
│       └── index.ts
├── public/
│   ├── images/
│   │   ├── logo.svg
│   │   ├── logo-icon.svg
│   │   ├── banner.jpg
│   │   └── ...
│   └── favicon.ico
├── supabase/
│   ├── config.toml
│   └── migrations/
└── docs/
```

---

## 8. Migration Checklist

### Pre-Migration

- [ ] Backup current project files
- [ ] Create feature branch `feat/trezo-integration`
- [ ] Document current component usage

### Phase 1: Foundation

- [ ] Upgrade Next.js to v15
- [ ] Upgrade React to v19
- [ ] Upgrade Tailwind CSS to v4
- [ ] Install Trezo dependencies
- [ ] Update configuration files
- [ ] Test basic build

### Phase 2: Layout

- [ ] Create LayoutProvider (adapted from Trezo)
- [ ] Create SidebarMenu (ODDLY menu items)
- [ ] Create Header (ODDLY branding)
- [ ] Create Footer
- [ ] Test layout responsive behavior

### Phase 3: UI Components

- [ ] Adapt Button component
- [ ] Adapt Card component
- [ ] Adapt Table component
- [ ] Adapt Form components
- [ ] Adapt Modal component
- [ ] Adapt Badge component
- [ ] Create OddsDisplay component
- [ ] Create ProbabilityBar component
- [ ] Create MatchCard component

### Phase 4: Charts

- [ ] Install ApexCharts
- [ ] Create AreaChart component
- [ ] Create LineChart component
- [ ] Create BarChart component
- [ ] Create DonutChart component
- [ ] Create model performance chart
- [ ] Create P&L chart

### Phase 5: Pages

- [ ] Landing page (all sections)
- [ ] Auth pages (login, signup)
- [ ] Dashboard home
- [ ] Matches page
- [ ] Match detail page
- [ ] Accumulator builder
- [ ] AI chat page
- [ ] Tracking page
- [ ] Rollover page
- [ ] Performance page
- [ ] Admin dashboard
- [ ] Admin users
- [ ] Admin settings

### Phase 6: Testing

- [ ] Visual regression tests
- [ ] Responsive design tests
- [ ] Dark mode tests
- [ ] Accessibility tests
- [ ] Performance tests

---

## 9. Success Criteria

| Metric | Target |
|--------|--------|
| **Component Reuse** | 60%+ from Trezo patterns |
| **Build Time** | < 30 seconds |
| **Lighthouse Score** | 90+ |
| **Bundle Size** | < 200KB (initial) |
| **Mobile Responsive** | 100% pages |
| **Dark Mode** | Supported |
| **Accessibility** | WCAG 2.1 AA |

---

## 10. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Tailwind v4 breaking changes | High | Test incrementally, keep v3 fallback |
| React 19 compatibility | Medium | Test component rendering |
| Bundle size increase | Medium | Tree-shake unused Trezo components |
| Dark mode conflicts | Low | Standardize color tokens |
| Performance regression | Medium | Profile before/after |

---

**Next Step:** Begin Phase 1 - Foundation upgrade and dependency installation.
