#!/bin/bash
# ============================================================================
# START-QUIZFORGE — double-click this file to launch your QuizForge website.
# ============================================================================
# What it does:
#   1. Goes into the quizforge app folder.
#   2. Installs anything missing (only the first time — it's instant after that).
#   3. Starts the Next.js dev server.
#   4. Opens http://localhost:3000 in your browser.
#
# To STOP the website later: come back to this Terminal window and press
# Control + C, or just close the window.
# ============================================================================

# cd to the folder this script lives in (so it works no matter where it's run).
cd "$(dirname "$0")" || exit 1

echo "🚀 Starting QuizForge..."
echo "   Folder: $(pwd)"
echo ""

# Install dependencies only if node_modules is missing (first run / after a clean).
if [ ! -d "node_modules" ]; then
  echo "📦 First-time setup: installing packages (one-time, ~30s)..."
  npm install
  echo ""
fi

# Open the browser a few seconds after the server starts (give it time to boot).
( sleep 4 && open "http://localhost:3000" ) &

echo "🌐 Your site will open at http://localhost:3000 in a moment."
echo "   (Keep this window open while you use the site. Press Control+C to stop.)"
echo ""

# Start the dev server (this keeps running until you stop it).
npm run dev
