import OpenAI from "openai";
import { SYSTEM_ANCHOR, REFUSAL_RESPONSE } from "./anchors.js";
import { getMenu } from "./tools/menuTool.js";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export async function runAgent(userMessage) {
  const menu = await getMenu();

  const messages = [
    {
      role: "system",
      content: SYSTEM_ANCHOR + "\n\nMenu:\n" + menu
    },
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
    return REFUSAL_RESPONSE;
  }

  return output;
}
