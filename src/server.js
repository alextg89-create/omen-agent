import 'dotenv/config';
import applyPricing from "./tools/applyPricing.js";
import { saveInventory, getInventory, clearInventory } from "./tools/inventoryStore.js";
import { detectLowStock } from "./inventorySignals.js";
import { ingestNjWeedWizardCsv } from "./njweedwizardCsvIngest.js";
import { normalizeInventory } from "./normalizeInventory.js";
import { sampleInventory as mockInventory } from "./mocks/inventory.sample.js";
import { makeDecision } from "./decisionEngine.js";
import { callLLM } from "./llm.js";
import { formatChatResponse } from "./utils/responseFormatter.js";
import { generateInsightResponse, generateProactiveInsight, wrapWithProactiveInsight } from "./utils/chatIntelligence.js";
import {
  evaluateGovernanceState,
  currentExecutionMode,
} from "./governance/governanceController.js";
import {
  calculateDateRange,
  validateAsOfDate
} from "./utils/dateCalculations.js";
import {
  saveSnapshot,
  loadSnapshot,
  listCachedSnapshots
} from "./utils/snapshotCache.js";
import {
  createSnapshotEntry,
  addToIndex,
  findExistingSnapshot,
  markAsEmailed,
  listSnapshots as listSnapshotHistory,
  getLastSnapshots,
  getSnapshotsInRange,
  getLatestSnapshotEntry,
  getStatistics as getSnapshotStatistics
} from "./utils/snapshotHistory.js";
import { getConnectionStatus, testConnection, getSupabaseClient, isSupabaseAvailable } from "./db/supabaseClient.js";
import { recordInventorySnapshot, updateLiveInventory } from "./db/supabaseQueries.js";
import { sendSnapshotEmail, isEmailConfigured } from "./services/emailService.js";
import { autoSyncOrders } from "./services/orderSyncService.js";
import {
  generateTemporalRecommendationsFromSnapshots,
  computeInventoryDeltas
} from "./utils/snapshotTemporalEngine.js";
import {
  analyzeInventoryVelocity,
  formatInsightsForDisplay
} from "./intelligence/temporalAnalyzer.js";
import {
  enrichSnapshotWithIntelligence
} from "./utils/snapshotIntelligence.js";
import {
  parseWixCsv,
  validateItems
} from "./utils/wixCsvParser.js";
import express from "express";
import cors from "cors";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import { intelligenceRouter } from "./intelligenceRouter.js";

// ES module __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OMEN_MAX_TIER = Number(process.env.OMEN_MAX_TIER ?? 1);
const OMEN_ALLOW_EXECUTION = process.env.OMEN_ALLOW_EXECUTION === "true";
const USE_MOCK_INVENTORY = process.env.OMEN_USE_MOCKS === "true";
const STORE_ID = "NJWeedWizard";

/*
 * ===============================
 * OMEN SERVER — CANONICAL BASELINE
 * ===============================
 * - Single source of truth
 * - Phase 2 logging enabled
 * - Railway-safe
 * - No duplicate middleware
 */

const app = express();

/**
 * DEBUG — Inspect live inventory snapshot
 */
app.get("/debug/inventory", async (req, res) => {
  try {
    const inventory = await getInventory(STORE_ID);

    res.json({
      ok: true,
      count: inventory ? inventory.length : 0,
      sample: inventory ? inventory.slice(0, 5) : [],
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});

/* ---------- Middleware ---------- */
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));

app.use(express.json());

/* ---------- Static File Serving ---------- */
// Serve static files from public directory
const publicPath = path.join(__dirname, "..", "public");
app.use(express.static(publicPath));

function createRequestId() {
  return crypto.randomUUID();
}

/* ---------- Health Check ---------- */
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "omen-agent",
    timestamp: new Date().toISOString(),
  });
});

/* ---------- Supabase Status ---------- */
app.get("/supabase/status", async (_req, res) => {
  const status = getConnectionStatus();

  // Test connection if available
  let connectionTest = null;
  if (status.connected) {
    connectionTest = await testConnection('orders');
  }

  res.json({
    ...status,
    connectionTest,
    timestamp: new Date().toISOString()
  });
});

/* ---------- Intelligence Routing (CANONICAL) ---------- */
app.post("/route", async (req, res) => {
  const requestId = createRequestId();
  const timestamp = new Date().toISOString();

  console.log("🧠 [OMEN] Incoming routing request", {
    requestId,
    timestamp,
    input: req.body,
  });

  try {
    // 🧠 1. ROUTER DECISION
    const result = intelligenceRouter(req.body);

    // 🔐 2. PHASE 3 — GLOBAL SAFETY ENFORCEMENT

    // Enforce tier ceiling
    if (result.maxTier > OMEN_MAX_TIER) {
      result.maxTier = OMEN_MAX_TIER;
      result.executionAllowed = false;
    }

    // Enforce global execution kill switch
    if (!OMEN_ALLOW_EXECUTION) {
      result.executionAllowed = false;
    }

    // 🧠 3. PHASE 4 — LLM EXPLANATION (READ-ONLY)
let llmResponse = null;

if (result.executionAllowed) {
  llmResponse = await callLLM({
    system: "You are OMEN. Briefly explain the routing decision.",
    user: JSON.stringify(req.body),
    maxTokens: 300,
  });
}

// 🧭 4. DECISION ENGINE (AUTHORITATIVE)
const decision = await makeDecision({
  routerResult: result,
  llmExplanation: llmResponse,
});

// 🛡️ HOOK #1: Governance state evaluation at request entry (Phase 3)
// Feature flag: OMEN_GOVERNANCE_ENABLED (default: false)
if (process.env.OMEN_GOVERNANCE_ENABLED === "true") {
  evaluateGovernanceState({
    routerResult: result,
    decision,
    riskLevel: req.body.riskLevel,
    adminSignal: req.headers["x-admin-override"] === "true",
    confidenceGate: decision.confidence >= 0.7,
    decisionIntent:
      decision.decision === "RESPOND_DIRECT" ||
      decision.decision === "ASK_CLARIFYING_QUESTION"
        ? "SPEAK"
        : decision.decision === "BLOCK"
        ? "NONE"
        : "ACT",
  });
}

// 🟢 5. LOG FINAL DECISION
console.log("🟢 [OMEN] Final decision", {
  requestId,
  timestamp,
  decision,
  ...(process.env.OMEN_GOVERNANCE_ENABLED === "true" && {
    governanceMode: currentExecutionMode(),
  }),
});

    // 🚀 5. RESPOND
  res.json({
  ok: true,
  requestId,
  router: result,
  decision,
  explanation: llmResponse,
});

  } catch (err) {
    console.error("❌ [OMEN] Routing error", {
      requestId,
      timestamp,
      error: err.message,
    });

    res.status(500).json({
      ok: false,
      requestId,
      error: err.message,
    });
  }
});

/* ---------- NJWeedWizard Inventory Ingest ---------- */
app.post("/ingest/njweedwizard", (req, res) => {
  try {
    console.log("INGEST HIT:", req.body);
    const rows =
  Array.isArray(req.body?.rows) ? req.body.rows :
  Array.isArray(req.body?.data) ? req.body.data :
  Array.isArray(req.body) ? req.body :
  [];

  if (!Array.isArray(rows) || rows.length === 0) {
  return res.status(400).json({
    ok: false,
    error: "No ingestable rows found in payload",
    receivedType: typeof req.body,
  });
}
    // 🔹 Strip empty spacer rows (VERY IMPORTANT)
const cleanRows = rows.filter(
  r =>
    r &&
    typeof r.strain === "string" && r.strain.trim() !== "" &&
    typeof r.quality === "string" && r.quality.trim() !== "" &&
    typeof r.unit === "string" && r.unit.trim() !== "" &&
    Number(r.quantity) > 0
);

    // 1️⃣ Normalize raw ingest
// If rows already look normalized, skip CSV ingest
const normalized =
  typeof cleanRows[0]?.strain === "string" &&
  typeof cleanRows[0]?.unit === "string"
    ? cleanRows
    : ingestNjWeedWizardCsv(cleanRows);
    
    // 2️⃣ Aggregate / enrich inventory (pricing, stock, discounts)
    const aggregated = applyPricing(normalized);
    console.log(
  "PRICING SAMPLE:",
  aggregated.slice(0, 3).map(i => ({
    strain: i.strain,
    unit: i.unit,
    pricingMatch: i.pricingMatch,
    pricing: i.pricing
  }))
);

    // 3️⃣ Analyze enriched inventory (proofs ONLY)
    const proofs = analyzeInventory(aggregated);

    // 4️⃣ Persist enriched inventory (builds snapshot internally)
    const storage = persistInventory(aggregated);

    // 5️⃣ Save enriched inventory to in-memory store
    saveInventory(STORE_ID, aggregated);

    // 6️⃣ Optional signals
    const lowStock = detectLowStock(aggregated);

    return res.json({
      ok: true,
      store: STORE_ID,
      itemCount: aggregated.length,
      stored: true,
      updated_at: new Date().toISOString(),
      proofs,
    });
  } catch (err) {
    console.error("NJWeedWizard ingest failed", err);
    return res.status(500).json({
      ok: false,
      error: err.message,
    });
  }
});

/* ---------- INVENTORY INGESTION (CANONICAL) ---------- */
/**
 * POST /ingest/inventory
 *
 * Explicit inventory event recording for temporal intelligence activation
 *
 * PAYLOAD CONTRACT:
 * {
 *   "sku": "STRING",         // Required
 *   "quantity": NUMBER,      // Required
 *   "source": "STRING",      // Required (e.g. "wix_manual", "make_sync")
 *   "timestamp": "ISO-8601"  // Optional (server time if omitted)
 * }
 *
 * BEHAVIOR:
 * - Appends row to inventory_snapshots (historical record)
 * - Updates inventory_live (current state)
 * - Never overwrites snapshots
 * - Idempotent and deterministic
 *
 * ACTIVATES:
 * - Temporal intelligence (when 2+ events exist for same SKU)
 * - Depletion rate calculation
 * - Velocity-based recommendations
 */
app.post("/ingest/inventory", async (req, res) => {
  const requestId = crypto.randomUUID();

  try {
    console.log("📥 [OMEN] Inventory ingestion requested", {
      requestId,
      payload: req.body
    });

    // 1️⃣ VALIDATE PAYLOAD
    const { sku, quantity, source, timestamp } = req.body;

    if (!sku || typeof sku !== 'string' || sku.trim() === '') {
      return res.status(400).json({
        ok: false,
        error: 'Invalid payload',
        message: 'sku is required and must be a non-empty string',
        requestId
      });
    }

    if (typeof quantity !== 'number' || quantity < 0) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid payload',
        message: 'quantity is required and must be a non-negative number',
        requestId
      });
    }

    if (!source || typeof source !== 'string' || source.trim() === '') {
      return res.status(400).json({
        ok: false,
        error: 'Invalid payload',
        message: 'source is required and must be a non-empty string',
        requestId
      });
    }

    // Validate timestamp if provided
    let effectiveTimestamp = timestamp || new Date().toISOString();
    if (timestamp) {
      const parsedDate = new Date(timestamp);
      if (isNaN(parsedDate.getTime())) {
        return res.status(400).json({
          ok: false,
          error: 'Invalid payload',
          message: 'timestamp must be a valid ISO-8601 date string',
          requestId
        });
      }
      effectiveTimestamp = parsedDate.toISOString();
    }

    const inventoryEvent = {
      sku: sku.trim(),
      quantity,
      source: source.trim(),
      timestamp: effectiveTimestamp
    };

    console.log("📥 [OMEN] Recording inventory event", {
      requestId,
      event: inventoryEvent
    });

    // 2️⃣ RECORD SNAPSHOT (append-only historical record)
    const snapshotResult = await recordInventorySnapshot(inventoryEvent);

    if (!snapshotResult.ok) {
      console.error("📥 [OMEN] Failed to record snapshot", {
        requestId,
        error: snapshotResult.error
      });

      return res.status(500).json({
        ok: false,
        error: 'Failed to record inventory snapshot',
        message: snapshotResult.error,
        requestId
      });
    }

    // 3️⃣ UPDATE LIVE STATE (upsert current inventory)
    const liveResult = await updateLiveInventory(inventoryEvent);

    if (!liveResult.ok) {
      console.error("📥 [OMEN] Failed to update live inventory", {
        requestId,
        error: liveResult.error
      });

      return res.status(500).json({
        ok: false,
        error: 'Failed to update live inventory',
        message: liveResult.error,
        requestId
      });
    }

    console.log("📥 [OMEN] Inventory ingestion successful", {
      requestId,
      sku: inventoryEvent.sku,
      quantity: inventoryEvent.quantity,
      snapshotRecorded: snapshotResult.ok,
      liveUpdated: liveResult.ok
    });

    // 4️⃣ RETURN SUCCESS
    return res.json({
      ok: true,
      requestId,
      recorded: {
        sku: inventoryEvent.sku,
        quantity: inventoryEvent.quantity,
        source: inventoryEvent.source,
        timestamp: inventoryEvent.timestamp
      },
      snapshot: snapshotResult.data,
      live: liveResult.data
    });

  } catch (err) {
    console.error("📥 [OMEN] Inventory ingestion failed", {
      requestId,
      error: err.message,
      stack: err.stack
    });

    return res.status(500).json({
      ok: false,
      requestId,
      error: 'Inventory ingestion failed',
      message: err.message
    });
  }
});

