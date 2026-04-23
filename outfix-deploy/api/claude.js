// ═══════════════════════════════════════════════════════════════════════════
// /api/claude.js — Outfix Claude API proxy
// Updated April 22 2026 to use Sonnet 4.5 (active, replaces deprecated Sonnet 4)
// ═══════════════════════════════════════════════════════════════════════════

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

  try {
    // Build message content — text only OR vision
    let content;
    if (imageBase64 && mimeType) {
      content = [
        {
          type: 'image',
          source: { type: 'base64', media_type: mimeType, data: imageBase64 }
        },
        { type: 'text', text: prompt || 'Identify this clothing item.' }
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
        // ── MODEL UPDATE ──────────────────────────────────────────────────
        // Old: 'claude-sonnet-4-20250514' (deprecated April 14 2026, retires June 15 2026)
        // New: 'claude-sonnet-4-5-20250929' — Anthropic's official migration path.
        //   Active, same $3/$15 per M-token pricing, proven for structured JSON output.
        //   Avoids Sonnet 4.6's default high-effort latency hit (bad for short outfit JSON).
        model: 'claude-sonnet-4-5-20250929',

        // Bumped from 1024 — gives headroom for longer outfit JSON / analysis responses.
        // Sonnet 4.5 supports up to 64K output tokens; 2048 is plenty for Outfix use case.
        max_tokens: 2048,

        system: systemPrompt || 'You are a helpful fashion AI assistant. Always respond concisely and accurately.',
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
