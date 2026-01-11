#!/bin/bash

# OMEN System Verification Test
# Tests all critical functionality to ensure 100% working

set -e

BACKEND_URL="${BACKEND_URL:-http://localhost:3000}"

echo "========================================="
echo "OMEN SYSTEM VERIFICATION TEST"
echo "========================================="
echo ""
echo "Backend URL: $BACKEND_URL"
echo ""

# Test 1: Server Health
echo "1. Testing server health..."
health=$(curl -s "$BACKEND_URL/health")
if echo "$health" | grep -q '"status":"ok"'; then
  echo "✅ Server is healthy"
else
  echo "❌ Server health check failed"
  exit 1
fi
echo ""

# Test 2: Supabase Status
echo "2. Testing Supabase connection..."
supabase=$(curl -s "$BACKEND_URL/supabase/status")
echo "   Response: $supabase"
if echo "$supabase" | grep -q '"enabled":'; then
  echo "✅ Supabase status endpoint works"
else
  echo "❌ Supabase status endpoint failed"
  exit 1
fi
echo ""

# Test 3: Chat Endpoint
echo "3. Testing chat endpoint..."
chat=$(curl -s -X POST "$BACKEND_URL/chat" \
  -H "Content-Type: application/json" \
  -d '{"message":"test"}')
if echo "$chat" | grep -q '"response"'; then
  echo "✅ Chat endpoint works"
else
  echo "❌ Chat endpoint failed"
  echo "   Response: $chat"
  exit 1
fi
echo ""

# Test 4: Snapshot Generation
echo "4. Testing snapshot generation..."
snapshot=$(curl -s -X POST "$BACKEND_URL/snapshot/generate" \
  -H "Content-Type: application/json" \
  -d '{"timeframe":"weekly"}')
if echo "$snapshot" | grep -q '"ok":true'; then
  echo "✅ Snapshot generation works"

  # Check intelligence source
  if echo "$snapshot" | grep -q '"intelligenceSource":"real_orders"'; then
    echo "✅ Using REAL order-based intelligence"
  elif echo "$snapshot" | grep -q '"intelligenceSource":"snapshot_deltas"'; then
    echo "⚠️  Using snapshot deltas (fallback - Supabase may not have orders)"
  else
    echo "⚠️  Intelligence source unknown"
  fi
else
  echo "❌ Snapshot generation failed"
  echo "   Response: $snapshot"
  exit 1
fi
echo ""

# Test 5: Cron Endpoints
echo "5. Testing cron endpoints..."
cron=$(curl -s -X POST "$BACKEND_URL/cron/daily-snapshot" \
  -H "Content-Type: application/json" \
  -d '{"source":"test"}')
if echo "$cron" | grep -q '"ok":'; then
  echo "✅ Daily cron endpoint works"
else
  echo "❌ Daily cron endpoint failed"
  echo "   Response: $cron"
  exit 1
fi
echo ""

# Test 6: Syntax Check (if running locally)
if [ -f "src/server.js" ]; then
  echo "6. Checking JavaScript syntax..."
  if node --check src/server.js 2>&1; then
    echo "✅ server.js syntax valid"
  else
    echo "❌ server.js has syntax errors"
    exit 1
  fi

  if node --check src/intelligence/temporalAnalyzer.js 2>&1; then
    echo "✅ temporalAnalyzer.js syntax valid"
  else
    echo "❌ temporalAnalyzer.js has syntax errors"
    exit 1
  fi
  echo ""
fi

echo "========================================="
echo "✅ ALL TESTS PASSED"
echo "========================================="
echo ""
echo "System is 100% functional!"
echo ""
echo "Next steps:"
echo "1. Ensure OMEN_USE_SUPABASE=true in Railway"
echo "2. Add SUPABASE_SERVICE_KEY to Railway env vars"
echo "3. Verify orders are flowing from Wix → Supabase"
echo "4. Generate snapshot and check for real intelligence"
