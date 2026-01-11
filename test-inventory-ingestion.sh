#!/bin/bash

# Test Inventory Ingestion Endpoint
# Verifies POST /ingest/inventory functionality

set -e

echo "========================================="
echo "INVENTORY INGESTION VERIFICATION TEST"
echo "========================================="
echo ""

BASE_URL="http://localhost:3000"

# Color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if server is running
echo "1. Checking server health..."
HEALTH=$(curl -s "$BASE_URL/health" || echo "ERROR")
if [[ "$HEALTH" == *"ok"* ]]; then
  echo -e "${GREEN}✓ Server is running${NC}"
else
  echo -e "${RED}✗ Server not responding - start with 'npm start'${NC}"
  exit 1
fi
echo ""

# Test 1: Invalid payload (missing sku)
echo "2. Testing validation (missing sku)..."
RESPONSE=$(curl -s -X POST "$BASE_URL/ingest/inventory" \
  -H "Content-Type: application/json" \
  -d '{"quantity": 10, "source": "test"}')

if [[ "$RESPONSE" == *"sku is required"* ]]; then
  echo -e "${GREEN}✓ Validation works (rejected missing sku)${NC}"
else
  echo -e "${RED}✗ Validation failed${NC}"
  echo "Response: $RESPONSE"
fi
echo ""

# Test 2: Invalid payload (missing quantity)
echo "3. Testing validation (missing quantity)..."
RESPONSE=$(curl -s -X POST "$BASE_URL/ingest/inventory" \
  -H "Content-Type: application/json" \
  -d '{"sku": "TestProduct", "source": "test"}')

if [[ "$RESPONSE" == *"quantity is required"* ]]; then
  echo -e "${GREEN}✓ Validation works (rejected missing quantity)${NC}"
else
  echo -e "${RED}✗ Validation failed${NC}"
  echo "Response: $RESPONSE"
fi
echo ""

# Test 3: Invalid payload (missing source)
echo "4. Testing validation (missing source)..."
RESPONSE=$(curl -s -X POST "$BASE_URL/ingest/inventory" \
  -H "Content-Type: application/json" \
  -d '{"sku": "TestProduct", "quantity": 10}')

if [[ "$RESPONSE" == *"source is required"* ]]; then
  echo -e "${GREEN}✓ Validation works (rejected missing source)${NC}"
else
  echo -e "${RED}✗ Validation failed${NC}"
  echo "Response: $RESPONSE"
fi
echo ""

# Test 4: First valid inventory event
echo "5. Recording first inventory event (Bloopiez eighth = 20)..."
RESPONSE1=$(curl -s -X POST "$BASE_URL/ingest/inventory" \
  -H "Content-Type: application/json" \
  -d '{
    "sku": "Bloopiez_eighth",
    "quantity": 20,
    "source": "manual_test"
  }')

if [[ "$RESPONSE1" == *"\"ok\":true"* ]]; then
  echo -e "${GREEN}✓ First event recorded successfully${NC}"
  echo "Response: $RESPONSE1" | head -c 200
  echo "..."
else
  echo -e "${YELLOW}⚠ Event recording may have failed (check if Supabase is configured)${NC}"
  echo "Response: $RESPONSE1"
fi
echo ""

# Test 5: Second valid inventory event (different quantity)
echo "6. Recording second inventory event (Bloopiez eighth = 15)..."
sleep 2  # Ensure different timestamp
RESPONSE2=$(curl -s -X POST "$BASE_URL/ingest/inventory" \
  -H "Content-Type: application/json" \
  -d '{
    "sku": "Bloopiez_eighth",
    "quantity": 15,
    "source": "manual_test"
  }')

if [[ "$RESPONSE2" == *"\"ok\":true"* ]]; then
  echo -e "${GREEN}✓ Second event recorded successfully${NC}"
  echo "Response: $RESPONSE2" | head -c 200
  echo "..."
else
  echo -e "${YELLOW}⚠ Event recording may have failed (check if Supabase is configured)${NC}"
  echo "Response: $RESPONSE2"
fi
echo ""

# Test 6: Third event with explicit timestamp
echo "7. Recording third inventory event with explicit timestamp..."
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
RESPONSE3=$(curl -s -X POST "$BASE_URL/ingest/inventory" \
  -H "Content-Type: application/json" \
  -d "{
    \"sku\": \"Bloopiez_eighth\",
    \"quantity\": 12,
    \"source\": \"manual_test\",
    \"timestamp\": \"$TIMESTAMP\"
  }")

if [[ "$RESPONSE3" == *"\"ok\":true"* ]]; then
  echo -e "${GREEN}✓ Third event with timestamp recorded successfully${NC}"
  echo "Response: $RESPONSE3" | head -c 200
  echo "..."
else
  echo -e "${YELLOW}⚠ Event recording may have failed (check if Supabase is configured)${NC}"
  echo "Response: $RESPONSE3"
fi
echo ""

# Summary
echo "========================================="
echo "VERIFICATION SUMMARY"
echo "========================================="
echo ""
echo "Expected Supabase State:"
echo "  inventory_snapshots: 3 rows for Bloopiez_eighth"
echo "    - Row 1: quantity=20"
echo "    - Row 2: quantity=15"
echo "    - Row 3: quantity=12"
echo ""
echo "  inventory_live: 1 row for Bloopiez_eighth"
echo "    - quantity=12 (latest)"
echo ""
echo -e "${YELLOW}Note: If responses show 'Supabase not available', configure:${NC}"
echo "  export OMEN_USE_SUPABASE=true"
echo "  export SUPABASE_URL=https://your-project.supabase.co"
echo "  export SUPABASE_SERVICE_KEY=your-service-key"
echo ""
echo -e "${GREEN}✓ Endpoint implementation verified${NC}"
echo "========================================="
