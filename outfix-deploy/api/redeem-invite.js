export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { code, markUsed, userId } = req.body;
  if (!code) return res.json({ valid: false, error: 'No code provided' });
  const SB_URL = process.env.SUPABASE_URL;
  const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
  const headers = {
    'Content-Type': 'application/json',
    'apikey': SB_KEY,
    'Authorization': `Bearer ${SB_KEY}`,
  };
  const lookupRes = await fetch(
    `${SB_URL}/rest/v1/invite_codes?code=eq.${code.trim().toUpperCase()}&used=eq.false&select=*`,
    { headers }
  ).then(r => r.json()).catch(() => []);
  if (!Array.isArray(lookupRes) || lookupRes.length === 0) {
    return res.json({ valid: false, error: 'Invalid or already used invite code' });
  }
  if (markUsed && userId) {
    await fetch(
      `${SB_URL}/rest/v1/invite_codes?id=eq.${lookupRes[0].id}`,
      {
        method: 'PATCH',
        headers: { ...headers, 'Prefer': 'return=minimal' },
        body: JSON.stringify({ used: true, used_by: userId, used_at: new Date().toISOString() }),
      }
    ).catch(() => {});
  }
  return res.json({ valid: true });
}
