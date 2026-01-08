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

// 🟢 5. LOG FINAL DECISION
console.log("🟢 [OMEN] Final decision", {
  requestId,
  timestamp,
  decision,
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
app.post("/chat", (req, res) => {
  const requestId = createRequestId();
  const { message, inventory } = req.body;

  try {
    console.log("💬 [OMEN] CHAT HIT", {
      requestId,
      message,
      inventoryCount: Array.isArray(inventory) ? inventory.length : 0,
    });

    // Inventory-aware response
    if (Array.isArray(inventory) && inventory.length > 0) {
      const inStockItems = inventory.filter(i => i.inStock);
      const names = inStockItems.slice(0, 5).map(i => i.name).join(", ");

      return res.json({
        response: `Here’s what I currently have in stock: ${names}.`,
        confidence: "high",
        reason: "Live inventory data provided",
        nextBestAction: null,
        meta: {
          requestId,
          decision: "RESPOND_DIRECT",
          executionAllowed: true,
        },
      });
    }

    // Default safe response (no inventory)
    return res.json({
      response: "How can I help you today?",
      confidence: "medium",
      reason: "No inventory data provided",
      nextBestAction: null,
      meta: {
        requestId,
        decision: "RESPOND_DIRECT",
        executionAllowed: true,
      },
    });

  } catch (err) {
    console.error("[OMEN] CHAT ERROR", {
      requestId,
      error: err.message,
    });

    return res.status(500).json({
      ok: false,
      requestId,
      error: "Chat handler failed safely",
    });
  }
});

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

