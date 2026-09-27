const CODEX_MODELS = ["gpt-6-luna", "gpt-6-sol", "gpt-5.6-sol", "gpt-5.6-terra"];

export async function GET() {
  const ollamaUrl = (process.env.OLLAMA_BASE_URL || process.env.AI_BASE_URL || "").replace(/\/$/, "");
  let ollamaModels = process.env.OLLAMA_MODEL ? [process.env.OLLAMA_MODEL] : [];
  if (ollamaUrl) {
    try {
      const response = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(2500) });
      if (response.ok) {
        const data = await response.json() as { models?: Array<{ name?: string }> };
        ollamaModels = (data.models || []).map(item => item.name).filter((name): name is string => !!name);
      }
    } catch { /* Provider availability is reflected by its configured endpoint. */ }
  }
  const providers = [
    { id: "codex", label: "Codex", available: process.env.AI_PROVIDER === "codex", models: CODEX_MODELS },
    { id: "ollama", label: "Ollama", available: !!ollamaUrl, models: ollamaModels },
    { id: "openai", label: "OpenAI API", available: true, models: [process.env.OPENAI_MODEL || "gpt-4o-mini"] },
  ];
  const defaultProvider = process.env.AI_PROVIDER === "codex" ? "codex" : ollamaUrl ? "ollama" : "openai";
  const defaultModel = defaultProvider === "codex" ? process.env.CODEX_MODEL || CODEX_MODELS[0] : defaultProvider === "ollama" ? process.env.OLLAMA_MODEL || ollamaModels[0] || "" : process.env.OPENAI_MODEL || "gpt-4o-mini";
  return Response.json({ providers, defaultProvider, defaultModel, usage: { label: "Usage unavailable", usedPercent: null, lifetimeTokens: null } });
}
