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

/* ---------- Chat Endpoint (Wix calls this) ---------- */
app.post("/chat", (req, res) => {
  console.log("OMEN CHAT HIT");
  console.log("Payload:", req.body);

  res.json({
    response: "Test response from OMEN. Connection successful.",
    catalogCount: Array.isArray(req.body.catalog)
      ? req.body.catalog.length
      : 0
  });
});

/* ---------- Start Server ---------- */
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`OMEN server running on port ${PORT}`);
});