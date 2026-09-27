export async function GET() {
  if (process.env.AI_PROVIDER === "codex") return Response.json({ label: `Codex · ${process.env.CODEX_MODEL || "default model"}` });
  if (process.env.OLLAMA_BASE_URL || process.env.AI_BASE_URL) return Response.json({ label: `Ollama · ${process.env.OLLAMA_MODEL || "default model"}` });
  return Response.json({ label: "Demo mode" });
}
