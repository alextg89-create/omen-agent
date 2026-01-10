# DEPLOYMENT CHECKLIST - Response Formatting Fix

**Status**: READY ✅  
**Risk**: LOW (text formatting only)  
**Time**: 3-5 minutes

---

## Pre-Deployment Checks

```bash
# Test formatter
node test-response-formatting.js
# Expected: ALL TESTS PASSED ✅

# Validate syntax
node --check src/server.js
# Expected: (no errors)
```

---

## Deploy Commands

```bash
git add src/utils/responseFormatter.js src/server.js test-response-formatting.js PRICING_LANGUAGE_HOTFIX.md DEPLOYMENT_CHECKLIST.md

git commit -m "fix: enforce response formatting at runtime

- Add responseFormatter.js (strips markdown, blocks sales language)  
- Format all chat responses before returning  
- Show action count in snapshot emails  
- Add test suite (6 tests passing)  

Fixes: markdown formatting, verbose responses, misleading language"

git push origin main
```

Railway auto-deploys. Wait for "Deploy successful" (~3 min).

---

## Post-Deployment Tests

### Test 1: No Markdown
```bash
curl -X POST https://omen-agent-production.up.railway.app/chat -H "Content-Type: application/json" -d '{"message":"what are my margins"}' | jq -r '.response'
```
**Expected**: Plain text, NO `**bold**`, max 3 sentences

### Test 2: No Forbidden Words
```bash
curl -X POST https://omen-agent-production.up.railway.app/chat -H "Content-Type: application/json" -d '{"message":"what should I reorder"}' | jq -r '.response'
```
**Expected**: NO "best-selling", NO "top performer"

### Test 3: Action Count
```bash
curl -X POST https://omen-agent-production.up.railway.app/snapshot/send -H "Content-Type: application/json" -d '{"email":"test@example.com"}' | jq -r '.email.body' | grep "Actions Identified"
```
**Expected**: `Actions Identified: 12` (not zero)

---

## Success Criteria

- [ ] Railway: "Deploy successful"  
- [ ] Test 1: No markdown  
- [ ] Test 2: No forbidden language  
- [ ] Test 3: Shows action count  
- [ ] Logs show "Response formatted"

---

## Rollback (If Needed)

```bash
git revert HEAD
git push origin main
```

**Ready**: YES ✅
