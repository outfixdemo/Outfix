export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'No URL' });

  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    });
    const html = await r.text();

    // ── 1. JSON-LD structured data (most accurate) ──
    const jsonLdMatch = html.match(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi) || [];
    for (const block of jsonLdMatch) {
      try {
        const inner = block.replace(/<script[^>]*>/, '').replace(/<\/script>/, '');
        const data = JSON.parse(inner);
        const product = Array.isArray(data) ? data.find(d => d['@type'] === 'Product') : data['@type'] === 'Product' ? data : null;
        if (product) {
          const price = product.offers?.price || product.offers?.[0]?.price || null;
          const image = Array.isArray(product.image) ? product.image[0] : product.image || null;
          const name = product.name || null;
          const brand = product.brand?.name || product.brand || null;
          const description = product.description?.slice(0, 300) || null;
          if (name || image || price) return res.json({ name, brand, price: price ? parseFloat(price) : null, image, description });
        }
      } catch (e) {}
    }

    // ── 2. Open Graph meta tags ──
    const ogTitle = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i)?.[1] || null;
    const ogImage = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i)?.[1] || null;
    const ogDesc = html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]+)"/i)?.[1]?.slice(0,300) || null;

    // ── 3. Price patterns ──
    const priceMatch = html.match(/["']price["']\s*:\s*["']?([\d.]+)["']?/) ||
                       html.match(/itemprop="price"[^>]*content="([\d.]+)"/) ||
                       html.match(/class="[^"]*price[^"]*"[^>]*>\s*\$?([\d,]+\.?\d*)/i);
    const price = priceMatch ? parseFloat(priceMatch[1].replace(',','')) : null;

    // ── 4. Product name fallbacks ──
    const titleTag = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.split('|')[0]?.split('-')[0]?.trim() || null;
    const h1Tag = html.match(/<h1[^>]*>([^<]+)<\/h1>/i)?.[1]?.trim() || null;

    return res.json({
      name: ogTitle || h1Tag || titleTag || null,
      brand: null,
      price,
      image: ogImage || null,
      description: ogDesc || null,
    });
  } catch (e) {
    return res.json({ name: null, brand: null, price: null, image: null, description: null });
  }
}
