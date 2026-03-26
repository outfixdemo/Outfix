// pages/api/fetch-product.js
// Fetches og:image, price, name from any product URL with real browser headers

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "No URL" });

  const strategies = [
    {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
        "Referer": "https://www.google.com/",
      }
    },
    {
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://www.google.com/",
      }
    },
    {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      }
    }
  ];

  let html = null;

  for (const strategy of strategies) {
    try {
      const response = await fetch(url, {
        headers: strategy.headers,
        redirect: "follow",
        signal: AbortSignal.timeout(10000),
      });
      if (response.ok) {
        html = await response.text();
        if (html && html.length > 500) break;
      }
    } catch (err) {}
  }

  if (!html) {
    return res.status(200).json({ image: null, price: null, name: null, brand: null });
  }

  // ── og:image ──────────────────────────────────────────────────────────────
  const imagePatterns = [
    /<meta[^>]+property=["']og:image:secure_url["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image:secure_url["']/i,
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i,
    /<meta[^>]+name=["']twitter:image:src["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image:src["']/i,
    /"image"\s*:\s*["']?(https?:\/\/[^"',\s\]]+)/i,
  ];

  let image = null;
  for (const pattern of imagePatterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      const candidate = match[1].replace(/&amp;/g, "&").trim();
      if (candidate.startsWith("data:") || candidate.includes("1x1") || candidate.includes("favicon") || candidate.includes("logo") || candidate.length < 10) continue;
      image = candidate;
      break;
    }
  }

  // ── price ─────────────────────────────────────────────────────────────────
  const pricePatterns = [
    /<meta[^>]+property=["']product:price:amount["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+property=["']og:price:amount["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']product:price:amount["']/i,
    /"price"\s*:\s*"?([\d,]+\.?\d*)"?/,
    /"priceValue"\s*:\s*([\d,]+\.?\d*)/,
    /"offers"\s*:\s*\{[^}]*"price"\s*:\s*"?([\d,]+\.?\d*)/i,
    /itemprop=["']price["'][^>]+content=["']([^"']+)["']/i,
    /\$\s*([\d,]+(?:\.\d{2})?)/,
  ];

  let price = null;
  for (const pattern of pricePatterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      const parsed = parseFloat(match[1].replace(/,/g, ""));
      if (!isNaN(parsed) && parsed > 0 && parsed < 100000) { price = parsed; break; }
    }
  }

  // ── name ──────────────────────────────────────────────────────────────────
  const namePatterns = [
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i,
    /<title>([^<]+)<\/title>/i,
  ];

  let name = null;
  for (const pattern of namePatterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      name = match[1].replace(/\s*[\|–\-]\s*.{0,40}$/, "").replace(/&amp;/g, "&").replace(/&#\d+;/g, "").trim();
      if (name.length > 2) break;
    }
  }

  // ── brand ─────────────────────────────────────────────────────────────────
  const brandPatterns = [
    /<meta[^>]+property=["']og:brand["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+property=["']product:brand["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']product:brand["']/i,
    /"brand"\s*:\s*\{[^}]*"name"\s*:\s*"([^"]+)"/i,
    /"brand"\s*:\s*"([^"]+)"/i,
  ];

  let brand = null;
  for (const pattern of brandPatterns) {
    const match = html.match(pattern);
    if (match?.[1]) { brand = match[1].trim(); break; }
  }

  return res.status(200).json({ image, price, name, brand });
}
