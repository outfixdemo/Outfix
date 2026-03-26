// pages/api/fetch-product.js
// Drop-in replacement — fetches og:image + price from any product URL
// Works with Prada, Aritzia, Zara, etc. that block simple scrapers

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "No URL" });

  try {
    // Fetch the page with real browser headers so Cloudflare / bot-protection passes
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
        Referer: "https://www.google.com/",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return res.status(200).json({ image: null, price: null, name: null });
    }

    const html = await response.text();

    // ── Extract og:image ──────────────────────────────────────────────────────
    // Handles both attribute orderings and single/double quotes
    const imagePatterns = [
      /<meta[^>]+property=["']og:image:secure_url["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image:secure_url["']/i,
      /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
      /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i,
    ];

    let image = null;
    for (const pattern of imagePatterns) {
      const match = html.match(pattern);
      if (match?.[1]) {
        image = match[1].replace(/&amp;/g, "&").trim();
        // Skip tiny tracking pixels or data URIs
        if (image.startsWith("data:") || image.includes("pixel") || image.includes("1x1")) {
          image = null;
          continue;
        }
        break;
      }
    }

    // ── Extract price ─────────────────────────────────────────────────────────
    const pricePatterns = [
      /<meta[^>]+property=["']product:price:amount["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+property=["']og:price:amount["'][^>]+content=["']([^"']+)["']/i,
      /"price"\s*:\s*"?([\d,]+\.?\d*)"?/,
      /"priceValue"\s*:\s*([\d,]+\.?\d*)/,
      /\$\s*([\d,]+(?:\.\d{2})?)/,
    ];

    let price = null;
    for (const pattern of pricePatterns) {
      const match = html.match(pattern);
      if (match?.[1]) {
        const parsed = parseFloat(match[1].replace(/,/g, ""));
        if (!isNaN(parsed) && parsed > 0 && parsed < 50000) {
          price = parsed;
          break;
        }
      }
    }

    // ── Extract name ──────────────────────────────────────────────────────────
    const namePatterns = [
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i,
      /<title>([^<]+)<\/title>/i,
    ];

    let name = null;
    for (const pattern of namePatterns) {
      const match = html.match(pattern);
      if (match?.[1]) {
        // Strip site name suffix like " | Prada US" or " - Prada"
        name = match[1]
          .replace(/\s*[\|–\-]\s*.{0,30}$/, "")
          .replace(/&amp;/g, "&")
          .trim();
        if (name.length > 2) break;
      }
    }

    // ── Extract brand ─────────────────────────────────────────────────────────
    const brandPatterns = [
      /<meta[^>]+property=["']og:brand["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+property=["']product:brand["'][^>]+content=["']([^"']+)["']/i,
      /"brand"\s*:\s*\{[^}]*"name"\s*:\s*"([^"]+)"/i,
    ];

    let brand = null;
    for (const pattern of brandPatterns) {
      const match = html.match(pattern);
      if (match?.[1]) { brand = match[1].trim(); break; }
    }

    return res.status(200).json({ image, price, name, brand });

  } catch (err) {
    console.error("fetch-product error:", err.message);
    return res.status(200).json({ image: null, price: null, name: null, brand: null });
  }
}
