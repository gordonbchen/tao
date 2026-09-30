import { callBridge, isAiProvider } from "@/lib/ai";
import { jsonError } from "@/lib/db";

// Lists the providers OpenCode can sign in to.
export async function GET() {
  try { return Response.json(await callBridge("opencode", "GET", "/accounts", undefined, 20_000)); }
  catch (error) { return jsonError(error instanceof Error ? error.message : "OpenCode is unavailable", 502); }
}

// Starts or finishes a sidecar CLI login, or signs it out. The shared local workspace
// has no accounts yet, so anyone who can reach this app can manage these logins.
// `account` picks the provider OpenCode signs in to; `code` also carries an API key.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { provider?: unknown; action?: unknown; code?: unknown; account?: unknown };
  if (!isAiProvider(body.provider)) return jsonError("Unknown AI provider", 400);
  try {
    if (body.action === "start") return Response.json(await callBridge(body.provider, "POST", "/login/start", { account: body.account }, 30_000));
    if (body.action === "code" && typeof body.code === "string") return Response.json(await callBridge(body.provider, "POST", "/login/code", { code: body.code }, 70_000));
    if (body.action === "logout") return Response.json(await callBridge(body.provider, "POST", "/logout", {}, 20_000));
    return jsonError("Unknown sign-in action", 400);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Sign-in failed", 502);
  }
}
