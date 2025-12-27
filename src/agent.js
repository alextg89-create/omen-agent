import OpenAI from "openai";
import { SYSTEM_ANCHOR, REFUSAL_RESPONSE } from "./anchors.js";
import { getMenu } from "./tools/menuTool.js";

/* -------------------------
   Intent Definitions
------------------------- */
const INTENTS = {
  PRODUCT_DISCOVERY: "product_discovery",
  PRICING: "pricing",
  AVAILABILITY: "availability",
  GENERAL: "general",
  OUT_OF_SCOPE: "out_of_scope"
};

/* -------------------------
   Intent Classifier
   (Rule-based, deterministic)
------------------------- */
function classifyIntent(message) {
  const text = message.toLowerCase();

  if (text.includes("price") || text.includes("cost") || text.includes("$")) {
    return INTENTS.PRICING;
  }

  if (
    text.includes("available") ||
    text.includes("in stock") ||
    text.includes("have")
  ) {
    return INTENTS.AVAILABILITY;
  }

  if (
    text.includes("recommend") ||
    text.includes("looking for") ||
    text.includes("suggest")
  ) {
    return INTENTS.PRODUCT_DISCOVERY;
  }

  if (
    text.includes("cure") ||
    text.includes("medical") ||
    text.includes("treat")
  ) {
    return INTENTS.OUT_OF_SCOPE;
  }

  return INTENTS.GENERAL;
}

/* -------------------------
   Light Memory (Session)
------------------------- */
const MEMORY_LIMIT = 4;
let memoryBuffer = [];

/* -------------------------
   OpenAI Client
------------------------- */
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/* -------------------------
   Main Agent Function
------------------------- */
export async function runAgent(userMessage) {
  const menu = await getMenu();
  const intent = classifyIntent(userMessage);

  const messages = [
    {
      role: "system",
      content:
        SYSTEM_ANCHOR +
        "\n\nDetected Intent: " + intent +
        "\n\nMenu:\n" + menu
    },
    ...memoryBuffer,
    {
      role: "user",
      content: userMessage
    }
  ];

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages,
    max_tokens: 400
  });

  const output = completion.choices[0]?.message?.content;

  if (!output) {
    return {
      response: REFUSAL_RESPONSE,
      omen: {
        id: "omen-core-v1",
        intent,
        decision: "refuse_no_output",
        confidence: 0.25
      }
    };
  }

  /* -------------------------
     Update Light Memory
  ------------------------- */
  memoryBuffer.push(
    { role: "user", content: userMessage },
    { role: "assistant", content: output }
  );

  while (memoryBuffer.length > MEMORY_LIMIT) {
    memoryBuffer.shift();
  }

  return {
    response: output,
    omen: {
      id: "omen-core-v1",
      intent,
      decision: "respond_to_user",
      confidence: 0.85
    }
  };
}


