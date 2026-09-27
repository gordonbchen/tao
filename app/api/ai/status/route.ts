import { request as httpRequest } from "node:http";
import { AI_PROVIDERS, defaultAiModel, type AiProvider } from "@/lib/ai";

function bridgeAvailable(socketPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const request = httpRequest({ socketPath, path: "/health", method: "GET", timeout: 1500 }, response => {
      response.resume();
      resolve(response.statusCode === 200);
    });
    request.on("timeout", () => request.destroy());
    request.on("error", () => resolve(false));
    request.end();
  });
}

export async function GET() {
  const providers = Object.keys(AI_PROVIDERS) as AiProvider[];
  const available = await Promise.all(providers.map(provider => bridgeAvailable(AI_PROVIDERS[provider].socket)));
  const models = providers.filter((_, index) => available[index])
    .flatMap(provider => AI_PROVIDERS[provider].models.map(id => ({ id, provider: AI_PROVIDERS[provider].label })));
  return Response.json({ available: models.length > 0, models, defaultModel: defaultAiModel() });
}
