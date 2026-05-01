#!/usr/bin/env bash
set -euo pipefail

# Deploy script for cue-bot.
# Run from server: ./scripts/deploy.sh

cd "$(dirname "$0")/.."

SERVICE_NAME="cue-bot.service"
BACKUP_DIR="$HOME/backups"
BRANCH="master"

echo "==> [1/6] Pulling $BRANCH"
git fetch origin
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

echo "==> [2/6] Installing dependencies"
npm ci
npm ci --prefix admin

echo "==> [3/6] Backing up database"
mkdir -p "$BACKUP_DIR"
DB_URL=$(grep '^DATABASE_URL=' .env | cut -d= -f2- | sed -e 's/^["'\'']//' -e 's/["'\'']$//')
if [ -z "$DB_URL" ]; then
  echo "ERROR: DATABASE_URL not found in .env" >&2
  exit 1
fi
BACKUP_FILE="$BACKUP_DIR/cuebot-$(date +%F-%H%M).sql"
pg_dump "$DB_URL" > "$BACKUP_FILE"
echo "    Backup: $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))"

echo "==> [4/6] Running migrations"
npm run db:migrate

echo "==> [5/6] Building"
npm run build
npm run build:admin

echo "==> [6/6] Restarting $SERVICE_NAME"
sudo systemctl restart "$SERVICE_NAME"
sleep 1
sudo systemctl status "$SERVICE_NAME" --no-pager -l | head -15

echo
echo "==> Done. Tail logs with: journalctl -u $SERVICE_NAME -f"
