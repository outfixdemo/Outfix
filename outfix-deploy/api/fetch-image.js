export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "No URL provided" });

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; Outfix/1.0)",
        "Accept": "text/html",
      },
      redirect: "follow",
    });

    const html = await response.text();

    // Try og:image first, then twitter:image, then first large product image
    const patterns = [
      /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
      /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i,
    ];

    let imageUrl = null;
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match?.[1] && match[1].startsWith("http")) {
        imageUrl = match[1];
        break;
      }
    }

    return res.status(200).json({ imageUrl });
  } catch (err) {
    return res.status(200).json({ imageUrl: null });
  }
}
