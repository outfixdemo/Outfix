export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { query } = req.body;
  if (!query) return res.status(400).json({ error: "No query provided" });

  const apiKey = process.env.GOOGLE_API_KEY;
  const cseId = process.env.GOOGLE_CSE_ID;

  if (!apiKey || !cseId) return res.status(500).json({ error: "Google credentials not configured" });

  try {
    const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cseId}&q=${encodeURIComponent(query)}&searchType=image&num=1&imgSize=large&imgType=photo`;
    const response = await fetch(url);
    const data = await response.json();
    const imageUrl = data.items?.[0]?.link || null;
    return res.status(200).json({ imageUrl });
  } catch (err) {
    return res.status(200).json({ imageUrl: null });
  }
}
