import applyPricing from "./tools/applyPricing.js";
import { saveInventory, getInventory } from "./tools/inventoryStore.js";
import { aggregateInventory } from "./aggregateInventory.js";
import { detectLowStock } from "./inventorySignals.js";
import { persistInventory } from "./persistInventory.js";
import { ingestNjWeedWizardCsv } from "./njweedwizardCsvIngest.js";
import { summarizeDay } from "./summarizeDay.js";
import { frameActions } from "./frameActions.js";
import { normalizeInventory } from "./normalizeInventory.js";
import { analyzeInventory } from "./inventoryAnalyzer.js";
import { sampleInventory as mockInventory } from "./mocks/inventory.sample.js";
import { makeDecision } from "./decisionEngine.js";
import { callLLM } from "./llm.js";
import {
  evaluateGovernanceState,
  currentExecutionMode,
} from "./governance/governanceController.js";
import express from "express";
import cors from "cors";
import crypto from "crypto";
import { intelligenceRouter } from "./intelligenceRouter.js";
const OMEN_MAX_TIER = Number(process.env.OMEN_MAX_TIER ?? 1);
const OMEN_ALLOW_EXECUTION = process.env.OMEN_ALLOW_EXECUTION === "true";
const USE_MOCK_INVENTORY = process.env.OMEN_USE_MOCKS === "true";

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
app.get("/debug/inventory", (req, res) => {
  const inventory = getInventory("NJWeedWizard");

  res.json({
    ok: true,
    count: inventory ? inventory.length : 0,
    sample: inventory ? inventory.slice(0, 5) : [],
  });
});

/* ---------- Middleware ---------- */
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));

