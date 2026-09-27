import { request as httpRequest } from "node:http";

function readCodexUsage(): Promise<{ usedPercent: number | null; lifetimeTokens: number | null }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ socketPath: "/run/tao-codex/socket", path: "/usage", method: "GET", timeout: 12_000 }, response => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", chunk => { body += chunk; });
      response.on("end", () => {
        try {
          if (response.statusCode !== 200) return reject(new Error("Usage unavailable"));
          const data = JSON.parse(body) as { usedPercent?: number; lifetimeTokens?: number };
          resolve({ usedPercent: Number.isInteger(data.usedPercent) ? data.usedPercent! : null, lifetimeTokens: Number.isFinite(data.lifetimeTokens) ? data.lifetimeTokens! : null });
        } catch { reject(new Error("Usage unavailable")); }
      });
    });
    req.on("timeout", () => req.destroy());
    req.on("error", reject);
    req.end();
  });
}

export async function GET() {
  if (process.env.AI_PROVIDER !== "codex") return Response.json({ label: "Usage unavailable", usedPercent: null, lifetimeTokens: null });
  try {
    const usage = await readCodexUsage();
    const label = `Codex primary allowance: ${usage.usedPercent === null ? "limit unavailable" : `${usage.usedPercent}% used`}${usage.lifetimeTokens === null ? "" : ` · lifetime ${usage.lifetimeTokens.toLocaleString()} tokens`}`;
    return Response.json({ ...usage, label });
  } catch {
    return Response.json({ label: "Usage unavailable", usedPercent: null, lifetimeTokens: null });
  }
}
