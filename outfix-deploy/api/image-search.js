export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { query } = req.body;
  if (!query) return res.status(400).json({ error: 'No query provided' });

  const key = process.env.GOOGLE_SEARCH_KEY;
  const cx = process.env.GOOGLE_SEARCH_CX;

  if (!key || !cx) return res.status(200).json({ imageUrl: null, note: 'Search not configured' });

  try {
    const searchQuery = encodeURIComponent(`${query} product photo official`);
    const url = `https://www.googleapis.com/customsearch/v1?key=${key}&cx=${cx}&q=${searchQuery}&searchType=image&num=3&imgSize=large&imgType=photo&safe=active`;

    const response = await fetch(url);
    const data = await response.json();

    const items = data.items || [];
    // Prefer results from brand/retailer domains, not stock photo sites
    const blocklist = ['pinterest', 'instagram', 'tumblr', 'reddit', 'shutterstock', 'getty', 'alamy', 'dreamstime'];
    const best = items.find(item => !blocklist.some(b => item.link.includes(b))) || items[0];

    res.status(200).json({ imageUrl: best?.link || null });
  } catch (e) {
    res.status(200).json({ imageUrl: null, note: e.message });
  }
}
