#!/bin/bash
# Test live Railway deployment

echo "🔍 TESTING LIVE DEPLOYMENT"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

ENDPOINT="https://primeagentvault.com"

echo "1️⃣ Testing snapshot generation (Weekly)..."
RESPONSE=$(curl -s -X POST "$ENDPOINT/snapshot/generate" \
  -H "Content-Type: application/json" \
  -d '{"timeframe":"weekly","email":"test@example.com"}')

echo "$RESPONSE" | jq '.recommendations.promotions | length' 2>/dev/null || echo "Failed to parse response"
echo ""

echo "Response preview:"
echo "$RESPONSE" | jq -C '.' | head -50

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
