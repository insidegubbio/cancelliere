export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const { code } = req.body || {};
  if (!code) {
    res.status(400).json({ error: 'missing_code' });
    return;
  }

  const ghRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
    }),
  });

  const data = await ghRes.json();
  if (data.error) {
    res.status(400).json({ error: data.error_description || data.error });
    return;
  }

  res.status(200).json({ access_token: data.access_token, scope: data.scope });
}
