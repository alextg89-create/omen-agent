import { makeDecision } from "./decisionEngine.js";
import { callLLM } from "./llm.js";
import express from "express";
import cors from "cors";
import crypto from "crypto";
import { intelligenceRouter } from "./intelligenceRouter.js";
const OMEN_MAX_TIER = Number(process.env.OMEN_MAX_TIER ?? 1);
const OMEN_ALLOW_EXECUTION = process.env.OMEN_ALLOW_EXECUTION === "true";

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
const decision = makeDecision({
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

/* ---------- Ingest (optional, safe) ---------- */
app.post("/ingest", (req, res) => {
  console.log("📥 [OMEN] INGEST HIT", req.body);

  res.json({
    status: "ok",
    anchor_loaded: true,
    received_at: new Date().toISOString(),
  });
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

  return res.json({
    message: "Inventory received",
    itemCount: Array.isArray(items) ? items.length : 0,
    question,
  });
});

/* ---------- Start Server (LAST) ---------- */
const PORT = process.env.PORT || 3000;

app.post("/omen/run-daily", async (req, res) => {
  console.log("OMEN daily run hit", req.body);

  res.json({
    status: "ok",
    message: "OMEN daily check completed"
  });
});

app.listen(PORT, () => {
  console.log(`OMEN server running on port ${PORT}`);
});

