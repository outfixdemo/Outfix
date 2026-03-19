export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { query } = req.body;
  if (!query) return res.status(400).json({ error: "No query provided" });

  const apiKey = process.env.GOOGLE_API_KEY;
  const cseId = process.env.GOOGLE_CSE_ID;

  if (!apiKey || !cseId) return res.status(500).json({ error: "Google credentials not configured", hasKey: !!apiKey, hasCse: !!cseId });

  try {
    const searchUrl = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cseId}&q=${encodeURIComponent(query)}&searchType=image&num=1&imgSize=large`;
    const response = await fetch(searchUrl);
    const data = await response.json();
    
    // Log full response for debugging
    console.log("Google CSE status:", response.status);
    console.log("Google CSE response:", JSON.stringify(data).slice(0, 500));
    
    const item = data.items?.[0];
    const imageUrl = item?.image?.thumbnailLink || item?.link || null;
    
    return res.status(200).json({ 
      imageUrl,
      debug: {
        status: response.status,
        hasItems: !!data.items,
        itemCount: data.items?.length || 0,
        error: data.error?.message || null,
        firstItem: item ? { link: item.link, hasThumbnail: !!item.image?.thumbnailLink } : null
      }
    });
  } catch (err) {
    return res.status(200).json({ imageUrl: null, debug: { error: err.message } });
  }
}
