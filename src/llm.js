import OpenAI from "openai";

let client = null;

if (process.env.OPENAI_API_KEY) {
  client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
} else {
  console.warn("⚠️ OPENAI_API_KEY not set — LLM disabled (dev mode)");
}

export async function callLLM({ system, user, maxTokens = 300 }) {
  if (!client) {
    return null; // graceful no-op for local dev
  }

  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    max_tokens: maxTokens,
    temperature: 0.2,
  });

  return response.choices[0].message.content;
}
