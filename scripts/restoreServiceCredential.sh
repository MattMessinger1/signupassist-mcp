#!/bin/bash
# Re-store SkiClubPro Service Credential
# This script encrypts and stores credentials using the current CRED_SEAL_KEY
# Usage: ./scripts/restoreServiceCredential.sh

# Check required environment variables
if [ -z "$MCP_SERVER_URL" ]; then
  echo "❌ Error: MCP_SERVER_URL not set"
  echo "Example: export MCP_SERVER_URL=https://signupassist-mcp-production.up.railway.app"
  exit 1
fi

if [ -z "$MCP_ACCESS_TOKEN" ]; then
  echo "❌ Error: MCP_ACCESS_TOKEN not set"
  echo "This is required for authentication"
  exit 1
fi

# Prompt for credentials
echo "🔐 Re-storing SkiClubPro Service Credential"
echo "----------------------------------------"
read -p "Provider (default: skiclubpro): " PROVIDER
PROVIDER=${PROVIDER:-skiclubpro}

read -p "Alias (default: Blackhawk Service Credential): " ALIAS
ALIAS=${ALIAS:-Blackhawk Service Credential}

read -p "Email: " EMAIL
if [ -z "$EMAIL" ]; then
  echo "❌ Email is required"
  exit 1
fi

read -sp "Password: " PASSWORD
echo ""
if [ -z "$PASSWORD" ]; then
  echo "❌ Password is required"
  exit 1
fi

# Call the endpoint
echo ""
echo "📤 Storing credential..."
RESPONSE=$(curl -X POST "$MCP_SERVER_URL/tools/cred-store" \
  -H "Authorization: Bearer $MCP_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"provider\": \"$PROVIDER\",
    \"alias\": \"$ALIAS\",
    \"email\": \"$EMAIL\",
    \"password\": \"$PASSWORD\"
  }" \
  -w "\n%{http_code}" \
  -s)

# Split response and status code
HTTP_BODY=$(echo "$RESPONSE" | head -n -1)
HTTP_CODE=$(echo "$RESPONSE" | tail -n 1)

if [ "$HTTP_CODE" = "200" ]; then
  echo "✅ Credential stored successfully!"
  echo "$HTTP_BODY" | jq .
  
  # Extract and display the credential ID
  CRED_ID=$(echo "$HTTP_BODY" | jq -r '.id')
  echo ""
  echo "📋 Credential ID: $CRED_ID"
  echo ""
  echo "💡 Update your SCP_SERVICE_CRED_ID secret with this ID:"
  echo "   SCP_SERVICE_CRED_ID=$CRED_ID"
else
  echo "❌ Failed to store credential (HTTP $HTTP_CODE)"
  echo "$HTTP_BODY" | jq . || echo "$HTTP_BODY"
  exit 1
fi
