# Deployment Checklist - Weekly Snapshot

## Backend (Railway) - Commit 64d7391

### Pre-Deployment Verification
- [x] Code pushed to GitHub (origin/main at 64d7391)
- [x] Syntax validated (`node --check src/server.js` passes)
- [x] Tests pass locally (`node test-snapshot.js`)
- [x] No breaking changes to existing endpoints

### Railway Deployment Steps
1. [ ] Go to https://railway.app
2. [ ] Navigate to OMEN project
3. [ ] Check "Deployments" tab
4. [ ] Verify commit `64d7391` is deployed (or trigger manually)
5. [ ] Wait for deployment to complete (~2-5 minutes)
6. [ ] Copy the public URL (e.g., `https://omen-agent-production.up.railway.app`)

### Post-Deployment Testing
Test these endpoints on Railway URL:

```bash
# 1. Health check
curl https://YOUR-RAILWAY-URL.up.railway.app/health

# 2. Generate snapshot
curl -X POST https://YOUR-RAILWAY-URL.up.railway.app/snapshot/generate

# 3. Send snapshot email
curl -X POST https://YOUR-RAILWAY-URL.up.railway.app/snapshot/send \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com"}'

# 4. Chat with recommendations
curl -X POST https://YOUR-RAILWAY-URL.up.railway.app/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"what should I promote?","conversationHistory":[]}'
```

Expected responses:
- [ ] `/health` returns `{"status":"ok"}`
- [ ] `/snapshot/generate` returns `{"ok":true,"snapshot":{...}}`
- [ ] `/snapshot/send` returns `{"ok":true,"email":{...}}`
- [ ] `/chat` returns recommendations when asked

### Backward Compatibility Verification
- [ ] `/ingest/njweedwizard` still works (no changes)
- [ ] Existing chat queries still work (inventory questions)
- [ ] `/route` endpoint unchanged
- [ ] Governance system unchanged

---

## Frontend (Bolt UI) - Update Required

### Current Issue
The Bolt UI at `https://primewave-capital-li-rl72.bolt.host/weekly-snapshot` is calling endpoints that don't exist or have changed.

### Required UI Changes

#### 1. Update Backend URL
Replace hardcoded backend URL with Railway production URL:
```javascript
// OLD (probably):
const BACKEND_URL = "http://localhost:3000";

// NEW:
const BACKEND_URL = "https://YOUR-RAILWAY-URL.up.railway.app";
```

