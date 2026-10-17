export async function refreshGoogleAccessToken(
  fetcher: typeof fetch,
  config: { clientId: string; clientSecret: string; refreshToken: string },
) {
  const response = await fetcher('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: config.refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!response.ok) throw new Error('Google rechazó el refresh token.');
  const payload = await response.json();
  if (!payload.access_token)
    throw new Error('Google no devolvió access token.');
  return payload.access_token as string;
}
