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

    // 1️⃣ INTENT DETECTION
    const needsInventory = detectInventoryIntent(message);
    const needsRecommendations = detectRecommendationIntent(message);

    let inventoryData = null;
    let inventoryContext = null;
    let recommendations = null;

    // 2️⃣ FETCH INVENTORY (when needed for inventory or recommendations)
    if (needsInventory || needsRecommendations) {
      console.log("💬 [OMEN] Inventory required for query", { requestId, needsRecommendations });

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

      // 4️⃣ GENERATE RECOMMENDATIONS (if user is asking for them)
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
    let systemPrompt = "You are OMEN, an inventory intelligence assistant. Answer the user's question clearly and concisely.";
    let userPrompt = message;

    if (needsRecommendations && recommendations) {
      systemPrompt = `You are OMEN, an inventory intelligence assistant with access to business recommendations.

When answering:
- Explain recommendations clearly and concisely
- Prioritize by confidence level
- Give specific actionable advice
- Reference the triggering metrics when helpful

Current Recommendations Available:
- ${recommendations.promotions.length} promotion opportunities
- ${recommendations.pricing.length} pricing actions
- ${recommendations.inventory.length} inventory actions`;

      userPrompt = `User Question: ${message}\n\nRecommendations:\n${JSON.stringify(recommendations, null, 2)}`;
    } else if (needsInventory && inventoryContext) {
      systemPrompt = buildInventoryAwareSystemPrompt(inventoryContext);
      userPrompt = `User Question: ${message}\n\nInventory Data:\n${JSON.stringify(inventoryContext, null, 2)}`;
    }

    let llmResponse = await callLLM({
      system: systemPrompt,
      user: userPrompt,
      maxTokens: 500,
    });

    // 6️⃣ FALLBACK FOR DEV MODE (no LLM)
    if (!llmResponse) {
      if (needsRecommendations && recommendations) {
        llmResponse = generateFallbackRecommendationResponse(message, recommendations);
      } else if (needsInventory && inventoryContext) {
        llmResponse = generateFallbackInventoryResponse(message, inventoryContext);
      } else {
        llmResponse = "How can I help you today? (LLM unavailable - dev mode)";
      }
    }

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
 * Generate fallback recommendation response when LLM is unavailable
 */
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

/* ---------- Weekly Snapshot Recommendation Engine ---------- */

/**
 * Generate deterministic business recommendations from inventory metrics
 * NO LLM - pure calculation-based logic
 */
function generateRecommendations(inventory, metrics) {
  const recommendations = {
    promotions: [],
    pricing: [],
    inventory: []
  };

  if (!Array.isArray(inventory) || inventory.length === 0) {
    return recommendations;
  }

  // Filter items with valid pricing
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

    // PROMOTION RECOMMENDATIONS

    // High stock + decent margin = promote
    if (quantity >= 20 && margin >= 45 && margin <= 65) {
      recommendations.promotions.push({
        sku: item.strain,
        unit: item.unit,
        name: itemName,
        reason: "High stock + healthy margin",
        triggeringMetrics: {
          quantity,
          margin: parseFloat(margin.toFixed(2))
        },
        confidence: 0.85,
        action: "PROMOTE_AS_FEATURED"
      });
    }

    // High margin + low velocity = bundle opportunity
    if (margin > 65 && quantity >= 10 && quantity <= 25) {
      recommendations.promotions.push({
        sku: item.strain,
        unit: item.unit,
        name: itemName,
        reason: "High margin with moderate stock - bundle candidate",
        triggeringMetrics: {
          quantity,
          margin: parseFloat(margin.toFixed(2))
        },
        confidence: 0.75,
        action: "CREATE_BUNDLE"
      });
    }

    // PRICING RECOMMENDATIONS

    // Low margin = review pricing
    if (margin < 40) {
      recommendations.pricing.push({
        sku: item.strain,
        unit: item.unit,
        name: itemName,
        reason: "Margin below target threshold (40%)",
        triggeringMetrics: {
          margin: parseFloat(margin.toFixed(2)),
          cost: item.pricing.cost,
          retail: item.pricing.retail
        },
        confidence: 0.90,
        action: "REVIEW_PRICING"
      });
    }

    // Very high margin = protect pricing
    if (margin > 70) {
      recommendations.pricing.push({
        sku: item.strain,
        unit: item.unit,
        name: itemName,
        reason: "Premium margin - maintain pricing power",
        triggeringMetrics: {
          margin: parseFloat(margin.toFixed(2))
        },
        confidence: 0.80,
        action: "PROTECT_PRICING"
      });
    }

    // INVENTORY RECOMMENDATIONS

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

    // Very high stock = consider discount
    if (quantity > 50) {
      recommendations.inventory.push({
        sku: item.strain,
        unit: item.unit,
        name: itemName,
        reason: "High inventory - consider promotional pricing",
        triggeringMetrics: {
          quantity,
          margin: parseFloat(margin.toFixed(2))
        },
        confidence: 0.70,
        action: "CONSIDER_DISCOUNT"
      });
    }
  }

  // Sort by confidence (highest first)
  recommendations.promotions.sort((a, b) => b.confidence - a.confidence);
  recommendations.pricing.sort((a, b) => b.confidence - a.confidence);
  recommendations.inventory.sort((a, b) => b.confidence - a.confidence);

  return recommendations;
}