/* ---------- DEV LOGIN (TEMPORARY) ---------- */
app.post("/auth/dev-login", (req, res) => {
  console.log("🔐 [OMEN] DEV LOGIN HIT");

  res.json({
    token: "dev-token",
    businesses: [
      {
        id: "dev-biz-1",
        name: "NJWeedWizard (Dev)",
      },
    ],
  });
});

/* ---------- WIX INVENTORY SYNC (FULL REPLACE) ---------- */
/**
 * SYNC WIX INVENTORY
 *
 * Full-replace sync from Wix CSV export.
 * Called by Make.com scenario: SYNC_WIX_INVENTORY
 *
 * BEHAVIOR:
 * 1. Parse CSV content
 * 2. DELETE all existing rows from wix_inventory_live
 * 3. INSERT all parsed items
 * 4. Return success/failure with stats
 *
 * ENDPOINT: POST /sync/wix-inventory
 * BODY: { csvContent: "..." } OR raw CSV text
 */
app.post("/sync/wix-inventory", async (req, res) => {
  const requestId = crypto.randomUUID();
  const startTime = Date.now();

  console.log("🔄 [OMEN] WIX INVENTORY SYNC REQUESTED", { requestId });

  try {
    // 1️⃣ CHECK SUPABASE AVAILABILITY
    if (!isSupabaseAvailable()) {
      return res.status(503).json({
        ok: false,
        error: "Supabase not configured",
        message: "Cannot sync inventory: Supabase connection required",
        requestId
      });
    }

    // 2️⃣ EXTRACT CSV CONTENT
    let csvContent;

    if (typeof req.body === 'string') {
      // Raw CSV text
      csvContent = req.body;
    } else if (req.body?.csvContent) {
      // JSON with csvContent field
      csvContent = req.body.csvContent;
    } else if (req.body?.data) {
      // Alternative field name
      csvContent = req.body.data;
    } else {
      return res.status(400).json({
        ok: false,
        error: "Invalid payload",
        message: "Expected CSV content in body or body.csvContent",
        requestId
      });
    }

    if (!csvContent || typeof csvContent !== 'string' || csvContent.trim().length < 100) {
      return res.status(400).json({
        ok: false,
        error: "Invalid CSV content",
        message: "CSV content is empty or too short",
        requestId
      });
    }

    console.log(`🔄 [OMEN] Received CSV content: ${csvContent.length} bytes`, { requestId });

    // 3️⃣ PARSE CSV (with strict SKU exclusion)
    const { items, stats, errors, skipped, summary } = parseWixCsv(csvContent);

    // Log the required summary server-side
    console.log(`🔄 [OMEN] PARSE SUMMARY:`, JSON.stringify(summary, null, 2), { requestId });

    if (items.length === 0) {
      return res.status(400).json({
        ok: false,
        error: "No valid items parsed",
        message: "CSV parsing produced zero inventory items. All rows may have missing or duplicate SKUs.",
        summary,
        skipped: skipped.slice(0, 20),
        parseErrors: errors.slice(0, 10),
        requestId
      });
    }

    // 4️⃣ VALIDATE ITEMS
    const { valid, invalid } = validateItems(items);

    console.log(`🔄 [OMEN] Parsed ${valid.length} valid items, ${invalid.length} invalid`, { requestId });

    if (valid.length === 0) {
      return res.status(400).json({
        ok: false,
        error: "No valid items after validation",
        message: "All parsed items failed validation",
        invalidSample: invalid.slice(0, 5),
        requestId
      });
    }

    // 5️⃣ FULL REPLACE IN SUPABASE
    const client = getSupabaseClient();

    // 5a. DELETE all existing rows
    console.log(`🔄 [OMEN] Clearing wix_inventory_live...`, { requestId });

    const { error: deleteError } = await client
      .from('wix_inventory_live')
      .delete()
      .neq('sku', 'NEVER_MATCH_THIS'); // Delete all rows (Supabase requires a filter)

    if (deleteError) {
      console.error(`🔄 [OMEN] DELETE failed:`, deleteError, { requestId });
      return res.status(500).json({
        ok: false,
        error: "Failed to clear existing inventory",
        message: deleteError.message,
        hint: "Ensure wix_inventory_live table exists. Run migration 003_wix_inventory_live.sql",
        requestId
      });
    }

    // 5b. INSERT all valid items
    console.log(`🔄 [OMEN] Inserting ${valid.length} items...`, { requestId });

    // Add synced_at timestamp
    const itemsWithTimestamp = valid.map(item => ({
      ...item,
      synced_at: new Date().toISOString()
    }));

    const { data: insertedData, error: insertError } = await client
      .from('wix_inventory_live')
      .insert(itemsWithTimestamp)
      .select();

    if (insertError) {
      console.error(`🔄 [OMEN] INSERT failed:`, insertError, { requestId });
      return res.status(500).json({
        ok: false,
        error: "Failed to insert inventory items",
        message: insertError.message,
        itemsAttempted: valid.length,
        requestId
      });
    }

    const insertedCount = insertedData?.length || valid.length;
    const duration = Date.now() - startTime;

    console.log(`✅ [OMEN] WIX INVENTORY SYNC COMPLETE`, {
      requestId,
      insertedCount,
      duration: `${duration}ms`
    });

    // 6️⃣ CLEAR OLD INVENTORY CACHE
    // This forces OMEN to use fresh data on next request
    clearInventory(STORE_ID);

    return res.json({
      ok: true,
      message: `Successfully synced ${insertedCount} inventory items from Wix`,
      // Required summary format
      summary: {
        rows_processed: summary.rows_processed,
        rows_inserted: insertedCount,
        rows_skipped: summary.rows_skipped,
        skipped_breakdown: summary.skipped_breakdown
      },
      stats: {
        ...stats,
        itemsParsed: items.length,
        itemsValid: valid.length,
        itemsInvalid: invalid.length,
        itemsInserted: insertedCount,
        durationMs: duration
      },
      // Include skipped details for ops visibility
      skipped: skipped.length > 0 ? skipped.slice(0, 50) : [],
      requestId,
      syncedAt: new Date().toISOString()
    });

  } catch (err) {
    console.error(`❌ [OMEN] WIX INVENTORY SYNC FAILED`, {
      requestId,
      error: err.message,
      stack: err.stack
    });

    return res.status(500).json({
      ok: false,
      error: "Sync failed",
      message: err.message,
      requestId
    });
  }
});

/* ---------- Chat Endpoint ---------- */
/**
 * GUARDRAIL: Chat uses recommendations from generateRecommendations() ONLY.
 * - generateRecommendations() queries Supabase + temporalAnalyzer for velocity data
 * - OpenAI (LLM) is used ONLY for natural language expression, NEVER for reasoning
 * - All intelligence comes from real order velocity or inventory baseline
 * - No alternate reasoning paths may be introduced
 */