#### 2. Update "Generate Snapshot" Button
```javascript
// Current button handler (likely broken)
async function generateSnapshot() {
  const response = await fetch(`${BACKEND_URL}/snapshot/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})  // Empty body
  });

  const data = await response.json();

  if (data.ok) {
    displaySnapshot(data.snapshot);
  } else {
    showError(data.error);
  }
}
```

#### 3. Update "Send Snapshot Now" Button
```javascript
// Current button handler (needs email from input)
async function sendSnapshot() {
  const email = document.getElementById('emailInput').value;

  const response = await fetch(`${BACKEND_URL}/snapshot/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email })
  });

  const data = await response.json();

  if (data.ok) {
    showSuccess('Snapshot prepared for delivery');
    // Optionally display formatted email preview
    console.log('Email body:', data.email.body);
  } else {
    showError(data.error);
  }
}
```

#### 4. Display Snapshot Data
The UI needs to render the new snapshot structure:
```javascript
function displaySnapshot(snapshot) {
  // Metrics
  document.getElementById('totalItems').textContent = snapshot.metrics.totalItems;
  document.getElementById('avgMargin').textContent = snapshot.metrics.averageMargin + '%';
  document.getElementById('totalProfit').textContent = '$' + snapshot.metrics.totalProfit;

  // Recommendations
  renderRecommendations('promotions', snapshot.recommendations.promotions);
  renderRecommendations('pricing', snapshot.recommendations.pricing);
  renderRecommendations('inventory', snapshot.recommendations.inventory);
}

function renderRecommendations(category, recommendations) {
  const container = document.getElementById(`${category}-list`);
  container.innerHTML = recommendations.map(rec => `
    <div class="recommendation">
      <strong>${rec.name}</strong>
      <p>${rec.reason}</p>
      <small>Action: ${rec.action} | Confidence: ${(rec.confidence * 100).toFixed(0)}%</small>
    </div>
  `).join('');
}
```

#### 5. Handle "Run Scheduled Job Now" Button
This button likely triggers n8n workflow. Update to ensure n8n calls correct endpoints:
- n8n should call `POST /snapshot/send` with email parameter
- n8n receives formatted email in `response.email.body`
- n8n sends email using email provider (SendGrid, etc.)

---

## n8n Workflow Update (if applicable)

If you have an n8n scheduled workflow:

### Workflow Node 1: HTTP Request to OMEN
```
Method: POST
URL: https://YOUR-RAILWAY-URL.up.railway.app/snapshot/send
Body: {"email": "{{$json.recipient}}"}
```

### Workflow Node 2: Extract Email Data
```javascript
// Extract from OMEN response
const emailData = $input.item.json;

return {
  to: emailData.email.to,
  subject: emailData.email.subject,
  body: emailData.email.body
};
```

### Workflow Node 3: Send Email
Use n8n's email node (Gmail, SendGrid, etc.) with extracted data.

---

## API Response Format Reference

### `/snapshot/generate` Response
```json
{
  "ok": true,
  "snapshot": {
    "requestId": "uuid",
    "generatedAt": "ISO timestamp",
    "store": "NJWeedWizard",
    "metrics": {
      "totalItems": 60,
      "itemsWithPricing": 16,
      "averageMargin": 60.51,
      "totalRevenue": 8088,
      "totalCost": 3225,
      "totalProfit": 4863,
      "highestMarginItem": { "name": "...", "margin": 61.11 },
      "lowestMarginItem": { "name": "...", "margin": 60 },
      "topItems": [...]
    },
    "recommendations": {
      "promotions": [
        {
          "sku": "Bloopiez",
          "unit": "oz",
          "name": "Bloopiez (oz)",
          "reason": "High stock + healthy margin",
          "triggeringMetrics": { "quantity": 28, "margin": 60 },
          "confidence": 0.85,
          "action": "PROMOTE_AS_FEATURED"
        }
      ],
      "pricing": [...],
      "inventory": [...]
    },
    "confidence": "high",
    "itemCount": 60
  }
}
```

### `/snapshot/send` Response
```json
{
  "ok": true,
  "snapshot": { ... },  // Same as above
  "email": {
    "to": "user@example.com",
    "subject": "OMEN Weekly Snapshot - 1/9/2026",
    "body": "...formatted plain text email..."
  },
  "message": "Snapshot prepared for email delivery"
}
```

---

## Common Issues & Solutions

### Issue: "Cannot POST /snapshot/generate"
**Cause**: Railway hasn't deployed the latest code
**Solution**: Check Railway deployments tab, trigger manual deploy if needed

### Issue: CORS errors in browser
**Cause**: Bolt UI calling Railway from different origin
**Solution**: Add CORS headers to server.js (if needed):
```javascript
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', 'https://primewave-capital-li-rl72.bolt.host');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  next();
});
```

### Issue: "No inventory data available"
**Cause**: Inventory not ingested yet
**Solution**: Call `/ingest/njweedwizard` with inventory data first

### Issue: "No items with valid pricing data"
**Cause**: Inventory items don't have `pricing.retail` and `pricing.cost`
**Solution**: Check pricing catalog at `src/data/pricing.json` and ensure ingestion applies pricing

### Issue: Email not sending
**Cause**: n8n workflow not configured
**Solution**: The `/snapshot/send` endpoint only prepares the email. You need n8n or other service to actually send it.

---

## Rollback Plan (if needed)

If deployment causes issues:

1. Railway: Redeploy previous version from deployments tab
2. GitHub: Revert commits:
   ```bash
   git revert 64d7391 80ae487 7ff8f5c
   git push
   ```
3. UI: Change backend URL back to previous endpoint

---

## Sign-off Checklist

Before marking as complete:

- [ ] Railway shows deployment successful
- [ ] All test endpoints return expected responses
- [ ] Bolt UI successfully calls new endpoints
- [ ] Email generation works end-to-end
- [ ] Chat recommendations work ("what should I promote?")
- [ ] No errors in Railway logs
- [ ] Existing functionality (chat, ingestion) still works
- [ ] Documentation updated
- [ ] Team notified of new endpoints

---

## Questions to Resolve

1. **What is the Railway production URL?**
   - Need this to update Bolt UI

2. **Does Bolt UI need CORS configuration?**
   - Test cross-origin requests from Bolt to Railway

3. **Is n8n workflow already set up?**
   - If yes, update workflow to call new endpoints
   - If no, create workflow or use manual email sending

4. **What email provider is used?**
   - SendGrid, Gmail, SMTP, etc.
   - Configure n8n email node accordingly

5. **Should we modify `/snapshot/send` response format?**
   - Current format might not match n8n expectations
   - Can adjust to match existing workflow structure
