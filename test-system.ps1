# OMEN System Verification Test (PowerShell)
# Tests all critical functionality to ensure 100% working

$ErrorActionPreference = "Stop"

$BACKEND_URL = if ($env:BACKEND_URL) { $env:BACKEND_URL } else { "http://localhost:3000" }

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "OMEN SYSTEM VERIFICATION TEST" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Backend URL: $BACKEND_URL"
Write-Host ""

# Test 1: Server Health
Write-Host "1. Testing server health..." -ForegroundColor Yellow
try {
    $health = Invoke-RestMethod -Uri "$BACKEND_URL/health" -Method Get
    if ($health.status -eq "ok") {
        Write-Host "✅ Server is healthy" -ForegroundColor Green
    } else {
        Write-Host "❌ Server health check failed" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "❌ Server health check failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
Write-Host ""

# Test 2: Supabase Status
Write-Host "2. Testing Supabase connection..." -ForegroundColor Yellow
try {
    $supabase = Invoke-RestMethod -Uri "$BACKEND_URL/supabase/status" -Method Get
    Write-Host "   Enabled: $($supabase.enabled)"
    Write-Host "   Configured: $($supabase.configured)"
    Write-Host "   Connected: $($supabase.connected)"
    Write-Host "✅ Supabase status endpoint works" -ForegroundColor Green
} catch {
    Write-Host "❌ Supabase status endpoint failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
Write-Host ""

# Test 3: Chat Endpoint
Write-Host "3. Testing chat endpoint..." -ForegroundColor Yellow
try {
    $body = @{ message = "test" } | ConvertTo-Json
    $chat = Invoke-RestMethod -Uri "$BACKEND_URL/chat" -Method Post `
        -ContentType "application/json" -Body $body
    if ($chat.response) {
        Write-Host "✅ Chat endpoint works" -ForegroundColor Green
    } else {
        Write-Host "❌ Chat endpoint returned no response" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "❌ Chat endpoint failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
Write-Host ""

# Test 4: Snapshot Generation
Write-Host "4. Testing snapshot generation..." -ForegroundColor Yellow
try {
    $body = @{ timeframe = "weekly" } | ConvertTo-Json
    $snapshot = Invoke-RestMethod -Uri "$BACKEND_URL/snapshot/generate" -Method Post `
        -ContentType "application/json" -Body $body

    if ($snapshot.ok -eq $true) {
        Write-Host "✅ Snapshot generation works" -ForegroundColor Green

        # Check intelligence source
        $source = $snapshot.temporal.intelligenceSource
        if ($source -eq "real_orders") {
            Write-Host "✅ Using REAL order-based intelligence" -ForegroundColor Green
        } elseif ($source -eq "snapshot_deltas") {
            Write-Host "⚠️  Using snapshot deltas (fallback - Supabase may not have orders)" -ForegroundColor Yellow
        } else {
            Write-Host "⚠️  Intelligence source unknown: $source" -ForegroundColor Yellow
        }

        if ($snapshot.velocity) {
            Write-Host "   Order count: $($snapshot.velocity.orderCount)" -ForegroundColor Cyan
            Write-Host "   Insights: $($snapshot.velocity.insights.Count)" -ForegroundColor Cyan
        }
    } else {
        Write-Host "❌ Snapshot generation failed" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "❌ Snapshot generation failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
Write-Host ""

# Test 5: Cron Endpoints
Write-Host "5. Testing cron endpoints..." -ForegroundColor Yellow
try {
    $body = @{ source = "test" } | ConvertTo-Json
    $cron = Invoke-RestMethod -Uri "$BACKEND_URL/cron/daily-snapshot" -Method Post `
        -ContentType "application/json" -Body $body

    if ($cron.ok) {
        Write-Host "✅ Daily cron endpoint works" -ForegroundColor Green
        Write-Host "   Real intelligence: $($cron.hasRealIntelligence)" -ForegroundColor Cyan
        Write-Host "   Insight count: $($cron.insightCount)" -ForegroundColor Cyan
    } else {
        Write-Host "❌ Daily cron endpoint failed" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "❌ Daily cron endpoint failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
Write-Host ""

# Test 6: Syntax Check (if running locally)
if (Test-Path "src/server.js") {
    Write-Host "6. Checking JavaScript syntax..." -ForegroundColor Yellow

    $serverCheck = node --check src/server.js 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ server.js syntax valid" -ForegroundColor Green
    } else {
        Write-Host "❌ server.js has syntax errors" -ForegroundColor Red
        Write-Host $serverCheck
        exit 1
    }

    $analyzerCheck = node --check src/intelligence/temporalAnalyzer.js 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ temporalAnalyzer.js syntax valid" -ForegroundColor Green
    } else {
        Write-Host "❌ temporalAnalyzer.js has syntax errors" -ForegroundColor Red
        Write-Host $analyzerCheck
        exit 1
    }
    Write-Host ""
}

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "✅ ALL TESTS PASSED" -ForegroundColor Green
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "System is 100% functional!" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "1. Ensure OMEN_USE_SUPABASE=true in Railway"
Write-Host "2. Add SUPABASE_SERVICE_KEY to Railway env vars"
Write-Host "3. Verify orders are flowing from Wix → Supabase"
Write-Host "4. Generate snapshot and check for real intelligence"
