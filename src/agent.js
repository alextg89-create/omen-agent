export async function runAgent({ message, catalog }) {
  console.log("OMEN AGENT START");

  try {
    const intent = classifyIntent(message);

    // ===== Catalog Context (OVERRIDES menu when present) =====
    let catalogContext = "";
    let menuContext = "";

    if (Array.isArray(catalog) && catalog.length > 0) {
      catalogContext = `
PRODUCT CATALOG (LIVE STORE — SOURCE OF TRUTH)

Rules:
- Use ONLY this catalog to answer product availability questions
- If a product is marked SOLD OUT, say it is sold out
- If NO products are sold out, say that clearly
- Do NOT invent products, prices, or quantities
- Ignore any menu data if it conflicts

Catalog:
${catalog.map(p =>
  `- ${p.name} (${p.category}) — ${p.inStock ? "IN STOCK" : "SOLD OUT"}`
).join("\n")}
`;
    } else {
      const menu = await getMenu();
      menuContext = `\n\nMenu:\n${menu}`;
    }

    const messages = [
      {
        role: "system",
        content:
          SYSTEM_ANCHOR +
          `\n\nDetected Intent: ${intent}` +
          (catalogContext || menuContext)
      },
      ...memoryBuffer,
      {
        role: "user",
        content: message
      }
    ];

    // ===== HARD TIME BOUND =====
    const completion = await Promise.race([
      openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages,
        max_tokens: 400
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("LLM timeout")), 6000)
      )
    ]);

    const rawOutput =
      completion?.choices?.[0]?.message?.content ?? "";

    const output =
      typeof rawOutput === "string" && rawOutput.trim()
        ? rawOutput
        : String(REFUSAL_RESPONSE);

    // ===== Memory update =====
    memoryBuffer.push(
      { role: "user", content: message },
      { role: "assistant", content: output }
    );

    while (memoryBuffer.length > MEMORY_LIMIT * 2) {
      memoryBuffer.shift();
    }

    console.log("OMEN AGENT END");

    return {
      response: output,
      omen: {
        id: "omen-core-v1",
        intent,
        decision: "respond_to_user",
        confidence: 0.85
      }
    };

  } catch (err) {
    console.error("OMEN AGENT FAILURE:", err);

    return {
      response:
        typeof REFUSAL_RESPONSE === "string"
          ? REFUSAL_RESPONSE
          : "OMEN is temporarily unavailable.",
      omen: {
        id: "omen-core-v1",
        intent: INTENTS.GENERAL,
        decision: "fail-safe",
        confidence: 0.2
      }
    };
  }
}