app.use(express.json());

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
    saveInventory("NJWeedWizard", aggregated);

    // 6️⃣ Optional signals
    const lowStock = detectLowStock(aggregated);

    return res.json({
      ok: true,
      store: "NJWeedWizard",
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

/* ---------- Chat Endpoint ---------- */
app.post("/chat", async (req, res) => {
  const requestId = createRequestId();
  const { message, conversationHistory = [] } = req.body;

  try {
    console.log("💬 [OMEN] CHAT HIT", {
      requestId,
      message,
      historyLength: conversationHistory.length,
    });

    // 1️⃣ INTENT DETECTION - Check if inventory data is required
    const needsInventory = detectInventoryIntent(message);

    let inventoryData = null;
    let inventoryContext = null;

    // 2️⃣ FETCH INVENTORY (only when needed)
    if (needsInventory) {
      console.log("💬 [OMEN] Inventory required for query", { requestId });

      // Reuse existing inventory store logic
      inventoryData = getInventory("NJWeedWizard");

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
    }

    // 4️⃣ GENERATE LLM RESPONSE (with or without inventory)
    const systemPrompt = needsInventory && inventoryContext
      ? buildInventoryAwareSystemPrompt(inventoryContext)
      : "You are OMEN, an inventory intelligence assistant. Answer the user's question clearly and concisely.";

    const userPrompt = needsInventory && inventoryContext
      ? `User Question: ${message}\n\nInventory Data:\n${JSON.stringify(inventoryContext, null, 2)}`
      : message;

    let llmResponse = await callLLM({
      system: systemPrompt,
      user: userPrompt,
      maxTokens: 500,
    });

    // 5️⃣ FALLBACK FOR DEV MODE (no LLM)
    if (!llmResponse) {
      if (needsInventory && inventoryContext) {
        llmResponse = generateFallbackInventoryResponse(message, inventoryContext);
      } else {
        llmResponse = "How can I help you today? (LLM unavailable - dev mode)";
      }
    }

    // 6️⃣ DETERMINE CONFIDENCE
    const confidence = needsInventory && inventoryContext ? "high" : "medium";
    const reason = needsInventory && inventoryContext
      ? `Answered using live inventory data (${inventoryData.length} items)`
      : needsInventory
      ? "Inventory data not available"
      : "General query answered";

    // 7️⃣ UPDATE CONVERSATION CONTEXT
    const conversationContext = {
      lastIntent: extractIntent(message),
      recentTopics: extractTopics(message, needsInventory),
      messagesExchanged: conversationHistory.length + 1,
    };

    // 8️⃣ RESPOND
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
        inventoryRequired: needsInventory,
        inventoryAvailable: !!inventoryContext,
        inventoryItemCount: inventoryData ? inventoryData.length : 0,
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
 * Calculate inventory metrics from raw inventory data
 */
function calculateInventoryMetrics(inventory) {
  if (!Array.isArray(inventory) || inventory.length === 0) {
    return null;
  }

  // Filter items with valid pricing data
  const itemsWithPricing = inventory.filter(item =>
    item.pricing &&
    typeof item.pricing.retailPrice === "number" &&
    typeof item.pricing.cost === "number" &&
    item.pricing.retailPrice > 0
  );

  if (itemsWithPricing.length === 0) {
    return {
      totalItems: inventory.length,
      error: "No items with valid pricing data",
    };
  }

  // Calculate margins
  const margins = itemsWithPricing.map(item => {
    const margin = ((item.pricing.retailPrice - item.pricing.cost) / item.pricing.retailPrice) * 100;
    return {
      strain: item.strain,
      unit: item.unit,
      cost: item.pricing.cost,
      retailPrice: item.pricing.retailPrice,
      margin: margin,
      quantity: item.quantity || 0,
    };
  });

  const avgMargin = margins.reduce((sum, m) => sum + m.margin, 0) / margins.length;

  const totalRevenue = itemsWithPricing.reduce((sum, item) =>
    sum + (item.pricing.retailPrice * (item.quantity || 0)), 0
  );

  const totalCost = itemsWithPricing.reduce((sum, item) =>
    sum + (item.pricing.cost * (item.quantity || 0)), 0
  );

  const totalProfit = totalRevenue - totalCost;

  const highestMargin = margins.reduce((max, m) => m.margin > max.margin ? m : max, margins[0]);
  const lowestMargin = margins.reduce((min, m) => m.margin < min.margin ? m : min, margins[0]);

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
    topItems: margins
      .sort((a, b) => b.margin - a.margin)
      .slice(0, 5)
      .map(m => ({
        name: `${m.strain} (${m.unit})`,
        margin: parseFloat(m.margin.toFixed(2)),
        retailPrice: m.retailPrice,
        cost: m.cost,
      })),
  };
}

/**
 * Build system prompt with inventory context
 */
function buildInventoryAwareSystemPrompt(inventoryContext) {
  return `You are OMEN, an inventory intelligence assistant.

You have access to real, live inventory data. Use this data to answer the user's question accurately.

When answering:
- Use actual numbers from the inventory data
- Explain your calculations clearly
- State any assumptions you make
- Be precise and factual

Current Inventory Summary:
- Total Items: ${inventoryContext.totalItems}
- Items with Pricing: ${inventoryContext.itemsWithPricing}
- Average Margin: ${inventoryContext.averageMargin}%
- Total Revenue: $${inventoryContext.totalRevenue}
- Total Cost: $${inventoryContext.totalCost}
- Total Profit: $${inventoryContext.totalProfit}

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
    return `Your total potential revenue from current inventory is $${inventoryContext.totalRevenue}, calculated by multiplying retail price × quantity for ${inventoryContext.itemsWithPricing} items with valid pricing.`;
  }

  // Generic inventory summary
  return `You have ${inventoryContext.totalItems} items in inventory with an average margin of ${inventoryContext.averageMargin}%. Total potential revenue: $${inventoryContext.totalRevenue}. Total cost: $${inventoryContext.totalCost}. Total profit: $${inventoryContext.totalProfit}.`;
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

app.listen(PORT, () => {
  console.log(`OMEN server running on port ${PORT}`);
});

