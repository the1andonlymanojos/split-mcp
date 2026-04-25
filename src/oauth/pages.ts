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

/** Landing page with setup instructions and a one-click demo flow. */
export function landingPage(): Response {
  const authorizeUrl =
    `/authorize?client_id=demo&redirect_uri=${encodeURIComponent(
      BASE_URL + "/callback-demo"
    )}&response_type=code&state=xyz`;
  const mcpUrl = `${BASE_URL}/mcp`;

  return html(`
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light only" />
        <title>splitMCP</title>
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Lato:wght@400;700;900&display=swap" rel="stylesheet">
        <style>
          :root {
            --splitwise: rgb(91, 197, 167);
            --splitwise-dark: rgb(72, 190, 157);
            --ink: #15322f;
            --muted: #60716f;
            --paper: #fffdf8;
            --card: rgba(255, 255, 255, 0.86);
          }

          * {
            box-sizing: border-box;
          }

          body {
            margin: 0;
            color: var(--ink);
            background:
              radial-gradient(circle at 14% 18%, rgba(255,255,255,0.55), transparent 28%),
              linear-gradient(180deg, rgb(91, 197, 167) 0 33px, #eefbf6 33px, #fffdf8 58%);
            font-family: Lato, "Helvetica Neue", Helvetica, Arial, sans-serif;
            font-size: 16px;
            line-height: 1.55;
            text-rendering: optimizeLegibility;
            -webkit-text-size-adjust: 100%;
          }

          .topbar {
            min-height: 33px;
            background-color: rgb(91, 197, 167);
            background-image: -webkit-linear-gradient(top, rgb(91, 197, 167), rgb(91, 197, 167));
            background-repeat: repeat-x;
            border-bottom: 1px solid rgb(72, 190, 157);
            box-shadow: rgba(0, 0, 0, 0.5) 0 0 3px 0;
          }

          main {
            width: min(1120px, calc(100% - 40px));
            margin: 0 auto;
            padding: 56px 0 72px;
          }

          .hero {
            display: grid;
            grid-template-columns: minmax(0, 1.1fr) minmax(280px, 0.9fr);
            gap: 28px;
            align-items: stretch;
          }

          .panel {
            background: var(--card);
            border: 1px solid rgba(21, 50, 47, 0.09);
            border-radius: 28px;
            box-shadow: 0 24px 80px rgba(27, 93, 78, 0.14);
            backdrop-filter: blur(12px);
          }

          .hero-copy {
            padding: 48px;
          }

          .eyebrow {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            margin: 0 0 18px;
            padding: 7px 12px;
            color: #1e695c;
            background: rgba(91, 197, 167, 0.16);
            border-radius: 999px;
            font-size: 13px;
            font-weight: 900;
            letter-spacing: 0.08em;
            text-transform: uppercase;
          }

          h1 {
            margin: 0;
            max-width: 760px;
            font-size: clamp(42px, 8vw, 82px);
            line-height: 0.94;
            letter-spacing: -0.055em;
          }

          .lede {
            max-width: 680px;
            margin: 24px 0 0;
            color: #315652;
            font-size: clamp(18px, 2.4vw, 23px);
          }

          .actions {
            display: flex;
            flex-wrap: wrap;
            gap: 12px;
            margin-top: 32px;
          }

          .button {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-height: 46px;
            padding: 0 18px;
            color: #fff;
            background: var(--splitwise);
            border: 1px solid var(--splitwise-dark);
            border-radius: 14px;
            box-shadow: 0 10px 26px rgba(72, 190, 157, 0.32);
            font-weight: 900;
            text-decoration: none;
          }

          .button.secondary {
            color: #1f6257;
            background: #fff;
            box-shadow: none;
          }

          .setup-card {
            padding: 28px;
          }

          .setup-card h2,
          .section h2 {
            margin: 0 0 12px;
            font-size: 24px;
            letter-spacing: -0.02em;
          }

          .url-box {
            display: block;
            margin: 18px 0;
            padding: 16px;
            overflow-wrap: anywhere;
            color: #123b35;
            background: #ecfbf6;
            border: 1px solid rgba(72, 190, 157, 0.32);
            border-radius: 16px;
            font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
            font-size: 14px;
          }

          .steps {
            display: grid;
            gap: 12px;
            margin: 20px 0 0;
            padding: 0;
            list-style: none;
            counter-reset: step;
          }

          .steps li {
            position: relative;
            padding: 14px 14px 14px 48px;
            background: rgba(255, 255, 255, 0.7);
            border: 1px solid rgba(21, 50, 47, 0.08);
            border-radius: 16px;
          }

          .steps li::before {
            position: absolute;
            left: 14px;
            top: 14px;
            width: 24px;
            height: 24px;
            color: #fff;
            background: var(--splitwise);
            border-radius: 999px;
            content: counter(step);
            counter-increment: step;
            font-size: 13px;
            font-weight: 900;
            line-height: 24px;
            text-align: center;
          }

          .grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 18px;
            margin-top: 24px;
          }

          .section {
            margin-top: 28px;
            padding: 28px;
          }

          .mini-card {
            padding: 22px;
            background: #fff;
            border: 1px solid rgba(21, 50, 47, 0.08);
            border-radius: 22px;
          }

          .mini-card h3 {
            margin: 0 0 8px;
            font-size: 18px;
          }

          p {
            margin: 0;
          }

          .muted {
            color: var(--muted);
          }

          .note {
            margin-top: 18px;
            padding: 16px;
            color: #24524c;
            background: rgba(255, 244, 205, 0.78);
            border: 1px solid rgba(227, 178, 62, 0.32);
            border-radius: 18px;
          }

          code {
            padding: 0.12em 0.36em;
            background: rgba(91, 197, 167, 0.16);
            border-radius: 7px;
            font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          }

          footer {
            margin-top: 30px;
            color: #63807b;
            font-size: 14px;
            text-align: center;
          }

          @media (max-width: 860px) {
            main {
              width: min(100% - 28px, 680px);
              padding-top: 32px;
            }

            .hero,
            .grid {
              grid-template-columns: 1fr;
            }

            .hero-copy,
            .setup-card,
            .section {
              padding: 24px;
            }
          }
        </style>
      </head>
      <body>
        <div class="topbar" aria-hidden="true"></div>
        <main>
          <section class="hero">
            <div class="panel hero-copy">
              <p class="eyebrow">splitMCP</p>
              <h1>Split expenses from the chat.</h1>
              <p class="lede">
                Connect your AI app to Splitwise, then ask it to check balances,
                find friends, inspect groups, and log expenses without opening
                the Splitwise app.
              </p>
              <div class="actions">
                <a class="button" href="${authorizeUrl}">Try the demo flow</a>
                <a class="button secondary" href="#setup">Add to your app</a>
              </div>
            </div>

            <aside id="setup" class="panel setup-card">
              <h2>Add splitMCP</h2>
              <p class="muted">
                In any MCP client that supports remote Streamable HTTP servers,
                add this endpoint:
              </p>
              <code class="url-box">${mcpUrl}</code>
              <ol class="steps">
                <li>Open your app's MCP or connector settings.</li>
                <li>Add a remote HTTP MCP server using the URL above.</li>
                <li>When prompted, sign in with Splitwise and approve access.</li>
                <li>Start asking questions like <code>what do I owe?</code></li>
              </ol>
              <p class="note">
                Client quirk: some apps struggle with Dynamic Client
                Registration (DCR). If setup fails there, manually set any
                random <code>client_id</code>, like <code>splitmcp-local</code>,
                and try the auth flow again.
              </p>
            </aside>
          </section>

          <section class="panel section">
            <h2>How it works</h2>
            <div class="grid">
              <div class="mini-card">
                <h3>1. Your app connects</h3>
                <p class="muted">
                  Your MCP client talks to <code>/mcp</code> and discovers the
                  Splitwise tools this server exposes.
                </p>
              </div>
              <div class="mini-card">
                <h3>2. Splitwise signs you in</h3>
                <p class="muted">
                  OAuth sends you to Splitwise. This server receives a token and
                  keeps it server-side, away from the chat client.
                </p>
              </div>
              <div class="mini-card">
                <h3>3. Tools do the chores</h3>
                <p class="muted">
                  The AI can call tools for balances, friends, groups, expenses,
                  comments, and metadata. You keep the final say.
                </p>
              </div>
            </div>
            <p class="note">
              Heads up: this is under active development. Expect the occasional
              rough edge, fast improvements, and a few growing pains while the
              server learns better manners.
            </p>
          </section>

          <section class="panel section">
            <h2>Try asking</h2>
            <div class="grid">
              <div class="mini-card"><p>"Who do I owe money to right now?"</p></div>
              <div class="mini-card"><p>"Add lunch for 1200 split equally with Riya."</p></div>
              <div class="mini-card"><p>"Show my groups and recent balances."</p></div>
            </div>
          </section>

          <footer>
            splitMCP is built for quick, conversational Splitwise workflows. OAuth-backed,
            MCP-native, and intentionally tiny.
          </footer>
        </main>
      </body>
    </html>
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
