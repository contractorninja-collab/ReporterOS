# LeadGen

AI-powered lead generation tool. Type a natural-language prompt
("Find CMOs at fintech startups in London with phone numbers") and the app
will:

1. Translate the prompt into several targeted Google search queries
2. Scrape the SERP using Playwright with stealth anti-detection
3. Visit each result's contact / about / team pages
4. Extract emails, phones, names, titles, and social links via regex + heuristics
5. Stream every lead back to the browser in real time via SSE
6. Let you export everything as a CSV

## Stack

- React 19 + Vite 8 + Tailwind 4
- Express 5 + SQLite (better-sqlite3)
- Playwright + stealth plugin for scraping
- Zustand for state, Papa Parse for CSV

## Run

```bash
npm install
# Playwright Chromium is installed automatically via postinstall.
npm run dev:full     # Runs API (3002) and Vite (5174) together
```

Open http://localhost:5174

## Build for production

```bash
npm run build        # outputs to dist/
npm run server       # serves dist/ + API on port 3002
```

## Environment

| Variable | Default | Notes |
|---|---|---|
| PORT | 3002 | API port |
| LISTEN_HOST | 0.0.0.0 | Bind interface |

## Notes / Legal

Web scraping has legal and ethical implications. Use this tool only on
sources where doing so is permitted, and respect site Terms of Service and
local privacy laws (GDPR, CCPA, CAN-SPAM, etc.). The tool throttles
requests and rotates user-agents but is intended for research, not abuse.
