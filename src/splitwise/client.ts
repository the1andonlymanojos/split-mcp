/**
 * Splitwise REST API client.
 *
 * Each instance is bound to a single user's Splitwise access token. Tool
 * handlers create one per invocation via `SplitwiseClient.fromRequestInfo`.
 *
 * API docs: https://dev.splitwise.com/
 */

import { SPLITWISE_API_BASE } from "../config";
import { log } from "../logger";

type Headers = Record<string, string | string[] | undefined>;

export type SplitwiseResponse<T = unknown> = {
  status: number;
  data: T;
};

export class SplitwiseClient {
  constructor(private readonly token: string) {}

  /**
   * Build a client from the request headers injected by the MCP `/mcp`
   * router. Returns `null` when no token is present (caller should treat this
   * as "not authenticated").
   */
  static fromRequestInfo(
    requestInfo: { headers?: Headers } | undefined
  ): SplitwiseClient | null {
    const raw = requestInfo?.headers?.["x-splitwise-token"];
    const token = typeof raw === "string" ? raw : null;
    return token ? new SplitwiseClient(token) : null;
  }

  /** Raw GET. Returns `{ status, data }` where data is parsed JSON if possible. */
  async get<T = unknown>(path: string): Promise<SplitwiseResponse<T>> {
    const res = await fetch(`${SPLITWISE_API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    const bodyText = await res.text();
    log(`SPLITWISE GET ${path}`, { status: res.status });

    let data: unknown;
    try {
      data = JSON.parse(bodyText);
    } catch {
      data = bodyText;
    }
    return { status: res.status, data: data as T };
  }

  // --- Convenience wrappers for the endpoints we expose as MCP tools. ---

  getCurrentUser() {
    return this.get<{ user?: SplitwiseUser }>("/get_current_user");
  }

  getUser(id: number) {
    return this.get<{ user?: SplitwiseUser }>(`/get_user/${id}`);
  }

  getFriends() {
    return this.get<{ friends?: unknown[] }>("/get_friends");
  }
}

export type SplitwiseUser = {
  id: number;
  first_name: string;
  last_name: string;
};
