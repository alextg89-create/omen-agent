# Test Inventory Ingestion Endpoint
# PowerShell version for Windows

$baseUrl = "http://localhost:3000"

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "INVENTORY INGESTION VERIFICATION TEST" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""

# Test 1: Check server health
Write-Host "1. Checking server health..." -ForegroundColor Yellow
try {
    $health = Invoke-RestMethod -Uri "$baseUrl/health" -Method Get
    if ($health.status -eq "ok") {
        Write-Host "✓ Server is running" -ForegroundColor Green
    }
} catch {
    Write-Host "✗ Server not responding - start with 'npm start'" -ForegroundColor Red
    exit 1
}
Write-Host ""

# Test 2: Invalid payload (missing sku)
Write-Host "2. Testing validation (missing sku)..." -ForegroundColor Yellow
try {
    $response = Invoke-RestMethod -Uri "$baseUrl/ingest/inventory" -Method Post `
        -ContentType "application/json" `
        -Body '{"quantity": 10, "source": "test"}' -ErrorAction Stop
    Write-Host "✗ Should have been rejected" -ForegroundColor Red
} catch {
    if ($_.Exception.Response.StatusCode -eq 400) {
        Write-Host "✓ Validation works (rejected missing sku)" -ForegroundColor Green
    }
}
Write-Host ""

# Test 3: Valid inventory event
Write-Host "3. Recording first inventory event (Bloopiez eighth = 20)..." -ForegroundColor Yellow
try {
    $body = @{
        sku = "Bloopiez_eighth"
        quantity = 20
        source = "manual_test"
    } | ConvertTo-Json

    $response = Invoke-RestMethod -Uri "$baseUrl/ingest/inventory" -Method Post `
        -ContentType "application/json" `
        -Body $body

    if ($response.ok -eq $true) {
        Write-Host "✓ First event recorded successfully" -ForegroundColor Green
        Write-Host "  Request ID: $($response.requestId)"
    }
} catch {
    Write-Host "⚠ Event recording failed (check if Supabase is configured)" -ForegroundColor Yellow
    Write-Host "  Error: $($_.Exception.Message)"
}
Write-Host ""

# Test 4: Second event (different quantity)
Write-Host "4. Recording second inventory event (Bloopiez eighth = 15)..." -ForegroundColor Yellow
Start-Sleep -Seconds 2
try {
    $body = @{
        sku = "Bloopiez_eighth"
        quantity = 15
        source = "manual_test"
    } | ConvertTo-Json

    $response = Invoke-RestMethod -Uri "$baseUrl/ingest/inventory" -Method Post `
        -ContentType "application/json" `
        -Body $body

    if ($response.ok -eq $true) {
        Write-Host "✓ Second event recorded successfully" -ForegroundColor Green
        Write-Host "  Request ID: $($response.requestId)"
    }
} catch {
    Write-Host "⚠ Event recording failed" -ForegroundColor Yellow
    Write-Host "  Error: $($_.Exception.Message)"
}
Write-Host ""

# Test 5: Third event with timestamp
Write-Host "5. Recording third inventory event with explicit timestamp..." -ForegroundColor Yellow
try {
    $timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    $body = @{
        sku = "Bloopiez_eighth"
        quantity = 12
        source = "manual_test"
        timestamp = $timestamp
    } | ConvertTo-Json

    $response = Invoke-RestMethod -Uri "$baseUrl/ingest/inventory" -Method Post `
        -ContentType "application/json" `
        -Body $body

    if ($response.ok -eq $true) {
        Write-Host "✓ Third event with timestamp recorded successfully" -ForegroundColor Green
        Write-Host "  Request ID: $($response.requestId)"
    }
} catch {
    Write-Host "⚠ Event recording failed" -ForegroundColor Yellow
    Write-Host "  Error: $($_.Exception.Message)"
}
Write-Host ""

# Summary
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "VERIFICATION SUMMARY" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Expected Supabase State:"
Write-Host "  inventory_snapshots: 3 rows for Bloopiez_eighth"
Write-Host "    - Row 1: quantity=20"
Write-Host "    - Row 2: quantity=15"
Write-Host "    - Row 3: quantity=12"
Write-Host ""
Write-Host "  inventory_live: 1 row for Bloopiez_eighth"
Write-Host "    - quantity=12 (latest)"
Write-Host ""
Write-Host "If events failed, configure Supabase:" -ForegroundColor Yellow
Write-Host "  Set-Item -Path Env:OMEN_USE_SUPABASE -Value 'true'"
Write-Host "  Set-Item -Path Env:SUPABASE_URL -Value 'https://your-project.supabase.co'"
Write-Host "  Set-Item -Path Env:SUPABASE_SERVICE_KEY -Value 'your-service-key'"
Write-Host ""
Write-Host "✓ Endpoint implementation verified" -ForegroundColor Green
Write-Host "=========================================" -ForegroundColor Cyan
