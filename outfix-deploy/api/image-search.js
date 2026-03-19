export const config = {
  api: { bodyParser: { sizeLimit: "1mb" } },
};

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { query } = req.body;
  if (!query) return res.status(400).json({ error: "No query provided" });

  // Try Google CSE first if credentials are available
  const apiKey = process.env.GOOGLE_API_KEY;
  const cseId = process.env.GOOGLE_CSE_ID;

  if (apiKey && cseId) {
    try {
      const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cseId}&q=${encodeURIComponent(query)}&searchType=image&num=1&imgSize=large`;
      const response = await fetch(url);
      const data = await response.json();
      if (response.ok && data.items?.[0]) {
        const item = data.items[0];
        const imageUrl = item.image?.thumbnailLink || item.link || null;
        if (imageUrl) return res.status(200).json({ imageUrl });
      }
    } catch (e) { /* fall through to Anthropic */ }
  }

  // Fallback: use Anthropic web search to find product image
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) return res.status(200).json({ imageUrl: null });

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
        "x-api-key": anthropicKey,
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        tools: [{ type: "web_search_20250305", name: "web_search" }],
        system: "You are a fashion image finder. Search for the product and return ONLY a JSON object with a single field 'imageUrl' containing a direct image URL (.jpg, .jpeg, .png, .webp) from the search results. Return null if no image found. No other text.",
        messages: [{
          role: "user",
          content: `Search for a product image of: "${query}". Return only JSON: {"imageUrl": "https://..."} or {"imageUrl": null}`
        }],
      }),
    });

    const data = await response.json();
    const text = data.content?.find(b => b.type === "text")?.text || "";
    try {
      const clean = text.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(clean);
      return res.status(200).json({ imageUrl: parsed.imageUrl || null });
    } catch(e) {
      // Try to extract URL from text directly
      const urlMatch = text.match(/https?:\/\/[^\s"']+\.(?:jpg|jpeg|png|webp)[^\s"']*/i);
      return res.status(200).json({ imageUrl: urlMatch?.[0] || null });
    }
  } catch (err) {
    return res.status(200).json({ imageUrl: null });
  }
}
