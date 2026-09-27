export type Difficulty = "easy" | "okay" | "hard";
export type Rating = Difficulty | "could_not_solve";
export type Correctness = "correct" | "partial" | "incorrect" | "uncertain";

export type GeneratedProblem = {
  prompt: string;
  solution: string;
  hints: string[];
  sourceRefs: string[];
  provider: "openai" | "ollama" | "demo";
};

type Context = { subject: string; topic: string; difficulty: Difficulty; excerpts: string[] };

function demoProblem(context: Context): GeneratedProblem {
  const topic = context.topic;
  return {
    prompt: `Explain the main definition or result from “${topic}” in your own words. Then give a concrete example and explain why it satisfies the definition. Aim for a ${context.difficulty} problem.`,
    solution: `A good answer should state the relevant definition precisely, identify each condition in the example, and show how those conditions are met. Use the terminology and conventions from your ${context.subject} course.`,
    hints: [
      `Start by writing down the definition of ${topic} that your course uses.`,
      "Check every condition in the definition one at a time, then explain why your example meets it.",
      "Compare your example against a nearby case that fails one condition; this often clarifies the definition."
    ],
    sourceRefs: [],
    provider: "demo"
  };
}

async function openAiJson<T>(apiKey: string, system: string, input: string): Promise<T> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
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

async function ollamaJson<T>(system: string, input: string): Promise<T> {
  const baseUrl = (process.env.OLLAMA_BASE_URL || process.env.AI_BASE_URL || "").replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OLLAMA_MODEL || "qwen2.5:3b",
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

async function jsonFromConfiguredProvider<T>(apiKey: string | undefined, system: string, input: string): Promise<{ value: T; provider: "openai" | "ollama" }> {
  if (apiKey) return { value: await openAiJson<T>(apiKey, system, input), provider: "openai" };
  if (process.env.OLLAMA_BASE_URL || process.env.AI_BASE_URL) return { value: await ollamaJson<T>(system, input), provider: "ollama" };
  throw new Error("No AI provider configured");
}

export async function generateProblem(context: Context, apiKey?: string): Promise<GeneratedProblem> {
  if (!apiKey && !process.env.OLLAMA_BASE_URL && !process.env.AI_BASE_URL) return demoProblem(context);
  const { value: result, provider } = await jsonFromConfiguredProvider<Omit<GeneratedProblem, "provider">>(apiKey,
    "Create one accurate educational problem strictly within the supplied course coverage. Return JSON with prompt, solution, hints (3 short incremental strings), sourceRefs (array of source labels). Never claim a topic is covered if the materials do not support it.",
    JSON.stringify(context));
  if (typeof result.prompt !== "string" || typeof result.solution !== "string" || !Array.isArray(result.hints)) throw new Error("AI response did not match the expected problem format");
  return { prompt: result.prompt, solution: result.solution, hints: result.hints.filter((x): x is string => typeof x === "string").slice(0, 3), sourceRefs: Array.isArray(result.sourceRefs) ? result.sourceRefs.filter((x): x is string => typeof x === "string") : [], provider };
}

export async function checkAnswer(problem: { prompt: string; solution: string }, answer: string, apiKey?: string): Promise<{ feedback: string; correctness: Correctness }> {
  if (!apiKey && !process.env.OLLAMA_BASE_URL && !process.env.AI_BASE_URL) return { correctness: "uncertain", feedback: "Your attempt is saved. The local demo has no AI answer checker, so compare your reasoning with the solution when you are ready to reveal it." };
  const { value: result } = await jsonFromConfiguredProvider<{ feedback: string; correctness: Correctness }>(apiKey,
    "Give careful educational feedback on a student's answer. Mathematical reasoning can be ambiguous: use uncertain when the available work is insufficient. Return JSON with feedback and correctness, one of correct, partial, incorrect, uncertain. Do not overstate certainty.",
    JSON.stringify({ problem: problem.prompt, referenceSolution: problem.solution, studentAnswer: answer }));
  const valid = ["correct", "partial", "incorrect", "uncertain"].includes(result.correctness);
  if (typeof result.feedback !== "string" || !valid) return { correctness: "uncertain", feedback: "I couldn't reliably assess this response. Compare it with the solution and use your judgment." };
  return { feedback: result.feedback.slice(0, 4000), correctness: result.correctness };
}

export async function suggestHint(problem: { prompt: string; solution: string }, studentMessage: string, previousHints: string[], apiKey?: string) {
  if (!apiKey && !process.env.OLLAMA_BASE_URL && !process.env.AI_BASE_URL) return undefined;
  const { value } = await jsonFromConfiguredProvider<{ hint: string }>(apiKey,
    "Act as a patient tutor. Give one small, incremental hint that responds to where the student is stuck. Do not reveal the answer or full solution. Return JSON with a single hint string.",
    JSON.stringify({ problem: problem.prompt, solution: problem.solution, earlierHints: previousHints, studentMessage }));
  return typeof value.hint === "string" ? value.hint.slice(0, 1200) : undefined;
}