/**
 * Format snapshot for email delivery
 */
function formatSnapshotEmail(snapshot) {
  const { metrics, recommendations } = snapshot;

  let email = `
OMEN Weekly Operations Snapshot
Generated: ${snapshot.generatedAt}

═══════════════════════════════════════
📊 FINANCIAL METRICS
═══════════════════════════════════════

Total Items: ${metrics.totalItems}
Items with Pricing: ${metrics.itemsWithPricing}

Average Margin: ${metrics.averageMargin}%
Total Revenue: $${metrics.totalRevenue.toLocaleString()}
Total Cost: $${metrics.totalCost.toLocaleString()}
Total Profit: $${metrics.totalProfit.toLocaleString()}

Top Performer: ${metrics.highestMarginItem.name} (${metrics.highestMarginItem.margin}%)
Lowest Margin: ${metrics.lowestMarginItem.name} (${metrics.lowestMarginItem.margin}%)

═══════════════════════════════════════
💡 RECOMMENDED ACTIONS THIS WEEK
═══════════════════════════════════════
`;

  // Promotions
  if (recommendations.promotions.length > 0) {
    email += `\n🎯 PROMOTION OPPORTUNITIES (${recommendations.promotions.length}):\n\n`;
    recommendations.promotions.slice(0, 5).forEach((rec, i) => {
      email += `${i + 1}. ${rec.name}\n`;
      email += `   Action: ${rec.action}\n`;
      email += `   Reason: ${rec.reason}\n`;
      email += `   Margin: ${rec.triggeringMetrics.margin}% | Stock: ${rec.triggeringMetrics.quantity}\n`;
      email += `   Confidence: ${(rec.confidence * 100).toFixed(0)}%\n\n`;
    });
  }

  // Pricing
  if (recommendations.pricing.length > 0) {
    email += `\n💰 PRICING ACTIONS (${recommendations.pricing.length}):\n\n`;
    recommendations.pricing.slice(0, 5).forEach((rec, i) => {
      email += `${i + 1}. ${rec.name}\n`;
      email += `   Action: ${rec.action}\n`;
      email += `   Reason: ${rec.reason}\n`;
      email += `   Current Margin: ${rec.triggeringMetrics.margin}%\n`;
      email += `   Confidence: ${(rec.confidence * 100).toFixed(0)}%\n\n`;
    });
  }

  // Inventory
  if (recommendations.inventory.length > 0) {
    email += `\n📦 INVENTORY ACTIONS (${recommendations.inventory.length}):\n\n`;
    recommendations.inventory.slice(0, 5).forEach((rec, i) => {
      email += `${i + 1}. ${rec.name}\n`;
      email += `   Action: ${rec.action}\n`;
      email += `   Reason: ${rec.reason}\n`;
      email += `   Stock: ${rec.triggeringMetrics.quantity}\n`;
      email += `   Confidence: ${(rec.confidence * 100).toFixed(0)}%\n\n`;
    });
  }

  if (recommendations.promotions.length === 0 &&
      recommendations.pricing.length === 0 &&
      recommendations.inventory.length === 0) {
    email += `\nNo urgent actions identified. Inventory metrics are stable.\n`;
  }

  email += `\n═══════════════════════════════════════\n`;
  email += `Generated by OMEN Intelligence Engine\n`;
  email += `Confidence: ${snapshot.confidence}\n`;

  return email;
}

