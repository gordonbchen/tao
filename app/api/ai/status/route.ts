import { AI_PROVIDERS, callBridge, defaultModelFor, type AiProvider } from "@/lib/ai";

type Health = { signedIn: boolean; signingIn: boolean };

export async function GET() {
  const ids = Object.keys(AI_PROVIDERS) as AiProvider[];
  const health = await Promise.all(ids.map(id => callBridge<Health>(id, "GET", "/health", undefined, 20_000).catch(() => null)));
  const providers = ids.map((id, index) => ({ id, label: AI_PROVIDERS[id].label, running: health[index] !== null, signedIn: health[index]?.signedIn === true }));
  const ready = providers.filter(provider => provider.signedIn);
  const models = ready.flatMap(provider => AI_PROVIDERS[provider.id].models.map(model => ({ id: model, provider: provider.label })));
  return Response.json({ available: models.length > 0, providers, models, defaultModel: ready.length ? defaultModelFor(ready[0].id) : "" });
}
