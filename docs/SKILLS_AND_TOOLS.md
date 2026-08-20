# ODDLY — Complete Skills & Tools Reference

**All packages, services, and tools needed for the full project.**

---

## 1. Frontend Stack

### Core Framework
| Package | Version | Purpose | Status |
|---------|---------|---------|--------|
| `next` | 15.3.2 | React framework with App Router | ✅ Installed |
| `react` | 19.x | UI library | ✅ Installed |
| `react-dom` | 19.x | React DOM renderer | ✅ Installed |
| `typescript` | 5.7+ | Type safety | ✅ Installed |

### Styling
| Package | Version | Purpose | Status |
|---------|---------|---------|--------|
| `tailwindcss` | 4.x | Utility-first CSS | ✅ Installed |
| `@tailwindcss/postcss` | 4.x | PostCSS integration | ✅ Installed |
| `clsx` | 2.1+ | Conditional classnames | ✅ Installed |
| `tailwind-merge` | 2.6+ | Merge Tailwind classes | ✅ Installed |
| `sass` | 1.83+ | SCSS support | ✅ Installed |

### UI Components & Icons
| Package | Version | Purpose | Status |
|---------|---------|---------|--------|
| `@headlessui/react` | 2.2+ | Accessible UI components | ✅ Installed |
| `lucide-react` | latest | Beautiful icons | ✅ Installed |
| `remixicon` | 4.6+ | Remix icon set | ✅ Installed |
| `material-symbols` | 0.31+ | Material Design icons | ✅ Installed |
| `swiper` | 11.2+ | Touch slider/carousel | ✅ Installed |

### Animation & Effects
| Package | Version | Purpose | Status |
|---------|---------|---------|--------|
| `framer-motion` | 11.15+ | Animations & gestures | ✅ Installed |
| `sonner` | latest | Toast notifications | ✅ Installed |

### Data & State
| Package | Version | Purpose | Status |
|---------|---------|---------|--------|
| `zustand` | 5.x | Client state management | ✅ Installed |
| `swr` | 2.3+ | Data fetching & caching | ✅ Installed |
| `date-fns` | 4.1+ | Date manipulation | ✅ Installed |

### Forms & Validation
| Package | Version | Purpose | Status |
|---------|---------|---------|--------|
| `react-hook-form` | latest | Form management | ✅ Installed |
| `@hookform/resolvers` | latest | Validation resolvers | ✅ Installed |
| `zod` | latest | Schema validation | ✅ Installed |

### Charts & Visualization
| Package | Version | Purpose | Status |
|---------|---------|---------|--------|
| `recharts` | 2.15+ | React charting library | ✅ Installed |
| `apexcharts` | 4.7+ | Advanced charts | ✅ Installed |
| `react-apexcharts` | 1.7+ | React wrapper for ApexCharts | ✅ Installed |

### Auth & Security
| Package | Version | Purpose | Status |
|---------|---------|---------|--------|
| `jose` | 6.x | JWT handling | ✅ Installed |
| `@supabase/auth-helpers-nextjs` | latest | Next.js auth helpers | ✅ Installed |
| `@supabase/auth-helpers-react` | latest | React auth helpers | ✅ Installed |

---

## 2. Backend & Database

### Supabase
| Package | Version | Purpose | Status |
|---------|---------|---------|--------|
| `@supabase/supabase-js` | 2.49+ | Supabase client | ✅ Installed |
| `@supabase/ssr` | 0.6+ | Server-side rendering support | ✅ Installed |
| `supabase` (CLI) | latest | Database migrations | 🔧 Needs install |

### Services Required
| Service | Purpose | Cost |
|---------|---------|------|
| **Supabase** | Database, Auth, Realtime, Storage | Free tier (500MB DB, 50K MAU) |
| **Vercel** | Hosting & deployment | Free tier (100GB bandwidth) |
| **NVIDIA NIM** | AI model inference (8-10 API keys) | Free tier |
| **The Odds API** | Multi-bookmaker odds | Free (500 req/month) |
| **API-Football** | Fixtures, stats, standings | Free (100 req/day) |
| **Football-Data.org** | Fixtures, results | Free (10 req/min) |

