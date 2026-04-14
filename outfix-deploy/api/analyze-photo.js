export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { imageBase64, mimeType } = req.body;
  if (!imageBase64 || !mimeType) return res.status(400).json({ error: 'imageBase64 and mimeType required' });

  const googleKey  = process.env.GOOGLE_VISION_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (!anthropicKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

  // ── Run Google Vision OCR + Claude Vision in parallel ────────────────────────
  const [googleResult, claudeResult] = await Promise.allSettled([

    // Pass 1 — Google Vision: TEXT_DETECTION for price tags, labels, screenshots
    googleKey ? fetch(`https://vision.googleapis.com/v1/images:annotate?key=${googleKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [{
          image: { content: imageBase64 },
          features: [
            { type: 'TEXT_DETECTION', maxResults: 1 },
            { type: 'LOGO_DETECTION', maxResults: 3 },
            { type: 'LABEL_DETECTION', maxResults: 10 },
          ],
        }],
      }),
      signal: AbortSignal.timeout(8000),
    }).then(r => r.json()) : Promise.resolve(null),

    // Pass 2 — Claude Vision: visual identification of item, color, category
    fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 512,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mimeType, data: imageBase64 } },
            { type: 'text', text: 'Identify this clothing item. Focus on visual characteristics. Return ONLY valid JSON:\n{"name":"descriptive product name","brand":"brand if logo/label visible else empty string","category":"Tops|Bottoms|Dresses|Outerwear|Shoes|Accessories","color":"#hexcode for dominant color","price":0,"condition":"New|Like New|Good|Fair","emoji":"single emoji","tags":["tag1","tag2"]}' },
          ],
        }],
        signal: AbortSignal.timeout(12000),
      }),
    }).then(r => r.json()),
  ]);

  // ── Extract Google OCR results ────────────────────────────────────────────────
  let ocrText = '';
  let ocrBrand = '';
  let ocrPrice = 0;
  let ocrName = '';

  if (googleResult.status === 'fulfilled' && googleResult.value?.responses?.[0]) {
    const response = googleResult.value.responses[0];

    // Full text from TEXT_DETECTION
    ocrText = response.fullTextAnnotation?.text || response.textAnnotations?.[0]?.description || '';

    // Extract price — look for patterns like $89, $129.00, £45, €60
    // Handle comma-separated prices: $1,130 / $1,299.00 / £450
    const priceMatch = ocrText.match(/[$£€]\s*([\d,]+(?:\.\d{1,2})?)/);
    if (priceMatch) ocrPrice = parseFloat(priceMatch[1].replace(/,/g, ''));

    // Extract brand from logo detection
    const logos = response.logoAnnotations || [];
    if (logos.length > 0) ocrBrand = logos[0].description;

    // Try to find a product name — longest text block that's not a price or URL
    const lines = ocrText.split('\n').map(l => l.trim()).filter(l =>
      l.length > 4 &&
      l.length < 80 &&
      !/^[$£€\d]/.test(l) &&    // not starting with price/number
      !/http|www|\.com/.test(l) && // not a URL
      !/^(size|color|qty|add|cart|buy|shop|sale|new|in stock)/i.test(l) // not UI chrome
    );
    // Prefer longer lines that look like product titles
    const titleLine = lines.sort((a, b) => b.length - a.length)[0];
    if (titleLine && titleLine.length > 8) ocrName = titleLine;
  }

  // ── Extract Claude Vision results ─────────────────────────────────────────────
  let claudeData = {};
  if (claudeResult.status === 'fulfilled' && claudeResult.value?.content?.[0]?.text) {
    try {
      claudeData = JSON.parse(claudeResult.value.content[0].text.replace(/```json|```/g, '').trim());
    } catch (e) {}
  }

  // ── Merge: priority rules ─────────────────────────────────────────────────────
  // Google wins on text-extractable fields; Claude wins on visual inference fields
  const merged = {
    // Name: OCR title wins if found and longer than Claude's; Claude otherwise
    name: (ocrName && ocrName.length > (claudeData.name || '').length)
      ? ocrName
      : claudeData.name || ocrName || '',

    // Brand: logo detection wins; then Claude; then empty
    brand: ocrBrand || claudeData.brand || '',

    // Price: OCR always wins if found (reading actual number); Claude's 0 is ignored
    price: ocrPrice > 0 ? ocrPrice : (claudeData.price || 0),

    // Category: Claude wins on visual inference, but name-based check overrides misclassifications
    category: (()=>{
      const n = (claudeData.name || ocrName || '').toLowerCase();
      if (/sneaker|shoe|boot|loafer|trainer|runner|sandal|heel|slipper|mule|clog/.test(n)) return 'Shoes';
      if (/jeans?|denim|trouser|chino|pant|short|legging|jogger/.test(n)) return 'Bottoms';
      if (/dress|skirt|jumpsuit|romper/.test(n)) return 'Dresses';
      if (/jacket|coat|blazer|parka|puffer|windbreaker/.test(n)) return 'Outerwear';
      if (/bag|wallet|belt|hat|scarf|watch|jewel|sunglasses/.test(n)) return 'Accessories';
      return claudeData.category || 'Tops';
    })(),

    // Color: Claude always wins (visual inference)
    color: claudeData.color || '#2A2A2A',

    // Condition: Claude wins
    condition: claudeData.condition || 'Good',

    // Emoji: Claude wins
    emoji: claudeData.emoji || '👕',

    // Tags: merge both, deduplicate
    tags: [...new Set([...(claudeData.tags || []), ...(ocrText ? [] : [])])],

    // Debug info
    _ocrText: ocrText.slice(0, 200), // first 200 chars for debugging
    _source: {
      name:  ocrName ? 'google_ocr' : 'claude',
      brand: ocrBrand ? 'google_logo' : (claudeData.brand ? 'claude' : 'none'),
      price: ocrPrice > 0 ? 'google_ocr' : 'claude',
    },
  };

  return res.status(200).json(merged);
}
