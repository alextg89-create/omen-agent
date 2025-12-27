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

app.post("/chat", async (req, res) => {
  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Message required" });
    }

    const response = await runAgent(message);

    res.json({
      response: response,
      omen: {
        id: "omen-core-v1",
        intent: "general_assistance",
        decision: "respond_to_user",
        confidence: 0.85
      }
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
