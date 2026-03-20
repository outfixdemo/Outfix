export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'No URL provided' });

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    });

    const html = await response.text();

    // ── Price extraction ──
    let price = null;

    // Method 1: JSON-LD structured data (most reliable — used by Gucci, Net-a-Porter, etc.)
    const jsonLdMatches = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi) || [];
    for (const block of jsonLdMatches) {
      try {
        const inner = block.replace(/<script[^>]*>/, '').replace(/<\/script>/, '');
        const data = JSON.parse(inner);
        const offers = data.offers || data['@graph']?.find(n => n.offers)?.offers;
        if (offers?.price) { price = parseFloat(offers.price); break; }
        if (offers?.[0]?.price) { price = parseFloat(offers[0].price); break; }
      } catch(e) {}
    }

    // Method 2: meta tags
    if (!price) {
      const ogPrice = html.match(/property="product:price:amount"[^>]*content="([^"]+)"/);
      if (ogPrice) price = parseFloat(ogPrice[1]);
    }

    // Method 3: common price patterns in HTML
    if (!price) {
      const patterns = [
        /itemprop="price"[^>]*content="([^"]+)"/,
        /"price"\s*:\s*"?(\d+\.?\d*)"/,
        /class="[^"]*price[^"]*"[^>]*>\s*\$?([\d,]+\.?\d*)/i,
      ];
      for (const p of patterns) {
        const m = html.match(p);
        if (m) { price = parseFloat(m[1].replace(/,/g,'')); break; }
      }
    }

    // ── Image extraction ──
    let image = null;

    // og:image is the most reliable across all sites
    const ogImg = html.match(/property="og:image"[^>]*content="([^"]+)"/);
    if (ogImg) image = ogImg[1];

    if (!image) {
      const twImg = html.match(/name="twitter:image"[^>]*content="([^"]+)"/);
      if (twImg) image = twImg[1];
    }

    res.status(200).json({ price: price || null, image: image || null });

  } catch (e) {
    res.status(500).json({ error: e.message, price: null, image: null });
  }
}
