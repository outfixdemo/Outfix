export default async function handler(req, res) {
  if(req.method !== 'POST') return res.status(405).end();
  const { url } = req.body;
  if(!url) return res.status(400).json({});

  try {
    const controller = new AbortController();
    setTimeout(()=>controller.abort(), 8000);

    const r = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    });
    const html = await r.text();

    // og:image
    let image = null;
    const ogImg = html.match(/property="og:image"[^>]*content="([^"]+)"/);
    if(ogImg) image = ogImg[1];
    if(!image){ const tw = html.match(/name="twitter:image"[^>]*content="([^"]+)"/); if(tw) image = tw[1]; }

    // Price via JSON-LD
    let price = null;
    const ldBlocks = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)||[];
    for(const b of ldBlocks){
      try {
        const d = JSON.parse(b.replace(/<script[^>]*>/,'').replace(/<\/script>/,''));
        const o = d.offers || d['@graph']?.find(n=>n.offers)?.offers;
        if(o?.price){ price = parseFloat(o.price); break; }
        if(o?.[0]?.price){ price = parseFloat(o[0].price); break; }
      } catch(e){}
    }

    // Price via meta tag
    if(!price){ const m = html.match(/property="product:price:amount"[^>]*content="([^"]+)"/); if(m) price=parseFloat(m[1]); }
    if(!price){ const m = html.match(/itemprop="price"[^>]*content="([^"]+)"/); if(m) price=parseFloat(m[1]); }

    // Name via og:title
    let name = null;
    const ogTitle = html.match(/property="og:title"[^>]*content="([^"]+)"/);
    if(ogTitle) name = ogTitle[1];

    // Brand via og:site_name
    let brand = null;
    const ogBrand = html.match(/property="og:site_name"[^>]*content="([^"]+)"/);
    if(ogBrand) brand = ogBrand[1];

    // Description
    let description = null;
    const ogDesc = html.match(/property="og:description"[^>]*content="([^"]+)"/);
    if(ogDesc) description = ogDesc[1];

    res.status(200).json({ price, image, name, brand, description });
  } catch(e) {
    res.status(200).json({ price:null, image:null, name:null, brand:null, description:null });
  }
}
