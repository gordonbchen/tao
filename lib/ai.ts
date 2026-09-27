export type Difficulty = "easy" | "okay" | "hard";
export type Rating = Difficulty | "could_not_solve";
export type Correctness = "correct" | "partial" | "incorrect" | "uncertain";
export type AiProvider = "openai" | "ollama" | "codex";
export type AiOptions = { provider?: AiProvider; model?: string };

export function aiOptionsFromRequest(request: Request): AiOptions {
  const provider = request.headers.get("x-tao-ai-provider");
  const model = request.headers.get("x-tao-ai-model")?.trim();
  return { provider: provider === "codex" || provider === "ollama" || provider === "openai" ? provider : undefined, model: model || undefined };
}

export type GeneratedProblem = {
  prompt: string;
  solution: string;
  hints: string[];
  sourceRefs: string[];
  provider: AiProvider;
  model: string;
};

type Context = { subject: string; topic: string; difficulty: Difficulty; excerpts: string[] };

const CODEX_MODELS = new Set(["gpt-6-luna", "gpt-6-sol", "gpt-5.6-sol", "gpt-5.6-terra"]);

function selectedModel(provider: AiProvider, requested?: string) {
  const fallback = provider === "codex" ? process.env.CODEX_MODEL || "gpt-6-luna" : provider === "ollama" ? process.env.OLLAMA_MODEL || "qwen2.5:3b" : process.env.OPENAI_MODEL || "gpt-4o-mini";
  if (!requested) return fallback;
  if (provider === "codex") return CODEX_MODELS.has(requested) ? requested : fallback;
  if (provider === "openai") return /^[a-zA-Z0-9._-]{1,80}$/.test(requested) ? requested : fallback;
  return /^[a-zA-Z0-9._:/-]{1,120}$/.test(requested) ? requested : fallback;
}

async function openAiJson<T>(apiKey: string, model: string, system: string, input: string): Promise<T> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: system }, { role: "user", content: input }]
    }),
    signal: AbortSignal.timeout(45000)
  });
  if (!response.ok) throw new Error(`AI provider returned ${response.status}`);
  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("AI provider returned an empty response");
  return JSON.parse(content) as T;
}

async function ollamaJson<T>(model: string, system: string, input: string): Promise<T> {
  const baseUrl = (process.env.OLLAMA_BASE_URL || process.env.AI_BASE_URL || "").replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      format: "json",
      messages: [{ role: "system", content: system }, { role: "user", content: input }]
    }),
    signal: AbortSignal.timeout(120000)
  });
  if (!response.ok) throw new Error(`Local model returned ${response.status}`);
  const data = await response.json() as { message?: { content?: string } };
  if (!data.message?.content) throw new Error("Local model returned an empty response");
  return JSON.parse(data.message.content) as T;
}

async function codexJson<T>(kind: string, model: string, system: string, input: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ socketPath: "/run/tao-codex/socket", path: "/infer", method: "POST", headers: { "Content-Type": "application/json" }, timeout: 190_000 }, response => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", chunk => { body += chunk; if (body.length > 64_000) request.destroy(new Error("Codex response too large")); });
      response.on("end", () => {
        try {
          const parsed = JSON.parse(body);
          if (response.statusCode !== 200) return reject(new Error(parsed.error || "Codex request failed"));
          resolve(parsed as T);
        } catch { reject(new Error("Codex returned invalid JSON")); }
      });
    });
    request.on("timeout", () => request.destroy(new Error("Codex request timed out")));
    request.on("error", () => reject(new Error("Codex is unavailable. Start the local-codex Docker profile and sign in to Codex.")));
    request.end(JSON.stringify({ kind, system, input, model }));
  });
}

export function hasAiProvider(apiKey?: string, options: AiOptions = {}) {
  const provider = options.provider || (apiKey ? "openai" : process.env.AI_PROVIDER || (process.env.OLLAMA_BASE_URL || process.env.AI_BASE_URL ? "ollama" : undefined));
  return provider === "openai" ? !!apiKey : provider === "codex" ? process.env.AI_PROVIDER === "codex" : provider === "ollama" ? !!(process.env.OLLAMA_BASE_URL || process.env.AI_BASE_URL) : false;
}

