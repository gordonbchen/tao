import { AI_PROVIDERS, callBridge, defaultModelFor, type AiProvider } from "@/lib/ai";

type Health = { signedIn: boolean; signingIn: boolean; accounts?: string[] };

export async function GET() {
  const ids = Object.keys(AI_PROVIDERS) as AiProvider[];
  const health = await Promise.all(ids.map(id => callBridge<Health>(id, "GET", "/health", undefined, 20_000).catch(() => null)));
  const providers = ids.map((id, index) => ({ id, label: AI_PROVIDERS[id].label, running: health[index] !== null, signedIn: health[index]?.signedIn === true, accounts: health[index]?.accounts ?? [] }));
  const ready = providers.filter(provider => provider.signedIn);
  const lists = await Promise.all(ready.map(provider => provider.id === "opencode"
    ? callBridge<string[]>("opencode", "GET", "/models", undefined, 20_000).catch(() => [])
    : AI_PROVIDERS[provider.id].models));
  const models = ready.flatMap((provider, index) => lists[index].map(model => ({ id: model, provider: provider.label })));
  const first = ready.findIndex((_, index) => lists[index].length);
  return Response.json({ available: models.length > 0, providers, models, defaultModel: first < 0 ? "" : defaultModelFor(ready[first].id, lists[first]) });
}
