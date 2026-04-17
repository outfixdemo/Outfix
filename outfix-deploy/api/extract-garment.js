// /api/extract-garment.js
// Removes model from clothing photo and returns a clean standalone product image
// Uses OpenAI gpt-image-1 (image edit endpoint)
// Requires OPENAI_API_KEY in Vercel env vars

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'OPENAI_API_KEY not configured in Vercel env vars' });
  }

  try {
    const { imageBase64, mimeType = 'image/jpeg' } = req.body || {};
    if (!imageBase64) {
      return res.status(400).json({ error: 'imageBase64 is required in request body' });
    }

    // Decode to Buffer, then wrap in Blob for multipart upload
    const imageBuffer = Buffer.from(imageBase64, 'base64');

    // Check size — OpenAI image edit endpoint caps at 4MB per file
    if (imageBuffer.byteLength > 4 * 1024 * 1024) {
      return res.status(413).json({
        error: `Image too large (${(imageBuffer.byteLength / 1024 / 1024).toFixed(1)}MB). OpenAI limit is 4MB. Resize or compress first.`
      });
    }

    const ext = mimeType === 'image/png' ? 'png' : 'jpg';

    // Node 20+ has global FormData and Blob — no polyfill needed on Vercel
    if (typeof FormData === 'undefined' || typeof Blob === 'undefined') {
      return res.status(500).json({
        error: 'FormData/Blob unavailable in runtime — upgrade Vercel Node version to 20+'
      });
    }

    const form = new FormData();
    const imageBlob = new Blob([imageBuffer], { type: mimeType });
    form.append('image', imageBlob, `garment.${ext}`);
    form.append('model', 'gpt-image-1');
    form.append('prompt',
      'Extract only the clothing item from this photo. Remove the person/model entirely. ' +
      'Show the garment as a clean, standalone product photo on a pure white background. ' +
      'Preserve the exact color, texture, fit, and details of the clothing. ' +
      'Render it as a professional e-commerce product image — centered, softly shadowed, no wrinkles from the body pose, no background elements.'
    );
    form.append('size', '1024x1024');
    form.append('n', '1');

    const openAIRes = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        // Do NOT set Content-Type — fetch sets it automatically with multipart boundary
      },
      body: form,
    });

    const data = await openAIRes.json().catch(() => ({}));

    if (!openAIRes.ok) {
      console.error('[extract-garment] OpenAI error:', {
        status: openAIRes.status,
        error: data?.error,
      });
      const userError = data?.error?.message || `OpenAI returned ${openAIRes.status}`;
      return res.status(openAIRes.status).json({ error: userError });
    }

    const b64 = data?.data?.[0]?.b64_json;
    if (!b64) {
      console.error('[extract-garment] OpenAI response missing b64_json:', data);
      return res.status(500).json({ error: 'OpenAI did not return image data' });
    }

    return res.status(200).json({
      imageBase64: b64,
      dataUrl: `data:image/png;base64,${b64}`,
    });

  } catch (err) {
    console.error('[extract-garment] Unhandled error:', err);
    return res.status(500).json({
      error: err.message || 'Internal server error',
      type: err.name || 'UnknownError',
    });
  }
}
