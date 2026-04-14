export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { imageBase64 } = req.body;
  if (!imageBase64) return res.status(400).json({ error: 'imageBase64 required' });

  const apiKey = process.env.REMOVE_BG_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'REMOVE_BG_API_KEY not configured' });

  try {
    // Decode base64 to binary
    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const binaryBuffer = Buffer.from(base64Data, 'base64');

    // Call remove.bg API
    const formData = new FormData();
    const blob = new Blob([binaryBuffer], { type: 'image/jpeg' });
    formData.append('image_file', blob, 'image.jpg');
    formData.append('size', 'auto');       // full resolution
    formData.append('type', 'product');    // optimized for clothing/product photography
    formData.append('format', 'png');      // always return PNG for transparency

    const response = await fetch('https://api.remove.bg/v1.0/removebg', {
      method: 'POST',
      headers: { 'X-Api-Key': apiKey },
      body: formData,
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('remove.bg error:', response.status, errText);
      return res.status(response.status).json({ error: 'remove.bg API error', detail: errText });
    }

    // Convert PNG response to base64
    const arrayBuffer = await response.arrayBuffer();
    const base64Result = Buffer.from(arrayBuffer).toString('base64');
    return res.status(200).json({ imageBase64: `data:image/png;base64,${base64Result}` });

  } catch (e) {
    console.error('remove-bg handler error:', e);
    return res.status(500).json({ error: 'Internal error', detail: e.message });
  }
}
