// /api/scrape-product.js
// Extracts product info from a retail URL and returns normalized JSON
// for the add-item flow. Image extraction is prioritized to prefer
// real product photos over color swatches or thumbnails.
//
// Strategy (in order):
//   1. JSON-LD structured data (schema.org/Product) — most accurate
//   2. <meta property="og:image"> — Open Graph
//   3. <meta name="twitter:image">
//   4. First large <img> with "product/hero/main" keywords
//   5. Largest srcset variant from a <picture>/<img>
//
// Every candidate is validated against a blocklist of keywords that
// typically indicate a swatch, thumbnail, or non-product asset.

export const config = {
  api: {
    bodyParser: { sizeLimit: '1mb' },
  },
};

// URL fragments that usually signal a BAD image (swatch, thumbnail, icon, etc.)
const BAD_IMAGE_PATTERNS = [
  /swatch/i,
  /color[-_ ]?picker/i,
  /thumbnail/i,
  /\bthumb\b/i,
  /sprite/i,
  /icon/i,
  /logo/i,
  /placeholder/i,
  /blank/i,
  /spacer/i,
  /1x1/i,
  /pixel/i,
];

// URL fragments that usually signal a GOOD product image
const GOOD_IMAGE_PATTERNS = [
  /product/i,
  /\bhero\b/i,
  /\bmain\b/i,
  /primary/i,
  /front/i,
  /detail/i,
  /large/i,
  /\bfull\b/i,
];

function isLikelySwatch(url) {
  if (!url || typeof url !== 'string') return true;
  // Obvious swatch indicators
  return BAD_IMAGE_PATTERNS.some(p => p.test(url));
}

function scoreImageUrl(url) {
  if (!url) return -100;
  let score = 0;
  // Reject swatches
  if (isLikelySwatch(url)) return -50;
  // Prefer known-good patterns
  for (const p of GOOD_IMAGE_PATTERNS) if (p.test(url)) score += 10;
  // Prefer larger width params if present (e.g., ?w=1200, _1200x, -1200.jpg)
  const widthMatch = url.match(/[?&](w|width)=(\d+)|_(\d+)x|[-_](\d{3,4})\.(?:jpg|jpeg|png|webp)/i);
  if (widthMatch) {
    const width = parseInt(widthMatch[2] || widthMatch[3] || widthMatch[4] || '0', 10);
    if (width >= 800) score += 20;
    else if (width >= 400) score += 10;
    else if (width < 200) score -= 20;
  }
  // Prefer HTTPS
  if (url.startsWith('https://')) score += 2;
  // Prefer non-data URLs (data URLs in HTML are usually placeholders)
  if (url.startsWith('data:')) score -= 30;
  return score;
}

// Extract all JSON-LD blocks from HTML
function extractJsonLd(html) {
  const blocks = [];
  const regex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      // Sometimes JSON-LD is wrapped in a @graph array
      if (Array.isArray(parsed)) blocks.push(...parsed);
      else if (parsed['@graph']) blocks.push(...parsed['@graph']);
      else blocks.push(parsed);
    } catch (e) { /* malformed JSON — skip */ }
  }
  return blocks;
}

// Find a Product entity in JSON-LD
function findProduct(jsonLdBlocks) {
  for (const b of jsonLdBlocks) {
    const type = b['@type'];
    if (type === 'Product' || (Array.isArray(type) && type.includes('Product'))) return b;
  }
  return null;
}

// Get a clean meta tag value
function getMeta(html, property) {
  const patterns = [
    new RegExp(`<meta[^>]*property=["']${property}["'][^>]*content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*property=["']${property}["']`, 'i'),
    new RegExp(`<meta[^>]*name=["']${property}["'][^>]*content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*name=["']${property}["']`, 'i'),
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m && m[1]) return m[1].trim();
  }
  return null;
}

// Extract candidate images from <img> and srcset
function extractImgCandidates(html) {
  const imgs = [];
  const imgRegex = /<img[^>]+>/gi;
  let match;
  while ((match = imgRegex.exec(html)) !== null) {
    const tag = match[0];
    const srcMatch = tag.match(/\bsrc=["']([^"']+)["']/i);
    const srcsetMatch = tag.match(/\bsrcset=["']([^"']+)["']/i);
    const altMatch = tag.match(/\balt=["']([^"']+)["']/i);
    const classMatch = tag.match(/\bclass=["']([^"']+)["']/i);
    if (srcMatch) imgs.push({ url: srcMatch[1], alt: altMatch?.[1] || '', className: classMatch?.[1] || '' });
    if (srcsetMatch) {
      // Parse srcset: "url1 300w, url2 600w, url3 1200w" → pick largest
      const candidates = srcsetMatch[1].split(',').map(s => {
        const parts = s.trim().split(/\s+/);
        return { url: parts[0], width: parseInt(parts[1] || '0', 10) };
      });
      candidates.sort((a, b) => b.width - a.width);
      if (candidates[0]) imgs.push({ url: candidates[0].url, alt: altMatch?.[1] || '', className: classMatch?.[1] || '' });
    }
  }
  return imgs;
}