app.post("/chat", async (req, res) => {
  const requestId = createRequestId();
  const { message, conversationHistory = [] } = req.body;

  try {
    console.log("💬 [OMEN] CHAT HIT", {
      requestId,
      message,
      historyLength: conversationHistory.length,
    });

    // 1️⃣ INTENT DETECTION
    const needsInventory = detectInventoryIntent(message);
    const needsRecommendations = detectRecommendationIntent(message);

    let inventoryData = null;
    let inventoryContext = null;
    let recommendations = null;

    // 2️⃣ FETCH INVENTORY (when needed for inventory or recommendations)
    if (needsInventory || needsRecommendations) {
      console.log("💬 [OMEN] Inventory required for query", { requestId, needsRecommendations });

      try {
        // Reuse existing inventory store logic
        inventoryData = await getInventory(STORE_ID);
      } catch (err) {
        console.error("💬 [OMEN] Failed to load inventory", { requestId, error: err.message });
        return res.status(200).json({
          ok: true,
          response: "I encountered an error loading inventory data. Please try again or generate a snapshot first.",
          confidence: "low",
          reason: `Inventory load failed: ${err.message}`,
          meta: {
            requestId,
            inventoryAvailable: false,
            error: err.message
          }
        });
      }

      if (!inventoryData || inventoryData.length === 0) {
        console.warn("💬 [OMEN] Inventory unavailable", { requestId });

        return res.json({
          response: "Inventory data is currently unavailable. I can still explain how margins are calculated if you'd like.",
          confidence: "medium",
          reason: "Inventory data not available",
          nextBestAction: "Please ensure inventory has been ingested via /ingest/njweedwizard",
          conversationContext: {
            lastIntent: extractIntent(message),
            recentTopics: ["inventory", "unavailable"],
            messagesExchanged: conversationHistory.length + 1,
          },
          meta: {
            requestId,
            decision: "RESPOND_DIRECT",
            executionAllowed: false,
            inventoryRequired: true,
            inventoryAvailable: false,
          },
        });
      }

      // 3️⃣ CALCULATE INVENTORY METRICS
      inventoryContext = calculateInventoryMetrics(inventoryData);
      console.log("💬 [OMEN] Inventory context prepared", {
        requestId,
        itemCount: inventoryData.length,
        metrics: Object.keys(inventoryContext),
      });

      // 4️⃣ GENERATE RECOMMENDATIONS (if user is asking for them)
      // GUARDRAIL: This calls temporalAnalyzer (Supabase orders) or snapshot deltas
      if (needsRecommendations) {
        recommendations = generateRecommendations(inventoryData, inventoryContext);
        console.log("💬 [OMEN] Recommendations generated", {
          requestId,
          promotions: recommendations.promotions.length,
          pricing: recommendations.pricing.length,
          inventory: recommendations.inventory.length
        });
      }
    }

    // 5️⃣ GENERATE LLM RESPONSE
    // GUARDRAIL: LLM is used ONLY for language expression, NOT reasoning
    let systemPrompt = "You are OMEN, an inventory intelligence assistant. Answer the user's question clearly and concisely.";
    let userPrompt = message;

    if (needsRecommendations && recommendations) {
      systemPrompt = `You are OMEN, an inventory intelligence assistant with temporal intelligence capabilities.

RESPONSE FORMAT:
- Use plain text - NO markdown formatting, NO asterisks, NO special characters
- Keep responses concise and conversational
- Do NOT use asterisks (**) or underscores (__) for emphasis
- Present recommendations as a simple numbered list
- Be DECISIVE - rank options even with low confidence
- Label confidence explicitly (High Confidence / Medium Confidence / Early Signal)

When answering:
- Explain recommendations based on movement over time (depletion rates, velocity changes, acceleration)
- Cite delta metrics when available (quantity changes, rate changes, days until depletion)
- Explain WHY items are prioritized (velocity, acceleration, risk, margin)
- Reference signal types when available (ACCELERATING_DEPLETION, SUDDEN_DROP, STABLE_LOW_STOCK)
- Give specific actionable advice with temporal context
- NEVER say "no recommendations available" - always rank best available options

IMPORTANT: Recommendations are prioritized by velocity and acceleration first, margin second.
If you had to promote ONE product this week, which would it be? Answer decisively.

Current Recommendations Available:
- ${recommendations.promotions.length} promotion opportunities
- ${recommendations.pricing.length} pricing actions
- ${recommendations.inventory.length} inventory actions`;

      userPrompt = `User Question: ${message}\n\nRecommendations:\n${JSON.stringify(recommendations, null, 2)}`;
    } else if (needsInventory && inventoryContext) {
      systemPrompt = buildInventoryAwareSystemPrompt(inventoryContext);
      userPrompt = `User Question: ${message}\n\nInventory Data:\n${JSON.stringify(inventoryContext, null, 2)}`;
    }

    let llmResponse = null;

    try {
      llmResponse = await callLLM({
        system: systemPrompt,
        user: userPrompt,
        maxTokens: 500,
      });
    } catch (err) {
      console.error("[OMEN] LLM rate limit or failure - will use intelligent response fallback", {
        requestId,
        error: err.message,
      });
      // Don't return early - let the intelligence layer handle the response
      llmResponse = null;
    }


    // 6️⃣ INTELLIGENCE LAYER - Try insight-driven response first
    // CRITICAL: Chat MUST use the SAME snapshot object as UI
    // DO NOT re-query inventory, DO NOT re-derive metrics
    let intelligentResponse = null;
    let usingIntelligentResponse = false;
    if (needsRecommendations || needsInventory) {
      // Fetch actual snapshots from storage - this is the authoritative source
      let snapshots = [];
      try {
        snapshots = getLastSnapshots(STORE_ID, 10, null) || [];
      } catch (snapshotErr) {
        console.error("[OMEN] Failed to fetch snapshots", { requestId, error: snapshotErr.message });
        snapshots = [];
      }

      // GUARD: Empty snapshot check - return safe 200, never 500
      console.log("🧪 [OMEN] Chat snapshots debug", {
        isArray: Array.isArray(snapshots),
        length: snapshots.length,
        sample: snapshots[0]?.id || null
      });

      if (!snapshots || snapshots.length === 0) {
        console.log("💬 [OMEN] No snapshots available", { requestId });

        return res.status(200).json({
          ok: true,
          response: "No snapshot data available yet. Generate a snapshot first to enable intelligent recommendations.",
          confidence: "none",
          reason: "No snapshots generated",
          nextBestAction: "Generate a daily or weekly snapshot via the dashboard",
          meta: {
            requestId,
            snapshotsAvailable: false
          }
        });
      }

      // Chat receives BOTH daily and weekly snapshots
      // Weekly = baseline velocity (may have orders from past 7 days)
      // Daily = current signal (may have 0 orders today)
      // hasVelocity is TRUE if EITHER has order data

      const daily = dailySnapshot;
      const weekly = weeklySnapshot;

      // Velocity exists if weekly has orders (daily may be 0 for today)
      let weeklyHasVelocity = weekly?.velocity?.orderCount > 0;
      let dailyHasVelocity = daily?.velocity?.orderCount > 0;
      let hasVelocity = weeklyHasVelocity || dailyHasVelocity;
      let velocityData = weeklyHasVelocity ? weekly?.velocity : (dailyHasVelocity ? daily?.velocity : null);

      // If no snapshot velocity available, query Supabase directly
      // Try weekly first, then fall back to checking if ANY orders exist
      if (!hasVelocity && inventoryData) {
        try {
          console.log("💬 [OMEN] No snapshot velocity - querying Supabase directly");

          // First try weekly (current week)
          let liveVelocity = await analyzeInventoryVelocity(inventoryData, 'weekly');

          // If no orders this week, check if we have ANY historical orders
          if (!liveVelocity?.orderCount || liveVelocity.orderCount === 0) {
            console.log("💬 [OMEN] No orders this week - checking historical data");
            // Query orders table directly to see if ANY orders exist
            const { queryOrderEvents } = await import('./db/supabaseQueries.js');
            // Look back 90 days
            const now = new Date();
            const startDate = new Date(now);
            startDate.setDate(startDate.getDate() - 90);
            const histResult = await queryOrderEvents(startDate.toISOString(), now.toISOString());
            if (histResult?.data?.length > 0) {
              console.log("💬 [OMEN] Found historical orders:", histResult.data.length);
              // We have historical data - set velocity context
              hasVelocity = true;
              velocityData = {
                orderCount: histResult.data.length,
                uniqueSKUs: 0, // Would need line items to calculate
                hasData: true,
                message: 'Historical orders found'
              };
            }
          } else if (liveVelocity?.orderCount > 0) {
            hasVelocity = true;
            velocityData = liveVelocity;
            console.log("💬 [OMEN] Live velocity loaded:", { orderCount: liveVelocity.orderCount, uniqueSKUs: liveVelocity.uniqueSKUs });
          }
        } catch (velErr) {
          console.error("[OMEN] Failed to load live velocity", { error: velErr.message });
        }
      }

      console.log("💬 [OMEN] Chat snapshot context:", {
        hasWeekly: !!weekly,
        hasDaily: !!daily,
        weeklyOrders: weekly?.velocity?.orderCount || 0,
        dailyOrders: daily?.velocity?.orderCount || 0,
        hasVelocity,
        velocitySource: weeklyHasVelocity ? 'weekly' : (dailyHasVelocity ? 'daily' : (hasVelocity ? 'live' : 'none'))
      });

      // Build chat context - ONLY use snapshot metrics (realized margin from orders)
      // Do NOT fall back to inventoryContext (catalog margin) for margin data
      const snapshotMetrics = weekly?.metrics || daily?.metrics || null;

      const chatContext = {
        // Both snapshots available
        daily,
        weekly,
        // Velocity from best available source (snapshot or live)
        hasVelocity,
        velocity: velocityData,
        // Recommendations from snapshot ONLY (contains realized margin data)
        recommendations: weekly?.recommendations || daily?.recommendations || null,
        // Metrics from snapshot ONLY - no fallback to catalog margin
        metrics: snapshotMetrics,
        // Margin fields from snapshot ONLY - null if no snapshot
        highestMarginItem: snapshotMetrics?.highestMarginItem || null,
        itemsWithPricing: snapshotMetrics?.itemsWithPricing || inventoryContext?.itemsWithPricing || 0,
        // Flag for chat intelligence to know if margin data is available
        hasRealizedMargin: !!snapshotMetrics?.highestMarginItem
      };

      try {
        // Pass full context including weekly/daily snapshots for intelligence layer
        intelligentResponse = generateInsightResponse(message, chatContext.recommendations, chatContext, chatContext);

        // PROACTIVE LAYER: Add "what you might not be seeing" to every response
        if (intelligentResponse) {
          intelligentResponse = wrapWithProactiveInsight(intelligentResponse, chatContext);
        }
      } catch (insightErr) {
        console.error("[OMEN] Insight generation failed", { requestId, error: insightErr.message });
        intelligentResponse = null;
      }

      // Even if no direct answer, try to surface proactive insight
      if (!intelligentResponse) {
        const proactive = generateProactiveInsight(chatContext);
        if (proactive) {
          // Store proactive insight to append after LLM response
          chatContext._proactiveInsight = proactive;
        }
      }
    }

    // Use intelligent response if available, otherwise fallback to LLM/dev responses
    if (intelligentResponse) {
      llmResponse = intelligentResponse;
      usingIntelligentResponse = true;
      console.log("💬 [OMEN] Using insight-driven response with proactive layer", { requestId });
    } else if (!llmResponse) {
      // FALLBACK FOR DEV MODE (no LLM and no intelligent response)
      try {
        if (needsRecommendations && recommendations) {
          llmResponse = generateFallbackRecommendationResponseStrong(message, recommendations, inventoryContext);
        } else if (needsInventory && inventoryContext) {
          llmResponse = generateFallbackInventoryResponse(message, inventoryContext);
        } else {
          llmResponse = "How can I help you today?";
        }
      } catch (fallbackErr) {
        console.error("[OMEN] Fallback generation failed", { requestId, error: fallbackErr.message });
        llmResponse = "I'm having trouble generating a response. Please try again.";
      }
    }

    // PROACTIVE LAYER: Append insight to LLM response if we have one stored
    if (!usingIntelligentResponse && chatContext?._proactiveInsight && llmResponse) {
      llmResponse = `${llmResponse}\n\n---\n${chatContext._proactiveInsight}`;
      console.log("💬 [OMEN] Appended proactive insight to LLM response", { requestId });
    }

    // 🔥 CRITICAL: FORMAT RESPONSE BEFORE RETURNING
    // SKIP formatting for intelligent responses - they're already crafted
    if (!usingIntelligentResponse) {
      const isCalculationQuestion =
        message.toLowerCase().includes('how') &&
        message.toLowerCase().includes('calculat');

      llmResponse = formatChatResponse(llmResponse, {
        hasSalesData: true,  // System tracks temporal movement via snapshot deltas
        maxSentences: 5,  // Allow longer responses for insights
        allowFormulas: isCalculationQuestion
      });
    }

    console.log("💬 [OMEN] Response formatted", {
      requestId,
      originalLength: llmResponse ? llmResponse.length : 0,
      formattedLength: llmResponse.length
    });

    // 7️⃣ DETERMINE CONFIDENCE
    const confidence = (needsInventory || needsRecommendations) && inventoryContext ? "high" : "medium";
    const reason = needsRecommendations && recommendations
      ? `Answered using live recommendations (${recommendations.promotions.length + recommendations.pricing.length + recommendations.inventory.length} total)`
      : needsInventory && inventoryContext
      ? `Answered using live inventory data (${inventoryData.length} items)`
      : needsInventory
      ? "Inventory data not available"
      : "General query answered";

    // 8️⃣ UPDATE CONVERSATION CONTEXT
    const conversationContext = {
      lastIntent: extractIntent(message),
      recentTopics: extractTopics(message, needsInventory || needsRecommendations),
      messagesExchanged: conversationHistory.length + 1,
    };

    // 9️⃣ RESPOND
    return res.json({
      response: llmResponse,
      confidence,
      reason,
      nextBestAction: null,
      conversationContext,
      meta: {
        requestId,
        decision: "RESPOND_DIRECT",
        executionAllowed: true,
        inventoryRequired: needsInventory || needsRecommendations,
        inventoryAvailable: !!inventoryContext,
        inventoryItemCount: inventoryData ? inventoryData.length : 0,
        recommendationsProvided: !!recommendations,
        recommendationCount: recommendations
          ? recommendations.promotions.length + recommendations.pricing.length + recommendations.inventory.length
          : 0
      },
    });

  } catch (err) {
    console.error("[OMEN] CHAT ERROR", {
      requestId,
      error: err.message,
      stack: err.stack,
    });

    return res.status(500).json({
      ok: false,
      requestId,
      error: "Chat handler failed safely",
      response: "I encountered an error processing your request. Please try again.",
    });
  }
});

/**
 * Detect if user message requires inventory data
 */
function detectInventoryIntent(message) {
  if (!message || typeof message !== "string") return false;

  const lowerMessage = message.toLowerCase();

  const inventoryKeywords = [
    "margin", "profit", "inventory", "stock", "sales", "revenue",
    "cost", "price", "pricing", "skus", "items", "products",
    "performance", "sell", "sold", "movement", "turnover",
    "value", "worth", "total", "average", "highest", "lowest"
  ];

  return inventoryKeywords.some(keyword => lowerMessage.includes(keyword));
}

/**
 * Detect if user is asking for recommendations
 */
function detectRecommendationIntent(message) {
  if (!message || typeof message !== "string") return false;

  const lowerMessage = message.toLowerCase();

  const recommendationKeywords = [
    "recommend", "suggestion", "should i", "what to promote",
    "what should", "advice", "action", "bundle", "discount",
    "reorder", "priority", "focus on"
  ];

  return recommendationKeywords.some(keyword => lowerMessage.includes(keyword));
}

/**
 * Calculate inventory metrics from raw inventory data
 */
