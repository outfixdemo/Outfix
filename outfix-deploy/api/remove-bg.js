export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { imageBase64 } = req.body;
  if (!imageBase64) return res.status(400).json({ error: 'No image provided' });

  if (!process.env.HUGGINGFACE_API_KEY) {
    return res.status(500).json({ error: 'HUGGINGFACE_API_KEY not set in Vercel env vars' });
  }

  try {
    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    const response = await fetch(
      'https://api-inference.huggingface.co/models/briaai/RMBG-2.0',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
          'Content-Type': 'application/octet-stream',
        },
        body: buffer,
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      if (response.status === 503) {
        return res.status(503).json({ error: 'Model loading, please retry', loading: true });
      }
      return res.status(500).json({ error: `HuggingFace ${response.status}: ${errText.slice(0,200)}` });
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('image')) {
      const body = await response.text();
      return res.status(500).json({ error: `HF returned non-image (${contentType}): ${body.slice(0,200)}` });
    }

    const resultBuffer = await response.arrayBuffer();
    const resultBase64 = Buffer.from(resultBuffer).toString('base64');

    res.status(200).json({ image: `data:image/png;base64,${resultBase64}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