---

## 3. Python ML Stack

### Core ML
| Package | Purpose | Install |
|---------|---------|---------|
| `numpy` | Numerical computing | `pip install numpy` |
| `scipy` | Scientific computing (Dixon-Coles fitting) | `pip install scipy` |
| `scikit-learn` | Machine learning utilities | `pip install scikit-learn` |
| `xgboost` | Gradient boosting model | `pip install xgboost` |
| `pandas` | Data manipulation | `pip install pandas` |

### Data Collection
| Package | Purpose | Install |
|---------|---------|---------|
| `httpx` | Async HTTP client | `pip install httpx` |
| `supabase` | Python Supabase client | `pip install supabase` |
| `beautifulsoup4` | Web scraping | `pip install beautifulsoup4` |

### GitHub Actions
- Free cron-based scheduling
- 2,000 minutes/month (free tier)
- Runs daily predict, settle, learn, retrain

---

## 4. Development Tools

### Already Installed ✅
| Tool | Purpose |
|------|---------|
| `typescript` | Type checking |
| `eslint` | Code linting |
| `eslint-config-next` | Next.js ESLint rules |
| `prettier` | Code formatting |
| `husky` | Git hooks |
| `lint-staged` | Pre-commit linting |
| `jest` | Unit testing |
| `@testing-library/react` | React component testing |
| `@testing-library/jest-dom` | DOM testing utilities |
| `jest-environment-jsdom` | Browser environment for tests |
| `ts-node` | TypeScript execution |
| `@types/jest` | Jest type definitions |
| `ts-jest` | TypeScript preprocessor for Jest |
| `next-sitemap` | Sitemap generation |

---

## 5. What's NOT Needed (Cost Avoidance)

| Service | Why Not | Alternative |
|---------|---------|-------------|
| Paid AI model hosting | NVIDIA NIM free tier covers it | Free API keys |
| Paid database | Supabase free tier covers it | Free tier |
| Paid hosting | Vercel free tier covers it | Free tier |
| GPU compute | Models run on CPU (GitHub Actions) | Free |
| Betfair/Pinnacle API | Phase 7+ (future) | Free odds sources for now |
| OpenWeatherMap API | Can add later for weather features | Free tier available |
| paid odds feeds | The Odds API free tier covers start | Upgrade later |

---

## 6. Quick Install Commands

```bash
# Frontend dependencies (already installed)
npm install

# Python ML stack (for worker/ directory)
pip install numpy scipy scikit-learn xgboost pandas httpx supabase beautifulsoup4

# Supabase CLI (for migrations)
npm install -g supabase
# or
npx supabase --version

# Development
npm run dev          # Start dev server
npm run build        # Production build
npm run type-check   # TypeScript check
npm test             # Run tests
```

---

## 7. Environment Variables Required

### Frontend (.env.local)
```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# NVIDIA NIM (8-10 keys for rotation)
NVIDIA_API_KEY_1=your-key-1
NVIDIA_API_KEY_2=your-key-2
# ... up to NVIDIA_API_KEY_10

# APIs
ODDS_API_KEY=your-odds-api-key
API_FOOTBALL_KEY=your-api-football-key
```

### GitHub Actions Secrets
```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
NVIDIA_API_KEY_1=your-key-1
# ... etc
```

---

## 8. Supabase API Keys

Set these in your `.env.local` file (never commit real keys).

| Key | Env Variable | Status |
|-----|-------------|--------|
| Publishable (anon) | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Set in .env.local |
| Secret (service role) | `SUPABASE_SERVICE_ROLE_KEY` | Set in .env.local |
| Project Ref | — | Set in Supabase dashboard |

### Before Going Live — Change These:
1. ✅ Supabase publishable key (anon key)
2. ✅ Supabase secret key (service role key)
3. ✅ Generate new JWT secret
4. ✅ Enable RLS on all tables
5. ✅ Set up proper auth settings
6. ✅ Add rate limiting
