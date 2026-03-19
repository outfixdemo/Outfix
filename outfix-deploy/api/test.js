export default function handler(req, res) {
  const key = process.env.ANTHROPIC_API_KEY;
  res.status(200).json({
    status: "ok",
    hasKey: !!key,
    keyPrefix: key ? key.slice(0, 20) + "..." : "missing",
    method: req.method,
  });
}
