const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  
  const { code, markUsed, userId } = req.body;
  if (!code) return res.json({ valid: false, error: 'No code provided' });

  const { data, error } = await supabase
    .from('invite_codes')
    .select('*')
    .eq('code', code.trim().toUpperCase())
    .eq('used', false)
    .single();

  if (error || !data) return res.json({ valid: false, error: 'Invalid or already used invite code' });

  if (markUsed && userId) {
    await supabase.from('invite_codes').update({
      used: true,
      used_by: userId,
      used_at: new Date().toISOString()
    }).eq('id', data.id);
  }

  return res.json({ valid: true });
}
