import { spawn } from "node:child_process";

// Drives a CLI's own login flow so the web app can sign a sidecar in without a terminal.
// `parse` extracts { url, code? } from the login command's output; `needsCode` means the
// student pastes a code back from the browser (Claude), otherwise the CLI polls (Codex).
export function createAuth({ command, statusArgs, loginArgs, logoutArgs, parse, needsCode }) {
  let login = null;
  let signedIn = null;
  let checkedAt = 0;

  function run(args, timeoutMs = 15_000) {
    return new Promise(resolve => {
      const child = spawn(command, args, { cwd: "/tmp", stdio: ["ignore", "ignore", "ignore"] });
      const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
      child.on("error", () => { clearTimeout(timer); resolve(1); });
      child.on("close", code => { clearTimeout(timer); resolve(code); });
    });
  }

  async function isSignedIn() {
    if (signedIn === null || Date.now() - checkedAt > 60_000) {
      signedIn = (await run(statusArgs)) === 0;
      checkedAt = Date.now();
    }
    return signedIn;
  }

  function forget() { signedIn = null; }

  function start() {
    login?.child.kill("SIGKILL");
    const child = spawn(command, loginArgs, { cwd: "/tmp", stdio: ["pipe", "pipe", "pipe"] });
    const current = { child, output: "", done: null };
    login = current;
    const timer = setTimeout(() => child.kill("SIGKILL"), 15 * 60_000);
    current.done = new Promise(resolve => {
      child.on("error", () => resolve(false));
      child.on("close", code => {
        clearTimeout(timer);
        if (login === current) login = null;
        forget();
        resolve(code === 0);
      });
    });
    return new Promise((resolve, reject) => {
      const onData = chunk => {
        current.output = (current.output + chunk).replace(/\x1b\[[0-9;]*m/g, "").slice(-8_000);
        const found = parse(current.output);
        if (found) resolve({ ...found, needsCode });
      };
      child.stdout.setEncoding("utf8").on("data", onData);
      child.stderr.setEncoding("utf8").on("data", onData);
      current.done.then(() => reject(new Error("Sign-in could not start")));
      setTimeout(() => reject(new Error("Sign-in could not start")), 20_000);
    });
  }

  async function submitCode(code) {
    if (!login || !needsCode) throw new Error("Start sign-in again");
    const current = login;
    current.child.stdin.write(`${code.trim()}\n`);
    const ok = await Promise.race([current.done, new Promise(resolve => setTimeout(() => resolve(false), 60_000))]);
    if (!ok) throw new Error("That code was not accepted. Start sign-in again.");
    return true;
  }

  async function logout() {
    login?.child.kill("SIGKILL");
    await run(logoutArgs);
    forget();
  }

  async function readJson(request) {
    let raw = "";
    for await (const chunk of request) {
      raw += chunk;
      if (raw.length > 10_000) throw new Error("Request too large");
    }
    return JSON.parse(raw || "{}");
  }

  // Returns true when the request was an auth route.
  async function handle(request, response) {
    const send = (status, body) => response.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body));
    try {
      if (request.method === "GET" && request.url === "/health") { send(200, { available: true, signedIn: await isSignedIn(), signingIn: Boolean(login) }); return true; }
      if (request.method !== "POST") return false;
      if (request.url === "/login/start") { send(200, await start()); return true; }
      if (request.url === "/login/code") {
        const { code } = await readJson(request);
        if (typeof code !== "string" || !code.trim() || code.length > 2_000) throw new Error("Enter the code from the sign-in page");
        send(200, { signedIn: await submitCode(code) });
        return true;
      }
      if (request.url === "/logout") { await logout(); send(200, { signedIn: false }); return true; }
      return false;
    } catch (error) {
      send(400, { error: error instanceof Error ? error.message : "Sign-in failed" });
      return true;
    }
  }

  return { handle, forget };
}
