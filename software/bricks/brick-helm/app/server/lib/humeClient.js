const HUME_TOKEN_URL = 'https://api.hume.ai/oauth2-cc/token';

export function humeConfigured() {
  return Boolean(
    process.env.HUME_API_KEY?.trim()
    && process.env.HUME_SECRET_KEY?.trim()
    && process.env.HUME_CONFIG_ID?.trim(),
  );
}

export function humeConfigId() {
  return process.env.HUME_CONFIG_ID?.trim() || '';
}

/** Mint a short-lived EVI access token (never expose API keys to the browser). */
export async function mintHumeAccessToken() {
  const apiKey = process.env.HUME_API_KEY?.trim();
  const secretKey = process.env.HUME_SECRET_KEY?.trim();
  if (!apiKey || !secretKey) {
    throw new Error('Hume credentials not configured');
  }

  const auth = Buffer.from(`${apiKey}:${secretKey}`).toString('base64');
  const res = await fetch(HUME_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data.error_description || data.error || res.statusText;
    throw new Error(`Hume token: ${detail}`);
  }
  if (!data.access_token) {
    throw new Error('Hume token: missing access_token');
  }

  return {
    accessToken: data.access_token,
    expiresIn: Number(data.expires_in || 1800),
  };
}
