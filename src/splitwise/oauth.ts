/**
 * Splitwise-side OAuth helpers.
 *
 * We use Splitwise as the identity provider: the user signs in at Splitwise
 * and we receive an access token for their account. That token is later
 * handed to `SplitwiseClient` for API calls.
 *
 * This module knows nothing about our own OAuth server (see ../oauth/*).
 */

import {
  SPLITWISE_AUTHORIZE_URL,
  SPLITWISE_CLIENT_ID,
  SPLITWISE_CLIENT_SECRET,
  SPLITWISE_REDIRECT_URI,
  SPLITWISE_TOKEN_URL,
} from "../config";
import { log } from "../logger";

export type SplitwiseTokenResponse = {
  access_token?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
};

/**
 * Build the URL we redirect the user to so they can approve our app. `state`
 * is opaque to Splitwise; we use it to look up the pending auth on the way
 * back in `/auth/splitwise/callback`.
 */
export function buildAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: SPLITWISE_CLIENT_ID,
    response_type: "code",
    redirect_uri: SPLITWISE_REDIRECT_URI,
    state,
  });
  return `${SPLITWISE_AUTHORIZE_URL}?${params}`;
}

/**
 * Exchange the `code` Splitwise hands us in the callback for a long-lived
 * access token. Returns the parsed JSON body regardless of HTTP status so
 * callers can surface a useful error.
 */
export async function exchangeCodeForToken(code: string): Promise<SplitwiseTokenResponse> {
  const res = await fetch(SPLITWISE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: SPLITWISE_CLIENT_ID,
      client_secret: SPLITWISE_CLIENT_SECRET,
      redirect_uri: SPLITWISE_REDIRECT_URI,
    }),
  });
  const data = (await res.json()) as SplitwiseTokenResponse;
  log("SPLITWISE token exchange", { status: res.status, ok: !!data.access_token });
  return data;
}
