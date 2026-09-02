/**
 * Shared Audible token refresh — used by library sync and catalog release refresh.
 */

export interface AudibleTokenBundle {
  refresh_token: string
  access_token?: string
  expires?: number
  [key: string]: unknown
}

export async function refreshAudibleAccessToken(
  refreshTokenJson: string
): Promise<{ accessToken: string; tokens: AudibleTokenBundle }> {
  const tokens = JSON.parse(refreshTokenJson) as AudibleTokenBundle
  if (!tokens?.refresh_token) {
    throw new Error('Audible refresh token missing')
  }

  const refreshResponse = await fetch('https://api.amazon.com/auth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      app_name: 'Audible',
      app_version: '3.56.2',
      source_token: tokens.refresh_token,
      requested_token_type: 'access_token',
      source_token_type: 'refresh_token',
    }).toString(),
  })

  const refreshData = await refreshResponse.json()
  const accessToken = refreshData.access_token as string | undefined
  if (!accessToken) {
    throw new Error('Token refresh failed — please reconnect Audible')
  }

  return { accessToken, tokens }
}
