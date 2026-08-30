#!/bin/bash
# Recurring commit/push helper for the family-hub repo.
# Usage:
#   ./git.sh "commit message"     -> commit only these files, then push
#   ./git.sh                      -> uses a timestamped default message
#
# Only adds the known app files by name (never `git add -A`) so a local
# backup JSON, SETTINGS-CHEATSHEET.md, or anything else stray never gets
# swept into a commit by accident — this repo is public.

set -e
cd "$(dirname "$0")"

FILES=(index.html app.js manifest.json sw.js icon-192.png icon-512.png SETUP.md .gitignore public_client.py git.sh)

echo "== Fetching origin to check you're up to date =="
git fetch origin
if ! git merge-base --is-ancestor origin/main HEAD 2>/dev/null && ! git merge-base --is-ancestor HEAD origin/main 2>/dev/null; then
  : # unrelated histories edge case, let the pull below surface any real problem
fi
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)
if [ "$LOCAL" != "$REMOTE" ]; then
  echo "== Local main differs from origin/main — pulling first (fast-forward only) =="
  if ! git pull --ff-only origin main; then
    echo "!! Pull failed (probably diverged history, e.g. someone edited via GitHub's web UI)."
    echo "!! Resolve manually before running this script again — nothing was committed."
    exit 1
  fi
fi

echo "== Staging known project files =="
STAGED_ANY=0
for f in "${FILES[@]}"; do
  if [ -f "$f" ]; then
    git add "$f"
    STAGED_ANY=1
  fi
done

if [ "$STAGED_ANY" -eq 0 ] || git diff --cached --quiet; then
  echo "Nothing to commit — working tree matches the last commit."
  exit 0
fi

echo "== Changes to be committed =="
git status --short

MSG="${1:-Update $(date '+%Y-%m-%d %H:%M')}"
git commit -m "$MSG"

echo "== Pushing to origin/main =="
git push origin main

echo "== Done =="
git status --short
