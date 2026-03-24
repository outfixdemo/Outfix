export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { imageBase64 } = req.body;
  if (!imageBase64) return res.status(400).json({ error: 'No image provided' });

  try {
    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    const response = await fetch(
      'https://api-inference.huggingface.co/models/briaai/RMBG-1.4',
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
      // Model may be loading (cold start) — return 503 so client can retry
      if (response.status === 503) {
        return res.status(503).json({ error: 'Model loading, please retry', loading: true });
      }
      return res.status(500).json({ error: errText });
    }

    const resultBuffer = await response.arrayBuffer();
    const resultBase64 = Buffer.from(resultBuffer).toString('base64');

    res.status(200).json({ image: `data:image/png;base64,${resultBase64}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
