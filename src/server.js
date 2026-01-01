import express from "express";
import cors from "cors";
import { intelligenceRouter } from "./intelligenceRouter.js";

/*
 * ===============================
 * OMEN SERVER — STABLE BASELINE
 * ===============================
 * - No agent logic yet
 * - No try/catch blocks
 * - Guaranteed to boot
 * - Guaranteed to return JSON
 */

const app = express();

/* ---------- Middleware ---------- */
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization"
  ]
}));

app.use(express.json());

/* ---------- Health Check ---------- */
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "omen-agent",
    timestamp: new Date().toISOString()
  });
});

app.post("/router", (req, res) => {
  const decision = intelligenceRouter(req.body);

  res.json({
    status: "ok",
    router: decision,
  });
});

/* ---------- Ingest (optional, safe) ---------- */
app.post("/ingest", (req, res) => {
  console.log("OMEN INGEST HIT");
  console.log("Payload:", req.body);

  res.json({
    status: "ok",
    anchor_loaded: true,
    received_at: new Date().toISOString()
  });
});

/* ---------- DEV LOGIN (TEMPORARY) ---------- */
app.post("/auth/dev-login", (req, res) => {
  console.log("DEV LOGIN HIT");

  res.json({
    token: "dev-token",
    businesses: [
      {
        id: "dev-biz-1",
        name: "NJWeedWizard (Dev)"
      }
    ]
  });
});

/* ---------- Chat Endpoint (Wix calls this) ---------- */
app.post("/chat", (req, res) => {
  const { message, inventory } = req.body;

  console.log("OMEN CHAT HIT");
  console.log("Message:", message);
  console.log("Inventory count:", Array.isArray(inventory) ? inventory.length : 0);

  // If inventory is provided, use it
  if (Array.isArray(inventory) && inventory.length > 0) {
    const inStockItems = inventory.filter(i => i.inStock);

    const names = inStockItems.slice(0, 5).map(i => i.name).join(", ");

    res.json({
      response: `Here’s what I currently have in stock: ${names}.`
    });
    return;
  }

  // Default response (no inventory needed)
  res.json({
    response: "How can I help you today?"
  });
});

/* ---------- Middleware ---------- */
app.use(express.json());

/* ---------- Routes ---------- */

app.post("/route", (req, res) => {
  try {
    const result = intelligenceRouter(req.body);
    res.json({ ok: true, result });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err.message,
    });
  }
});

app.post("/inventory", (req, res) => {
  const { items, question } = req.body;

  res.json({
    message: "Inventory received",
    itemCount: Array.isArray(items) ? items.length : 0,
    question,
  });
});

/* ---------- Start Server ---------- */
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`OMEN server running on port ${PORT}`);
});
