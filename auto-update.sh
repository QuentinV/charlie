#!/usr/bin/env bash

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$SCRIPT_DIR"
UPDATE_SCRIPT="$REPO_DIR/update.sh"

cd "$REPO_DIR" || exit 1

OUTPUT=$(git pull)

if echo "$OUTPUT" | grep -q "Already up to date"; then
    echo "$(date): Repository already up to date."
    exit 0
fi

echo "$(date): Repository updated. Running update script..."
if [ -x "$UPDATE_SCRIPT" ]; then
    "$UPDATE_SCRIPT"
else
    echo "Update script not found or not executable: $UPDATE_SCRIPT"
fi
