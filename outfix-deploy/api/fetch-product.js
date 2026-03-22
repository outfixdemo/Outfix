export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'No URL provided' });

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
      }
    });

    clearTimeout(timeout);
    const html = await response.text();

    // ── 1. JSON-LD structured data (most reliable) ──────────────────────────
    let price = null;
    let image = null;

    const jsonLdBlocks = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
    for (const block of jsonLdBlocks) {
      try {
        const raw = block[1].trim();
        const data = JSON.parse(raw);
        const nodes = Array.isArray(data) ? data : (data['@graph'] ? data['@graph'] : [data]);

        for (const node of nodes) {
          // Price
          if (!price) {
            const offers = node.offers || node.Offers;
            if (offers) {
              const offer = Array.isArray(offers) ? offers[0] : offers;
              const p = offer?.price ?? offer?.lowPrice ?? offer?.priceSpecification?.price;
              if (p) price = parseFloat(String(p).replace(/[^0-9.]/g, ''));
            }
          }
          // Image
          if (!image) {
            const img = node.image;
            if (typeof img === 'string' && img.startsWith('http')) image = img;
            else if (Array.isArray(img) && img[0]) image = typeof img[0] === 'string' ? img[0] : img[0]?.url;
            else if (img?.url) image = img.url;
          }
        }
      } catch (e) {}
      if (price && image) break;
    }

    // ── 2. Open Graph / meta tags ────────────────────────────────────────────
    if (!image) {
      const ogImg = html.match(/property=["']og:image["'][^>]*content=["']([^"']+)["']/i)
                 || html.match(/content=["']([^"']+)["'][^>]*property=["']og:image["']/i)
                 || html.match(/name=["']twitter:image["'][^>]*content=["']([^"']+)["']/i);
      if (ogImg?.[1]) image = ogImg[1];
    }

    if (!price) {
      const metaPrice = html.match(/property=["']product:price:amount["'][^>]*content=["']([^"']+)["']/i)
                      || html.match(/content=["']([^"']+)["'][^>]*property=["']product:price:amount["']/i);
      if (metaPrice?.[1]) price = parseFloat(metaPrice[1]);
    }

    // ── 3. itemprop / schema fallbacks ───────────────────────────────────────
    if (!price) {
      const patterns = [
        /itemprop=["']price["'][^>]*content=["']([^"']+)["']/i,
        /class=["'][^"']*price[^"']*["'][^>]*>\s*[£$€¥]?\s*([\d,]+\.?\d*)/i,
        /"price"\s*:\s*"?([\d.]+)"?/,
        /data-price=["']([\d.]+)["']/i,
      ];
      for (const p of patterns) {
        const m = html.match(p);
        if (m?.[1]) { price = parseFloat(m[1].replace(/,/g, '')); break; }
      }
    }

    // ── 4. High-res image fallbacks ─────────────────────────────────────────
    if (!image) {
      // Look for large product images by data attributes
      const dataPatterns = [
        /data-src=["'](https:\/\/[^"']*(?:product|item|pdp)[^"']*\.(?:jpg|jpeg|png|webp)[^"']*)["']/i,
        /data-zoom-image=["'](https:\/\/[^"']+\.(?:jpg|jpeg|png|webp)[^"']*)["']/i,
        /"large":"(https:\/\/[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/i,
        /"zoom":"(https:\/\/[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/i,
      ];
      for (const p of dataPatterns) {
        const m = html.match(p);
        if (m?.[1]) { image = m[1]; break; }
      }
    }

    // Resolve protocol-relative URLs
    if (image?.startsWith('//')) {
      const base = new URL(url);
      image = base.protocol + image;
    }

    res.status(200).json({ price: price || null, image: image || null });

  } catch (e) {
    res.status(200).json({ price: null, image: null, note: e.message });
  }
}
