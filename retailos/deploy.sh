#!/usr/bin/env bash
#
# RetailOS VPS deploy script
# -------------------------------------------------------------------
# Runs steps 1-5 of a deploy in order: pull -> install -> build ->
# ensure writable data dirs -> restart the Node process (PM2).
#
# FIRST TIME: edit the three CONFIG values below to match your VPS,
# then make it executable once:  chmod +x deploy.sh
# Every deploy after that:        ./deploy.sh
#
# It is safe to re-run. It never touches your live database or the
# imports/photos folders' contents (those are git-ignored).
# -------------------------------------------------------------------

set -euo pipefail

# ── CONFIG (edit these once) ────────────────────────────────────────
# Absolute path to the retailos app folder on the VPS (the folder that
# contains package.json and server.js).
APP_DIR="/var/www/ReporterOS/retailos"

# Git branch to deploy.
BRANCH="main"

# PM2 process name for the Node server. If it does not exist yet, the
# script will create it on first run.
PM2_NAME="retailos"
# ────────────────────────────────────────────────────────────────────

log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

[ -d "$APP_DIR" ] || fail "APP_DIR does not exist: $APP_DIR (edit the CONFIG section)"
cd "$APP_DIR"
[ -f package.json ] || fail "package.json not found in $APP_DIR — is APP_DIR correct?"

# 1) Pull the latest code -------------------------------------------------------
log "1/5 Pulling latest code ($BRANCH)"
git fetch --all --prune
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"
echo "Now at: $(git rev-parse --short HEAD) - $(git log -1 --pretty=%s)"

# 2) Install dependencies -------------------------------------------------------
log "2/5 Installing dependencies"
if [ -f package-lock.json ]; then
  npm ci
else
  npm install
fi

# 3) Build the frontend ---------------------------------------------------------
log "3/5 Building frontend (vite build -> dist/)"
npm run build
[ -d dist ] || fail "Build did not produce a dist/ folder"

# 4) Ensure data dirs exist and are writable ------------------------------------
log "4/5 Ensuring data directories are writable"
# DATA_DIR defaults to the app folder if not set in the environment.
DATA_DIR="${DATA_DIR:-$APP_DIR}"
mkdir -p "$DATA_DIR/imports" "$DATA_DIR/photos"
for d in "$DATA_DIR/imports" "$DATA_DIR/photos"; do
  if [ -w "$d" ]; then
    echo "writable: $d"
  else
    fail "Not writable: $d — fix ownership, e.g. sudo chown -R \$(whoami) \"$DATA_DIR\""
  fi
done
# Warn (do not fail) if the DB file exists but is not writable.
if [ -e "$DATA_DIR/retailos.db" ] && [ ! -w "$DATA_DIR/retailos.db" ]; then
  echo "WARNING: $DATA_DIR/retailos.db is not writable by this user"
fi

# 5) Restart the Node process (PM2) ---------------------------------------------
log "5/5 Restarting the Node server via PM2"
command -v pm2 >/dev/null 2>&1 || fail "pm2 not found. Install with: npm install -g pm2"
if pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
  # NODE_ENV=production is enforced so production logging/error handling kick in.
  pm2 restart "$PM2_NAME" --update-env
else
  log "PM2 process '$PM2_NAME' not found — starting it for the first time"
  NODE_ENV=production pm2 start server.js --name "$PM2_NAME"
fi
pm2 save

log "Deploy complete. Recent server logs:"
pm2 logs "$PM2_NAME" --lines 20 --nostream || true

cat <<'NOTE'

------------------------------------------------------------------
Reminder: the Node app serves both the API and the built site on
PORT (default 3001). nginx must proxy to it AND allow big uploads.
If you have not already, set this in your nginx server block:

    client_max_body_size 50m;
    proxy_read_timeout    300s;
    proxy_send_timeout    300s;

    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

Then test + reload:  sudo nginx -t && sudo systemctl reload nginx

Required env (set in PM2 or the panel, then re-run this script):
    NODE_ENV=production  JWT_SECRET=...  CORS_ORIGINS=...  [DATA_DIR=...]
------------------------------------------------------------------
NOTE
