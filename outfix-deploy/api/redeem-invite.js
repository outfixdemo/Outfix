export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { code, markUsed, userId } = req.body;
  if (!code) return res.status(400).json({ valid: false, error: "No invite code provided" });

  const SB_URL = process.env.SUPABASE_URL || "https://asvrbeonxmskllkshwbl.supabase.co";
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

  if (!SERVICE_KEY) {
    return res.status(500).json({ valid: false, error: "Server configuration error" });
  }

  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${SERVICE_KEY}`,
    "apikey": SERVICE_KEY,
  };

  try {
    // Look up the code
    const lookupRes = await fetch(
      `${SB_URL}/rest/v1/invite_codes?code=eq.${encodeURIComponent(code.toUpperCase())}&select=id,code,used,used_by`,
      { headers }
    );
    const rows = await lookupRes.json();

    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(200).json({ valid: false, error: "Invite code not found" });
    }

    const row = rows[0];

    if (row.used) {
      return res.status(200).json({ valid: false, error: "This invite code has already been used" });
    }

    // If just validating (not marking used yet), return valid
    if (!markUsed) {
      return res.status(200).json({ valid: true });
    }

    // Mark as used
    await fetch(`${SB_URL}/rest/v1/invite_codes?id=eq.${row.id}`, {
      method: "PATCH",
      headers: { ...headers, "Prefer": "return=minimal" },
      body: JSON.stringify({
        used: true,
        used_by: userId || null,
        used_at: new Date().toISOString(),
      }),
    });

    return res.status(200).json({ valid: true });

  } catch (e) {
    console.error("redeem-invite error:", e);
    return res.status(500).json({ valid: false, error: "Server error — please try again" });
  }
}
