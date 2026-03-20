export const config = {
  api: { bodyParser: { sizeLimit: "1mb" } },
};

async function isImageLoadable(url) {
  try {
    const r = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(3000) });
    const ct = r.headers.get("content-type") || "";
    return r.ok && ct.startsWith("image/");
  } catch(e) { return false; }
}

async function searchImageWithAnthropic(query, apiKey) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 512,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      system: "You are a product image finder. Search for the product image and return ONLY a JSON object: {\"imageUrl\": \"https://...direct-image-url.jpg\"} or {\"imageUrl\": null}. The URL must end in .jpg, .jpeg, .png, or .webp and be a direct image link, not a webpage link.",
      messages: [{
        role: "user",
        content: `Find a direct product image URL for: "${query}". Return only JSON with imageUrl field.`
      }],
    }),
  });
  const data = await response.json();
  const text = data.content?.find(b => b.type === "text")?.text || "";
  try {
    const clean = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);
    return parsed.imageUrl || null;
  } catch(e) {
    const urlMatch = text.match(/https?:\/\/[^\s"']+\.(?:jpg|jpeg|png|webp)[^\s"']*/i);
    return urlMatch?.[0] || null;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { query } = req.body;
  if (!query) return res.status(400).json({ error: "No query provided" });

  // Try Google CSE first
  const apiKey = process.env.GOOGLE_API_KEY;
  const cseId = process.env.GOOGLE_CSE_ID;
  if (apiKey && cseId) {
    try {
      const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cseId}&q=${encodeURIComponent(query)}&searchType=image&num=3&imgSize=large`;
      const response = await fetch(url);
      const data = await response.json();
      if (response.ok && data.items?.length) {
        for (const item of data.items) {
          const imageUrl = item.image?.thumbnailLink || item.link;
          if (imageUrl && await isImageLoadable(imageUrl)) {
            return res.status(200).json({ imageUrl });
          }
        }
      }
    } catch(e) { /* fall through */ }
  }

  // Fallback: Anthropic web search — try up to 2 times
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) return res.status(200).json({ imageUrl: null });

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const imageUrl = await searchImageWithAnthropic(query, anthropicKey);
      if (imageUrl && await isImageLoadable(imageUrl)) {
        return res.status(200).json({ imageUrl });
      }
    } catch(e) { /* try again */ }
  }

  return res.status(200).json({ imageUrl: null });
}
