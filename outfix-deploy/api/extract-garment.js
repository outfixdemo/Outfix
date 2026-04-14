// /api/extract-garment.js
// Removes model from clothing photo and returns a clean standalone product image
// Uses OpenAI gpt-image-1 (image edit endpoint) — requires OPENAI_API_KEY in Vercel env vars

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });
  }

  try {
    const { imageBase64, mimeType = 'image/jpeg' } = req.body;
    if (!imageBase64) {
      return res.status(400).json({ error: 'imageBase64 is required' });
    }

    // Convert base64 → Buffer → Blob for FormData
    const imageBuffer = Buffer.from(imageBase64, 'base64');
    const ext = mimeType === 'image/png' ? 'png' : 'jpg';

    // OpenAI images/edits endpoint requires multipart/form-data
    const { FormData, Blob } = await import('node:buffer').then(() =>
      // Node 18+ has global FormData, but use polyfill-safe approach
      ({ FormData: global.FormData || require('formdata-node').FormData,
         Blob: global.Blob })
    ).catch(() => ({ FormData: global.FormData, Blob: global.Blob }));

    const form = new FormData();

    // Append the image file
    const imageBlob = new Blob([imageBuffer], { type: mimeType });
    form.append('image', imageBlob, `garment.${ext}`);

    // The prompt — instructs the model to isolate the garment
    form.append('prompt',
      'Extract only the clothing item from this photo. Remove the model entirely. ' +
      'Show the garment as a clean, standalone product photo on a pure white background. ' +
      'Preserve the exact color, texture, and details of the clothing. ' +
      'Style it as a professional e-commerce product image — flat or slight 3D perspective, no shadows.'
    );

    form.append('model', 'gpt-image-1');
    form.append('n', '1');
    form.append('size', '1024x1024');
    form.append('response_format', 'b64_json');

    const openAIRes = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        // Do NOT set Content-Type — let fetch set it with the boundary for FormData
        ...Object.fromEntries(form.headers ? form.headers.entries() : []),
      },
      body: form,
    });

    const data = await openAIRes.json();

    if (!openAIRes.ok) {
      console.error('OpenAI error:', data);
      return res.status(openAIRes.status).json({
        error: data?.error?.message || 'OpenAI request failed'
      });
    }

    const b64 = data?.data?.[0]?.b64_json;
    if (!b64) {
      return res.status(500).json({ error: 'No image returned from OpenAI' });
    }

    return res.status(200).json({
      imageBase64: b64,
      dataUrl: `data:image/png;base64,${b64}`,
    });

  } catch (err) {
    console.error('extract-garment error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}
