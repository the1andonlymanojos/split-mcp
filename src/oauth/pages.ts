/**
 * HTML pages served directly by the OAuth server.
 *
 * These exist purely to make the server browsable for testing:
 *   - `/`               short explainer + button to kick off a demo flow
 *   - `/callback-demo`  built-in demo MCP client that swaps the code for a
 *                       bearer and lets you click the tools
 *
 * Nothing here is on the MCP critical path — real MCP clients never touch
 * these pages.
 */

import { BASE_URL } from "../config";
import { html } from "../http";
import { log } from "../logger";

/** Landing page with a one-click "start the flow" link. */
export function landingPage(): Response {
  const authorizeUrl =
    `/authorize?client_id=demo&redirect_uri=${encodeURIComponent(
      BASE_URL + "/callback-demo"
    )}&response_type=code&state=xyz`;

  return html(`
    <h1>Splitwise MCP (OAuth via Splitwise)</h1>
    <p>This MCP server authenticates users via Splitwise OAuth.</p>
    <ol>
      <li><a href="${authorizeUrl}">Start authorization (demo client)</a></li>
      <li>You'll be sent to Splitwise to sign in.</li>
      <li>Back here, the demo client receives a code, swaps it for a bearer token, and calls the <code>whoami</code> tool.</li>
    </ol>
  `);
}

/**
 * Built-in demo MCP client. Takes the `?code=` we just redirected with,
 * exchanges it for a bearer, and renders buttons that call MCP tools.
 */
export async function demoCallback(url: URL): Promise<Response> {
  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";
  log("CALLBACK-DEMO received", { code, state });

  if (!code) {
    return html(`<p>No <code>code</code> in query string.</p>`, { status: 400 });
  }

  const tokenRes = await fetch(`${BASE_URL}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: "demo",
      redirect_uri: `${BASE_URL}/callback-demo`,
    }),
  });
  const tokenJson = (await tokenRes.json()) as {
    access_token?: string;
    error?: string;
  };
  log("CALLBACK-DEMO token exchange", tokenJson);

  if (!tokenJson.access_token) {
    return html(
      `<p>Token exchange failed: <pre>${JSON.stringify(tokenJson, null, 2)}</pre></p>`,
      { status: 400 }
    );
  }

  return html(renderDemoClient(tokenJson.access_token));
}

/** HTML for the little in-browser MCP client. */
function renderDemoClient(token: string): string {
  return `
    <h2>You're in.</h2>
    <p><b>access_token:</b> <code>${token}</code></p>
    <p>
      <button data-tool="whoami">whoami</button>
      <button data-tool="get_current_user">get_current_user</button>
      <button data-tool="get_friends">get_friends</button>
    </p>
    <pre id="out" style="background:#f4f4f4;padding:1em;white-space:pre-wrap"></pre>
    <script>
      const token = ${JSON.stringify(token)};
      const out = document.getElementById("out");
      let sessionId = null;

      async function rpc(body) {
        const r = await fetch("/mcp", {
          method: "POST",
          headers: {
            "Authorization": "Bearer " + token,
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
          },
          body: JSON.stringify(body),
        });
        const sid = r.headers.get("mcp-session-id");
        if (sid) sessionId = sid;
        return r.text();
      }

      async function ensureInit() {
        if (sessionId) return;
        await rpc({
          jsonrpc: "2.0", id: 1, method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "browser-demo", version: "0" }
          }
        });
        await rpc({ jsonrpc: "2.0", method: "notifications/initialized" });
      }

      document.querySelectorAll("button[data-tool]").forEach(btn => {
        btn.onclick = async () => {
          out.textContent = "working...";
          await ensureInit();
          const body = {
            jsonrpc: "2.0", id: Math.floor(Math.random()*1e9),
            method: "tools/call",
            params: { name: btn.dataset.tool, arguments: {} }
          };
          out.textContent = await rpc(body);
        };
      });
    </script>
  `;
}
