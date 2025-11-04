#!/bin/bash

# Check deployment mode for Railway
# Prevents mid-test auto-redeploys when RAILWAY_AUTO_DEPLOY=false

echo "============================================"
echo "🔍 Checking Railway Deployment Mode"
echo "============================================"

if [ "$RAILWAY_AUTO_DEPLOY" = "false" ]; then
  echo "🧪 TESTING MODE: Auto-deploy is DISABLED"
  echo "   - Railway will NOT redeploy on git push"
  echo "   - Manual deployment required from Railway dashboard"
  echo "   - Recommended for: live testing, AI tuning, QA sessions"
  echo ""
  echo "To re-enable auto-deploy:"
  echo "  1. Go to Railway Settings → Deployments"
  echo "  2. Toggle ON 'Auto Deploy on Git Push'"
  echo "  3. Remove RAILWAY_AUTO_DEPLOY env var (optional)"
else
  echo "🚀 PRODUCTION MODE: Auto-deploy is ENABLED"
  echo "   - Railway will auto-deploy on every git push to main"
  echo "   - Recommended for: production, continuous deployment"
  echo ""
  echo "To disable auto-deploy during testing:"
  echo "  1. Go to Railway Settings → Deployments"
  echo "  2. Toggle OFF 'Auto Deploy on Git Push'"
  echo "  3. Optionally set RAILWAY_AUTO_DEPLOY=false"
fi

echo "============================================"
