import express from "express";
import cors from "cors";

/**
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
  allowedHeaders: ["Content-Type"]
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

/* ---------- Start Server ---------- */
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`OMEN server running on port ${PORT}`);
});

app.post("/inventory", (req, res) => {
  const { items, question } = req.body;

  // TEMP: Just echo what we received
  res.json({
    message: "Inventory received",
    itemCount: Array.isArray(items) ? items.length : 0,
    question
  });
});
