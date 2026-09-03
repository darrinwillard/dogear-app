/**
 * Shared, hardened Audible access-token refresh.
 *
 * Extracted from the original inline implementation in /api/books/gaps,
 * which had three latent bugs (found in review 2026-09-03):
 *  1. No res.ok check before .json() — a 429/5xx with a non-JSON body threw
 *     an unhandled exception surfaced as a generic 500 instead of a clear
 *     "reconnect Audible" response.
 *  2. Unguarded JSON.parse(profile.audible_refresh_token) — a malformed
 *     stored token crashed the route instead of returning 401.
 *  3. No fetch timeout — a hung Amazon auth call could burn the entire
 *     maxDuration budget.
 *
 * Fixed once here; gaps/route.ts and all new discovery routes use this.
 */
export interface AudibleTokenResult {
  accessToken: string | null
  error: { status: number; message: string } | null
}

export async function refreshAudibleAccessToken(
  refreshTokenRaw: string | null | undefined
): Promise<AudibleTokenResult> {
  if (!refreshTokenRaw) {
    return {
      accessToken: null,
      error: { status: 400, message: 'Audible not connected — connect Audible in Settings first.' },
    }
  }

  let tokens: { refresh_token?: string }
  try {
    tokens = JSON.parse(refreshTokenRaw)
  } catch {
    return {
      accessToken: null,
      error: { status: 401, message: 'Stored Audible token is corrupted — please reconnect Audible in Settings.' },
    }
  }
  if (!tokens.refresh_token) {
    return {
      accessToken: null,
      error: { status: 401, message: 'Stored Audible token is missing a refresh token — please reconnect Audible in Settings.' },
    }
  }

  let res: Response
  try {
    res = await fetch('https://api.amazon.com/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        app_name: 'Audible',
        app_version: '3.56.2',
        source_token: tokens.refresh_token,
        requested_token_type: 'access_token',
        source_token_type: 'refresh_token',
      }).toString(),
      signal: AbortSignal.timeout(10_000),
    })
  } catch (e) {
    const timedOut = e instanceof Error && e.name === 'TimeoutError'
    return {
      accessToken: null,
      error: {
        status: 504,
        message: timedOut ? 'Audible token refresh timed out — try again.' : 'Could not reach Audible — try again.',
      },
    }
  }

  if (!res.ok) {
    return {
      accessToken: null,
      error: { status: 401, message: 'Audible token refresh failed — please reconnect Audible in Settings.' },
    }
  }

  let data: { access_token?: string }
  try {
    data = await res.json()
  } catch {
    return {
      accessToken: null,
      error: { status: 502, message: 'Audible returned an unexpected response — try again shortly.' },
    }
  }

  if (!data.access_token) {
    return {
      accessToken: null,
      error: { status: 401, message: 'Audible token refresh failed — please reconnect Audible in Settings.' },
    }
  }

  return { accessToken: data.access_token, error: null }
}