function calculateInventoryMetrics(inventory) {
  if (!Array.isArray(inventory) || inventory.length === 0) {
    return null;
  }

  // Filter items with valid pricing data
  const itemsWithPricing = inventory.filter(item =>
    item.pricing &&
    typeof item.pricing.retail === "number" &&
    typeof item.pricing.cost === "number" &&
    item.pricing.retail > 0
  );

  if (itemsWithPricing.length === 0) {
    return {
      totalItems: inventory.length,
      error: "No items with valid pricing data",
    };
  }

  // Calculate margins
  const margins = itemsWithPricing.map(item => {
    const margin = ((item.pricing.retail - item.pricing.cost) / item.pricing.retail) * 100;
    return {
      strain: item.strain,
      unit: item.unit,
      cost: item.pricing.cost,
      retailPrice: item.pricing.retail,
      margin: margin,
      quantity: item.quantity || 0,
    };
  });

  const avgMargin = margins.reduce((sum, m) => sum + m.margin, 0) / margins.length;

  const totalRevenue = itemsWithPricing.reduce((sum, item) =>
    sum + (item.pricing.retail * (item.quantity || 0)), 0
  );

  const totalCost = itemsWithPricing.reduce((sum, item) =>
    sum + (item.pricing.cost * (item.quantity || 0)), 0
  );

  const totalProfit = totalRevenue - totalCost;

  const highestMargin = margins.reduce((max, m) => m.margin > max.margin ? m : max, margins[0]);
  const lowestMargin = margins.reduce((min, m) => m.margin < min.margin ? m : min, margins[0]);

  // VALIDATION SAFEGUARD: Detect uniform pricing patterns
  const uniqueRetailPrices = new Set(margins.map(m => m.retailPrice));
  const priceVariety = uniqueRetailPrices.size / margins.length; // Ratio of unique prices to total items
  const hasPriceDiversity = priceVariety > 0.3; // At least 30% price diversity

  // VALIDATION SAFEGUARD: Detect margin clustering (many items with same margin)
  const marginGroups = new Map();
  margins.forEach(m => {
    const roundedMargin = Math.round(m.margin);
    marginGroups.set(roundedMargin, (marginGroups.get(roundedMargin) || 0) + 1);
  });
  const largestMarginGroup = Math.max(...marginGroups.values());
  const marginDiversity = largestMarginGroup / margins.length < 0.7; // Largest group < 70%

  return {
    totalItems: inventory.length,
    itemsWithPricing: itemsWithPricing.length,
    averageMargin: parseFloat(avgMargin.toFixed(2)),
    totalRevenue: parseFloat(totalRevenue.toFixed(2)),
    totalCost: parseFloat(totalCost.toFixed(2)),
    totalProfit: parseFloat(totalProfit.toFixed(2)),
    highestMarginItem: {
      name: `${highestMargin.strain} (${highestMargin.unit})`,
      margin: parseFloat(highestMargin.margin.toFixed(2)),
    },
    lowestMarginItem: {
      name: `${lowestMargin.strain} (${lowestMargin.unit})`,
      margin: parseFloat(lowestMargin.margin.toFixed(2)),
    },
    highestMarginItems: margins
      .sort((a, b) => b.margin - a.margin)
      .slice(0, 5)
      .map(m => ({
        name: `${m.strain} (${m.unit})`,
        margin: parseFloat(m.margin.toFixed(2)),
        retailPrice: m.retailPrice,
        cost: m.cost,
      })),
    // Validation flags for trust protection
    dataQuality: {
      hasPriceDiversity,
      marginDiversity,
      uniquePriceCount: uniqueRetailPrices.size,
      pricingNote: !hasPriceDiversity || !marginDiversity
        ? "Limited pricing diversity detected - items may share standard tier pricing"
        : null
    }
  };
}

/**
 * Build system prompt with inventory context
 */
function buildInventoryAwareSystemPrompt(inventoryContext) {
  return `You are OMEN, an inventory intelligence assistant.

You have access to real, live inventory data. Use this data to answer the user's question accurately.

IMPORTANT CONSTRAINTS:
- Sales volume data is NOT available - do not make claims about "best-selling" or "top-performing" items
- Rankings and insights are based on margin and stock levels only
- Use conservative, factual language - avoid speculative or causal statements
- Clearly label potential revenue as "potential" since it's based on current inventory, not actual sales

RESPONSE FORMAT:
- Use plain text - NO markdown formatting, NO asterisks for bold, NO special characters
- Keep responses concise (2-3 sentences max unless asked for detail)
- Use natural conversational language, not technical jargon
- Do NOT show calculation formulas unless explicitly asked
- Do NOT use asterisks (**) or underscores (__) for emphasis

When answering:
- Use actual numbers from the inventory data
- Explain simply and directly
- State any assumptions you make
- Be precise and factual

Current Inventory Summary:
- Total Items: ${inventoryContext.totalItems}
- Items with Pricing: ${inventoryContext.itemsWithPricing}
- Average Margin: ${inventoryContext.averageMargin}%
- Total Potential Revenue: $${inventoryContext.totalRevenue}
- Total Cost: $${inventoryContext.totalCost}
- Total Potential Profit: $${inventoryContext.totalProfit}

Answer the user's question using this data.`;
}

/**
 * Generate fallback response when LLM is unavailable
 */
function generateFallbackInventoryResponse(message, inventoryContext) {
  const lowerMessage = message.toLowerCase();

  if (lowerMessage.includes("margin")) {
    return `Based on your current inventory, your average margin is ${inventoryContext.averageMargin}%. This was calculated using cost vs retail price across ${inventoryContext.itemsWithPricing} SKUs with valid pricing data. Your highest margin item is ${inventoryContext.highestMarginItem.name} at ${inventoryContext.highestMarginItem.margin}%.`;
  }

  if (lowerMessage.includes("profit")) {
    return `Based on current inventory levels and pricing, your total potential profit is $${inventoryContext.totalProfit}. This is calculated as total revenue ($${inventoryContext.totalRevenue}) minus total cost ($${inventoryContext.totalCost}) across ${inventoryContext.itemsWithPricing} items.`;
  }

  if (lowerMessage.includes("revenue") || lowerMessage.includes("sales")) {
    return `Your total potential revenue from current inventory is $${inventoryContext.totalRevenue}, calculated by multiplying retail price × quantity for ${inventoryContext.itemsWithPricing} items with valid pricing. Note: This is potential revenue based on inventory on hand, not actual sales performance.`;
  }

  // Generic inventory summary
  return `You have ${inventoryContext.totalItems} items in inventory with an average margin of ${inventoryContext.averageMargin}%. Total potential revenue: $${inventoryContext.totalRevenue}. Total cost: $${inventoryContext.totalCost}. Total profit: $${inventoryContext.totalProfit}.`;
}

/**
 * Generate fallback recommendation response when LLM is unavailable
 */
/**
 * Stronger fallback - ALWAYS provides ranked guidance
 * GUARDRAIL: Uses ONLY data from recommendations (already computed by temporal engine)
 */
function generateFallbackRecommendationResponseStrong(message, recommendations, metrics) {
  const lowerMessage = message.toLowerCase();

  // Collect all recommendations
  const allRecs = [
    ...recommendations.promotions.map(r => ({ ...r, category: 'PROMOTE' })),
    ...recommendations.inventory.map(r => ({ ...r, category: 'RESTOCK' })),
    ...recommendations.pricing.map(r => ({ ...r, category: 'PRICE' }))
  ];

  // Sort by priority
  allRecs.sort((a, b) => (b.priorityScore || b.confidence * 100) - (a.priorityScore || a.confidence * 100));

  let response = "";

  // Promotion recommendations
  if (lowerMessage.includes("promote") || lowerMessage.includes("feature")) {
    const promoRecs = recommendations.promotions;
    if (promoRecs.length > 0) {
      const top = promoRecs[0];
      const confidence = top.confidence >= 0.7 ? 'Medium Confidence' : 'Early Signal';
      response = `Top promotion candidate: ${top.name}\n\n`;
      response += `${top.reason}\n`;
      response += `Margin: ${top.triggeringMetrics?.margin || 0}% | Stock: ${top.triggeringMetrics?.quantity || 0}\n`;
      response += `[${confidence}]\n\n`;
      if (promoRecs.length > 1) {
        response += `Also watch: ${promoRecs.slice(1, 3).map(r => r.name).join(', ')}`;
      }
    } else {
      // NEVER say "no recommendations" - rank by margin
      response = `Based on current inventory position (Early Signal):\n\n`;
      response += `If you had to promote one product this week, ${metrics.highestMarginItem?.name || 'your top margin item'} has the strongest margin at ${metrics.highestMarginItem?.margin || 0}%.\n\n`;
      response += `This is a baseline ranking - more decisive recommendations will emerge as order velocity builds.`;
    }
  }
  // Pricing recommendations
  else if (lowerMessage.includes("pricing") || lowerMessage.includes("price")) {
    if (recommendations.pricing.length > 0) {
      response = `Pricing actions:\n\n`;
      recommendations.pricing.slice(0, 2).forEach((rec, i) => {
        const conf = rec.confidence >= 0.7 ? 'Medium Confidence' : 'Early Signal';
        response += `${i + 1}. ${rec.name} - ${rec.reason} (Margin: ${rec.triggeringMetrics?.margin || 0}%) [${conf}]\n`;
      });
    } else {
      response = `Pricing looks balanced. No urgent adjustments needed based on current data.`;
    }
  }
  // Inventory/stock actions
  else if (lowerMessage.includes("reorder") || lowerMessage.includes("stock")) {
    if (recommendations.inventory.length > 0) {
      response = `Inventory actions:\n\n`;
      recommendations.inventory.slice(0, 3).forEach((rec, i) => {
        const conf = rec.confidence >= 0.7 ? 'Medium Confidence' : 'Early Signal';
        response += `${i + 1}. ${rec.name} - ${rec.reason} [${conf}]\n`;
      });
    } else {
      response = `Stock levels look stable. No urgent restocks flagged based on current velocity data.`;
    }
  }
  // General "what should I do" query
  else {
    if (allRecs.length > 0) {
      const top = allRecs[0];
      const conf = top.confidence >= 0.7 ? 'Medium Confidence' : top.confidence >= 0.5 ? 'Early Signal' : 'Low Confidence';
      response = `Top action this week:\n\n`;
      response += `${top.category}: ${top.name}\n`;
      response += `${top.reason}\n`;
      response += `[${conf}]\n\n`;
      if (allRecs.length > 1) {
        response += `${allRecs.length - 1} additional items flagged - ask me "what should I promote?" or "what should I restock?" for details.`;
      }
    } else {
      // Absolute fallback - STILL give guidance
      response = `Based on current inventory position (Baseline - Early Signal):\n\n`;
      response += `Best margin: ${metrics.highestMarginItem?.name || 'Top item'} at ${metrics.highestMarginItem?.margin || 0}%\n`;
      response += `If you had to focus on one product this week, start here.\n\n`;
      response += `More decisive recommendations will emerge as order velocity accumulates.`;
    }
  }

  return response;
}

// Keep original for backward compatibility
function generateFallbackRecommendationResponse(message, recommendations) {
  const lowerMessage = message.toLowerCase();

  let response = "";

  // Promotion recommendations
  if (lowerMessage.includes("promote") || lowerMessage.includes("feature")) {
    if (recommendations.promotions.length > 0) {
      response = `Here are my top promotion recommendations:\n\n`;
      recommendations.promotions.slice(0, 3).forEach((rec, i) => {
        response += `${i + 1}. ${rec.name} - ${rec.reason} (Margin: ${rec.triggeringMetrics.margin}%, Stock: ${rec.triggeringMetrics.quantity})\n`;
      });
    } else {
      response = "No specific promotion recommendations at this time. Your inventory levels and margins are balanced.";
    }
  }
  // Pricing recommendations
  else if (lowerMessage.includes("pricing") || lowerMessage.includes("price")) {
    if (recommendations.pricing.length > 0) {
      response = `Here are my pricing recommendations:\n\n`;
      recommendations.pricing.slice(0, 3).forEach((rec, i) => {
        response += `${i + 1}. ${rec.name} - ${rec.reason} (Current margin: ${rec.triggeringMetrics.margin}%)\n`;
      });
    } else {
      response = "Your pricing is well-balanced. No urgent pricing changes needed.";
    }
  }
  // Inventory actions
  else if (lowerMessage.includes("reorder") || lowerMessage.includes("stock")) {
    if (recommendations.inventory.length > 0) {
      response = `Here are my inventory recommendations:\n\n`;
      recommendations.inventory.slice(0, 3).forEach((rec, i) => {
        response += `${i + 1}. ${rec.name} - ${rec.reason} (Stock: ${rec.triggeringMetrics.quantity})\n`;
      });
    } else {
      response = "Your inventory levels look good. No urgent restocking needed.";
    }
  }
  // General recommendations
  else {
    const total = recommendations.promotions.length + recommendations.pricing.length + recommendations.inventory.length;

    if (total === 0) {
      return "Your inventory is in good shape. No urgent recommendations at this time.";
    }

    response = `I have ${total} recommendations for you:\n\n`;

    if (recommendations.promotions.length > 0) {
      response += `📣 ${recommendations.promotions.length} promotion opportunities\n`;
      response += `Top: ${recommendations.promotions[0].name} - ${recommendations.promotions[0].reason}\n\n`;
    }

    if (recommendations.pricing.length > 0) {
      response += `💰 ${recommendations.pricing.length} pricing actions\n`;
      response += `Top: ${recommendations.pricing[0].name} - ${recommendations.pricing[0].reason}\n\n`;
    }

    if (recommendations.inventory.length > 0) {
      response += `📦 ${recommendations.inventory.length} inventory actions\n`;
      response += `Top: ${recommendations.inventory[0].name} - ${recommendations.inventory[0].reason}\n\n`;
    }
  }

  return response;
}

