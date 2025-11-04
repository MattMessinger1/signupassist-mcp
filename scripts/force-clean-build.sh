#!/bin/bash

# Force Clean Build Script for Railway
# Removes all build artifacts and triggers a fresh rebuild

set -e  # Exit on error

echo "============================================"
echo "🏗️  Force Clean Railway Build"
echo "============================================"
echo ""
echo "This will:"
echo "  1. Remove dist/ and node_modules/"
echo "  2. Reinstall dependencies from scratch"
echo "  3. Compile TypeScript fresh"
echo "  4. Commit with timestamped message"
echo "  5. Push to trigger Railway rebuild"
echo ""

# Confirm action
read -p "Continue? (y/n) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "❌ Aborted"
    exit 1
fi

echo ""
echo "🧹 Step 1: Cleaning build artifacts..."
rm -rf dist node_modules
echo "✅ Removed dist/ and node_modules/"

echo ""
echo "📦 Step 2: Reinstalling dependencies..."
npm ci
echo "✅ Dependencies reinstalled"

echo ""
echo "🔨 Step 3: Compiling TypeScript..."
npx tsc -p tsconfig.mcp.json
echo "✅ TypeScript compilation complete"

echo ""
echo "📝 Step 4: Creating commit..."
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
git add .
git commit -m "force clean Railway build $TIMESTAMP" || echo "ℹ️  No changes to commit"
echo "✅ Changes committed"

echo ""
echo "🚀 Step 5: Pushing to trigger Railway rebuild..."
git push origin main
echo "✅ Pushed to Railway"

echo ""
echo "============================================"
echo "✅ Clean build complete!"
echo "============================================"
echo ""
echo "Next steps:"
echo "  1. Watch Railway dashboard for new deployment"
echo "  2. Look for '🏗️ Building with BUILD_TAG=$TIMESTAMP' in logs"
echo "  3. Verify no module resolution errors"
echo ""
echo "Railway Dashboard: https://railway.app"
echo ""
