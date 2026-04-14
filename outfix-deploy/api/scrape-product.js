export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'url required' });

  const firecrawlKey = process.env.FIRECRAWL_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  // ── HELPERS ──────────────────────────────────────────────────────────────────

  // Parse JSON-LD product schema from raw HTML
  const parseJsonLd = (html) => {
    const results = [];
    const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = re.exec(html)) !== null) {
      try {
        const obj = JSON.parse(m[1].trim());
        const items = Array.isArray(obj) ? obj : [obj];
        for (const item of items) {
          if (item['@type'] === 'Product' || item['@type']?.includes?.('Product')) {
            results.push(item);
          }
          // Some sites nest Product inside @graph
          if (item['@graph']) {
            for (const g of item['@graph']) {
              if (g['@type'] === 'Product') results.push(g);
            }
          }
        }
      } catch (e) {}
    }
    return results[0] || null;
  };

  // Parse Open Graph tags from HTML
  const parseOG = (html) => {
    const get = (prop) => {
      const m = html.match(new RegExp(`<meta[^>]+property=["']og:${prop}["'][^>]+content=["']([^"']+)["']`, 'i'))
               || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:${prop}["']`, 'i'));
      return m?.[1] || null;
    };
    return { title: get('title'), image: get('image'), description: get('description'), price: get('price:amount') };
  };

  // Extract color hex from product data
  const colorNameToHex = (name = '') => {
    const map = {
      black:'#1A1A1A', white:'#F5F5F5', grey:'#888888', gray:'#888888',
      navy:'#1B2A4A', blue:'#3A6EA5', red:'#C0392B', green:'#27AE60',
      brown:'#6B3F2A', tan:'#C4A882', camel:'#C19A6B', cream:'#FFFDD0',
      beige:'#D4B896', khaki:'#BDB76B', olive:'#808000', pink:'#FFB6C1',
      burgundy:'#800020', wine:'#722F37', yellow:'#F1C40F', orange:'#E67E22',
      purple:'#8E44AD', lavender:'#B57EDC', teal:'#008080', mint:'#98FF98',
      coral:'#FF6B6B', ivory:'#FFFFF0', stone:'#8A7968', sand:'#C2B280',
    };
    const lower = name.toLowerCase();
    for (const [key, hex] of Object.entries(map)) {
      if (lower.includes(key)) return hex;
    }
    return '#2A2A2A';
  };

  // Map product category string to Outfix categories
  const mapCategory = (str = '') => {
    const s = str.toLowerCase();
    if (/dress|skirt|jumpsuit|romper/.test(s)) return 'Dresses';
    if (/jacket|coat|blazer|parka|puffer|windbreaker|hoodie|sweater|knitwear|cardigan/.test(s)) return 'Outerwear';
    if (/shoe|sneaker|boot|loafer|heel|sandal|trainer|runner/.test(s)) return 'Shoes';
    if (/pant|jean|trouser|short|legging|bottom/.test(s)) return 'Bottoms';
    if (/bag|wallet|belt|hat|scarf|glove|jewel|watch|accessory|sunglasses/.test(s)) return 'Accessories';
    return 'Tops';
  };

  // Merge partial result with defaults
  const buildResult = (data, source) => ({
    name: data.name || '',
    brand: data.brand || '',
    price: parseFloat(String(data.price).replace(/[^0-9.]/g, '')) || 0,
    color: data.color || '#2A2A2A',
    category: data.category || 'Tops',
    image: data.image || null,
    condition: 'Like New',
    tags: data.tags || [],
    source,
  });

  // ── TIER 1: Raw HTML + JSON-LD ───────────────────────────────────────────────
  let result = null;

  try {
    const htmlRes = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      signal: AbortSignal.timeout(8000),
    });

    if (htmlRes.ok) {
      const html = await htmlRes.text();
      const product = parseJsonLd(html);
      const og = parseOG(html);

      if (product) {
        // Extract price from offers
        const offer = Array.isArray(product.offers) ? product.offers[0] : product.offers;
        const price = offer?.price || offer?.lowPrice || product.price || og.price || 0;

        // Extract image — prefer array first image, then string
        const imgRaw = Array.isArray(product.image) ? product.image[0] : product.image;
        const image = (typeof imgRaw === 'string' ? imgRaw : imgRaw?.url) || og.image || null;

        // Extract color
        const colorStr = product.color || '';
        const color = colorStr.startsWith('#') ? colorStr : colorNameToHex(colorStr);

        // Extract brand
        const brand = (typeof product.brand === 'string' ? product.brand : product.brand?.name) || '';

        // Extract category
        const catRaw = product.category || product.itemCondition || '';
        const category = mapCategory(catRaw) || mapCategory(product.name || '');

        const isComplete = product.name && brand && price > 0 && image;

        result = buildResult({ name: product.name, brand, price, color, category, image }, 'jsonld');

        if (isComplete) {
          return res.status(200).json(result);
        }
        // Partial — continue to Tier 2 to fill gaps
      }
    }
  } catch (e) {
    console.log('Tier 1 failed:', e.message);
  }

  // ── TIER 2: Firecrawl (JS-rendered pages) ───────────────────────────────────
  if (firecrawlKey) {
    try {
      const fcRes = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${firecrawlKey}`,
        },
        body: JSON.stringify({
          url,
          formats: ['extract'],
          extract: {
            schema: {
              type: 'object',
              properties: {
                name:     { type: 'string', description: 'Full product name' },
                brand:    { type: 'string', description: 'Brand name' },
                price:    { type: 'number', description: 'Current price as a number' },
                color:    { type: 'string', description: 'Product color' },
                category: { type: 'string', description: 'Product category' },
                image:    { type: 'string', description: 'Primary product image URL' },
              },
            },
          },
        }),
        signal: AbortSignal.timeout(15000),
      });

      if (fcRes.ok) {
        const fcData = await fcRes.json();
        const ext = fcData?.data?.extract;
        if (ext?.name) {
          const merged = {
            name:     ext.name     || result?.name     || '',
            brand:    ext.brand    || result?.brand    || '',
            price:    ext.price    || result?.price    || 0,
            color:    ext.color    ? colorNameToHex(ext.color) : (result?.color || '#2A2A2A'),
            category: ext.category ? mapCategory(ext.category) : (result?.category || 'Tops'),
            image:    ext.image    || result?.image    || null,
          };
          result = buildResult(merged, 'firecrawl');

          const isComplete = merged.name && merged.brand && merged.price > 0 && merged.image;
          if (isComplete) return res.status(200).json(result);
        }
      }
    } catch (e) {
      console.log('Tier 2 failed:', e.message);
    }
  }

  // ── TIER 3: Claude fills gaps from URL slug ──────────────────────────────────
  if (anthropicKey) {
    try {
      const urlObj = new URL(url);
      const slug = urlObj.pathname.split('/').filter(Boolean).join(' ').replace(/-/g, ' ');
      const domain = urlObj.hostname.replace('www.', '').replace('.com', '').replace('.co', '');

      const partial = result ? `Partial data already found: ${JSON.stringify(result)}. Fill in any missing or zero fields.` : '';

      const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
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
            content: `A user is adding a clothing item to their wardrobe app. URL: "${url}" Domain: ${domain} URL path: "${slug}" ${partial}\n\nUsing your knowledge of this brand and the URL, return ONLY valid JSON:\n{"name":"full product name","brand":"brand name","price":0,"color":"#hexcode","category":"Tops|Bottoms|Dresses|Outerwear|Shoes|Accessories","image":null,"tags":["tag1","tag2"]}`,
          }],
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (claudeRes.ok) {
        const claudeData = await claudeRes.json();
        const text = claudeData.content?.[0]?.text || '';
        const json = JSON.parse(text.replace(/```json|```/g, '').trim());
        const merged = {
          name:     json.name     || result?.name     || '',
          brand:    json.brand    || result?.brand    || '',
          price:    json.price    || result?.price    || 0,
          color:    json.color    || result?.color    || '#2A2A2A',
          category: json.category || result?.category || 'Tops',
          image:    json.image    || result?.image    || null,
          tags:     json.tags     || [],
        };
        return res.status(200).json(buildResult(merged, 'claude'));
      }
    } catch (e) {
      console.log('Tier 3 failed:', e.message);
    }
  }

  // ── FALLBACK: return whatever we have ────────────────────────────────────────
  if (result) return res.status(200).json(result);
  return res.status(422).json({ error: 'Could not extract product data from URL' });
}
