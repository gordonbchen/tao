import { AI_PROVIDERS } from "@/lib/ai";
import { request as httpRequest } from "node:http";

type CodexUsage = { usedPercent: number | null; windowDurationMins: number | null; resetsAt: number | null; lifetimeTokens: number | null };

function readCodexUsage(): Promise<CodexUsage> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ socketPath: "/run/tao-codex/socket", path: "/usage", method: "GET", timeout: 12_000 }, response => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", chunk => { body += chunk; });
      response.on("end", () => {
        try {
          if (response.statusCode !== 200) return reject(new Error("Usage unavailable"));
          const data = JSON.parse(body) as Partial<CodexUsage>;
          resolve({
            usedPercent: Number.isInteger(data.usedPercent) && data.usedPercent! >= 0 && data.usedPercent! <= 100 ? data.usedPercent! : null,
            windowDurationMins: Number.isFinite(data.windowDurationMins) ? data.windowDurationMins! : null,
            resetsAt: Number.isFinite(data.resetsAt) ? data.resetsAt! : null,
            lifetimeTokens: Number.isFinite(data.lifetimeTokens) ? data.lifetimeTokens! : null,
          });
        } catch { reject(new Error("Usage unavailable")); }
      });
    });
    req.on("timeout", () => req.destroy());
    req.on("error", reject);
    req.end();
  });
}

// Only Codex exposes account allowance; Claude CLI usage is reported as unavailable.
export async function GET(request: Request) {
  try {
    if (!AI_PROVIDERS.codex.models.includes(new URL(request.url).searchParams.get("model") ?? "")) throw new Error("Usage unavailable");
    const usage = await readCodexUsage();
    const remainingPercent = usage.usedPercent === null ? null : 100 - usage.usedPercent;
    return Response.json({ ...usage, remainingPercent });
  } catch {
    return Response.json({ usedPercent: null, remainingPercent: null, windowDurationMins: null, resetsAt: null, lifetimeTokens: null });
  }
}
