# Kinboard - Next.js Web Application

A beautiful, real-time family calendar dashboard built with Next.js 14 and Supabase.

## Features

- **Real-time Sync** - Instant updates via Supabase Realtime (WebSocket)
- **Monthly Themes** - Automatic color scheme changes based on current month
- **Multi-device** - All devices are equal, no master/slave architecture
- **PWA Ready** - Install on any device as a Progressive Web App
- **Screensaver** - Beautiful photo slideshow when idle (Immich integration)
- **German Locale** - Built for German-speaking families

## Tech Stack

- **Framework**: Next.js 14 (App Router)
- **UI**: shadcn/ui + Tailwind CSS
- **Animation**: Framer Motion
- **State**: TanStack Query + Zustand
- **Backend**: Supabase (Self-Hosted)
- **Database**: PostgreSQL 15

## Getting Started

### Prerequisites

- Node.js 20+
- pnpm/npm/yarn
- Docker & Docker Compose (for self-hosted Supabase)

### Development

1. Install dependencies:
   ```bash
   npm install
   ```

2. Copy environment variables:
   ```bash
   cp .env.example .env.local
   ```

3. Start development server:
   ```bash
   npm run dev
   ```

4. Open [http://localhost:3000](http://localhost:3000)

### Production (Docker)

1. Navigate to docker directory:
   ```bash
   cd docker
   ```

2. Copy and configure environment:
   ```bash
   cp .env.example .env
   # Edit .env with your values
   ```

3. Start the stack:
   ```bash
   docker-compose up -d
   ```

4. Access the app at `http://your-server:3001`

## Project Structure

```
webapp/
├── docker/                 # What a git install runs: start.sh, compose files, migrations
│   ├── docker-compose.yml  # The stack
│   ├── init.sql           # Database schema
│   └── migrations/        # Schema changes, applied in order
├── image/                  # What the published images are built from
│   ├── Dockerfile         # Next.js production build (the webapp image)
│   ├── aio/               # kinboard-aio, the all-in-one image
│   └── postgres/          # kinboard-postgres
├── src/
│   ├── app/               # Next.js App Router pages
│   ├── components/
│   │   ├── ui/           # shadcn/ui components
│   │   └── widgets/      # Dashboard widgets
│   ├── hooks/            # React hooks
│   ├── lib/              # Utilities & Supabase clients
│   ├── stores/           # Zustand stores
│   └── types/            # TypeScript types
└── public/               # Static assets
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `POSTGREST_URL` | PostgREST's address for the server; the browser uses this server's own `/rest/v1` and needs no key |
| `OPENWEATHERMAP_API_KEY` | Weather API key; a family's own in Settings -> Weather wins |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID; a family's own in Settings -> Google Calendar wins |
| `GOOGLE_CLIENT_SECRET` | Google OAuth secret, the same |
| `PRESENCE_SENSOR_TOKEN` | Presence sensor token; a family's own in Settings -> Devices wins |

## Monthly Themes

The app automatically changes colors based on the current month:

| Month | Theme |
|-------|-------|
| January | Frost Blue |
| February | Rose Valentine |
| March | Spring Green |
| April | Cherry Blossom |
| May | Lilac |
| June | Ocean Blue |
| July | Sunflower |
| August | Coral |
| September | Amber |
| October | Pumpkin |
| November | Burgundy |
| December | Pine |

## Wall Display Setup

For kiosk mode on Raspberry Pi or Linux:

```bash
chromium-browser --kiosk --app=http://your-server:3001 \
  --disable-translate --disable-infobars --noerrdialogs
```

## License

PolyForm Noncommercial 1.0.0 — see [`LICENSE`](../LICENSE) and [`NOTICE`](../NOTICE).