/**
 * Extract intent from message
 */
function extractIntent(message) {
  if (!message) return "unknown";

  const lowerMessage = message.toLowerCase();

  if (lowerMessage.includes("margin")) return "margin analysis";
  if (lowerMessage.includes("profit")) return "profit analysis";
  if (lowerMessage.includes("revenue") || lowerMessage.includes("sales")) return "revenue analysis";
  if (lowerMessage.includes("stock") || lowerMessage.includes("inventory")) return "inventory query";
  if (lowerMessage.includes("price") || lowerMessage.includes("pricing")) return "pricing query";

  return "general query";
}

/**
 * Extract topics from message
 */
function extractTopics(message, needsInventory) {
  const topics = [];

  if (needsInventory) topics.push("inventory");

  const lowerMessage = message.toLowerCase();

  if (lowerMessage.includes("margin")) topics.push("margins");
  if (lowerMessage.includes("profit")) topics.push("profitability");
  if (lowerMessage.includes("revenue") || lowerMessage.includes("sales")) topics.push("revenue");
  if (lowerMessage.includes("price") || lowerMessage.includes("pricing")) topics.push("pricing");
  if (lowerMessage.includes("cost")) topics.push("costs");

  return topics.length > 0 ? topics : ["general"];
}

/* ---------- Inventory ---------- */
/**
 * REFRESH - Invalidate cache and force fresh data load from Supabase
 *
 * Clears 5-minute inventory cache, forcing next request to fetch fresh data
 */
app.post("/refresh", async (req, res) => {
  const requestId = crypto.randomUUID();

  try {
    console.log("🔄 [REFRESH] Cache invalidation requested", { requestId });

    // Clear inventory cache
    clearInventory();

    // Force fresh load to verify Supabase connectivity
    const inventory = await getInventory(STORE_ID);

    console.log("🔄 [REFRESH] Cache cleared, fresh data loaded", {
      requestId,
      itemCount: inventory.length,
      timestamp: new Date().toISOString()
    });

    return res.json({
      ok: true,
      message: 'Cache cleared - fresh Supabase data loaded',
      timestamp: new Date().toISOString(),
      itemsLoaded: inventory.length,
      source: 'supabase'
    });
  } catch (err) {
    console.error("🔄 [REFRESH] Failed", {
      requestId,
      error: err.message
    });

    return res.status(500).json({
      ok: false,
      error: 'Refresh failed',
      message: err.message,
      hint: 'Check SUPABASE_SECRET_API_KEY in .env and verify Supabase tables exist'
    });
  }
});

app.post("/inventory", (req, res) => {
  const { items, question } = req.body;

  const inventoryItems = normalizeInventory(
    USE_MOCK_INVENTORY ? mockInventory : items
  );

  if (!Array.isArray(inventoryItems)) {
    return res.status(400).json({ error: "items must be an array" });
  }

  const proofs = analyzeInventory(inventoryItems);
  const actions = frameActions(proofs);

  return res.json({
    message: USE_MOCK_INVENTORY
      ? "Inventory analyzed (mock)"
      : "Inventory analyzed",
    itemCount: inventoryItems.length,
    proofs,
    actions,
    question
  });
});

/* ---------- Snapshot-Based Temporal Recommendation Engine ---------- */

/**
 * Convert insights from temporal analyzer to legacy recommendation format
 */
function convertInsightsToRecommendations(insights) {
  const recommendations = {
    promotions: [],
    pricing: [],
    inventory: []
  };

  for (const insight of insights) {
    const rec = {
      sku: insight.sku,
      unit: insight.unit,
      name: insight.name,
      reason: insight.message,
      triggeringMetrics: insight.data,
      confidence: insight.priority === 'HIGH' ? 0.9 : insight.priority === 'MEDIUM' ? 0.7 : 0.5,
      action: insight.type,
      signalType: insight.type,
      severity: insight.priority,
      priorityScore: insight.priority === 'HIGH' ? 90 : insight.priority === 'MEDIUM' ? 70 : 50,
      details: insight.details,
      actionRequired: insight.action
    };

    // Categorize into appropriate buckets
    if (insight.type === 'URGENT_RESTOCK' || insight.type === 'LOW_STOCK_HIGH_MARGIN') {
      recommendations.inventory.push(rec);
    } else if (insight.type === 'HIGH_VELOCITY' || insight.type === 'ACCELERATING_DEMAND') {
      recommendations.promotions.push(rec);
    } else {
      recommendations.inventory.push(rec);
    }
  }

  return recommendations;
}

/**
 * Generate velocity-first recommendations using ONLY snapshot history
 *
 * NO external dependencies - works purely from cached snapshot comparisons
 *
 * @param {array} inventory - Inventory items (unused - we load from snapshots)
 * @param {object} metrics - Inventory metrics (unused, kept for compatibility)
 * @param {string} timeframe - 'weekly' or 'daily'
 * @returns {object} Recommendations in legacy format for backward compatibility
 */
function generateRecommendations(inventory, metrics = null, timeframe = 'weekly') {
  // Generate temporal recommendations from snapshot deltas
  const temporal = generateTemporalRecommendationsFromSnapshots(timeframe);

  if (!temporal.ok) {
    console.log('[Temporal Engine] Fallback to basic recommendations:', temporal.error);
    // Fallback: basic static recommendations
    return generateStaticRecommendations(inventory);
  }

  console.log('[Temporal Engine] Generated recommendations from', temporal.snapshotCount, 'snapshots');

  // Map to legacy format for backward compatibility with existing UI
  const recommendations = {
    promotions: temporal.recommendations.promotional.map(rec => ({
      sku: rec.sku,
      unit: rec.unit,
      name: rec.name,
      reason: rec.reason,
      triggeringMetrics: rec.citedData,
      confidence: mapConfidenceToNumeric(rec.confidence),
      action: rec.action || 'PROMOTE',
      signalType: rec.signalType,
      severity: rec.severity,
      priorityScore: rec.priorityScore
    })),
    pricing: [], // Legacy category - no longer used with temporal engine
    inventory: [
      ...temporal.recommendations.urgent.map(rec => ({
        sku: rec.sku,
        unit: rec.unit,
        name: rec.name,
        reason: rec.reason,
        triggeringMetrics: rec.citedData,
        confidence: mapConfidenceToNumeric(rec.confidence),
        action: 'REORDER_URGENT',
        signalType: rec.signalType,
        severity: rec.severity,
        priorityScore: rec.priorityScore
      })),
      ...temporal.recommendations.reorder.map(rec => ({
        sku: rec.sku,
        unit: rec.unit,
        name: rec.name,
        reason: rec.reason,
        triggeringMetrics: rec.citedData,
        confidence: mapConfidenceToNumeric(rec.confidence),
        action: 'REORDER_SOON',
        signalType: rec.signalType,
        severity: rec.severity,
        priorityScore: rec.priorityScore
      }))
    ]
  };

  return recommendations;
}

/**
 * Fallback: Static recommendations (when no snapshot history available)
 */
function generateStaticRecommendations(inventory) {
  const recommendations = {
    promotions: [],
    pricing: [],
    inventory: []
  };

  if (!Array.isArray(inventory) || inventory.length === 0) {
    return recommendations;
  }

  const itemsWithPricing = inventory.filter(item =>
    item.pricing &&
    typeof item.pricing.retail === "number" &&
    typeof item.pricing.cost === "number" &&
    item.pricing.retail > 0
  );

  for (const item of itemsWithPricing) {
    const margin = ((item.pricing.retail - item.pricing.cost) / item.pricing.retail) * 100;
    const quantity = item.quantity || 0;
    const itemName = `${item.strain} (${item.unit})`;

    // Low stock = reorder
    if (quantity > 0 && quantity <= 5) {
      recommendations.inventory.push({
        sku: item.strain,
        unit: item.unit,
        name: itemName,
        reason: "Low stock - reorder soon",
        triggeringMetrics: {
          quantity,
          margin: parseFloat(margin.toFixed(2))
        },
        confidence: 0.95,
        action: "REORDER_SOON"
      });
    }
  }

  return recommendations;
}

/**
 * Map confidence string to numeric value for backward compatibility
 */
function mapConfidenceToNumeric(confidence) {
  const map = {
    'high': 0.95,
    'medium': 0.75,
    'low': 0.50,
    'none': 0.20
  };
  return map[confidence] || 0.75;
}

/**
 * Format insights with confidence labels - makes recommendations feel decisive
 *
 * GUARDRAIL: Uses ONLY data from temporalAnalyzer (Supabase orders).
 * No AI reasoning. No mock data.
 */
function formatInsightsForDisplayWithConfidence(insights) {
  if (!insights || insights.length === 0) {
    return '\n📊 Building velocity baseline - check back after more orders flow through.\n';
  }

  let output = '';

  const high = insights.filter(i => i.priority === 'HIGH');
  const medium = insights.filter(i => i.priority === 'MEDIUM');
  const low = insights.filter(i => i.priority === 'LOW');

  if (high.length > 0) {
    output += '\n🚨 URGENT - ACT NOW:\n\n';
    high.forEach((insight, i) => {
      output += `${i + 1}. ${insight.message}\n`;
      output += `   ${insight.details}\n`;
      output += `   ➜ ${insight.action}\n`;
      output += `   [High Confidence - Real Velocity Data]\n\n`;
    });
  }

  if (medium.length > 0) {
    output += '\n📊 OPPORTUNITIES - STRONG SIGNALS:\n\n';
    medium.forEach((insight, i) => {
      output += `${i + 1}. ${insight.message}\n`;
      output += `   ${insight.details}\n`;
      output += `   ➜ ${insight.action}\n`;
      output += `   [Medium Confidence - Trend Emerging]\n\n`;
    });
  }

  if (low.length > 0) {
    output += '\n💡 EARLY SIGNALS - WORTH WATCHING:\n\n';
    low.forEach((insight, i) => {
      output += `${i + 1}. ${insight.message}\n`;
      output += `   ➜ ${insight.action}\n`;
      output += `   [Early Signal - Low Data Volume]\n\n`;
    });
  }

  return output;
}

/**
 * Format fallback recommendations with confidence - NEVER say "no recommendations"
 *
 * GUARDRAIL: Uses ONLY existing inventory data + margins.
 * Ranks best available options even with low confidence.
 * Bias: Actionable guidance > withholding advice.
 */
function formatFallbackRecommendationsWithConfidence(recommendations, metrics) {
  let output = '';

  const allRecs = [
    ...recommendations.promotions.map(r => ({ ...r, category: 'PROMOTE' })),
    ...recommendations.inventory.map(r => ({ ...r, category: 'RESTOCK' })),
    ...recommendations.pricing.map(r => ({ ...r, category: 'PRICE' }))
  ];

  if (allRecs.length === 0) {
    // STILL provide guidance - rank by margin
    output += '\n📊 BASELINE INVENTORY RANKING (Limited Data - Early Signal):\n\n';
    output += 'Order velocity data is still building. Based on current inventory position:\n\n';
    output += `➜ ${metrics.highestMarginItem?.name || 'Top margin item'} has the strongest margin (${metrics.highestMarginItem?.margin || 0}%)\n`;
    output += `   If you had to promote one product this week, start here.\n\n`;
    output += `➜ Monitor ${metrics.lowestMarginItem?.name || 'Low margin item'} - margin is thin at ${metrics.lowestMarginItem?.margin || 0}%\n`;
    output += `   Consider if pricing needs adjustment.\n\n`;
    output += `[Low Confidence - Insufficient Order History]\n`;
    output += `More decisive recommendations will emerge as order data accumulates.\n`;
    return output;
  }

  // Sort by priority score (already calculated by temporal engine)
  allRecs.sort((a, b) => (b.priorityScore || b.confidence * 100) - (a.priorityScore || a.confidence * 100));

  // Top 3 recommendations
  output += '\n📊 TOP RECOMMENDATIONS (Based on Available Data):\n\n';

  allRecs.slice(0, 3).forEach((rec, i) => {
    const confidence = rec.confidence >= 0.7 ? 'Medium Confidence' :
                      rec.confidence >= 0.5 ? 'Early Signal' :
                      'Low Confidence - Baseline Only';

    output += `${i + 1}. ${rec.category}: ${rec.name}\n`;
    output += `   ${rec.reason}\n`;
    output += `   ➜ ${rec.actionRequired || rec.action}\n`;
    output += `   [${confidence}]\n\n`;
  });

  if (allRecs.length > 3) {
    output += `\n📋 ${allRecs.length - 3} additional items flagged - see full snapshot for details.\n`;
  }

  return output;
}

