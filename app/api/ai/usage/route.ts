import { callBridge, providerForModel } from "@/lib/ai";

type Usage = { usedPercent: number | null; windowDurationMins: number | null; resetsAt: number | null; lifetimeTokens: number | null };

// Each sidecar reports its account's most used allowance window.
export async function GET(request: Request) {
  const model = new URL(request.url).searchParams.get("model") ?? "";
  try {
    const provider = providerForModel(model);
    if (!provider) throw new Error("Usage unavailable");
    const data = await callBridge<Partial<Usage>>(provider, "GET", "/usage", undefined, 15_000);
    const usedPercent = Number.isInteger(data.usedPercent) && data.usedPercent! >= 0 && data.usedPercent! <= 100 ? data.usedPercent! : null;
    return Response.json({
      usedPercent,
      remainingPercent: usedPercent === null ? null : 100 - usedPercent,
      windowDurationMins: Number.isFinite(data.windowDurationMins) ? data.windowDurationMins! : null,
      resetsAt: Number.isFinite(data.resetsAt) ? data.resetsAt! : null,
      lifetimeTokens: Number.isFinite(data.lifetimeTokens) ? data.lifetimeTokens! : null,
    });
  } catch {
    return Response.json({ usedPercent: null, remainingPercent: null, windowDurationMins: null, resetsAt: null, lifetimeTokens: null });
  }
}
