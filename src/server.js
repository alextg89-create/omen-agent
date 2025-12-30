process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION:", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("UNHANDLED PROMISE REJECTION:", reason);
});

import express from "express";
import cors from "cors";
import { runAgent } from "./agent.js";

const app = express();

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type']
}));

app.use(express.json());

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "omen-agent",
    timestamp: new Date().toISOString()
  });
});

app.post("/ingest", (req, res) => {
  console.log("OMEN INGEST HIT");
  console.log("Payload:", req.body);

  res.json({
    status: "ok",
    anchor_loaded: true,
    received_at: new Date().toISOString()
  });
});

app.post("/chat", (req, res) => {
  console.log("OMEN CHAT HIT");
  console.log("Payload:", req.body);

  res.json({
    response: "Test response from OMEN. Connection successful.",
    catalogCount: req.body.catalog?.length ?? 0
  });
});

  } catch (err) {
    console.error(err);
    res.status(500).json({
      response: "I'm having trouble right now. Please try again."
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`OMEN running on port ${PORT}`);
});