// Global snapshot cache (used by chat)
let latestSnapshot = null;

/* ---------- Weekly Snapshot Endpoint ---------- */
app.post("/snapshot/generate", async (req, res) => {
  const requestId = crypto.randomUUID();

  try {
    console.log("📸 [OMEN] Snapshot generation requested", { requestId });

    // 1. Fetch live inventory
    const inventory = getInventory("NJWeedWizard");

    if (!inventory || inventory.length === 0) {
      return res.status(400).json({
        ok: false,
        error: "No inventory data available",
        message: "Please ingest inventory via /ingest/njweedwizard first"
      });
    }

    // 2. Calculate metrics (reuse chat logic)
    const metrics = calculateInventoryMetrics(inventory);

    if (!metrics || metrics.error) {
      return res.status(400).json({
        ok: false,
        error: "Unable to calculate metrics",
        message: metrics?.error || "No items with valid pricing data"
      });
    }

    // 3. Generate recommendations
    const recommendations = generateRecommendations(inventory, metrics);

    // 4. Build snapshot
    const snapshot = {
      requestId,
      generatedAt: new Date().toISOString(),
      store: "NJWeedWizard",
      metrics,
      recommendations,
      confidence: "high",
      itemCount: inventory.length
    };

    // 5. Cache for chat queries
    latestSnapshot = snapshot;

    console.log("📸 [OMEN] Snapshot generated successfully", {
      requestId,
      itemCount: inventory.length,
      promotions: recommendations.promotions.length,
      pricing: recommendations.pricing.length,
      inventory: recommendations.inventory.length
    });

    return res.json({
      ok: true,
      snapshot
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
app.post("/snapshot/send", async (req, res) => {
  const requestId = crypto.randomUUID();
  const { email } = req.body;

  try {
    console.log("📧 [OMEN] Snapshot email requested", { requestId, email });

    if (!email || typeof email !== "string") {
      return res.status(400).json({
        ok: false,
        error: "Email address required"
      });
    }

    // Generate fresh snapshot
    const inventory = getInventory("NJWeedWizard");

    if (!inventory || inventory.length === 0) {
      return res.status(400).json({
        ok: false,
        error: "No inventory data available"
      });
    }

    const metrics = calculateInventoryMetrics(inventory);
    if (!metrics || metrics.error) {
      return res.status(400).json({
        ok: false,
        error: "Unable to calculate metrics"
      });
    }

    const recommendations = generateRecommendations(inventory, metrics);

    const snapshot = {
      requestId,
      generatedAt: new Date().toISOString(),
      store: "NJWeedWizard",
      metrics,
      recommendations,
      confidence: "high",
      itemCount: inventory.length
    };

    // Format email content
    const emailBody = formatSnapshotEmail(snapshot);

    // Return formatted email (n8n will handle actual sending)
    return res.json({
      ok: true,
      snapshot,
      email: {
        to: email,
        subject: `OMEN Weekly Snapshot - ${new Date().toLocaleDateString()}`,
        body: emailBody
      },
      message: "Snapshot prepared for email delivery"
    });

  } catch (err) {
    console.error("📧 [OMEN] Snapshot email failed", {
      requestId,
      error: err.message
    });

    return res.status(500).json({
      ok: false,
      requestId,
      error: "Snapshot email preparation failed",
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

app.listen(PORT, () => {
  console.log(`OMEN server running on port ${PORT}`);
});