/**
 * Format date for display (converts ISO to readable format)
 */
function formatDateForDisplay(isoString) {
  if (!isoString) return 'N/A';
  try {
    const date = new Date(isoString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC'
    });
  } catch (e) {
    return isoString;
  }
}

/**
 * Format snapshot for email delivery
 *
 * GUARDRAIL: This function uses ONLY data from Supabase + temporalAnalyzer.
 * OpenAI is used ONLY for language generation in chat, NEVER for recommendations.
 * No alternate intelligence paths may be introduced.
 */
function formatSnapshotEmail(snapshot) {
  // Defensive: Ensure snapshot structure exists
  const metrics = snapshot?.metrics || {};
  const recommendations = snapshot?.recommendations || { promotions: [], pricing: [], inventory: [] };
  const velocity = snapshot?.velocity || null;
  const temporal = snapshot?.temporal || {};
  const timeframe = snapshot?.timeframe || 'weekly';

  // Check if we have real order-based intelligence
  const hasRealIntelligence = temporal?.hasRealData && velocity?.insights && velocity.insights.length > 0;

  try {
    // Format dates for readability
    const periodStart = formatDateForDisplay(snapshot.dateRange?.startDate);
    const periodEnd = formatDateForDisplay(snapshot.dateRange?.endDate);
    const generatedTime = new Date(snapshot.generatedAt).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'America/New_York'
    });

    const timeframeLabel = timeframe === 'daily' ? 'Daily' : 'Weekly';

    let email = `
OMEN ${timeframeLabel} Operations Snapshot
Generated: ${generatedTime} EST
Analysis Period: ${periodStart} - ${periodEnd}

═══════════════════════════════════════
📊 BUSINESS SNAPSHOT
═══════════════════════════════════════

Total Revenue Potential: $${(metrics.totalRevenue || 0).toLocaleString()}
Total Profit Potential: $${(metrics.totalProfit || 0).toLocaleString()}
Average Margin: ${(metrics.averageMargin || 0)}%

Total SKUs: ${metrics.totalItems || 0}
${hasRealIntelligence ? `Orders Analyzed: ${velocity.orderCount}
Unique SKUs Sold: ${velocity.uniqueSKUs}` : 'Live Orders: Building baseline...'}

═══════════════════════════════════════
🎯 WHAT YOU NEED TO KNOW
═══════════════════════════════════════
`;

    if (hasRealIntelligence) {
      // Format real insights with confidence labeling
      email += formatInsightsForDisplayWithConfidence(velocity.insights);
    } else {
      // ALWAYS provide guidance, even with limited data
      email += formatFallbackRecommendationsWithConfidence(recommendations, metrics);
    }

    email += `\n═══════════════════════════════════════\n`;
    email += `Generated by OMEN Intelligence Engine\n`;
    email += `Data Source: ${hasRealIntelligence ? 'Real Order Velocity' : 'Inventory Baseline'}\n`;

    return email;

  } catch (error) {
    // NEVER fail silently - return minimal valid email
    console.error('[Email Format] Error formatting snapshot email:', error.message);

    const timeframeLabel = snapshot?.timeframe === 'daily' ? 'Daily' : 'Weekly';
    const generatedTime = new Date().toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'America/New_York'
    });

    return `
OMEN ${timeframeLabel} Operations Snapshot
Generated: ${generatedTime} EST

⚠️ Email generation encountered an error.
Please contact support or regenerate the snapshot.

Error: ${error.message}

Generated by OMEN Intelligence Engine
`;
  }
}

// Global snapshot cache (used by chat) - SEPARATE daily and weekly
let dailySnapshot = null;
let weeklySnapshot = null;

/* ---------- Weekly Snapshot Endpoint (with Historical Support) ---------- */
/**
 * Generate a snapshot with optional historical date support
 *
 * REQUEST BODY:
 * {
 *   "asOfDate": "2026-01-09",  // Optional: YYYY-MM-DD format
 *   "timeframe": "weekly"       // Optional: "daily" or "weekly" (default: "weekly")
 * }
 *
 * If asOfDate is omitted, uses current date/time (backward compatible)
 *
 * PRODUCTION NOTES:
 * - Validates asOfDate is not in future
 * - Checks cache before regenerating
 * - Persists to disk for historical retrieval
 * - Thread-safe via Node.js single-threaded model
 */
app.post("/snapshot/generate", async (req, res) => {
  const requestId = crypto.randomUUID();

  try {
    // Extract parameters (with defaults for backward compatibility)
    const {
      asOfDate = null,           // Optional: YYYY-MM-DD
      timeframe = "weekly",      // Default to weekly for backward compat
      forceRegenerate = false    // NEW: Force regeneration even if exists
    } = req.body || {};

    console.log("📸 [OMEN] Snapshot generation requested", {
      requestId,
      asOfDate,
      timeframe,
      forceRegenerate
    });

    // 1️⃣ VALIDATE INPUTS

    // Validate timeframe
    if (timeframe !== "daily" && timeframe !== "weekly") {
      return res.status(400).json({
        ok: false,
        error: "Invalid timeframe",
        message: "Timeframe must be 'daily' or 'weekly'"
      });
    }

    // Validate asOfDate (if provided)
    if (asOfDate && !validateAsOfDate(asOfDate)) {
      return res.status(400).json({
        ok: false,
        error: "Invalid asOfDate",
        message: "asOfDate must be in YYYY-MM-DD format and not in the future"
      });
    }

    // 2️⃣ CALCULATE DATE RANGE
    const dateRange = calculateDateRange(timeframe, asOfDate);
    const effectiveDate = dateRange.asOfDate; // Normalized date

    console.log("📸 [OMEN] Date range calculated", {
      requestId,
      dateRange
    });

    // 3️⃣ IDEMPOTENCY CHECK - Check if snapshot already exists
    const existingSnapshot = findExistingSnapshot(STORE_ID, timeframe, effectiveDate);

    if (existingSnapshot && !forceRegenerate) {
      console.log("📸 [OMEN] Snapshot already exists (idempotent)", {
        requestId,
        snapshotId: existingSnapshot.id,
        createdAt: existingSnapshot.createdAt
      });

      // Load from cache
      const cached = loadSnapshot(STORE_ID, timeframe, effectiveDate);

      if (cached) {
        return res.json({
          ok: true,
          snapshot: cached.snapshot,
          snapshotId: existingSnapshot.id,
          fromCache: true,
          cachedAt: cached.cachedAt,
          reason: "duplicate_prevented",
          message: "Snapshot already exists for this timeframe and date. Use forceRegenerate=true to regenerate."
        });
      }
    }

    // 4️⃣ FETCH LIVE INVENTORY (OPTIONAL - failures must NOT block snapshots)
    let inventory = [];
    let inventoryWarning = null;
    try {
      inventory = await getInventory(STORE_ID);
    } catch (err) {
      // WARN + CONTINUE - inventory is OPTIONAL, snapshots derive from orders_agg
      console.warn(`[Snapshot] ⚠️ Inventory load failed (non-fatal): ${err.message}`);
      inventoryWarning = `Inventory unavailable: ${err.message}`;
      inventory = [];
    }

    if (!inventory || inventory.length === 0) {
      console.warn('[Snapshot] ⚠️ Inventory empty or unavailable - continuing with orders_agg only');
      inventoryWarning = inventoryWarning || 'Inventory empty or unavailable';
      inventory = [];
    }

    // 5️⃣ CALCULATE METRICS (inventory-based - fallback to empty when unavailable)
    let metrics = calculateInventoryMetrics(inventory);

    // If metrics calculation fails (empty inventory), provide fallback empty metrics
    // Snapshot will still contain velocity data from orders_agg
    if (!metrics || metrics.error) {
      console.warn(`[Snapshot] ⚠️ Inventory metrics unavailable: ${metrics?.error || 'empty'} - using fallback`);
      metrics = {
        totalItems: 0,
        totalRevenue: 0,
        totalCost: 0,
        totalProfit: 0,
        averageMargin: null,
        itemsWithPricing: 0,
        itemsWithoutPricing: 0,
        warning: inventoryWarning || 'Inventory metrics unavailable'
      };
    }

    // 6️⃣ COMPUTE DELTA (from snapshot history - NO external DB needed)
    const deltaResult = computeInventoryDeltas(timeframe, 3);
    const deltas = deltaResult.ok ? {
      summary: {
        totalItems: deltaResult.deltas.length,
        accelerating: deltaResult.deltas.filter(d => d.acceleration?.isAccelerating).length,
        decelerating: deltaResult.deltas.filter(d => d.acceleration?.isDecelerating).length,
        depleting: deltaResult.deltas.filter(d => d.quantityDelta < 0).length,
        restocked: deltaResult.deltas.filter(d => d.quantityDelta > 0).length
      },
      deltas: deltaResult.deltas
    } : null;

    if (deltas) {
      console.log("📸 [OMEN] Delta computed from snapshot history", {
        requestId,
        snapshotCount: deltaResult.snapshotCount,
        totalItems: deltas.summary.totalItems,
        accelerating: deltas.summary.accelerating,
        depleting: deltas.summary.depleting
      });
    }

    // 7️⃣ ANALYZE REAL ORDER VELOCITY (from Supabase orders)
    const velocityAnalysis = await analyzeInventoryVelocity(inventory, timeframe);

    console.log("📸 [OMEN] Velocity analysis complete", {
      requestId,
      hasRealData: velocityAnalysis.ok,
      orderCount: velocityAnalysis.orderCount || 0,
      insightCount: velocityAnalysis.insights?.length || 0
    });

    // 8️⃣ GENERATE RECOMMENDATIONS (prioritize real data, fallback to deltas)
    let recommendations;
    let intelligenceSource;

    if (velocityAnalysis.ok && velocityAnalysis.insights && velocityAnalysis.insights.length > 0) {
      // Use real order-based intelligence
      recommendations = convertInsightsToRecommendations(velocityAnalysis.insights);
      intelligenceSource = 'real_orders';
      console.log("📸 [OMEN] Using REAL order-based intelligence", {
        requestId,
        insightCount: velocityAnalysis.insights.length
      });
    } else {
      // Fallback to snapshot deltas (less valuable but better than nothing)
      recommendations = generateRecommendations(inventory, metrics, timeframe);
      intelligenceSource = 'snapshot_deltas';
      console.log("📸 [OMEN] Falling back to snapshot delta intelligence", {
        requestId,
        reason: velocityAnalysis.error || 'No order data'
      });
    }

    // 9️⃣ BUILD SNAPSHOT (with real intelligence)
    const snapshot = {
      requestId,
      generatedAt: new Date().toISOString(),
      asOfDate: effectiveDate,
      dateRange,
      timeframe,
      store: STORE_ID,
      metrics,
      recommendations,
      // Real temporal intelligence
      velocity: velocityAnalysis.ok ? {
        orderCount: velocityAnalysis.orderCount,
        uniqueSKUs: velocityAnalysis.uniqueSKUs,
        insights: velocityAnalysis.insights,
        velocityMetrics: velocityAnalysis.velocityMetrics
      } : null,
      // Legacy delta analysis
      deltas: deltas ? deltas.summary : null,
      temporal: {
        intelligenceSource,
        hasRealData: velocityAnalysis.ok,
        deltaAnalysisAvailable: deltas !== null,
        snapshotCount: deltaResult.snapshotCount || 1,
        dateRange: deltaResult.ok ? {
          current: deltaResult.currentDate,
          previous: deltaResult.previousDate
        } : null,
        inventoryWarning: inventoryWarning || null
      },
      enrichedInventory: inventory,
      confidence: velocityAnalysis.ok ? "high" : "medium",
      itemCount: inventory.length
    };

    // 8️⃣ ENRICH WITH INTELLIGENCE LAYER
    // Fetch previous snapshot for comparison (if exists)
    const previousSnapshots = getLastSnapshots(STORE_ID, 2, timeframe) || [];
    const previousSnapshot = previousSnapshots.length > 1 ? loadSnapshot(STORE_ID, timeframe, previousSnapshots[1].asOfDate)?.snapshot : null;

    // Add executive-level insights
    const enrichedSnapshot = enrichSnapshotWithIntelligence(snapshot, previousSnapshot);
    Object.assign(snapshot, enrichedSnapshot);

    console.log("📸 [OMEN] Intelligence layer added", {
      requestId,
      hasExecutiveSummary: !!snapshot.intelligence?.executiveSummary,
      topSKUs: snapshot.intelligence?.topSKUs?.length || 0,
      anomalies: snapshot.intelligence?.anomalies?.length || 0
    });

    // 9️⃣ CREATE INDEX ENTRY
    const indexEntry = createSnapshotEntry(snapshot, timeframe, effectiveDate, {
      createdBy: req.body.createdBy || 'api',
      createdVia: 'api',
      regenerated: forceRegenerate
    });

    // 9️⃣ ADD TO HISTORY INDEX (with idempotency)
    const indexResult = addToIndex(indexEntry, forceRegenerate);

    // Add snapshotId to snapshot object
    snapshot.snapshotId = indexEntry.id;

    // 🔟 PERSIST SNAPSHOT TO DISK
    const cacheResult = saveSnapshot(STORE_ID, timeframe, effectiveDate, snapshot);

    if (!cacheResult.success) {
      console.warn("📸 [OMEN] Failed to cache snapshot", {
        requestId,
        snapshotId: indexEntry.id,
        error: cacheResult.error
      });
      // Continue anyway - snapshot is still valid
    }

    // 1️⃣1️⃣ UPDATE IN-MEMORY REFERENCE (for chat queries)
    // Store daily and weekly SEPARATELY - chat needs BOTH
    if (timeframe === 'daily') {
      dailySnapshot = snapshot;
      console.log("📸 [OMEN] Updated dailySnapshot", { orderCount: snapshot.velocity?.orderCount || 0 });
    } else {
      weeklySnapshot = snapshot;
      console.log("📸 [OMEN] Updated weeklySnapshot", { orderCount: snapshot.velocity?.orderCount || 0 });
    }

    console.log("📸 [OMEN] Snapshot generated successfully", {
      requestId,
      snapshotId: indexEntry.id,
      asOfDate: effectiveDate,
      timeframe,
      itemCount: inventory.length,
      promotions: recommendations.promotions.length,
      pricing: recommendations.pricing.length,
      inventory: recommendations.inventory.length,
      cached: cacheResult.success,
      indexReason: indexResult.reason
    });

    return res.json({
      ok: true,
      snapshot,
      snapshotId: indexEntry.id,
      fromCache: false,
      regenerated: forceRegenerate,
      superseded: indexResult.superseded ? indexResult.superseded.id : null
    });

  } catch (err) {
    console.error("📸 [OMEN] Snapshot generation failed", {
      requestId,
      error: err.message,
      stack: err.stack
    });

    return res.status(500).json({
      ok: false,
      requestId,
      error: "Snapshot generation failed",
      message: err.message
    });
  }
});

