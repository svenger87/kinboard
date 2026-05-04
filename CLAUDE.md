# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build and Development Commands

All commands run from the `webapp/` directory:

```bash
npm install          # Install dependencies
npm run dev          # Start development server (http://localhost:3000)
npm run build        # Production build
npm run lint         # Run ESLint
npm run start        # Start production server
```

Generate Supabase types after schema changes:
```bash
npm run db:generate  # Generates src/lib/database.types.ts
```

## Architecture Overview

### Tech Stack
- **Framework**: Next.js 14 with App Router
- **UI**: shadcn/ui components + Tailwind CSS
- **State**: TanStack Query (server state) + Zustand (client state)
- **Backend**: Self-hosted Supabase (PostgreSQL + Realtime)
- **Animations**: Framer Motion

### Data Flow
1. **Family-scoped data**: All data is scoped to a `family_id`. Devices join families via 6-character join codes.
2. **Real-time sync**: Supabase Realtime (WebSocket) for instant cross-device updates. See `use-realtime.ts`.
3. **External integrations**: API routes proxy requests to external services (Google Calendar, Home Assistant, Immich, Bring!, OpenWeatherMap).

### Key Directories

```
webapp/src/
├── app/                    # Next.js App Router
│   ├── api/               # API routes (proxies to external services)
│   │   ├── google/        # Google Calendar OAuth + sync
│   │   ├── homeassistant/ # Home Assistant REST API proxy
│   │   ├── immich/        # Photo server integration
│   │   └── bring/         # Shopping list integration
│   ├── settings/          # Settings pages per integration
│   └── [feature]/page.tsx # Feature pages (calendar, weather, energie, etc.)
├── components/
│   ├── ui/                # shadcn/ui primitives (don't modify directly)
│   ├── widgets/           # Dashboard widgets (clock, weather, events)
│   └── home-assistant/    # Home Assistant entity cards and energy dashboard
├── hooks/                 # React hooks for data fetching and state
│   ├── use-realtime.ts    # Supabase realtime subscriptions
│   ├── use-home-assistant.ts # HA entity states and services
│   └── use-supabase-queries.ts # TanStack Query hooks for Supabase
├── stores/                # Zustand stores
│   └── family-store.ts    # Current family/device context
└── lib/
    ├── supabase/          # Supabase client (browser + server)
    └── utils.ts           # Utilities including monthly theme logic
```

### Database Schema

Core tables in `docker/init.sql`:
- `families` - Top-level entity with join_code
- `devices` - Devices connected to families
- `people` - Family members with colors
- `calendars` / `events` - Google Calendar sync
- `settings` - Key-value store per family (weather, integrations config)

All tables use Row Level Security (RLS) scoped by `family_id`.

### External Service Integrations

| Service | Config Location | API Routes |
|---------|-----------------|------------|
| Google Calendar | `settings/google/` | `api/google/*` |
| Home Assistant | `settings/homeassistant/` | `api/homeassistant/*` |
| Immich (photos) | `settings/immich/` | `api/immich/*` |
| Bring! (shopping) | `settings/bring/` | `api/bring/*` |
| OpenWeatherMap | `settings/weather/` | `api/weather/*` |

### Energy Dashboard

The `/energie` page displays solar/battery/grid power flow for Zendure SolarFlow systems:
- Power values (W) come from real-time HA sensor states
- Energy totals (kWh) use HA statistics API for daily deltas (cumulative sensors)
- Home consumption calculated as: `Grid Import + Solar - Battery Charge`

### Monthly Themes

App colors change automatically by month. Theme logic in `lib/utils.ts` via `getMonthTheme()`. CSS variables defined in `globals.css`.

## Deployment

Docker deployment via `webapp/docker/`:
```bash
cd docker
docker-compose up -d
```

The `deploy.sh` script handles tar-based sync to Unraid servers.

## After changes
Only do Linter check. Do not run npm build as is breaks the dev server
