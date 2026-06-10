// ═══════════════════════════════════════════════════════════════════════════
// /api/claude.js — Outfix Claude API proxy (SECURED — June 2026)
//
// Changes from previous version:
//   1. AUTH REQUIRED — every request must carry a valid Supabase session JWT.
//      Anonymous callers get 401. Closes the open credit-burn hole where
//      anyone who found this endpoint could consume Anthropic credits.
//   2. RATE LIMITED — per-user hourly cap, tracked in the api_usage table
//      (run outfix-api-usage.sql in Supabase first). Exceeding it returns 429.
//   3. MODEL VIA ENV VAR — set CLAUDE_MODEL in Vercel → Settings → Environment
//      Variables to change models without a code deploy. Defaults to Sonnet 4.5.
//
// Required Vercel env vars:
//   ANTHROPIC_API_KEY    (already set)
//   SUPABASE_ANON_KEY    (new — same public anon key used in the client)
//   CLAUDE_MODEL         (optional — defaults below)
//   AI_RATE_LIMIT        (optional — calls/user/hour, defaults to 60)
// ═══════════════════════════════════════════════════════════════════════════

const SB_URL = 'https://asvrbeonxmskllkshwbl.supabase.co';

const DEFAULT_MODEL = 'claude-sonnet-4-5-20250929';
const DEFAULT_RATE_LIMIT = 60; // AI calls per user per hour

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { prompt, systemPrompt, imageBase64, mimeType } = req.body;

  if (!prompt && !imageBase64) {
    return res.status(400).json({ error: 'prompt or imageBase64 required' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }
  const SB_KEY = process.env.SUPABASE_ANON_KEY;
  if (!SB_KEY) {
    return res.status(500).json({ error: 'SUPABASE_ANON_KEY not configured' });
  }

  // ── 1. AUTH: verify the Supabase session token ──────────────────────────
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  let userId = null;
  try {
    const userRes = await fetch(`${SB_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: SB_KEY },
    });
    if (!userRes.ok) {
      return res.status(401).json({ error: 'Invalid or expired session' });
    }
    const user = await userRes.json();
    userId = user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Invalid session' });
    }
  } catch (e) {
    console.error('Auth verification failed:', e);
    return res.status(401).json({ error: 'Auth verification failed' });
  }

  // ── 2. RATE LIMIT: count this user's calls in the past hour ─────────────
  // Uses the api_usage table with the user's own token (RLS lets users
  // insert + read their own rows; no delete policy, so they can't evade).
  const RATE_LIMIT = parseInt(process.env.AI_RATE_LIMIT || '', 10) || DEFAULT_RATE_LIMIT;
  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const countRes = await fetch(
      `${SB_URL}/rest/v1/api_usage?user_id=eq.${userId}&created_at=gte.${oneHourAgo}&select=id`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: SB_KEY,
          Prefer: 'count=exact',
          Range: '0-0',
        },
      }
    );
    const contentRange = countRes.headers.get('content-range') || '';
    const total = parseInt(contentRange.split('/')[1] || '0', 10) || 0;

    if (total >= RATE_LIMIT) {
      return res.status(429).json({
        error: 'Rate limit exceeded',
        detail: `Max ${RATE_LIMIT} AI requests per hour. Try again shortly.`,
      });
    }

    // Log this call (fire-and-forget — don't block the AI request on it)
    fetch(`${SB_URL}/rest/v1/api_usage`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: SB_KEY,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ user_id: userId, endpoint: 'claude' }),
    }).catch(() => {});
  } catch (e) {
    // Rate-limit infrastructure failure should not take down AI features.
    // Auth has already passed — log and continue.
    console.error('Rate limit check failed (continuing):', e);
  }

  // ── 3. CALL ANTHROPIC ────────────────────────────────────────────────────
  try {
    let content;
    if (imageBase64 && mimeType) {
      content = [
        {
          type: 'image',
          source: { type: 'base64', media_type: mimeType, data: imageBase64 },
        },
        { type: 'text', text: prompt || 'Identify this clothing item.' },
      ];
    } else {
      content = [{ type: 'text', text: prompt }];
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        // Model from env var — next deprecation is a dashboard change, not a deploy.
        model: process.env.CLAUDE_MODEL || DEFAULT_MODEL,
        max_tokens: 2048,
        system:
          systemPrompt ||
          'You are a helpful fashion AI assistant. Always respond concisely and accurately.',
        messages: [{ role: 'user', content }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Anthropic API error:', response.status, err);
      return res.status(response.status).json({ error: 'Anthropic API error', detail: err });
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || '';
    return res.status(200).json({ text });
  } catch (e) {
    console.error('Claude proxy error:', e);
    return res.status(500).json({ error: 'Internal error', detail: e.message });
  }
}
