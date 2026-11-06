const axios = require("axios");
require("dotenv").config({ quiet: true });

const SYSTEM_PROMPT = "You are YUNAY AI, an expert Full-Stack Architect and Reverse Engineering Assistant.";

async function askYunayAI({ prompt, reaContext = null, provider = process.env.AI_PROVIDER || "groq" }) {
  const fullUserPrompt = reaContext
    ? "REA Report:\n" + JSON.stringify(reaContext) + "\n\nTask:\n" + prompt
    : prompt;

  if (provider === "groq" && process.env.GROQ_API_KEY) {
    const res = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: fullUserPrompt }],
      temperature: 0.2
    }, { headers: { Authorization: "Bearer " + process.env.GROQ_API_KEY } });
    return { provider: "groq", mode: "live", reply: res.data.choices[0].message.content };
  }

  if (provider === "gemini" && process.env.GEMINI_API_KEY) {
    const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + process.env.GEMINI_API_KEY;
    const res = await axios.post(url, { contents: [{ parts: [{ text: SYSTEM_PROMPT + "\n\n" + fullUserPrompt }] }] });
    return { provider: "gemini", mode: "live", reply: res.data.candidates[0].content.parts[0].text };
  }

  const stack = reaContext?.detectedTechStack || reaContext?.detectedFramework || ["Modern Web Stack"];
  return {
    provider: "yunay-local-synthesizer",
    mode: "fallback",
    reply: "[YUNAY AI Architecture Blueprint] Stack: " + stack.join(", ") + " | Task: " + prompt
  };
}

module.exports = { askYunayAI };