/* ---------- Send Snapshot Email ---------- */
/**
 * Send the most recently generated snapshot via email
 *
 * REQUEST BODY:
 * {
 *   "email": "user@example.com"  // Required: recipient email
 * }
 *
 * PRODUCTION NOTES:
 * - Always sends the LATEST cached snapshot (prevents race conditions)
 * - If no cached snapshot exists, generates current snapshot
 * - Client must call /snapshot/generate BEFORE /snapshot/send for specific dates
 * - Returns formatted email ready for n8n/email service
 *
 * RACE CONDITION PREVENTION:
 * - UI should disable "Send" button until "Generate" completes
 * - Backend always uses latest cached snapshot, never concurrent generation
 */
app.post("/snapshot/send", async (req, res) => {
  const requestId = crypto.randomUUID();
  const { email } = req.body;

  try {
    console.log("📧 [OMEN] Snapshot email requested", { requestId, email });

    // 1️⃣ VALIDATE EMAIL
    if (!email || typeof email !== "string") {
      return res.status(400).json({
        ok: false,
        error: "Email address required"
      });
    }

    // 2️⃣ PREVIEW VS SEND LOCK - Check if snapshot exists
    const latestEntry = getLatestSnapshotEntry(STORE_ID);

    if (!latestEntry) {
      // NO SNAPSHOT EXISTS - Clear error message
      return res.status(400).json({
        ok: false,
        error: "No snapshot available",
        message: "Please generate a snapshot first using POST /snapshot/generate before sending.",
        nextAction: "Call POST /snapshot/generate to create a snapshot"
      });
    }

    console.log("📧 [OMEN] Found latest snapshot", {
      requestId,
      snapshotId: latestEntry.id,
      asOfDate: latestEntry.asOfDate,
      createdAt: latestEntry.createdAt
    });

    // 3️⃣ LOAD SNAPSHOT FROM CACHE
    const cached = loadSnapshot(STORE_ID, latestEntry.timeframe, latestEntry.asOfDate);

    if (!cached) {
      // Snapshot exists in index but not in cache (data corruption)
      return res.status(500).json({
        ok: false,
        error: "Snapshot file missing",
        message: "Snapshot exists in history but file is missing. Please regenerate.",
        snapshotId: latestEntry.id
      });
    }

    const snapshot = cached.snapshot;

    // 4️⃣ FORMAT EMAIL
    const emailBody = formatSnapshotEmail(snapshot);

    // Get formatted date for subject line
    const subjectDate = snapshot.asOfDate
      ? formatDateForDisplay(snapshot.dateRange?.endDate || snapshot.asOfDate + 'T00:00:00Z')
      : formatDateForDisplay(new Date().toISOString());

    const timeframeLabel = snapshot.timeframe === 'daily' ? 'Daily' : 'Weekly';

    // 5️⃣ SEND EMAIL VIA SENDGRID
    const emailSubject = `OMEN ${timeframeLabel} Snapshot - ${subjectDate}`;

    if (!isEmailConfigured()) {
      return res.json({
        ok: true,
        emailFormatted: true,
        emailSent: false,
        deliveryStatus: "NOT_CONFIGURED",
        message: "Email formatted successfully. SendGrid NOT configured - email was NOT delivered.",
        warning: "Set SENDGRID_API_KEY and SENDGRID_FROM_EMAIL in Railway environment variables to enable email delivery",
        snapshot,
        snapshotId: latestEntry.id,
        formattedEmail: {
          to: email,
          subject: emailSubject,
          body: emailBody
        },
        snapshotDate: snapshot.asOfDate
      });
    }

    // SendGrid is configured - actually send the email
    const emailResult = await sendSnapshotEmail({
      to: email,
      subject: emailSubject,
      body: emailBody,
      snapshot
    });

    if (!emailResult.ok) {
      return res.status(500).json({
        ok: false,
        emailSent: false,
        deliveryStatus: "FAILED",
        error: emailResult.error,
        message: `Email delivery failed: ${emailResult.message}`,
        details: emailResult.details,
        snapshot,
        snapshotId: latestEntry.id
      });
    }

    // Email sent successfully
    await markAsEmailed(latestEntry.id, email);

    console.log("📧 [OMEN] Email delivered successfully", {
      requestId,
      to: email,
      messageId: emailResult.messageId,
      snapshotId: latestEntry.id
    });

    return res.json({
      ok: true,
      emailSent: true,
      deliveryStatus: "DELIVERED",
      message: "Snapshot successfully delivered to email",
      messageId: emailResult.messageId,
      deliveredAt: emailResult.deliveredAt,
      snapshot,
      snapshotId: latestEntry.id,
      snapshotDate: snapshot.asOfDate
    });

  } catch (err) {
    console.error("📧 [OMEN] Snapshot email failed", {
      requestId,
      error: err.message,
      stack: err.stack
    });

    return res.status(500).json({
      ok: false,
      requestId,
      error: "Snapshot email preparation failed",
      message: err.message
    });
  }
});

/* ---------- List Cached Snapshots ---------- */
/**
 * Get list of all cached snapshots
 *
 * Useful for UI to show historical snapshots available
 */
app.get("/snapshot/list", (req, res) => {
  try {
    const snapshots = listCachedSnapshots();

    return res.json({
      ok: true,
      snapshots,
      count: snapshots.length
    });
  } catch (err) {
    console.error("📸 [OMEN] Failed to list snapshots:", err.message);
    return res.status(500).json({
      ok: false,
      error: "Failed to list snapshots",
      message: err.message
    });
  }
});

/* ---------- Get Specific Cached Snapshot ---------- */
/**
 * Retrieve a specific cached snapshot by date
 *
 * QUERY PARAMS:
 * - asOfDate: YYYY-MM-DD (required)
 * - timeframe: "daily" or "weekly" (default: "weekly")
 */
app.get("/snapshot/get", (req, res) => {
  try {
    const { asOfDate, timeframe = "weekly" } = req.query;

    if (!asOfDate) {
      return res.status(400).json({
        ok: false,
        error: "asOfDate query parameter required"
      });
    }

    const cached = loadSnapshot(STORE_ID, timeframe, asOfDate);

    if (!cached) {
      return res.status(404).json({
        ok: false,
        error: "Snapshot not found",
        message: `No ${timeframe} snapshot found for ${asOfDate}`
      });
    }

    return res.json({
      ok: true,
      snapshot: cached.snapshot,
      cachedAt: cached.cachedAt,
      fromCache: true
    });
  } catch (err) {
    console.error("📸 [OMEN] Failed to retrieve snapshot:", err.message);
    return res.status(500).json({
      ok: false,
      error: "Failed to retrieve snapshot",
      message: err.message
    });
  }
});

/* ---------- Snapshot History Endpoints ---------- */

/**
 * GET /snapshot/history
 *
 * List snapshot history with optional filters
 *
 * QUERY PARAMS:
 * - limit: Number of results (default: 50, max: 100)
 * - timeframe: Filter by "daily" or "weekly"
 * - startDate: Filter by start date (YYYY-MM-DD)
 * - endDate: Filter by end date (YYYY-MM-DD)
 *
 * EXAMPLE:
 * GET /snapshot/history?limit=10&timeframe=weekly
 * GET /snapshot/history?startDate=2026-01-01&endDate=2026-01-10
 */
app.get("/snapshot/history", (req, res) => {
  try {
    const {
      limit = 50,
      timeframe,
      startDate,
      endDate
    } = req.query;

    // Validate limit
    const parsedLimit = Math.min(parseInt(limit) || 50, 100);

    const snapshots = listSnapshotHistory({
      limit: parsedLimit,
      timeframe,
      startDate,
      endDate
    });

    return res.json({
      ok: true,
      snapshots,
      count: snapshots.length,
      filters: {
        limit: parsedLimit,
        timeframe: timeframe || null,
        startDate: startDate || null,
        endDate: endDate || null
      }
    });
  } catch (err) {
    console.error("📸 [OMEN] Failed to list snapshot history:", err.message);
    return res.status(500).json({
      ok: false,
      error: "Failed to list snapshot history",
      message: err.message
    });
  }
});

/**
 * GET /snapshot/history/last/:count
 *
 * Get the last N snapshots (sorted by creation time)
 *
 * PARAMS:
 * - count: Number of snapshots to retrieve (default: 7, max: 50)
 *
 * QUERY PARAMS:
 * - timeframe: Filter by "daily" or "weekly"
 *
 * EXAMPLE:
 * GET /snapshot/history/last/7
 * GET /snapshot/history/last/10?timeframe=weekly
 */
app.get("/snapshot/history/last/:count?", (req, res) => {
  try {
    const count = Math.min(parseInt(req.params.count) || 7, 50);
    const { timeframe } = req.query;

    const snapshots = getLastSnapshots(count, timeframe || null);

    return res.json({
      ok: true,
      snapshots,
      count: snapshots.length,
      requested: count,
      timeframe: timeframe || 'all'
    });
  } catch (err) {
    console.error("📸 [OMEN] Failed to get last snapshots:", err.message);
    return res.status(500).json({
      ok: false,
      error: "Failed to get last snapshots",
      message: err.message
    });
  }
});

