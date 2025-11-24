# SmartFeed Web

Mobile-inspired web app that surfaces the latest generated feed items once a user authenticates with Supabase. Built with Vite, React, and the Supabase JavaScript client so it can be deployed as a static site (e.g. GitHub Pages).

## Features
- Email/password authentication powered by Supabase Auth.
- Responsive layout tailored for mobile breakpoints, complete with avatars and soft-card styling.
- Pulls the 40 most recent entries from the `feed_items` table including title, TL;DR, and full content.
- Refresh control plus sign-out management without leaving the single-page experience.

## Prerequisites
- Node.js 18+
- Supabase project URL and anon key
- Feed tables and edge functions already deployed in the linked `SmartFeed` project

## Environment variables
Create a `.env.local` file in this folder before running or building:

```
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_ANON_KEY
```

When deploying via GitHub Pages (or any static host), expose the same values as build-time environment variables so Vite can inline them.

## Development
```bash
cd app
npm install        # already run once, repeat if deps change
npm run dev        # starts Vite server on http://localhost:5173
```
The dev server supports hot module replacement so UI changes appear immediately.

## Building & previewing
```bash
npm run build      # outputs static assets into dist/
npm run preview    # locally serve the production build
```

## Deploying to GitHub Pages
1. Configure Supabase Auth redirect hosts to include your GitHub Pages domain (e.g. `https://<user>.github.io/app`).
2. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as encrypted secrets in GitHub.
3. Use an action such as [`peaceiris/actions-gh-pages`](https://github.com/peaceiris/actions-gh-pages) or `crazy-max/ghaction-github-pages` to build (`npm ci && npm run build`) and push `dist/` to the `gh-pages` branch.
4. Enable GitHub Pages to serve from that branch. Vite’s default configuration works without additional changes unless you host from a subdirectory—set `base` in `vite.config.ts` to match if needed.

## Supabase configuration checklist
- Auth → URL configuration includes the GitHub Pages domain in `additional_redirect_urls`.
- Row Level Security policies allow authenticated users to `select` from `feed_items`.
- Edge function `generate-weighted-feed-item` continues to populate `title`, `tldr`, and `history`.

## Folder structure
```
app/
  src/
    App.tsx          # main authenticated & unauthenticated flows
    App.css          # mobile-first visual styles
    lib/supabaseClient.ts
    index.css        # global tokens
    main.tsx
  vite.config.ts
```

Happy shipping! Let me know if you’d like onboarding flows, offline caching, or push-style updates next.
