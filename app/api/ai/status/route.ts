import { request as httpRequest } from "node:http";

const models = ["gpt-6-luna", "gpt-6-sol", "gpt-5.6-sol", "gpt-5.6-terra"];

function codexAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const request = httpRequest({ socketPath: "/run/tao-codex/socket", path: "/health", method: "GET", timeout: 1500 }, response => {
      response.resume();
      resolve(response.statusCode === 200);
    });
    request.on("timeout", () => request.destroy());
    request.on("error", () => resolve(false));
    request.end();
  });
}

export async function GET() {
  return Response.json({ available: await codexAvailable(), models, defaultModel: process.env.CODEX_MODEL || models[0] });
}