/**
 * GET /snapshot/history/range
 *
 * Get snapshots within a date range
 *
 * QUERY PARAMS:
 * - startDate: Start date (YYYY-MM-DD) - required
 * - endDate: End date (YYYY-MM-DD) - required
 * - timeframe: Filter by "daily" or "weekly" (optional)
 *
 * EXAMPLE:
 * GET /snapshot/history/range?startDate=2026-01-01&endDate=2026-01-10
 */
app.get("/snapshot/history/range", (req, res) => {
  try {
    const { startDate, endDate, timeframe } = req.query;

    // Validate required params
    if (!startDate || !endDate) {
      return res.status(400).json({
        ok: false,
        error: "Both startDate and endDate are required",
        message: "Provide startDate and endDate in YYYY-MM-DD format"
      });
    }

    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
      return res.status(400).json({
        ok: false,
        error: "Invalid date format",
        message: "Dates must be in YYYY-MM-DD format"
      });
    }

    const snapshots = getSnapshotsInRange(startDate, endDate, timeframe || null);

    return res.json({
      ok: true,
      snapshots,
      count: snapshots.length,
      range: {
        startDate,
        endDate,
        timeframe: timeframe || 'all'
      }
    });
  } catch (err) {
    console.error("📸 [OMEN] Failed to get snapshots in range:", err.message);
    return res.status(500).json({
      ok: false,
      error: "Failed to get snapshots in range",
      message: err.message
    });
  }
});

/**
 * GET /snapshot/history/stats
 *
 * Get snapshot history statistics
 *
 * Returns:
 * - Total snapshot count
 * - Count by timeframe (daily/weekly)
 * - Count by email status (sent/unsent)
 * - Latest snapshot info
 *
 * EXAMPLE:
 * GET /snapshot/history/stats
 */
app.get("/snapshot/history/stats", (req, res) => {
  try {
    const stats = getSnapshotStatistics();

    return res.json({
      ok: true,
      stats
    });
  } catch (err) {
    console.error("📸 [OMEN] Failed to get snapshot statistics:", err.message);
    return res.status(500).json({
      ok: false,
      error: "Failed to get snapshot statistics",
      message: err.message
    });
  }
});

/* ---------- Start Server (LAST) ---------- */
const PORT = process.env.PORT || 3000;

app.post("/omen/run-daily", async (req, res) => {
  console.log("🧠 OMEN daily run");

  const inventory = mockInventory;

  res.json({
    status: "ok",
    inventoryCount: inventory.length,
  });
});

/* ---------- Cron Job Endpoints (Railway Scheduled Tasks) ---------- */

/**
 * Daily snapshot cron job
 * Called by Railway cron at 8 AM EST daily
 */
app.post("/cron/daily-snapshot", async (req, res) => {
  const requestId = crypto.randomUUID();
  console.log("⏰ [CRON] Daily snapshot triggered", { requestId, source: req.body?.source });

  try {
    // Generate daily snapshot
    const inventory = await getInventory(STORE_ID);

    if (!inventory || inventory.length === 0) {
      console.error("⏰ [CRON] No inventory available for daily snapshot");
      return res.json({
        ok: false,
        error: "No inventory data available"
      });
    }

    const metrics = calculateInventoryMetrics(inventory);
    const dateRange = calculateDateRange('daily', null);
    const velocityAnalysis = await analyzeInventoryVelocity(inventory, 'daily');

    const snapshot = {
      requestId,
      generatedAt: new Date().toISOString(),
      asOfDate: dateRange.asOfDate,
      dateRange,
      timeframe: 'daily',
      store: STORE_ID,
      metrics,
      velocity: velocityAnalysis.ok ? {
        orderCount: velocityAnalysis.orderCount,
        uniqueSKUs: velocityAnalysis.uniqueSKUs,
        insights: velocityAnalysis.insights
      } : null,
      recommendations: velocityAnalysis.ok && velocityAnalysis.insights?.length > 0
        ? convertInsightsToRecommendations(velocityAnalysis.insights)
        : generateRecommendations(inventory, metrics, 'daily'),
      temporal: {
        intelligenceSource: velocityAnalysis.ok ? 'real_orders' : 'snapshot_deltas',
        hasRealData: velocityAnalysis.ok
      },
      enrichedInventory: inventory,
      confidence: velocityAnalysis.ok ? "high" : "medium",
      itemCount: inventory.length
    };

    // Save snapshot
    const indexEntry = createSnapshotEntry(snapshot, 'daily', dateRange.asOfDate, {
      createdBy: 'railway_cron',
      createdVia: 'cron'
    });

    const indexResult = addToIndex(indexEntry, false);
    if (indexResult.success) {
      saveSnapshot(STORE_ID, 'daily', dateRange.asOfDate, snapshot);
    }

    console.log("⏰ [CRON] Daily snapshot complete", {
      requestId,
      hasRealData: velocityAnalysis.ok,
      insightCount: velocityAnalysis.insights?.length || 0
    });

    return res.json({
      ok: true,
      requestId,
      snapshotId: indexEntry.id,
      hasRealIntelligence: velocityAnalysis.ok,
      insightCount: velocityAnalysis.insights?.length || 0
    });

  } catch (error) {
    console.error("⏰ [CRON] Daily snapshot failed", { requestId, error: error.message });
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

/**
 * Weekly snapshot cron job
 * Called by Railway cron on Monday at 9 AM EST
 */
app.post("/cron/weekly-snapshot", async (req, res) => {
  const requestId = crypto.randomUUID();
  console.log("⏰ [CRON] Weekly snapshot triggered", { requestId, source: req.body?.source });

  try {
    // Generate weekly snapshot
    const inventory = await getInventory(STORE_ID);

    if (!inventory || inventory.length === 0) {
      console.error("⏰ [CRON] No inventory available for weekly snapshot");
      return res.json({
        ok: false,
        error: "No inventory data available"
      });
    }

    const metrics = calculateInventoryMetrics(inventory);
    const dateRange = calculateDateRange('weekly', null);
    const velocityAnalysis = await analyzeInventoryVelocity(inventory, 'weekly');

    const snapshot = {
      requestId,
      generatedAt: new Date().toISOString(),
      asOfDate: dateRange.asOfDate,
      dateRange,
      timeframe: 'weekly',
      store: STORE_ID,
      metrics,
      velocity: velocityAnalysis.ok ? {
        orderCount: velocityAnalysis.orderCount,
        uniqueSKUs: velocityAnalysis.uniqueSKUs,
        insights: velocityAnalysis.insights,
        velocityMetrics: velocityAnalysis.velocityMetrics
      } : null,
      recommendations: velocityAnalysis.ok && velocityAnalysis.insights?.length > 0
        ? convertInsightsToRecommendations(velocityAnalysis.insights)
        : generateRecommendations(inventory, metrics, 'weekly'),
      temporal: {
        intelligenceSource: velocityAnalysis.ok ? 'real_orders' : 'snapshot_deltas',
        hasRealData: velocityAnalysis.ok
      },
      enrichedInventory: inventory,
      confidence: velocityAnalysis.ok ? "high" : "medium",
      itemCount: inventory.length
    };

    // Save snapshot
    const indexEntry = createSnapshotEntry(snapshot, 'weekly', dateRange.asOfDate, {
      createdBy: 'railway_cron',
      createdVia: 'cron'
    });

    const indexResult = addToIndex(indexEntry, false);
    if (indexResult.success) {
      saveSnapshot(STORE_ID, 'weekly', dateRange.asOfDate, snapshot);
    }

    console.log("⏰ [CRON] Weekly snapshot complete", {
      requestId,
      hasRealData: velocityAnalysis.ok,
      insightCount: velocityAnalysis.insights?.length || 0
    });

    // TODO: Send email to owner with snapshot
    // For now, just log that it's ready
    console.log("⏰ [CRON] Weekly snapshot ready for email delivery");

    return res.json({
      ok: true,
      requestId,
      snapshotId: indexEntry.id,
      hasRealIntelligence: velocityAnalysis.ok,
      insightCount: velocityAnalysis.insights?.length || 0
    });

  } catch (error) {
    console.error("⏰ [CRON] Weekly snapshot failed", { requestId, error: error.message });
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

/**
 * CLEAR AND RESYNC ORDERS: Delete all orders and re-sync with new SKU matching
 */
app.post('/api/resync-orders', async (req, res) => {
  try {
    const { getSupabaseClient, isSupabaseAvailable } = await import('./db/supabaseClient.js');
    const { syncOrdersFromWebhooks } = await import('./services/orderSyncService.js');

    if (!isSupabaseAvailable()) {
      return res.status(500).json({
        ok: false,
        error: 'Supabase not configured'
      });
    }

    const client = getSupabaseClient();

    console.log('[API] RESYNC: Deleting all existing orders...');

    // Delete ALL orders to clear old fake SKUs
    const { error: deleteError } = await client
      .from('orders')
      .delete()
      .neq('id', 0); // Delete all rows

    if (deleteError) {
      throw new Error(`Failed to clear orders: ${deleteError.message}`);
    }

    console.log('[API] RESYNC: Orders cleared, re-syncing with new SKU matching...');

    const result = await syncOrdersFromWebhooks(30); // Last 30 days

    return res.json({
      ok: true,
      ...result,
      message: `Cleared old orders and synced ${result.synced} items with real SKUs`
    });

  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});

/**
 * MANUAL ORDER SYNC: Force re-sync from webhook_events (keeps existing)
 */
app.post('/api/sync-orders', async (req, res) => {
  try {
    const { syncOrdersFromWebhooks } = await import('./services/orderSyncService.js');

    console.log('[API] Manual order sync requested');
    const result = await syncOrdersFromWebhooks(30); // Last 30 days

    return res.json({
      ok: true,
      ...result,
      message: `Synced ${result.synced} items, skipped ${result.skipped}, errors ${result.errors}`
    });

  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});

/**
 * DIAGNOSTIC: Check order sync status
 */
app.get('/api/diagnostic/orders', async (req, res) => {
  try {
    const { getSupabaseClient, isSupabaseAvailable } = await import('./db/supabaseClient.js');

    if (!isSupabaseAvailable()) {
      return res.json({
        ok: false,
        error: 'Supabase not configured',
        ordersTableExists: false,
        orderCount: 0,
        webhookEventCount: 0
      });
    }

    const client = getSupabaseClient();

    // Check orders table
    const { data: orders, error: ordersError } = await client
      .from('orders')
      .select('id, order_id, order_date, sku, strain, quantity')
      .order('order_date', { ascending: false })
      .limit(10);

    // Check webhook_events table
    const { data: webhooks, error: webhooksError } = await client
      .from('webhook_events')
      .select('id, event_type, received_at')
      .eq('event_type', 'wix.order.created')
      .order('received_at', { ascending: false })
      .limit(10);

    return res.json({
      ok: true,
      supabaseConfigured: true,
      orders: {
        count: orders?.length || 0,
        error: ordersError?.message || null,
        sample: orders || []
      },
      webhookEvents: {
        count: webhooks?.length || 0,
        error: webhooksError?.message || null,
        sample: webhooks || []
      },
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});

/* ---------- SPA Fallback (MUST BE LAST ROUTE) ---------- */
// Handle all non-API routes - serve index.html for SPA routing
// This allows frontend routes like /weekly-snapshot to work
app.get('*', (_req, res) => {
  // Only serve index.html for non-API requests
  // API routes are handled above (POST /chat, /snapshot/*, etc.)
  res.sendFile(path.join(publicPath, 'index.html'));
});

/* ---------- Start Server (LAST) ---------- */
app.listen(PORT, () => {
  console.log(`OMEN server running on port ${PORT}`);
  console.log(`Serving frontend from: ${publicPath}`);

  // STATELESS STARTUP: Snapshots are DERIVED from Supabase on-demand
  // NO disk-based snapshot loading - Railway deploys are ephemeral
  // Snapshots generated via UI trigger POST /snapshot/generate

  // Auto-sync orders from webhook_events to orders table (non-blocking)
  console.log('\n🔄 Starting background order sync...');
  autoSyncOrders()
    .then(result => console.log(`[Startup] Order sync complete: ${result.synced} synced`))
    .catch(err => console.warn('[Startup] Order sync failed:', err.message));
});