async function jsonFromConfiguredProvider<T>(apiKey: string | undefined, system: string, input: string, kind: string, options: AiOptions = {}): Promise<{ value: T; provider: AiProvider; model: string }> {
  const provider: AiProvider | undefined = options.provider || (apiKey ? "openai" : process.env.AI_PROVIDER as AiProvider) || ((process.env.OLLAMA_BASE_URL || process.env.AI_BASE_URL) ? "ollama" : undefined);
  if (!provider || !hasAiProvider(apiKey, { ...options, provider })) throw new Error("No AI provider configured. Choose a provider in Settings.");
  const model = selectedModel(provider, options.model);
  if (provider === "openai" && apiKey) return { value: await openAiJson<T>(apiKey, model, system, input), provider, model };
  if (provider === "codex") return { value: await codexJson<T>(kind, model, system, input), provider, model };
  if (provider === "ollama") return { value: await ollamaJson<T>(model, system, input), provider, model };
  throw new Error("No AI provider configured");
}

export async function generateProblem(context: Context, apiKey?: string, options: AiOptions = {}): Promise<GeneratedProblem> {
  const { value: result, provider, model } = await jsonFromConfiguredProvider<Omit<GeneratedProblem, "provider" | "model">>(apiKey,
    "Create one accurate educational problem strictly within the supplied course coverage. Return JSON with prompt, solution, hints (3 short incremental strings), sourceRefs (array of source labels). Use \\(...\\) for inline TeX and \\[...\\] for display TeX. Never claim a topic is covered if the materials do not support it.",
    JSON.stringify(context), "problem", options);
  if (typeof result.prompt !== "string" || typeof result.solution !== "string" || !Array.isArray(result.hints)) throw new Error("AI response did not match the expected problem format");
  return { prompt: result.prompt, solution: result.solution, hints: result.hints.filter((x): x is string => typeof x === "string").slice(0, 3), sourceRefs: Array.isArray(result.sourceRefs) ? result.sourceRefs.filter((x): x is string => typeof x === "string") : [], provider, model };
}

export async function checkAnswer(problem: { prompt: string; solution: string }, answer: string, apiKey?: string, options: AiOptions = {}): Promise<{ feedback: string; correctness: Correctness }> {
  const { value: result } = await jsonFromConfiguredProvider<{ feedback: string; correctness: Correctness }>(apiKey,
    "Give careful educational feedback on a student's answer. Mathematical reasoning can be ambiguous: use uncertain when the available work is insufficient. Return JSON with feedback and correctness, one of correct, partial, incorrect, uncertain. Use \\(...\\) for inline TeX and \\[...\\] for display TeX. Do not overstate certainty.",
    JSON.stringify({ problem: problem.prompt, referenceSolution: problem.solution, studentAnswer: answer }), "feedback", options);
  const valid = ["correct", "partial", "incorrect", "uncertain"].includes(result.correctness);
  if (typeof result.feedback !== "string" || !valid) return { correctness: "uncertain", feedback: "I couldn't reliably assess this response. Compare it with the solution and use your judgment." };
  return { feedback: result.feedback.slice(0, 4000), correctness: result.correctness };
}

export async function suggestHint(problem: { prompt: string; solution: string }, studentMessage: string, previousHints: string[], apiKey?: string, options: AiOptions = {}) {
  const { value } = await jsonFromConfiguredProvider<{ hint: string }>(apiKey,
    "Act as a patient tutor. Give one small, incremental hint that responds to where the student is stuck. Do not reveal the answer or full solution. Return JSON with a single hint string. Use \\(...\\) for inline TeX and \\[...\\] for display TeX.",
    JSON.stringify({ problem: problem.prompt, solution: problem.solution, earlierHints: previousHints, studentMessage }), "hint", options);
  return typeof value.hint === "string" ? value.hint.slice(0, 1200) : undefined;
}

export async function generateStructuredText(kind: "resource_summary" | "topic_summary", system: string, input: string, apiKey?: string, options: AiOptions = {}) {
  return jsonFromConfiguredProvider<unknown>(apiKey, system, input, kind, options);
}
import { request as httpRequest } from "node:http";
