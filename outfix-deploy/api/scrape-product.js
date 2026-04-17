// /api/scrape-product.js
// Hybrid product scraper: HTML parsing for the image, Claude for structured fields.
//
// Why this split:
//   - IMAGE extraction needs precise URL selection (avoid swatches/thumbnails),
//     which is easier with deterministic HTML parsing + scoring.
//   - TEXT fields (name, brand, category, color, price) benefit from AI
//     inference because page structure varies wildly across retailers.
//
// Requires in Vercel env:
//   ANTHROPIC_API_KEY

export const config = {
  api: {
    bodyParser: { sizeLimit: '1mb' },
  },
};

// ────────────────────────────────────────────────────────────────────────────
// IMAGE EXTRACTION — deterministic HTML parsing
// ────────────────────────────────────────────────────────────────────────────

// URL fragments that usually signal a BAD image (swatch, thumbnail, icon, etc.)
const BAD_IMAGE_PATTERNS = [
  /swatch/i, /color[-_ ]?picker/i, /thumbnail/i, /\bthumb\b/i,
  /sprite/i, /\bicon\b/i, /\blogo\b/i, /placeholder/i,
  /blank/i, /spacer/i, /1x1/i, /pixel/i,
];

const GOOD_IMAGE_PATTERNS = [
  /product/i, /\bhero\b/i, /\bmain\b/i, /primary/i,
  /front/i, /detail/i, /large/i, /\bfull\b/i,
];

function isLikelySwatch(url) {
  if (!url || typeof url !== 'string') return true;
  return BAD_IMAGE_PATTERNS.some(p => p.test(url));
}

function scoreImageUrl(url) {
  if (!url) return -100;
  let score = 0;
  if (isLikelySwatch(url)) return -50;
  for (const p of GOOD_IMAGE_PATTERNS) if (p.test(url)) score += 10;
  const widthMatch = url.match(/[?&](w|width)=(\d+)|_(\d+)x|[-_](\d{3,4})\.(?:jpg|jpeg|png|webp)/i);
  if (widthMatch) {
    const width = parseInt(widthMatch[2] || widthMatch[3] || widthMatch[4] || '0', 10);
    if (width >= 800) score += 20;
    else if (width >= 400) score += 10;
    else if (width < 200) score -= 20;
  }
  if (url.startsWith('https://')) score += 2;
  if (url.startsWith('data:')) score -= 30;
  return score;
}

function extractJsonLd(html) {
  const blocks = [];
  const regex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (Array.isArray(parsed)) blocks.push(...parsed);
      else if (parsed['@graph']) blocks.push(...parsed['@graph']);
      else blocks.push(parsed);
    } catch (e) { /* malformed — skip */ }
  }
  return blocks;
}

function findProduct(jsonLdBlocks) {
  for (const b of jsonLdBlocks) {
    const type = b['@type'];
    if (type === 'Product' || (Array.isArray(type) && type.includes('Product'))) return b;
  }
  return null;
}

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

function extractImgCandidates(html) {
  const imgs = [];
  const imgRegex = /<img[^>]+>/gi;
  let match;
  while ((match = imgRegex.exec(html)) !== null) {
    const tag = match[0];
    const srcMatch = tag.match(/\bsrc=["']([^"']+)["']/i);
    const srcsetMatch = tag.match(/\bsrcset=["']([^"']+)["']/i);
    if (srcMatch) imgs.push({ url: srcMatch[1] });
    if (srcsetMatch) {
      const candidates = srcsetMatch[1].split(',').map(s => {
        const parts = s.trim().split(/\s+/);
        return { url: parts[0], width: parseInt(parts[1] || '0', 10) };
      });
      candidates.sort((a, b) => b.width - a.width);
      if (candidates[0]) imgs.push({ url: candidates[0].url });
    }
  }
  return imgs;
}

function pickBestImage(candidates) {
  if (!candidates.length) return null;
  const scored = candidates.map(c => ({ ...c, score: scoreImageUrl(c.url) }));
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  return best.score > -30 ? best.url : null;
}

function resolveUrl(src, baseUrl) {
  if (!src) return null;
  if (src.startsWith('//')) return 'https:' + src;
  if (src.startsWith('/')) {
    try { const u = new URL(baseUrl); return `${u.protocol}//${u.host}${src}`; }
    catch (e) { return src; }
  }
  if (src.startsWith('http')) return src;
  try { return new URL(src, baseUrl).toString(); } catch (e) { return src; }
}

function extractBestImage(html, baseUrl) {
  // Priority 1: JSON-LD Product schema
  const jsonLd = extractJsonLd(html);
  const product = findProduct(jsonLd);
  if (product) {
    const imgField = product.image;
    let productImages = [];
    if (typeof imgField === 'string') productImages = [imgField];
    else if (Array.isArray(imgField)) productImages = imgField.filter(x => typeof x === 'string');
    else if (imgField && imgField.url) productImages = [imgField.url];
    const best = pickBestImage(productImages.map(u => ({ url: u })));
    if (best) return { url: resolveUrl(best, baseUrl), source: 'json-ld', product };
  }

  // Priority 2: Open Graph
  const og = getMeta(html, 'og:image');
  if (og && !isLikelySwatch(og)) return { url: resolveUrl(og, baseUrl), source: 'og:image', product };

  // Priority 3: Twitter
  const twitter = getMeta(html, 'twitter:image');
  if (twitter && !isLikelySwatch(twitter)) return { url: resolveUrl(twitter, baseUrl), source: 'twitter:image', product };

  // Priority 4: Best <img> tag
  const candidates = extractImgCandidates(html);
  const best = pickBestImage(candidates);
  if (best) return { url: resolveUrl(best, baseUrl), source: 'img-tag', product };

  return { url: null, source: 'none', product };
}

