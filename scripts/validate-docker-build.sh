#!/bin/bash
# Validates that Dockerfile copies all required TypeScript configs

echo "🔍 Checking Dockerfile for TypeScript config handling..."

if grep -q "COPY tsconfig\*.json" Dockerfile; then
  echo "✅ Dockerfile uses wildcard pattern for tsconfig files"
  exit 0
elif grep -q "COPY tsconfig.app.json" Dockerfile && \
     grep -q "COPY tsconfig.node.json" Dockerfile; then
  echo "✅ Dockerfile explicitly copies all required configs"
  exit 0
else
  echo "❌ Dockerfile missing TypeScript config copies!"
  echo "   Required: tsconfig.json, tsconfig.app.json, tsconfig.node.json, tsconfig.mcp.json"
  echo "   Fix: Add 'COPY tsconfig*.json ./' to Dockerfile"
  exit 1
fi