// Pick the best image from all candidates
function pickBestImage(candidates) {
  if (!candidates.length) return null;
  const scored = candidates.map(c => ({ ...c, score: scoreImageUrl(c.url) }));
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  return best.score > -30 ? best.url : null;
}

// Resolve relative URL against the base URL
function resolveUrl(src, baseUrl) {
  if (!src) return null;
  if (src.startsWith('//')) return 'https:' + src;
  if (src.startsWith('/')) {
    try {
      const u = new URL(baseUrl);
      return `${u.protocol}//${u.host}${src}`;
    } catch (e) { return src; }
  }
  if (src.startsWith('http')) return src;
  try { return new URL(src, baseUrl).toString(); } catch (e) { return src; }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { url } = req.body || {};
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'url is required' });
  }

  try {
    // Fetch the page HTML
    const pageRes = await fetch(url, {
      headers: {
        // Pretend to be a normal browser — many sites 403 bot-ish UAs
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
    });

    if (!pageRes.ok) {
      return res.status(502).json({ error: `Page fetch failed: ${pageRes.status}` });
    }

    const html = await pageRes.text();

    // ── Image extraction (priority order) ──
    let imageUrl = null;
    let imageSource = 'none';

    // 1. JSON-LD structured data
    const jsonLd = extractJsonLd(html);
    const product = findProduct(jsonLd);
    if (product) {
      const imgField = product.image;
      let productImages = [];
      if (typeof imgField === 'string') productImages = [imgField];
      else if (Array.isArray(imgField)) productImages = imgField.filter(x => typeof x === 'string');
      else if (imgField && imgField.url) productImages = [imgField.url];
      // Score each and pick the best
      const best = pickBestImage(productImages.map(u => ({ url: u })));
      if (best) { imageUrl = best; imageSource = 'json-ld'; }
    }

    // 2. Open Graph image
    if (!imageUrl) {
      const og = getMeta(html, 'og:image');
      if (og && !isLikelySwatch(og)) { imageUrl = og; imageSource = 'og:image'; }
    }

    // 3. Twitter image
    if (!imageUrl) {
      const twitter = getMeta(html, 'twitter:image');
      if (twitter && !isLikelySwatch(twitter)) { imageUrl = twitter; imageSource = 'twitter:image'; }
    }

    // 4. Fallback: best <img> tag on the page
    if (!imageUrl) {
      const candidates = extractImgCandidates(html);
      const best = pickBestImage(candidates);
      if (best) { imageUrl = best; imageSource = 'img-tag'; }
    }

    // Resolve relative URLs
    if (imageUrl) imageUrl = resolveUrl(imageUrl, url);

    // ── Text extraction ──
    const title = getMeta(html, 'og:title') || getMeta(html, 'twitter:title') ||
      (html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() || '');
    const description = getMeta(html, 'og:description') || getMeta(html, 'description') || '';

    // Product-level fields from JSON-LD if available
    let name = '', brand = '', price = 0;
    if (product) {
      name = product.name || '';
      brand = (typeof product.brand === 'string' ? product.brand : product.brand?.name) || '';
      const offers = product.offers;
      if (offers) {
        const offerPrice = Array.isArray(offers) ? offers[0]?.price : offers.price;
        if (offerPrice) price = parseFloat(offerPrice) || 0;
      }
    }

    // Fallback: domain → brand
    if (!brand) {
      try {
        const u = new URL(url);
        brand = u.hostname.replace(/^www\./, '').replace(/\.(com|net|org|co.*)$/, '');
        brand = brand.charAt(0).toUpperCase() + brand.slice(1);
      } catch (e) {}
    }

    // Fallback: title → name
    if (!name && title) {
      // Strip common "| BrandName" suffixes
      name = title.split(/[|—–-]/)[0].trim();
    }

    // Use Claude via the existing /api/claude proxy if we need to guess category
    // Simpler: let the frontend's fallback handle category — we just return what we have.

    return res.status(200).json({
      name: name || '',
      brand: brand || '',
      price,
      image: imageUrl || null,
      imageSource,              // debug — lets frontend know which strategy worked
      description,
      category: null,           // frontend/Claude will infer
      color: '#2A2A2A',
      condition: 'Like New',
      tags: [],
    });

  } catch (err) {
    console.error('[scrape-product] error:', err);
    return res.status(500).json({ error: err.message || 'Scrape failed' });
  }
}