// ────────────────────────────────────────────────────────────────────────────
// TEXT EXTRACTION — build a Claude-friendly context snippet
// ────────────────────────────────────────────────────────────────────────────

function buildTextContext(html, url, productJsonLd) {
  const parts = [];
  parts.push(`URL: ${url}`);

  // Domain as brand hint
  try {
    const u = new URL(url);
    parts.push(`Domain: ${u.hostname.replace(/^www\./, '')}`);
  } catch (e) {}

  // Page title
  const title = getMeta(html, 'og:title') || getMeta(html, 'twitter:title') ||
    (html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() || '');
  if (title) parts.push(`Title: ${title}`);

  // Meta description
  const desc = getMeta(html, 'og:description') || getMeta(html, 'description');
  if (desc) parts.push(`Description: ${desc}`);

  // JSON-LD product facts (most accurate source)
  if (productJsonLd) {
    if (productJsonLd.name) parts.push(`Product name: ${productJsonLd.name}`);
    const brand = typeof productJsonLd.brand === 'string'
      ? productJsonLd.brand
      : productJsonLd.brand?.name;
    if (brand) parts.push(`Brand: ${brand}`);
    const offers = productJsonLd.offers;
    const price = Array.isArray(offers) ? offers[0]?.price : offers?.price;
    if (price) parts.push(`Price: ${price} ${Array.isArray(offers) ? offers[0]?.priceCurrency : offers?.priceCurrency || 'USD'}`);
    if (productJsonLd.color) parts.push(`Color (from product data): ${productJsonLd.color}`);
    if (productJsonLd.material) parts.push(`Material: ${productJsonLd.material}`);
  }

  // Headings — h1 is often the product name
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1Match) {
    const h1Text = h1Match[1].replace(/<[^>]+>/g, '').trim();
    if (h1Text && h1Text.length < 200) parts.push(`H1: ${h1Text}`);
  }

  return parts.join('\n');
}

// ────────────────────────────────────────────────────────────────────────────
// CLAUDE INFERENCE — structured field extraction
// ────────────────────────────────────────────────────────────────────────────

async function claudeInfer(context, apiKey) {
  const prompt = `You are extracting clothing-item details from a retail product page. The relevant scraped context is below. Infer the best values. Return ONLY a valid JSON object (no markdown, no prose) with these exact keys:

{
  "name": "Short product name, 2-5 words (e.g. 'Pace Breaker Jogger', 'Silk Slip Dress'). Strip model numbers and size suffixes. If unsure, use page title main segment.",
  "brand": "Brand name (e.g. 'Lululemon', 'Zara', 'Toteme'). Infer from domain or page content.",
  "category": "EXACTLY one of: Tops | Bottoms | Dresses | Outerwear | Shoes | Accessories. Infer from product type.",
  "color": "Hex color code for the dominant/listed color (e.g. '#1A1A1A' for black, '#3A5F3A' for green). If unknown, use '#2A2A2A'.",
  "price": 0,
  "condition": "Like New",
  "tags": []
}

Pricing: price must be a NUMBER in USD without currency symbols. 0 if unknown.
Tags: 2-4 lowercase descriptive tags like ["athletic","jogger"] or ["formal","silk"].

Context:
${context}

Return ONLY the JSON object, nothing else.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`Claude API ${res.status}: ${errBody.slice(0, 200)}`);
  }

  const data = await res.json();
  const text = data?.content?.[0]?.text || '';
  const cleaned = text.replace(/```json\s*|\s*```/g, '').trim();
  return JSON.parse(cleaned);
}

// ────────────────────────────────────────────────────────────────────────────
// MAIN HANDLER
// ────────────────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { url } = req.body || {};
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'url is required' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  try {
    // ── Fetch the retailer page ──
    const pageRes = await fetch(url, {
      headers: {
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

    // ── Image (deterministic) ──
    const { url: imageUrl, source: imageSource, product: productJsonLd } = extractBestImage(html, url);

    // ── Text context for Claude ──
    const context = buildTextContext(html, url, productJsonLd);

    // ── Claude-powered field inference ──
    let fields;
    try {
      fields = await claudeInfer(context, apiKey);
    } catch (e) {
      console.error('[scrape-product] Claude inference failed:', e.message);
      // Fallback: use raw JSON-LD values if Claude fails
      fields = {
        name: productJsonLd?.name || '',
        brand: (typeof productJsonLd?.brand === 'string' ? productJsonLd.brand : productJsonLd?.brand?.name) || '',
        category: null,
        color: '#2A2A2A',
        price: parseFloat((Array.isArray(productJsonLd?.offers) ? productJsonLd.offers[0]?.price : productJsonLd?.offers?.price) || 0) || 0,
        condition: 'Like New',
        tags: [],
      };
    }

    // ── Sanitize + respond ──
    const response = {
      name: fields.name || '',
      brand: fields.brand || '',
      category: fields.category || null,
      color: fields.color || '#2A2A2A',
      price: typeof fields.price === 'number' ? fields.price : (parseFloat(fields.price) || 0),
      condition: fields.condition || 'Like New',
      tags: Array.isArray(fields.tags) ? fields.tags.slice(0, 5) : [],
      image: imageUrl || null,
      imageSource,
    };

    return res.status(200).json(response);

  } catch (err) {
    console.error('[scrape-product] error:', err);
    return res.status(500).json({ error: err.message || 'Scrape failed' });
  }
}
