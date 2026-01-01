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
app.post("/route", (req, res) => {
  const requestId = createRequestId();
  const timestamp = new Date().toISOString();

  console.log("🧠 [OMEN] Incoming routing request", {
    requestId,
    timestamp,
    input: req.body,
  });

  try {
    const result = intelligenceRouter(req.body);
    // 🔐 Phase 3 enforcement: global safety limits

// Enforce global tier ceiling
if (result.maxTier > OMEN_MAX_TIER) {
  result.maxTier = OMEN_MAX_TIER;
  result.executionAllowed = false;
}

// Enforce global execution kill switch
if (!OMEN_ALLOW_EXECUTION) {
  result.executionAllowed = false;
}

    console.log("🚦 [OMEN] Routing decision", {
      requestId,
      timestamp,
      decision: {
        allowedIntelligences: result.allowedIntelligences,
        maxTier: result.maxTier,
        executionAllowed: result.executionAllowed,
      },
    });

    res.json({
      ok: true,
      requestId,
      result,
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

/* ---------- Chat Endpoint (Wix) ---------- */
app.post("/chat", (req, res) => {
  const { message, inventory } = req.body;

  console.log("💬 [OMEN] CHAT HIT", {
    message,
    inventoryCount: Array.isArray(inventory) ? inventory.length : 0,
  });

  if (Array.isArray(inventory) && inventory.length > 0) {
    const inStockItems = inventory.filter(i => i.inStock);
    const names = inStockItems.slice(0, 5).map(i => i.name).join(", ");

    return res.json({
      response: `Here’s what I currently have in stock: ${names}.`,
    });
  }

  res.json({
    response: "How can I help you today?",
  });
});

/* ---------- Inventory ---------- */
app.post("/inventory", (req, res) => {
  const { items, question } = req.body;

  res.json({
    message: "Inventory received",
    itemCount: Array.isArray(items) ? items.length : 0,
    question,
  });
});

/* ---------- Start Server (LAST) ---------- */
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`OMEN server running on port ${PORT}`);
});
