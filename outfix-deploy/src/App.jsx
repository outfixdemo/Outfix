import React, { useState, useRef, useEffect, useMemo } from "react";

// ── SUPABASE CLIENT ───────────────────────────────────────────────────────────
const SB_URL = "https://asvrbeonxmskllkshwbl.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFzdnJiZW9ueG1za2xsa3Nod2JsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4NjIyOTcsImV4cCI6MjA4OTQzODI5N30.XKcXvNydVhHcHTjCA7xJ2z7Ey82UA7ojmh81GdTyrVA";

const sbHeaders = (token) => ({
  "Content-Type": "application/json",
  "apikey": SB_KEY,
  "Authorization": `Bearer ${token || SB_KEY}`,
});

// ── CLAUDE AI HELPERS ─────────────────────────────────────────────────────────
async function callClaude(prompt, systemPrompt) {
  const res = await fetch('/api/claude', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, systemPrompt }),
  });
  if (!res.ok) throw new Error(`Claude API error: ${res.status}`);
  const data = await res.json();
  return data.text || '';
}

async function callClaudeVision(imageBase64, mimeType, prompt, systemPrompt) {
  const res = await fetch('/api/claude', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, systemPrompt, imageBase64, mimeType }),
  });
  if (!res.ok) throw new Error(`Claude Vision API error: ${res.status}`);
  const data = await res.json();
  return data.text || '';
}

// Strip model from clothing photo → clean product image via OpenAI gpt-image-1
async function extractGarment(dataUrl) {
  // Convert dataUrl → base64 + mimeType
  const [meta, b64] = dataUrl.split(',');
  const mimeType = meta.match(/:(.*?);/)?.[1] || 'image/jpeg';
  let res;
  try {
    res = await fetch('/api/extract-garment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64: b64, mimeType }),
    });
  } catch (netErr) {
    // Network/connection error — endpoint may not exist on Vercel
    throw new Error(`Network error: ${netErr.message}`);
  }
  if (!res.ok) {
    // Try to parse error as JSON, fall back to text
    let errDetails = '';
    try {
      const errJson = await res.json();
      errDetails = errJson.error || errJson.message || JSON.stringify(errJson).slice(0, 300);
    } catch (e) {
      const errText = await res.text().catch(() => '');
      errDetails = errText.slice(0, 300);
    }
    console.error('[extractGarment] API returned error:', { status: res.status, body: errDetails });
    // Classify common failures
    if (res.status === 404) throw new Error('endpoint_missing');
    if (res.status === 401) throw new Error('api_key_invalid');
    if (res.status === 402 || /quota|billing|credit/i.test(errDetails)) throw new Error('quota_exceeded');
    if (res.status === 413 || /too large|size limit/i.test(errDetails)) throw new Error('image_too_large');
    if (res.status === 429) throw new Error('rate_limited');
    if (res.status >= 500) throw new Error(`server_${res.status}`);
    throw new Error(`api_${res.status}:${errDetails.slice(0, 80)}`);
  }
  const data = await res.json();
  if (!data.dataUrl) throw new Error('no_image_returned');
  return data.dataUrl;
}

const sb = {
  // ── Auth ──
  async signUp(email, password, name) {
    const r = await fetch(`${SB_URL}/auth/v1/signup`, {
      method: "POST",
      headers: sbHeaders(),
      body: JSON.stringify({ email, password, data: { name } }),
    });
    return r.json();
  },
  async signIn(email, password) {
    const r = await fetch(`${SB_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: sbHeaders(),
      body: JSON.stringify({ email, password }),
    });
    const data = await r.json();
    // Attach HTTP status so caller can check it
    data.__status = r.status;
    return data;
  },
  async signOut(token) {
    await fetch(`${SB_URL}/auth/v1/logout`, {
      method: "POST",
      headers: sbHeaders(token),
    });
  },
  async getUser(token) {
    const r = await fetch(`${SB_URL}/auth/v1/user`, {
      headers: sbHeaders(token),
    });
    return r.json();
  },

  // ── Data ──
  async select(table, token, filter = "") {
    const r = await fetch(`${SB_URL}/rest/v1/${table}?select=*${filter}&order=created_at.asc`, {
      headers: { ...sbHeaders(token), "Prefer": "return=representation" },
    });
    return r.json();
  },
  async insert(table, token, data) {
    const r = await fetch(`${SB_URL}/rest/v1/${table}`, {
      method: "POST",
      headers: { ...sbHeaders(token), "Prefer": "return=representation" },
      body: JSON.stringify(data),
    });
    return r.json();
  },
  async update(table, token, id, data) {
    const r = await fetch(`${SB_URL}/rest/v1/${table}?id=eq.${id}`, {
      method: "PATCH",
      headers: { ...sbHeaders(token), "Prefer": "return=representation" },
      body: JSON.stringify(data),
    });
    return r.json();
  },
  async delete(table, token, id) {
    await fetch(`${SB_URL}/rest/v1/${table}?id=eq.${id}`, {
      method: "DELETE",
      headers: sbHeaders(token),
    });
  },

  // ── Storage ──
  async uploadPhoto(token, userId, base64DataUrl) {
    try {
      // Convert base64 data URL to binary
      const parts = base64DataUrl.split(",");
      const mime = parts[0].match(/:(.*?);/)[1]; // e.g. "image/jpeg"
      const ext = mime.split("/")[1].replace("jpeg","jpg");
      const binary = atob(parts[1]);
      const bytes = new Uint8Array(binary.length);
      for(let i=0; i<binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: mime });

      // Upload to Supabase Storage under user's folder
      const filename = `${userId}/${Date.now()}.${ext}`;
      const r = await fetch(`${SB_URL}/storage/v1/object/clothing-photos/${filename}`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "apikey": SB_KEY,
          "Content-Type": mime,
          "x-upsert": "true",
        },
        body: blob,
      });
      if(!r.ok) { console.error("Storage upload failed:", r.status); return null; }
      // Return public URL
      return `${SB_URL}/storage/v1/object/public/clothing-photos/${filename}`;
    } catch(e) { console.error("uploadPhoto error:", e); return null; }
  },

  // ── Session persistence (localStorage + sessionStorage for iOS PWA) ──
  saveSession(session) {
    try { localStorage.setItem("outfix_session", JSON.stringify(session)); } catch(e) {}
    try { sessionStorage.setItem("outfix_session", JSON.stringify(session)); } catch(e) {}
  },
  loadSession() {
    try {
      const ls = localStorage.getItem("outfix_session");
      if(ls) return JSON.parse(ls);
    } catch(e) {}
    try {
      const ss = sessionStorage.getItem("outfix_session");
      if(ss) return JSON.parse(ss);
    } catch(e) {}
    return null;
  },
  clearSession() {
    try { localStorage.removeItem("outfix_session"); } catch(e) {}
    try { sessionStorage.removeItem("outfix_session"); } catch(e) {}
  },
};

// ── AUTH SCREEN ───────────────────────────────────────────────────────────────
function AuthScreen({ onAuth }) {
  const [mode, setMode] = useState("signin"); // signin | signup
  const [step, setStep] = useState("auth"); // auth | username
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [username, setUsername] = useState("");
  const [usernameError, setUsernameError] = useState("");
  const [privacyCloset, setPrivacyCloset] = useState(true); // default public
  const [privacyOutfits, setPrivacyOutfits] = useState(true); // default public
  const [pendingSession, setPendingSession] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const inputStyle = {
    width:"100%", boxSizing:"border-box", background:"#141414",
    border:"1px solid #2A2A2A", borderRadius:12, padding:"13px 16px",
    color:"#F0EBE3", outline:"none", fontFamily:"'Montserrat',sans-serif", fontSize:12,
  };

  const submit = async () => {
    if (!email.trim() || !password.trim()) { setError("Please fill in all fields"); return; }
    if (mode === "signup" && !name.trim()) { setError("Please enter your name"); return; }
    if (mode === "signup" && !inviteCode.trim()) { setError("An invite code is required to join Outfix"); return; }
    setLoading(true); setError("");
    try {
      if (mode === "signup") {
        // Validate invite code first
        // DEVTEST is a permanent bypass code for internal testing
        const isDev = inviteCode.trim().toUpperCase() === "DEVTEST";
        const redeemRes = isDev ? { valid: true } : await fetch("/api/redeem-invite", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: inviteCode.trim().toUpperCase() }),
        }).then(r => r.json()).catch(() => ({ valid: true })); // fail open if API is down

        if (!redeemRes.valid) {
          setError(redeemRes.error || "Invalid or already used invite code");
          setLoading(false);
          return;
        }

        const res = await sb.signUp(email.trim(), password, name.trim());
        const err = res.error || res.error_description;
        if (err) { setError(typeof err === "string" ? err : err.message || "Sign up failed"); setLoading(false); return; }

        // Mark code as used with the new user's ID (skip for DEVTEST)
        const userId = res?.user?.id || res?.id;
        if (userId && !isDev) {
          fetch("/api/redeem-invite", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code: inviteCode.trim().toUpperCase(), markUsed: true, userId }),
          }).catch(() => {});
        }

        if (!res.access_token) {
          setLoading(false);
          alert("Account created! Please check your email and click the confirmation link before signing in.");
          setMode("signin");
          return;
        }
        sb.saveSession(res);
        setPendingSession(res);
        setStep("username");
        setLoading(false);
        return;
      } else {
        const res = await sb.signIn(email.trim(), password);
        const token = res?.access_token;
        const isRealToken = typeof token === "string" && token.startsWith("eyJ") && token.length > 100;
        if (!isRealToken) { setError("Incorrect email or password. Please try again."); setLoading(false); return; }
        try {
          const payload = JSON.parse(atob(token.split(".")[1]));
          if (!payload?.sub || payload.sub.length < 10) { setError("Authentication failed. Please try again."); setLoading(false); return; }
        } catch(e) { setError("Authentication failed. Please try again."); setLoading(false); return; }
        sb.saveSession(res);
        // Check if user has a username — if not, prompt them to set one
        try {
          const uid = res.user?.id;
          const profRes = await fetch(`${SB_URL}/rest/v1/profiles?id=eq.${uid}&select=username`, {
            headers: { "Authorization": `Bearer ${token}`, "apikey": SB_KEY }
          }).then(r => r.json()).catch(() => []);
          const hasUsername = Array.isArray(profRes) && profRes.length > 0 && profRes[0]?.username;
          if (!hasUsername) {
            setPendingSession(res);
            setStep("username");
            setLoading(false);
            return;
          }
        } catch(e) {}
        onAuth(res);
      }
    } catch(e) { setError("Connection error — please try again"); }
    setLoading(false);
  };

  const saveUsername = async () => {
    const u = username.trim();
    if (!u) { setUsernameError("Please choose a username"); return; }
    if (u.length < 3) { setUsernameError("Username must be at least 3 characters"); return; }
    if (!/^[a-zA-Z0-9_\.]+$/.test(u)) { setUsernameError("Only letters, numbers, _ and . allowed"); return; }
    setLoading(true); setUsernameError("");
    try {
      const userId = pendingSession?.user?.id;
      // Save profile with username
      await fetch(`${SB_URL}/rest/v1/profiles`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${pendingSession.access_token}`,
          "apikey": SB_KEY,
          "Prefer": "resolution=merge-duplicates,return=representation",
        },
        body: JSON.stringify({ id: userId, username: u, closet_public: privacyCloset, outfits_public: privacyOutfits }),
      });
      onAuth(pendingSession);
    } catch(e) {
      // Even if save fails, let them in — they can set username in settings
      onAuth(pendingSession);
    }
    setLoading(false);
  };

  // ── USERNAME STEP ────────────────────────────────────────────────────────
  if (step === "username") {
    return (
      <div style={{position:"fixed",inset:0,background:"#0D0D0D",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"32px 24px",maxWidth:430,margin:"0 auto",fontFamily:"'Cormorant Garamond','Georgia',serif",color:"#F0EBE3"}}>
        <div style={{textAlign:"center",marginBottom:36}}>
          <div style={{fontSize:44,marginBottom:12}}>✦</div>
          <div style={{fontSize:30,fontWeight:300,letterSpacing:4,color:"#C4A882",marginBottom:8}}>One last step</div>
          <div style={{fontFamily:"'Montserrat',sans-serif",fontSize:11,color:"#5A5048",letterSpacing:1}}>CHOOSE YOUR USERNAME</div>
        </div>

        <div style={{width:"100%",maxWidth:320}}>
          <div style={{fontFamily:"'Montserrat',sans-serif",fontSize:9,color:"#5A5048",letterSpacing:1.5,marginBottom:10}}>
            This is how other Outfix users will find and follow you.
          </div>

          {/* Username input with @ prefix */}
          <div style={{display:"flex",alignItems:"center",background:"#141414",border:`1px solid ${username.trim().length>=3?"#C4A88266":"#2A2A2A"}`,borderRadius:12,padding:"13px 16px",marginBottom:10,gap:6}}>
            <span style={{fontFamily:"'Montserrat',sans-serif",fontSize:14,color:"#C4A882",fontWeight:600}}>@</span>
            <input
              value={username}
              onChange={e=>{setUsername(e.target.value.replace(/\s/g,"").toLowerCase());setUsernameError("");}}
              onKeyDown={e=>e.key==="Enter"&&saveUsername()}
              placeholder="yourname"
              autoFocus
              style={{flex:1,background:"none",border:"none",outline:"none",color:"#F0EBE3",fontFamily:"'Montserrat',sans-serif",fontSize:14}}
            />
            {username.length>=3&&/^[a-zA-Z0-9_\.]+$/.test(username)&&(
              <span style={{color:"#80C880",fontSize:16}}>✓</span>
            )}
          </div>

          {/* Rules hint */}
          <div style={{fontFamily:"'Montserrat',sans-serif",fontSize:9,color:"#3A3028",marginBottom:usernameError?8:20,lineHeight:1.6}}>
            Letters, numbers, _ and . only · Min 3 characters
          </div>

          {usernameError&&(
            <div style={{background:"#1A0A0A",border:"1px solid #3A1A1A",borderRadius:12,padding:"9px 12px",fontFamily:"'Montserrat',sans-serif",fontSize:10,color:"#C08080",marginBottom:12}}>
              {usernameError}
            </div>
          )}

          {/* Privacy toggles */}
          <div style={{fontFamily:"'Montserrat',sans-serif",fontSize:9,color:"#5A5048",letterSpacing:1.5,marginBottom:10}}>VISIBILITY PREFERENCES</div>
          {[
            {label:"Closet", state:privacyCloset, set:setPrivacyCloset},
            {label:"Outfits", state:privacyOutfits, set:setPrivacyOutfits},
          ].map(({label,state,set})=>(
            <div key={label} style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10,padding:"10px 14px",background:"#141414",borderRadius:12,border:`1px solid ${state?"#C4A88244":"#2A2A2A"}`}}>
              <div>
                <div style={{fontFamily:"'Montserrat',sans-serif",fontSize:11,color:"#C0B8B0",fontWeight:500}}>{label}</div>
                <div style={{fontFamily:"'Montserrat',sans-serif",fontSize:9,color:"#4A4038",marginTop:2}}>{state?"Visible to followers":"Only visible to you"}</div>
              </div>
              <button onClick={()=>set(p=>!p)}
                style={{flexShrink:0,width:44,height:24,borderRadius:12,border:"none",cursor:"pointer",position:"relative",
                  background:state?"linear-gradient(135deg,#C4A882,#8A6E54)":"#2A2A2A",transition:"background 0.2s"}}>
                <div style={{position:"absolute",top:2,left:state?22:2,width:20,height:20,borderRadius:"50%",background:"#FFF",transition:"left 0.2s",boxShadow:"0 1px 3px #0006"}}/>
              </button>
            </div>
          ))}
          <div style={{fontFamily:"'Montserrat',sans-serif",fontSize:9,color:"#3A3028",marginBottom:20,lineHeight:1.6}}>
            You can change these anytime in Settings.
          </div>

          <button onClick={saveUsername} disabled={loading}
            style={{width:"100%",padding:"14px",borderRadius:12,background:loading?"#2A2A2A":"linear-gradient(135deg,#C4A882,#8A6E54)",border:"none",cursor:loading?"default":"pointer",fontFamily:"'Montserrat',sans-serif",fontSize:10,fontWeight:700,color:loading?"#5A5048":"#0D0D0D",letterSpacing:1.5,marginBottom:10}}>
            {loading?"SAVING…":"LET'S GO →"}
          </button>

          <button onClick={()=>onAuth(pendingSession)}
            style={{width:"100%",padding:"11px",borderRadius:12,background:"transparent",border:"none",cursor:"pointer",fontFamily:"'Montserrat',sans-serif",fontSize:9,color:"#3A3028",letterSpacing:1}}>
            SKIP FOR NOW
          </button>
        </div>
      </div>
    );
  }

  // ── AUTH STEP ────────────────────────────────────────────────────────────
  return (
    <div style={{
      position:"fixed", inset:0, background:"#0D0D0D",
      display:"flex", flexDirection:"column", alignItems:"center",
      justifyContent:"center", padding:"32px 24px", maxWidth:430, margin:"0 auto",
      fontFamily:"'Cormorant Garamond','Georgia',serif", color:"#F0EBE3",
    }}>
      {/* Logo */}
      <div style={{textAlign:"center", marginBottom:36}}>
        <div style={{fontSize:44, marginBottom:12}}>✦</div>
        <div style={{fontSize:36, fontWeight:300, letterSpacing:5, color:"#C4A882"}}>Outfix</div>
        <div style={{fontSize:10, fontWeight:400, letterSpacing:3, color:"#5A5048", marginTop:6, fontFamily:"'Montserrat',sans-serif"}}>YOUR WARDROBE. ELEVATED.</div>
      </div>

      {/* Toggle */}
      <div style={{display:"flex", background:"#1A1A1A", borderRadius:12, overflow:"hidden", border:"1px solid #2A2A2A", marginBottom:24, width:"100%", maxWidth:320}}>
        {[["signin","Sign In"],["signup","Create Account"]].map(([k,l])=>(
          <button key={k} onClick={()=>{setMode(k);setError("");}}
            style={{flex:1, padding:"10px", background:mode===k?"#C4A882":"transparent", border:"none",
              fontFamily:"'Montserrat',sans-serif", fontSize:10, fontWeight:mode===k?700:400,
              color:mode===k?"#0D0D0D":"#5A5048", letterSpacing:1, cursor:"pointer"}}>
            {l.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Fields */}
      <div style={{width:"100%", maxWidth:320, display:"flex", flexDirection:"column", gap:10}}>
        {mode==="signup" && (
          <input value={name} onChange={e=>setName(e.target.value)}
            placeholder="Your name" style={inputStyle}/>
        )}
        <input value={email} onChange={e=>setEmail(e.target.value)}
          placeholder="Email address" type="email"
          onKeyDown={e=>e.key==="Enter"&&submit()}
          style={inputStyle}/>
        <input value={password} onChange={e=>setPassword(e.target.value)}
          placeholder="Password" type="password"
          onKeyDown={e=>e.key==="Enter"&&submit()}
          style={inputStyle}/>
        {mode==="signup" && (
          <div>
            <input value={inviteCode} onChange={e=>setInviteCode(e.target.value.toUpperCase())}
              placeholder="Invite code" onKeyDown={e=>e.key==="Enter"&&submit()}
              style={{...inputStyle, letterSpacing:2, background:"#1A1410", border:"1px solid #3A2A1A"}}/>
            <div style={{fontFamily:"'Montserrat',sans-serif",fontSize:8,color:"#5A4030",marginTop:5,letterSpacing:0.5}}>
              Outfix is currently invite-only. You need a code to create an account.
            </div>
          </div>
        )}

        {error && (
          <div style={{background:"#1A0A0A", border:"1px solid #3A1A1A", borderRadius:12,
            padding:"9px 12px", fontFamily:"'Montserrat',sans-serif", fontSize:10, color:"#C08080"}}>
            {error}
          </div>
        )}

        <button onClick={submit} disabled={loading}
          style={{width:"100%", padding:"14px", borderRadius:12, marginTop:4,
            background:loading?"#2A2A2A":"linear-gradient(135deg,#C4A882,#8A6E54)",
            border:"none", cursor:loading?"default":"pointer",
            fontFamily:"'Montserrat',sans-serif", fontSize:10, fontWeight:700,
            color:loading?"#5A5048":"#0D0D0D", letterSpacing:1.5}}>
          {loading ? "PLEASE WAIT…" : mode==="signup" ? "CREATE ACCOUNT" : "SIGN IN"}
        </button>
      </div>

      <div style={{marginTop:20, fontFamily:"'Montserrat',sans-serif", fontSize:9,
        color:"#3A3028", textAlign:"center", lineHeight:1.6}}>
        By continuing you agree to Outfix's Terms of Service and Privacy Policy
      </div>
    </div>
  );
}


const _p    = "pointer";
const _1a   = "#1A1A1A";
const _2a   = "1px solid #2A2A2A";
const _row  = {display:"flex",alignItems:"center"};
const _col  = {display:"flex",flexDirection:"column"};
const _btwn = {display:"flex",justifyContent:"space-between",alignItems:"center"};
const _btwnS= {display:"flex",justifyContent:"space-between",alignItems:"flex-start"};
const _fix  = {position:"fixed",inset:0};
const _abs0 = {position:"absolute",inset:0};

// Trend feed data
const trendItems = [
  { id:"t1", trend:"Quiet Luxury", season:"Spring 2026", source:"Bottega Veneta FW26",
    palette:["#D4C4A8","#8A7860","#C0B090","#E8E0D0"], tags:["neutral","minimal","investment"],
    description:"Understated opulence — no logos, no noise. Impeccable tailoring and tactile fabrics speak for themselves.",
    closetMatch:["Your Silk Ivory Blouse aligns perfectly","Your Wide Leg Trousers are on trend","Add: a structured leather tote"],
    shoppable:[{name:"Intrecciato Clutch",brand:"Bottega Veneta",price:980,emoji:"👜",sourceImage:null},{name:"Cashmere Coat",brand:"The Row",price:2400,emoji:"🧥",sourceImage:null},{name:"Loafer",brand:"Gucci",price:890,emoji:"👠",sourceImage:null}],
  },
  { id:"t2", trend:"Ballet Soft", season:"Spring 2026", source:"Miu Miu SS26",
    palette:["#F0D8D8","#E0C0C0","#C8A0A0","#B08080"], tags:["feminine","soft","romantic"],
    description:"Satin ribbons, pale pinks, and delicate silhouettes. The balletcore era evolves into something more grown-up and wearable.",
    closetMatch:["Your Linen Midi Dress has the right silhouette","Your Slingback Heels work perfectly","Add: a pale satin slip"],
    shoppable:[{name:"Satin Wrap Skirt",brand:"Magda Butrym",price:420,emoji:"👗",sourceImage:null},{name:"Ballet Flat",brand:"Repetto",price:310,emoji:"👠",sourceImage:null},{name:"Bow Headband",brand:"Jennifer Behr",price:145,emoji:"🎀",sourceImage:null}],
  },
  { id:"t3", trend:"Industrial Edge", season:"Spring 2026", source:"Acne Studios FW26",
    palette:["#3A3A3A","#1A1A1A","#2A2A2A","#505050"], tags:["dark","utilitarian","structured"],
    description:"Raw hems, utility pockets, and oversized silhouettes cut in black and charcoal. Fashion's perennial love affair with workwear.",
    closetMatch:["Your Mini Leather Skirt is the anchor piece","Pair with a white tee and heavy boot","Missing: a cargo-style trousers"],
    shoppable:[{name:"Cargo Trousers",brand:"Acne Studios",price:480,emoji:"👖",sourceImage:null},{name:"Platform Derby",brand:"Dr. Martens",price:220,emoji:"👟",sourceImage:null},{name:"Distressed Denim",brand:"Maison Margiela",price:650,emoji:"👖",sourceImage:null}],
  },
  { id:"t4", trend:"Coastal Grandmother", season:"Summer 2026", source:"Loro Piana Cruise 26",
    palette:["#E8E0D4","#D4C8B8","#C4B8A4","#B0A090"], tags:["linen","relaxed","timeless"],
    description:"Effortless warm-weather dressing — linen in natural tones, loose trousers, wicker bags, and comfortable heels.",
    closetMatch:["Your Linen Midi Dress is the hero piece","Your Gold Hoops complete the look","Your Trench Coat layers perfectly in the evening"],
    shoppable:[{name:"Wide Linen Trousers",brand:"Loro Piana",price:890,emoji:"👖",sourceImage:null},{name:"Wicker Tote",brand:"Jacquemus",price:340,emoji:"👜",sourceImage:null},{name:"Espadrille",brand:"Castañer",price:165,emoji:"👡",sourceImage:null}],
  },
];

// Insurance / valuation data
// Resale value estimated as ~45% of purchase price (used inline where needed)

// Onboarding is controlled by first-run state in Root

// ── THEME ────────────────────────────────────────────────────────────────────
const G = "#C4A882"; const BK = "#0D0D0D"; const CD = "#141414";
const BR = "#1E1E1E"; const DM = "#5A5048"; const MD = "#8A7968";
const R14 = 14; // standard card radius
const R18 = 18; // pill / button radius

// ── RESALE VALUE ENGINE ───────────────────────────────────────────────────────
// Brand base rates (% of original retail price at resale)
const BRAND_RESALE_RATES = {
  // ── Ultra Luxury / Investment (80-120%) ──
  "hermès":1.20,"hermes":1.20,"birkin":1.20,"chanel":1.00,"rolex":1.10,
  "patek philippe":1.15,"cartier":0.95,"van cleef":1.00,"bottega veneta":0.85,
  "loro piana":0.85,"brunello cucinelli":0.80,"kiton":0.85,"brioni":0.80,
  // ── Premium Designer (55-75%) ──
  "louis vuitton":0.75,"gucci":0.68,"prada":0.70,"saint laurent":0.68,
  "ysl":0.68,"balenciaga":0.65,"givenchy":0.60,"valentino":0.62,
  "alexander mcqueen":0.60,"burberry":0.58,"fendi":0.65,"dior":0.72,
  "christian dior":0.72,"celine":0.68,"loewe":0.70,"miu miu":0.65,
  "the row":0.72,"rick owens":0.65,"comme des garçons":0.65,
  "comme des garcons":0.65,"maison margiela":0.62,"acne studios":0.55,
  "jacquemus":0.52,"ami":0.48,"isabel marant":0.48,"a.p.c.":0.50,"apc":0.50,
  "totême":0.50,"toteme":0.50,"theory":0.42,"max mara":0.55,"marni":0.55,
  "jil sander":0.58,"lemaire":0.60,"officine générale":0.48,
  "officine generale":0.48,"nanushka":0.45,"cos":0.30,
  // ── Luxury Sportswear / Streetwear (50-70%) ──
  "stone island":0.65,"cp company":0.60,"c.p. company":0.60,
  "moncler":0.70,"canada goose":0.55,"arc'teryx":0.60,"arcteryx":0.60,
  "palace":0.65,"supreme":0.70,"off-white":0.60,"fear of god":0.60,
  "essentials":0.55,"fog":0.55,"amiri":0.60,"rhude":0.50,"kith":0.55,
  "aime leon dore":0.60,"ald":0.60,"noah":0.50,"carhartt":0.45,
  "carhartt wip":0.50,"wtaps":0.65,"neighborhood":0.60,
  // ── Premium High Street / Contemporary (30-45%) ──
  "reiss":0.38,"sandro":0.38,"maje":0.35,"ba&sh":0.35,"ba and sh":0.35,
  "allsaints":0.32,"whistles":0.30,"rag & bone":0.42,"rag and bone":0.42,
  "frame":0.40,"paige":0.38,"ag":0.35,"7 for all mankind":0.32,
  "citizens of humanity":0.38,"mother denim":0.38,"ganni":0.40,
  "saks potts":0.42,"staud":0.38,"veronica beard":0.40,"club monaco":0.32,
  "banana republic":0.25,"j.crew":0.25,"j crew":0.25,"madewell":0.28,
  "brooks brothers":0.28,"tommy hilfiger":0.30,"ralph lauren":0.35,
  "polo ralph lauren":0.38,"lacoste":0.32,"hugo boss":0.30,"boss":0.30,
  "calvin klein":0.28,"ck":0.28,"michael kors":0.25,"kate spade":0.28,
  "coach":0.32,"tory burch":0.30,"ted baker":0.28,"reiss":0.38,
  "massimo dutti":0.30,"arket":0.30,"& other stories":0.28,
  "other stories":0.28,"aritzia":0.35,"wilfred":0.32,"oak + fort":0.28,
  "alo yoga":0.38,"alo":0.38,"vuori":0.38,"outdoor voices":0.32,
  "skims":0.35,"spanx":0.28,"free people":0.30,"anthropologie":0.28,
  // ── Sportswear (20-38%) ──
  "nike":0.32,"jordan":0.55,"air jordan":0.58,"adidas":0.30,
  "adidas originals":0.35,"yeezy":0.65,"new balance":0.35,
  "asics":0.28,"hoka":0.30,"on running":0.32,"on":0.30,
  "salomon":0.38,"merrell":0.25,"columbia":0.25,"north face":0.35,
  "the north face":0.35,"patagonia":0.40,"lululemon":0.40,
  "gymshark":0.28,"under armour":0.22,"puma":0.25,"reebok":0.25,
  "vans":0.28,"converse":0.28,"ugg":0.30,"hunter":0.28,
  // ── Mass Market / Fast Fashion (5-18%) ──
  "zara":0.14,"h&m":0.08,"hm":0.08,"mango":0.12,"topshop":0.12,
  "asos":0.10,"primark":0.05,"shein":0.04,"boohoo":0.05,"prettylittlething":0.05,
  "plt":0.05,"missguided":0.05,"forever 21":0.06,"forever21":0.06,
  "urban outfitters":0.18,"uniqlo":0.22,"gap":0.14,"old navy":0.10,
  "express":0.12,"forever new":0.10,"river island":0.12,"new look":0.08,
  "next":0.12,"marks & spencer":0.15,"m&s":0.15,
};

const CATEGORY_MULTIPLIERS = {
  "Bags":1.20,"Outerwear":1.15,"Shoes":1.10,"Dresses":1.05,
  "Tops":1.00,"Bottoms":1.00,"Knitwear":1.00,"Tailoring":1.05,
  "Suits":1.10,"Accessories":0.90,"Jewellery":1.10,"Jewelry":1.10,
  "Activewear":0.90,"Swimwear":0.70,"Underwear":0.40,"Basics":0.80,
};

const CONDITION_MULTIPLIERS = {
  "New":1.00,"New with tags":1.05,"Excellent":0.88,
  "Good":0.75,"Fair":0.52,"Poor":0.30,"Worn":0.60,
};

function getResaleRate(item){
  const brand = (item.brand||"").toLowerCase().trim();
  const baseRate = BRAND_RESALE_RATES[brand] ?? 0.30; // default unknown brand
  const catMult  = CATEGORY_MULTIPLIERS[item.category] ?? 1.00;
  const condMult = CONDITION_MULTIPLIERS[item.condition] ?? 0.75;

  // Age multiplier — depreciates ~12% per year, floors at 0.40, vintage 10yr+ gets bump
  let ageMult = 1.00;
  if(item.purchaseDate){
    try{
      const purchased = new Date(item.purchaseDate);
      const ageYears = (Date.now() - purchased.getTime()) / (1000*60*60*24*365);
      if(!isNaN(ageYears) && ageYears > 0){
        if(ageYears >= 10) ageMult = 1.10; // vintage bump
        else ageMult = Math.max(0.40, 1 - (ageYears * 0.12));
      }
    }catch(e){}
  }

  return Math.min(1.20, baseRate * catMult * condMult * ageMult);
}

function calcResale(item){
  return Math.round((item.price||0) * getResaleRate(item));
}

const GCSS = `
  @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;1,300;1,400&family=Montserrat:wght@300;400;500;600&display=swap');
  *{box-sizing:border-box;margin:0;padding:0;}
  ::-webkit-scrollbar{width:3px;} ::-webkit-scrollbar-track{background:transparent;} ::-webkit-scrollbar-thumb{background:#3A3028;border-radius:2px;}
  /* iOS: kill the long-press "Copy/Paste/Share" callout + text selection flash on all tappable elements */
  button,.tb,.ch,.pb,.sb,label,[role="button"]{
    -webkit-touch-callout:none;
    -webkit-user-select:none;
    user-select:none;
    -webkit-tap-highlight-color:transparent;
    touch-action:manipulation;
  }
  /* Prevent SVGs and spans inside buttons from acting as separate touch targets — touches land on the parent button */
  button *,.tb *,.pb *,.sb *{
    pointer-events:none;
  }
  /* But keep text inputs and textareas selectable */
  input,textarea,[contenteditable="true"]{
    -webkit-user-select:text;
    user-select:text;
    -webkit-touch-callout:default;
  }
  .tb{background:none;border:none;cursor:pointer;transition:all 0.2s;} .tb:active{transform:scale(0.94);}
  .ch{transition:transform 0.2s;cursor:pointer;}.ch:active{transform:scale(0.985);opacity:0.9;transition:transform 0.1s,opacity 0.1s;} .ch:hover{transform:translateY(-2px);}
  .pb{cursor:pointer;border:none;transition:all 0.2s;} .pb:active{transform:scale(0.96);}
  .sb{position:relative;overflow:hidden;cursor:pointer;border:none;}.sb:active{transform:scale(0.97);opacity:0.85;transition:transform 0.1s,opacity 0.1s;}
  .sb::after{content:'';position:absolute;top:-50%;left:-60%;width:40%;height:200%;background:rgba(255,255,255,0.12);transform:skewX(-20deg);transition:left 0.4s;}
  .sb:hover::after{left:130%;}
  @keyframes fadeUp{from{opacity:0;transform:translateY(16px);}to{opacity:1;transform:translateY(0);}}
  @keyframes fadeDown{from{opacity:0;transform:translateY(-16px);}to{opacity:1;transform:translateY(0);}}
  @keyframes toastSlide{from{opacity:0;transform:translateX(-50%) translateY(10px);}to{opacity:1;transform:translateX(-50%) translateY(0);}}
  @keyframes spin{to{transform:rotate(360deg);}}
  @keyframes pulse{0%,100%{opacity:1;}50%{opacity:0.4;}}
  @keyframes bounce{0%,100%{transform:translateY(0);}50%{transform:translateY(-5px);}}
  @keyframes shimmer{0%{background-position:-200% 0;}100%{background-position:200% 0;}}
  .fu{animation:fadeUp 0.32s ease forwards;}
  .sc{overflow-y:auto;overflow-x:hidden;}
  input,textarea{outline:none;font-family:inherit;}
`;

const sr = (sz,w=400,c="#F0EBE3",x={}) => ({fontFamily:"'Cormorant Garamond',serif",fontSize:sz,fontWeight:w,color:c,...x});
const ss = (sz,w=400,c="#F0EBE3",x={}) => ({fontFamily:"'Montserrat',sans-serif",fontSize:sz,fontWeight:w,color:c,...x});

function Lbl({children,mb=12}){return <div style={ss(9,400,DM,{letterSpacing:2,textTransform:"uppercase",marginBottom:mb})}>{children}</div>;}
function Tag({children}){return <span style={{background:"#1E1E1E",borderRadius:R18,padding:"5px 12px",...ss(9,400,MD,{letterSpacing:1})}}>{children}</span>;}

// ── SHARED AI LOADER ──────────────────────────────────────────────────────────
// Single loading pattern used everywhere AI is generating something.
// Gives every generative moment the same "✦ AI is styling…" signature feel.
//
// Usage:
//   <AILoader label="Styling your look" />              → large, centered, full moment
//   <AILoader label="Analyzing gaps" size="sm" />       → small inline version
//   <AILoader label="Finding matches" detail="…" />     → with secondary copy
//   <AILoader size="micro" />                           → just the pulsing ✦ mark, no text
function AILoader({label="AI is styling", detail=null, size="lg"}){
  // size: "micro" (12px, inline), "sm" (20px, compact), "lg" (32px, centered section)
  const sizes = {
    micro: {mark:12, labelSize:9, gap:0, pad:0},
    sm:    {mark:20, labelSize:10, gap:6, pad:"20px 0"},
    lg:    {mark:32, labelSize:11, gap:10, pad:"40px 0"},
  };
  const s = sizes[size] || sizes.lg;

  // Micro: just the spinning mark, no text — for inline use (chips, pills, icons)
  if(size === "micro"){
    return <span style={{fontSize:s.mark,animation:"spin 1.2s linear infinite",display:"inline-block",color:G,lineHeight:1}}>✦</span>;
  }

  const displayLabel = label
    ? (label.toUpperCase().endsWith("…") ? label.toUpperCase() : `${label.toUpperCase()}…`)
    : null;

  return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:s.pad,gap:s.gap,textAlign:"center"}}>
      <div style={{fontSize:s.mark,animation:"spin 1.2s linear infinite",display:"inline-block",color:G,lineHeight:1}}>✦</div>
      {displayLabel && <div style={ss(s.labelSize,500,G,{letterSpacing:1.5})}>{displayLabel}</div>}
      {detail && <div style={ss(9,400,DM,{letterSpacing:0.5,marginTop:-2})}>{detail}</div>}
    </div>
  );
}


function Btn({children,onClick,full,outline,small,disabled}){
  const p = small?"7px 14px":"12px 20px";
  return(
    <button type="button" className="sb" onClick={onClick} disabled={disabled} style={{
      width:full?"100%":"auto", padding:p, borderRadius:R14,
      background:outline?"#1E1E1E":`linear-gradient(135deg,${G},#8A6E54)`,
      border:outline?"1px solid #2A2A2A":"none",
      ...ss(9,600,outline?MD:BK,{letterSpacing:1.5}), cursor:_p,
      opacity:disabled?0.5:1,
    }}>{children}</button>
  );
}

function IconBtn({onClick,children,sz=16}){return <button onClick={onClick} style={{width:34,height:34,borderRadius:"50%",background:_1a,border:_2a,display:"flex",alignItems:"center",justifyContent:"center",cursor:_p,...ss(sz,300,MD)}}>{children}</button>;}
function Toast({msg}){
  if(!msg) return null;
  return(
    <div style={{position:"fixed",bottom:82,left:"50%",transform:"translateX(-50%)",
      background:G,color:BK,padding:"12px 22px",borderRadius:30,
      ...ss(11,600,BK,{letterSpacing:1}),zIndex:200,
      animation:"toastSlide 0.3s ease forwards",whiteSpace:"nowrap"}}>
      {msg}
    </div>
  );
}


// ── CLOTHING ILLUSTRATION LIBRARY ────────────────────────────────────────────

// ── USER AVATAR PORTRAITS ─────────────────────────────────────────────────────
const AVATAR_DEFS={
  "@jess.styles":   {skin:"#C8956C",hair:"#2A1A0A",hairStyle:"wavy",  top:"#8B6B4A",},
  "@minimal.edit":  {skin:"#F2C9A0",hair:"#1A1A1A",hairStyle:"straight",top:"#222",},
  "@the.closet.co": {skin:"#8B5E3C",hair:"#3D2B1F",hairStyle:"curly", top:"#5A7040",},
  "@curated.claire":{skin:"#FDDBB4",hair:"#8B4513",hairStyle:"bun",   top:"#3A5070",},
};
function AvatarPortrait({user,size=40}){
  const d=AVATAR_DEFS[user]||{skin:"#B8957A",hair:"#3A2A1A",hairStyle:"straight",top:"#4A4038"};
  const r=size/2;
  const hp={
    wavy: `M${r*.25},${r*.72} Q${r*.1},${r*.3} ${r*.4},${r*.18} Q${r*.65},${r*.05} ${r},${r*.1} Q${r*1.35},${r*.05} ${r*1.6},${r*.18} Q${r*1.9},${r*.3} ${r*1.75},${r*.72}`,
    straight:`M${r*.22},${r*.8} L${r*.22},${r*.2} Q${r},0 ${r*1.78},${r*.2} L${r*1.78},${r*.8}`,
    curly:`M${r*.2},${r*.75} Q${r*.05},${r*.25} ${r*.38},${r*.12} Q${r*.58},0 ${r},${r*.08} Q${r*1.42},0 ${r*1.62},${r*.12} Q${r*1.95},${r*.25} ${r*1.8},${r*.75}`,
    bun:`M${r*.28},${r*.7} Q${r*.15},${r*.32} ${r*.45},${r*.18} Q${r*.65},${r*.06} ${r},${r*.08} Q${r*1.35},${r*.06} ${r*1.55},${r*.18} Q${r*1.85},${r*.32} ${r*1.72},${r*.7} M${r},${r*.08} Q${r*.8},-.15 ${r*1.0},-.1 Q${r*1.2},-.15 ${r},${r*.08}`,
  };
  const clipId=`avc-${user.replace(/[^a-z0-9]/g,"")}-${size}`;
  return(
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{borderRadius:"50%",display:"block",flexShrink:0}}>
      <defs><clipPath id={clipId}><circle cx={r} cy={r} r={r}/></clipPath></defs>
      <g clipPath={`url(#${clipId})`}>
        <rect width={size} height={size} fill="#1A1A1A"/>
        <ellipse cx={r} cy={size*1.08} rx={r*.9} ry={r*.6} fill={d.top}/>
        <rect x={r*.8} y={r*1.15} width={r*.4} height={r*.45} fill={d.skin}/>
        <ellipse cx={r} cy={r*.88} rx={r*.42} ry={r*.5} fill={d.skin}/>
        <path d={hp[d.hairStyle]||hp.straight} fill={d.hair}/>
        <ellipse cx={r*.84} cy={r*.82} rx={r*.06} ry={r*.055} fill="#1A0E08"/>
        <ellipse cx={r*1.16} cy={r*.82} rx={r*.06} ry={r*.055} fill="#1A0E08"/>
        <path d={`M${r*.88},${r*.98} Q${r},${r*1.07} ${r*1.12},${r*.98}`} stroke="#9A6050" strokeWidth={r*.04} fill="none" strokeLinecap="round"/>
      </g>
    </svg>
  );
}

// Each item gets a bespoke SVG illustration. ItemIllustration renders at any size.

// Emoji fallback map by category — replaces 370 lines of SVG illustration data
const FASHION_BRANDS = [
  // Luxury
  "Acne Studios","Alexander McQueen","Alexander Wang","Alaïa","Balenciaga","Bottega Veneta",
  "Burberry","Celine","Chanel","Christian Louboutin","Dior","Fendi","Givenchy","Gucci",
  "Hermès","Isabel Marant","Jacquemus","Jil Sander","Loewe","Louis Vuitton","Maison Margiela",
  "Miu Miu","Mulberry","Off-White","Prada","Saint Laurent","Stella McCartney","The Row",
  "Tom Ford","Valentino","Versace","Vivienne Westwood","Zimmermann",
  // Contemporary
  "A.P.C.","& Other Stories","Aritzia","Arket","Banana Republic","By Malene Birger",
  "COS","Club Monaco","Closed","Cos","Equipment","Frame","Free People","Ganni",
  "J.Crew","Karen Millen","Khaite","Lacoste","Lemaire","Maje","Massimo Dutti",
  "Max Mara","Me+Em","Nanushka","Rag & Bone","Ralph Lauren","Reiss","Reformation",
  "Rouje","Scanlan Theodore","Sandro","Sezane","Sézane","Smythe","Theory",
  "Tiger of Sweden","Toteme","Vince","Whistles","ba&sh",
  // Accessible / High Street
  "ASOS","Abercrombie & Fitch","AllSaints","Anthropologie","Boden","Gap","H&M",
  "Hollister","Hugo Boss","J.Crew","Jigsaw","Lululemon","Mango","Marks & Spencer",
  "Massimo Dutti","Madewell","Monki","Next","Primark","Pull & Bear","River Island",
  "Topshop","Uniqlo","Urban Outfitters","Warehouse","Weekday","White Stuff","Zara",
  // Sportswear
  "Adidas","Arc'teryx","Asics","Columbia","Gymshark","Hoka","Lululemon","New Balance",
  "Nike","North Face","On Running","Patagonia","Puma","Reebok","Salomon","Under Armour",
  // Shoes
  "Birkenstock","Common Projects","Converse","Dr. Martens","Gianvito Rossi","Jimmy Choo",
  "Kurt Geiger","Manolo Blahnik","Miu Miu","Sam Edelman","Steve Madden","Stuart Weitzman",
  "Superga","Tod's","UGG","Vans","Vagabond","Vivaia",
  // Jewellery / Accessories
  "Ana Luisa","Catbird","Completedworks","Jennifer Fisher","Mejuri","Monica Vinader",
  "Missoma","Pandora","Sophie Buhai","Tiffany & Co.",
].sort();

const CATEGORY_EMOJI = {
  "Tops":"👚","Bottoms":"👖","Dresses":"👗","Outerwear":"🧥",
  "Shoes":"👟","Accessories":"✨","default":"👗"
};

// Gold/dark silhouette icons for category chips and placeholders — matches nav bar stroke style
function CatSVG({cat, size=14, color="#C4A882"}){
  const c=color;
  const sw=size<=16?"1.5":"1.4";
  const icons={
    Tops:(
      <svg width={size} height={size} viewBox="-1 -2 22 16" fill="none">
        <path d="M10 1 C10 1 10 0 11.5 0 C13 0 13 1.5 13 1.5 C13 2.5 12 3 10 4" stroke={c} strokeWidth={sw} strokeLinecap="round"/>
        <path d="M10 4 C7 5.5 2 8 1 9 C0.5 9.5 1 10 1.5 10 L18.5 10 C19 10 19.5 9.5 19 9 C18 8 13 5.5 10 4Z" stroke={c} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
    Bottoms:(
      <svg width={size} height={size} viewBox="0 0 20 22" fill="none">
        <path d="M3 2H17L15 20H11.5L10 11L8.5 20H5L3 2Z" stroke={c} strokeWidth={sw} strokeLinejoin="round"/>
        <line x1="3" y1="5.5" x2="17" y2="5.5" stroke={c} strokeWidth="1.2" strokeLinecap="round" opacity="0.45"/>
      </svg>
    ),
    Dresses:(
      <svg width={size} height={size} viewBox="0 0 20 22" fill="none">
        <path d="M7 2C7 2 7.5 1 10 1C12.5 1 13 2 13 2L16.5 8H12.5L14 21H6L7.5 8H3.5L7 2Z" stroke={c} strokeWidth={sw} strokeLinejoin="round"/>
      </svg>
    ),
    Outerwear:(
      <svg width={size} height={size} viewBox="0 0 20 22" fill="none">
        <path d="M7.5 2C7.5 2 8 1 10 1C12 1 12.5 2 12.5 2L15 6L12 7.5V21H8V7.5L5 6L7.5 2Z" stroke={c} strokeWidth={sw} strokeLinejoin="round"/>
        <path d="M7.5 2L5.5 3L2 8L6 8" stroke={c} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M12.5 2L14.5 3L18 8L14 8" stroke={c} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
    Shoes:(
      <svg width={size} height={size} viewBox="0 0 22 16" fill="none">
        <path d="M2 12C2 12 4 8 8 7L11.5 6.5L16 7.5C18.5 8.2 20 10 20 12V13C20 14 19 14.5 18 14.5L3 14.5C2 14.5 2 14 2 13V12Z" stroke={c} strokeWidth={sw} strokeLinejoin="round"/>
        <path d="M8 7L8.5 4.5L11 4.5L11.5 6.5" stroke={c} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
        <line x1="4" y1="11.5" x2="9" y2="11.5" stroke={c} strokeWidth="1.1" strokeLinecap="round" opacity="0.55"/>
      </svg>
    ),
    Accessories:(
      <svg width={size} height={size} viewBox="0 0 20 20" fill="none">
        <path d="M10 1L11.8 8.2L19 10L11.8 11.8L10 19L8.2 11.8L1 10L8.2 8.2L10 1Z" stroke={c} strokeWidth={sw} strokeLinejoin="round"/>
      </svg>
    ),
  };
  return icons[cat]||icons.Tops;
}

function ItemIllustration({item, size=60, style={}}){
  const emoji = item?.emoji || CATEGORY_EMOJI[item?.category] || CATEGORY_EMOJI.default;
  return(
    <div style={{
      width:size, height:size, display:"flex", alignItems:"center",
      justifyContent:"center", fontSize:Math.round(size*0.52),
      flexShrink:0, ...style
    }}>
      {emoji}
    </div>
  );
}
function hexToColorName(hex){
  const h=hex.replace("#","").toLowerCase();
  const r=parseInt(h.slice(0,2),16),g=parseInt(h.slice(2,4),16),b=parseInt(h.slice(4,6),16);
  const max=Math.max(r,g,b),min=Math.min(r,g,b),l=(max+min)/2;
  if(max-min<18){
    if(l<30) return "Black";
    if(l<80) return "Charcoal";
    if(l<140) return "Dark Grey";
    if(l<190) return "Grey";
    if(l<220) return "Light Grey";
    return "White";
  }
  const s=(max-min)/(l<128?max+min:510-max-min);
  let h2=0;
  if(max===r) h2=((g-b)/(max-min))%6;
  else if(max===g) h2=(b-r)/(max-min)+2;
  else h2=(r-g)/(max-min)+4;
  h2=Math.round(h2*60+360)%360;
  if(l<50) return h2<30||h2>=330?"Dark Red":h2<90?"Dark Olive":h2<150?"Dark Green":h2<210?"Dark Teal":h2<270?"Dark Blue":h2<330?"Dark Purple":"Dark Red";
  if(s<0.25) return l<100?"Dark Taupe":l<160?"Taupe":"Cream";
  if(h2<15||h2>=345) return l>170?"Pink":"Red";
  if(h2<30) return l>160?"Peach":"Rust";
  if(h2<45) return "Orange";
  if(h2<70) return l>180?"Yellow":"Gold";
  if(h2<90) return l>180?"Lime":"Olive";
  if(h2<150) return l>160?"Mint":"Green";
  if(h2<165) return "Teal";
  if(h2<195) return "Cyan";
  if(h2<240) return l>160?"Sky Blue":"Blue";
  if(h2<260) return "Navy";
  if(h2<280) return "Indigo";
  if(h2<300) return "Purple";
  if(h2<330) return l>170?"Mauve":"Plum";
  return "Pink";
}


function ItemThumb({item,size=44,r=10,border}){
  const b=border||`1px solid #2A2A2A`;
  return(
    <div style={{width:size,height:size,borderRadius:r,background:`linear-gradient(135deg,${item.color||"#2A2A2A"}22,${item.color||"#2A2A2A"}44)`,overflow:"hidden",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",border:b}}>
      {item.sourceImage?<img src={item.sourceImage} style={{width:"100%",height:"100%",objectFit:"cover"}} alt={item.name}/>:<ItemIllustration item={item} size={Math.round(size*0.8)}/>}
    </div>
  );
}

// Samples the corner pixel of an image to extract background color
function useImageBg(src, fallback="#1A1A1A"){
  const [bg,setBg]=useState(fallback);
  useEffect(()=>{
    if(!src) return;
    const img=new Image();
    img.crossOrigin="anonymous";
    img.onload=()=>{
      try{
        const canvas=document.createElement("canvas");
        canvas.width=img.naturalWidth; canvas.height=img.naturalHeight;
        const ctx=canvas.getContext("2d");
        ctx.drawImage(img,0,0);
        const size=img.naturalWidth;
        const h=img.naturalHeight;
        const samples=[
          ctx.getImageData(4,4,1,1).data,
          ctx.getImageData(size-5,4,1,1).data,
          ctx.getImageData(4,h-5,1,1).data,
          ctx.getImageData(size-5,h-5,1,1).data,
        ];
        const r=Math.round(samples.reduce((s,d)=>s+d[0],0)/4);
        const g=Math.round(samples.reduce((s,d)=>s+d[1],0)/4);
        const b=Math.round(samples.reduce((s,d)=>s+d[2],0)/4);
        const avgAlpha=Math.round(samples.reduce((s,d)=>s+d[3],0)/4);
        // Transparent corners = bg was removed — use warm parchment instead of black
        const hex=avgAlpha<30?"#F5F0EB":`#${r.toString(16).padStart(2,"0")}${g.toString(16).padStart(2,"0")}${b.toString(16).padStart(2,"0")}`;
        setBg(hex);
      }catch(e){ /* CORS tainted — use fallback */ }
    };
    img.onerror=()=>{}; // silently use fallback
    // Add cache-busting only for non-data URLs to help with CORS
    img.src=src.startsWith("data:") ? src : src+(src.includes("?")?"&":"?")+"_cb=1";
  },[src]);
  return bg;
}

// Closet grid card with auto-detected background color
function ClosetItemCard({item,isFav,onSelect,onToggleFav,selected}){
  const allImages = item.sourceImages?.length ? item.sourceImages : (item.sourceImage ? [item.sourceImage] : []);
  const hasMulti = allImages.length > 1;
  const [imgIdx, setImgIdx] = useState(0);
  const touchStart = useRef(null);
  const bg = useImageBg(allImages[imgIdx]||item.sourceImage, item.color||"#1A1A1A");

  const onTouchStartImg = e => { touchStart.current = e.touches[0].clientX; };
  const onTouchEndImg = e => {
    if(touchStart.current===null) return;
    const dx = e.changedTouches[0].clientX - touchStart.current;
    touchStart.current = null;
    if(Math.abs(dx) < 30) return;
    if(dx < 0) setImgIdx(i=>Math.min(i+1, allImages.length-1));
    else setImgIdx(i=>Math.max(i-1, 0));
  };

  return(
    <div className="ch" onClick={onSelect} style={{background:selected?"#1A1610":CD,borderRadius:R14,overflow:"hidden",border:selected?`1.5px solid ${G}66`:`1px solid ${BR}`,position:"relative"}}>
      <div
        onTouchStart={hasMulti?onTouchStartImg:undefined}
        onTouchEnd={hasMulti?onTouchEndImg:undefined}
        style={{height:180,background:allImages[imgIdx]?bg:`linear-gradient(135deg,${item.color}22,${item.color}55)`,display:"flex",alignItems:"center",justifyContent:"center",position:"relative",overflow:"hidden",transition:"background 0.4s ease"}}>
        {allImages[imgIdx]
          ? <img src={allImages[imgIdx]} style={{width:"100%",height:"100%",objectFit:"contain",padding:"8px",boxSizing:"border-box"}} alt={item.name}/>
          : <ItemIllustration item={item} size={120}/>
        }
        {item.forSale && <div style={{position:"absolute",top:8,left:8,background:G,color:BK,...ss(8,700,BK,{letterSpacing:1,padding:"3px 7px",borderRadius:12})}}>FOR SALE</div>}
        <button onClick={e=>{e.stopPropagation();onToggleFav();}} style={{position:"absolute",top:8,right:8,width:28,height:28,borderRadius:"50%",background:"#0D0D0D88",border:"none",display:"flex",alignItems:"center",justifyContent:"center",cursor:_p,fontSize:13,backdropFilter:"blur(4px)"}}>
          <span style={{color:isFav?G:"#4A4038",transition:"color 0.15s"}}>{isFav?"♥":"♡"}</span>
        </button>
        {hasMulti&&(
          <div style={{position:"absolute",bottom:7,left:0,right:0,display:"flex",justifyContent:"center",gap:4}}>
            {allImages.map((_,i)=>(
              <div key={i} onClick={e=>{e.stopPropagation();setImgIdx(i);}} style={{width:5,height:5,borderRadius:"50%",background:i===imgIdx?"#1A1A1A":G,cursor:_p,transition:"background 0.2s"}}/>
            ))}
          </div>
        )}
      </div>
      <div style={{padding:"9px 11px 11px"}}>
        <div style={sr(13,500,"#E8E0D4",{lineHeight:1.2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"})}>{item.name}</div>
        <div style={ss(10,400,DM,{marginTop:2,letterSpacing:0.3})}>{item.brand}</div>
      </div>
    </div>
  );
}

// ── HOME ─────────────────────────────────────────────────────────────────────
// ── STORY VIEWER ─────────────────────────────────────────────────────────────
function HomeTab({items,outfits,showToast,setTab,setWishlist,addToWishlist,removeFromWishlist,setItems,session,onAddToCloset,viewProfile,setViewProfile,userProfile,onMessage,styleProfile,styleNudgeDismissed,onDismissStyleNudge,onOpenStyleQuiz}){
  const [liked,setLiked]         = useState({});

  // ── "We styled something for you" first look card ──
  const [firstLook,setFirstLook]           = useState(null);   // {items:[],vibe,missing:[]}
  const [firstLookLoading,setFirstLookLoading] = useState(false);
  const [firstLookDismissed,setFirstLookDismissed] = useState(()=>{
    try{ return localStorage.getItem("outfix_firstlook_dismissed")==="1"; }catch(e){ return false; }
  });
  const dismissFirstLook = () => {
    setFirstLookDismissed(true);
    try{ localStorage.setItem("outfix_firstlook_dismissed","1"); }catch(e){}
  };
  const showFirstLook = !firstLookDismissed && styleProfile?.quizCompleted && items.length >= 1;

  useEffect(()=>{
    if(!showFirstLook || firstLook || firstLookLoading) return;
    const run = async () => {
      setFirstLookLoading(true);
      try {
        const profileParts = [];
        if(styleProfile?.aesthetic?.length) profileParts.push(`Aesthetic: ${styleProfile.aesthetic.join(", ")}`);
        if(styleProfile?.fitPref?.length) profileParts.push(`Fit: ${styleProfile.fitPref.join(", ")}`);
        if(styleProfile?.colorPalette) profileParts.push(`Palette: ${styleProfile.colorPalette}`);
        if(styleProfile?.avoidPairings?.length) profileParts.push(`Avoid: ${styleProfile.avoidPairings.join(", ")}`);
        if(styleProfile?.learnedDislikes?.length) profileParts.push(`Dislikes: ${styleProfile.learnedDislikes.join(", ")}`);
        const profileCtx = profileParts.length ? `\nStyle profile:\n${profileParts.join("\n")}` : "";
        const itemList = items.map(i=>`${i.name} (${i.category})`).join(", ");
        const prompt = `You are a personal stylist. A user just set up their Outfix wardrobe app.${profileCtx}\n\nTheir closet: ${itemList}\n\nCreate one complete outfit look using ONLY items from their closet. If their closet is sparse, suggest 1-2 missing pieces that would complete the look. Return ONLY JSON:\n{"outfit":["exact item name","exact item name"],"vibe":"2-3 word style description","missing":["item suggestion if needed"],"note":"one warm sentence about this look"}`;
        const raw = await callClaude(prompt);
        const json = JSON.parse(raw.replace(/```json|```/g,"").trim());
        setFirstLook(json);
      } catch(e) { setFirstLookDismissed(true); }
      setFirstLookLoading(false);
    };
    run();
  },[showFirstLook]);
  const [commentOpen,setCommentOpen]   = useState(null); // event.id
  const [comments,setComments]         = useState({});   // {eventId: [{id,user_id,username,body,created_at}]}
  const [commentLoading,setCommentLoading] = useState({});

  // ── Discover People modal ──
  const [showDiscover,setShowDiscover]           = useState(false);
  const [discoverUsers,setDiscoverUsers]         = useState([]);
  const [discoverLoading,setDiscoverLoading]     = useState(false);
  const [discoverFollowing,setDiscoverFollowing] = useState(new Set()); // IDs current user follows

  const loadDiscoverUsers = async () => {
    if(!session?.access_token) return;
    setDiscoverLoading(true);
    try {
      const myId = session.user?.id;
      const h = {...sbHeaders(session.access_token)};
      // Get a broad sample of follows to count popularity
      const [allFollows, myFollows] = await Promise.all([
        fetch(`${SB_URL}/rest/v1/follows?select=following_id&limit=500`,{headers:h}).then(r=>r.json()).catch(()=>[]),
        fetch(`${SB_URL}/rest/v1/follows?follower_id=eq.${myId}&select=following_id`,{headers:h}).then(r=>r.json()).catch(()=>[]),
      ]);
      // Count followers per user
      const counts = {};
      if(Array.isArray(allFollows)) allFollows.forEach(f=>{ if(f.following_id && f.following_id!==myId) counts[f.following_id]=(counts[f.following_id]||0)+1; });
      const myFollowingSet = new Set(Array.isArray(myFollows)?myFollows.map(f=>f.following_id):[]);
      setDiscoverFollowing(myFollowingSet);
      // Top 10 by follower count (exclude self)
      const topIds = Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([id])=>id);
      if(!topIds.length){ setDiscoverUsers([]); setDiscoverLoading(false); return; }
      const profiles = await fetch(`${SB_URL}/rest/v1/profiles?id=in.(${topIds.join(",")})&select=id,username,bio,avatar_url,style_identity`,{headers:h}).then(r=>r.json()).catch(()=>[]);
      if(!Array.isArray(profiles)){ setDiscoverUsers([]); setDiscoverLoading(false); return; }
      // Attach follower count and sort
      const enriched = profiles.map(p=>({...p, followerCount: counts[p.id]||0})).sort((a,b)=>b.followerCount-a.followerCount);
      setDiscoverUsers(enriched);
    } catch(e){ setDiscoverUsers([]); }
    setDiscoverLoading(false);
  };

  const discoverFollow = async (userId) => {
    if(!session?.access_token) return;
    const myId = session.user?.id;
    const h = {...sbHeaders(session.access_token),"Content-Type":"application/json"};
    const alreadyFollowing = discoverFollowing.has(userId);
    // Optimistic update
    setDiscoverFollowing(prev=>{ const s=new Set(prev); alreadyFollowing?s.delete(userId):s.add(userId); return s; });
    setDiscoverUsers(prev=>prev.map(u=>u.id===userId?{...u,followerCount:u.followerCount+(alreadyFollowing?-1:1)}:u));
    try {
      if(alreadyFollowing){
        await fetch(`${SB_URL}/rest/v1/follows?follower_id=eq.${myId}&following_id=eq.${userId}`,{method:"DELETE",headers:h});
        showToast("Unfollowed ✦");
      } else {
        await fetch(`${SB_URL}/rest/v1/follows`,{method:"POST",headers:h,body:JSON.stringify({follower_id:myId,following_id:userId})});
        showToast("Following ✦");
      }
    } catch(e){
      // Rollback
      setDiscoverFollowing(prev=>{ const s=new Set(prev); alreadyFollowing?s.add(userId):s.delete(userId); return s; });
      setDiscoverUsers(prev=>prev.map(u=>u.id===userId?{...u,followerCount:u.followerCount+(alreadyFollowing?1:-1)}:u));
    }
  };

  const loadComments = async (eventId) => {
    if(!session?.access_token) return;
    setCommentLoading(p=>({...p,[eventId]:true}));
    try {
      const res = await fetch(`${SB_URL}/rest/v1/feed_comments?event_id=eq.${eventId}&order=created_at.asc&select=*`, {
        headers:{...sbHeaders(session.access_token)}
      });
      const data = await res.json();
      if(Array.isArray(data)){
        // Merge: keep any still-pending temp comments, dedupe real ones by id, and drop any temp
        // that matches a real row by (user + body + <5min timestamp) — that's our arrival signal
        setComments(p=>{
          const existing = p[eventId] || [];
          const pending = existing.filter(c=>String(c.id).startsWith("temp_")&&c._pending);
          // Remove pending that now have a real match in the fetched results
          const dbSet = new Set(data.map(d=>`${d.user_id}|${d.body}`));
          const stillPending = pending.filter(t=>!dbSet.has(`${t.user_id}|${t.body}`));
          // Dedupe fetched by id
          const seen = new Set();
          const uniqueReal = data.filter(c=>{
            if(seen.has(c.id)) return false;
            seen.add(c.id);
            return true;
          });
          return {...p,[eventId]:[...uniqueReal,...stillPending]};
        });
      }
    } catch(e){}
    setCommentLoading(p=>({...p,[eventId]:false}));
  };

  const postComment = async (eventId, text) => {
    if(!text?.trim()||!session?.access_token) return;
    const uid = session.user?.id;
    const body = text.trim();
    const uname = userProfile?.username || session.user?.email?.split("@")[0] || "user";
    const tempId = `temp_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;
    const tempComment = {id:tempId,event_id:eventId,user_id:uid,username:uname,body,created_at:new Date().toISOString(),_pending:true};

    // Guard: if the exact same body is already pending from this user on this event, skip
    // (prevents double-taps from creating twin rows)
    let shouldSkip = false;
    setComments(p=>{
      const list = p[eventId] || [];
      const dupPending = list.find(c=>c._pending && c.user_id===uid && c.body===body);
      if(dupPending){ shouldSkip = true; return p; }
      return {...p,[eventId]:[...list, tempComment]};
    });
    if(shouldSkip) return;

    try {
      const res = await fetch(`${SB_URL}/rest/v1/feed_comments`,{
        method:"POST",
        headers:{...sbHeaders(session.access_token),"Prefer":"return=representation"},
        body:JSON.stringify({event_id:eventId,user_id:uid,username:uname,body}),
      });
      if(!res.ok){
        const errText = await res.text();
        throw new Error(`Supabase error ${res.status}: ${errText}`);
      }
      const responseData = await res.json();
      const saved = Array.isArray(responseData) ? responseData[0] : responseData;

      // Replace temp comment with real one. If we can't find the real row, drop the temp entirely
      // rather than leave a _pending:false orphan that'll duplicate against a later loadComments.
      setComments(p=>{
        const list = p[eventId] || [];
        if(saved && saved.id){
          // Filter out the temp AND any existing copy of the real row (dedup safety)
          const filtered = list.filter(c=>c.id!==tempId && c.id!==saved.id);
          return {...p,[eventId]:[...filtered, saved]};
        }
        // No real row returned — drop the temp; next loadComments poll will pick it up
        return {...p,[eventId]:list.filter(c=>c.id!==tempId)};
      });
    } catch(e){
      // Roll back optimistic update and tell user
      setComments(p=>({...p,[eventId]:(p[eventId]||[]).filter(c=>c.id!==tempId)}));
      showToast("Comment didn't send — check your connection and try again");
    }
  };
  const [feedMenuOpen,setFeedMenuOpen] = useState(null);
  const [selectedFeedItem,setSelectedFeedItem] = useState(null);
  const feedPopupRef = useRef(null);
  useEffect(()=>{
    if(selectedFeedItem && feedPopupRef.current) feedPopupRef.current.scrollTop = 0;
  },[selectedFeedItem]);
  const [showSearch,setShowSearch] = useState(false);
  const [searchQuery,setSearchQuery] = useState("");
  const [userResults,setUserResults] = useState([]);
  const [searchLoading,setSearchLoading] = useState(false);
  const [selectedTrend,setSelectedTrend]=useState(null);
  const [suggestedAccounts,setSuggestedAccounts] = useState([]);
  const [suggestedLoading,setSuggestedLoading] = useState(false);
  const [liveEvents,setLiveEvents] = useState([]);
  const [feedLoading,setFeedLoading] = useState(false);
  const [feedError,setFeedError] = useState(false);
  const [refreshing,setRefreshing] = useState(false);
  const [pullProgress,setPullProgress] = useState(0);
  const [feedHasMore,setFeedHasMore] = useState(false);
  const [feedOffset,setFeedOffset] = useState(0);

  // Morning outfit card — show before noon if not dismissed today
  const todayKey = new Date().toISOString().slice(0,10);
  const [morningCardDismissed, setMorningCardDismissed] = useState(()=>{
    try{ return localStorage.getItem("outfix_morning_card")===todayKey; }catch(e){ return false; }
  });
  const dismissMorningCard = () => {
    setMorningCardDismissed(true);
    try{ localStorage.setItem("outfix_morning_card", todayKey); }catch(e){}
  };
  const showMorningCard = !morningCardDismissed && new Date().getHours() < 14;
  const feedRef = useRef(null);
  const ptrState = useRef({startY:0, tracking:false, refreshing:false});

  // Attach pull-to-refresh to window so it catches touches starting anywhere on screen
  useEffect(()=>{
    const getScroller = () => document.getElementById('main-scroll');

    const onStart = (e) => {
      const el = getScroller();
      if(el && el.scrollTop <= 0){
        ptrState.current.startY = e.touches[0].clientY;
        ptrState.current.tracking = true;
      } else {
        ptrState.current.tracking = false;
      }
    };

    const onMove = (e) => {
      if(!ptrState.current.tracking) return;
      const el = getScroller();
      if(el && el.scrollTop > 0){ ptrState.current.tracking=false; setPullProgress(0); return; }
      const dy = e.touches[0].clientY - ptrState.current.startY;
      if(dy < 0){ setPullProgress(0); return; }
      setPullProgress(Math.min(1, dy / 72));
    };

    const onEnd = () => {
      if(!ptrState.current.tracking) return;
      ptrState.current.tracking = false;
      setPullProgress(prev => {
        if(prev >= 1 && !ptrState.current.refreshing){
          ptrState.current.refreshing = true;
          setRefreshing(true);
          loadFeedRef.current?.().finally(()=>{
            setRefreshing(false);
            ptrState.current.refreshing = false;
          });
        }
        return 0;
      });
    };

    window.addEventListener('touchstart', onStart, {passive:true});
    window.addEventListener('touchmove',  onMove,  {passive:true});
    window.addEventListener('touchend',   onEnd,   {passive:true});
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove',  onMove);
      window.removeEventListener('touchend',   onEnd);
    };
  }, []);

  // Close 3-dot menu when tapping elsewhere on feed
  useEffect(()=>{
    if(!feedMenuOpen) return;
    const close=()=>setFeedMenuOpen(null);
    document.addEventListener("click", close);
    return ()=>document.removeEventListener("click", close);
  },[feedMenuOpen]);

  const loadFeedRef = useRef(null);
  const searchRef = useRef(null);
  const searchTimer = useRef(null);

  // ── Load live following feed ──
  const loadLiveFeed = async (offset=0) => {
    if(!session?.access_token) return;
    setFeedLoading(true);
    setFeedError(false);
    try {
      const uid = session.user?.id;
      if(!uid){ setFeedLoading(false); return; }
      const followData = await fetch(`${SB_URL}/rest/v1/follows?follower_id=eq.${uid}&select=following_id`, {
        headers: {...sbHeaders(session.access_token)}
      }).then(r=>r.json());
      const followingIds = Array.isArray(followData) ? followData.map(f=>f.following_id) : [];
      const allIds = [...new Set([uid, ...followingIds])];
      const ids = allIds.join(",");
      const [eventsData, profilesData] = await Promise.all([
        fetch(`${SB_URL}/rest/v1/feed_events?user_id=in.(${ids})&order=created_at.desc&limit=50&offset=${offset}`, {
          headers: {...sbHeaders(session.access_token)}
        }).then(r=>r.json()),
        fetch(`${SB_URL}/rest/v1/profiles?id=in.(${ids})&select=id,username,bio,avatar_url`, {
          headers: {...sbHeaders(session.access_token)}
        }).then(r=>r.json()),
      ]);
      const profileMap = {};
      if(Array.isArray(profilesData)) profilesData.forEach(p=>{ profileMap[p.id]=p; });
      if(Array.isArray(eventsData)){
        const mapped = eventsData.map(e=>({
          ...e,
          username: e.user_id === uid ? "You" : (profileMap[e.user_id]?.username || null),
          avatarUrl: profileMap[e.user_id]?.avatar_url || null,
          isOwn: e.user_id === uid,
          profileUserId: e.user_id,
          timeAgo: getTimeAgo(e.created_at),
        }));
        if(offset===0) setLiveEvents(mapped);
        else setLiveEvents(prev=>[...prev,...mapped]);
        setFeedHasMore(eventsData.length===50);
        setFeedOffset(offset+mapped.length);
      }
    } catch(e){ setFeedError(true); }
    setFeedLoading(false);
  };
  // Keep ref in sync so the touch handler can call it without stale closure
  loadFeedRef.current = ()=>{ setFeedOffset(0); return loadLiveFeed(0); };

  const getTimeAgo = (ts) => {
    if(!ts) return "";
    const diff = Date.now() - new Date(ts).getTime();
    const m = Math.floor(diff/60000);
    if(m < 1) return "just now";
    if(m < 60) return `${m}m ago`;
    const h = Math.floor(m/60);
    if(h < 24) return `${h}h ago`;
    return `${Math.floor(h/24)}d ago`;
  };

  useEffect(()=>{ loadLiveFeed(); },[session?.access_token]);

  const loadSuggestedAccounts = async () => {
    if(!session?.access_token) return;
    setSuggestedLoading(true);
    try {
      const myId = session.user?.id;
      if(!myId) return;
      const headers = {...sbHeaders(session.access_token)};

      // Get people I already follow
      const myFollowingRes = await fetch(`${SB_URL}/rest/v1/follows?follower_id=eq.${myId}&select=following_id`, {headers}).then(r=>r.json());
      const myFollowingIds = Array.isArray(myFollowingRes) ? myFollowingRes.map(f=>f.following_id) : [];

      // Get my followers
      const myFollowersRes = await fetch(`${SB_URL}/rest/v1/follows?following_id=eq.${myId}&select=follower_id`, {headers}).then(r=>r.json());
      const myFollowerIds = Array.isArray(myFollowersRes) ? myFollowersRes.map(f=>f.follower_id) : [];

      const mutualCount = {};
      const addCandidate = (id) => {
        if(id === myId) return;
        if(myFollowingIds.includes(id)) return;
        mutualCount[id] = (mutualCount[id]||0) + 1;
      };

      // Only count direction 2: who else follows the same people I follow?
      // This gives an accurate "X people you both follow" count
      if(myFollowingIds.length > 0){
        const res = await fetch(`${SB_URL}/rest/v1/follows?following_id=in.(${myFollowingIds.join(",")})&select=follower_id`, {headers}).then(r=>r.json());
        if(Array.isArray(res)) res.forEach(f=>addCandidate(f.follower_id));
      }

      // Also include direction 1 candidates but don't double-count
      if(myFollowerIds.length > 0){
        const res = await fetch(`${SB_URL}/rest/v1/follows?follower_id=in.(${myFollowerIds.join(",")})&select=following_id`, {headers}).then(r=>r.json());
        if(Array.isArray(res)) res.forEach(f=>{
          const id = f.following_id;
          if(id === myId) return;
          if(myFollowingIds.includes(id)) return;
          if(!mutualCount[id]) mutualCount[id] = 1; // only add if not already counted
        });
      }

      // Sort by mutual count, take top 6
      const topIds = Object.entries(mutualCount)
        .sort((a,b)=>b[1]-a[1])
        .slice(0,6)
        .map(([id])=>id);

      if(topIds.length === 0){ setSuggestedLoading(false); return; }

      // Fetch their profiles
      const profilesRes = await fetch(`${SB_URL}/rest/v1/profiles?id=in.(${topIds.join(",")})&select=id,username,bio,location,style_identity`, {headers}).then(r=>r.json());

      if(Array.isArray(profilesRes)){
        const mapped = profilesRes.map(p=>({
          ...p,
          mutualCount: mutualCount[p.id] || 0,
        })).sort((a,b)=>b.mutualCount-a.mutualCount);
        setSuggestedAccounts(mapped);
      }
    } catch(e){ }
    setSuggestedLoading(false);
  };

  const now = new Date();
  const dayName = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][now.getDay()];
  const greeting = now.getHours()<12?"Morning":now.getHours()<17?"Afternoon":"Evening";
  const nextEvent = null; // was calendarEvents — always empty, EventCard inert below
  const nextOutfit = nextEvent ? outfits.find(o=>o.id===nextEvent.suggestedOutfit)||outfits[0] : null;
  const nextOutfitItems = nextOutfit ? (nextOutfit.items||[]).map(id=>items.find(i=>i.id===id)).filter(Boolean) : [];

  // Feed helpers
  const handleWishlist=(item)=>{
    const newItem={id:Date.now(),emoji:item.emoji,name:item.name,brand:item.brand,price:item.price,gap:"Saved from feed",inMarket:item.forSale};
    if(addToWishlist) addToWishlist(newItem);
    else setWishlist(prev=>prev.find(w=>w.name===item.name)?prev:[...prev,newItem]);
    setActiveItem(null); showToast(item.name+" added to wishlist ❆");
  };
  const handleAddToCloset=(item)=>{
    setItems(prev=>{
      if(prev.find(i=>i.name===item.name)) { showToast(item.name+" already in your closet"); return prev; }
      const newItem={ id:Date.now(), name:item.name, brand:item.brand, category:item.category||"Tops", color:item.color||"#2A2A2A", price:item.price, tags:["from feed"], forSale:false, emoji:item.emoji, wearCount:0, lastWorn:"Never", purchaseDate:new Date().toLocaleDateString("en-US",{month:"short",year:"numeric"}), condition:item.condition||"Good", sourceImage:item.sourceImage||null };
      showToast(item.name+" added to your closet ✦");
      return [...prev, newItem];
    });
    setActiveItem(null);
  };

  // ── Live event card (wore outfit / added item) ──

  // ── Render a single community post card ──
  const POST_ACCENTS = ["#C4A882","#8A7A9A","#7A9A8A","#9A8A7A","#8A9A7A"];
  // ── Today's Suggestion card (acts like a pinned post) ──
  // ── Next Event card (compact) ──
  const EventCard = ()=>nextEvent?(
    <div onClick={()=>setTab("vault")} style={{background:"linear-gradient(135deg,#0F1A2E,#162236)",borderRadius:R14,padding:"10px 14px",border:"1px solid #2A3A5A",marginBottom:14,cursor:_p,display:"flex",gap:12,alignItems:"center"}}>
      <div style={{width:34,height:34,borderRadius:12,background:"#1A2A4A",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>{nextEvent.emoji}</div>
      <div style={{flex:1,minWidth:0}}>
        <div style={ss(8,600,"#5A7090",{letterSpacing:1.5,textTransform:"uppercase",marginBottom:1})}>COMING UP</div>
        <div style={sr(14,500,"#D0E0F4",{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"})}>{nextEvent.label}</div>
        <div style={ss(8,400,"#6A90B8",{letterSpacing:0.5})}>{nextEvent.date} · {nextEvent.occasion}</div>
      </div>
      {nextOutfitItems.length>0&&(
        <div style={{display:"flex",gap:4,flexShrink:0}}>
          {nextOutfitItems.slice(0,3).map(item=>(
            <div key={item.id}><ItemThumb item={item} size={30} r={8} border="1px solid #1A2A40"/>
            </div>
          ))}
        </div>
      )}
      <div style={ss(12,400,"#3A5070")}>→</div>
    </div>
  ):null;

  // Inline trend card for the feed
  const FeedTrendCard=({trend})=>{
    const closetMatches=trend.closetMatch.filter(m=>!m.startsWith("Add")).length;
    return(
      <div onClick={()=>setSelectedTrend(trend)} className="ch"
        style={{borderRadius:R18,marginBottom:16,overflow:"hidden",border:`1px solid ${BR}`,cursor:_p}}>
        <div style={{height:64,background:`linear-gradient(135deg,${trend.palette[0]}66,${trend.palette[1]}99,${trend.palette[2]}66)`,display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0 16px"}}>
          <div style={ss(8,700,DM,{letterSpacing:2,background:"#0D0D0D55",padding:"3px 8px",borderRadius:6,backdropFilter:"blur(4px)"})}>TRENDING NOW</div>
          <div style={{display:"flex",gap:6}}>
            {trend.palette.map((c,i)=><div key={i} style={{width:14,height:14,borderRadius:"50%",background:c,border:"1.5px solid #0D0D0D44"}}/>)}
          </div>
        </div>
        <div style={{background:CD,padding:"14px 16px"}}>
          <div style={{..._btwn,marginBottom:6}}>
            <div style={sr(18,500)}>{trend.trend}</div>
            {closetMatches>0&&<div style={{background:"#0A1A0A",border:"1px solid #1A3A1A",borderRadius:12,padding:"3px 10px",...ss(8,700,"#60A870",{letterSpacing:0.8}),flexShrink:0,marginLeft:8}}>{closetMatches} in your closet</div>}
          </div>
          <div style={ss(9,400,DM,{marginBottom:8,letterSpacing:0.5})}>{trend.source} · {trend.season}</div>
          <div style={ss(10,400,"#9A9080",{lineHeight:1.6,marginBottom:10})}>{trend.description.slice(0,100)}…</div>
          <div style={{..._btwn}}>
            <div style={{display:"flex",gap:5}}>{trend.tags.map(t=><span key={t} style={{background:_1a,borderRadius:R18,padding:"3px 10px",...ss(8,400,DM,{letterSpacing:0.8})}}>{t}</span>)}</div>
            <div style={ss(9,600,G)}>Explore →</div>
          </div>
        </div>
      </div>
    );
  };


  function LiveEventCard({event}) {
    const isWore = event.type === "wore_outfit";
    const emojis = event.item_emojis || [];
    // Look up real item from closet to get accurate price + category
    const realItem = !isWore ? items.find(i=>
      i.name===event.item_name ||
      (event.item_id && String(i.id)===String(event.item_id))
    ) : null;
    // Build a clickable item object from the event data
    const eventItem = isWore ? {
      name: event.outfit_name || "Outfit",
      brand: (event.item_names||[]).slice(0,3).join(", ") || "",
      category: "Outfit",
      sourceImage: null,
      emoji: emojis[0] || "👗",
      price: 0,
      color: "#C4A882",
      condition: "",
      tags: event.item_names || [],
      _isOutfit: true,
    } : {
      name: event.item_name,
      brand: event.item_brand || realItem?.brand || "",
      category: event.item_category || realItem?.category || "",
      sourceImage: event.item_image || realItem?.sourceImage || null,
      emoji: event.item_emoji || realItem?.emoji || "👗",
      price: event.item_price || realItem?.price || 0,
      color: realItem?.color || "#C4A882",
      condition: "",
      tags: [],
    };
    return(<React.Fragment>
      <div style={{background:CD,borderRadius:R18,overflow:"hidden",marginBottom:20,border:`1px solid ${G}22`}}>
        {/* Hero — clickable for single-item events */}
        <div onClick={!isWore ? ()=>setSelectedFeedItem(eventItem) : undefined}
          style={{width:"100%",position:"relative",cursor:!isWore?_p:"default"}}>
          <div style={{width:"100%",paddingTop:isWore?"115%":"125%",position:"relative",overflow:"hidden"}}>
            {!isWore && event.item_image ? (
              <img src={event.item_image} style={{..._abs0,width:"100%",height:"100%",objectFit:"contain",padding:32,boxSizing:"border-box",background:"#0F0F0F"}} alt={event.item_name}/>
            ) : (
              <div style={{..._abs0,background:`linear-gradient(135deg,${G}08,${G}18)`,display:"flex",flexDirection:"column",alignItems:"stretch",gap:3,padding:0,boxSizing:"border-box"}}>
                {isWore ? (
                  // Full-height stacked image cards, each independently clickable
                  (()=>{
                    const sharedColor = (event.item_colors||[])[0] || "#2A2A2A";
                    return (event.item_names||[]).slice(0,3).map((name,i)=>{
                      const img = (event.item_images||[])[i];
                      const emoji = (event.item_emojis||[])[i] || "👗";
                      const brand = (event.item_brands||[])[i] || "";
                      const eventItemId = (event.item_ids||[])[i];
                      const eventItemPrice = (event.item_prices||[])[i];
                      const realI = items.find(it=>it.name===name||(eventItemId&&String(it.id)===String(eventItemId)));
                      const itemObj = { name, brand:brand||realI?.brand||"", category:realI?.category||"", sourceImage:img||realI?.sourceImage||null, emoji:realI?.emoji||emoji, price:eventItemPrice||realI?.price||0, color:realI?.color||"#C4A882", condition:realI?.condition||"", tags:realI?.tags||[] };
                      return(
                        <div key={i} onClick={e=>{e.stopPropagation();setSelectedFeedItem(itemObj);}}
                          style={{flex:1,background:CD,display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden",cursor:_p,borderBottom:i<2?`1px solid #1E1E1E`:"none",minHeight:0}}>
                          {img
                            ? <img src={img} style={{width:"100%",height:"100%",objectFit:"contain",padding:12,boxSizing:"border-box"}} alt={name}/>
                            : <span style={{fontSize:56}}>{emoji}</span>
                          }
                        </div>
                      );
                    });
                  })()
                ) : (
                  <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100%"}}>
                    <span style={{fontSize:72}}>{event.item_emoji||"👗"}</span>
                  </div>
                )}
              </div>
            )}
          </div>
          {/* Live badge */}
          <div style={{position:"absolute",top:10,left:12,background:isWore?"#1A2A1A":"#1A1A2A",border:isWore?"1px solid #2A5A2A":"1px solid #2A2A5A",borderRadius:8,padding:"3px 9px",...ss(8,700,isWore?"#80C880":"#8080C8",{letterSpacing:1})}}>
            {isWore?"✦ WORE TODAY":"✦ NEW ITEM"}
          </div>
          {/* Overlay text */}
          <div style={{position:"absolute",bottom:0,left:0,right:0,height:80,background:"linear-gradient(transparent,#141414EE)"}}/>
          <div style={{position:"absolute",bottom:12,left:14,right:14}}>
            <div style={{...sr(isWore?18:16,500,"#F0EBE3"),textShadow:"0 1px 8px #00000099"}}>
              {isWore ? event.outfit_name : event.item_name}
            </div>
            {!isWore && event.item_brand && <div style={ss(9,400,"#C0B8A8",{marginTop:2})}>{event.item_brand}</div>}
          </div>
        </div>
        {/* User row */}
        <div
          onClick={event.isOwn ? undefined : e=>{e.stopPropagation();e.preventDefault();setViewProfile({userId:event.profileUserId,username:event.username});}}
          style={{display:"flex",gap:12,alignItems:"center",padding:"12px 16px",cursor:event.isOwn?"default":_p}}>
          <div style={{width:40,height:40,borderRadius:"50%",background:event.isOwn?`${G}22`:"#2A2A2A",border:event.isOwn?`1.5px solid ${G}55`:"1px solid #333",overflow:"hidden",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16}}>
            {event.avatarUrl || (event.isOwn && userProfile?.avatar_url)
              ? <img src={event.avatarUrl || userProfile?.avatar_url} style={{width:"100%",height:"100%",objectFit:"cover",objectPosition:"center top"}} alt="avatar"/>
              : <span style={{color:event.isOwn?G:"#888"}}>{event.isOwn?"✦":"👤"}</span>
            }
          </div>
          <div style={{flex:1}}>
            <div style={ss(13,600,event.isOwn?G:MD,{letterSpacing:0.5})}>
              {event.isOwn ? "You" : (event.username ? `@${event.username}` : "Outfix user")}
            </div>
            <div style={ss(11,400,DM)}>{event.timeAgo}</div>
          </div>
          <div style={ss(11,400,DM,{fontStyle:"italic"})}>
            {isWore ? `wore ${(event.item_names||[]).length} items` : event.item_category}
          </div>
          {/* 3-dot delete menu — own posts only */}
          {event.isOwn && (
            <div style={{position:"relative"}} onClick={e=>e.stopPropagation()}>
              <button
                onClick={e=>{e.stopPropagation();setFeedMenuOpen(prev=>prev===event.id?null:event.id);}}
                style={{background:"none",border:"none",cursor:_p,padding:"4px 8px",...ss(16,700,DM),lineHeight:1,letterSpacing:1}}>
                ···
              </button>
              {feedMenuOpen===event.id&&(
                <div style={{position:"absolute",right:0,bottom:"100%",background:"#1E1E1E",border:`1px solid ${BR}`,borderRadius:12,zIndex:50,overflow:"hidden",minWidth:130,boxShadow:"0 8px 24px #00000088"}}>
                  <button
                    onClick={async e=>{
                      e.stopPropagation();
                      setFeedMenuOpen(null);
                      if(session?.access_token){
                        try{
                          const res=await fetch(`${SB_URL}/rest/v1/feed_events?id=eq.${event.id}`,{
                            method:"DELETE",
                            headers:{...sbHeaders(session.access_token),"Prefer":"return=minimal"},
                          });
                          if(res.ok){
                            setLiveEvents(prev=>prev.filter(ev=>ev.id!==event.id));
                            showToast("Post deleted");
                          } else {
                            console.error("Delete post failed:",res.status);
                          }
                        }catch(e){
                          console.error("Delete post error:",e);
                          showToast("Could not delete post ✦");
                        }
                      } else {
                        setLiveEvents(prev=>prev.filter(ev=>ev.id!==event.id));
                        showToast("Post deleted");
                      }
                    }}
                    style={{width:"100%",padding:"12px 16px",background:"none",border:"none",cursor:_p,display:"flex",alignItems:"center",gap:10,...ss(13,500,"#CC4444"),textAlign:"left"}}>
                    🗑 Delete post
                  </button>
                </div>
              )}
            </div>
          )}
          {/* Like button + count */}
          <button onClick={e=>{
            e.stopPropagation();
            const isLiked = liked[event.id];
            setLiked(p=>({...p,[event.id]:!p[event.id]}));
            if(session?.access_token){
              fetch(`${SB_URL}/rest/v1/feed_events?id=eq.${event.id}`,{
                method:"PATCH",
                headers:{...sbHeaders(session.access_token),"Prefer":"return=minimal"},
                body:JSON.stringify({like_count:(event.like_count||0)+(isLiked?-1:1)}),
              }).catch(()=>{});
            }
            setLiveEvents(prev=>prev.map(e=>e.id===event.id?{...e,like_count:Math.max(0,(e.like_count||0)+(isLiked?-1:1))}:e));
          }}
            style={{background:"none",border:"none",cursor:_p,display:"flex",alignItems:"center",gap:5,...ss(14,400,liked[event.id]?"#E08080":DM),flexShrink:0,padding:"4px 0"}}>
            {liked[event.id]?"♥":"♡"}
            <span style={ss(12,400,liked[event.id]?"#E08080":DM)}>{event.like_count||0}</span>
          </button>
          {/* Comment button */}
          {!event.isOwn&&(
            <button onClick={e=>{
              e.stopPropagation();
              const isOpen = commentOpen===event.id;
              setCommentOpen(isOpen?null:event.id);
              if(!isOpen && !comments[event.id]) loadComments(event.id);
            }}
              style={{background:"none",border:"none",cursor:_p,display:"flex",alignItems:"center",gap:5,...ss(12,400,commentOpen===event.id?G:DM),flexShrink:0,padding:"4px 0",marginLeft:6}}>
              💬 <span style={ss(11,400,commentOpen===event.id?G:DM)}>{(comments[event.id]||[]).length||""}</span>
            </button>
          )}
        </div>
      </div>
      {/* ── Comment panel ── */}
      {commentOpen===event.id&&(()=>{
        const [localText, setLocalText] = React.useState("");
        return(
        <div style={{borderTop:`1px solid #1E1E1E`,padding:"12px 16px"}} onClick={e=>e.stopPropagation()}>
          {commentLoading[event.id]&&<div style={{textAlign:"center",padding:"8px 0",...ss(10,400,DM)}}>Loading…</div>}
          {(comments[event.id]||[]).map(c=>(
            <div key={c.id} style={{marginBottom:10,display:"flex",gap:8,alignItems:"flex-start",opacity:c._pending?0.6:1}}>
              <div style={{width:26,height:26,borderRadius:"50%",background:`${G}22`,border:`1px solid ${G}33`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                <span style={ss(9,700,G)}>{(c.username||"?")[0].toUpperCase()}</span>
              </div>
              <div style={{flex:1,background:"#111",borderRadius:12,padding:"7px 10px",border:"1px solid #1E1E1E"}}>
                <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:2}}>
                  <div style={ss(9,600,G)}>@{c.username||"user"}</div>
                  {c._pending&&<div style={ss(8,400,DM,{fontStyle:"italic"})}>sending…</div>}
                </div>
                <div style={ss(11,400,"#D0C8BC",{lineHeight:1.5})}>{c.body}</div>
              </div>
            </div>
          ))}
          {(!comments[event.id]||comments[event.id].length===0)&&!commentLoading[event.id]&&(
            <div style={{...ss(10,400,DM),marginBottom:8,fontStyle:"italic"}}>No comments yet — be the first</div>
          )}
          <div style={{display:"flex",gap:8,alignItems:"center",marginTop:4}}>
            <input
              value={localText}
              onChange={e=>setLocalText(e.target.value)}
              onKeyDown={e=>{ if(e.key==="Enter"&&!e.shiftKey&&localText.trim()){ e.preventDefault(); postComment(event.id, localText.trim()); setLocalText(""); }}}
              placeholder="Add a comment…"
              style={{flex:1,background:"#111",border:`1px solid ${G}33`,borderRadius:R18,padding:"8px 14px",...ss(11,400,"#E8E0D4"),outline:"none",color:"#E8E0D4"}}
            />
            <button onClick={()=>{ if(!localText.trim()) return; postComment(event.id, localText.trim()); setLocalText(""); }}
              disabled={!localText.trim()}
              style={{padding:"8px 14px",borderRadius:R18,background:localText.trim()?`linear-gradient(135deg,${G},#8A6E54)`:"#1A1A1A",border:"none",...ss(9,700,localText.trim()?BK:"#3A3028",{letterSpacing:0.5}),cursor:localText.trim()?_p:"default",flexShrink:0,opacity:localText.trim()?1:0.5}}>
              POST
            </button>
          </div>
        </div>
        );
      })()}
    </React.Fragment>);
  }

  return(
    <React.Fragment>
    <div ref={feedRef} className="fu" style={{padding:"0 8px 24px",overflowY:"auto",WebkitOverflowScrolling:"touch"}}>

      {/* ── Upcoming event card ── */}
      <EventCard/>

      {/* ── Search bar ── */}
      <div onClick={()=>{setShowSearch(true);setTimeout(()=>searchRef.current?.focus(),50);loadSuggestedAccounts();}}
        style={{..._row,gap:10,background:CD,border:`1px solid ${BR}`,borderRadius:12,padding:"8px 14px",marginBottom:16,cursor:"text"}}>
        <span style={{fontSize:13,opacity:0.35}}>🔍</span>
        <div style={ss(11,400,DM,{flex:1})}>Search people, styles, brands…</div>
      </div>

      {/* ── Search overlay (Snapchat style) ── */}
      {showSearch&&(
        <div style={{..._fix,zIndex:90,background:BK,display:"flex",flexDirection:"column",maxWidth:430,margin:"0 auto"}}>

          {/* Search input row */}
          <div style={{padding:"16px 16px 12px",display:"flex",gap:10,alignItems:"center",borderBottom:`1px solid ${BR}`}}>
            <div style={{position:"relative",flex:1}}>
              <span style={{position:"absolute",left:11,top:"50%",transform:"translateY(-50%)",fontSize:12,opacity:0.35,pointerEvents:"none"}}>🔍</span>
              <input
                ref={searchRef}
                value={searchQuery}
                onChange={e=>{
                  const q=e.target.value;
                  setSearchQuery(q);
                  clearTimeout(searchTimer.current);
                  if(!q.trim()){ setUserResults([]); return; }
                  setSearchLoading(true);
                  searchTimer.current=setTimeout(async()=>{
                    try{
                      const token=session?.access_token||"";
                      const res=await fetch(
                        `${SB_URL}/rest/v1/profiles?or=(username.ilike.*${encodeURIComponent(q)}*,bio.ilike.*${encodeURIComponent(q)}*,location.ilike.*${encodeURIComponent(q)}*,style_identity.ilike.*${encodeURIComponent(q)}*)&select=id,username,bio,location,style_identity&limit=20`,
                        {headers:{"Authorization":`Bearer ${token}`,"apikey":SB_KEY}}
                      );
                      const data=await res.json();
                      // Include all results — don't filter out users without usernames
                      setUserResults(Array.isArray(data)?data:[]);
                    }catch(e){ setUserResults([]); }
                    setSearchLoading(false);
                  },300);
                }}
                placeholder="Search people by username…"
                style={{width:"100%",boxSizing:"border-box",padding:"8px 12px 8px 32px",borderRadius:12,background:CD,border:`1px solid ${BR}`,color:"inherit",outline:"none",...ss(11,400,MD)}}
              />
              {searchQuery&&<button onClick={()=>setSearchQuery("")} style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",color:DM,cursor:_p,fontSize:13}}>✕</button>}
            </div>
            <button onClick={()=>{setShowSearch(false);setSearchQuery("");}} style={{background:"none",border:"none",cursor:_p,...ss(11,400,G)}}>Cancel</button>
          </div>

          {/* Content */}
          <div className="sc" style={{flex:1,overflowY:"auto",padding:"20px 16px"}}>
            {!searchQuery ? (
              <React.Fragment>
                <div style={ss(9,600,DM,{letterSpacing:1.5,marginBottom:14})}>SUGGESTED FOR YOU</div>
                {suggestedLoading && (
                  <div style={{textAlign:"center",padding:"24px 0",opacity:0.5}}>
                    <div style={{fontSize:18,animation:"spin 1.2s linear infinite",display:"inline-block",marginBottom:6}}>✦</div>
                    <div style={ss(9,400,DM)}>Finding people you may know…</div>
                  </div>
                )}
                {!suggestedLoading && suggestedAccounts.length === 0 && (
                  <div style={{textAlign:"center",padding:"24px 0",opacity:0.4}}>
                    <div style={ss(11,400,DM,{fontStyle:"italic"})}>No suggestions yet</div>
                    <div style={ss(9,400,DM,{marginTop:4})}>Follow more people to get recommendations</div>
                  </div>
                )}
                {!suggestedLoading && suggestedAccounts.map(acct=>(
                  <div key={acct.id} style={{..._row,gap:12,marginBottom:16,cursor:_p}}
                    onClick={()=>{setViewProfile({userId:acct.id,username:acct.username});setShowSearch(false);setSearchQuery("");}}>
                    <div style={{width:46,height:46,borderRadius:"50%",background:`linear-gradient(135deg,${G}33,${G}55)`,border:`1px solid ${G}44`,overflow:"hidden",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,...ss(18,600,G)}}>
                      {acct.username?.[0]?.toUpperCase()||"?"}
                    </div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={ss(11,600,"#E8E0D4")}>@{acct.username}</div>
                      {acct.style_identity && <div style={ss(9,400,DM,{marginTop:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"})}>{acct.style_identity}</div>}
                      <div style={ss(8,400,DM,{marginTop:1})}>{acct.mutualCount} {acct.mutualCount===1?"person":"people"} you both follow</div>
                    </div>
                    <button onClick={e=>{
                      e.stopPropagation();
                      const myId = session?.user?.id;
                      if(!myId) return;
                      fetch(`${SB_URL}/rest/v1/follows`,{method:"POST",headers:{...sbHeaders(session.access_token),"Prefer":"return=representation"},body:JSON.stringify({follower_id:myId,following_id:acct.id})})
                        .then(()=>{ setSuggestedAccounts(prev=>prev.filter(a=>a.id!==acct.id)); showToast(`Following @${acct.username} \u2746`); })
                        .catch(()=>showToast(`Following @${acct.username} \u2746`));
                    }} style={{padding:"6px 14px",borderRadius:R18,background:`${G}22`,border:`1px solid ${G}55`,...ss(9,600,G,{letterSpacing:0.5}),cursor:_p,flexShrink:0}}>
                      Follow
                    </button>
                  </div>
                ))}
              </React.Fragment>
            ) : (
              <React.Fragment>
                {searchLoading&&(
                  <div style={{textAlign:"center",padding:"32px 0"}}>
                    <div style={{fontSize:22,animation:"spin 1.2s linear infinite",display:"inline-block",marginBottom:8}}>✦</div>
                    <div style={ss(10,400,DM)}>Searching users…</div>
                  </div>
                )}
                {!searchLoading&&userResults.length>0&&(
                  <React.Fragment>
                    <div style={ss(9,600,DM,{letterSpacing:1.5,marginBottom:12})}>USERS</div>
                    {userResults.map(u=>(
                      <div key={u.id} style={{..._row,gap:12,marginBottom:14,cursor:_p,background:CD,borderRadius:R14,padding:"12px 14px",border:`1px solid ${BR}`}}
                        onClick={()=>{setViewProfile({userId:u.id,username:u.username});setShowSearch(false);setSearchQuery("");}}>
                        <div style={{width:46,height:46,borderRadius:"50%",background:`linear-gradient(135deg,${G}33,${G}55)`,border:`1px solid ${G}44`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,...ss(20,400)}}>
                          {(u.username||"?")?.[0]?.toUpperCase()}
                        </div>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={ss(13,600,"#E8E0D4")}>{u.username ? `@${u.username}` : "Outfix User"}</div>
                          {u.bio&&<div style={ss(9,400,DM,{marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"})}>{u.bio}</div>}
                          {u.style_identity&&<div style={ss(9,400,DM,{marginTop:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontStyle:"italic"})}>{u.style_identity}</div>}
                          {u.location&&<div style={ss(9,400,DM,{marginTop:1})}>📍 {u.location}</div>}
                        </div>
                        <div style={ss(10,400,G,{flexShrink:0})}>›</div>
                      </div>
                    ))}
                  </React.Fragment>
                )}
                {!searchLoading&&userResults.length===0&&searchQuery.trim().length>=1&&(
                  <div style={{textAlign:"center",padding:"48px 0"}}>
                    <div style={{fontSize:32,marginBottom:12}}>🔍</div>
                    <div style={sr(15,300,DM,{fontStyle:"italic",marginBottom:6})}>No users found for "{searchQuery}"</div>
                    <div style={ss(9,400,DM)}>Try searching by exact username</div>
                  </div>
                )}
              </React.Fragment>
            )}
          </div>
        </div>
      )}

      {/* Pull-to-refresh expanding gap + fixed spinner */}
      {(pullProgress > 0 || refreshing) && (
        <React.Fragment>
          <div style={{height: refreshing ? 44 : pullProgress*44, transition: refreshing?"none":"height 0.05s", overflow:"hidden"}}/>
          <div style={{position:"fixed",top:76,left:0,right:0,maxWidth:430,margin:"0 auto",zIndex:50,display:"flex",justifyContent:"center",pointerEvents:"none"}}>
            <div style={{width:32,height:32,borderRadius:"50%",background:"#1A1A1A",border:`1px solid ${G}33`,display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 2px 8px #00000066",opacity:refreshing?1:pullProgress,transition:refreshing?"none":"opacity 0.05s"}}>
              <div style={{width:16,height:16,borderRadius:"50%",border:`2px solid ${G}33`,borderTopColor:G,animation:refreshing?"spin 0.7s linear infinite":"none",transform:refreshing?"none":`rotate(${pullProgress*270}deg)`,transition:refreshing?"none":"transform 0.05s"}}/>
            </div>
          </div>
        </React.Fragment>
      )}

      {/* Swipe hint — only shown when not refreshing and no pull in progress */}
      {!refreshing && pullProgress === 0 && (
        <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:8,marginBottom:12,opacity:0.5}}>
          <div style={{height:1,flex:1,background:`${G}33`}}/>
          <div style={ss(8,600,G,{letterSpacing:2})}>↓ SWIPE HERE TO UPDATE FEED ↓</div>
          <div style={{height:1,flex:1,background:`${G}33`}}/>
        </div>
      )}
      {/* ── STYLE PROFILE NUDGE ── */}
      {!styleNudgeDismissed && !styleProfile?.quizCompleted && (
        <div style={{background:"linear-gradient(135deg,#1A1608,#201C08)",border:`1px solid ${G}55`,borderLeft:`3px solid ${G}`,borderRadius:R14,padding:"12px 14px",marginBottom:16,display:"flex",gap:12,alignItems:"center"}}>
          <div style={{flex:1}}>
            <div style={ss(10,700,G,{letterSpacing:1,marginBottom:3})}>MAKE AI STYLING PERSONAL</div>
            <div style={ss(11,400,MD,{lineHeight:1.5})}>Take the 60-second style quiz — AI suggestions get dramatically better</div>
          </div>
          <div style={{display:"flex",gap:8,alignItems:"center",flexShrink:0}}>
            <button onClick={onOpenStyleQuiz} style={{padding:"7px 14px",borderRadius:R18,background:`linear-gradient(135deg,${G},#8A6E54)`,border:"none",...ss(9,700,BK,{letterSpacing:1}),cursor:_p,whiteSpace:"nowrap"}}>TAKE QUIZ →</button>
            <button onClick={onDismissStyleNudge} style={{background:"none",border:"none",cursor:_p,...ss(16,300,DM),lineHeight:1}}>×</button>
          </div>
        </div>
      )}

      {feedError && liveEvents.length === 0 && (
        <div style={{textAlign:"center",padding:"60px 24px",display:"flex",flexDirection:"column",alignItems:"center",gap:12}}>
          <div style={{fontSize:36,marginBottom:4}}>⚡</div>
          <div style={sr(18,400,"#E8E0D4")}>Couldn't load your feed.</div>
          <div style={ss(11,400,DM,{lineHeight:1.6,maxWidth:260})}>Check your connection and try again.</div>
          <button onClick={()=>loadFeedRef.current?.()} style={{marginTop:8,padding:"10px 24px",borderRadius:R18,background:`${G}22`,border:`1px solid ${G}44`,...ss(9,600,G,{letterSpacing:1}),cursor:_p}}>RETRY</button>
        </div>
      )}


      {/* ── FIRST LOOK CARD — fires when quiz done + items exist ── */}
      {showFirstLook && (firstLookLoading || firstLook) && (
        <div style={{background:"linear-gradient(135deg,#1A1208,#221A0A)",border:`1px solid ${G}55`,borderRadius:R18,overflow:"hidden",marginBottom:16}}>
          {/* Header */}
          <div style={{padding:"14px 18px 10px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <div style={{width:32,height:32,borderRadius:"50%",background:`linear-gradient(135deg,${G},#8A6E54)`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14}}>✦</div>
              <div>
                <div style={ss(10,700,G,{letterSpacing:1})}>WE STYLED SOMETHING FOR YOU</div>
                <div style={ss(9,400,DM,{marginTop:1})}>Based on your closet + style profile</div>
              </div>
            </div>
            <button onClick={dismissFirstLook} style={{background:"none",border:"none",cursor:_p,...ss(16,300,DM),lineHeight:1}}>×</button>
          </div>
          {/* Loading */}
          {firstLookLoading && (
            <div style={{padding:"20px 18px 22px"}}>
              <AILoader label="Styling your first look" size="sm"/>
            </div>
          )}
          {/* Result */}
          {!firstLookLoading && firstLook && (
            <div style={{padding:"0 18px 18px"}}>
              {/* Vibe */}
              <div style={{background:`${G}18`,borderRadius:R18,padding:"4px 12px",display:"inline-block",marginBottom:12,...ss(10,600,G,{letterSpacing:0.5})}}>{firstLook.vibe}</div>
              {/* Items */}
              <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:firstLook.note?10:0}}>
                {(firstLook.outfit||[]).map((name,i)=>{
                  const item = items.find(it=>it.name.toLowerCase()===name.toLowerCase())||null;
                  return(
                    <div key={i} style={{display:"flex",alignItems:"center",gap:10,background:"#111",borderRadius:12,padding:"8px 12px",border:"1px solid #1E1E1E"}}>
                      {item?.sourceImage
                        ? <img src={item.sourceImage} style={{width:32,height:32,borderRadius:6,objectFit:"contain",background:"#1A1A1A"}} alt={name}/>
                        : <div style={{width:32,height:32,borderRadius:6,background:`${G}18`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14}}>{item?.emoji||"👗"}</div>
                      }
                      <div style={ss(11,500,"#E8E0D4")}>{name}</div>
                    </div>
                  );
                })}
              </div>
              {/* Note */}
              {firstLook.note && <div style={ss(11,400,DM,{fontStyle:"italic",lineHeight:1.6,marginBottom:12})}>{firstLook.note}</div>}
              {/* Missing pieces */}
              {(firstLook.missing||[]).length>0 && (
                <div style={{background:"#0A0A12",borderRadius:12,padding:"10px 12px",border:"1px solid #2A2A3A"}}>
                  <div style={ss(8,600,"#8A90B8",{letterSpacing:1.5,marginBottom:6})}>COULD COMPLETE THIS LOOK</div>
                  {firstLook.missing.map((m,i)=>(
                    <div key={i} style={{...ss(10,400,"#8A90B8"),marginTop:i>0?4:0}}>+ {m}</div>
                  ))}
                </div>
              )}
              {/* CTA */}
              <button onClick={()=>{setTab("outfits");dismissFirstLook();}} style={{width:"100%",marginTop:14,padding:"11px",borderRadius:12,background:`linear-gradient(135deg,${G},#8A6E54)`,border:"none",...ss(9,700,BK,{letterSpacing:1.5}),cursor:_p}}>
                BUILD THIS LOOK →
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── SPARSE CLOSET PROGRESS CARD — hidden when quiz nudge is showing ── */}
      {items.length < 5 && (styleNudgeDismissed || styleProfile?.quizCompleted) && (
        <div style={{background:"linear-gradient(135deg,#141008,#1A1610)",border:`1px solid ${G}33`,borderRadius:R14,padding:"14px 16px",marginBottom:14}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
            <div style={{flex:1}}>
              <div style={sr(15,400,"#E8E0D4",{marginBottom:3})}>
                {items.length===0
                  ? "Add your first piece to get started."
                  : `Add ${5-items.length} more piece${5-items.length===1?"":"s"} to unlock full AI outfit suggestions.`}
              </div>
              <div style={ss(10,400,DM)}>
                {items.length} of 5 pieces added
              </div>
            </div>
            <button onClick={()=>setTab("closet")} style={{flexShrink:0,marginLeft:14,padding:"8px 16px",borderRadius:R18,background:`linear-gradient(135deg,${G},#8A6E54)`,border:"none",...ss(9,700,BK,{letterSpacing:1}),cursor:_p}}>
              ADD PIECE
            </button>
          </div>
          {/* Progress bar */}
          <div style={{height:4,background:"#1E1E1E",borderRadius:2,overflow:"hidden"}}>
            <div style={{height:"100%",width:`${Math.min(100,(items.length/5)*100)}%`,background:`linear-gradient(90deg,${G},#A08060)`,borderRadius:2,transition:"width 0.6s ease"}}/>
          </div>
          {/* Dots */}
          <div style={{display:"flex",gap:0,marginTop:6}}>
            {[0,1,2,3,4].map(i=>(
              <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center"}}>
                <div style={{width:6,height:6,borderRadius:"50%",background:i<items.length?G:"#2A2A2A",transition:"background 0.3s"}}/>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── MORNING OUTFIT CARD — only shows when there's feed content ── */}
      {showMorningCard && liveEvents.length > 0 && (
        <div style={{background:"linear-gradient(135deg,#1A1410,#201810)",border:`1px solid ${G}44`,borderRadius:R14,padding:"16px 18px",marginBottom:16,display:"flex",alignItems:"center",gap:14}}>
          <div style={{fontSize:32,flexShrink:0}}>👗</div>
          <div style={{flex:1}}>
            <div style={sr(16,400,"#E8E0D4",{marginBottom:3})}>What are you wearing today?</div>
            <div style={ss(10,400,DM,{lineHeight:1.5})}>Log your outfit to track cost-per-wear and improve AI suggestions.</div>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:6,flexShrink:0}}>
            <button onClick={()=>setTab("outfits")} style={{padding:"8px 14px",borderRadius:R18,background:`linear-gradient(135deg,${G},#8A6E54)`,border:"none",...ss(9,700,BK,{letterSpacing:1}),cursor:_p,whiteSpace:"nowrap"}}>LOG IT →</button>
            <button onClick={dismissMorningCard} style={{padding:"4px 0",background:"none",border:"none",cursor:_p,...ss(9,400,DM),textAlign:"center"}}>not today</button>
          </div>
        </div>
      )}

      {feedLoading && liveEvents.length === 0 && !refreshing && (
        <div style={{textAlign:"center",padding:"12px 0",marginBottom:4}}>
          <div style={ss(9,400,DM,{letterSpacing:1,animation:"pulse 2s ease-in-out infinite"})}>Loading following feed…</div>
        </div>
      )}

      {/* ── Empty feed state ── */}
      {!feedLoading && liveEvents.length === 0 && (
        <div style={{textAlign:"center",padding:"60px 24px 40px",display:"flex",flexDirection:"column",alignItems:"center",gap:12}}>
          <div style={{fontSize:48,marginBottom:4,animation:"pulse 2s ease-in-out infinite"}}>✦</div>
          <div style={sr(22,400,"#E8E0D4")}>Your feed is quiet right now.</div>
          <div style={ss(12,400,DM,{lineHeight:1.8,maxWidth:280,marginTop:4})}>The best closets are built together. Follow a few people and watch this space come alive.</div>
          <div onClick={()=>{setShowDiscover(true);loadDiscoverUsers();}} style={{marginTop:12,background:`${G}18`,border:`1px solid ${G}44`,borderRadius:24,padding:"10px 22px",...ss(9,600,G,{letterSpacing:1.2}),cursor:_p}}>DISCOVER PEOPLE →</div>
        </div>
      )}

      {/* ── Live following events (top of feed) ── */}
      {liveEvents.length > 0 && (
        <div style={{marginBottom:4}}>
          <div style={ss(8,600,DM,{letterSpacing:2,marginBottom:10})}>FOLLOWING</div>
          {liveEvents.map(e=><LiveEventCard key={e.id} event={e}/>)}
          {feedHasMore && (
            <div style={{display:"flex",justifyContent:"center",marginBottom:20}}>
              <button onClick={()=>loadLiveFeed(feedOffset)} disabled={feedLoading}
                style={{padding:"12px 28px",borderRadius:24,background:`linear-gradient(135deg,${G},#8A6E54)`,border:"none",...ss(10,600,BK,{letterSpacing:1.5}),cursor:feedLoading?"default":_p,opacity:feedLoading?0.7:1,boxShadow:"0 4px 20px #00000066"}}>
                {feedLoading?"LOADING…":"LOAD MORE"}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Trend detail overlay ── */}
      {selectedTrend&&(
        <div style={{..._fix,zIndex:80,background:BK,display:"flex",flexDirection:"column",maxWidth:430,margin:"0 auto"}}>
          {/* Header */}
          <div style={{height:120,background:`linear-gradient(135deg,${selectedTrend.palette[0]}66,${selectedTrend.palette[1]}99,${selectedTrend.palette[2]}55)`,display:"flex",alignItems:"flex-end",padding:"0 20px 16px",position:"relative",flexShrink:0}}>
            <button onClick={()=>setSelectedTrend(null)} style={{position:"absolute",top:16,left:16,width:34,height:34,borderRadius:"50%",background:"#0D0D0DAA",border:_2a,display:"flex",alignItems:"center",justifyContent:"center",cursor:_p,...ss(16,400,MD)}}>←</button>
            <div style={{display:"flex",gap:6,position:"absolute",top:16,right:16}}>
              {selectedTrend.palette.map((c,i)=><div key={i} style={{width:14,height:14,borderRadius:"50%",background:c,border:"1px solid #0D0D0D44"}}/>)}
            </div>
            <div>
              <div style={ss(8,700,DM,{letterSpacing:2,marginBottom:4})}>{selectedTrend.source.toUpperCase()} · {selectedTrend.season.toUpperCase()}</div>
              <div style={sr(28,400)}>{selectedTrend.trend}</div>
            </div>
          </div>
          {/* Body */}
          <div className="sc" style={{flex:1,overflowY:"auto",padding:"20px 20px 40px"}}>
            <div style={{display:"flex",gap:6,marginBottom:14}}>
              {selectedTrend.tags.map(t=><span key={t} style={{background:_1a,borderRadius:R18,padding:"4px 12px",...ss(9,400,MD,{letterSpacing:0.8})}}>{t}</span>)}
            </div>
            <div style={ss(13,400,"#C0B8A8",{lineHeight:1.7,marginBottom:20})}>{selectedTrend.description}</div>

            {/* Your closet matches */}
            <div style={ss(8,700,DM,{letterSpacing:2,marginBottom:10})}>YOUR CLOSET</div>
            {selectedTrend.closetMatch.map((m,i)=>(
              <div key={i} style={{..._row,gap:10,marginBottom:10}}>
                <div style={{width:8,height:8,borderRadius:"50%",background:m.startsWith("Add")?DM:G,flexShrink:0}}/>
                <div style={ss(11,400,m.startsWith("Add")?DM:"#D0C8B8")}>{m}</div>
              </div>
            ))}

            {/* Shoppable */}
            <div style={ss(8,700,DM,{letterSpacing:2,marginTop:20,marginBottom:10})}>SHOP THE TREND</div>
            {selectedTrend.shoppable.map((s,i)=>(
              <div key={i} style={{..._btwn,background:CD,borderRadius:R14,padding:"12px 14px",marginBottom:8,border:`1px solid ${BR}`}}>
                <div style={{..._row,gap:10}}>
                  <div style={{width:36,height:36,borderRadius:12,background:_1a,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20}}>{s.emoji}</div>
                  <div>
                    <div style={ss(11,500,"#E8E0D4")}>{s.name}</div>
                    <div style={ss(9,400,DM,{marginTop:1})}>{s.brand}</div>
                  </div>
                </div>
                <div style={sr(14,400,G)}>${s.price.toLocaleString()}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>

    {/* ── Feed item popup — outside .fu transform ── */}
  {selectedFeedItem&&(
    <div onClick={()=>setSelectedFeedItem(null)} style={{position:"fixed",top:76,left:0,right:0,bottom:0,background:"#000A",zIndex:200,display:"flex",alignItems:"center",justifyContent:"center",padding:"0 20px"}}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#0D0D0D",borderRadius:24,width:"100%",maxWidth:390,border:`1px solid ${G}22`,overflow:"hidden"}}>
        {/* Image */}
        <div style={{width:"100%",height:200,background:`linear-gradient(135deg,${G}12,${G}28)`,display:"flex",alignItems:"center",justifyContent:"center",position:"relative"}}>
          {selectedFeedItem.sourceImage
            ? <img src={selectedFeedItem.sourceImage} style={{width:"100%",height:"100%",objectFit:"contain",padding:16,boxSizing:"border-box"}} alt={selectedFeedItem.name}/>
            : <div style={{fontSize:selectedFeedItem._isOutfit?56:72}}>{selectedFeedItem.emoji}</div>
          }
          <button onClick={()=>setSelectedFeedItem(null)} style={{position:"absolute",top:10,right:10,width:28,height:28,borderRadius:"50%",background:"#0D0D0DAA",border:"1px solid #2A2A2A",cursor:_p,...ss(14,400,DM),display:"flex",alignItems:"center",justifyContent:"center"}}>×</button>
        </div>
        {/* Info */}
        <div style={{padding:"14px 18px 20px"}}>
          <div style={sr(20,500,undefined,{marginBottom:4})}>{selectedFeedItem.name}</div>
          {selectedFeedItem._isOutfit ? (
            <React.Fragment>
              <div style={ss(9,400,DM,{marginBottom:10})}>Items in this outfit</div>
              <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:14}}>
                {(selectedFeedItem.tags||[]).map((t,i)=>(
                  <div key={i} style={{background:"#1A1A1A",borderRadius:8,padding:"3px 10px",border:"1px solid #2A2A2A",...ss(10,400,MD)}}>{t}</div>
                ))}
              </div>
              <div style={{display:"flex",gap:8}}>
                <button onClick={()=>{handleWishlist(selectedFeedItem);setSelectedFeedItem(null);}} style={{flex:1,padding:"12px",borderRadius:R14,background:"#1A1A2A",border:`1px solid ${G}44`,...ss(10,600,G,{letterSpacing:1}),cursor:_p}}>♡ WISHLIST</button>
                <button onClick={()=>{handleAddToCloset(selectedFeedItem);setSelectedFeedItem(null);}} style={{flex:1,padding:"12px",borderRadius:R14,background:`linear-gradient(135deg,${G},#8A6E54)`,border:"none",...ss(10,700,BK,{letterSpacing:1.5}),cursor:_p}}>+ CLOSET</button>
              </div>
            </React.Fragment>
          ) : (
            <React.Fragment>
              <div style={{..._row,gap:8,marginBottom:12}}>
                <div style={ss(10,400,DM)}>{selectedFeedItem.brand}</div>
                {selectedFeedItem.category&&<div style={ss(10,400,DM)}>· {selectedFeedItem.category}</div>}
              </div>
              <div style={{display:"flex",gap:8,marginBottom:14}}>
                {[[selectedFeedItem.price?`$${selectedFeedItem.price}`:"—","PRICE"],[selectedFeedItem.category||"—","CATEGORY"]].map(([v,l])=>(
                  <div key={l} style={{flex:1,background:"#111",borderRadius:12,padding:"8px 4px",textAlign:"center",border:"1px solid #1E1E1E"}}>
                    <div style={sr(13,500,G)}>{v}</div>
                    <div style={ss(8,400,DM,{letterSpacing:1,marginTop:2})}>{l}</div>
                  </div>
                ))}
              </div>
              <div style={{display:"flex",gap:8}}>
                <button onClick={()=>{handleWishlist(selectedFeedItem);setSelectedFeedItem(null);}} style={{flex:1,padding:"12px",borderRadius:R14,background:"#1A1A2A",border:`1px solid ${G}44`,...ss(10,600,G,{letterSpacing:1}),cursor:_p}}>♡ WISHLIST</button>
                <button onClick={()=>{handleAddToCloset(selectedFeedItem);setSelectedFeedItem(null);}} style={{flex:1,padding:"12px",borderRadius:R14,background:`linear-gradient(135deg,${G},#8A6E54)`,border:"none",...ss(10,700,BK,{letterSpacing:1.5}),cursor:_p}}>+ CLOSET</button>
              </div>
            </React.Fragment>
          )}
        </div>
      </div>
    </div>
  )}

  {/* ── Discover People modal ── */}
  {showDiscover&&(
    <div onClick={()=>setShowDiscover(false)} style={{position:"fixed",inset:0,background:"#000000CC",zIndex:300,maxWidth:430,margin:"0 auto",display:"flex",flexDirection:"column",justifyContent:"flex-end"}}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#0D0D0D",borderRadius:"22px 22px 0 0",border:"1px solid #2A2418",maxHeight:"82vh",display:"flex",flexDirection:"column"}}>
        {/* Header */}
        <div style={{padding:"20px 20px 12px",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0,borderBottom:"1px solid #1A1A1A"}}>
          <div>
            <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:22,fontWeight:300,color:"#F0EBE3"}}>Suggested People</div>
            <div style={ss(8,400,DM,{letterSpacing:0.5,marginTop:2})}>Sorted by most followers</div>
          </div>
          <button onClick={()=>setShowDiscover(false)} style={{background:"none",border:"none",cursor:_p,...ss(9,600,DM,{letterSpacing:0.5})}}>DONE</button>
        </div>
        {/* Body */}
        <div className="sc" style={{overflowY:"auto",padding:"8px 0 32px",flex:1}}>
          {discoverLoading&&(
            <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"48px 0",gap:12}}>
              <div style={{fontSize:24,color:G,animation:"spin 1.2s linear infinite"}}>✦</div>
              <div style={ss(9,400,DM,{letterSpacing:1})}>Finding people…</div>
            </div>
          )}
          {!discoverLoading&&discoverUsers.length===0&&(
            <div style={{textAlign:"center",padding:"48px 24px"}}>
              <div style={{fontSize:32,marginBottom:12,opacity:0.4}}>✦</div>
              <div style={sr(18,400,"#E8E0D4",{marginBottom:8})}>No suggestions yet.</div>
              <div style={ss(11,400,DM)}>Check back as more people join Outfix.</div>
            </div>
          )}
          {!discoverLoading&&discoverUsers.map(user=>{
            const isFollowing = discoverFollowing.has(user.id);
            const initials = (user.username||"?").slice(0,2).toUpperCase();
            return(
              <div key={user.id} style={{display:"flex",alignItems:"center",gap:12,padding:"12px 20px",borderBottom:"1px solid #141414"}}>
                {/* Avatar */}
                <div onClick={()=>{setViewProfile&&setViewProfile({userId:user.id,username:user.username});setShowDiscover(false);}}
                  style={{width:46,height:46,borderRadius:"50%",background:`linear-gradient(135deg,#1E1A14,#2A2418)`,border:`1px solid ${G}33`,flexShrink:0,cursor:_p,display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden"}}>
                  {user.avatar_url
                    ? <img src={user.avatar_url} style={{width:"100%",height:"100%",objectFit:"cover"}} alt=""/>
                    : <span style={{fontFamily:"'Cormorant Garamond',serif",fontSize:16,color:G}}>{initials}</span>
                  }
                </div>
                {/* Info */}
                <div style={{flex:1,minWidth:0,cursor:_p}} onClick={()=>{setViewProfile&&setViewProfile({userId:user.id,username:user.username});setShowDiscover(false);}}>
                  <div style={{display:"flex",alignItems:"center",gap:6}}>
                    <div style={ss(13,600,"#E8E0D4",{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"})}>@{user.username||"unknown"}</div>
                    {user.followerCount>0&&(
                      <div style={{background:`${G}18`,border:`1px solid ${G}33`,borderRadius:10,padding:"1px 7px",...ss(8,600,G)}}>
                        {user.followerCount} {user.followerCount===1?"follower":"followers"}
                      </div>
                    )}
                  </div>
                  {(user.bio||user.style_identity)&&(
                    <div style={ss(10,400,DM,{marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:180})}>{user.bio||user.style_identity}</div>
                  )}
                </div>
                {/* Follow button */}
                <button onClick={()=>discoverFollow(user.id)}
                  style={{padding:"7px 14px",borderRadius:R18,cursor:_p,flexShrink:0,border:"none",
                    background:isFollowing?`${G}18`:`linear-gradient(135deg,${G},#8A6E54)`,
                    ...(isFollowing?{border:`1px solid ${G}44`,...ss(8,600,G,{letterSpacing:0.5})}:{...ss(8,700,BK,{letterSpacing:0.5})})}}>
                  {isFollowing?"Following":"Follow"}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  )}

    </React.Fragment>
  );
}

// ── CLOSET DETAIL IMAGE (needs own component to use useImageBg hook) ──────────
function ClosetDetailImage({item, onSaveItem, setItems, setSelectedClosetItem, showToast}){
  const allImages = item.sourceImages?.length ? item.sourceImages : (item.sourceImage ? [item.sourceImage] : []);
  const [imgIdx, setImgIdx] = useState(0);
  const [cropSrc, setCropSrc] = useState(null);
  const [addingPhoto, setAddingPhoto] = useState(false);
  const [bgRemoving, setBgRemoving] = useState(false);
  const [modelRemoving, setModelRemoving] = useState(false);
  // ── Undo history: keyed by photo index, each entry is a stack (newest last) of previous URLs ──
  const [undoHistory, setUndoHistory] = useState({}); // { [idx]: [url1, url2, ...] }
  const touchStart = useRef(null);
  const bg = useImageBg(allImages[imgIdx]||item.sourceImage, item.color||"#1A1A1A");

  // ── Pinch-to-zoom state ──
  const [scale, setScale]       = useState(1);
  const [origin, setOrigin]     = useState({x:50,y:50}); // transform-origin in %
  const imgRef                  = useRef(null);
  const pinchRef                = useRef({active:false,startDist:0,startScale:1,midX:0,midY:0});

  const getDist = (t) => {
    const dx = t[0].clientX - t[1].clientX;
    const dy = t[0].clientY - t[1].clientY;
    return Math.sqrt(dx*dx + dy*dy);
  };
  const getMid = (t, rect) => ({
    x: ((t[0].clientX + t[1].clientX)/2 - rect.left) / rect.width * 100,
    y: ((t[0].clientY + t[1].clientY)/2 - rect.top)  / rect.height * 100,
  });

  const onImgTouchStart = e => {
    if(e.touches.length === 2){
      e.preventDefault();
      const rect = imgRef.current?.getBoundingClientRect();
      const mid  = rect ? getMid(e.touches, rect) : {x:50,y:50};
      pinchRef.current = {active:true, startDist:getDist(e.touches), startScale:scale, midX:mid.x, midY:mid.y};
      setOrigin(mid);
    } else if(e.touches.length === 1){
      // Only register swipe start if not zoomed in
      if(scale <= 1.05) touchStart.current = e.touches[0].clientX;
    }
  };

  const onImgTouchMove = e => {
    if(e.touches.length === 2 && pinchRef.current.active){
      e.preventDefault();
      const ratio = getDist(e.touches) / pinchRef.current.startDist;
      const next  = Math.min(4, Math.max(1, pinchRef.current.startScale * ratio));
      setScale(next);
    }
  };

  const onImgTouchEnd = e => {
    if(pinchRef.current.active){
      pinchRef.current.active = false;
      // Snap back to 1 if barely zoomed
      if(scale < 1.15){ setScale(1); setOrigin({x:50,y:50}); }
      return;
    }
    // Swipe between images only when not zoomed
    if(scale > 1.05 || touchStart.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStart.current;
    touchStart.current = null;
    if(Math.abs(dx) < 30) return;
    setScale(1); setOrigin({x:50,y:50});
    if(dx < 0) setImgIdx(i=>Math.min(i+1, allImages.length-1));
    else setImgIdx(i=>Math.max(i-1, 0));
  };

  // Reset zoom when image changes
  useEffect(()=>{ setScale(1); setOrigin({x:50,y:50}); }, [imgIdx]);

  const saveImages = (newImages) => {
    const updated = {...item, sourceImages: newImages, sourceImage: newImages[0]||item.sourceImage};
    setItems(prev=>prev.map(x=>x.id===item.id?updated:x));
    setSelectedClosetItem(updated);
    if(onSaveItem) onSaveItem(updated);
  };

  // Push current photo URL onto undo stack for this index (max 3 levels deep)
  const pushUndo = (idx, url) => {
    if(!url) return;
    setUndoHistory(prev => {
      const stack = prev[idx] || [];
      const next = [...stack, url].slice(-3); // keep last 3 only
      return { ...prev, [idx]: next };
    });
  };

  const handleUndo = () => {
    const stack = undoHistory[imgIdx] || [];
    if(!stack.length) return;
    const previous = stack[stack.length - 1];
    const newImages = [...allImages];
    newImages[imgIdx] = previous;
    saveImages(newImages);
    // Pop this level off the stack
    setUndoHistory(prev => {
      const s = (prev[imgIdx] || []).slice(0, -1);
      const copy = { ...prev };
      if(s.length === 0) delete copy[imgIdx];
      else copy[imgIdx] = s;
      return copy;
    });
    showToast("Reverted to previous version \u2746");
  };

  // ── Manual Remove Background on current photo ──
  const handleRemoveBg = async () => {
    const current = allImages[imgIdx];
    if(!current || bgRemoving) return;
    setBgRemoving(true);
    try {
      // Fetch as dataURL if hosted URL, then strip prefix
      let dataUrl = current;
      if(!current.startsWith('data:')){
        const r = await fetch(current);
        const blob = await r.blob();
        dataUrl = await new Promise((res,rej)=>{
          const fr=new FileReader(); fr.onload=e=>res(e.target.result); fr.onerror=rej; fr.readAsDataURL(blob);
        });
      }
      const b64 = dataUrl.split(',')[1];
      const res = await fetch('/api/remove-bg',{
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({imageBase64:b64}),
      });
      if(!res.ok) throw new Error(`remove-bg failed: ${res.status}`);
      const json = await res.json();
      const cleanB64 = json.imageBase64;
      if(!cleanB64) throw new Error('No image returned');
      const cleanUrl = `data:image/png;base64,${cleanB64}`;
      // Save current URL to undo stack BEFORE replacing
      pushUndo(imgIdx, current);
      const newImages = [...allImages];
      newImages[imgIdx] = cleanUrl;
      saveImages(newImages);
      showToast("Background removed \u2746");
    } catch(e) {
      console.error('remove-bg error:', e);
      showToast("Couldn't remove background — try again");
    }
    setBgRemoving(false);
  };

  // ── Manual Remove Model on current photo ──
  const handleRemoveModel = async () => {
    const current = allImages[imgIdx];
    if(!current || modelRemoving) return;
    setModelRemoving(true);
    try {
      let dataUrl = current;
      if(!current.startsWith('data:')){
        try {
          const r = await fetch(current);
          if(!r.ok) throw new Error(`fetch_${r.status}`);
          const blob = await r.blob();
          // OpenAI image edit endpoint rejects files >4MB
          if(blob.size > 4 * 1024 * 1024) throw new Error('image_too_large');
          dataUrl = await new Promise((res,rej)=>{
            const fr=new FileReader(); fr.onload=e=>res(e.target.result); fr.onerror=()=>rej(new Error('read_failed')); fr.readAsDataURL(blob);
          });
        } catch(fetchErr) {
          console.error('[handleRemoveModel] Failed to fetch source image:', fetchErr);
          throw new Error(fetchErr.message.startsWith('fetch_') ? 'source_unreachable' : fetchErr.message);
        }
      }
      const cleanUrl = await extractGarment(dataUrl);
      if(!cleanUrl) throw new Error('no_image_returned');
      // Save current URL to undo stack BEFORE replacing
      pushUndo(imgIdx, current);
      const newImages = [...allImages];
      newImages[imgIdx] = cleanUrl;
      saveImages(newImages);
      showToast("Model removed \u2746");
    } catch(e) {
      console.error('[handleRemoveModel] error:', e.message);
      // Map error code → user-readable message
      const errMap = {
        'endpoint_missing': "Remove model isn't deployed — contact support",
        'api_key_invalid': "OpenAI key invalid — check Vercel env vars",
        'quota_exceeded': "OpenAI quota exceeded — check billing",
        'image_too_large': "Photo too large — try a smaller image",
        'rate_limited': "Too many requests — try again in a moment",
        'source_unreachable': "Couldn't load photo — check your connection",
        'no_image_returned': "Service didn't return an image — try again",
      };
      let msg = errMap[e.message];
      if(!msg){
        if(e.message.startsWith('server_')) msg = "OpenAI service unavailable — try again later";
        else if(e.message.startsWith('api_')) msg = `Remove model failed (${e.message.slice(4,7)}) — check console`;
        else msg = "Couldn't remove model — check console for details";
      }
      showToast(msg);
    }
    setModelRemoving(false);
  };

  return(
    <React.Fragment>
      {cropSrc&&(
        <CropModal
          src={cropSrc}
          onCancel={()=>{setCropSrc(null);setAddingPhoto(false);}}
          onSave={async cropped=>{
            setCropSrc(null);
            if(addingPhoto){
              const newImages=[...allImages, cropped];
              saveImages(newImages);
              setImgIdx(newImages.length-1);
              showToast("Photo added \u2746");
            } else {
              // Save current URL to undo stack BEFORE replacing
              pushUndo(imgIdx, allImages[imgIdx]);
              const newImages=[...allImages];
              newImages[imgIdx]=cropped;
              saveImages(newImages);
              showToast("Photo updated \u2746");
            }
            setAddingPhoto(false);
          }}
          autoRemoveBg={true}
        />
      )}
      <div
        onTouchStart={onImgTouchStart}
        onTouchMove={onImgTouchMove}
        onTouchEnd={onImgTouchEnd}
        style={{position:"relative",width:"100%",height:220,background:allImages[imgIdx]?bg:`linear-gradient(135deg,${item.color||"#2A2A2A"}22,${item.color||"#2A2A2A"}44)`,borderRadius:12,overflow:"hidden",marginBottom:12,transition:"background 0.4s ease",touchAction:"pinch-zoom"}}>
        {allImages[imgIdx]
          ?<img ref={imgRef} src={allImages[imgIdx]} style={{width:"100%",height:"100%",objectFit:"contain",padding:12,boxSizing:"border-box",transform:`scale(${scale})`,transformOrigin:`${origin.x}% ${origin.y}%`,transition:pinchRef.current.active?'none':'transform 0.2s ease',userSelect:"none"}} alt={item.name}/>
          :<div style={{width:"100%",height:"100%",display:"flex",alignItems:"center",justifyContent:"center"}}><ItemIllustration item={item} size={120}/></div>
        }
        {/* Dots */}
        {allImages.length>1&&(
          <div style={{position:"absolute",bottom:10,left:0,right:0,display:"flex",justifyContent:"center",gap:5}}>
            {allImages.map((_,i)=>(
              <div key={i} onClick={()=>setImgIdx(i)} style={{width:6,height:6,borderRadius:"50%",background:i===imgIdx?G:"#3A2A1A",cursor:_p,transition:"background 0.2s"}}/>
            ))}
          </div>
        )}
        {/* Change current photo */}
        <label style={{position:"absolute",bottom:8,right:8,background:"#0D0D0DAA",borderRadius:12,padding:"5px 10px",cursor:"pointer",display:"flex",alignItems:"center",gap:5,backdropFilter:"blur(4px)",border:`1px solid ${G}44`}}>
          <input type="file" accept="image/*" style={{display:"none"}} onChange={e=>{
            const file=e.target.files?.[0]; if(!file) return;
            const reader=new FileReader();
            reader.onload=ev=>{setAddingPhoto(false);setCropSrc(ev.target.result);};
            reader.readAsDataURL(file);
            e.target.value="";
          }}/>
          <span style={{fontSize:10}}>📷</span>
          <span style={{fontSize:8,fontWeight:600,color:G,letterSpacing:0.5}}>CHANGE</span>
        </label>
      </div>
      {/* ── Undo banner — shows when a previous version is available for current photo ── */}
      {allImages[imgIdx] && (undoHistory[imgIdx]||[]).length > 0 && (
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,marginBottom:8,padding:"8px 12px",borderRadius:10,background:"linear-gradient(135deg,#141008,#1A1408)",border:`1px solid ${G}33`}}>
          <div style={{display:"flex",alignItems:"center",gap:8,minWidth:0,flex:1}}>
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" style={{flexShrink:0}}>
              <path d="M2 5H9C11 5 12 6 12 8C12 10 11 11 9 11H6" stroke={G} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
              <path d="M4 3L2 5L4 7" stroke={G} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
            </svg>
            <div style={{minWidth:0}}>
              <div style={ss(9,600,G,{letterSpacing:0.5,lineHeight:1.2})}>Changed this photo?</div>
              <div style={ss(9,400,DM,{lineHeight:1.3,marginTop:1})}>{(undoHistory[imgIdx]||[]).length} previous version{(undoHistory[imgIdx]||[]).length>1?"s":""} saved</div>
            </div>
          </div>
          <button onClick={handleUndo}
            disabled={bgRemoving||modelRemoving}
            style={{flexShrink:0,padding:"6px 12px",borderRadius:8,background:`${G}22`,border:`1px solid ${G}66`,...ss(9,700,G,{letterSpacing:0.8}),cursor:(bgRemoving||modelRemoving)?"default":_p,opacity:(bgRemoving||modelRemoving)?0.4:1}}>
            UNDO
          </button>
        </div>
      )}
      {/* ── Photo cleanup tools (only when a photo exists) ── */}
      {allImages[imgIdx] && (
        <div style={{display:"flex",gap:6,marginBottom:10}}>
          {/* Re-crop */}
          <button onClick={()=>{setAddingPhoto(false);setCropSrc(allImages[imgIdx]);}}
            disabled={bgRemoving||modelRemoving}
            style={{flex:1,padding:"8px 6px",borderRadius:10,background:"#111",border:`1px solid ${G}22`,display:"flex",alignItems:"center",justifyContent:"center",gap:4,cursor:(bgRemoving||modelRemoving)?"default":_p,opacity:(bgRemoving||modelRemoving)?0.4:1}}>
            <span style={{fontSize:11,color:G,lineHeight:1}}>✂</span>
            <span style={ss(8,600,G,{letterSpacing:0.8})}>CROP</span>
          </button>
          {/* Remove Background */}
          <button onClick={handleRemoveBg}
            disabled={bgRemoving||modelRemoving}
            style={{flex:1,padding:"8px 6px",borderRadius:10,background:"#111",border:`1px solid ${G}22`,display:"flex",alignItems:"center",justifyContent:"center",gap:4,cursor:(bgRemoving||modelRemoving)?"default":_p,opacity:modelRemoving?0.4:1}}>
            {bgRemoving
              ? <><span style={{fontSize:10,color:G,animation:"spin 1.2s linear infinite",display:"inline-block",lineHeight:1}}>✦</span><span style={ss(8,600,G,{letterSpacing:0.5})}>Cleaning…</span></>
              : <><svg width="11" height="11" viewBox="0 0 14 14" fill="none"><rect x="1.5" y="1.5" width="11" height="11" rx="1.5" stroke={G} strokeWidth="1.2" strokeDasharray="1.5 1.2" fill="none"/><circle cx="7" cy="7" r="3" fill={G}/></svg><span style={ss(8,600,G,{letterSpacing:0.5})}>REMOVE BG</span></>
            }
          </button>
          {/* Remove Model */}
          <button onClick={handleRemoveModel}
            disabled={bgRemoving||modelRemoving}
            style={{flex:1,padding:"8px 6px",borderRadius:10,background:"#111",border:`1px solid ${G}22`,display:"flex",alignItems:"center",justifyContent:"center",gap:4,cursor:(bgRemoving||modelRemoving)?"default":_p,opacity:bgRemoving?0.4:1}}>
            {modelRemoving
              ? <><span style={{fontSize:10,color:G,animation:"spin 1.2s linear infinite",display:"inline-block",lineHeight:1}}>✦</span><span style={ss(8,600,G,{letterSpacing:0.5})}>Removing…</span></>
              : <><svg width="11" height="11" viewBox="0 0 14 14" fill="none"><path d="M7 1C7 1 4 2.5 4 6V10H10V6C10 2.5 7 1 7 1Z" stroke={G} strokeWidth="1.2" strokeLinejoin="round" fill="none"/><path d="M5 10L3 13H11L9 10" stroke={G} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" fill="none"/></svg><span style={ss(8,600,G,{letterSpacing:0.5})}>REMOVE MODEL</span></>
            }
          </button>
        </div>
      )}
      {/* Add another photo — max 4 */}
      {allImages.length < 4 && (
        <label style={{display:"flex",alignItems:"center",justifyContent:"center",gap:6,padding:"8px",borderRadius:12,background:"#111",border:`1px dashed ${G}44`,cursor:"pointer",marginBottom:12}}>
          <input type="file" accept="image/*" style={{display:"none"}} onChange={e=>{
            const file=e.target.files?.[0]; if(!file) return;
            const reader=new FileReader();
            reader.onload=ev=>{setAddingPhoto(true);setCropSrc(ev.target.result);};
            reader.readAsDataURL(file);
            e.target.value="";
          }}/>
          <span style={{fontSize:12,color:`${G}88`}}>+</span>
          <span style={ss(9,600,`${G}88`,{letterSpacing:1})}>ADD PHOTO {allImages.length>0?`(${allImages.length}/4)`:""}</span>
        </label>
      )}
      {/* Delete current photo if more than 1 */}
      {allImages.length>1&&(
        <button onClick={()=>{
          const newImages=allImages.filter((_,i)=>i!==imgIdx);
          setImgIdx(Math.max(0,imgIdx-1));
          saveImages(newImages);
          showToast("Photo removed \u2746");
        }} style={{display:"flex",alignItems:"center",justifyContent:"center",gap:6,width:"100%",padding:"6px",borderRadius:12,background:"none",border:"1px solid #2A1A1A",cursor:_p,marginBottom:12}}>
          <span style={ss(9,500,"#884444",{letterSpacing:0.5})}>✕ REMOVE THIS PHOTO</span>
        </button>
      )}
    </React.Fragment>
  );
}

// ── CLOSET ───────────────────────────────────────────────────────────────────
function ClosetTab({items,setItems,setSelectedItem,showToast,wishlist,setWishlist,addToWishlist,removeFromWishlist,onSaveItem,onDeleteItem,onboardStep=4,advanceOnboard,externalShowAdd,onExternalShowAddHandled,closetError,onRetryCloset,setTab,onMilestone}){
  const [closetView,setClosetView]=useState("closet"); // "closet" | "wishlist"
  const [filterCat,setFilterCat]=useState("All");
  const [filterTag,setFilterTag]=useState(null); // tag subcategory filter
  const [filterSale,setFilterSale]=useState(false);
  const [sortBy,setSortBy]=useState("date_new");
  const [closetSearch,setClosetSearch]=useState("");
  const [showFilterMenu,setShowFilterMenu]=useState(false);
  const [showSortExpanded,setShowSortExpanded]=useState(false);
  const [showCatExpanded,setShowCatExpanded]=useState(false);
  const [addStep,setAddStep]     = useState(null);
  useEffect(()=>{
    if(externalShowAdd){
      const resumeStep = drafts.some(d=>d.status==='ready') ? 2 : 1;
      setAddStep(resumeStep);
      try{
        const scrollY = window.scrollY || document.documentElement.scrollTop;
        document.body.style.top = `-${scrollY}px`;
        document.body.style.position = 'fixed';
        document.body.style.width = '100%';
        document.body.style.overflow = 'hidden';
        document.body.dataset.scrollY = scrollY;
      }catch(e){}
      if(onExternalShowAddHandled) onExternalShowAddHandled();
    }
  },[externalShowAdd]);

  // Closet inactivity nudge — show if >7 days since last item added and not dismissed
  const [inactivityDismissed, setInactivityDismissed] = useState(()=>{
    try{
      const d = localStorage.getItem("outfix_closet_nudge_dismissed");
      if(!d) return false;
      return (Date.now() - parseInt(d)) < 14*24*60*60*1000; // re-shows after 14 days
    }catch(e){ return false; }
  });
  const dismissInactivityNudge = () => {
    setInactivityDismissed(true);
    try{ localStorage.setItem("outfix_closet_nudge_dismissed", String(Date.now())); }catch(e){}
  };
  const daysSinceLastItem = (()=>{
    if(!items.length) return null;
    const latest = Math.max(...items.map(i=>typeof i.id==="number"?i.id:Date.parse(i.purchaseDate)||0));
    if(!latest) return null;
    return Math.floor((Date.now() - latest) / (1000*60*60*24));
  })();
  const showInactivityNudge = !inactivityDismissed && items.length > 0 && daysSinceLastItem !== null && daysSinceLastItem > 7;
  const [selectedClosetItem,setSelectedClosetItem]=useState(null);
  const [selectedWishItem,setSelectedWishItem]=useState(null);
  const [wishCropSrc,setWishCropSrc]=useState(null);
  const wishPhotoRef=useRef();
  const [showReverseSearch,setShowReverseSearch]=useState(false);
  const [url,setUrl]=useState("");
  const [scanning,setScanning]=useState(false);
  const [scanStage,setScanStage]=useState(""); // progress message during URL scan
  const [favorites,setFavorites]=useState(new Set([1,9]));
  const [scanCropSrc,setScanCropSrc]=useState(null);
  const [scanCropConfirm,setScanCropConfirm]=useState(true);
  const [scanCropBgRemove,setScanCropBgRemove]=useState(false); // true = remove bg after crop
  const [priceOverride,setPriceOverride]=useState("");
  const fileRef=useRef();
  const manualFileRef=useRef();
  const addFlowRef=useRef();
  const photoOverrideRef=useRef();
  const cats=["All","Favorites","Tops","Bottoms","Dresses","Outerwear","Shoes","Accessories"];
  const filtered=(()=>{
    let base = filterCat==="All" ? items
      : filterCat==="Favorites" ? items.filter(i=>favorites.has(i.id))
      : items.filter(i=>i.category===filterCat);
    if(filterSale) base=base.filter(i=>i.forSale);
    if(filterTag) base=base.filter(i=>(i.tags||[]).map(t=>t.toLowerCase()).includes(filterTag.toLowerCase()));
    if(closetSearch.trim()){
      const q=closetSearch.toLowerCase();
      base=base.filter(i=>
        i.name.toLowerCase().includes(q)||
        i.brand.toLowerCase().includes(q)||
        i.category.toLowerCase().includes(q)||
        (i.tags||[]).some(t=>t.toLowerCase().includes(q))
      );
    }
    if(sortBy==="worn_desc")      base=[...base].sort((a,b)=>b.wearCount-a.wearCount);
    else if(sortBy==="worn_asc")  base=[...base].sort((a,b)=>a.wearCount-b.wearCount);
    else if(sortBy==="price_asc") base=[...base].sort((a,b)=>a.price-b.price);
    else if(sortBy==="price_desc")base=[...base].sort((a,b)=>b.price-a.price);
    else if(sortBy==="date_new")  base=[...base].sort((a,b)=>b.id-a.id);
    else if(sortBy==="date_old")  base=[...base].sort((a,b)=>a.id-b.id);
    return base;
  })();
  const isFiltered = filterCat!=="All" || filterTag || filterSale || sortBy!=="date_new" || closetSearch.trim()!=="";
  const clearFilters=()=>{setFilterCat("All");setFilterTag(null);setFilterSale(false);setSortBy("date_new");setClosetSearch("");};

  const toggleFav=(e,id)=>{
    e.stopPropagation();
    setFavorites(prev=>{
      const n=new Set(prev);
      if(n.has(id)){n.delete(id);showToast("Removed from favorites \u2746");}
      else{n.add(id);showToast("Added to favorites \u2746");}
      return n;
    });
  };



  const [drafts,setDrafts]         = useState(()=>{
    // Restore drafts from localStorage on mount (excluding photos to save space)
    try{
      const saved = localStorage.getItem('outfix_drafts');
      if(saved){
        const parsed = JSON.parse(saved);
        // Only restore ready drafts — processing ones lost their async context
        return parsed.filter(d=>d.status==='ready').map(d=>({...d,photo:null,processedPhoto:null}));
      }
    }catch(e){}
    return [];
  });
  const [reviewIdx,setReviewIdx]   = useState(0);
  const [addUrlMode,setAddUrlMode] = useState(false);
  const [addUrl,setAddUrl]         = useState('');
  const [clipboardUrl,setClipboardUrl] = useState(null); // detected URL from clipboard
  const [cropDraftId,setCropDraftId]         = useState(null);
  const [cropSrcNew,setCropSrcNew]           = useState(null);
  const [cropBgRemoveNew,setCropBgRemoveNew] = useState(false);
  const [extractingModel,setExtractingModel] = useState(null); // draft.id | null

  // Clipboard URL detection — fires when Step 1 opens
  useEffect(()=>{
    if(addStep!==1){ setClipboardUrl(null); return; }
    if(!navigator?.clipboard?.readText) return;
    navigator.clipboard.readText().then(text=>{
      const trimmed=(text||'').trim();
      if(/^https?:\/\/[^\s]{5,}/.test(trimmed)&&trimmed.length<500) setClipboardUrl(trimmed);
      else setClipboardUrl(null);
    }).catch(()=>setClipboardUrl(null));
  },[addStep]);

  // Persist drafts to localStorage whenever they change
  useEffect(()=>{
    try{
      if(drafts.length===0){ localStorage.removeItem('outfix_drafts'); return; }
      // Save only ready drafts, strip photos (too large for localStorage)
      const toSave = drafts.filter(d=>d.status==='ready').map(d=>({
        ...d, photo:null, processedPhoto:null
      }));
      if(toSave.length) localStorage.setItem('outfix_drafts', JSON.stringify(toSave));
      else localStorage.removeItem('outfix_drafts');
    }catch(e){}
  },[drafts]);

  // Expose draft count and addStep setter to App level for FAB
  useEffect(()=>{
    window.__outfix_draftCount = drafts.filter(d=>d.status==='ready').length;
    window.__outfix_setAddStep = setAddStep;
  },[drafts]);

  const openAdd   = () => {
    // If ready drafts exist, resume at queue (step 2) not entry (step 1)
    const resumeStep = drafts.some(d=>d.status==='ready') ? 2 : 1;
    setAddStep(resumeStep);
    try{
      const scrollY = window.scrollY || document.documentElement.scrollTop;
      document.body.style.top = `-${scrollY}px`;
      document.body.style.position = 'fixed';
      document.body.style.width = '100%';
      document.body.style.overflow = 'hidden';
      document.body.dataset.scrollY = scrollY;
    }catch(e){}
  };
  const closeAdd2 = () => {
    setAddStep(null); setAddUrl(''); setAddUrlMode(false); setCropSrcNew(null); setCropDraftId(null);
    try{
      // Restore scroll position precisely
      const scrollY = parseInt(document.body.dataset.scrollY || '0');
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.width = '';
      document.body.style.overflow = '';
      window.scrollTo(0, scrollY);
    }catch(e){}
  };

  // Non-passive touchmove listener on add flow — React synthetic events can't call preventDefault reliably
  useEffect(()=>{
    const el = addFlowRef.current;
    if(!el || !addStep) return;
    const handler = (e) => {
      // Allow scroll inside data-scroll containers, block everything else
      if(e.target.closest('[data-scroll]')) return;
      e.preventDefault();
    };
    el.addEventListener('touchmove', handler, {passive:false});
    return () => el.removeEventListener('touchmove', handler);
  }, [addStep]);

  const addPhotoToDraft = (dataUrl) => {
    const id = `d_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;
    const blank = {id,status:'processing',photo:dataUrl,processedPhoto:null,stockImage:null,stage:'Reading your photo\u2026',ai:{name:'',brand:'',category:null,color:'#2A2A2A',price:0,condition:'Good',emoji:'\u{1F457}',tags:[]},userEdits:{}};
    setDrafts(p=>[...p,blank]);
    setAddStep(2);
    (async()=>{
      let identified = false;
      let hasModel = false;
      // ── Step 1: Identify the item + detect if a model is wearing it ──
      try{
        const b64 = dataUrl.split(',')[1];
        const mimeType = dataUrl.split(';')[0].split(':')[1] || 'image/jpeg';
        setDrafts(p=>p.map(d=>d.id===id?{...d,stage:'Identifying item\u2026'}:d));
        const res = await fetch('/api/analyze-photo',{
          method:'POST', headers:{'Content-Type':'application/json'},
          body:JSON.stringify({imageBase64:b64, mimeType}),
        });
        if(!res.ok) throw new Error('analyze-photo failed');
        const json = await res.json();
        // Backend may or may not include hasModel — fall back to Vision classification below if absent
        if(typeof json.hasModel === 'boolean') hasModel = json.hasModel;
        setDrafts(p=>p.map(d=>d.id===id?{...d,ai:{...d.ai,...json}}:d));
        identified = true;
      }catch(e){
        try{
          const b64 = dataUrl.split(',')[1];
          setDrafts(p=>p.map(d=>d.id===id?{...d,stage:'Identifying item\u2026'}:d));
          const raw = await callClaudeVision(b64,'image/jpeg','Identify this clothing item. Also determine if a person/model is wearing or holding the item vs a flatlay/product-only shot. Return ONLY JSON: {"name":"...","brand":"...","category":"Tops|Bottoms|Dresses|Outerwear|Shoes|Accessories","color":"#hexcode","price":0,"condition":"Good","emoji":"\u{1F457}","tags":[],"hasModel":true}');
          const json = JSON.parse(raw.replace(/```json|```/g,'').trim());
          if(typeof json.hasModel === 'boolean') hasModel = json.hasModel;
          setDrafts(p=>p.map(d=>d.id===id?{...d,ai:{...d.ai,...json}}:d));
          identified = true;
        }catch(e2){}
      }

      // ── Step 2a: If no model detection from step 1, run a quick dedicated vision classifier ──
      if(identified && typeof hasModel !== 'boolean') {
        try {
          const b64 = dataUrl.split(',')[1];
          const raw = await callClaudeVision(
            b64, 'image/jpeg',
            'Is there a person (model, mannequin, or human) wearing or holding the clothing item in this image? Ignore faces in the background — only count if the person is displaying the item. Answer with ONLY one word: YES or NO.'
          );
          hasModel = /yes/i.test(raw.trim().slice(0,4));
        } catch(e) { /* silent — default hasModel=false → regular bg removal */ }
      }

      // ── Step 2b: Clean up the image ──
      // Branching: if a model is wearing it → extract garment (OpenAI gpt-image-1, strips the human)
      //            if it's already a flatlay → plain background removal (faster, cheaper)
      try{
        if(hasModel){
          setDrafts(p=>p.map(d=>d.id===id?{...d,stage:'Removing model\u2026'}:d));
          const cleanUrl = await extractGarment(dataUrl);
          if(cleanUrl){
            setDrafts(p=>p.map(d=>d.id===id?{...d,processedPhoto:cleanUrl,photo:cleanUrl}:d));
          }
        } else {
          setDrafts(p=>p.map(d=>d.id===id?{...d,stage:'Cleaning up image\u2026'}:d));
          const b64 = dataUrl.split(',')[1];
          const res = await fetch('/api/remove-bg',{
            method:'POST', headers:{'Content-Type':'application/json'},
            body:JSON.stringify({imageBase64:b64}),
          });
          if(res.ok){
            const bgData = await res.json();
            const cleanB64 = bgData.imageBase64 || null;
            if(cleanB64){
              const cleanUrl = `data:image/png;base64,${cleanB64}`;
              setDrafts(p=>p.map(d=>d.id===id?{...d,processedPhoto:cleanUrl,photo:cleanUrl}:d));
            }
          }
        }
      }catch(e){ /* cleanup is best-effort — silent fail */ }
      // ── Mark ready ──
      setDrafts(p=>p.map(d=>d.id===id?{...d,status:'ready',stage:''}:d));
      // ── Auto-advance: if this is the only draft, skip queue and go to review ──
      setDrafts(current=>{
        const active = current.filter(d=>d.status!=='confirmed');
        if(active.length===1){
          setReviewIdx(0);
          setAddStep(3);
        }
        return current;
      });
    })();
  };

  const addUrlToDraft = (url) => {
    const id = `d_${Date.now()}`;
    const blank = {id,status:'processing',photo:null,processedPhoto:null,stockImage:null,stage:'Fetching product page\u2026',ai:{name:'',brand:'',category:null,color:'#2A2A2A',price:0,condition:'Like New',emoji:'\uD83D\uDC57',tags:[]},userEdits:{},_url:url};
    setDrafts(p=>[...p,blank]);
    setAddStep(2);
    (async()=>{
      try{
        setDrafts(p=>p.map(d=>d.id===id?{...d,stage:'Fetching product page\u2026'}:d));
        const res = await fetch('/api/scrape-product',{
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({url}),
        });
        if(!res.ok) throw new Error('scrape-product failed');
        const json = await res.json();
        const stockImage = json.image || null;
        setDrafts(p=>p.map(d=>d.id===id?{...d,status:'ready',stage:'',ai:{...d.ai,...json},stockImage}:d));
      }catch(e){
        try{
          const urlObj = new URL(url);
          const slug = urlObj.pathname.split('/').filter(Boolean).join(' ').replace(/-/g,' ');
          const domain = urlObj.hostname.replace('www.','').replace('.com','').replace('.co','');
          setDrafts(p=>p.map(d=>d.id===id?{...d,stage:'Identifying item\u2026'}:d));
          const raw = await callClaude(`Clothing item from URL: "${url}" Domain: ${domain} Path: "${slug}". Return ONLY JSON: {"name":"...","brand":"...","category":"Tops|Bottoms|Dresses|Outerwear|Shoes|Accessories","color":"#2A2A2A","price":0,"condition":"Like New","tags":[]}`);
          const json = JSON.parse(raw.replace(/```json|```/g,'').trim());
          setDrafts(p=>p.map(d=>d.id===id?{...d,status:'ready',stage:'',ai:{...d.ai,...json}}:d));
        }catch(e2){
          setDrafts(p=>p.map(d=>d.id===id?{...d,status:'ready',stage:''}:d));
        }
      }
    })();
  };

    const getDV = (draft,f) => draft.userEdits[f]!==undefined ? draft.userEdits[f] : draft.ai[f];
  const setDF = (id,f,v) => setDrafts(p=>p.map(d=>d.id===id?{...d,userEdits:{...d.userEdits,[f]:v}}:d));

  const confirmDraft = (draft) => {
    const get = f => getDV(draft,f);
    const cat = get('category'); // null if not selected — blocked below
    const emojiMap = {Tops:'\uD83D\uDC5A',Bottoms:'\uD83D\uDC56',Dresses:'\uD83D\uDC57',Outerwear:'\uD83E\uDDE5',Shoes:'\uD83D\uDC5F',Accessories:'\u2728'};
    const emoji = emojiMap[cat]||'\uD83D\uDC57';
    const item = {
      id:Date.now(), name:get('name')||'Untitled', brand:get('brand')||'Unknown',
      category:cat, color:get('color')||'#2A2A2A', price:parseInt(get('price'))||0,
      condition:get('condition')||'Good', emoji, tags:get('tags')||[],
      wearCount:0, lastWorn:'Never', purchaseDate:'', forSale:false, size:'',
      sourceImage: draft.processedPhoto||draft.stockImage||draft.photo||null,
    };
    setItems(prev=>{ const next=[...prev,item]; if(onMilestone) onMilestone(next.length); return next; });
    if(onSaveItem) onSaveItem(item,true);
    showToast(item.name+' added to your closet \u2746');

    // ── Lightweight duplicate check against existing closet ──
    // Gate: only run when closet has enough items to minimize false positives
    if(items.length + 1 >= MIN_ITEMS_FOR_DUPE_CHECK){
      setTimeout(()=>{
        try{
          const dupes = keywordFallbackDupes([item, ...items.filter(i=>i.category===item.category)]);
          if(dupes.length > 0){
            const match = dupes[0].items.find(i=>String(i.id)!==String(item.id));
            if(match) showToast(`Similar to "${match.name}" already in your closet — check Vault`);
          }
        }catch(e){}
      }, 1800); // delay so the "added" toast shows first
    }

    const remaining = drafts.filter(d=>d.id!==draft.id);
    setDrafts(remaining);
    if(!remaining.some(d=>d.status==='ready')) closeAdd2();
    else setReviewIdx(i=>Math.min(i, remaining.filter(d=>d.status==='ready').length-1));
  };

  const skipDraft = (id) => {
    const remaining = drafts.filter(d=>d.id!==id);
    setDrafts(remaining);
    if(!remaining.some(d=>d.status==='ready')) closeAdd2();
    else setReviewIdx(i=>Math.min(i, remaining.filter(d=>d.status==='ready').length-1));
  };


  return(
    <div className="fu" style={{padding:"16px 24px",paddingBottom:96,position:"relative"}}>
      <style>{`
        @keyframes wave{from{height:6px;opacity:0.4;}to{height:28px;opacity:1;}}
        @keyframes spin{from{transform:rotate(0deg);}to{transform:rotate(360deg);}}
      `}</style>

      {/* ── CLOSET LOAD ERROR ── */}
      {closetError && items.length === 0 && (
        <div style={{textAlign:"center",padding:"60px 16px",display:"flex",flexDirection:"column",alignItems:"center",gap:12}}>
          <div style={{fontSize:36,marginBottom:4}}>⚡</div>
          <div style={sr(18,400,"#E8E0D4")}>Couldn't load your closet.</div>
          <div style={ss(11,400,DM,{lineHeight:1.6,maxWidth:260})}>Check your connection — your items are safe.</div>
          <button onClick={onRetryCloset} style={{marginTop:8,padding:"10px 24px",borderRadius:R18,background:`${G}22`,border:`1px solid ${G}44`,...ss(9,600,G,{letterSpacing:1}),cursor:_p}}>RETRY</button>
        </div>
      )}

      {/* ── CLOSET INACTIVITY NUDGE ── */}
      {showInactivityNudge && closetView==="closet" && (
        <div style={{background:"linear-gradient(135deg,#141008,#1A1610)",border:`1px solid ${G}33`,borderLeft:`3px solid ${G}55`,borderRadius:R14,padding:"12px 14px",marginBottom:14,display:"flex",alignItems:"center",gap:12}}>
          <div style={{fontSize:24,flexShrink:0}}>🛍</div>
          <div style={{flex:1}}>
            <div style={ss(10,600,MD,{letterSpacing:0.5,marginBottom:2})}>Been shopping lately?</div>
            <div style={ss(10,400,DM,{lineHeight:1.5})}>Add your new pieces to keep your closet up to date.</div>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:5,flexShrink:0,alignItems:"flex-end"}}>
            <button onClick={()=>setAddStep(1)} style={{padding:"7px 14px",borderRadius:R18,background:`${G}22`,border:`1px solid ${G}44`,...ss(9,600,G,{letterSpacing:1}),cursor:_p,whiteSpace:"nowrap"}}>ADD ITEM</button>
            <button onClick={dismissInactivityNudge} style={{background:"none",border:"none",cursor:_p,...ss(9,400,DM),padding:0}}>dismiss</button>
          </div>
        </div>
      )}

      {/* ── ONBOARDING STEP 1 BANNER ── */}
      {onboardStep===1&&closetView==="closet"&&(()=>{
        const hasTop=items.some(i=>["Tops","Dresses"].includes(i.category));
        const hasBottom=items.some(i=>["Bottoms","Dresses"].includes(i.category));
        const hasShoes=items.some(i=>["Shoes"].includes(i.category));
        const slots=[{label:"Top",emoji:"👚",done:hasTop},{label:"Bottom",emoji:"👖",done:hasBottom},{label:"Shoes",emoji:"👟",done:hasShoes}];
        const allDone=hasTop&&hasBottom&&hasShoes;
        if(allDone&&advanceOnboard) advanceOnboard(2);
        return(
          <div style={{background:"linear-gradient(135deg,#1A1610,#141008)",border:`1px solid ${G}44`,borderRadius:R14,padding:"14px 16px",marginBottom:16}}>
            <div style={{..._row,gap:8,marginBottom:10}}>
              <span style={{fontSize:14}}>✦</span>
              <div style={ss(10,700,G,{letterSpacing:1})}>STEP 1 OF 3 — BUILD YOUR CLOSET</div>
            </div>
            <div style={ss(11,400,"#A09080",{marginBottom:12,lineHeight:1.5})}>Add a top, bottom, and shoes to build your first outfit</div>
            <div style={{display:"flex",gap:10}}>
              {slots.map(s=>(
                <div key={s.label} style={{flex:1,background:s.done?`${G}18`:"#111",borderRadius:12,padding:"8px 4px",textAlign:"center",border:s.done?`1px solid ${G}44`:"1px solid #2A2A2A",transition:"all 0.3s"}}>
                  <div style={{fontSize:18,marginBottom:3}}>{s.done?"✓":s.emoji}</div>
                  <div style={ss(8,s.done?600:400,s.done?G:DM,{letterSpacing:0.5})}>{s.label}</div>
                </div>
              ))}
            </div>
            {allDone&&<div style={{marginTop:10,...ss(9,600,G,{textAlign:"center",letterSpacing:1})}}>✦ Ready to build your first outfit!</div>}
          </div>
        );
      })()}

      {/* Header — title + Closet/Wishlist toggle on same row */}
      <div style={{..._btwn,marginBottom:14}}>
        <div style={{minWidth:0,flex:1}}>
          <div style={sr(22,300)}>{closetView==="closet"?"My Closet":"Wishlist"}</div>
          <div style={ss(10,400,DM,{letterSpacing:1,marginTop:2})}>
            {closetView==="closet"
              ? isFiltered
                ? `${filtered.length} OF ${items.length} PIECES SHOWN`
                : `${items.length} PIECES`
              : `${wishlist.length} SAVED ITEMS`}
          </div>
        </div>
        <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:6,flexShrink:0}}>
          {/* Closet / Wishlist toggle */}
          <div style={{display:"flex",background:"#111",borderRadius:R18,overflow:"hidden",border:"1px solid #1E1E1E"}}>
            {[["closet","My Closet"],["wishlist","♡ Wishlist"]].map(([k,l])=>(
              <button key={k} onClick={()=>setClosetView(k)} style={{padding:"7px 14px",background:closetView===k?`linear-gradient(135deg,${G},#8A6E54)`:"transparent",border:"none",cursor:_p,...ss(9,closetView===k?600:400,closetView===k?BK:DM,{letterSpacing:0.3,whiteSpace:"nowrap"})}}>
                {l}
              </button>
            ))}
          </div>
          {closetView==="closet" && isFiltered && (
            <button onClick={clearFilters} style={{padding:"3px 10px",borderRadius:R18,background:"#2A1A1A",border:"1px solid #4A2A2A",...ss(8,600,"#C09090",{letterSpacing:1}),cursor:_p}}>× CLEAR</button>
          )}
        </div>
      </div>

      {/* ── VALUE STAT STRIP — only when viewing full closet with items ── */}
      {closetView==="closet" && items.length > 0 && !isFiltered && (()=>{
        const totalValue = items.reduce((s,i)=>s+(i.price||0),0);
        const totalResale = items.reduce((s,i)=>s+calcResale(i),0);
        return(
          <div style={{display:"flex",gap:8,marginBottom:14}}>
            <div style={{flex:1,background:"linear-gradient(135deg,#1A1610,#1E1A12)",borderRadius:R14,padding:"12px 14px",border:`1px solid ${G}33`}}>
              <div style={ss(8,600,DM,{letterSpacing:1.5,marginBottom:4})}>CLOSET VALUE</div>
              <div style={{display:"flex",alignItems:"baseline",gap:4}}>
                <div style={sr(26,300,G)}>${totalValue.toLocaleString()}</div>
              </div>
            </div>
            <div style={{flex:1,background:"linear-gradient(135deg,#121A12,#141E14)",borderRadius:R14,padding:"12px 14px",border:"1px solid #2A4A2A33"}}>
              <div style={ss(8,600,DM,{letterSpacing:1.5,marginBottom:4})}>EST. RESALE</div>
              <div style={{display:"flex",alignItems:"baseline",gap:4}}>
                <div style={sr(26,300,"#80C880")}>${totalResale.toLocaleString()}</div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── WISHLIST VIEW ── */}
      {closetView==="wishlist"&&(
        <React.Fragment>
          <div onClick={()=>setShowReverseSearch(true)} style={{background:"linear-gradient(135deg,#1A160F,#141008)",borderRadius:R14,padding:"14px 18px",border:`1px solid ${G}44`,marginBottom:14,cursor:_p,display:"flex",gap:14,alignItems:"center"}}>
            <div style={{width:40,height:40,borderRadius:12,background:`${G}22`,border:`1px solid ${G}44`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0}}>+</div>
            <div style={{flex:1}}>
              <div style={sr(14,500,G)}>Add to Wishlist</div>
              <div style={ss(9,400,DM,{marginTop:2,lineHeight:1.4})}>Photo · URL · Describe · Manual</div>
            </div>
            <div style={{...ss(16,400,G),flexShrink:0}}>→</div>
          </div>
          {wishlist.length===0&&<div style={sr(14,300,"#3A3028",{fontStyle:"italic",textAlign:"center",padding:"24px 0"})}>Your wishlist is empty.<br/>Save items from the feed or Market.</div>}
          {wishlist.length>0&&(
            <React.Fragment>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:14}}>
                {wishlist.map(item=>(
                  <div key={item.id} className="ch" onClick={()=>setSelectedWishItem(item)} style={{background:CD,borderRadius:R14,overflow:"hidden",border:`1px solid ${BR}`,position:"relative",cursor:_p}}>
                    {/* Image area */}
                    <div style={{height:120,background:`linear-gradient(135deg,${item.color||G}22,${item.color||G}44)`,display:"flex",alignItems:"center",justifyContent:"center",position:"relative",overflow:"hidden"}}>
                      {item.sourceImage
                        ?<img src={item.sourceImage} style={{width:"100%",height:"100%",objectFit:"cover"}} alt={item.name}/>
                        :<ItemIllustration item={item} size={80}/>
                      }
                      {item.inMarket&&<div style={{position:"absolute",top:8,right:8,background:"#1A3A1A",border:"1px solid #2A5A2A",borderRadius:8,padding:"2px 7px",...ss(8,700,"#80C880",{letterSpacing:0.8})}}>IN MARKET</div>}
                      {item.sourceUrl&&!item.inMarket&&<div style={{position:"absolute",top:8,right:8,background:"#0D0D0DCC",borderRadius:8,padding:"2px 7px",backdropFilter:"blur(4px)",...ss(8,600,G,{letterSpacing:0.5})}}>🔗 URL</div>}
                    </div>
                    {/* Info */}
                    <div style={{padding:"10px 12px 12px"}}>
                      <div style={sr(14,500,"#E8E0D4",{lineHeight:1.2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"})}>{item.name}</div>
                      <div style={{..._row,gap:5,marginTop:3}}>
                        <div style={{width:8,height:8,borderRadius:"50%",background:item.color||G,border:"1px solid #FFFFFF22",flexShrink:0}}/>
                        <div style={ss(9,400,DM,{letterSpacing:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"})}>{item.brand}</div>
                      </div>
                      <div style={{..._btwn,marginTop:6}}>
                        <div style={sr(13,400,G)}>from ${item.price}</div>
                        <div style={ss(8,400,DM,{fontStyle:"italic",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:60})}>{item.gap}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <Btn onClick={()=>showToast("Market launches soon — we'll notify you \u2746")} full>FIND IN MARKET · COMING SOON</Btn>
            </React.Fragment>
          )}
        </React.Fragment>
      )}

      {/* ── CLOSET VIEW ── */}
      {closetView==="closet"&&(<React.Fragment>

      <div style={{marginBottom:12}}>
        {/* Search bar + filter hamburger */}
        <div style={{..._row,gap:8,marginBottom:10}}>
          <div style={{..._row,gap:10,flex:1,background:CD,border:`1px solid ${closetSearch?G+"66":BR}`,borderRadius:12,padding:"8px 14px",cursor:"text"}}
            onClick={()=>document.getElementById("closet-search-input").focus()}>
            <span style={{fontSize:13,opacity:0.35}}>🔍</span>
            <input
              id="closet-search-input"
              value={closetSearch}
              onChange={e=>setClosetSearch(e.target.value)}
              placeholder="Search by name, brand, category…"
              style={{flex:1,background:"none",border:"none",outline:"none",...ss(11,400,closetSearch?MD:DM),color:"#C0B8B0"}}
            />
            {closetSearch&&<button onClick={()=>setClosetSearch("")} style={{background:"none",border:"none",cursor:_p,...ss(12,400,DM)}}>✕</button>}
          </div>
          {/* Hamburger filter button */}
          <button onClick={()=>setShowFilterMenu(v=>!v)} style={{
            width:42,height:42,borderRadius:12,flexShrink:0,cursor:_p,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:4,
            background:showFilterMenu||isFiltered?`${G}22`:CD,
            border:showFilterMenu||isFiltered?`1.5px solid ${G}`:_2a,
          }}>
            <div style={{width:16,height:1.5,borderRadius:1,background:isFiltered?G:MD}}/>
            <div style={{width:12,height:1.5,borderRadius:1,background:isFiltered?G:MD}}/>
            <div style={{width:8,height:1.5,borderRadius:1,background:isFiltered?G:MD}}/>
          </button>
        </div>

        {/* Tag filter pills — derived from pieces in closet */}
        {(()=>{
          const allTags=[...new Set(items.flatMap(i=>i.tags||[]).map(t=>t.toLowerCase()))].filter(Boolean).sort();
          if(!allTags.length) return null;
          return(
            <div className="sc" style={{display:"flex",gap:6,overflowX:"auto",marginBottom:10,paddingBottom:2}}>
              {allTags.map(tag=>{
                const active=filterTag===tag;
                return(
                  <button key={tag} onClick={()=>setFilterTag(active?null:tag)}
                    style={{flexShrink:0,padding:"4px 10px",borderRadius:R18,cursor:_p,
                      background:active?`${G}22`:"#111",
                      border:active?`1.5px solid ${G}`:"1px solid #2A2A2A",
                      ...ss(8,active?600:400,active?G:DM,{letterSpacing:0.3,whiteSpace:"nowrap"})}}>
                    #{tag}
                  </button>
                );
              })}
            </div>
          );
        })()}

        {/* Filter dropdown panel */}
        {showFilterMenu&&(
          <div style={{background:"#0F0F0F",borderRadius:R14,border:_2a,padding:"16px",marginBottom:12}}>
            {/* Category — iOS action sheet style */}
            <div style={{marginBottom:14}}>
              <button onClick={()=>setShowCatExpanded(true)} style={{
                width:"100%",display:"flex",alignItems:"center",justifyContent:"space-between",
                padding:"12px 14px",borderRadius:12,cursor:_p,
                background:filterCat!=="All"?`${G}18`:"#141414",
                border:filterCat!=="All"?`1.5px solid ${G}44`:"1px solid #2A2A2A",
              }}>
                <div style={{..._row,gap:8}}>
                  <div style={ss(8,600,DM,{letterSpacing:1.5})}>CATEGORY</div>
                  <div style={ss(10,500,filterCat!=="All"?G:MD)}>{filterCat}</div>
                </div>
                <div style={ss(10,400,DM)}>›</div>
              </button>
            </div>

            {/* iOS action sheet for category */}
            {showCatExpanded&&(
              <div onClick={()=>setShowCatExpanded(false)} style={{..._fix,inset:0,background:"#000000AA",zIndex:200,display:"flex",flexDirection:"column",justifyContent:"flex-start",padding:"80px 8px 8px"}}>
                <div onClick={e=>e.stopPropagation()}>
                  <div style={{background:"#2C2C2E",borderRadius:R14,overflow:"hidden",marginBottom:8}}>
                    <div style={{padding:"12px 16px 8px",textAlign:"center"}}>
                      <div style={ss(13,500,"#8E8E93")}>Category</div>
                    </div>
                    {cats.map((c,i)=>(
                      <div key={c}>
                        {i>0&&<div style={{height:1,background:"#3A3A3C",marginLeft:16}}/>}
                        <button onClick={()=>{setFilterCat(c);setShowCatExpanded(false);}} style={{
                          width:"100%",padding:"14px 16px",background:"none",border:"none",
                          display:"flex",alignItems:"center",justifyContent:"space-between",
                          cursor:_p,
                        }}>
                          <span style={{...ss(17,filterCat===c?500:400,"#FFFFFF"),fontFamily:"system-ui,-apple-system,sans-serif"}}>{c}</span>
                          {filterCat===c&&<span style={{color:"#C4A882",fontSize:18,fontWeight:500}}>✓</span>}
                        </button>
                      </div>
                    ))}
                  </div>
                  <button onClick={()=>setShowCatExpanded(false)} style={{
                    width:"100%",padding:"16px",borderRadius:R14,background:"#2C2C2E",border:"none",cursor:_p,
                  }}>
                    <span style={{...ss(17,600,"#C4A882"),fontFamily:"system-ui,-apple-system,sans-serif"}}>Cancel</span>
                  </button>
                </div>
              </div>
            )}

            {/* Sort — iOS action sheet style */}
            <div style={{marginBottom:14}}>
              <button onClick={()=>setShowSortExpanded(true)} style={{
                width:"100%",display:"flex",alignItems:"center",justifyContent:"space-between",
                padding:"12px 14px",borderRadius:12,cursor:_p,
                background:sortBy!=="default"?`${G}18`:"#141414",
                border:sortBy!=="default"?`1.5px solid ${G}44`:"1px solid #2A2A2A",
              }}>
                <div style={{..._row,gap:8}}>
                  <div style={ss(8,600,DM,{letterSpacing:1.5})}>SORT BY</div>
                  <div style={ss(10,500,sortBy!=="default"?G:MD)}>
                    {{"date_new":"Date: Newest → Oldest","date_old":"Date: Oldest → Newest","worn_desc":"Worn: Most → Least","worn_asc":"Worn: Least → Most","price_desc":"Price: High → Low","price_asc":"Price: Low → High"}[sortBy]||"Date: Newest → Oldest"}
                  </div>
                </div>
                <div style={ss(10,400,DM)}>›</div>
              </button>
            </div>

            {/* iOS action sheet for sort — renders outside filter panel */}
            {showSortExpanded&&(
              <div onClick={()=>setShowSortExpanded(false)} style={{..._fix,inset:0,background:"#000000AA",zIndex:200,display:"flex",flexDirection:"column",justifyContent:"flex-start",padding:"80px 8px 8px"}}>
                <div onClick={e=>e.stopPropagation()}>
                  {/* Options group */}
                  <div style={{background:"#2C2C2E",borderRadius:R14,overflow:"hidden",marginBottom:8}}>
                    <div style={{padding:"12px 16px 8px",textAlign:"center"}}>
                      <div style={ss(13,500,"#8E8E93")}>Sort By</div>
                    </div>
                    {[
                      ["date_new","Date Added: Newest → Oldest"],
                      ["date_old","Date Added: Oldest → Newest"],
                      ["worn_desc","Worn: Most → Least"],
                      ["worn_asc","Worn: Least → Most"],
                      ["price_desc","Price: High → Low"],
                      ["price_asc","Price: Low → High"],
                    ].map(([val,label],i,arr)=>(
                      <div key={val}>
                        {i>0&&<div style={{height:1,background:"#3A3A3C",marginLeft:16}}/>}
                        <button onClick={()=>{setSortBy(val);setShowSortExpanded(false);}} style={{
                          width:"100%",padding:"14px 16px",background:"none",border:"none",
                          display:"flex",alignItems:"center",justifyContent:"space-between",
                          cursor:_p,
                        }}>
                          <span style={{...ss(17,sortBy===val?500:400,"#FFFFFF"),fontFamily:"system-ui,-apple-system,sans-serif"}}>{label}</span>
                          {sortBy===val&&<span style={{color:"#C4A882",fontSize:18,fontWeight:500}}>✓</span>}
                        </button>
                      </div>
                    ))}
                  </div>
                  {/* Cancel button */}
                  <button onClick={()=>setShowSortExpanded(false)} style={{
                    width:"100%",padding:"16px",borderRadius:R14,background:"#2C2C2E",border:"none",
                    cursor:_p,
                  }}>
                    <span style={{...ss(17,600,"#C4A882"),fontFamily:"system-ui,-apple-system,sans-serif"}}>Cancel</span>
                  </button>
                </div>
              </div>
            )}

            {/* For Sale toggle */}
            <div style={{..._btwn}}>
              <div style={ss(10,500,MD)}>For Sale Only</div>
              <button onClick={()=>setFilterSale(v=>!v)} style={{
                width:44,height:24,borderRadius:12,cursor:_p,position:"relative",
                background:filterSale?G:"#2A2A2A",border:"none",transition:"background 0.2s",
              }}>
                <div style={{position:"absolute",top:2,left:filterSale?22:2,width:20,height:20,borderRadius:12,background:"#FFF",transition:"left 0.2s"}}/>
              </button>
            </div>

            {/* Apply / Clear */}
            <div style={{..._row,gap:8,marginTop:14}}>
              {isFiltered&&<button onClick={()=>{clearFilters();setShowFilterMenu(false);}} style={{flex:1,padding:"8px",borderRadius:12,background:"#1A1A1A",border:"1px solid #3A2A2A",...ss(9,600,"#C09090",{letterSpacing:1}),cursor:_p}}>CLEAR ALL</button>}
              <button onClick={()=>setShowFilterMenu(false)} style={{flex:2,padding:"8px",borderRadius:12,background:`linear-gradient(135deg,${G},#8A6E54)`,border:"none",...ss(9,600,BK,{letterSpacing:1}),cursor:_p}}>APPLY</button>
            </div>
          </div>
        )}
      </div>

      {filtered.length===0?(
        <div style={{textAlign:"center",padding:"48px 16px"}}>
          {items.length===0 ? (
            <>
              <div style={{fontSize:48,marginBottom:16,animation:"pulse 2s ease-in-out infinite"}}>✦</div>
              <div style={sr(20,400,"#E8E0D4",{marginBottom:8})}>Your closet is waiting.</div>
              <div style={ss(12,400,DM,{marginBottom:24,lineHeight:1.7})}>Start with one thing you love — a go-to piece, a splurge, anything. We'll take it from there.</div>
              <button onClick={()=>setAddStep(1)} style={{padding:"12px 28px",borderRadius:24,background:`linear-gradient(135deg,${G},#8A6E54)`,border:"none",...ss(10,700,BK,{letterSpacing:1.5}),cursor:_p}}>ADD YOUR FIRST PIECE</button>
            </>
          ) : (
            <>
              <div style={{fontSize:32,marginBottom:12,opacity:0.5}}>🔍</div>
              <div style={sr(15,400,"#3A3028",{marginBottom:12})}>Nothing matches your filters</div>
              <button onClick={clearFilters} style={{padding:"8px 20px",borderRadius:R18,background:_1a,border:`1px solid ${G}44`,...ss(9,600,G,{letterSpacing:1}),cursor:_p}}>CLEAR FILTERS</button>
            </>
          )}
        </div>
      ):(
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
        {filtered.map((item,i)=>{
          const isFav=favorites.has(item.id);
          const isSelected=selectedClosetItem?.id===item.id;
          const pairStart=Math.floor(i/2)*2;
          const showDetailAfter=selectedClosetItem&&Math.floor(filtered.findIndex(f=>f.id===selectedClosetItem.id)/2)===Math.floor(i/2)&&i===pairStart+1;
          // also show after last item if it's alone in its row (odd total, selected is that item)
          const isLastOdd=filtered.length%2===1&&i===filtered.length-1&&selectedClosetItem?.id===item.id;
          return(
            <React.Fragment key={item.id}>
              <ClosetItemCard
                item={item}
                isFav={isFav}
                onSelect={()=>setSelectedClosetItem(isSelected?null:item)}
                onToggleFav={()=>toggleFav({stopPropagation:()=>{}},item.id)}
                selected={isSelected}
              />
              {(showDetailAfter||isLastOdd)&&(()=>{
                const it=selectedClosetItem;
                return(
                  <div style={{gridColumn:"1 / -1",background:"#141210",borderRadius:R14,border:`1px solid ${G}33`,padding:"16px",marginTop:-6}}>
                    <div style={{..._btwn,marginBottom:12}}>
                      <div style={{flex:1,minWidth:0,marginRight:8}}>
                        <input
                          value={it.name}
                          onChange={e=>{
                            const updated={...it,name:e.target.value};
                            setItems(prev=>prev.map(x=>x.id===it.id?updated:x));
                            setSelectedClosetItem(updated);
                          }}
                          onBlur={e=>{
                            const trimmed=e.target.value.trim()||it.name;
                            const updated={...it,name:trimmed};
                            setItems(prev=>prev.map(x=>x.id===it.id?updated:x));
                            setSelectedClosetItem(updated);
                            if(onSaveItem) onSaveItem(updated);
                          }}
                          style={{width:"100%",background:"none",border:"none",borderBottom:`1px solid ${G}44`,outline:"none",padding:"2px 0",...sr(17,500),color:"#E8E0D4"}}
                        />
                        <div style={{..._row,gap:6,marginTop:4}}>
                          {it.brand&&<div style={ss(9,400,DM)}>{it.brand}</div>}
                          {it.category&&<div style={ss(9,400,DM)}>· {it.category}</div>}
                        </div>
                      </div>
                      <button onClick={()=>setSelectedClosetItem(null)} style={{width:26,height:26,borderRadius:"50%",background:_1a,border:_2a,cursor:_p,...ss(13,300,MD),display:"flex",alignItems:"center",justifyContent:"center"}}>×</button>
                    </div>
                    {/* Image with matching background */}
                    <ClosetDetailImage item={it} onSaveItem={onSaveItem} setItems={setItems} setSelectedClosetItem={setSelectedClosetItem} showToast={showToast}/>
                    {/* Editable stats */}
                    <div style={{display:"flex",gap:8,marginBottom:12}}>
                      {/* Price */}
                      <div style={{flex:1,background:"#111",borderRadius:12,padding:"8px 4px",textAlign:"center",border:"1px solid #1E1E1E",position:"relative"}}>
                        <input
                          type="number"
                          value={it.price||0}
                          onChange={e=>{
                            const updated={...it,price:parseInt(e.target.value)||0};
                            setItems(prev=>prev.map(x=>x.id===it.id?updated:x));
                            setSelectedClosetItem(updated);
                            if(onSaveItem) onSaveItem(updated);
                          }}
                          style={{width:"100%",background:"none",border:"none",outline:"none",textAlign:"center",...sr(16,500,G),color:G,padding:0}}
                        />
                        <div style={ss(9,500,MD,{letterSpacing:1,marginTop:2})}>VALUE $</div>
                        <div style={{position:"absolute",bottom:4,right:5,opacity:0.4}}>
                          <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
                            <path d="M7 1L9 3L3.5 8.5L1 9L1.5 6.5L7 1Z" fill="#C4A882" stroke="#C4A882" strokeWidth="0.5" strokeLinejoin="round"/>
                          </svg>
                        </div>
                      </div>
                      {/* Wear count */}
                      <div style={{flex:1,background:"#111",borderRadius:12,padding:"8px 4px",textAlign:"center",border:"1px solid #1E1E1E",display:"flex",flexDirection:"column",alignItems:"center"}}>
                        <div style={{display:"flex",alignItems:"center",gap:6}}>
                          <button onClick={()=>{
                            const updated={...it,wearCount:Math.max(0,(it.wearCount||0)-1)};
                            setItems(prev=>prev.map(x=>x.id===it.id?updated:x));
                            setSelectedClosetItem(updated);
                            if(onSaveItem) onSaveItem(updated);
                          }} style={{background:"none",border:"none",cursor:_p,...ss(14,400,DM),lineHeight:1,padding:"0 2px"}}>−</button>
                          <div style={sr(16,500,G)}>{it.wearCount||0}×</div>
                          <button onClick={()=>{
                            const updated={...it,wearCount:(it.wearCount||0)+1};
                            setItems(prev=>prev.map(x=>x.id===it.id?updated:x));
                            setSelectedClosetItem(updated);
                            if(onSaveItem) onSaveItem(updated);
                          }} style={{background:"none",border:"none",cursor:_p,...ss(14,400,DM),lineHeight:1,padding:"0 2px"}}>+</button>
                        </div>
                        <div style={ss(9,500,MD,{letterSpacing:1,marginTop:2})}>WORN</div>
                      </div>
                      {/* Color */}
                      <div style={{flex:1,background:"#111",borderRadius:12,padding:"8px 6px",border:"1px solid #1E1E1E",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:4,position:"relative",cursor:_p}}
                        onClick={e=>{e.currentTarget.querySelector('input[type=color]')?.click();}}>
                        {/* Closet palette row — top 4 most common colors */}
                        <div style={{display:"flex",gap:3,flexWrap:"wrap",justifyContent:"center",marginBottom:2}}>
                          {[...new Set(items.filter(i=>i.color&&i.color!=='#2A2A2A'&&i.id!==it.id).map(i=>i.color))].slice(0,4).map(c=>(
                            <div key={c} onClick={e=>{e.stopPropagation();const updated={...it,color:c};setItems(prev=>prev.map(x=>x.id===it.id?updated:x));setSelectedClosetItem(updated);if(onSaveItem)onSaveItem(updated);}}
                              style={{width:16,height:16,borderRadius:4,background:c,border:`1.5px solid ${it.color===c?'#C4A882':'#2A2A2A'}`,cursor:_p,flexShrink:0}}/>
                          ))}
                        </div>
                        <div style={{width:22,height:22,borderRadius:"50%",background:it.color||"#C4A882",border:"2px solid #3A3028"}}/>
                        <input type="color" value={it.color||"#C4A882"} onChange={e=>{
                          const updated={...it,color:e.target.value};
                          setItems(prev=>prev.map(x=>x.id===it.id?updated:x));
                          setSelectedClosetItem(updated);
                          if(onSaveItem) onSaveItem(updated);
                        }} style={{opacity:0,position:"absolute",width:0,height:0}}/>
                        <div style={ss(8,500,MD,{letterSpacing:0.8})}>{hexToColorName(it.color||"#C4A882")}</div>
                        <div style={{position:"absolute",bottom:4,right:5,opacity:0.35}}>
                          <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
                            <path d="M7 1L9 3L3.5 8.5L1 9L1.5 6.5L7 1Z" fill="#C4A882" stroke="#C4A882" strokeWidth="0.5" strokeLinejoin="round"/>
                          </svg>
                        </div>
                      </div>
                    </div>
                    {/* Category */}
                    <div style={{marginBottom:12}}>
                      <div style={ss(10,600,MD,{letterSpacing:1,marginBottom:8})}>CATEGORY</div>
                      <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                        {["Tops","Bottoms","Dresses","Outerwear","Shoes","Accessories"].map(cat=>{
                          const emoji={Tops:"👕",Bottoms:"👖",Dresses:"👗",Outerwear:"🧥",Shoes:"👟",Accessories:"✨"}[cat];
                          const isActive = it.category===cat;
                          return(
                            <button key={cat} onClick={()=>{
                              const updated={...it,category:cat,emoji:emoji};
                              setItems(prev=>prev.map(x=>x.id===it.id?updated:x));
                              setSelectedClosetItem(updated);
                              if(onSaveItem) onSaveItem(updated);
                            }} style={{padding:"5px 10px",borderRadius:R18,cursor:_p,background:isActive?`${G}22`:"#111",border:isActive?`1.5px solid ${G}`:"1px solid #2A2A2A",...ss(8,isActive?600:400,isActive?G:DM,{letterSpacing:0.3}),display:"flex",alignItems:"center",gap:3}}>
                              <span>{emoji}</span>{cat}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    {/* Tags — editable */}
                    <div style={{marginBottom:12}}>
                      <div style={ss(10,600,MD,{letterSpacing:1,marginBottom:8})}>TAGS</div>
                      <div style={{display:"flex",gap:5,flexWrap:"wrap",alignItems:"center"}}>
                        {(it.tags||[]).map(t=>(
                          <div key={t} style={{display:"flex",alignItems:"center",gap:3,background:"#1A1A1A",borderRadius:R18,padding:"3px 6px 3px 9px",border:`1px solid ${G}33`}}>
                            <span style={ss(9,400,G)}>#{t}</span>
                            <button onClick={()=>{
                              const updated={...it,tags:(it.tags||[]).filter(x=>x!==t)};
                              setItems(prev=>prev.map(x=>x.id===it.id?updated:x));
                              setSelectedClosetItem(updated);
                              if(onSaveItem) onSaveItem(updated);
                            }} style={{background:"none",border:"none",cursor:_p,...ss(10,400,"#6A5A48"),lineHeight:1,padding:"0 1px"}}>×</button>
                          </div>
                        ))}
                        <input
                          placeholder="+ add tag"
                          onKeyDown={e=>{
                            if((e.key==="Enter"||e.key===","||e.key===" ")&&e.target.value.trim()){
                              const newTag=e.target.value.trim().toLowerCase().replace(/[^a-z0-9-]/g,"");
                              if(newTag&&!(it.tags||[]).includes(newTag)){
                                const updated={...it,tags:[...(it.tags||[]),newTag]};
                                setItems(prev=>prev.map(x=>x.id===it.id?updated:x));
                                setSelectedClosetItem(updated);
                                if(onSaveItem) onSaveItem(updated);
                              }
                              e.target.value="";
                              e.preventDefault();
                            }
                          }}
                          style={{background:"none",border:"none",outline:"none",...ss(9,400,"#4A4038"),minWidth:60,padding:"3px 0"}}
                        />
                      </div>
                    </div>
                    {/* Size — private, personal reference only */}
                    <div style={{marginBottom:12}}>
                      <div style={ss(10,600,MD,{letterSpacing:1,marginBottom:8})}>MY SIZE <span style={{...ss(9,400,DM),letterSpacing:0}}>· private</span></div>
                      <input
                        value={it.size||""}
                        onChange={e=>{
                          const updated={...it,size:e.target.value};
                          setItems(prev=>prev.map(x=>x.id===it.id?updated:x));
                          setSelectedClosetItem(updated);
                          if(onSaveItem) onSaveItem(updated);
                        }}
                        placeholder="e.g. S, M, 32, EU 42, 29×32…"
                        style={{width:"100%",boxSizing:"border-box",background:"#111",border:"1px solid #2A2A2A",borderRadius:12,padding:"8px 12px",...ss(11,400,"#E8E0D4"),outline:"none",color:"#E8E0D4"}}
                      />
                    </div>
                    {/* Actions */}
                    <div style={{display:"flex",gap:8}}>
                      <button onClick={()=>{
                        if(setTab) setTab("market");
                      }} style={{flex:1,padding:"11px",borderRadius:12,background:"#1A1A2A",border:`1px solid ${G}44`,...ss(9,600,G,{letterSpacing:1}),cursor:_p}}>
                        LIST FOR SALE
                      </button>
                      <button onClick={()=>{
                        setItems(prev=>prev.filter(x=>x.id!==it.id));
                        if(onDeleteItem) onDeleteItem(it.id);
                        setSelectedClosetItem(null);
                        showToast(`${it.name} removed \u2746`);
                      }} style={{flex:1,padding:"11px",borderRadius:12,background:"#1A0A0A",border:"1px solid #3A1A1A",...ss(9,600,"#E08080",{letterSpacing:1}),cursor:_p}}>
                        REMOVE
                      </button>
                    </div>
                  </div>
                );
              })()}
            </React.Fragment>
          );
        })}
      </div>
      )}

      {/* ── NEW ADD FLOW MODAL ── */}
      {addStep && (
        <React.Fragment>
          {/* Crop modal for draft photo editing */}
          {cropSrcNew&&(
            <div onClick={e=>e.stopPropagation()} onTouchStart={e=>e.stopPropagation()} style={{position:'fixed',inset:0,zIndex:200,maxWidth:430,margin:'0 auto'}}>
              <CropModal src={cropSrcNew} onCancel={()=>{setCropSrcNew(null);setCropDraftId(null);}}
                removeBgOnSave={cropBgRemoveNew}
                onSave={cropped=>{
                  setCropSrcNew(null);
                  if(cropDraftId) setDrafts(p=>p.map(d=>d.id===cropDraftId?{...d,processedPhoto:cropped,photo:cropped}:d));
                  setCropDraftId(null);
                }}/>
            </div>
          )}

          {/* File inputs — always mounted so refs work */}
          <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{display:'none'}}
            onChange={e=>{const f=e.target.files?.[0];if(f){const r=new FileReader();r.onload=ev=>addPhotoToDraft(ev.target.result);r.readAsDataURL(f);}e.target.value='';}}/>
          <input ref={manualFileRef} type="file" accept="image/*" multiple style={{display:'none'}}
            onChange={e=>{[...e.target.files].forEach(f=>{const r=new FileReader();r.onload=ev=>addPhotoToDraft(ev.target.result);r.readAsDataURL(f);});e.target.value='';}}/>

          {/* Full-screen page — true new window, no scroll inheritance */}
          <div ref={addFlowRef} style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'#0D0D0D',zIndex:60,maxWidth:430,margin:'0 auto',display:'flex',flexDirection:'column',overflow:'hidden',touchAction:'none',WebkitOverflowScrolling:'touch',animation:'slideInRight 0.28s cubic-bezier(0.32,0.72,0,1) forwards'}}
            onTouchStart={e=>e.stopPropagation()}>
            <style>{`@keyframes slideInRight{from{transform:translateX(100%);opacity:0.8;}to{transform:translateX(0);opacity:1;}}`}</style>
            <div onClick={e=>e.stopPropagation()} style={{display:'flex',flexDirection:'column',background:'#0D0D0D',height:'100%',overflow:'hidden',paddingBottom:'env(safe-area-inset-bottom)'}}>

              {/* ─ STEP 1: ENTRY ─ */}
              {addStep===1&&(
                <React.Fragment>
                  <div style={{padding:'18px 20px 0',display:'flex',justifyContent:'space-between',alignItems:'center',flexShrink:0}}>
                    <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:24,fontWeight:300,color:'#F0EBE3',letterSpacing:2}}>Add Piece</div>
                    <button onClick={closeAdd2} style={{width:30,height:30,borderRadius:'50%',border:'1px solid #2A2A2A',background:'none',color:'#4A4038',fontSize:18,cursor:_p,display:'flex',alignItems:'center',justifyContent:'center'}}>×</button>
                  </div>
                  {/* Viewfinder — fixed height so controls always visible below */}
                  <div style={{height:240,margin:'12px 14px 8px',borderRadius:R18,background:'#080808',border:'1px solid #1E1E1E',position:'relative',overflow:'hidden',display:'flex',alignItems:'center',justifyContent:'center',cursor:_p,flexShrink:0}} onClick={()=>fileRef.current?.click()}>
                    <div style={{position:'absolute',inset:0,display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gridTemplateRows:'1fr 1fr 1fr'}}>
                      {[...Array(9)].map((_,i)=><div key={i} style={{border:`0.5px solid rgba(196,168,130,0.1)`}}/>)}
                    </div>
                    {[{t:'top:10px',h:'left:10px',bw:'2px 0 0 2px',br:'4px 0 0 0'},
                      {t:'top:10px',h:'right:10px',bw:'2px 2px 0 0',br:'0 4px 0 0'},
                      {t:'bottom:10px',h:'left:10px',bw:'0 0 2px 2px',br:'0 0 0 4px'},
                      {t:'bottom:10px',h:'right:10px',bw:'0 2px 2px 0',br:'0 0 4px 0'}
                    ].map((c,i)=>(
                      <div key={i} style={{position:'absolute',width:20,height:20,borderStyle:'solid',borderColor:'#C4A882',borderWidth:c.bw,borderRadius:c.br,[c.t.split(':')[0]]:c.t.split(':')[1],[c.h.split(':')[0]]:c.h.split(':')[1]}}/>
                    ))}
                    <div style={{textAlign:'center'}}>
                      <div style={{width:62,height:62,borderRadius:'50%',border:'2px solid #C4A882',margin:'0 auto 12px',display:'flex',alignItems:'center',justifyContent:'center',boxShadow:'0 0 0 0 rgba(196,168,130,0.3)',animation:'pulse 2s ease-in-out infinite'}}>
                        <span style={{fontSize:22,color:'#C4A882'}}>✦</span>
                      </div>
                      <div style={ss(9,600,'#4A4038',{letterSpacing:2})}>TAP TO CAPTURE</div>
                    </div>
                  </div>
                  {/* Controls */}
                  <div style={{padding:'0 14px 22px'}}>
                    <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:12}}>
                      {/* Upload image */}
                      <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:6}}>
                        <div style={{width:44,height:44,borderRadius:'50%',background:'#111',border:'1px solid #2A2A2A',display:'flex',alignItems:'center',justifyContent:'center',cursor:_p}} onClick={()=>manualFileRef.current?.click()}>
                          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                            <rect x="1" y="3" width="18" height="14" rx="2" stroke="#C4A882" strokeWidth="1.4" fill="none"/>
                            <circle cx="7" cy="8" r="2" stroke="#C4A882" strokeWidth="1.3" fill="none"/>
                            <path d="M1 14L6 9L9 12L13 7L19 14" stroke="#C4A882" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
                          </svg>
                        </div>
                        <div style={ss(7,500,'#C4A882',{letterSpacing:0.3,textAlign:'center'})}>Upload Image</div>
                      </div>
                      {/* Take photo */}
                      <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:6}}>
                        <div style={{width:66,height:66,borderRadius:'50%',background:'#C4A882',display:'flex',alignItems:'center',justifyContent:'center',cursor:_p,boxShadow:'0 0 0 3px #0D0D0D, 0 0 0 5px rgba(196,168,130,0.4)'}} onClick={()=>fileRef.current?.click()}>
                          <svg width="24" height="24" viewBox="0 0 24 24" fill="#0D0D0D"><circle cx="12" cy="12" r="5"/><path d="M9 3h6l1.5 2H18a1 1 0 011 1v12a1 1 0 01-1 1H6a1 1 0 01-1-1V6a1 1 0 011-1h1.5L9 3z"/></svg>
                        </div>
                        <div style={ss(7,500,'#C4A882',{letterSpacing:0.3,textAlign:'center'})}>Take Photo</div>
                      </div>
                      {/* Add by URL */}
                      <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:6}}>
                        <div style={{width:44,height:44,borderRadius:'50%',background:addUrlMode?'rgba(196,168,130,0.15)':'#111',border:addUrlMode?'1px solid #C4A882':'1px solid #2A2A2A',display:'flex',alignItems:'center',justifyContent:'center',cursor:_p}} onClick={()=>setAddUrlMode(u=>!u)}>
                          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                            <path d="M8 12L12 8" stroke="#C4A882" strokeWidth="1.4" strokeLinecap="round"/>
                            <path d="M9.5 6.5L11 5C12.2 3.8 14.2 3.8 15.4 5C16.6 6.2 16.6 8.2 15.4 9.4L13.5 11.3" stroke="#C4A882" strokeWidth="1.4" strokeLinecap="round" fill="none"/>
                            <path d="M10.5 13.5L9 15C7.8 16.2 5.8 16.2 4.6 15C3.4 13.8 3.4 11.8 4.6 10.6L6.5 8.7" stroke="#C4A882" strokeWidth="1.4" strokeLinecap="round" fill="none"/>
                          </svg>
                        </div>
                        <div style={ss(7,500,'#C4A882',{letterSpacing:0.3,textAlign:'center'})}>Add by URL</div>
                      </div>
                    </div>

                  {/* URL input */}
                  {addUrlMode&&(
                    <div style={{display:'flex',gap:8}}>
                      <input value={addUrl} onChange={e=>setAddUrl(e.target.value)} autoFocus
                        onKeyDown={e=>{if(e.key==='Enter'&&addUrl.trim()){addUrlToDraft(addUrl.trim());setAddUrl('');setAddUrlMode(false);}}}
                        placeholder="https://store.com/item-link…"
                        style={{flex:1,background:'#111',border:`1px solid rgba(196,168,130,0.4)`,borderRadius:12,padding:'10px 14px',...ss(11,400,'#9A8A78'),color:'#C0B8B0',outline:'none'}}/>
                      <button onClick={()=>{if(addUrl.trim()){addUrlToDraft(addUrl.trim());setAddUrl('');setAddUrlMode(false);}}}
                        style={{padding:'10px 16px',borderRadius:12,background:'linear-gradient(135deg,#C4A882,#8A6E54)',border:'none',...ss(9,700,'#0D0D0D',{letterSpacing:1}),cursor:_p}}>FIND</button>
                    </div>
                  )}

                  {/* Clipboard URL banner — shown when a product URL is detected */}
                  {clipboardUrl&&(
                    <div style={{marginBottom:8,background:'rgba(196,168,130,0.07)',border:'1px solid rgba(196,168,130,0.3)',borderRadius:12,padding:'10px 12px',display:'flex',alignItems:'center',gap:10}}>
                      <svg width="14" height="14" viewBox="0 0 20 20" fill="none" style={{flexShrink:0}}>
                        <path d="M8 12L12 8" stroke="#C4A882" strokeWidth="1.4" strokeLinecap="round"/>
                        <path d="M9.5 6.5L11 5C12.2 3.8 14.2 3.8 15.4 5C16.6 6.2 16.6 8.2 15.4 9.4L13.5 11.3" stroke="#C4A882" strokeWidth="1.4" strokeLinecap="round" fill="none"/>
                        <path d="M10.5 13.5L9 15C7.8 16.2 5.8 16.2 4.6 15C3.4 13.8 3.4 11.8 4.6 10.6L6.5 8.7" stroke="#C4A882" strokeWidth="1.4" strokeLinecap="round" fill="none"/>
                      </svg>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={ss(8,600,'#C4A882',{letterSpacing:0.5,marginBottom:2})}>LINK DETECTED</div>
                        <div style={{...ss(9,400,'#4A4038'),overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{clipboardUrl}</div>
                      </div>
                      <button onClick={()=>{addUrlToDraft(clipboardUrl);setClipboardUrl(null);}}
                        style={{padding:'6px 12px',borderRadius:10,background:'linear-gradient(135deg,#C4A882,#8A6E54)',border:'none',...ss(8,700,'#0D0D0D',{letterSpacing:0.5}),cursor:_p,flexShrink:0}}>IMPORT</button>
                      <button onClick={()=>setClipboardUrl(null)}
                        style={{background:'none',border:'none',color:'#4A4038',fontSize:14,cursor:_p,flexShrink:0,lineHeight:1,padding:'0 2px'}}>×</button>
                    </div>
                  )}

                  {/* Pending queue shortcut — only shown when drafts are waiting */}
                  {drafts.some(d=>d.status==='ready')&&(
                    <button onClick={()=>setAddStep(2)}
                      style={{width:'100%',marginTop:10,padding:'9px 14px',borderRadius:12,background:'rgba(196,168,130,0.06)',border:'1px solid rgba(196,168,130,0.22)',display:'flex',alignItems:'center',justifyContent:'space-between',cursor:_p}}>
                      <div style={{display:'flex',alignItems:'center',gap:8}}>
                        <div style={{width:18,height:18,borderRadius:'50%',background:'#E05050',display:'flex',alignItems:'center',justifyContent:'center'}}>
                          <span style={{...ss(9,700,'#fff'),lineHeight:1}}>{drafts.filter(d=>d.status==='ready').length}</span>
                        </div>
                        <span style={ss(9,600,'#C4A882',{letterSpacing:0.8})}>
                          {drafts.filter(d=>d.status==='ready').length === 1 ? 'item' : 'items'} pending review
                        </span>
                      </div>
                      <span style={ss(11,400,'#4A4038')}>view queue ›</span>
                    </button>
                  )}
                  </div>
                </React.Fragment>
              )}

              {/* ─ STEP 2: PROCESSING QUEUE ─ */}
              {addStep===2&&(
                <React.Fragment>
                  <div style={{padding:'18px 20px 12px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                    <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:22,fontWeight:300,color:'#F0EBE3'}}>Processing</div>
                    <div style={{background:'rgba(196,168,130,0.15)',border:'1px solid rgba(196,168,130,0.3)',borderRadius:R18,padding:'3px 10px',...ss(9,600,'#C4A882',{letterSpacing:1})}}>
                      {drafts.filter(d=>d.status==='ready').length}/{drafts.length} READY
                    </div>
                  </div>
                  <div data-scroll="true" style={{maxHeight:260,overflowY:'auto',overscrollBehavior:'contain',padding:'0 14px'}}>
                    {drafts.map((draft,di)=>{
                      const swipeKey = `swipe_${draft.id}`;
                      return(
                      <div key={draft.id} style={{position:'relative',marginBottom:8,borderRadius:R14,overflow:'hidden'}}>
                        {/* Delete zone — revealed on swipe */}
                        <div style={{position:'absolute',right:0,top:0,bottom:0,width:90,background:'#2A0808',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:3,borderRadius:R14}}>
                          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                            <path d="M3 5h12M7 5V3h4v2M6 5l1 10h4l1-10" stroke="#E05050" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                          <span style={ss(8,600,'#E05050',{letterSpacing:1})}>REMOVE</span>
                        </div>
                        {/* Swipeable row */}
                        <div
                          id={swipeKey}
                          onClick={()=>{ if(draft.status==='ready'){ setReviewIdx(drafts.filter(d=>d.status==='ready').indexOf(draft)); setAddStep(3); } }}
                          style={{background:'#111',borderRadius:R14,border:`1px solid ${draft.status==='ready'?'#2A2418':'#1E1E1E'}`,display:'flex',gap:12,alignItems:'center',padding:'10px 12px',cursor:draft.status==='ready'?_p:'default',transform:'translateX(0)',transition:'transform 0.15s ease',willChange:'transform',position:'relative',zIndex:1}}
                          onTouchStart={e=>{
                            const el=document.getElementById(swipeKey);
                            el._tx=0; el._sx=e.touches[0].clientX; el._sy=e.touches[0].clientY; el._locked=false; el._dir=null;
                          }}
                          onTouchMove={e=>{
                            const el=document.getElementById(swipeKey);
                            if(!el) return;
                            const dx=e.touches[0].clientX-el._sx;
                            const dy=e.touches[0].clientY-el._sy;
                            if(!el._dir) el._dir=Math.abs(dx)>Math.abs(dy)?'h':'v';
                            // Always stop propagation to parent page — let the data-scroll container handle vertical
                            e.stopPropagation();
                            if(el._dir==='v') return;
                            e.preventDefault();
                            const tx=Math.min(0,dx);
                            el._tx=tx;
                            el.style.transition='none';
                            el.style.transform=`translateX(${tx}px)`;
                          }}
                          onTouchEnd={()=>{
                            const el=document.getElementById(swipeKey);
                            if(!el) return;
                            el.style.transition='transform 0.25s cubic-bezier(0.25,0.46,0.45,0.94)';
                            if(el._tx<-70){
                              el.style.transform='translateX(-110%)';
                              setTimeout(()=>setDrafts(p=>p.filter(d=>d.id!==draft.id)),220);
                            } else {
                              el.style.transform='translateX(0)';
                            }
                          }}>
                          <div style={{width:48,height:48,borderRadius:12,overflow:'hidden',background:'#1A1A1A',flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center'}}>
                            {draft.photo
                              ? <img src={draft.photo} style={{width:'100%',height:'100%',objectFit:'cover'}} alt=""/>
                              : <span style={{fontSize:22}}>🖼</span>
                            }
                          </div>
                          <div style={{flex:1,minWidth:0}}>
                            <div style={sr(12,500,'#E8E0D4',{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',marginBottom:3})}>
                              {draft.ai.name||draft._url||'Photo scan'}
                            </div>
                            {draft.status==='processing'
                              ? <div style={{display:'flex',alignItems:'center',gap:5}}>
                                  <span style={{fontSize:10,animation:'spin 1.2s linear infinite',display:'inline-block',color:'#C4A882'}}>✦</span>
                                  <span style={ss(9,400,'#4A4038')}>{draft.stage}</span>
                                </div>
                              : <div style={{display:'flex',alignItems:'center',gap:5}}>
                                  <span style={{fontSize:10,color:'#80C880'}}>✓</span>
                                  <span style={ss(9,500,'#80C880')}>Ready to review</span>
                                </div>
                            }
                          </div>
                          {draft.status==='ready' && <span style={{fontSize:14,color:'#4A4038',flexShrink:0}}>›</span>}
                        </div>
                      </div>
                    )})}
                  </div>
                  <div style={{padding:'10px 14px 22px',display:'flex',gap:8,flexDirection:'column'}}>
                    <button onClick={()=>setAddStep(1)}
                      style={{width:'100%',padding:'11px',borderRadius:12,background:'none',border:'1px solid #2A2A2A',...ss(9,600,'#4A4038',{letterSpacing:1}),cursor:_p}}>
                      + ADD ANOTHER PIECE
                    </button>
                    <button onClick={()=>{setReviewIdx(0);setAddStep(3);}}
                      disabled={!drafts.some(d=>d.status==='ready')}
                      style={{width:'100%',padding:'12px',borderRadius:12,background:drafts.some(d=>d.status==='ready')?'linear-gradient(135deg,#C4A882,#8A6E54)':'#1A1A1A',border:'none',...ss(10,700,drafts.some(d=>d.status==='ready')?'#0D0D0D':'#4A4038',{letterSpacing:1.5}),cursor:drafts.some(d=>d.status==='ready')?_p:'default'}}>
                      REVIEW {drafts.filter(d=>d.status==='ready').length} {drafts.filter(d=>d.status==='ready').length===1?'ITEM':'ITEMS'} →
                    </button>
                  </div>
                </React.Fragment>
              )}

              {/* ─ STEP 3: REVIEW DECK ─ */}
              {addStep===3&&(()=>{
                const ready = drafts.filter(d=>d.status==='ready');
                if(!ready.length){ closeAdd2(); return null; }
                const idx = Math.min(reviewIdx, ready.length-1);
                const draft = ready[idx];
                if(!draft){ closeAdd2(); return null; }
                const get = f=>getDV(draft,f);
                const set = (f,v)=>setDF(draft.id,f,v);
                const catEmojiMap={Tops:'👚',Bottoms:'👖',Dresses:'👗',Outerwear:'🧥',Shoes:'👟',Accessories:'✨'};
                const prev = draft.processedPhoto||draft.stockImage||draft.photo;
                return(
                  <React.Fragment>
                    <div style={{position:'fixed',inset:0,maxWidth:430,margin:'0 auto',background:'#0D0D0D',zIndex:400,display:'flex',flexDirection:'column',overflow:'hidden'}}>
                    {/* Header */}
                    <div style={{padding:'16px 18px 8px',display:'flex',alignItems:'center',justifyContent:'space-between',flexShrink:0}}>
                      <button onClick={()=>setAddStep(2)} style={{background:'none',border:'none',cursor:_p,padding:0,display:'flex',alignItems:'center',gap:4,...ss(9,600,'#4A4038',{letterSpacing:0.5})}}>‹ BACK</button>
                      <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:20,fontWeight:300,color:'#F0EBE3'}}>Review Drafts</div>
                      <div style={ss(9,600,'#4A4038',{letterSpacing:1})}>{idx+1} OF {ready.length}</div>
                    </div>
                    {/* Dot indicators */}
                    {ready.length>1&&(
                      <div style={{display:'flex',justifyContent:'center',gap:6,padding:'2px 0 10px'}}>
                        {ready.map((_,i)=>(
                          <div key={i} onClick={()=>setReviewIdx(i)} style={{width:i===idx?18:6,height:6,borderRadius:3,background:i===idx?'#C4A882':'#2A2A2A',transition:'all 0.3s',cursor:_p}}/>
                        ))}
                      </div>
                    )}
                    <div
                      id="review_swipe_area"
                      data-scroll="true" style={{flex:1,minHeight:0,overflowY:'auto',overscrollBehavior:'contain',WebkitOverflowScrolling:'touch',padding:'0 14px 4px'}}
                      onTouchStart={e=>{
                        const el=document.getElementById('review_swipe_area');
                        if(el){el._rx=e.touches[0].clientX;el._ry=e.touches[0].clientY;}
                      }}
                      onTouchEnd={e=>{
                        const el=document.getElementById('review_swipe_area');
                        if(!el) return;
                        const dx=e.changedTouches[0].clientX-el._rx;
                        const dy=e.changedTouches[0].clientY-el._ry;
                        if(Math.abs(dx)<Math.abs(dy)||Math.abs(dx)<50) return;
                        if(dx<0&&idx<ready.length-1) setReviewIdx(i=>i+1);
                        if(dx>0&&idx>0) setReviewIdx(i=>i-1);
                      }}>
                      {/* Card */}
                      <div style={{background:'#141210',borderRadius:R18,border:'1px solid #2A2418',overflow:'hidden',marginBottom:10}}>
                        {/* Photo */}
                        <div style={{width:'100%',height:180,background:`linear-gradient(135deg,${get('color')||'#1A1A1A'}22,${get('color')||'#1A1A1A'}44)`,position:'relative',display:'flex',alignItems:'center',justifyContent:'center',cursor:prev?_p:'default'}}
                          onClick={()=>{if(prev&&extractingModel!==draft.id){setCropDraftId(draft.id);setCropSrcNew(prev);setCropBgRemoveNew(false);}}}>
                          {prev
                            ? <img src={prev} style={{width:'100%',height:'100%',objectFit:'contain',padding:8,boxSizing:'border-box'}} alt=""/>
                            : <div style={{display:'flex',alignItems:'center',justifyContent:'center',width:'100%',height:'100%'}}><CatSVG cat={get('category')||'Tops'} size={58} color="rgba(196,168,130,0.45)"/></div>
                          }
                          <div style={{position:'absolute',top:10,left:10,background:'rgba(13,13,13,0.85)',border:'1px solid rgba(196,168,130,0.35)',borderRadius:R18,padding:'3px 9px',display:'flex',alignItems:'center',gap:4}}>
                            <span style={{fontSize:8,color:'#C4A882'}}>✦</span>
                            <span style={ss(8,600,'#C4A882',{letterSpacing:1})}>AI FILLED</span>
                          </div>
                          {prev&&<div style={{position:'absolute',bottom:8,right:8,background:'rgba(13,13,13,0.7)',borderRadius:8,padding:'3px 8px',...ss(8,400,'#4A4038')}}>tap to crop ✂️</div>}
                          {/* Remove Model button — only shows when photo exists */}
                          {prev&&(
                            <button
                              onClick={e=>{
                                e.stopPropagation();
                                if(extractingModel===draft.id) return;
                                setExtractingModel(draft.id);
                                extractGarment(prev)
                                  .then(cleanUrl=>{
                                    setDrafts(p=>p.map(d=>d.id===draft.id?{...d,processedPhoto:cleanUrl,photo:cleanUrl}:d));
                                    showToast('Model removed ✦');
                                  })
                                  .catch(err=>{ showToast('Could not remove model — try again'); console.error(err); })
                                  .finally(()=>setExtractingModel(null));
                              }}
                              style={{position:'absolute',top:10,right:10,background:'rgba(13,13,13,0.88)',border:'1px solid rgba(196,168,130,0.4)',borderRadius:R18,padding:'4px 10px',display:'flex',alignItems:'center',gap:5,cursor:extractingModel===draft.id?'default':_p,opacity:extractingModel&&extractingModel!==draft.id?0.4:1}}>
                              {extractingModel===draft.id
                                ? <><span style={{fontSize:9,color:'#C4A882',animation:'spin 1.2s linear infinite',display:'inline-block'}}>✦</span><span style={ss(8,600,'#C4A882',{letterSpacing:0.5})}>Removing…</span></>
                                : <><svg width="11" height="11" viewBox="0 0 14 14" fill="none"><path d="M7 1C7 1 4 2.5 4 6V10H10V6C10 2.5 7 1 7 1Z" stroke="#C4A882" strokeWidth="1.2" strokeLinejoin="round"/><path d="M5 10L3 13H11L9 10" stroke="#C4A882" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg><span style={ss(8,600,'#C4A882',{letterSpacing:0.5})}>Remove Model</span></>
                              }
                            </button>
                          )}
                        </div>
                        <div style={{padding:'14px'}}>
                          {/* Name */}
                          <div style={{marginBottom:10}}>
                            <div style={ss(8,600,'#4A4038',{letterSpacing:1.5,marginBottom:4})}>ITEM NAME</div>
                            <input value={get('name')||''} onChange={e=>set('name',e.target.value)} placeholder="e.g. Silk Slip Dress"
                              style={{width:'100%',boxSizing:'border-box',background:'#111',border:'1px solid #2A2A2A',borderRadius:12,padding:'8px 12px',...ss(13,500,'#E8E0D4'),color:'#E8E0D4',outline:'none'}}/>
                          </div>
                          {/* Brand */}
                          <div style={{marginBottom:10}}>
                            <div style={ss(8,600,'#4A4038',{letterSpacing:1.5,marginBottom:4})}>BRAND</div>
                            <input value={get('brand')||''} onChange={e=>set('brand',e.target.value)} placeholder="e.g. Toteme, Zara…"
                              style={{width:'100%',boxSizing:'border-box',background:'#111',border:'1px solid #2A2A2A',borderRadius:12,padding:'8px 12px',...ss(12,400,'#C0B8B0'),color:'#C0B8B0',outline:'none'}}/>
                          </div>
                          {/* Category */}
                          <div style={{marginBottom:10}}>
                            <div style={ss(8,600,'#4A4038',{letterSpacing:1.5,marginBottom:6})}>CATEGORY</div>
                            <div style={{display:'flex',gap:5,flexWrap:'wrap'}}>
                              {['Tops','Bottoms','Dresses','Outerwear','Shoes','Accessories'].map(cat=>(
                                <button key={cat} onClick={()=>{set('category',cat);set('emoji',catEmojiMap[cat]);}}
                                  style={{padding:'5px 10px',borderRadius:R18,cursor:_p,background:get('category')===cat?'rgba(196,168,130,0.15)':'#111',border:get('category')===cat?'1.5px solid #C4A882':'1px solid #2A2A2A',...ss(8,get('category')===cat?600:400,get('category')===cat?'#C4A882':'#4A4038',{letterSpacing:0.3}),display:'flex',alignItems:'center',gap:5}}>
                                  <CatSVG cat={cat} size={13} color={get('category')===cat?'#C4A882':'#4A4038'}/>{cat}
                                </button>
                              ))}
                            </div>
                          </div>
                          {/* Color */}
                          {(()=>{
                            const aiColor = get('color')||'#2A2A2A';
                            const isDefaultColor = aiColor==='#2A2A2A'||aiColor==='#2a2a2a';
                            // Build palette from existing closet — unique colors, most common first
                            const closetColors = [...new Set(
                              items.filter(i=>i.color&&i.color!=='#2A2A2A'&&i.color!=='#2a2a2a').map(i=>i.color)
                            )].slice(0,6);
                            return(
                              <div style={{marginBottom:10}}>
                                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:6}}>
                                  <div style={ss(8,600,'#4A4038',{letterSpacing:1.5})}>COLOR</div>
                                  {!isDefaultColor&&(
                                    <div style={{display:'flex',alignItems:'center',gap:4}}>
                                      <div style={{width:8,height:8,borderRadius:'50%',background:'#80C880'}}/>
                                      <span style={ss(7,500,'#80C880',{letterSpacing:0.5})}>AI DETECTED</span>
                                    </div>
                                  )}
                                </div>
                                <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
                                  {/* AI detected swatch or unknown placeholder */}
                                  {!isDefaultColor&&(
                                    <div title={hexToColorName(aiColor)}
                                      style={{width:32,height:32,borderRadius:8,background:aiColor,border:`2px solid ${get('color')===aiColor?'#C4A882':'#2A2A2A'}`,flexShrink:0,cursor:_p,position:'relative'}}
                                      onClick={()=>set('color',aiColor)}>
                                      {get('color')===aiColor&&(
                                        <div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center'}}>
                                          <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M2 6L5 9L10 3" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                                        </div>
                                      )}
                                    </div>
                                  )}
                                  {/* Closet palette swatches */}
                                  {closetColors.map(c=>(
                                    <div key={c} title={hexToColorName(c)}
                                      style={{width:32,height:32,borderRadius:8,background:c,border:`2px solid ${get('color')===c?'#C4A882':'#2A2A2A'}`,flexShrink:0,cursor:_p,position:'relative'}}
                                      onClick={()=>set('color',c)}>
                                      {get('color')===c&&(
                                        <div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center'}}>
                                          <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M2 6L5 9L10 3" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                  {/* Custom color picker escape hatch */}
                                  <label style={{width:32,height:32,borderRadius:8,background:'#111',border:'1px dashed #2A2A2A',flexShrink:0,cursor:_p,display:'flex',alignItems:'center',justifyContent:'center',position:'relative'}} title="Custom color">
                                    <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M7 1L8.2 4.8L12 6L8.2 7.2L7 11L5.8 7.2L2 6L5.8 4.8L7 1Z" stroke="#4A4038" strokeWidth="1.2" strokeLinejoin="round"/></svg>
                                    <input type="color" value={get('color')||'#C4A882'} onChange={e=>set('color',e.target.value)}
                                      style={{opacity:0,position:'absolute',width:0,height:0}}/>
                                  </label>
                                </div>
                                {/* Selected color name */}
                                {get('color')&&get('color')!=='#2A2A2A'&&(
                                  <div style={ss(8,400,'#4A4038',{marginTop:5})}>{hexToColorName(get('color'))}</div>
                                )}
                              </div>
                            );
                          })()}
                          {/* Price */}
                          <div style={{display:'flex',alignItems:'center',gap:8}}>
                            <div style={ss(8,600,'#4A4038',{letterSpacing:1.5})}>PRICE</div>
                            <div style={{display:'flex',alignItems:'center',gap:4,background:'#111',border:'1px solid #2A2A2A',borderRadius:8,padding:'5px 10px',flex:1}}>
                              <span style={sr(12,400,'#4A4038')}>$</span>
                              <input value={get('price')?(parseFloat(get('price'))%1===0?parseInt(get('price')):parseFloat(get('price')).toFixed(2)):''}  onChange={e=>set('price',e.target.value.replace(/[^0-9.]/g,''))} placeholder="0" inputMode="decimal"
                                style={{flex:1,background:'none',border:'none',outline:'none',...sr(12,400,'#C4A882'),color:'#C4A882',width:'100%'}}/>
                            </div>
                            <span style={ss(9,400,'#3A3028',{letterSpacing:0.5})}>optional</span>
                          </div>
                        </div>
                      </div>
                      {/* BG removal */}
                      {prev&&(
                        <button onClick={()=>{setCropDraftId(draft.id);setCropSrcNew(prev);setCropBgRemoveNew(true);}}
                          style={{width:'100%',padding:'9px',borderRadius:12,background:'#111',border:'1px solid #2A2A2A',...ss(9,500,'#4A4038',{letterSpacing:1}),cursor:_p,marginBottom:6}}>
                          ✂️ CROP + REMOVE BACKGROUND
                        </button>
                      )}
                    </div>
                    {/* Actions */}
                    <div style={{padding:'8px 14px 22px',display:'flex',flexDirection:'column',gap:6}}>
                      {!get('category')&&(
                        <div style={{textAlign:'center',...ss(9,600,'#C4A882',{letterSpacing:0.8})}}>
                          ↑ Select a category to continue
                        </div>
                      )}
                      <button onClick={()=>get('category')&&confirmDraft(draft)}
                        disabled={!get('category')}
                        style={{flex:1,padding:'12px',borderRadius:12,background:get('category')?'linear-gradient(135deg,#C4A882,#8A6E54)':'#1A1A1A',border:get('category')?'none':'1px solid #2A2A2A',...ss(10,700,get('category')?'#0D0D0D':'#3A3028',{letterSpacing:1.5}),cursor:get('category')?_p:'default',opacity:get('category')?1:0.6}}>
                        ADD TO CLOSET ✦
                      </button>
                    </div>
                    </div>{/* end flex column wrapper */}
                  </React.Fragment>
                );
              })()}

            </div>
          </div>
        </React.Fragment>
      )}

    </React.Fragment>)}

      {/* ── WISHLIST ITEM DETAIL POPUP ── */}
      {selectedWishItem&&(
        <div onClick={()=>setSelectedWishItem(null)} style={{..._fix,background:"#00000099",display:"flex",alignItems:"flex-start",paddingTop:60,zIndex:80}}>
          <div onClick={e=>e.stopPropagation()} style={{background:CD,borderRadius:"0 0 24px 24px",padding:"24px",width:"100%",maxWidth:430,margin:"0 auto",border:_2a,animation:"fadeDown 0.3s ease forwards",maxHeight:"90vh",overflowY:"auto"}}>
            <div style={{..._btwnS,marginBottom:20}}>
              <div style={{display:"flex",gap:16,alignItems:"center"}}>
                {/* Image with pencil edit overlay */}
                <div style={{position:"relative",width:88,height:88,flexShrink:0}}>
                  <input ref={wishPhotoRef} type="file" accept="image/*" style={{display:"none"}} onChange={e=>{
                    const file=e.target.files?.[0]; if(!file) return;
                    const reader=new FileReader();
                    reader.onload=ev=>setWishCropSrc(ev.target.result);
                    reader.readAsDataURL(file);
                  }}/>
                  <div style={{width:88,height:88,borderRadius:R18,background:_1a,overflow:"hidden",display:"flex",alignItems:"center",justifyContent:"center",border:_2a}}>
                    {selectedWishItem.sourceImage
                      ?<img src={selectedWishItem.sourceImage} style={{width:"100%",height:"100%",objectFit:"cover"}} alt={selectedWishItem.name}/>
                      :<ItemIllustration item={selectedWishItem} size={72}/>}
                  </div>
                  <button onClick={()=>wishPhotoRef.current?.click()}
                    style={{position:"absolute",bottom:-4,right:-4,width:22,height:22,borderRadius:"50%",background:G,border:"2px solid #0D0D0D",display:"flex",alignItems:"center",justifyContent:"center",cursor:_p}}>
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                      <path d="M7 1L9 3L3.5 8.5L1 9L1.5 6.5L7 1Z" fill="#0D0D0D" stroke="#0D0D0D" strokeWidth="0.5" strokeLinejoin="round"/>
                      <path d="M6.5 1.5L8.5 3.5" stroke="#0D0D0D" strokeWidth="0.5"/>
                    </svg>
                  </button>
                </div>
                <div>
                  <div style={sr(20,500)}>{selectedWishItem.name}</div>
                  <div style={ss(10,400,DM,{letterSpacing:1,marginTop:4})}>{selectedWishItem.brand}</div>
                  <div style={sr(18,400,G,{marginTop:6})}>from ${selectedWishItem.price}</div>
                </div>
              </div>
              <IconBtn onClick={()=>setSelectedWishItem(null)}>×</IconBtn>
            </div>

            {/* Crop modal for wishlist photo */}
            {wishCropSrc&&(
              <CropModal
                src={wishCropSrc}
                onCancel={()=>setWishCropSrc(null)}
                onSave={cropped=>{
                  const updated={...selectedWishItem,sourceImage:cropped};
                  setSelectedWishItem(updated);
                  setWishlist(prev=>prev.map(w=>w.id===selectedWishItem.id?updated:w));
                  setWishCropSrc(null);
                  showToast("Photo updated \u2746");
                }}
                autoRemoveBg={true}
              />
            )}
            <div style={{background:_1a,borderRadius:R14,padding:"14px 16px",marginBottom:20,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <div style={ss(10,400,DM,{letterSpacing:1})}>Available in Market</div>
              {selectedWishItem.inMarket
                ?<div style={{background:"#1A2A1A",borderRadius:R18,padding:"4px 12px",...ss(8,700,"#A8C4A0",{letterSpacing:1})}}>IN MARKET</div>
                :<div style={{background:_1a,borderRadius:R18,padding:"4px 12px",border:_2a,...ss(8,400,DM,{letterSpacing:1})}}>NOT LISTED</div>}
            </div>
            {selectedWishItem.sourceUrl&&(
              <a href={selectedWishItem.sourceUrl} target="_blank" rel="noopener noreferrer"
                style={{display:"flex",alignItems:"center",gap:10,background:"#0A0A14",borderRadius:R14,padding:"12px 16px",marginBottom:16,border:`1px solid ${G}33`,textDecoration:"none",cursor:_p}}>
                <div style={{width:32,height:32,borderRadius:12,background:`${G}22`,border:`1px solid ${G}44`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,...ss(14,400)}}>🔗</div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={ss(9,600,G,{letterSpacing:1,marginBottom:2})}>VIEW ORIGINAL LISTING</div>
                  <div style={ss(9,400,DM,{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"})}>{selectedWishItem.sourceUrl.replace(/^https?:\/\//,"").slice(0,50)}{selectedWishItem.sourceUrl.length>53?"…":""}</div>
                </div>
                <div style={ss(12,400,G)}>↗</div>
              </a>
            )}
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              <button onClick={()=>{
                // Add to closet from wishlist
                const newItem={
                  id:Date.now(),
                  name:selectedWishItem.name,
                  brand:selectedWishItem.brand||"Unknown",
                  category:selectedWishItem.category||"Tops",
                  color:selectedWishItem.color||"#C4A882",
                  price:selectedWishItem.price||0,
                  emoji:selectedWishItem.emoji||"👗",
                  wearCount:0,
                  lastWorn:"Never",
                  purchaseDate:new Date().toLocaleDateString("en-US",{month:"short",year:"numeric"}),
                  condition:"New",
                  forSale:false,
                  tags:[],
                  sourceImage:selectedWishItem.sourceImage||null,
                };
                setItems(prev=>{ const next=[...prev,newItem]; checkMilestone(next.length); return next; });
                if(onSaveItem) onSaveItem(newItem, true);
                // Remove from wishlist
                if(removeFromWishlist) removeFromWishlist(selectedWishItem.id);
                else setWishlist(prev=>prev.filter(w=>w.id!==selectedWishItem.id));
                setSelectedWishItem(null);
                showToast(`${newItem.name} added to your closet \u2746`);
              }} style={{width:"100%",padding:"14px",borderRadius:R14,background:`linear-gradient(135deg,${G},#8A6E54)`,border:"none",...ss(10,700,BK,{letterSpacing:1.5}),cursor:_p,display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
                <span style={{fontSize:16}}>🛍</span> I BOUGHT IT — ADD TO CLOSET
              </button>
              <div style={{display:"flex",gap:10}}>
                <Btn onClick={()=>{if(removeFromWishlist) removeFromWishlist(selectedWishItem.id); else setWishlist(prev=>prev.filter(w=>w.id!==selectedWishItem.id));setSelectedWishItem(null);showToast("Removed from wishlist \u2746");}} outline>REMOVE</Btn>
                <Btn onClick={()=>{showToast("Market launches soon — we'll notify you \u2746");setSelectedWishItem(null);}} full>FIND IN MARKET · COMING SOON</Btn>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── REVERSE SEARCH MODAL ── */}
      {showReverseSearch&&(
        <WishlistAddModal
          onClose={()=>setShowReverseSearch(false)}
          onAddToWishlist={(item)=>{
            if(addToWishlist) addToWishlist({...item, id:item.id||Date.now()+Math.random()});
            else setWishlist(prev=>prev.find(w=>w.name===item.name)?prev:[...prev,{...item,id:item.id||Date.now()+Math.random()}]);
          }}
        />
      )}
    </div>
  );
}

// ── ITEM DETAIL ───────────────────────────────────────────────────────────────
// ── CROP MODAL ────────────────────────────────────────────────────────────────

// Removes fog by morphological masking:
// 1. Build a "definitely foreground" seed mask (alpha > 180)
// 2. Dilate it by DILATE_PX pixels to cover soft edges
// 3. Erase everything outside — fog is always far from the item body
async function removeWhiteSpill(blob){
  return new Promise(resolve=>{
    const url=URL.createObjectURL(blob);
    const img=new Image();
    img.onload=()=>{
      const w=img.width,h=img.height;
      const canvas=document.createElement("canvas");
      canvas.width=w; canvas.height=h;
      const ctx=canvas.getContext("2d");
      ctx.drawImage(img,0,0);
      URL.revokeObjectURL(url);
      const imageData=ctx.getImageData(0,0,w,h);
      const d=imageData.data;
      const DILATE_PX=40; // how far to grow the mask beyond solid pixels
      const SEED_ALPHA=150; // pixels above this are definitely foreground

      // Step 1: seed mask — pixels we're certain are part of the item
      const seed=new Uint8Array(w*h);
      for(let i=0;i<w*h;i++) if(d[i*4+3]>=SEED_ALPHA) seed[i]=1;

      // Step 2: dilate seed mask using a fast box approximation
      // Two-pass separable dilation (horizontal then vertical) is O(w*h)
      const dilated=new Uint8Array(w*h);
      // Horizontal pass
      const horiz=new Uint8Array(w*h);
      for(let y=0;y<h;y++){
        let count=0;
        // sliding window — count seed pixels in [x-DILATE_PX, x+DILATE_PX]
        for(let x=0;x<w;x++){
          if(x===0){
            for(let k=0;k<=Math.min(DILATE_PX,w-1);k++) if(seed[y*w+k]) count++;
          } else {
            const add=x+DILATE_PX; if(add<w&&seed[y*w+add]) count++;
            const rem=x-DILATE_PX-1; if(rem>=0&&seed[y*w+rem]) count--;
          }
          if(count>0) horiz[y*w+x]=1;
        }
      }
      // Vertical pass
      for(let x=0;x<w;x++){
        let count=0;
        for(let y=0;y<h;y++){
          if(y===0){
            for(let k=0;k<=Math.min(DILATE_PX,h-1);k++) if(horiz[k*w+x]) count++;
          } else {
            const add=y+DILATE_PX; if(add<h&&horiz[add*w+x]) count++;
            const rem=y-DILATE_PX-1; if(rem>=0&&horiz[rem*w+x]) count--;
          }
          if(count>0) dilated[y*w+x]=1;
        }
      }

      // Step 3: erase any opaque pixel outside the dilated mask
      for(let i=0;i<w*h;i++){
        if(!dilated[i]&&d[i*4+3]>0) d[i*4+3]=0;
      }

      ctx.putImageData(imageData,0,0);
      canvas.toBlob(b=>resolve(b),"image/png");
    };
    img.onerror=()=>resolve(blob);
    img.src=url;
  });
}

// Removes small isolated opaque blobs from a transparent PNG (arrows, UI chrome, etc.)
// Keeps only the largest connected region — the clothing item.
async function cleanIsolatedPixels(blob){
  return new Promise(resolve=>{
    const url=URL.createObjectURL(blob);
    const img=new Image();
    img.onload=()=>{
      const w=img.width, h=img.height;
      const canvas=document.createElement("canvas");
      canvas.width=w; canvas.height=h;
      const ctx=canvas.getContext("2d");
      ctx.drawImage(img,0,0);
      URL.revokeObjectURL(url);
      const imageData=ctx.getImageData(0,0,w,h);
      const data=imageData.data;
      const getA=i=>data[i*4+3];
      const visited=new Uint8Array(w*h);
      const neighbors=i=>{
        const x=i%w,y=Math.floor(i/w),nb=[];
        if(x>0) nb.push(i-1);
        if(x<w-1) nb.push(i+1);
        if(y>0) nb.push(i-w);
        if(y<h-1) nb.push(i+w);
        return nb;
      };
      let largestSize=0;
      const allBlobs=[];
      for(let start=0;start<w*h;start++){
        if(visited[start]||getA(start)<10) continue;
        const queue=[start],blobPixels=[];
        visited[start]=1;
        while(queue.length){
          const cur=queue.shift();
          blobPixels.push(cur);
          for(const nb of neighbors(cur)){
            if(!visited[nb]&&getA(nb)>=10){visited[nb]=1;queue.push(nb);}
          }
        }
        if(blobPixels.length>largestSize) largestSize=blobPixels.length;
        allBlobs.push(blobPixels);
      }
      // Keep any blob that is at least 8% of the largest — preserves white stripes,
      // buttons, and disconnected garment sections while removing tiny UI artifacts
      const MIN_RATIO=0.08;
      const keep=new Uint8Array(w*h);
      for(const blob of allBlobs){
        if(blob.length>=largestSize*MIN_RATIO) for(const i of blob) keep[i]=1;
      }
      for(let i=0;i<w*h;i++) if(!keep[i]) data[i*4+3]=0;
      ctx.putImageData(imageData,0,0);
      canvas.toBlob(b=>resolve(b),"image/png");
    };
    img.onerror=()=>resolve(blob);
    img.src=url;
  });
}

function CropModal({src, onCancel, onSave, autoRemoveBg=false, saveLabel=null, removeBgOnSave=false}){
  const canvasRef=useRef();
  const mountedRef=useRef(true);
  useEffect(()=>{ mountedRef.current=true; return ()=>{ mountedRef.current=false; }; },[]);
  const [cropX,setCropX]=useState(0);
  const [cropY,setCropY]=useState(0);
  const [cropSize,setCropSize]=useState(200);
  const [imgNatural,setImgNatural]=useState({w:1,h:1});
  const [displaySize,setDisplaySize]=useState({w:300,h:300});
  const [dragging,setDragging]=useState(false);
  const [dragStart,setDragStart]=useState({x:0,y:0,cx:0,cy:0});
  const [removingBg,setRemovingBg]=useState(false);
  const [bgError,setBgError]=useState(null);
  const [cornerDrag,setCornerDrag]=useState(null);
  const resolvedSrcRef=useRef(null); // ref (not state) so buildCroppedB64 always sees latest value
  const containerRef=useRef();
  const imgRef=useRef();

  // Fixed layout budget:
  // header=48px, footer=130px, padding top+bottom=40px, gaps=20px => 238px total chrome
  // Image zone gets the rest
  const CHROME_H = 300;
  const imgZoneH = Math.max(200, window.innerHeight - CHROME_H);
  const imgZoneW = Math.min(window.innerWidth - 40, 390);

  useEffect(()=>{
    if(!src) return;
    const load=(imgSrc)=>{
      resolvedSrcRef.current=imgSrc;
      const img=new Image();
      img.onload=()=>{
        const nat={w:img.naturalWidth,h:img.naturalHeight};
        setImgNatural(nat);
        const scale=Math.min(imgZoneW/nat.w, imgZoneH/nat.h);
        const dispW=Math.round(nat.w*scale);
        const dispH=Math.round(nat.h*scale);
        setDisplaySize({w:dispW,h:dispH});
        const initSize=Math.round(Math.min(dispW,dispH)*0.85);
        setCropSize(initSize);
        setCropX((dispW-initSize)/2);
        setCropY((dispH-initSize)/2);
      };
      img.src=imgSrc;
    };
    if(src.startsWith("data:")){
      load(src);
    } else {
      // Proxy through backend so canvas never taints (CDN CORS blocks direct fetch)
      fetch("/api/proxy-image", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({url:src})
      })
        .then(r=>r.ok?r.blob():Promise.reject())
        .then(blob=>new Promise(res=>{ const r=new FileReader(); r.onload=e=>res(e.target.result); r.readAsDataURL(blob); }))
        .then(dataUrl=>load(dataUrl))
        .catch(()=>{
          // Backend failed — try direct blob fetch as last resort
          fetch(src)
            .then(r=>r.blob())
            .then(blob=>new Promise(res=>{ const r=new FileReader(); r.onload=e=>res(e.target.result); r.readAsDataURL(blob); }))
            .then(dataUrl=>load(dataUrl))
            .catch(()=>load(src));
        });
    }
  },[src]);

  const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));

  const onTouchStart=e=>{
    if(cornerDrag) return; // corner drag takes priority
    const t=e.touches[0];
    setDragging(true);
    setDragStart({x:t.clientX,y:t.clientY,cx:cropX,cy:cropY});
  };
  const onTouchMove=e=>{
    if(cornerDrag){
      e.preventDefault();
      const t=e.touches[0];
      const dx=t.clientX-cornerDrag.startX;
      const dy=t.clientY-cornerDrag.startY;
      const [hx,hy]=cornerDrag.corner;
      // hx=0 means left edge moves, hx=1 means right edge moves
      // hy=0 means top edge moves, hy=1 means bottom edge moves
      const rawDx=hx===0?-dx:dx;
      const rawDy=hy===0?-dy:dy;
      const delta=Math.max(rawDx,rawDy); // use larger axis for uniform resize
      const newSize=Math.max(60,cornerDrag.startSize+delta);
      const os=newSize*0.8;
      // Anchor the opposite corner in place
      let newX=cornerDrag.startCropX;
      let newY=cornerDrag.startCropY;
      if(hx===0) newX=cornerDrag.startCropX+cornerDrag.startSize-newSize; // left edge moves → shift X
      if(hy===0) newY=cornerDrag.startCropY+cornerDrag.startSize-newSize; // top edge moves → shift Y
      newX=clamp(newX,-os,displaySize.w-newSize+os);
      newY=clamp(newY,-os,displaySize.h-newSize+os);
      setCropSize(newSize);
      setCropX(newX);
      setCropY(newY);
      return;
    }
    if(!dragging) return;
    e.preventDefault();
    const t=e.touches[0];
    const dx=t.clientX-dragStart.x;
    const dy=t.clientY-dragStart.y;
    // Allow crop box to extend beyond image edges so item can be centered
    const overscroll=cropSize*0.8;
    setCropX(clamp(dragStart.cx+dx,-overscroll,displaySize.w-cropSize+overscroll));
    setCropY(clamp(dragStart.cy+dy,-overscroll,displaySize.h-cropSize+overscroll));
  };
  const onTouchEnd=()=>{ setDragging(false); setCornerDrag(null); };

  // Pinch to resize
  const lastPinch=useRef(null);
  const onTouchStartPinch=e=>{
    if(e.touches.length===2){
      const dx=e.touches[0].clientX-e.touches[1].clientX;
      const dy=e.touches[0].clientY-e.touches[1].clientY;
      lastPinch.current=Math.sqrt(dx*dx+dy*dy);
      return;
    }
    // Single touch — check if near a corner handle (44px hit zone)
    const t=e.touches[0];
    const rect=containerRef.current?.getBoundingClientRect();
    if(rect){
      const tx=t.clientX-rect.left; // touch relative to container
      const ty=t.clientY-rect.top;
      const corners=[[0,0],[1,0],[0,1],[1,1]];
      for(const [hx,hy] of corners){
        const cx2=cropX+(hx*cropSize);
        const cy2=cropY+(hy*cropSize);
        if(Math.abs(tx-cx2)<30&&Math.abs(ty-cy2)<30){
          setCornerDrag({corner:[hx,hy],startX:t.clientX,startY:t.clientY,startCropX:cropX,startCropY:cropY,startSize:cropSize});
          return;
        }
      }
    }
    onTouchStart(e);
  };
  const onTouchMovePinch=e=>{
    if(e.touches.length===2 && lastPinch.current){
      e.preventDefault();
      const dx=e.touches[0].clientX-e.touches[1].clientX;
      const dy=e.touches[0].clientY-e.touches[1].clientY;
      const dist=Math.sqrt(dx*dx+dy*dy);
      const delta=dist-lastPinch.current;
      lastPinch.current=dist;
      setCropSize(prev=>{
        const next=clamp(prev+delta*0.8,60,Math.max(displaySize.w,displaySize.h));
        // Keep crop within bounds
        const os=next*0.8;
        setCropX(cx=>clamp(cx,-os,displaySize.w-next+os));
        setCropY(cy=>clamp(cy,-os,displaySize.h-next+os));
        return next;
      });
    } else onTouchMove(e);
  };

  // Shared helper: crop image to base64
  const buildCroppedB64=async()=>{
    const canvas=document.createElement("canvas");
    const outputSize=600;
    canvas.width=outputSize; canvas.height=outputSize;
    const ctx=canvas.getContext("2d");
    // Use already-resolved data URL — no re-fetch needed, no CORS risk
    const imgSrc = resolvedSrcRef.current || src;
    return new Promise(resolve=>{
      const img=new Image();
      img.onload=()=>{
        try{
          const scale=imgNatural.w/displaySize.w;
          const sx=Math.round(cropX*scale);
          const sy=Math.round(cropY*scale);
          const sw=Math.round(cropSize*scale);
          const sh=Math.round(cropSize*scale);
          ctx.drawImage(img,sx,sy,sw,sh,0,0,outputSize,outputSize);
          resolve(canvas.toDataURL("image/jpeg",0.9));
        }catch(e){ resolve(src); }
      };
      img.onerror=()=>resolve(src);
      img.src=imgSrc;
    });
  };

  const applyCrop=async()=>{
    const b64=await buildCroppedB64();
    onSave(b64);
  };

  const applyWithBgRemoval=async()=>{
    setRemovingBg(true);
    setBgError(null);
    if(!resolvedSrcRef.current && !src.startsWith("data:")){
      try{
        const blob=await fetch(src).then(r=>r.blob());
        resolvedSrcRef.current=await new Promise(res=>{ const r=new FileReader(); r.onload=e=>res(e.target.result); r.readAsDataURL(blob); });
      }catch(e){}
    }
    const croppedB64=await buildCroppedB64();
    if(!croppedB64||!croppedB64.startsWith("data:")){
      if(mountedRef.current){ setRemovingBg(false); setBgError("Could not read image — try re-uploading the photo."); }
      return;
    }
    try{
      if(mountedRef.current) setBgError("Removing background…");
      const res=await fetch('/api/remove-bg',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({imageBase64:croppedB64}),
      });
      if(!res.ok){
        const err=await res.json().catch(()=>({}));
        throw new Error(err.detail||err.error||'remove.bg failed');
      }
      const data=await res.json();
      if(!data.imageBase64) throw new Error('No image returned');
      if(mountedRef.current){ setRemovingBg(false); setBgError(null); }
      onSave(data.imageBase64);
    }catch(e){
      // Fallback to client-side imgly if remove.bg fails (e.g. key not configured)
      try{
        if(mountedRef.current) setBgError("Trying local removal…");
        if(!window._imglyBgRemoval){
          const mod=await import("https://esm.sh/@imgly/background-removal@1.4.5");
          window._imglyBgRemoval=mod.removeBackground;
        }
        const fetchRes=await fetch(croppedB64);
        const blob=await fetchRes.blob();
        const resultBlob=await window._imglyBgRemoval(blob,{debug:false,model:"medium",output:{format:"image/png",quality:0.9}});
        const finalBlob=await cleanIsolatedPixels(resultBlob);
        const reader=new FileReader();
        reader.onload=ev=>{
          if(mountedRef.current) setRemovingBg(false);
          onSave(ev.target.result);
        };
        reader.readAsDataURL(finalBlob);
      }catch(e2){
        if(mountedRef.current){ setRemovingBg(false); setBgError("Background removal failed — try again."); }
      }
    }
  }

  return(
    <div style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:"#0D0D0D",zIndex:9999,display:"flex",flexDirection:"column",padding:"16px 20px 20px",boxSizing:"border-box"}}
      onTouchMove={e=>e.preventDefault()}
    >
      {/* Header — fixed 48px */}
      <div style={{..._btwn,height:48,flexShrink:0}}>
        <div style={sr(18,400)}>Crop Photo</div>
        <div style={ss(9,400,DM)}>Drag · Pinch · Corner handles</div>
      </div>

      {/* Image zone — fixed calculated height, centered */}
      <div style={{width:"100%",height:imgZoneH,display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden",flexShrink:0}}>
        <div ref={containerRef} style={{position:"relative",width:displaySize.w,height:displaySize.h,cursor:"move",touchAction:"none"}}
          onTouchStart={onTouchStartPinch} onTouchMove={onTouchMovePinch} onTouchEnd={onTouchEnd}
          onMouseDown={e=>{setDragging(true);setDragStart({x:e.clientX,y:e.clientY,cx:cropX,cy:cropY});}}
          onMouseMove={e=>{if(!dragging) return; const dx=e.clientX-dragStart.x,dy=e.clientY-dragStart.y; const os2=cropSize*0.8; setCropX(clamp(dragStart.cx+dx,-os2,displaySize.w-cropSize+os2)); setCropY(clamp(dragStart.cy+dy,-os2,displaySize.h-cropSize+os2));}}
          onMouseUp={()=>setDragging(false)}
        >
          <img ref={imgRef} src={resolvedSrcRef.current||src} style={{width:displaySize.w,height:displaySize.h,objectFit:"contain",display:"block",userSelect:"none",pointerEvents:"none",borderRadius:8}} alt="crop"/>
          <svg style={{position:"absolute",left:-cropSize,top:-cropSize,pointerEvents:"none",overflow:"visible"}}
            width={displaySize.w+cropSize*2} height={displaySize.h+cropSize*2}
            viewBox={`${-cropSize} ${-cropSize} ${displaySize.w+cropSize*2} ${displaySize.h+cropSize*2}`}>
            <defs>
              <mask id="cropMask">
                <rect width={displaySize.w} height={displaySize.h} fill="white"/>
                <rect x={cropX} y={cropY} width={cropSize} height={cropSize} rx="4" fill="black"/>
              </mask>
            </defs>
            <rect width={displaySize.w} height={displaySize.h} fill="#000000AA" mask="url(#cropMask)"/>
            <rect x={cropX} y={cropY} width={cropSize} height={cropSize} rx="4" fill="none" stroke={G} strokeWidth="2"/>
            {[1,2].map(n=>(
              <g key={n}>
                <line x1={cropX+cropSize*n/3} y1={cropY} x2={cropX+cropSize*n/3} y2={cropY+cropSize} stroke="#FFFFFF44" strokeWidth="0.5"/>
                <line x1={cropX} y1={cropY+cropSize*n/3} x2={cropX+cropSize} y2={cropY+cropSize*n/3} stroke="#FFFFFF44" strokeWidth="0.5"/>
              </g>
            ))}
            {[[0,0],[1,0],[0,1],[1,1]].map(([hx,hy])=>{
              const cx2=cropX+(hx*cropSize);
              const cy2=cropY+(hy*cropSize);
              return(
                <g key={`${hx}${hy}`}>
                  <rect x={cx2-(hx?6:-14)} y={cy2-3} width={20} height={6} rx={3} fill={G}/>
                  <rect x={cx2-3} y={cy2-(hy?6:-14)} width={6} height={20} rx={3} fill={G}/>
                </g>
              );
            })}
          </svg>
        </div>
      </div>

      {/* Footer — fixed, always visible */}
      <div style={{flexShrink:0,marginTop:12}}>
        <div style={ss(8,400,DM,{letterSpacing:1,marginBottom:6,textAlign:"center"})}>DRAG BOX · PINCH OR SLIDE TO RESIZE · DRAG CORNERS</div>
        <input type="range" min={60} max={Math.max(displaySize.w,displaySize.h)}
          value={cropSize}
          onChange={e=>setCropSize(parseInt(e.target.value))}
          style={{width:"100%",accentColor:G,marginBottom:10,display:"block"}}
        />
        {bgError&&(
          <div style={{marginBottom:8,padding:"7px 12px",borderRadius:12,
            background:bgError.startsWith("Loading")||bgError.startsWith("Removing")?"transparent":"#2A1A1A",
            border:bgError.startsWith("Loading")||bgError.startsWith("Removing")?"none":"1px solid #CC333344",
            ...ss(9,500,bgError.startsWith("Loading")||bgError.startsWith("Removing")?DM:"#CC6666",{textAlign:"center"})}}>
            {bgError}
          </div>
        )}
        <div style={{display:"flex",gap:8}}>
          <button onClick={onCancel} disabled={removingBg} style={{flex:1,padding:"14px",borderRadius:R14,background:"#1A1A1A",border:"1px solid #2A2A2A",...ss(10,600,DM,{letterSpacing:1}),cursor:_p,opacity:removingBg?0.5:1}}>CANCEL</button>
          {saveLabel ? (
            // Simplified 2-button mode: Cancel + Save (auto-does bg removal if removeBgOnSave)
            <button onClick={removeBgOnSave ? applyWithBgRemoval : applyCrop} disabled={removingBg}
              style={{flex:2,padding:"14px",borderRadius:R14,background:removingBg?"#2A2A2A":`linear-gradient(135deg,${G},#8A6E54)`,border:"none",...ss(10,700,removingBg?DM:BK,{letterSpacing:1}),cursor:_p,transition:"all 0.3s"}}>
              {removingBg?"REMOVING BG...":saveLabel}
            </button>
          ) : (
            // Full 3-button mode for other flows
            <React.Fragment>
              <button onClick={applyCrop} disabled={removingBg} style={{flex:1,padding:"14px",borderRadius:R14,background:"#1A1A1A",border:`1px solid ${G}`,...ss(10,600,G,{letterSpacing:1}),cursor:_p,opacity:removingBg?0.5:1}}>CROP</button>
              <button onClick={applyWithBgRemoval} disabled={removingBg} style={{flex:2,padding:"14px",borderRadius:R14,background:removingBg?"#2A2A2A":`linear-gradient(135deg,${G},#8A6E54)`,border:"none",...ss(9,700,removingBg?DM:BK,{letterSpacing:0.8}),cursor:_p,transition:"all 0.3s"}}>
                {removingBg?"REMOVING BG...":"CROP & REMOVE BACKGROUND"}
              </button>
            </React.Fragment>
          )}
        </div>
      </div>
    </div>
  );
}

function SwipeRow({label,arr,idx,setIdx,emoji,isLocked,onLockToggle,onMarkUnavailable,onCycleEnd}){
  const touchStartX=useRef(null);
  const touchStartY=useRef(null);
  const [dragX,setDragX]=useState(0);
  const [dragging,setDragging]=useState(false);
  const [flying,setFlying]=useState(0);
  const [isScrolling,setIsScrolling]=useState(false);
  const [showLaundry,setShowLaundry]=useState(false);
  const pressTimer=useRef(null);
  const lastTap=useRef(0);
  const didLongPress=useRef(false);

  const item    = arr[idx]||null;
  const nextItem= arr[(idx+1)%arr.length]||null;
  const prevItem= arr[(idx-1+arr.length)%arr.length]||null;
  const THRESHOLD=80;

  const cycle=(dir)=>{ setIdx(i=>(i+dir+arr.length)%arr.length); onCycleEnd(); };

  const onTouchStart=e=>{
    if(showLaundry) return;
    didLongPress.current=false;
    touchStartX.current=e.touches[0].clientX;
    touchStartY.current=e.touches[0].clientY;
    setDragging(true); setIsScrolling(false);
    pressTimer.current=setTimeout(()=>{
      didLongPress.current=true;
      setDragging(false); setDragX(0);
      setShowLaundry(true);
    },480);
  };

  const onTouchMove=e=>{
    if(isScrolling) return;
    const dx=e.touches[0].clientX-touchStartX.current;
    const dy=e.touches[0].clientY-touchStartY.current;
    if(!dragging) return;
    if(Math.abs(dy)>Math.abs(dx)&&Math.abs(dx)<10){ setIsScrolling(true); setDragging(false); clearTimeout(pressTimer.current); return; }
    if(Math.abs(dx)>10||Math.abs(dy)>10) clearTimeout(pressTimer.current);
    e.preventDefault();
    setDragX(dx);
  };

  const onTouchEnd=e=>{
    clearTimeout(pressTimer.current);
    if(didLongPress.current){ setDragging(false); setDragX(0); return; }
    if(isScrolling){ setDragging(false); setDragX(0); return; }
    const now=Date.now();
    if(now-lastTap.current<300 && Math.abs(dragX)<10){
      lastTap.current=0;
      onLockToggle();
      setDragging(false); setDragX(0);
      return;
    }
    lastTap.current=now;
    if(Math.abs(dragX)>=THRESHOLD){ setFlying(dragX<0?-1:1); }
    else { setDragX(0); setDragging(false); }
  };

  const onFlyEnd=()=>{
    if(flying!==0) cycle(flying<0?1:-1);
    setFlying(0); setDragX(0); setDragging(false);
  };

  if(arr.length===0) return(
    <div style={{borderRadius:R18,overflow:"hidden",marginBottom:6,background:CD,border:`1px solid ${BR}`,height:130,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:8}}>
      <div style={{fontSize:32}}>{emoji}</div>
      <div style={ss(9,400,DM,{fontStyle:"italic"})}>No {label.toLowerCase()} available</div>
    </div>
  );

  const rot=dragging||flying!==0 ? (dragX+(flying!==0?flying*400:0))/18 : 0;
  const flyX=flying!==0 ? flying*500 : dragX;
  const dragPct=Math.min(1,Math.abs(dragX)/THRESHOLD);
  const behindItem=dragX<0||flying===-1 ? nextItem : prevItem;
  const cardBorder=isLocked?`2px solid ${G}`:`1px solid ${item.color}44`;

  return(
    <div style={{position:"relative",height:180,marginBottom:10,touchAction:"pan-y",paddingLeft:20,paddingRight:20,boxSizing:"border-box"}}>
      {/* Behind card peek */}
      {behindItem&&arr.length>1&&(dragging||(flying!==0))&&(
        <div style={{position:"absolute",top:0,bottom:0,left:20,right:20,borderRadius:R18,overflow:"hidden",background:"linear-gradient(135deg,#1A1510,#1E1A14)",border:`1px solid ${behindItem.color}33`,transform:`scale(${0.94+dragPct*0.06})`,transition:"transform 0.1s",display:"flex",alignItems:"center"}}>
          <div style={{width:"42%",height:"100%",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden",padding:"12px 0 12px 12px",boxSizing:"border-box"}}>
            {behindItem.sourceImage
              ? <img src={behindItem.sourceImage} style={{maxWidth:"100%",maxHeight:"100%",objectFit:"contain"}} alt={behindItem.name}/>
              : <ItemIllustration item={behindItem} size={90}/>
            }
          </div>
          <div style={{flex:1,padding:"0 20px",minWidth:0}}>
            <div style={ss(8,600,DM,{letterSpacing:2,marginBottom:6})}>{label.toUpperCase()}</div>
            <div style={sr(19,400,"#F0EBE3",{lineHeight:1.35,marginBottom:5})}>{behindItem.name}</div>
            <div style={ss(11,400,DM)}>{behindItem.brand}</div>
          </div>
        </div>
      )}

      {/* Front card — positioned within the padded area */}
      <div key={idx} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTransitionEnd={flying!==0?onFlyEnd:undefined}
        style={{
          position:"absolute",top:0,bottom:0,left:20,right:20,
          borderRadius:R18,overflow:"hidden",
          background:"linear-gradient(135deg,#1A1510,#1E1A14)",
          border:isLocked?`1.5px solid ${G}`:`1px solid ${item.color}44`,
          boxShadow:isLocked?`0 0 0 1px ${G}44`:"none",
          transform:`translateX(${flyX}px) rotate(${rot}deg)`,
          transition:flying!==0?"transform 0.32s cubic-bezier(0.25,0.46,0.45,0.94)":dragging?"none":"transform 0.25s ease-out",
          cursor:"grab",userSelect:"none",touchAction:"pan-y",
          display:"flex",alignItems:"center",
        }}>

        {/* Image — left ~42% */}
        <div style={{width:"42%",height:"100%",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden",padding:"12px 0 12px 12px",boxSizing:"border-box"}}>
          {item.sourceImage
            ? <img src={item.sourceImage} style={{maxWidth:"100%",maxHeight:"100%",objectFit:"contain"}} alt={item.name}/>
            : <ItemIllustration item={item} size={100}/>
          }
        </div>

        {/* Divider */}
        <div style={{width:1,height:"60%",background:"#2A2A2A",flexShrink:0}}/>

        {/* Text — right side */}
        <div style={{flex:1,padding:"0 22px",minWidth:0}}>
          <div style={ss(8,600,DM,{letterSpacing:2,marginBottom:6})}>{label.toUpperCase()}</div>
          <div style={sr(19,400,"#F0EBE3",{lineHeight:1.35,marginBottom:5})}>{item.name}</div>
          <div style={ss(11,400,DM)}>{item.brand}</div>
          {isLocked&&(
            <div onClick={e=>{e.stopPropagation();onLockToggle();}} style={{marginTop:8,display:"inline-flex",alignItems:"center",gap:4,background:`${G}22`,border:`1px solid ${G}44`,borderRadius:8,padding:"3px 10px",cursor:_p,...ss(8,600,G,{letterSpacing:0.5})}}>🔒 LOCKED</div>
          )}
          {item.forSale&&!isLocked&&(
            <div style={{marginTop:8,display:"inline-block",background:G,borderRadius:8,padding:"3px 10px",...ss(8,700,BK,{letterSpacing:1})}}>FOR SALE</div>
          )}
        </div>

        {/* Swipe hints */}
        {dragX<-20&&<div style={{position:"absolute",top:14,right:14,border:"2px solid #E08080",borderRadius:12,padding:"3px 10px",...ss(10,700,"#E08080",{letterSpacing:2}),opacity:Math.min(1,(-dragX-20)/60),transform:"rotate(-4deg)"}}>NEXT</div>}
        {dragX>20&&<div style={{position:"absolute",top:14,left:14,border:"2px solid #80C880",borderRadius:12,padding:"3px 10px",...ss(10,700,"#80C880",{letterSpacing:2}),opacity:Math.min(1,(dragX-20)/60),transform:"rotate(4deg)"}}>PREV</div>}

        {/* Laundry overlay */}
        {showLaundry&&(
          <div style={{..._abs0,background:"#0D0D0DEE",borderRadius:R18,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:10,zIndex:10}}
            onTouchStart={e=>e.stopPropagation()} onTouchEnd={e=>e.stopPropagation()} onClick={e=>e.stopPropagation()}>
            <div style={sr(14,400,"#E8E0D4")}>Remove from rotation?</div>
            <div style={{display:"flex",gap:8}}>
              <button onTouchEnd={e=>{e.stopPropagation();onMarkUnavailable(item.id);setShowLaundry(false);}} onClick={e=>{e.stopPropagation();onMarkUnavailable(item.id);setShowLaundry(false);}}
                style={{padding:"9px 18px",borderRadius:12,background:"#2A1A0A",border:"1px solid #5A3A1A",cursor:_p,...ss(10,600,"#C8A060",{letterSpacing:0.5})}}>🧺 In Laundry</button>
              <button onTouchEnd={e=>{e.stopPropagation();setShowLaundry(false);}} onClick={e=>{e.stopPropagation();setShowLaundry(false);}}
                style={{padding:"9px 14px",borderRadius:12,background:_1a,border:_2a,cursor:_p,...ss(10,400,MD)}}>Cancel</button>
            </div>
          </div>
        )}
      </div>

      {/* Dot indicators */}
      {arr.length>1&&(
        <div style={{position:"absolute",bottom:-18,left:0,right:0,display:"flex",justifyContent:"center",gap:4}}>
          {arr.map((_,i)=><div key={i} style={{width:i===idx?16:5,height:5,borderRadius:3,background:i===idx?G:"#2A2A2A",transition:"width 0.2s,background 0.2s"}}/>)}
        </div>
      )}
    </div>
  );
}

// ── MIX & MATCH BUILDER ──────────────────────────────────────────────────────
function MixMatchBuilder({tops,bottoms,shoes,outerwear,accessories,showToast,logWear,outfits,setOutfits,setItems,items,onNewLook,onSaveOutfit,styleProfile={},saveStyleProfile,postWearFeedEvent,onboardStep=4,advanceOnboard,aiTrigger=0,weatherData=null}){
  // Parse real temp from weatherData (e.g. "62°F") — fall back to 65 (neutral)
  const TEMP = weatherData?.temp ? (parseInt(weatherData.temp)||65) : 65;
  const WEATHER_STR = weatherData ? `${weatherData.temp}, ${weatherData.condition}` : "65°F, Clear";
  const [ti,setTi]=useState(0);
  const [bi,setBi]=useState(0);
  const [si,setSi]=useState(0);
  const [oi,setOi]=useState(0); // outerwear index
  const [ai,setAi]=useState(0); // accessory index
  const [saved,setSaved]=useState(false);
  const [aiLoading,setAiLoading]=useState(false);
  const [aiVibe,setAiVibe]=useState(null);
  const [lastAiCombo,setLastAiCombo]=useState(null); // persists for thumbs rating
  const [mixFeedbackRating,setMixFeedbackRating]=useState(null); // 'up'|'down'
  const [mixFeedbackText,setMixFeedbackText]=useState("");
  const [mixFeedbackProcessing,setMixFeedbackProcessing]=useState(false);
  const [unavailable,setUnavailable]=useState(new Set());
  const [locked,setLocked]=useState({top:false,bottom:false,shoe:false,outerwear:false,accessory:false});
  // Outerwear auto-on when cold (< 65°F), accessories off by default
  const [showOuterwear,setShowOuterwear]=useState(false);
  const [showAccessories,setShowAccessories]=useState(false);
  const [dressMode,setDressMode]=useState(false);
  const [showSaveModal,setShowSaveModal]=useState(false);
  const [saveOutfitName,setSaveOutfitName]=useState("");

  // Filter each array removing unavailable items
  const avTopsAll    = tops.filter(i=>!unavailable.has(i.id));
  // In dress mode, only show Dresses; otherwise show everything
  const avTops       = dressMode ? avTopsAll.filter(i=>i.category==="Dresses") : avTopsAll;
  const avBottoms    = bottoms.filter(i=>!unavailable.has(i.id));
  const avShoes      = shoes.filter(i=>!unavailable.has(i.id));
  const avOuterwear  = outerwear.filter(i=>!unavailable.has(i.id));
  const avAccessories= accessories.filter(i=>!unavailable.has(i.id));

  // Clamp indices to filtered array bounds
  const tSafe = Math.min(ti, Math.max(0, avTops.length-1));
  const bSafe = Math.min(bi, Math.max(0, avBottoms.length-1));
  const sSafe = Math.min(si, Math.max(0, avShoes.length-1));
  const oSafe = Math.min(oi, Math.max(0, avOuterwear.length-1));
  const acSafe= Math.min(ai, Math.max(0, avAccessories.length-1));

  const top       = avTops[tSafe]       || null;
  const bottom    = avBottoms[bSafe]    || null;
  const shoe      = avShoes[sSafe]      || null;
  const outer     = avOuterwear[oSafe]  || null;
  const accessory = avAccessories[acSafe]|| null;

  // Suppress bottoms when dress mode is on OR when current top is a Dress
  const isDress = dressMode || top?.category === "Dresses";

  const cycle=(setter,arr,dir)=> setter(i=>(i+dir+arr.length)%arr.length);

  const toggleLock=(row)=>{
    setLocked(prev=>{
      const next={...prev,[row]:!prev[row]};
      showToast(next[row]?"🔒 Locked in":"🔓 Unlocked");
      return next;
    });
  };

  const markUnavailable=(id)=>{
    setUnavailable(prev=>new Set([...prev,id]));
    setAiVibe(null);
    showToast("🧺 Moved to laundry — won't appear in suggestions");
  };

  const restoreAll=()=>{
    setUnavailable(new Set());
    showToast("All items restored \u2746");
  };

  const suggestWithAI=async()=>{
    if(aiLoading) return;
    setAiLoading(true); setAiVibe(null); setLastAiCombo(null);
    const weather=WEATHER_STR;

    // Build style profile context for the prompt
    const profileParts = [];
    if(styleProfile.aesthetic?.length) profileParts.push(`Aesthetic: ${styleProfile.aesthetic.join(", ")}`);
    if(styleProfile.occasions?.length) profileParts.push(`Dresses for: ${styleProfile.occasions.join(", ")}`);
    if(styleProfile.fitPref?.length) profileParts.push(`Fit preference: ${styleProfile.fitPref.join(", ")}`);
    if(styleProfile.colorPalette) profileParts.push(`Color palette: ${styleProfile.colorPalette}`);
    if(styleProfile.styleIcons) profileParts.push(`Style reference: ${styleProfile.styleIcons}`);

    // ── FEEDBACK INTEGRATION: treat all negative signals as hard avoids ──
    const avoids = [
      ...(styleProfile.avoidPairings||[]),
      ...(styleProfile.learnedDislikes||[]),
    ];
    if(avoids.length) profileParts.push(`AVOID these combinations and styles (user has explicitly disliked): ${avoids.join("; ")}`);

    // Positive learnings
    const loves = styleProfile.learnedLoves||[];
    if(loves.length) profileParts.push(`User loves: ${loves.join("; ")}`);

    // ── RECENTLY SHOWN: force variety by excluding last 3 combos ──
    const recentCombos = (styleProfile.likedCombos||[]).slice(-3)
      .concat((styleProfile.dislikedCombos||[]).slice(-3))
      .map(c=>c.names?.join(" + ")).filter(Boolean);
    if(recentCombos.length) profileParts.push(`DO NOT suggest these recently-shown combinations again: ${recentCombos.join(" | ")}`);

    // ── RANDOMNESS: pick a random style direction to vary results ──
    const moods = ["casual cool","elevated basics","smart casual","relaxed luxury","street-inspired","classic refined","minimal clean","layered textural"];
    const todayMood = moods[Math.floor(Math.random() * moods.length)];
    profileParts.push(`For this suggestion, lean toward a ${todayMood} direction`);

    const profileContext = profileParts.length
      ? `\nUser style profile — use as HARD guidance:\n${profileParts.map(p=>`• ${p}`).join("\n")}\n`
      : "";

    const needTop      = !locked.top       || !top;
    const needBottom   = !isDress && (!locked.bottom || !bottom);
    const needShoe     = !locked.shoe      || !shoe;
    const needOuterwear= showOuterwear  && (!locked.outerwear || !outer);
    const needAccessory= showAccessories && (!locked.accessory || !accessory);

    const topList    = avTops.map(i=>i.name).join(" | ");
    const bottomList = avBottoms.map(i=>i.name).join(" | ");
    const shoeList   = avShoes.map(i=>i.name).join(" | ");
    const outerList  = avOuterwear.map(i=>i.name).join(" | ");
    const acList     = avAccessories.map(i=>i.name).join(" | ");

    const lockedParts=[];
    if(!needTop       && top)       lockedParts.push(`top is locked as "${top.name}"`);
    if(!needBottom    && bottom)    lockedParts.push(`bottom is locked as "${bottom.name}"`);
    if(!needShoe      && shoe)      lockedParts.push(`shoe is locked as "${shoe.name}"`);
    if(!needOuterwear && outer)     lockedParts.push(`outerwear is locked as "${outer.name}"`);
    if(!needAccessory && accessory) lockedParts.push(`accessory is locked as "${accessory.name}"`);
    const constraint = lockedParts.length ? `Locked items (do NOT change these): ${lockedParts.join("; ")}. ` : "";

    const wantFields = [
      needTop        && avTops.length>0        ? `"top": one name from [${topList}]` : null,
      needBottom     && avBottoms.length>0     ? `"bottom": one name from [${bottomList}]` : null,
      needShoe       && avShoes.length>0       ? `"shoe": one name from [${shoeList}]` : null,
      needOuterwear  && avOuterwear.length>0   ? `"outerwear": one name from [${outerList}]` : null,
      needAccessory  && avAccessories.length>0 ? `"accessory": one name from [${acList}]` : null,
      `"vibe": 2-3 word style description`,
    ].filter(Boolean).join(", ");

    const prompt = `Weather: ${weather}.${profileContext} ${constraint}Pick a stylish outfit. You MUST choose exact names from the lists provided. Return ONLY JSON with these fields: {${wantFields}}`;

    const findIdx=(arr,name)=>{
      if(!name) return -1;
      const lower=name.toLowerCase().trim();
      let idx=arr.findIndex(i=>i.name.toLowerCase()===lower);
      if(idx<0) idx=arr.findIndex(i=>i.name.toLowerCase().includes(lower)||lower.includes(i.name.toLowerCase()));
      return idx;
    };
    const differentIdx=(arr,current)=> arr.length<=1 ? 0 : (current+1)%arr.length;

    try{
      const raw=await callClaude(prompt);
      const json=JSON.parse(raw.replace(/```json|```/g,"").trim());
      if(needTop       && avTops.length>0)        setTi(idx=>{ const i=findIdx(avTops,json.top);        return i>=0?i:differentIdx(avTops,tSafe); });
      if(needBottom    && avBottoms.length>0)     setBi(idx=>{ const i=findIdx(avBottoms,json.bottom);  return i>=0?i:differentIdx(avBottoms,bSafe); });
      if(needShoe      && avShoes.length>0)       setSi(idx=>{ const i=findIdx(avShoes,json.shoe);      return i>=0?i:differentIdx(avShoes,sSafe); });
      if(needOuterwear && avOuterwear.length>0)   setOi(idx=>{ const i=findIdx(avOuterwear,json.outerwear); return i>=0?i:differentIdx(avOuterwear,oSafe); });
      if(needAccessory && avAccessories.length>0) setAi(idx=>{ const i=findIdx(avAccessories,json.accessory); return i>=0?i:differentIdx(avAccessories,acSafe); });
      setAiVibe(json.vibe||"AI Pick");
      setLastAiCombo({vibe:json.vibe||"AI Pick"});
      setSaveOutfitName(json.vibe||"AI Pick");
    }catch(e){
      if(needTop)       setTi(differentIdx(avTops,tSafe));
      if(needBottom)    setBi(differentIdx(avBottoms,bSafe));
      if(needShoe)      setSi(differentIdx(avShoes,sSafe));
      if(needOuterwear) setOi(differentIdx(avOuterwear,oSafe));
      if(needAccessory) setAi(differentIdx(avAccessories,acSafe));
      setAiVibe("AI Pick");
      setLastAiCombo({vibe:"AI Pick"});
      setSaveOutfitName("AI Pick");
    }
    setAiLoading(false);
    showToast("AI styled your look \u2746");
  };

  // Fire suggestWithAI when parent increments aiTrigger (weather-row button)
  useEffect(()=>{ if(aiTrigger>0) suggestWithAI(); },[aiTrigger]);

  // Auto-suggest on first open of the day — silent background generation
  useEffect(()=>{
    if(items.length < 3) return; // need enough items to make a suggestion
    const today = new Date().toDateString();
    const lastDate = localStorage.getItem('outfix_last_ai_suggest');
    if(lastDate === today) return; // already suggested today
    localStorage.setItem('outfix_last_ai_suggest', today);
    // Small delay so component fully mounts before firing
    const t = setTimeout(()=>suggestWithAI(), 600);
    return ()=>clearTimeout(t);
  },[]);

  const saveCurrentAsOutfit=async()=>{
    const combo=[top, isDress?null:bottom, shoe, showOuterwear?outer:null, showAccessories?accessory:null].filter(Boolean);
    if(combo.length<2){showToast("Need at least 2 items to save \u2746");return;}
    const name=saveOutfitName.trim()||combo.map(i=>i.name.split(" ")[0]).join(" + ");
    const newOutfit={id:Date.now(),name,items:combo.map(i=>i.id),occasion:"Casual",season:"All Year",wornHistory:[]};
    setOutfits(prev=>[...prev,newOutfit]);
    if(typeof onSaveOutfit==="function"){const saved=await onSaveOutfit(newOutfit);if(saved?.id)newOutfit.id=saved.id;}
    if(postWearFeedEvent) postWearFeedEvent(name, combo);
    if(advanceOnboard) advanceOnboard(3);
    setShowSaveModal(false); setSaveOutfitName("");
    showToast(`"${name}" saved as outfit \u2746`);
  };

  const wearToday=()=>{
    const combo=[top, isDress?null:bottom, shoe,
      showOuterwear?outer:null,
      showAccessories?accessory:null
    ].filter(Boolean);
    if(combo.length===0){showToast("Add pieces to your closet first \u2746");return;}
    const today = new Date();
    const key = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;
    const displayDate = today.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"});
    const comboIds = combo.map(i=>i.id);
    // Update or create a "Mix & Match" outfit with today's wear logged
    setOutfits(prev=>{
      const existing = prev.find(o=>o.name==="Mix & Match");
      if(existing){
        const alreadyLogged = (existing.wornHistory||[]).includes(key);
        const newHistory = alreadyLogged ? existing.wornHistory : [key,...(existing.wornHistory||[])];
        return prev.map(o=>o.id===existing.id ? {...o, items:comboIds, wornHistory:newHistory} : o);
      }
      return [...prev, {id:Date.now(),name:"Mix & Match",items:comboIds,occasion:"Casual",season:"All Year",wornHistory:[key]}];
    });
    // Increment wear count on each item
    setItems(prev=>prev.map(i=>{
      if(!comboIds.includes(i.id)) return i;
      return {...i, wearCount:i.wearCount+1, lastWorn:displayDate};
    }));
    setSaved(true); setAiVibe(null);
    showToast(`${combo.map(i=>i.name.split(" ")[0]).join(" + ")} — logged for today \u2746`);
    if(postWearFeedEvent) postWearFeedEvent(combo.map(i=>i.name.split(" ")[0]).join(" + "), combo);
    setTimeout(()=>setSaved(false),3000);
  };

  return(
    <div style={{marginBottom:18}}>

      {/* Header row — with thumbs inline when AI has generated */}
      <div style={{..._btwn,marginBottom:10}}>
        <div>
          <div style={sr(18,400)}>Mix & Match</div>
          <div style={ss(9,400,DM,{letterSpacing:1,marginTop:1})}>SWIPE  ·  HOLD TO REMOVE  ·  TAP TWICE TO LOCK</div>
        </div>
        {lastAiCombo && !aiLoading && (
          <div style={{display:"flex",gap:6,alignItems:"center",flexShrink:0}}>
            <div style={ss(8,400,DM)}>Rate:</div>
            <button onClick={()=>{ setMixFeedbackRating(r=>r==="up"?null:"up"); setMixFeedbackText(""); }}
              style={{width:30,height:30,borderRadius:"50%",background:mixFeedbackRating==="up"?"#1A2A1A":"#111",border:mixFeedbackRating==="up"?"1px solid #2A4A2A":"1px solid #2A2A2A",cursor:_p,fontSize:14,display:"flex",alignItems:"center",justifyContent:"center"}}>
              👍
            </button>
            <button onClick={()=>{ setMixFeedbackRating(r=>r==="down"?null:"down"); setMixFeedbackText(""); }}
              style={{width:30,height:30,borderRadius:"50%",background:mixFeedbackRating==="down"?"#2A1A1A":"#111",border:mixFeedbackRating==="down"?"1px solid #4A2A2A":"1px solid #2A2A2A",cursor:_p,fontSize:14,display:"flex",alignItems:"center",justifyContent:"center"}}>
              👎
            </button>
          </div>
        )}
      </div>

      {/* Laundry restore pill */}
      {unavailable.size>0&&(
        <div style={{..._btwn,background:"#2A1A0A",border:"1px solid #4A3020",borderRadius:12,padding:"7px 12px",marginBottom:10}}>
          <div style={ss(9,400,"#C8A060")}>🧺 {unavailable.size} item{unavailable.size>1?"s":""} in laundry</div>
          <button onClick={restoreAll} style={{background:"none",border:"none",cursor:_p,...ss(9,600,"#C8A060",{letterSpacing:0.5})}}>RESTORE ALL</button>
        </div>
      )}

      {/* ── AI FEEDBACK (shown after AI generates) ── */}
      {lastAiCombo && !aiLoading && (
        <div style={{marginBottom:14}}>
          {mixFeedbackRating&&(
            <div style={{background:"#0F0F0F",borderRadius:12,padding:"12px",border:`1px solid ${G}33`}}>
              <div style={ss(9,600,G,{letterSpacing:1,marginBottom:8})}>
                {mixFeedbackRating==="up"?"WHAT DID YOU LOVE ABOUT THIS?":"WHAT DIDN'T WORK FOR YOU?"}
              </div>
              <textarea
                value={mixFeedbackText}
                onChange={e=>setMixFeedbackText(e.target.value)}
                placeholder={mixFeedbackRating==="up"?"e.g. Love the color combo, works great for weekends...":"e.g. Too casual, colors don't match my style..."}
                style={{width:"100%",boxSizing:"border-box",background:"#1A1A1A",border:"1px solid #2A2A2A",borderRadius:8,padding:"10px 12px",...ss(11,400,MD),color:"#C0B8B0",outline:"none",resize:"none",height:72,lineHeight:1.4}}
              />
              <div style={{display:"flex",gap:8,marginTop:8}}>
                <button onClick={()=>{
                  const combo=[top,isDress?null:bottom,shoe,showOuterwear?outer:null,showAccessories?accessory:null].filter(Boolean);
                  const names=combo.map(i=>i.name);
                  if(mixFeedbackRating==="up"){
                    if(saveStyleProfile) saveStyleProfile({likedCombos:[...(styleProfile.likedCombos||[]),{names,vibe:lastAiCombo.vibe,ts:Date.now()}].slice(-20)});
                  } else {
                    if(saveStyleProfile) saveStyleProfile({dislikedCombos:[...(styleProfile.dislikedCombos||[]),{names,vibe:lastAiCombo.vibe,ts:Date.now()}].slice(-20)});
                  }
                  setLastAiCombo(null);
                  setMixFeedbackRating(null);
                  setMixFeedbackText("");
                  showToast("Noted — AI will remember \u2746");
                }} style={{flex:1,padding:"8px",borderRadius:12,background:"#1A1A1A",border:"1px solid #2A2A2A",...ss(9,600,DM,{letterSpacing:0.8}),cursor:_p}}>SKIP</button>
                <button disabled={mixFeedbackProcessing} onClick={async()=>{
                  const combo=[top,isDress?null:bottom,shoe,showOuterwear?outer:null,showAccessories?accessory:null].filter(Boolean);
                  const names=combo.map(i=>i.name);
                  setMixFeedbackProcessing(true);
                  try{
                    const profileSummary=JSON.stringify({
                      aesthetic:styleProfile.aesthetic,occasions:styleProfile.occasions,
                      fitPref:styleProfile.fitPref,avoidPairings:styleProfile.avoidPairings,
                      colorPalette:styleProfile.colorPalette,
                      learnedLoves:styleProfile.learnedLoves||[],
                      learnedDislikes:styleProfile.learnedDislikes||[],
                    });
                    const raw=await callClaude(`You are a personal stylist AI. A user rated an outfit combo.
Outfit items: "${names.join(", ")}" (vibe: ${lastAiCombo.vibe||"AI Pick"})
Rating: ${mixFeedbackRating==="up"?"👍 Thumbs Up":"👎 Thumbs Down"}
User explanation: "${mixFeedbackText||"No explanation given"}"
Current style profile: ${profileSummary}
Based on this feedback, return ONLY valid JSON with new learnings to ADD (max 10 each, keep concise):
{"learnedLoves":[],"learnedDislikes":[],"avoidPairings":[]}`);
                    const updates=JSON.parse(raw.replace(/```json|```/g,"").trim());
                    const merged={
                      likedCombos:mixFeedbackRating==="up"?[...(styleProfile.likedCombos||[]),{names,vibe:lastAiCombo.vibe,ts:Date.now()}].slice(-20):(styleProfile.likedCombos||[]),
                      dislikedCombos:mixFeedbackRating==="down"?[...(styleProfile.dislikedCombos||[]),{names,vibe:lastAiCombo.vibe,ts:Date.now()}].slice(-20):(styleProfile.dislikedCombos||[]),
                      learnedLoves:[...new Set([...(styleProfile.learnedLoves||[]),...(updates.learnedLoves||[])])].slice(-10),
                      learnedDislikes:[...new Set([...(styleProfile.learnedDislikes||[]),...(updates.learnedDislikes||[])])].slice(-10),
                      avoidPairings:[...new Set([...(styleProfile.avoidPairings||[]),...(updates.avoidPairings||[])])].slice(-10),
                    };
                    if(saveStyleProfile) await saveStyleProfile(merged);
                    showToast("Style profile updated ✦");
                  }catch(e){ showToast("Noted \u2746"); }
                  finally{
                    setMixFeedbackProcessing(false);
                    setLastAiCombo(null);
                    setMixFeedbackRating(null);
                    setMixFeedbackText("");
                  }
                }} style={{flex:2,padding:"8px",borderRadius:12,background:mixFeedbackProcessing?"#1A1A1A":`linear-gradient(135deg,${G},#8A6E54)`,border:"none",...ss(9,700,mixFeedbackProcessing?DM:BK,{letterSpacing:0.8}),cursor:_p,opacity:mixFeedbackProcessing?0.6:1}}>
                  {mixFeedbackProcessing?"LEARNING…":"SAVE FEEDBACK"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── ROW TOGGLES + NEW LOOK ── */}
      <div style={{display:"flex",gap:5,marginBottom:14,alignItems:"center",flexWrap:"nowrap",overflow:"hidden"}}>
        <div style={ss(9,400,DM,{alignSelf:"center",marginRight:2,letterSpacing:0.5,flexShrink:0,whiteSpace:"nowrap"})}>Add row:</div>
        <button onClick={()=>setShowOuterwear(v=>!v)}
          style={{padding:"5px 10px",borderRadius:R18,background:showOuterwear?`${G}22`:_1a,border:showOuterwear?`1px solid ${G}66`:_2a,cursor:_p,...ss(9,showOuterwear?600:400,showOuterwear?G:DM,{letterSpacing:0.5}),display:"flex",alignItems:"center",gap:3,flexShrink:0,whiteSpace:"nowrap"}}>
          <span>🧥</span> Outerwear {TEMP<65&&!showOuterwear?<span style={{fontSize:7,background:"#2A3A2A",color:"#80C080",borderRadius:4,padding:"1px 4px",marginLeft:2}}>cold</span>:null}
        </button>
        <button onClick={()=>setShowAccessories(v=>!v)}
          style={{padding:"5px 10px",borderRadius:R18,background:showAccessories?`${G}22`:_1a,border:showAccessories?`1px solid ${G}66`:_2a,cursor:_p,...ss(9,showAccessories?600:400,showAccessories?G:DM,{letterSpacing:0.5}),display:"flex",alignItems:"center",gap:3,flexShrink:0,whiteSpace:"nowrap"}}>
          <span>💍</span> Accessories
        </button>
        <button onClick={()=>{setDressMode(v=>!v);setTi(0);setAiVibe(null);}}
          style={{padding:"5px 10px",borderRadius:R18,background:dressMode?`${G}22`:_1a,border:dressMode?`1px solid ${G}66`:_2a,cursor:_p,...ss(9,dressMode?600:400,dressMode?G:DM,{letterSpacing:0.5}),display:"flex",alignItems:"center",gap:3,flexShrink:0,whiteSpace:"nowrap"}}>
          <span>👗</span> Dresses
        </button>
        <button onClick={onNewLook} title="Build new look" style={{marginLeft:"auto",width:32,height:32,borderRadius:12,background:CD,border:`1px solid ${BR}`,display:"flex",alignItems:"center",justifyContent:"center",cursor:_p,flexShrink:0,...ss(18,300,MD)}}>+</button>
      </div>

      {/* ── AI VIBE NAME — shown below pill row, above clothing rows ── */}
      {aiVibe&&(
        <div style={{marginBottom:10}}>
          <div style={{..._row,gap:8,alignItems:"center",background:`${G}10`,borderRadius:12,padding:"10px 14px",border:`1px solid ${G}33`}}>
            <span style={{fontSize:16}}>✦</span>
            <input
              value={saveOutfitName||aiVibe}
              onChange={e=>setSaveOutfitName(e.target.value)}
              style={{flex:1,background:"none",border:"none",outline:"none",...ss(16,500,G,{letterSpacing:0.5}),color:G}}
            />
            <div style={ss(8,400,DM,{flexShrink:0})}>tap to rename</div>
          </div>
        </div>
      )}

      {/* Rows — Outerwear first when enabled */}
      {aiLoading&&(
        <AILoader label="Styling your look" detail="Picking the perfect combination" size="lg"/>
      )}
      {showOuterwear&&avOuterwear.length>0&&(
        <React.Fragment>
          <SwipeRow label="Outerwear"   arr={avOuterwear}   idx={oSafe}  setIdx={setOi} emoji="🧥" isLocked={locked.outerwear} onLockToggle={()=>toggleLock("outerwear")} onMarkUnavailable={markUnavailable} onCycleEnd={()=>setAiVibe(null)}/>
          <div style={{height:28}}/>
        </React.Fragment>
      )}
      {showOuterwear&&avOuterwear.length===0&&(
        <div style={{borderRadius:R14,background:CD,border:`1px solid ${BR}`,height:60,display:"flex",alignItems:"center",justifyContent:"center",marginBottom:8,...ss(9,400,DM,{fontStyle:"italic"})}}>No outerwear in your closet yet</div>
      )}
      <SwipeRow label={isDress?"Dress":"Tops"} arr={avTops} idx={tSafe} setIdx={setTi} emoji="👚" isLocked={locked.top} onLockToggle={()=>toggleLock("top")} onMarkUnavailable={markUnavailable} onCycleEnd={()=>setAiVibe(null)}/>
      {dressMode&&avTops.length===0&&(
        <div style={{borderRadius:R14,background:CD,border:`1px solid ${BR}`,height:60,display:"flex",alignItems:"center",justifyContent:"center",marginBottom:8,...ss(9,400,DM,{fontStyle:"italic"})}}>No dresses in your closet yet</div>
      )}
      <div style={{height:28}}/>
      {!isDress&&(
        <React.Fragment>
          <SwipeRow label="Bottoms" arr={avBottoms} idx={bSafe} setIdx={setBi} emoji="👖" isLocked={locked.bottom} onLockToggle={()=>toggleLock("bottom")} onMarkUnavailable={markUnavailable} onCycleEnd={()=>setAiVibe(null)}/>
          <div style={{height:28}}/>
        </React.Fragment>
      )}
      {isDress&&<div style={{height:8}}/>}
      <SwipeRow label="Shoes"   arr={avShoes}   idx={sSafe} setIdx={setSi} emoji="👟" isLocked={locked.shoe}      onLockToggle={()=>toggleLock("shoe")}      onMarkUnavailable={markUnavailable} onCycleEnd={()=>setAiVibe(null)}/>
      <div style={{height:28}}/>
      {showAccessories&&avAccessories.length>0&&(
        <React.Fragment>
          <SwipeRow label="Accessories" arr={avAccessories} idx={acSafe} setIdx={setAi} emoji="💍" isLocked={locked.accessory} onLockToggle={()=>toggleLock("accessory")} onMarkUnavailable={markUnavailable} onCycleEnd={()=>setAiVibe(null)}/>
          <div style={{height:28}}/>
        </React.Fragment>
      )}
      {showAccessories&&avAccessories.length===0&&(
        <div style={{borderRadius:R14,background:CD,border:`1px solid ${BR}`,height:60,display:"flex",alignItems:"center",justifyContent:"center",marginBottom:8,...ss(9,400,DM,{fontStyle:"italic"})}}>No accessories in your closet yet</div>
      )}

      {/* Action row */}
      <div style={{display:"flex",gap:8,marginTop:6}}>
        <button onClick={()=>setShowSaveModal(true)} style={{flex:1,padding:"13px",borderRadius:R14,background:CD,border:`1px solid ${G}44`,...ss(10,700,G,{letterSpacing:1.5}),cursor:_p}}>
          SAVE OUTFIT
        </button>
        <button onClick={wearToday} style={{flex:1,padding:"13px",borderRadius:R14,background:saved?`linear-gradient(135deg,#2A4A2A,#1A3A1A)`:`linear-gradient(135deg,${G},#8A6E54)`,border:"none",...ss(10,700,saved?"#80C080":BK,{letterSpacing:1.5}),cursor:_p,transition:"background 0.3s"}}>
          {saved?"✓ LOGGED":"WEAR TODAY"}
        </button>
      </div>

      {/* Save as outfit modal */}
      {showSaveModal&&(
        <div onClick={()=>setShowSaveModal(false)} style={{..._fix,background:"#000000AA",zIndex:80,display:"flex",alignItems:"flex-end"}}>
          <div onClick={e=>e.stopPropagation()} style={{background:"#0D0D0D",borderRadius:"24px 24px 0 0",width:"100%",maxWidth:430,margin:"0 auto",border:_2a,padding:"24px 24px 40px",animation:"fadeUp 0.3s ease forwards"}}>
            <div style={{width:36,height:4,borderRadius:2,background:"#333",margin:"0 auto 18px"}}/>
            <div style={sr(20,400,undefined,{marginBottom:4})}>Save as Outfit</div>
            <div style={ss(9,400,DM,{letterSpacing:1,marginBottom:16})}>NAME THIS LOOK</div>
            {/* Preview thumbs */}
            <div style={{display:"flex",gap:8,marginBottom:16}}>
              {[top,bottom,shoe,showOuterwear?outer:null,showAccessories?accessory:null].filter(Boolean).map(item=>(
                <ItemThumb key={item.id} item={item} size={52} r={12}/>
              ))}
            </div>
            <input value={saveOutfitName} onChange={e=>setSaveOutfitName(e.target.value)}
              placeholder={aiVibe||[top,bottom,shoe].filter(Boolean).map(i=>i?.name.split(" ")[0]).join(" + ")||"My Outfit"}
              style={{width:"100%",boxSizing:"border-box",background:"#141414",border:`1px solid ${G}44`,borderRadius:12,padding:"12px 14px",...ss(13,400,MD),color:"#C0B8B0",outline:"none",marginBottom:16}}
            />
            <div style={{display:"flex",gap:10}}>
              <button onClick={()=>setShowSaveModal(false)} style={{flex:1,padding:"12px",borderRadius:R14,background:_1a,border:_2a,...ss(9,600,DM,{letterSpacing:1}),cursor:_p}}>CANCEL</button>
              <button onClick={saveCurrentAsOutfit} style={{flex:2,padding:"12px",borderRadius:R14,background:`linear-gradient(135deg,${G},#8A6E54)`,border:"none",...ss(9,600,BK,{letterSpacing:1.5}),cursor:_p}}>SAVE LOOK ✦</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function OutfitsTab({items,outfits,setOutfits,setItems,showToast,logWear,onSaveOutfit,onDeleteOutfit,styleProfile={},saveStyleProfile,postWearFeedEvent,onboardStep=4,advanceOnboard,onOpenStyleQuiz,styleNudgeDismissed,onDismissStyleNudge,onOpenVacation}){
  const [builder,setBuilder]=useState([]);
  const [name,setName]=useState("");
  const [occasion,setOccasion]=useState("Casual");
  const [activeFilter,setActiveFilter]=useState("All");
  const [showBuilder,setShowBuilder]=useState(false);
  const [aiTriggerCount,setAiTriggerCount]=useState(0);
  const [pinned,setPinned]=useState(new Set([1]));
  const [favorites,setFavorites]=useState(new Set([1,3]));
  const [todayOccasion,setTodayOccasion]=useState(null);
  const [selectedOutfit,setSelectedOutfit]=useState(null);
  const [bSearch,setBSearch]=useState("");

  const [weather,setWeather]=useState(null);
  const [wxLoading,setWxLoading]=useState(false);
  const [wxLocation,setWxLocation]=useState(null); // {city, lat, lon}

  const WX_CODE={0:"Clear",1:"Mostly Clear",2:"Partly Cloudy",3:"Overcast",45:"Foggy",48:"Foggy",51:"Drizzle",53:"Drizzle",55:"Drizzle",61:"Rain",63:"Rain",65:"Heavy Rain",71:"Snow",73:"Snow",75:"Heavy Snow",80:"Showers",81:"Showers",82:"Heavy Showers",95:"Thunderstorm",96:"Thunderstorm",99:"Thunderstorm"};
  const WX_ICON={0:"☀️",1:"🌤",2:"⛅",3:"☁️",45:"🌫",48:"🌫",51:"🌦",53:"🌦",55:"🌧",61:"🌧",63:"🌧",65:"🌧",71:"🌨",73:"🌨",75:"❄️",80:"🌦",81:"🌧",82:"🌧",95:"⛈",96:"⛈",99:"⛈"};

  const fetchWeather=async(lat,lon)=>{
    try{
      const res=await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weathercode&temperature_unit=fahrenheit&timezone=auto`).then(r=>r.json());
      const temp=Math.round(res.current?.temperature_2m||0);
      const code=res.current?.weathercode||0;
      setWeather({temp:`${temp}°F`,condition:WX_CODE[code]||"Clear",icon:WX_ICON[code]||"☀️"});
    }catch(e){setWeather({temp:"--°F",condition:"Unavailable",icon:"🌡"});}
    setWxLoading(false);
  };

  const fetchCity=async(lat,lon)=>{
    try{
      const res=await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`).then(r=>r.json());
      const city=res.address?.city||res.address?.town||res.address?.village||res.address?.county||"Your Location";
      setWxLocation({city,lat,lon});
      localStorage.setItem("outfix_wx_loc",JSON.stringify({city,lat,lon}));
    }catch(e){}
  };

  const requestLocation=()=>{
    if(!navigator.geolocation){setWeather({temp:"--°F",condition:"Location unavailable",icon:"📍"});return;}
    setWxLoading(true);
    navigator.geolocation.getCurrentPosition(
      pos=>{
        const{latitude:lat,longitude:lon}=pos.coords;
        fetchCity(lat,lon);
        fetchWeather(lat,lon);
      },
      ()=>{setWxLoading(false);setWeather({temp:"--",condition:"Enable location",icon:"📍"});}
    );
  };

  useEffect(()=>{
    // Try cached location first
    try{
      const cached=JSON.parse(localStorage.getItem("outfix_wx_loc")||"null");
      if(cached?.lat){setWxLocation(cached);fetchWeather(cached.lat,cached.lon);return;}
    }catch(e){}
    requestLocation();
  },[]);

  // Auto-open builder on first visit of the day — suggestion fires inside MixMatchBuilder on mount
  useEffect(()=>{
    const today = new Date().toDateString();
    const lastDate = localStorage.getItem('outfix_last_ai_suggest');
    if(lastDate !== today && items.length >= 3){
      // Open builder so MixMatchBuilder mounts and auto-suggests
      setShowBuilder(true);
    }
  },[]);

  const today=new Date().toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric"});

  const occasions=["Work","Casual","Evening","Weekend","Travel","Sport"];
  const filters=["All","Pinned","Favorites","Work","Casual","Evening","Weekend","Travel"];

  const togglePin=id=>{
    setPinned(prev=>{const n=new Set(prev); n.has(id)?n.delete(id):n.add(id); return n;});
    showToast(pinned.has(id)?"Unpinned \u2746":"Pinned to top \u2746");
  };
  const toggleFav=id=>{
    setFavorites(prev=>{const n=new Set(prev); n.has(id)?n.delete(id):n.add(id); return n;});
    showToast(favorites.has(id)?"Removed from favorites \u2746":"Added to favorites \u2746");
  };

  const save=async()=>{
    if(builder.length<2){showToast("Add at least 2 items \u2746");return;}
    const n=name.trim()||"My Outfit";
    const newOutfit={id:Date.now(),name:n,items:builder,occasion,season:"All Year",wornHistory:[]};
    // Save to Supabase and use returned ID if available
    if(onSaveOutfit){
      const saved = await onSaveOutfit(newOutfit);
      if(saved?.id) newOutfit.id = saved.id;
    }
    setOutfits(prev=>[...prev,newOutfit]);
    if(advanceOnboard) advanceOnboard(3);
    setBuilder([]); setName(""); setOccasion("Casual"); setShowBuilder(false);
    showToast(`"${n}" saved \u2746`);
  };

  // Sort: pinned first, then by id descending
  const sorted=[...outfits].sort((a,b)=>{
    if(pinned.has(a.id)&&!pinned.has(b.id)) return -1;
    if(!pinned.has(a.id)&&pinned.has(b.id)) return 1;
    return b.id-a.id;
  });

  const filtered=activeFilter==="All" ? sorted
    : activeFilter==="Pinned" ? sorted.filter(o=>pinned.has(o.id))
    : activeFilter==="Favorites" ? sorted.filter(o=>favorites.has(o.id))
    : sorted.filter(o=>o.occasion===activeFilter);

  // Count badge per filter
  const counts={
    All:outfits.length,
    Pinned:[...pinned].filter(id=>outfits.find(o=>o.id===id)).length,
    Favorites:[...favorites].filter(id=>outfits.find(o=>o.id===id)).length,
    ...Object.fromEntries(occasions.map(oc=>[oc,outfits.filter(o=>o.occasion===oc).length])),
  };

  const occasionColour={Work:"#4A6080",Casual:"#6A8050",Evening:"#7A5A90",Weekend:"#806040",Travel:"#507080",Sport:"#7A4040"};

  return(
    <div className="fu" style={{padding:"16px 24px"}}>


      {/* ── HEADER ── */}
      <div style={{..._btwnS,marginBottom:14}}>
        <div>
          <div style={sr(19,300)}>Your Looks</div>
          {outfits.length > 0 && (
            <div style={ss(10,400,DM,{letterSpacing:1,marginTop:2})}>{outfits.length} SAVED OUTFITS</div>
          )}
        </div>
        {showBuilder && (
          <button onClick={()=>setShowBuilder(false)} style={{padding:"8px 16px",borderRadius:R18,background:"#1A1A1A",border:"1px solid #2A2A2A",...ss(9,600,MD,{letterSpacing:1}),cursor:_p}}>
            ✕ CLOSE
          </button>
        )}
      </div>

      {/* ── WEATHER PILL + AI BUTTON (compact, single row) ── */}
      <div style={{display:"flex",gap:8,marginBottom:14,alignItems:"center"}}>
        {/* Weather pill — small, left */}
        <div onClick={requestLocation} style={{background:"#111",borderRadius:R18,padding:"6px 12px",border:"1px solid #2A2A2A",display:"flex",alignItems:"center",gap:6,cursor:_p,flexShrink:0}}>
          <span style={{fontSize:14}}>{wxLoading?"⏳":weather?.icon||"📍"}</span>
          <span style={ss(11,500,"#D0D4F0")}>{wxLoading?"…":weather?.temp||"--°F"}</span>
          <span style={ss(9,400,"#6A70A8",{maxWidth:60,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"})}>{wxLocation?.city||"Location"}</span>
        </div>
        {/* AI button — prominent, flex fills remaining */}
        <button onClick={()=>{ setActiveFilter("All"); setShowBuilder(true); setAiTriggerCount(c=>c+1); }}
          className="sb"
          style={{flex:1,background:`linear-gradient(135deg,${G},#A08060)`,borderRadius:R14,padding:"10px 14px",border:"none",display:"flex",alignItems:"center",gap:10,cursor:_p}}>
          <span style={{fontSize:18,flexShrink:0}}>🪄</span>
          <div>
            <div style={ss(10,700,"#0D0D0D",{letterSpacing:1.5})}>STYLE WITH AI</div>
            <div style={ss(8,400,"#3A2A10",{opacity:0.75})}>Tap to generate a look</div>
          </div>
          <span style={{fontSize:14,color:"#0D0D0D88",marginLeft:"auto"}}>›</span>
        </button>
      </div>

      {/* ── MIX & MATCH — only shown when explicitly opened ── */}
      {showBuilder && activeFilter==="All" && (()=>{
        const tops       = items.filter(i=>["Tops","Dresses"].includes(i.category));
        const bottoms    = items.filter(i=>i.category==="Bottoms");
        const shoes      = items.filter(i=>i.category==="Shoes");
        const outerwear  = items.filter(i=>i.category==="Outerwear");
        const accessories= items.filter(i=>i.category==="Accessories");
        return <MixMatchBuilder tops={tops} bottoms={bottoms} shoes={shoes} outerwear={outerwear} accessories={accessories} items={items} showToast={showToast} logWear={logWear} outfits={outfits} setOutfits={setOutfits} setItems={setItems} onNewLook={()=>setShowBuilder(true)} onSaveOutfit={onSaveOutfit} styleProfile={styleProfile} saveStyleProfile={saveStyleProfile} postWearFeedEvent={postWearFeedEvent} onboardStep={onboardStep} advanceOnboard={advanceOnboard} aiTrigger={aiTriggerCount} weatherData={weather}/>;
      })()}

      {/* ── FILTER CHIPS — tighter, occasion-only, no meta filters ── */}
      {outfits.length > 0 && (
        <div style={{display:"flex",gap:5,overflowX:"auto",marginBottom:14,paddingBottom:2}}>
          {["All","Work","Casual","Evening","Weekend","Travel"].map(f=>{
            const isActive=activeFilter===f;
            const count=counts[f]||0;
            return(
              <button key={f} onClick={()=>setActiveFilter(f)} className="pb" style={{
                flexShrink:0,padding:"5px 10px",borderRadius:R18,
                background:isActive?G:"#111",
                border:isActive?"none":"1px solid #1E1E1E",
                cursor:_p,
              }}>
                <span style={ss(8,isActive?600:400,isActive?BK:DM,{letterSpacing:0.5,whiteSpace:"nowrap"})}>
                  {f}
                </span>
                {count>0&&f!=="All"&&<span style={{...ss(8,600,isActive?BK:DM),background:isActive?"#0000002A":"#2A2A2A",borderRadius:12,padding:"0px 4px",marginLeft:3}}>{count}</span>}
              </button>
            );
          })}
        </div>
      )}

      {/* Outfit list */}
      {filtered.length===0?(
        <div style={{textAlign:"center",padding:"48px 24px"}}>
          <div style={{fontSize:48,marginBottom:16,animation:"pulse 2s ease-in-out infinite"}}>🪄</div>
          <div style={sr(20,400,"#E8E0D4",{marginBottom:8})}>
            {outfits.length===0 ? "Your first look is waiting." : "Nothing matches this filter."}
          </div>
          <div style={ss(12,400,DM,{marginBottom:24,lineHeight:1.7})}>
            {outfits.length===0
              ? "Build an outfit from your closet — the good stuff is already in there."
              : "Try a different filter or save more looks."}
          </div>
          {outfits.length===0&&(
            <button onClick={()=>{setShowBuilder(true);setAiTriggerCount(c=>c+1);}} style={{padding:"12px 28px",borderRadius:24,background:`linear-gradient(135deg,${G},#8A6E54)`,border:"none",...ss(10,700,BK,{letterSpacing:1.5}),cursor:_p}}>
              BUILD YOUR FIRST LOOK
            </button>
          )}
        </div>
      ):filtered.filter(o=>!todayOccasion||o.occasion===todayOccasion).map(outfit=>{
        const isPinned=pinned.has(outfit.id);
        const isFav=favorites.has(outfit.id);
        const accentCol=occasionColour[outfit.occasion]||"#4A4038";
        return(
          <React.Fragment key={outfit.id}>
          <div className="ch" onClick={()=>setSelectedOutfit(outfit)} style={{background:CD,borderRadius:R18,padding:"16px 18px",marginBottom:12,border:`1px solid ${BR}`,position:"relative",overflow:"hidden",cursor:_p}}>
            {/* Occasion colour strip */}
            <div style={{position:"absolute",top:0,left:0,width:3,bottom:0,background:accentCol,borderRadius:"3px 0 0 3px"}}/>

            {/* Top row */}
            <div style={{..._btwnS,marginBottom:12,paddingLeft:8}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{..._row,gap:6,marginBottom:3}}>
                  {isPinned&&<span style={{fontSize:10}}>📌</span>}
                  <div style={sr(17,500,undefined,{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"})}>{outfit.name}</div>
                </div>
                <div style={{..._row,gap:6}}>
                  <div style={{background:accentCol+"33",borderRadius:8,padding:"2px 8px",...ss(8,600,accentCol==="#4A4038"?MD:accentCol,{letterSpacing:0.8})}}>{outfit.occasion}</div>
                  <div style={ss(8,400,DM,{letterSpacing:0.5})}>{outfit.season}</div>
                </div>
              </div>
              <div style={{display:"flex",gap:4,flexShrink:0,marginLeft:8}}>
                <button onClick={e=>{e.stopPropagation();toggleFav(outfit.id);}} style={{width:32,height:32,borderRadius:"50%",background:isFav?"#2A1A10":"#1A1A1A",border:isFav?`1px solid ${G}44`:"1px solid #2A2A2A",display:"flex",alignItems:"center",justifyContent:"center",cursor:_p,fontSize:14}}>
                  {isFav?"♥":"♡"}
                </button>
                <button onClick={e=>{e.stopPropagation();togglePin(outfit.id);}} style={{width:32,height:32,borderRadius:"50%",background:isPinned?"#1A1A10":"#1A1A1A",border:isPinned?`1px solid ${G}44`:"1px solid #2A2A2A",display:"flex",alignItems:"center",justifyContent:"center",cursor:_p,fontSize:13}}>
                  📌
                </button>
              </div>
            </div>

            {/* Item thumbnails */}
            <div style={{display:"flex",gap:8,marginBottom:12,paddingLeft:8}}>
              {outfit.items.map(id=>{
                const it=items.find(i=>i.id===id);
                return it?(<ItemThumb key={id} item={it} size={52} r={12}/>):null;
              })}
            </div>

            {/* Actions */}
            <div style={{display:"flex",gap:8,paddingLeft:8}}>
              <button onClick={e=>{e.stopPropagation();logWear(outfit.id);showToast(`Wearing "${outfit.name}" today \u2746`);}} style={{flex:1,padding:"8px",borderRadius:11,background:`linear-gradient(135deg,${G},#8A6E54)`,border:"none",...ss(9,600,BK,{letterSpacing:1}),cursor:_p}}>WEAR TODAY</button>
              <button onClick={e=>{e.stopPropagation();if(window.confirm(`Delete "${outfit.name}"?`)){setOutfits(prev=>prev.filter(o=>o.id!==outfit.id));if(onDeleteOutfit)onDeleteOutfit(outfit.id);showToast(`"${outfit.name}" deleted \u2746`);}}} style={{width:36,padding:"8px",borderRadius:11,background:"#1A0A0A",border:"1px solid #3A1A1A",display:"flex",alignItems:"center",justifyContent:"center",cursor:_p,...ss(13,400,"#A86060")}}>
                ×
              </button>
            </div>
          </div>

          {/* ── INLINE OUTFIT DETAIL ── */}
          {selectedOutfit?.id===outfit.id&&(()=>{
            const o=outfit;
            const accentCol=occasionColour[o.occasion]||"#4A4038";
            const outfitItems=o.items.map(id=>items.find(i=>i.id===id)).filter(Boolean);
            const totalValue=outfitItems.reduce((s,i)=>s+i.price,0);
            return(
              <div style={{background:CD,borderRadius:R18,padding:"16px 18px",marginBottom:12,border:`1px solid ${G}44`}}>
                {/* Header */}
                <div style={{..._btwn,marginBottom:16}}>
                  <div>
                    <div style={sr(20,400)}>{o.name}</div>
                    <div style={{..._row,gap:8,marginTop:4}}>
                      <div style={{background:accentCol+"33",borderRadius:8,padding:"3px 10px",...ss(8,600,accentCol==="#4A4038"?MD:accentCol,{letterSpacing:1})}}>{o.occasion}</div>
                      <div style={ss(9,400,DM,{letterSpacing:0.5})}>{o.season}</div>
                    </div>
                  </div>
                  <IconBtn onClick={()=>setSelectedOutfit(null)}>×</IconBtn>
                </div>
                {/* Stats */}
                <div style={{display:"flex",gap:8,marginBottom:14}}>
                  {[[outfitItems.length+" pieces","ITEMS"],[`$${totalValue}`,"VALUE"],[(favorites.has(o.id)?"♥":"♡")+" Fav",""]].map(([v,l])=>(
                    <div key={l} style={{flex:1,background:_1a,borderRadius:12,padding:"8px",textAlign:"center",border:"1px solid #222"}}>
                      <div style={sr(14,500,G)}>{v}</div>
                      {l&&<div style={ss(8,400,DM,{letterSpacing:1,marginTop:1})}>{l}</div>}
                    </div>
                  ))}
                </div>
                {/* Actions */}
                <div style={{display:"flex",gap:8,marginBottom:16}}>
                  <button onClick={()=>{logWear(o.id);showToast(`Wearing "${o.name}" today \u2746`);setSelectedOutfit(null);}} style={{flex:2,padding:"11px",borderRadius:12,background:`linear-gradient(135deg,${G},#8A6E54)`,border:"none",...ss(10,700,BK,{letterSpacing:1}),cursor:_p}}>WEAR TODAY</button>
                  <button onClick={()=>{showToast(`"${o.name}" shared to feed \u2746`);setSelectedOutfit(null);}} style={{padding:"11px 12px",borderRadius:12,background:_1a,border:_2a,display:"flex",alignItems:"center",gap:5,cursor:_p,...ss(9,600,MD,{letterSpacing:0.5})}}>
                    <span style={{fontSize:12}}>✦</span>SHARE
                  </button>
                </div>
                {/* Items */}
                <div style={ss(8,600,DM,{letterSpacing:2,marginBottom:10})}>ITEMS IN THIS OUTFIT</div>
                {outfitItems.map(item=>(
                  <div key={item.id} style={{background:"#111",borderRadius:R14,marginBottom:10,border:`1px solid ${BR}`,overflow:"hidden"}}>
                    <div style={{width:"100%",height:160,background:`linear-gradient(135deg,${item.color}22,${item.color}44)`,display:"flex",alignItems:"center",justifyContent:"center"}}>
                      {item.sourceImage
                        ? <img src={item.sourceImage} style={{width:"100%",height:"100%",objectFit:"contain",padding:"8px",boxSizing:"border-box"}} alt={item.name}/>
                        : <ItemIllustration item={item} size={110}/>
                      }
                    </div>
                    <div style={{padding:"10px 12px"}}>
                      <div style={{..._btwnS,marginBottom:4}}>
                        <div style={sr(15,500)}>{item.name}</div>
                        <div style={sr(14,400,G)}>${item.price}</div>
                      </div>
                      <div style={ss(9,400,DM)}>{item.brand} · {item.category}</div>
                      <div style={{display:"flex",gap:6,marginTop:8}}>
                        {[[item.wearCount+"x","WORN"],[item.lastWorn,"LAST WORN"],[item.condition,"CONDITION"]].map(([v,l])=>(
                          <div key={l} style={{flex:1,background:_1a,borderRadius:8,padding:"6px",textAlign:"center",border:"1px solid #222"}}>
                            <div style={sr(12,400,G)}>{v}</div>
                            <div style={ss(8,400,DM,{letterSpacing:1,marginTop:1})}>{l}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}
          </React.Fragment>
        );
      })}


      {/* ── VACATION PLANNER ENTRY — bottom of page ── */}
      {onOpenVacation && (
        <div onClick={onOpenVacation} className="ch" style={{background:"#111",borderRadius:R14,padding:"12px 16px",border:"1px solid #1E1E1E",marginTop:8,cursor:_p,display:"flex",gap:12,alignItems:"center"}}>
          <span style={{fontSize:20,flexShrink:0}}>✈️</span>
          <div style={{flex:1}}>
            <div style={ss(11,500,MD,{marginBottom:1})}>Planning a trip?</div>
            <div style={ss(9,400,DM)}>Pack from your actual collection</div>
          </div>
          <div style={{fontSize:14,color:DM}}>›</div>
        </div>
      )}

    </div>
  );
}

// ── MARKET ────────────────────────────────────────────────────────────────────
// ── OFFERS DATA ──────────────────────────────────────────────────────────────
// ── USER PROFILE DATA ─────────────────────────────────────────────────────────
const userProfiles = {};
// ── USER PROFILE PAGE ─────────────────────────────────────────────────────────
function UserProfilePage({ handle, userId, username, onClose, showToast, session, onAddToCloset, addToWishlist, onViewProfile, onMessage }) {
  const [activeTab, setActiveTab] = useState("items");
  const [following, setFollowing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [profileError, setProfileError] = useState(false);
  const [realProfile, setRealProfile] = useState(null);
  const [addedItems, setAddedItems] = useState(new Set());
  const [selectedProfileItem, setSelectedProfileItem] = useState(null);
  const [followList, setFollowList] = useState(null); // {type:"followers"|"following", users:[], loading:bool}

  // Determine if this is a real user or demo profile
  const isDemoUser = handle && userProfiles[handle];
  const isOwnProfile = !isDemoUser && session?.user?.id && realProfile?.id && session.user.id === realProfile.id;
  const demoProfile = isDemoUser ? userProfiles[handle] : null;

  // Fetch real user data from Supabase
  useEffect(()=>{
    if(!userId || isDemoUser) return;
    setLoading(true);
    (async()=>{
      try{
        const token = session?.access_token || "";
        const headers = {"Authorization":`Bearer ${token}`,"apikey":SB_KEY};

        const [profRes, itemsRes, outfitsRes, followersRes, followingRes, isFollowingRes] = await Promise.all([
          fetch(`${SB_URL}/rest/v1/profiles?id=eq.${userId}&select=*`,{headers}).then(r=>r.json()),
          fetch(`${SB_URL}/rest/v1/items?user_id=eq.${userId}&select=*&order=created_at.desc`,{headers}).then(r=>r.json()),
          fetch(`${SB_URL}/rest/v1/outfits?user_id=eq.${userId}&select=*&order=created_at.desc`,{headers}).then(r=>r.json()),
          fetch(`${SB_URL}/rest/v1/follows?following_id=eq.${userId}&select=id`,{headers}).then(r=>r.json()),
          fetch(`${SB_URL}/rest/v1/follows?follower_id=eq.${userId}&select=id`,{headers}).then(r=>r.json()),
          session?.user?.id ? fetch(`${SB_URL}/rest/v1/follows?follower_id=eq.${session.user.id}&following_id=eq.${userId}&select=id`,{headers}).then(r=>r.json()) : Promise.resolve([]),
        ]);

        const prof = Array.isArray(profRes) ? profRes[0] : null;

        // If profile lookup by userId failed, try by username as fallback
        let resolvedProf = prof;
        let resolvedUserId = userId;
        if(!prof && username) {
          const fallback = await fetch(`${SB_URL}/rest/v1/profiles?username=eq.${encodeURIComponent(username)}&select=*`, {headers}).then(r=>r.json());
          resolvedProf = Array.isArray(fallback) ? fallback[0] : null;
          if(resolvedProf) resolvedUserId = resolvedProf.id;
        }
        const items = Array.isArray(itemsRes) ? itemsRes : [];
        const outfits = Array.isArray(outfitsRes) ? outfitsRes : [];
        const followerCount = Array.isArray(followersRes) ? followersRes.length : 0;
        const followingCount = Array.isArray(followingRes) ? followingRes.length : 0;
        const isAlreadyFollowing = Array.isArray(isFollowingRes) && isFollowingRes.length > 0;

        setFollowing(isAlreadyFollowing);

        // Compute derived stats from real items
        const brands = [...new Set(items.map(i=>i.brand).filter(Boolean))];
        const colors = items.map(i=>i.color).filter(Boolean);
        const colorCounts = {};
        colors.forEach(c=>{ colorCounts[c]=(colorCounts[c]||0)+1; });
        const topColors = Object.entries(colorCounts).sort((a,b)=>b[1]-a[1]).slice(0,5).map(e=>e[0]);
        const resaleValue = items.reduce((s,i)=>s+calcResale(i),0);
        const forSaleItems = items.filter(i=>i.forSale||i.for_sale);
        const wornItems = items.filter(i=>(i.wearCount||i.wear_count||0)>0);
        const utilScore = items.length ? Math.round((wornItems.length/items.length)*100) : 0;

        // Build posts from outfits — DB stores item IDs in item_ids column
        const posts = Array.isArray(outfits) ? outfits.map(o=>{
          const outfitItemIds = Array.isArray(o.item_ids) ? o.item_ids : (Array.isArray(o.items) ? o.items : []);
          const outfitItems = outfitItemIds.map(id=>
            items.find(i=>String(i.id)===String(id)||i.id===id)
          ).filter(Boolean);
          return {
            id: o.id,
            outfit: o.name||"Outfit",
            likes: o.like_count||0,
            occasion: o.occasion||"",
            items: outfitItems,
            wornHistory: o.wornHistory||o.worn_history||[],
          };
        }) : [];

        const closetValue = items.reduce((s,i)=>s+(i.price||0),0);

        setRealProfile({
          id: resolvedUserId,
          handle: `@${resolvedProf?.username||username||"user"}`,
          name: resolvedProf?.full_name || resolvedProf?.username || username || "Outfix User",
          username: resolvedProf?.username || username || "",
          location: resolvedProf?.location || "",
          bio: resolvedProf?.bio || "",
          style: resolvedProf?.style_identity || "",
          avatar: (resolvedProf?.username||username||"?")[0]?.toUpperCase(),
          avatar_url: resolvedProf?.avatar_url || null,
          followers: followerCount >= 1000 ? `${(followerCount/1000).toFixed(1)}k` : String(followerCount),
          following: followingCount,
          totalFollowers: followerCount,
          posts: outfits.length,
          items: items.length,
          verified: false,
          forSaleCount: forSaleItems.length,
          stats: {
            sustainabilityScore: utilScore,
            brandsCount: brands.length,
            resaleValue: `$${resaleValue.toLocaleString()}`,
            closetValue: `$${closetValue.toLocaleString()}`,
          },
          highlights: [
            { label:"Pieces",   emoji:"👔", count:items.length },
            { label:"Outfits",  emoji:"✦",  count:outfits.length },
            { label:"For Sale", emoji:"🏷️", count:forSaleItems.length },
            { label:"Brands",   emoji:"🏷",  count:brands.length },
          ],
          recentPosts: posts,
          allItems: items,
          forSale: forSaleItems.map(i=>({
            emoji: i.emoji||"👗",
            name: i.name,
            brand: i.brand||"Unknown",
            price: i.price||0,
            size: i.size||"—",
            condition: i.condition||"Good",
            likes: 0,
            sourceImage: i.sourceImage||i.source_image||null,
          })),
          brands,
          colorPalette: topColors.length ? topColors : ["#C4A882","#8B7355","#1A1A1A","#E8DDD0","#4A6080"],
        });
      }catch(e){ console.error("Profile load error:", e); setProfileError(true); }
      setLoading(false);
    })();
  },[userId]);

  // Follow/unfollow real user
  const toggleFollow = async () => {
    if(!session?.access_token || !userId) { showToast("Sign in to follow \u2746"); return; }
    const token = session.access_token;
    const myId = session.user?.id;
    const headers = {"Content-Type":"application/json","Authorization":`Bearer ${token}`,"apikey":SB_KEY};
    if(following){
      await fetch(`${SB_URL}/rest/v1/follows?follower_id=eq.${myId}&following_id=eq.${userId}`,{method:"DELETE",headers});
      showToast("Unfollowed \u2746");
    } else {
      await fetch(`${SB_URL}/rest/v1/follows`,{method:"POST",headers,body:JSON.stringify({follower_id:myId,following_id:userId})});
      showToast("Following \u2746");
    }
    setFollowing(f=>!f);
    if(realProfile) setRealProfile(p=>({...p,
      totalFollowers: p.totalFollowers+(following?-1:1),
      followers: String(p.totalFollowers+(following?-1:1)),
    }));
  };

  const profile = demoProfile || realProfile || {
    name:"",handle:"",bio:"",style:"",avatar:"?",avatar_url:null,
    followers:"0",following:0,items:0,posts:0,forSaleCount:0,
    verified:false,location:"",colorPalette:[],brands:[],
    highlights:[],recentPosts:[],allItems:[],forSale:[],
    stats:{sustainabilityScore:0,brandsCount:0,resaleValue:"$0",closetValue:"$0"},
  };

  if(loading) return(
    <div style={{..._fix,background:BK,zIndex:400,maxWidth:430,margin:"0 auto",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
      <div style={{fontSize:32,animation:"spin 1.2s linear infinite",marginBottom:16}}>✦</div>
      <div style={ss(11,400,DM,{letterSpacing:1})}>Loading profile…</div>
    </div>
  );

  if(!profile) return(
    <div style={{..._fix,background:BK,zIndex:400,maxWidth:430,margin:"0 auto",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:16}}>
      <div style={{fontSize:36}}>👤</div>
      <div style={sr(16,400,DM,{fontStyle:"italic"})}>Profile not found</div>
      <button onClick={onClose} style={{padding:"10px 24px",borderRadius:R18,background:_1a,border:_2a,...ss(9,600,G,{letterSpacing:1}),cursor:_p}}>GO BACK</button>
    </div>
  );

  const loadFollowList = async (type) => {
    setFollowList({type, users:[], loading:true});
    try {
      const uid = realProfile?.id || userId;
      if(!uid) return;
      const token = session?.access_token||"";
      const headers = {"Authorization":`Bearer ${token}`,"apikey":SB_KEY};
      const col = type==="followers" ? "follower_id" : "following_id";
      const filter = type==="followers" ? `following_id=eq.${uid}` : `follower_id=eq.${uid}`;
      const followRes = await fetch(`${SB_URL}/rest/v1/follows?${filter}&select=${col}`,{headers}).then(r=>r.json());
      const ids = Array.isArray(followRes) ? followRes.map(f=>f[col]).filter(Boolean) : [];
      if(ids.length===0){ setFollowList({type,users:[],loading:false}); return; }
      const profilesRes = await fetch(`${SB_URL}/rest/v1/profiles?id=in.(${ids.join(",")})&select=id,username,bio,style_identity`,{headers}).then(r=>r.json());
      setFollowList({type, users:Array.isArray(profilesRes)?profilesRes:[], loading:false});
    } catch(e){ setFollowList({type,users:[],loading:false}); }
  };

  const tabs = [
    { id:"items",   label:"ITEMS",   count: profile.items },
    { id:"posts",   label:"OUTFITS", count: profile.posts },
    { id:"about",   label:"ABOUT" },
  ];

  return (<React.Fragment>
    <div style={{position:"fixed",inset:0,background:BK,zIndex:400,maxWidth:430,margin:"0 auto",display:"flex",flexDirection:"column",paddingBottom:60}}>

      {/* ── LOCKED HEADER ── */}
      <div style={{flexShrink:0,background:"#0A0908",borderBottom:"1px solid #1A1A1A",padding:"14px 18px",display:"flex",alignItems:"center",gap:12}}>
        <IconBtn onClick={onClose} sz={18}>←</IconBtn>
        <div style={{flex:1}}>
          <div style={ss(11,600,MD,{letterSpacing:0.5})}>{realProfile?.username?`@${realProfile.username}`:username||""}</div>
          <div style={ss(9,400,DM,{letterSpacing:0.5})}>{profile?.items||0} pieces</div>
        </div>
      </div>

      {/* ── LOCKED HERO ── */}
      <div style={{flexShrink:0}}>
      {/* ── HERO + AVATAR + IDENTITY ROW ── */}
      <div style={{position:"relative",flexShrink:0,marginBottom:14}}>
        {/* Hero banner */}
        <div style={{height:44,background:"linear-gradient(160deg,#1A1510,#0F0D0A,#16120E)",overflow:"hidden"}}>
          {(profile?.colorPalette||[]).map((col,i)=>(
            <div key={i} style={{position:"absolute",borderRadius:"50%",width:160,height:160,background:col,opacity:0.28,filter:"blur(40px)",top:`${-30+i*15}%`,left:`${i*28}%`}}/>
          ))}
          {!profile?.colorPalette?.length&&(
            <React.Fragment>
              <div style={{position:"absolute",borderRadius:"50%",width:180,height:180,background:G,opacity:0.12,filter:"blur(50px)",top:"-20%",left:"-10%"}}/>
              <div style={{position:"absolute",borderRadius:"50%",width:120,height:120,background:"#8A6E54",opacity:0.15,filter:"blur(40px)",top:"10%",right:"5%"}}/>
            </React.Fragment>
          )}
        </div>

        {/* Avatar + identity side by side */}
        <div style={{display:"flex",alignItems:"center",gap:12,padding:"0 18px",marginTop:-36,position:"relative",zIndex:2}}>
          {/* Avatar */}
          <div style={{flexShrink:0}}>
            <div style={{width:72,height:72,borderRadius:"50%",background:"linear-gradient(135deg,#2A2420,#1A1410)",border:`3px solid #0D0D0D`,overflow:"hidden",display:"flex",alignItems:"center",justifyContent:"center",boxShadow:`0 0 0 2px ${G}44`}}>
              {realProfile?.avatar_url
                ? <img src={realProfile.avatar_url} style={{width:"100%",height:"100%",objectFit:"cover",objectPosition:"center top"}} alt={profile?.name}/>
                : demoProfile
                  ? (AVATAR_DEFS[profile?.handle]?<AvatarPortrait user={profile?.handle} size={68}/>:<span style={{fontSize:28}}>{profile?.avatar}</span>)
                  : <span style={{...sr(26,600,G)}}>{profile?.avatar}</span>
              }
            </div>
          </div>

          {/* Identity text — centered with avatar */}
          <div style={{flex:1,minWidth:0}}>
            {(()=>{
              const rawName = realProfile?.name || profile?.name || "";
              const parts = rawName.trim().split(" ").filter(Boolean);
              const firstName = parts[0] || rawName;
              const handle = realProfile?.username ? `@${realProfile.username}` : profile?.handle || "";
              const location = realProfile?.location || profile?.location || "";
              return(
                <React.Fragment>
                  <div style={{..._row,gap:6,marginBottom:1}}>
                    <div style={sr(20,500)}>{firstName}</div>
                    {profile?.verified&&<div style={{width:15,height:15,borderRadius:"50%",background:G,display:"flex",alignItems:"center",justifyContent:"center",...ss(8,700,"#0D0D0D"),flexShrink:0}}>✓</div>}
                  </div>
                  <div style={ss(10,400,DM,{letterSpacing:0.5,marginBottom:location||profile?.bio?3:0})}>{handle}</div>
                  {location&&<div style={{..._row,gap:3,marginBottom:profile?.bio?3:0}}><span style={{fontSize:9}}>📍</span><span style={ss(9,400,"#6A6058")}>{location}</span></div>}
                  {profile?.bio&&<div style={{...ss(11,400,"#A09880"),lineHeight:1.5}}>{profile?.bio}</div>}
                  {profile?.style&&<div style={{...ss(9,300,"#6A5E50"),fontStyle:"italic"}}>{profile?.style}</div>}
                </React.Fragment>
              );
            })()}
          </div>

          {/* Follow/message buttons — vertically centered */}
          {!isOwnProfile&&(
            <div style={{flexShrink:0,display:"flex",gap:6,alignItems:"center"}}>
              <button onClick={()=>{ if(onMessage&&realProfile?.id) onMessage(realProfile.id, realProfile.username||username); }} style={{width:32,height:32,borderRadius:"50%",background:_1a,border:_2a,display:"flex",alignItems:"center",justifyContent:"center",...ss(12,400,MD),cursor:_p}}>✉</button>
              <button onClick={demoProfile?()=>{setFollowing(f=>!f);showToast(following?"Unfollowed \u2746":"Following \u2746");}:toggleFollow}
                style={{padding:"7px 16px",borderRadius:R18,background:following?"#1A1A1A":`linear-gradient(135deg,${G},#8A6E54)`,border:following?"1px solid #2A2A2A":"none",...ss(9,600,following?MD:"#0D0D0D",{letterSpacing:1}),cursor:_p}}>
                {following?"FOLLOWING":"FOLLOW"}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── STATS + REST ── */}
      <div style={{padding:"0 18px",flexShrink:0}}>

        {/* Unified stats row */}
        <div style={{display:"flex",gap:0,marginBottom:14,borderRadius:R14,overflow:"hidden",border:"1px solid #1E1E1E",background:"#111"}}>
          {[
            {label:"Followers", value:profile?.followers, tap:()=>loadFollowList("followers")},
            {label:"Following", value:profile?.following, tap:()=>loadFollowList("following")},
            {label:"Pieces",    value:profile?.items,     tap:null},
            {label:"Outfits",   value:profile?.posts,     tap:null},
          ].map((s,i)=>(
            <div key={i} onClick={s.tap||undefined}
              style={{flex:1,padding:"10px 4px",textAlign:"center",borderRight:i<3?"1px solid #1E1E1E":"none",cursor:s.tap?_p:"default"}}>
              <div style={sr(16,600,G)}>{s.value}</div>
              <div style={ss(8,400,DM,{letterSpacing:0.8,marginTop:2})}>{s.label.toUpperCase()}</div>
            </div>
          ))}
        </div>

        {/* Own profile value cards — no emojis */}
        {isOwnProfile&&(
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14}}>
            {[
              {label:"Closet Value", value:profile?.stats?.closetValue},
              {label:"Est. Resale",  value:profile?.stats?.resaleValue},
            ].map((s,i)=>(
              <div key={i} style={{background:"#111",borderRadius:12,padding:"10px 14px",border:"1px solid #1E1E1E"}}>
                <div style={sr(16,500,G)}>{s.value}</div>
                <div style={ss(8,400,DM,{letterSpacing:0.8,marginTop:2})}>{s.label.toUpperCase()}</div>
              </div>
            ))}
          </div>
        )}

        {/* Brand chips */}
        {(profile?.brands||[]).length>0&&(
          <div style={{display:"flex",flexWrap:"wrap",gap:5,marginBottom:14}}>
            {profile?.brands.slice(0,10).map((b,i)=>(
              <div key={i} style={{padding:"3px 10px",borderRadius:R18,background:"#111",border:"1px solid #1E1E1E",...ss(8,400,"#6A6058",{letterSpacing:0.3})}}>
                {b}
              </div>
            ))}
          </div>
        )}
      </div>


      </div>{/* end hero */}

      {/* ── LOCKED TAB BAR ── */}
      <div style={{flexShrink:0,background:"#0A0908",borderBottom:"1px solid #1A1A1A",display:"flex"}}>
          {tabs.map(t=>(
            <button key={t.id} onClick={()=>setActiveTab(t.id)} style={{flex:1,padding:"12px 4px",background:"none",border:"none",borderBottom:activeTab===t.id?`2px solid ${G}`:"2px solid transparent",...ss(9,activeTab===t.id?700:400,activeTab===t.id?G:"#4A4438",{letterSpacing:1.2}),cursor:_p}}>
              {t.label}{t.count!==undefined?` (${t.count})`:""}</button>
          ))}
        </div>

      <div style={{flex:"1 1 0",height:0,overflowY:"scroll",WebkitOverflowScrolling:"touch"}} className="sc">

      {/* ── SCROLLABLE CONTENT ── */}
        {/* ── PROFILE ERROR STATE ── */}
        {profileError&&(
          <div style={{textAlign:"center",padding:"60px 24px",display:"flex",flexDirection:"column",alignItems:"center",gap:12}}>
            <div style={{fontSize:36,marginBottom:4}}>⚡</div>
            <div style={sr(18,400,"#E8E0D4")}>Couldn't load this profile.</div>
            <div style={ss(11,400,DM,{lineHeight:1.6,maxWidth:260})}>Check your connection and try again.</div>
            <button onClick={()=>{setProfileError(false);}} style={{marginTop:8,padding:"10px 24px",borderRadius:R18,background:`${G}22`,border:`1px solid ${G}44`,...ss(9,600,G,{letterSpacing:1}),cursor:_p}}>← GO BACK</button>
          </div>
        )}
        {/* ── POSTS TAB ── */}
        {activeTab==="posts"&&(
          <div style={{padding:"16px 18px",paddingBottom:16}}>
          {(profile?.recentPosts||[]).length===0&&(
            <div style={{textAlign:"center",padding:"48px 0",opacity:0.4}}>
              <div style={sr(14,300,DM,{fontStyle:"italic"})}>No outfits posted yet</div>
            </div>
          )}
          {(()=>{
            const ACCENTS=["#C4A882","#8A7A9A","#7A9A8A","#9A8A7A","#8A9A7A"];
            return (profile?.recentPosts||[]).map((post,pi)=>{
            if(!post) return null;
            const postItems = Array.isArray(post.items) ? post.items.filter(Boolean) : [];
            const postAccent = ACCENTS[pi%ACCENTS.length];
            return(
              <div key={post.id||pi} style={{background:"#111",borderRadius:R18,overflow:"hidden",marginBottom:14,border:"1px solid #1E1E1E"}}>
                <div style={{width:"100%",position:"relative"}}>
                  <div style={{width:"100%",paddingTop:"52%",position:"relative",overflow:"hidden"}}>
                    <div style={{..._abs0,background:`linear-gradient(135deg,${postAccent}0A,#111)`,display:"flex",alignItems:"stretch"}}>
                      {postItems.slice(0,4).map((item,i)=>(
                        <div key={i} style={{flex:1,borderRight:i<Math.min(postItems.length,4)-1?"1px solid #1A1A1A":"none",display:"flex",alignItems:"center",justifyContent:"center",background:`${postAccent}08`,overflow:"hidden"}}>
                          {item.sourceImage||item.source_image
                            ? <img src={item.sourceImage||item.source_image} style={{width:"100%",height:"100%",objectFit:"contain",padding:8,boxSizing:"border-box"}} alt={item.name||""}/>
                            : <ItemIllustration item={item} size={54}/>
                          }
                        </div>
                      ))}
                      {postItems.length===0&&(
                        <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",opacity:0.25}}>
                          <span style={{fontSize:36}}>👗</span>
                        </div>
                      )}
                    </div>
                  </div>
                  <div style={{position:"absolute",bottom:10,left:14}}>
                    <div style={{...sr(16,500,"#F0EBE3"),textShadow:"0 1px 8px #00000099"}}>{post.outfit||"Outfit"}</div>
                  </div>
                </div>
                <div style={{padding:"12px 14px"}}>
                  {postItems.length>0&&(
                    <div style={{display:"flex",gap:8,marginBottom:12,overflowX:"auto",paddingBottom:2}}>
                      {postItems.map((item,i)=>(
                        <div key={i} style={{flexShrink:0,width:80,borderRadius:12,overflow:"hidden",background:_1a,border:_2a}}>
                          <div style={{height:64,display:"flex",alignItems:"center",justifyContent:"center",background:"#1E1E1E",overflow:"hidden"}}>
                            {item.sourceImage||item.source_image
                              ? <img src={item.sourceImage||item.source_image} style={{width:"100%",height:"100%",objectFit:"contain",padding:4,boxSizing:"border-box"}} alt={item.name||""}/>
                              : <ItemIllustration item={item} size={52}/>
                            }
                          </div>
                          <div style={{padding:"6px 6px 8px"}}>
                            <div style={ss(8,500,MD,{overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis"})}>{item.name||""}</div>
                            <div style={sr(12,500,G)}>${item.price||0}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <div style={{..._btwn}}>
                    <div style={ss(10,400,DM)}>♡ {post.likes||0}</div>
                    <button onClick={()=>showToast("Saved \u2746")} style={{padding:"5px 14px",borderRadius:R18,background:_1a,border:_2a,...ss(8,400,MD,{letterSpacing:1}),cursor:_p}}>SAVE LOOK</button>
                  </div>
                </div>
              </div>
            );
          });
          })()}
        </div>
      )}

      {activeTab==="items"&&(
        <div style={{padding:"16px 18px",paddingBottom:16}}>
          {(profile?.allItems||[]).length===0&&(
            <div style={{textAlign:"center",padding:"48px 0",opacity:0.4}}>
              <div style={sr(14,300,DM,{fontStyle:"italic"})}>No pieces in closet yet</div>
            </div>
          )}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            {(profile?.allItems||[]).map((item,i)=>{
              const alreadyAdded = addedItems.has(item.id||i);
              const isSelected = selectedProfileItem?._idx===i;
              const isEvenRow = i%2===0;
              const pairStart = Math.floor(i/2)*2;
              const showDetailAfter = selectedProfileItem && Math.floor(selectedProfileItem._idx/2)===Math.floor(i/2) && i===pairStart+1;
              return(
                <React.Fragment key={i}>
                  <div onClick={()=>setSelectedProfileItem(isSelected?null:{...item,_idx:i})} style={{background:isSelected?"#1A1610":"#111",borderRadius:R14,overflow:"hidden",border:isSelected?`1.5px solid ${G}44`:"1px solid #1E1E1E",cursor:_p}}>
                    <div style={{height:120,background:`linear-gradient(135deg,${item.color||"#2A2A2A"}18,${item.color||"#2A2A2A"}33)`,display:"flex",alignItems:"center",justifyContent:"center",position:"relative"}}>
                      {item.sourceImage||item.source_image
                        ? <img src={item.sourceImage||item.source_image} style={{width:"100%",height:"100%",objectFit:"contain",padding:8,boxSizing:"border-box"}} alt={item.name}/>
                        : <ItemIllustration item={item} size={70}/>
                      }
                      {(item.forSale||item.for_sale)&&<div style={{position:"absolute",top:6,right:6,background:G,borderRadius:6,padding:"2px 6px",...ss(8,700,BK,{letterSpacing:0.5})}}>FOR SALE</div>}
                    </div>
                    <div style={{padding:"8px 10px 10px"}}>
                      <div style={ss(11,500,MD,{overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis"})}>{item.name}</div>
                      <div style={ss(9,400,DM,{marginTop:1})}>{item.brand}</div>
                      <div style={{display:"flex",justifyContent:"flex-end",marginTop:6}}>
                        <button onClick={async e=>{
                          e.stopPropagation();
                          if(alreadyAdded||!onAddToCloset) return;
                          const newItem={id:Date.now(),name:item.name,brand:item.brand||"Unknown",category:item.category||"Tops",color:item.color||"#C4A882",price:item.price||0,emoji:item.emoji||"👗",wearCount:0,lastWorn:"Never",purchaseDate:"",condition:item.condition||"Good",forSale:false,tags:[],sourceImage:item.sourceImage||item.source_image||null};
                          await onAddToCloset(newItem);
                          setAddedItems(prev=>new Set([...prev,item.id||i]));
                          showToast(`${item.name} added to your closet \u2746`);
                        }} style={{padding:"4px 10px",borderRadius:R18,cursor:alreadyAdded?"default":_p,background:alreadyAdded?"#1A2A1A":`${G}22`,border:alreadyAdded?"1px solid #2A4A2A":`1px solid ${G}55`,...ss(8,600,alreadyAdded?"#80C880":G,{letterSpacing:0.5})}}>
                          {alreadyAdded?"✓ Added":"+ Collection"}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Inline detail — renders spanning full width after the row's right column */}
                  {showDetailAfter&&(()=>{
                    const it=profile?.allItems[selectedProfileItem._idx];
                    const idx=selectedProfileItem._idx;
                    const alreadyAddedDetail=addedItems.has(it.id||idx);
                    return(
                      <div style={{gridColumn:"1 / -1",background:"#141210",borderRadius:R14,border:`1px solid ${G}33`,padding:"16px",marginTop:-4}}>
                        <div style={{..._btwn,marginBottom:12}}>
                          <div style={sr(17,500)}>{it.name}</div>
                          <button onClick={()=>setSelectedProfileItem(null)} style={{width:26,height:26,borderRadius:"50%",background:_1a,border:_2a,cursor:_p,...ss(13,300,DM),display:"flex",alignItems:"center",justifyContent:"center"}}>×</button>
                        </div>
                        {/* Image */}
                        <div style={{width:"100%",height:180,background:`linear-gradient(135deg,${it.color||"#2A2A2A"}18,${it.color||"#2A2A2A"}40)`,borderRadius:12,display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden",marginBottom:12}}>
                          {it.sourceImage||it.source_image
                            ? <img src={it.sourceImage||it.source_image} style={{width:"100%",height:"100%",objectFit:"contain",padding:12,boxSizing:"border-box"}} alt={it.name}/>
                            : <ItemIllustration item={it} size={110}/>
                          }
                        </div>
                        {/* Meta */}
                        <div style={{..._row,gap:6,marginBottom:12,flexWrap:"wrap"}}>
                          {it.brand&&<div style={{background:_1a,borderRadius:8,padding:"3px 8px",border:_2a,...ss(9,400,DM)}}>{it.brand}</div>}
                          {it.category&&<div style={{background:_1a,borderRadius:8,padding:"3px 8px",border:_2a,...ss(9,400,DM)}}>{it.category}</div>}
                          {it.condition&&<div style={{background:_1a,borderRadius:8,padding:"3px 8px",border:_2a,...ss(9,400,DM)}}>{it.condition}</div>}
                          {(it.forSale||it.for_sale)&&<div style={{background:`${G}22`,borderRadius:8,padding:"3px 8px",border:`1px solid ${G}44`,...ss(9,600,G)}}>FOR SALE</div>}
                        </div>
                        {/* Stats */}
                        <div style={{display:"flex",gap:8,marginBottom:14}}>
                          {[[it.brand||"—","BRAND"],[it.category||"—","CATEGORY"],[it.condition||"—","CONDITION"]].map(([v,l])=>(
                            <div key={l} style={{flex:1,background:"#111",borderRadius:12,padding:"8px 4px",textAlign:"center",border:"1px solid #1E1E1E"}}>
                              <div style={sr(12,500,G,{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"})}>{v}</div>
                              <div style={ss(8,400,DM,{letterSpacing:1,marginTop:1})}>{l}</div>
                            </div>
                          ))}
                        </div>
                        {/* Tags */}
                        {(it.tags||[]).length>0&&(
                          <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:12}}>
                            {it.tags.map(t=><div key={t} style={{background:"#1A1A1A",borderRadius:8,padding:"3px 8px",border:"1px solid #2A2A2A",...ss(9,400,DM)}}>#{t}</div>)}
                          </div>
                        )}
                        {/* Actions */}
                        <div style={{display:"flex",gap:8}}>
                          <button onClick={()=>{
                            const wishItem={id:Date.now(),name:it.name,brand:it.brand||"Unknown",emoji:it.emoji||"👗",price:it.price||0,gap:"From @"+(it._username||"user"),inMarket:it.forSale||it.for_sale||false,sourceImage:it.sourceImage||it.source_image||null,color:it.color||null};
                            if(addToWishlist) addToWishlist(wishItem);
                            showToast(`${it.name} added to wishlist \u2746`);
                            setSelectedProfileItem(null);
                          }} style={{flex:1,padding:"11px",borderRadius:12,background:"#1A1A2A",border:`1px solid ${G}44`,...ss(9,600,G,{letterSpacing:1}),cursor:_p}}>♡ WISHLIST</button>
                          {onAddToCloset&&(
                            <button onClick={async()=>{
                              if(alreadyAddedDetail) return;
                              const newItem={id:Date.now(),name:it.name,brand:it.brand||"Unknown",category:it.category||"Tops",color:it.color||"#C4A882",price:it.price||0,emoji:it.emoji||"👗",wearCount:0,lastWorn:"Never",purchaseDate:"",condition:it.condition||"Good",forSale:false,tags:[],sourceImage:it.sourceImage||it.source_image||null};
                              await onAddToCloset(newItem);
                              setAddedItems(prev=>new Set([...prev,it.id||idx]));
                              showToast(`${it.name} added to your closet \u2746`);
                              setSelectedProfileItem(null);
                            }} style={{flex:1,padding:"11px",borderRadius:12,background:alreadyAddedDetail?"#1A2A1A":`linear-gradient(135deg,${G},#8A6E54)`,border:alreadyAddedDetail?"1px solid #2A4A2A":"none",...ss(9,700,alreadyAddedDetail?"#80C880":BK,{letterSpacing:1.5}),cursor:_p}}>
                              {alreadyAddedDetail?"✓ ADDED":"+ CLOSET"}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </React.Fragment>
              );
            })}
          </div>
        </div>
      )}


      {/* ── FOR SALE TAB ── */}
      {activeTab==="forsale"&&(
        <div style={{padding:"16px 18px",paddingBottom:16}}>
          {profile?.forSaleCount===0&&(
            <div style={{textAlign:"center",padding:"48px 0",opacity:0.4}}>
              <div style={sr(14,300,DM,{fontStyle:"italic"})}>Nothing for sale right now</div>
            </div>
          )}
          {(profile?.forSale||[]).map((item,i)=>(
            <div key={i} style={{background:"#111",borderRadius:R14,padding:"14px 16px",marginBottom:10,border:"1px solid #1E1E1E",display:"flex",gap:14,alignItems:"center"}}>
              <div style={{width:60,height:60,borderRadius:12,background:_1a,overflow:"hidden",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}>
                {item.sourceImage?<img src={item.sourceImage} style={{width:"100%",height:"100%",objectFit:"contain"}} alt={item.name}/>:<ItemIllustration item={item} size={52}/>}
              </div>
              <div style={{flex:1,minWidth:0}}>
                <div style={sr(14,500)}>{item.name}</div>
                <div style={ss(9,400,DM,{marginTop:2})}>{item.brand}{item.size&&item.size!=="—"?` · Size ${item.size}`:""}</div>
                <div style={{..._row,gap:8,marginTop:6}}>
                  <div style={{background:"#1A2A1A",borderRadius:12,padding:"2px 8px",...ss(8,600,"#A8C4A0",{letterSpacing:0.5})}}>{item.condition}</div>
                </div>
              </div>
              <div style={{textAlign:"right",flexShrink:0}}>
                <div style={sr(18,500,G)}>${item.price}</div>
                <button onClick={()=>showToast(`Offer sent on ${item.name} \u2746`)} style={{marginTop:6,padding:"6px 14px",borderRadius:12,background:`linear-gradient(135deg,${G},#8A6E54)`,border:"none",...ss(8,600,BK,{letterSpacing:1}),cursor:_p}}>OFFER</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── ABOUT TAB ── */}
      {activeTab==="about"&&(

        <div style={{padding:"16px 18px",paddingBottom:32,flexShrink:0}}>
          <div style={{background:"#111",borderRadius:R14,padding:"18px",marginBottom:14,border:"1px solid #1E1E1E"}}>
            <div style={ss(9,400,DM,{letterSpacing:1.5,marginBottom:10})}>STYLE IDENTITY</div>
            {profile?.style
              ? <div style={sr(16,400,"#C0B09A",{lineHeight:1.8,fontStyle:"italic"})}>&ldquo;{profile?.style}&rdquo;</div>
              : <div style={ss(10,400,DM,{fontStyle:"italic"})}>No style identity set yet</div>
            }
            {profile?.bio&&<div style={{marginTop:14,...ss(10,400,"#907860",{lineHeight:1.7})}}>{profile?.bio}</div>}
          </div>
          <div style={{background:"#111",borderRadius:R14,padding:"18px",marginBottom:14,border:"1px solid #1E1E1E"}}>
            <div style={ss(9,400,DM,{letterSpacing:1.5,marginBottom:12})}>WARDROBE HEALTH</div>
            {[
              {label:"Item Utilization",  value:profile?.stats.sustainabilityScore, color:"#4A8A4A"},
              {label:"Brands Diversity",  value:Math.min(100,Math.round((profile?.stats.brandsCount/20)*100)), color:G},
            ].map((bar,i)=>(
              <div key={i} style={{marginBottom:12}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}>
                  <div style={ss(9,400,MD,{letterSpacing:0.5})}>{bar.label}</div>
                  <div style={ss(9,600,bar.color)}>{bar.value}%</div>
                </div>
                <div style={{height:5,background:_1a,borderRadius:3,overflow:"hidden"}}>
                  <div style={{height:"100%",width:`${bar.value}%`,background:`linear-gradient(90deg,${bar.color},${bar.color}AA)`,borderRadius:3}}/>
                </div>
              </div>
            ))}
          </div>
          <div style={{background:"#111",borderRadius:R14,padding:"18px",border:"1px solid #1E1E1E"}}>
            <div style={ss(9,400,DM,{letterSpacing:1.5,marginBottom:12})}>CONNECT</div>
            <button onClick={()=>showToast("Messaging coming soon \u2746")} style={{width:"100%",padding:"12px",borderRadius:12,background:`linear-gradient(135deg,${G},#8A6E54)`,border:"none",display:"flex",alignItems:"center",justifyContent:"center",gap:8,...ss(10,600,BK,{letterSpacing:1}),cursor:_p}}>
              ✉ SEND A MESSAGE
            </button>
          </div>
        </div>
      )}


      </div>{/* end content scroll */}

    </div>


    {followList&&(
      <div onClick={()=>setFollowList(null)} style={{position:"fixed",top:76,left:0,right:0,bottom:0,background:"#000C",zIndex:600,display:"flex",alignItems:"flex-start",justifyContent:"center"}}>
        <div onClick={e=>e.stopPropagation()} style={{background:"#0D0D0D",borderRadius:"0 0 24px 24px",width:"100%",maxWidth:430,maxHeight:"85vh",display:"flex",flexDirection:"column",border:`1px solid ${G}22`}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"16px 20px",borderBottom:"1px solid #1E1E1E",flexShrink:0}}>
            <div style={sr(18,400)}>{followList.type==="followers"?"Followers":"Following"}</div>
            <button onClick={()=>setFollowList(null)} style={{width:28,height:28,borderRadius:"50%",background:"#1A1A1A",border:"1px solid #2A2A2A",cursor:_p,...ss(13,400,DM),display:"flex",alignItems:"center",justifyContent:"center"}}>×</button>
          </div>
          <div style={{overflowY:"auto",padding:"12px 16px 32px"}}>
            {followList.loading&&<div style={{textAlign:"center",padding:"32px 0",opacity:0.4}}><div style={{fontSize:20,animation:"spin 1.2s linear infinite",display:"inline-block"}}>✦</div></div>}
            {!followList.loading&&followList.users.length===0&&<div style={{textAlign:"center",padding:"32px 0",opacity:0.4}}><div style={ss(12,400,DM,{fontStyle:"italic"})}>No {followList.type} yet</div></div>}
            {!followList.loading&&followList.users.map(u=>(
              <div key={u.id} onClick={()=>{ setFollowList(null); if(onViewProfile) onViewProfile({userId:u.id,username:u.username}); else onClose(); }}
                style={{display:"flex",gap:12,alignItems:"center",padding:"10px 4px",borderBottom:"1px solid #1A1A1A",cursor:_p}}>
                <div style={{width:44,height:44,borderRadius:"50%",background:`linear-gradient(135deg,${G}33,${G}55)`,border:`1px solid ${G}44`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,...ss(18,600,G)}}>
                  {u.username?.[0]?.toUpperCase()||"?"}
                </div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={ss(12,600,"#E8E0D4")}>{u.username?`@${u.username}`:"Outfix User"}</div>
                  {u.style_identity&&<div style={ss(9,400,DM,{marginTop:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontStyle:"italic"})}>{u.style_identity}</div>}
                  {!u.style_identity&&u.bio&&<div style={ss(9,400,DM,{marginTop:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"})}>{u.bio}</div>}
                </div>
                <div style={ss(12,400,DM)}>›</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    )}
  </React.Fragment>
  );
}

// ── OUTFIT PORTRAIT ILLUSTRATIONS ─────────────────────────────────────────────
// Four hand-crafted SVG fashion illustrations, one per feed post


// ── REVERSE IMAGE SEARCH MODAL ───────────────────────────────────────────────

function WishlistAddModal({onClose, onAddToWishlist}){
  const [drafts,setDrafts]         = useState([]);
  const [addStep,setAddStep]       = useState(1);
  const [reviewIdx,setReviewIdx]   = useState(0);
  const [addUrlMode,setAddUrlMode] = useState(false);
  const [addUrl,setAddUrl]         = useState('');
  const [cropDraftId,setCropDraftId]     = useState(null);
  const [cropSrcW,setCropSrcW]           = useState(null);
  const [cropBgRemoveW,setCropBgRemoveW] = useState(false);
  const fileRef = useRef();
  const libRef  = useRef();

  const addPhotoDraft = (dataUrl) => {
    const id = `w_${Date.now()}`;
    const blank = {id,status:'processing',photo:dataUrl,processedPhoto:null,stage:'Identifying item\u2026',ai:{name:'',brand:'',category:'Tops',color:'#2A2A2A',price:0,emoji:'\uD83D\uDC57',tags:[]},userEdits:{}};
    setDrafts(p=>[...p,blank]);
    setAddStep(2);
    (async()=>{
      try{
        const b64=dataUrl.split(',')[1];
        const raw=await callClaudeVision(b64,'image/jpeg',`Identify this clothing item for a wishlist. Return ONLY JSON: {"name":"...","brand":"...","category":"Tops|Bottoms|Dresses|Outerwear|Shoes|Accessories","color":"#hexcode","price":0}`);
        const json=JSON.parse(raw.replace(/```json|```/g,'').trim());
        setDrafts(p=>p.map(d=>d.id===id?{...d,status:'ready',stage:'',ai:{...d.ai,...json}}:d));
      }catch(e){ setDrafts(p=>p.map(d=>d.id===id?{...d,status:'ready',stage:''}:d)); }
    })();
  };

  const addUrlDraft = (url) => {
    const id = `w_${Date.now()}`;
    const blank = {id,status:'processing',photo:null,processedPhoto:null,stage:'Reading page\u2026',ai:{name:'',brand:'',category:'Tops',color:'#2A2A2A',price:0,emoji:'\uD83D\uDC57',tags:[]},userEdits:{},_url:url};
    setDrafts(p=>[...p,blank]);
    setAddStep(2);
    (async()=>{
      try{
        const urlObj=new URL(url);
        const slug=urlObj.pathname.split('/').filter(Boolean).join(' ').replace(/-/g,' ');
        const domain=urlObj.hostname.replace('www.','').replace('.com','').replace('.co','');
        const raw=await callClaude(`URL: "${url}"\nDomain: ${domain}\nPath: "${slug}"\nIdentify this wishlist item. Return ONLY JSON: {"name":"...","brand":"...","category":"Tops|Bottoms|Dresses|Outerwear|Shoes|Accessories","color":"#hexcode","price":0}`);
        const json=JSON.parse(raw.replace(/```json|```/g,'').trim());
        setDrafts(p=>p.map(d=>d.id===id?{...d,status:'ready',stage:'',ai:{...d.ai,...json}}:d));
      }catch(e){ setDrafts(p=>p.map(d=>d.id===id?{...d,status:'ready',stage:''}:d)); }
    })();
  };

  const getDV=(draft,f)=>draft.userEdits[f]!==undefined?draft.userEdits[f]:draft.ai[f];
  const setDF=(id,f,v)=>setDrafts(p=>p.map(d=>d.id===id?{...d,userEdits:{...d.userEdits,[f]:v}}:d));

  const confirmDraft=(draft)=>{
    const get=f=>getDV(draft,f);
    const cat=get('category')||'Tops';
    const emojiMap={Tops:'\uD83D\uDC5A',Bottoms:'\uD83D\uDC56',Dresses:'\uD83D\uDC57',Outerwear:'\uD83E\uDDE5',Shoes:'\uD83D\uDC5F',Accessories:'\u2728'};
    onAddToWishlist({id:Date.now(),name:get('name')||'Wishlist Item',brand:get('brand')||'Unknown',price:parseInt(get('price'))||0,emoji:emojiMap[cat]||'\uD83D\uDC57',category:cat,color:get('color')||'#2A2A2A',tags:get('tags')||[],inMarket:false,sourceImage:draft.processedPhoto||draft.photo||null,sourceUrl:draft._url||null,gap:'Saved to wishlist'});
    const remaining=drafts.filter(d=>d.id!==draft.id);
    setDrafts(remaining);
    if(!remaining.some(d=>d.status==='ready')) onClose();
    else setReviewIdx(i=>Math.min(i,remaining.filter(d=>d.status==='ready').length-1));
  };

  const catEmojiMap={Tops:'👚',Bottoms:'👖',Dresses:'👗',Outerwear:'🧥',Shoes:'👟',Accessories:'✨'};

  return(
    <React.Fragment>
      {cropSrcW&&(
        <div style={{position:'fixed',inset:0,zIndex:220,maxWidth:430,margin:'0 auto'}}>
          <CropModal src={cropSrcW} removeBgOnSave={cropBgRemoveW}
            onCancel={()=>{setCropSrcW(null);setCropDraftId(null);}}
            onSave={cropped=>{setCropSrcW(null);if(cropDraftId) setDrafts(p=>p.map(d=>d.id===cropDraftId?{...d,processedPhoto:cropped,photo:cropped}:d));setCropDraftId(null);}}/>
        </div>
      )}
      <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{display:'none'}} onChange={e=>{const f=e.target.files?.[0];if(f){const r=new FileReader();r.onload=ev=>addPhotoDraft(ev.target.result);r.readAsDataURL(f);}e.target.value='';}}/>
      <input ref={libRef} type="file" accept="image/*" multiple style={{display:'none'}} onChange={e=>{[...e.target.files].forEach(f=>{const r=new FileReader();r.onload=ev=>addPhotoDraft(ev.target.result);r.readAsDataURL(f);});e.target.value='';}}/>
      <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'#000000CC',zIndex:110,maxWidth:430,margin:'0 auto',display:'flex',flexDirection:'column',justifyContent:'flex-end'}} onClick={onClose}>
        <div onClick={e=>e.stopPropagation()} style={{background:'#0D0D0D',borderRadius:'22px 22px 0 0',border:'1px solid #2A2418',maxHeight:'92vh',display:'flex',flexDirection:'column'}}>

          {addStep===1&&(
            <React.Fragment>
              <div style={{padding:'16px 18px 12px',display:'flex',justifyContent:'space-between',alignItems:'center',flexShrink:0}}>
                <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:20,fontWeight:300,color:'#F0EBE3'}}>Add to Wishlist</div>
                <button onClick={onClose} style={{background:'none',border:'none',color:'#4A4038',fontSize:18,cursor:_p}}>x</button>
              </div>
              <div style={{padding:'0 14px 22px',display:'flex',flexDirection:'column',gap:10}}>
                <div style={{display:'flex',gap:10,justifyContent:'center',alignItems:'center',padding:'16px 0'}}>
                  <div onClick={()=>libRef.current?.click()} style={{width:54,height:54,borderRadius:'50%',background:'#111',border:'1px solid #2A2A2A',display:'flex',alignItems:'center',justifyContent:'center',cursor:_p}}>
                    <svg width="22" height="22" viewBox="0 0 20 20" fill="none"><rect x="1" y="3" width="18" height="14" rx="2" stroke={G} strokeWidth="1.4" fill="none"/><circle cx="7" cy="8" r="2" stroke={G} strokeWidth="1.3" fill="none"/><path d="M1 14L6 9L9 12L13 7L19 14" stroke={G} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" fill="none"/></svg>
                  </div>
                  <div onClick={()=>fileRef.current?.click()} style={{width:70,height:70,borderRadius:'50%',background:G,display:'flex',alignItems:'center',justifyContent:'center',cursor:_p,boxShadow:'0 0 0 3px #0D0D0D, 0 0 0 5px rgba(196,168,130,0.4)'}}>
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="#0D0D0D"><circle cx="12" cy="12" r="5"/><path d="M9 3h6l1.5 2H18a1 1 0 011 1v12a1 1 0 01-1 1H6a1 1 0 01-1-1V6a1 1 0 011-1h1.5L9 3z"/></svg>
                  </div>
                  <div onClick={()=>setAddUrlMode(u=>!u)} style={{width:54,height:54,borderRadius:'50%',background:addUrlMode?'rgba(196,168,130,0.15)':'#111',border:addUrlMode?'1px solid #C4A882':'1px solid #2A2A2A',display:'flex',alignItems:'center',justifyContent:'center',cursor:_p}}>
                    <svg width="22" height="22" viewBox="0 0 20 20" fill="none"><path d="M8 12L12 8" stroke={G} strokeWidth="1.4" strokeLinecap="round"/><path d="M9.5 6.5L11 5C12.2 3.8 14.2 3.8 15.4 5C16.6 6.2 16.6 8.2 15.4 9.4L13.5 11.3" stroke={G} strokeWidth="1.4" strokeLinecap="round" fill="none"/><path d="M10.5 13.5L9 15C7.8 16.2 5.8 16.2 4.6 15C3.4 13.8 3.4 11.8 4.6 10.6L6.5 8.7" stroke={G} strokeWidth="1.4" strokeLinecap="round" fill="none"/></svg>
                  </div>
                </div>
                {addUrlMode&&(
                  <div style={{display:'flex',gap:8}}>
                    <input value={addUrl} onChange={e=>setAddUrl(e.target.value)} autoFocus
                      onKeyDown={e=>{if(e.key==='Enter'&&addUrl.trim()){addUrlDraft(addUrl.trim());setAddUrl('');setAddUrlMode(false);}}}
                      placeholder="https://store.com/item-link..."
                      style={{flex:1,background:'#111',border:'1px solid rgba(196,168,130,0.4)',borderRadius:12,padding:'10px 14px',fontSize:11,fontWeight:400,color:'#C0B8B0',outline:'none'}}/>
                    <button onClick={()=>{if(addUrl.trim()){addUrlDraft(addUrl.trim());setAddUrl('');setAddUrlMode(false);}}}
                      style={{padding:'10px 16px',borderRadius:12,background:'linear-gradient(135deg,#C4A882,#8A6E54)',border:'none',fontSize:9,fontWeight:700,color:'#0D0D0D',letterSpacing:1,cursor:_p}}>FIND</button>
                  </div>
                )}
              </div>
            </React.Fragment>
          )}

          {addStep===2&&(
            <React.Fragment>
              <div style={{padding:'16px 18px 10px',display:'flex',justifyContent:'space-between',alignItems:'center',flexShrink:0}}>
                <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:20,fontWeight:300,color:'#F0EBE3'}}>Processing</div>
                <div style={{background:'rgba(196,168,130,0.15)',border:'1px solid rgba(196,168,130,0.3)',borderRadius:R18,padding:'3px 10px',fontSize:9,fontWeight:600,color:G,letterSpacing:1}}>
                  {drafts.filter(d=>d.status==='ready').length}/{drafts.length} READY
                </div>
              </div>
              <div style={{maxHeight:220,overflowY:'auto',padding:'0 14px'}}>
                {drafts.map(draft=>(
                  <div key={draft.id} onClick={()=>{if(draft.status==='ready'){setReviewIdx(drafts.filter(d=>d.status==='ready').indexOf(draft));setAddStep(3);}}}
                    style={{background:'#111',borderRadius:R14,border:'1px solid '+(draft.status==='ready'?'#2A2418':'#1E1E1E'),marginBottom:8,display:'flex',gap:10,alignItems:'center',padding:'10px 12px',cursor:draft.status==='ready'?_p:'default'}}>
                    <div style={{width:44,height:44,borderRadius:10,overflow:'hidden',background:'#1A1A1A',flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center'}}>
                      {draft.photo?<img src={draft.photo} style={{width:'100%',height:'100%',objectFit:'cover'}} alt=""/>:<span style={{fontSize:20}}>🖼</span>}
                    </div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:11,fontWeight:500,color:'#E8E0D4',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',marginBottom:2}}>{draft.ai.name||draft._url||'Photo scan'}</div>
                      {draft.status==='processing'
                        ?<div style={{display:'flex',alignItems:'center',gap:4}}><span style={{fontSize:9,animation:'spin 1.2s linear infinite',display:'inline-block',color:G}}>✦</span><span style={{fontSize:8,color:'#4A4038'}}>{draft.stage}</span></div>
                        :<div style={{display:'flex',alignItems:'center',gap:4}}><span style={{fontSize:9,color:'#80C880'}}>✓</span><span style={{fontSize:8,fontWeight:500,color:'#80C880'}}>Ready</span></div>
                      }
                    </div>
                    {draft.status==='ready'&&<span style={{fontSize:13,color:'#4A4038'}}>›</span>}
                  </div>
                ))}
              </div>
              <div style={{padding:'10px 14px 22px',display:'flex',gap:8,flexDirection:'column',flexShrink:0}}>
                <button onClick={()=>setAddStep(1)} style={{width:'100%',padding:'10px',borderRadius:12,background:'none',border:'1px solid #2A2A2A',fontSize:9,fontWeight:600,color:'#4A4038',letterSpacing:1,cursor:_p}}>+ ADD ANOTHER</button>
                <button onClick={()=>{setReviewIdx(0);setAddStep(3);}} disabled={!drafts.some(d=>d.status==='ready')}
                  style={{width:'100%',padding:'11px',borderRadius:12,background:drafts.some(d=>d.status==='ready')?'linear-gradient(135deg,#C4A882,#8A6E54)':'#1A1A1A',border:'none',fontSize:10,fontWeight:700,color:drafts.some(d=>d.status==='ready')?'#0D0D0D':'#4A4038',letterSpacing:1.5,cursor:drafts.some(d=>d.status==='ready')?_p:'default'}}>
                  REVIEW {drafts.filter(d=>d.status==='ready').length} ITEMS →
                </button>
              </div>
            </React.Fragment>
          )}

          {addStep===3&&(()=>{
            const ready=drafts.filter(d=>d.status==='ready');
            if(!ready.length){onClose();return null;}
            const idx=Math.min(reviewIdx,ready.length-1);
            const draft=ready[idx];
            const get=f=>getDV(draft,f);
            const set=(f,v)=>setDF(draft.id,f,v);
            const prev=draft.processedPhoto||draft.photo||null;
            return(
              <React.Fragment>
                <div style={{padding:'14px 16px 8px',display:'flex',alignItems:'center',justifyContent:'space-between',flexShrink:0}}>
                  <button onClick={()=>setAddStep(2)} style={{background:'none',border:'none',cursor:_p,fontSize:9,fontWeight:600,color:'#4A4038',letterSpacing:0.5}}>Back</button>
                  <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:18,fontWeight:300,color:'#F0EBE3'}}>Review Item</div>
                  <div style={{fontSize:9,fontWeight:600,color:'#4A4038',letterSpacing:1}}>{idx+1} OF {ready.length}</div>
                </div>
                {ready.length>1&&(
                  <div style={{display:'flex',justifyContent:'center',gap:6,paddingBottom:8}}>
                    {ready.map((_,i)=><div key={i} onClick={()=>setReviewIdx(i)} style={{width:i===idx?16:5,height:5,borderRadius:3,background:i===idx?G:'#2A2A2A',transition:'all .3s',cursor:_p}}/>)}
                  </div>
                )}
                <div style={{flex:1,overflowY:'auto',padding:'0 14px 4px'}}>
                  <div style={{background:'#141210',borderRadius:16,border:'1px solid #2A2418',overflow:'hidden',marginBottom:10}}>
                    <div style={{height:160,background:'linear-gradient(135deg,'+( get('color')||'#1A1A1A')+'22,'+(get('color')||'#1A1A1A')+'44)',display:'flex',alignItems:'center',justifyContent:'center',position:'relative',cursor:prev?_p:'default'}} onClick={()=>{if(prev){setCropDraftId(draft.id);setCropSrcW(prev);setCropBgRemoveW(false);}}}>
                      {prev?<img src={prev} style={{width:'100%',height:'100%',objectFit:'contain',padding:8,boxSizing:'border-box'}} alt=""/>:<div style={{display:'flex',alignItems:'center',justifyContent:'center',width:'100%',height:'100%'}}><CatSVG cat={get('category')||'Tops'} size={52} color="rgba(196,168,130,0.45)"/></div>}
                    </div>
                    <div style={{padding:'12px'}}>
                      <div style={{marginBottom:8}}>
                        <div style={{fontSize:8,fontWeight:600,color:'#4A4038',letterSpacing:1.5,marginBottom:3}}>ITEM NAME</div>
                        <input value={get('name')||''} onChange={e=>set('name',e.target.value)} placeholder="e.g. Cashmere Crewneck"
                          style={{width:'100%',boxSizing:'border-box',background:'#111',border:'1px solid #2A2A2A',borderRadius:10,padding:'7px 10px',fontSize:12,fontWeight:500,color:'#E8E0D4',outline:'none'}}/>
                      </div>
                      <div style={{marginBottom:8}}>
                        <div style={{fontSize:8,fontWeight:600,color:'#4A4038',letterSpacing:1.5,marginBottom:3}}>BRAND</div>
                        <input value={get('brand')||''} onChange={e=>set('brand',e.target.value)} placeholder="e.g. Toteme, Zara..."
                          style={{width:'100%',boxSizing:'border-box',background:'#111',border:'1px solid #2A2A2A',borderRadius:10,padding:'7px 10px',fontSize:11,fontWeight:400,color:'#C0B8B0',outline:'none'}}/>
                      </div>
                      <div style={{marginBottom:8}}>
                        <div style={{fontSize:8,fontWeight:600,color:'#4A4038',letterSpacing:1.5,marginBottom:5}}>CATEGORY</div>
                        <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
                          {['Tops','Bottoms','Dresses','Outerwear','Shoes','Accessories'].map(cat=>(
                            <button key={cat} onClick={()=>set('category',cat)} style={{padding:'4px 9px',borderRadius:R18,cursor:_p,background:get('category')===cat?'rgba(196,168,130,0.15)':'#111',border:get('category')===cat?'1.5px solid #C4A882':'1px solid #2A2A2A',fontSize:8,fontWeight:get('category')===cat?600:400,color:get('category')===cat?G:'#4A4038',display:'flex',alignItems:'center',gap:5}}>
                              <CatSVG cat={cat} size={12} color={get('category')===cat?G:'#4A4038'}/>{cat}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div style={{display:'flex',alignItems:'center',gap:8}}>
                        <div style={{fontSize:8,fontWeight:600,color:'#4A4038',letterSpacing:1.5}}>PRICE</div>
                        <div style={{display:'flex',alignItems:'center',gap:3,background:'#111',border:'1px solid #2A2A2A',borderRadius:8,padding:'5px 10px',flex:1}}>
                          <span style={{fontSize:11,color:'#4A4038'}}>$</span>
                          <input value={get('price')?(parseFloat(get('price'))%1===0?parseInt(get('price')):parseFloat(get('price')).toFixed(2)):''}  onChange={e=>set('price',e.target.value.replace(/[^0-9.]/g,''))} placeholder="0" inputMode="decimal"
                            style={{flex:1,background:'none',border:'none',outline:'none',fontSize:12,color:G,width:'100%'}}/>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <div style={{padding:'8px 14px 22px',flexShrink:0}}>
                  <button onClick={()=>confirmDraft(draft)} style={{width:'100%',padding:'12px',borderRadius:12,background:'linear-gradient(135deg,#C4A882,#8A6E54)',border:'none',fontSize:10,fontWeight:700,color:'#0D0D0D',letterSpacing:1.5,cursor:_p}}>
                    ADD TO WISHLIST ✦
                  </button>
                </div>
              </React.Fragment>
            );
          })()}
        </div>
      </div>
    </React.Fragment>
  );
}


function DiscoverTab({showToast,wishlist,setWishlist,addToWishlist,items,styleProfile={}}){
  const [view,setView]=useState("pairings");
  const [selectedTrend,setSelectedTrend]=useState(null);

  // AI state — pairings
  const [aiAnalysis,setAiAnalysis]=useState(()=>{
    try{ const c=JSON.parse(localStorage.getItem("outfix_pairings_cache")||"null"); return c?.analysis||null; }catch(e){ return null; }
  });
  const [aiPairings,setAiPairings]=useState(()=>{
    try{ const c=JSON.parse(localStorage.getItem("outfix_pairings_cache")||"null"); return c?.pairings||[]; }catch(e){ return []; }
  });
  const [pairingsLoading,setPairingsLoading]=useState(false);
  const [pairingsError,setPairingsError]=useState(null);

  // AI state — gaps
  const [aiGaps,setAiGaps]=useState(null);
  const [gapScore,setGapScore]=useState(null);
  const [scoreBreakdown,setScoreBreakdown]=useState(null);
  const [gapsLoading,setGapsLoading]=useState(false);
  const [gapsError,setGapsError]=useState(null);
  const prevView = useRef(null);

  // ── Deterministic score calculations ─────────────────────────────────────────
  const calcVersatility = (items) => {
    const coreCategories = ["Tops","Bottoms","Shoes"];
    const bonusCategories = ["Dresses","Outerwear","Accessories"];
    const cats = new Set(items.map(i=>i.category));
    const coreHave = coreCategories.filter(c=>cats.has(c)).length;
    const bonusHave = bonusCategories.filter(c=>cats.has(c)).length;
    const score = Math.min(20, Math.round((coreHave/3)*14 + (bonusHave/3)*6));
    const missing = [...coreCategories,...bonusCategories].filter(c=>!cats.has(c));
    const label = score>=18?"Excellent":score>=14?"Good":score>=10?"Fair":"Needs work";
    const note = missing.length===0
      ? "You have all core categories covered."
      : `Missing: ${missing.slice(0,3).join(", ")}`;
    return {score,label,note};
  };

  const calcUtilization = (items) => {
    if(!items.length) return {score:0,label:"No data",note:"Add pieces to your closet."};
    const worn = items.filter(i=>i.wearCount>0).length;
    const pct = worn/items.length;
    const score = Math.round(pct*20);
    const unworn = items.length - worn;
    const label = score>=18?"Excellent":score>=14?"Good":score>=10?"Fair":"Needs work";
    const note = unworn===0
      ? "Every item has been worn at least once."
      : `${unworn} item${unworn>1?"s":""} never worn — consider selling or donating.`;
    return {score,label,note};
  };

  const calcValueEfficiency = (items) => {
    const wornItems = items.filter(i=>i.wearCount>0&&i.price>0);
    if(!wornItems.length) return {score:10,label:"Not enough data",note:"Wear more items to build your cost-per-wear."};
    const avgCPW = wornItems.reduce((s,i)=>s+(i.price/i.wearCount),0)/wornItems.length;
    const score = avgCPW<=5?20:avgCPW<=15?17:avgCPW<=30?14:avgCPW<=60?10:6;
    const label = score>=17?"Excellent":score>=14?"Good":score>=10?"Fair":"Needs work";
    const note = `Avg cost-per-wear: $${avgCPW.toFixed(2)}. ${score>=17?"Great value from your wardrobe.":"Wear items more to improve this."}`;
    return {score,label,note,avgCPW};
  };

  const closetSummary = items.map(i=>`${i.name} (${i.category}, ${i.brand||"no brand"}, worn ${i.wearCount||0}x, $${i.price})`).join("; ");

  const loadPairings = async () => {
    setPairingsLoading(true); setPairingsError(null);
    try {
      // Build style context from learned feedback
      const profileParts = [];
      try{
        if(styleProfile?.aesthetic?.length) profileParts.push(`Aesthetic: ${styleProfile.aesthetic.join(", ")}`);
        if(styleProfile?.fitPref?.length) profileParts.push(`Fit preference: ${styleProfile.fitPref.join(", ")}`);
        if(styleProfile?.colorPalette) profileParts.push(`Colour palette: ${styleProfile.colorPalette}`);
        if(styleProfile?.avoidPairings?.length) profileParts.push(`NEVER combine: ${styleProfile.avoidPairings.join("; ")}`);
        if(styleProfile?.learnedDislikes?.length) profileParts.push(`User dislikes: ${styleProfile.learnedDislikes.join("; ")}`);
        if(styleProfile?.learnedLoves?.length) profileParts.push(`User loves: ${styleProfile.learnedLoves.join("; ")}`);
      }catch(profileErr){}
      const profileContext = profileParts.length ? `\n\nUser style profile:\n${profileParts.join("\n")}` : "";

      const raw = await callClaude(
        `My wardrobe: ${closetSummary}.${profileContext}\n\nGive me a short one-sentence style analysis of my overall wardrobe aesthetic, then 6 specific outfit pairing suggestions. You MUST strictly respect every preference in the style profile above — especially the NEVER combine and User dislikes rules. Do not suggest any combination that violates these rules. Respond ONLY with JSON in this exact shape: {"analysis":"...","pairings":[{"id":1,"trigger":"item name","suggestion":"what to pair it with","vibe":"style label","score":97},...]}`
      );
      const json = JSON.parse(raw.replace(/```json|```/g,"").trim());
      setAiAnalysis(json.analysis);
      setAiPairings(json.pairings);
      // Cache for next session
      try{ localStorage.setItem("outfix_pairings_cache", JSON.stringify({analysis:json.analysis,pairings:json.pairings,ts:Date.now()})); }catch(e){}
    } catch(e) {
      setPairingsError("Couldn't load pairings — try again.");
    }
    setPairingsLoading(false);
  };

  const loadGaps = async () => {
    setGapsLoading(true); setGapsError(null);

    // Compute deterministic dimensions immediately
    const versatility = calcVersatility(items);
    const utilization = calcUtilization(items);
    const valueEff = calcValueEfficiency(items);

    try {
      const raw = await callClaude(
        `I have ${items.length} clothing items. My wardrobe: ${closetSummary}.

Rate my wardrobe on TWO dimensions (0-20 points each) and identify 6 missing pieces. Be honest and specific — don't just give high scores.

Cohesion (0-20): Do the items work together? Consider color palette harmony, style consistency, and whether pieces can be mixed and matched. Deduct points for clashing styles or too many one-off pieces.

Completeness (0-20): How well does this wardrobe cover different life occasions (work, casual, evening, weekend, travel)? Deduct points for obvious gaps in lifestyle coverage.

Respond ONLY with this exact JSON:
{"cohesion":{"score":14,"label":"Good","note":"one sentence explanation"},"completeness":{"score":12,"label":"Fair","note":"one sentence explanation"},"gaps":[{"emoji":"👜","gap":"item name","suggestion":"why needed and style suggestion","price":"$X-Y"},{"emoji":"🥾","gap":"item name","suggestion":"why needed","price":"$X-Y"},{"emoji":"🧣","gap":"item name","suggestion":"why needed","price":"$X-Y"}]}`
      );
      const json = JSON.parse(raw.replace(/```json|```/g,"").trim());
      const total = versatility.score + utilization.score + valueEff.score + (json.cohesion?.score||10) + (json.completeness?.score||10);
      setGapScore(total);
      setScoreBreakdown({
        versatility,
        utilization,
        valueEfficiency: valueEff,
        cohesion: json.cohesion || {score:10,label:"Fair",note:"Style analysis unavailable."},
        completeness: json.completeness || {score:10,label:"Fair",note:"Coverage analysis unavailable."},
        total,
      });
      setAiGaps(json.gaps||[]);
    } catch(e) {
      // Fallback: show deterministic scores with placeholder AI scores
      const cohesion = {score:12,label:"Good",note:"Your neutral palette creates a cohesive base."};
      const completeness = {score:11,label:"Fair",note:"Add evening and travel pieces to improve coverage."};
      const total = versatility.score + utilization.score + valueEff.score + cohesion.score + completeness.score;
      setGapScore(total);
      setScoreBreakdown({versatility,utilization,valueEfficiency:valueEff,cohesion,completeness,total});
      setAiGaps([
        {emoji:"👜",gap:"Structured tote bag",suggestion:"A Polene or Toteme tote completes office and weekend looks.",price:"$200-500"},
        {emoji:"🥾",gap:"Ankle boots",suggestion:"Chelsea boots in tan or black bridge casual and evening.",price:"$150-350"},
        {emoji:"🧣",gap:"Silk scarf",suggestion:"Adds color and versatility without a bold commitment.",price:"$80-200"},
        {emoji:"🧥",gap:"Classic trench coat",suggestion:"A camel or navy trench bridges every season and occasion.",price:"$200-600"},
        {emoji:"👟",gap:"Clean white sneakers",suggestion:"Versatile casual shoe that grounds minimal and smart-casual looks.",price:"$80-250"},
        {emoji:"💍",gap:"Minimalist gold jewellery",suggestion:"Stacking rings or a delicate chain elevate any outfit instantly.",price:"$50-200"},
      ]);
    }
    setGapsLoading(false);
  };

  // Auto-load when switching to tab
  useEffect(()=>{
    if(view==="pairings" && prevView.current!=="pairings" && !pairingsLoading){
      try{
        const c=JSON.parse(localStorage.getItem("outfix_pairings_cache")||"null");
        const cacheAge = c?.ts ? (Date.now()-c.ts) : Infinity;
        const cacheStale = cacheAge > 24*60*60*1000; // refresh after 24 hours
        if(!c || cacheStale) loadPairings();
      }catch(e){ if(!aiPairings.length) loadPairings(); }
    }
    if((view==="gaps"||view==="score") && prevView.current!=="gaps" && prevView.current!=="score" && !aiGaps && !gapsLoading) loadGaps();
    prevView.current = view;
  },[view]);

  const gaps = aiGaps || [
    {emoji:"👜",gap:"No structured bag",suggestion:"A Toteme or Polene tote would complete your office looks.",price:"$200-500"},
    {emoji:"🥾",gap:"No ankle boots",suggestion:"Chelsea boots in tan or black bridge casual and evening.",price:"$150-350"},
    {emoji:"🧣",gap:"No silk scarf",suggestion:"A printed silk scarf adds color without bold commitment.",price:"$80-200"},
    {emoji:"🧥",gap:"No transitional coat",suggestion:"A camel or navy trench bridges every season and occasion.",price:"$200-600"},
    {emoji:"👟",gap:"No clean white sneakers",suggestion:"Versatile casual shoe that grounds minimal and smart-casual looks.",price:"$80-250"},
    {emoji:"💍",gap:"No minimal jewellery",suggestion:"Stacking rings or a delicate chain elevate any outfit instantly.",price:"$50-200"},
  ];

  // ── Trends detail view (lives inside Discover) ──
  if(selectedTrend){
    const trend=trendItems.find(t=>t.id===selectedTrend);
    return(
      <div className="fu" style={{padding:"0"}}>
        <div style={{position:"relative",height:220,background:`linear-gradient(160deg,${trend.palette[0]}44,${trend.palette[1]}88)`,display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden"}}>
          <button onClick={()=>setSelectedTrend(null)} style={{position:"absolute",top:16,left:16,width:34,height:34,borderRadius:"50%",background:"#0D0D0DAA",border:_2a,cursor:_p,...ss(14,400,MD),display:"flex",alignItems:"center",justifyContent:"center"}}>←</button>
          <div style={{textAlign:"center"}}>
            <div style={sr(32,300,trend.palette[2]||G,{letterSpacing:2})}>{trend.trend}</div>
            <div style={ss(9,400,DM,{marginTop:6,letterSpacing:2})}>{trend.season.toUpperCase()} · {trend.source.toUpperCase()}</div>
          </div>
          <div style={{position:"absolute",bottom:16,left:"50%",transform:"translateX(-50%)",display:"flex",gap:8}}>
            {trend.palette.map((c,i)=><div key={i} style={{width:20,height:20,borderRadius:"50%",background:c,border:"2px solid #0D0D0D44"}}/>)}
          </div>
        </div>
        <div style={{padding:"20px 24px 80px"}} className="sc">
          <div style={ss(8,600,DM,{letterSpacing:1.5,marginBottom:8})}>THE TREND</div>
          <div style={sr(14,300,"#C0B8B0",{lineHeight:1.9,marginBottom:20})}>{trend.description}</div>
          <div style={{background:"linear-gradient(135deg,#0A1A0A,#0F1F0F)",border:"1px solid #1A3A1A",borderRadius:R14,padding:"16px",marginBottom:20}}>
            <div style={ss(8,700,"#60A870",{letterSpacing:1.5,marginBottom:10})}>YOUR CLOSET MATCH</div>
            {trend.closetMatch.map((m,i)=>(
              <div key={i} style={{..._row,gap:8,marginBottom:8}}>
                <div style={{width:6,height:6,borderRadius:"50%",background:"#60A870",flexShrink:0}}/>
                <div style={ss(10,400,"#A0C0A0",{lineHeight:1.5})}>{m}</div>
              </div>
            ))}
          </div>
          <div style={ss(8,600,DM,{letterSpacing:1.5,marginBottom:10})}>SHOP THE TREND</div>
          {trend.shoppable.map((s,i)=>(
            <div key={i} style={{background:CD,borderRadius:R14,padding:"12px 14px",marginBottom:10,border:`1px solid ${BR}`,display:"flex",alignItems:"center",gap:12}}>
              <div style={{width:44,height:44,borderRadius:12,background:_1a,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,flexShrink:0}}>{s.emoji}</div>
              <div style={{flex:1,minWidth:0}}>
                <div style={sr(14,500,undefined,{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"})}>{s.name}</div>
                <div style={ss(9,400,DM,{marginTop:2})}>{s.brand}</div>
              </div>
              <div style={{textAlign:"right",flexShrink:0}}>
                <div style={sr(14,400,G)}>${s.price.toLocaleString()}</div>
                <button onClick={()=>showToast("Added to wishlist \u2746")} style={{marginTop:4,...ss(8,600,G,{background:"none",border:"none",cursor:_p,letterSpacing:0.8})}}>+ WISHLIST</button>
              </div>
            </div>
          ))}
          {trend.tags.map(t=><span key={t} style={{display:"inline-block",background:_1a,border:_2a,borderRadius:R18,padding:"4px 12px",marginRight:6,marginBottom:6,...ss(9,400,DM,{letterSpacing:0.8})}}>#{t}</span>)}
        </div>
      </div>
    );
  }

  return(
    <div className="fu" style={{padding:"4px 24px"}}>
      <div style={{marginBottom:16}}>
        <div style={sr(19,300)}>Discover</div>
        <div style={ss(10,400,DM,{letterSpacing:1,marginTop:2})}>PAIRINGS  MISSING PIECES</div>
      </div>
      <div style={{display:"flex",gap:8,marginBottom:18}}>
        <button className="pb" onClick={()=>setView("score")} style={{padding:"8px 12px",borderRadius:12,background:view==="score"?G:"#1A1A1A",border:view==="score"?"none":"1px solid #222",...ss(9,view==="score"?600:400,view==="score"?BK:DM,{letterSpacing:1}),whiteSpace:"nowrap"}}>✦ Score</button>
        {[["pairings","Pairings"],["gaps","Missing Pieces"]].map(([k,l])=>(
          <button key={k} className="pb" onClick={()=>setView(k)} style={{flex:1,padding:"8px 4px",borderRadius:12,background:view===k?G:"#1A1A1A",border:view===k?"none":"1px solid #222",...ss(9,view===k?600:400,view===k?BK:DM,{letterSpacing:1})}}>{l}</button>
        ))}
      </div>

      {view==="pairings" && (
        <React.Fragment>
          {/* Style rules — always visible when feedback exists */}
          {((styleProfile?.learnedDislikes?.length||0)+(styleProfile?.avoidPairings?.length||0))>0&&(
            <div style={{background:"#0A0A0A",borderRadius:R14,padding:"12px 14px",border:"1px solid #1A1A1A",marginBottom:14}}>
              <div style={ss(8,600,DM,{letterSpacing:1.5,marginBottom:8})}>AI IS AVOIDING</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                {[...(styleProfile?.avoidPairings||[]),...(styleProfile?.learnedDislikes||[])].map((d,i)=>(
                  <div key={i} style={{background:"#1A1010",border:"1px solid #3A1A1A",borderRadius:R18,padding:"3px 10px",...ss(9,400,"#A06060")}}>{d}</div>
                ))}
              </div>
            </div>
          )}
          {pairingsLoading && (
            <AILoader label="Analyzing pairings" size="lg"/>
          )}
          {!pairingsLoading && (aiAnalysis || aiPairings.length>0) && (
            <React.Fragment>
              <div style={{background:"linear-gradient(135deg,#1A160F,#1E1A12)",borderRadius:R18,padding:"18px",border:"1px solid #2A2418",marginBottom:12}}>
                <div style={{display:"flex",gap:10,alignItems:"center",marginBottom:12}}>
                  <div style={{width:36,height:36,borderRadius:"50%",background:`linear-gradient(135deg,${G},#8A6E54)`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16}}>✦</div>
                  <div><div style={sr(15,500)}>Closet Analysis</div><div style={ss(9,400,MD,{letterSpacing:1})}>BASED ON {items.length} ITEMS</div></div>
                </div>
                <div style={sr(14,400,G,{fontStyle:"italic",lineHeight:1.6})}>
                  "{aiAnalysis}"
                </div>
              </div>
              {aiPairings.map(s=>(
                <div key={s.id} className="ch" style={{background:CD,borderRadius:R18,padding:"16px 18px",marginBottom:12,border:`1px solid ${BR}`}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
                    <div style={ss(9,400,MD,{letterSpacing:1})}>STARTING WITH</div>
                    <div style={{background:"#C4A88222",borderRadius:R18,padding:"3px 10px",...ss(9,400,G)}}>Match {s.score}%</div>
                  </div>
                  <div style={sr(15,500,undefined,{marginBottom:4})}>{s.trigger}</div>
                  <div style={sr(13,400,MD,{marginBottom:10})}>to {s.suggestion}</div>
                  <Tag>{s.vibe}</Tag>
                </div>
              ))}
            </React.Fragment>
          )}
          {!pairingsLoading && !aiAnalysis && aiPairings.length===0 && !pairingsError && (
            <div style={{background:"linear-gradient(135deg,#141008,#1A1408)",borderRadius:R18,padding:"28px 22px",border:`1px solid ${G}22`,textAlign:"center",marginBottom:16}}>
              <div style={{width:48,height:48,borderRadius:"50%",background:`${G}18`,border:`1px solid ${G}33`,display:"inline-flex",alignItems:"center",justifyContent:"center",marginBottom:14,fontSize:20,color:G}}>✦</div>
              <div style={sr(18,400,"#E8E0D4",{marginBottom:8})}>AI Pairings</div>
              <div style={ss(10,400,"#7A6E60",{lineHeight:1.6,maxWidth:280,margin:"0 auto"})}>
                Tap below to have Claude analyze your wardrobe and suggest 6 outfit pairings using items from your closet.
              </div>
            </div>
          )}
          <Btn onClick={loadPairings} full disabled={pairingsLoading}>
            {pairingsLoading ? "GENERATING…" : "GENERATE NEW PAIRINGS"}
          </Btn>
          {!pairingsLoading&&aiPairings.length>0&&(()=>{
            try{
              const c=JSON.parse(localStorage.getItem("outfix_pairings_cache")||"null");
              if(!c?.ts) return null;
              const mins=Math.floor((Date.now()-c.ts)/60000);
              const label=mins<60?`${mins}m ago`:mins<1440?`${Math.floor(mins/60)}h ago`:`${Math.floor(mins/1440)}d ago`;
              return <div style={{textAlign:"center",marginTop:8,...ss(9,400,DM)}}>Last generated {label}</div>;
            }catch(e){ return null; }
          })()}
        </React.Fragment>
      )}

      {view==="score" && (
        <React.Fragment>
          {gapsLoading && (
            <AILoader label="Calculating your score" size="lg"/>
          )}
          {!gapsLoading && (()=>{
            const bd = scoreBreakdown;
            const total = bd?.total || gapScore || 0;
            const scoreColor = total>=80?"#80C880":total>=65?G:"#C4A060";
            const dims = bd ? [
              {key:"versatility",   label:"Versatility",       icon:"🗂",  desc:"Category coverage",      ...bd.versatility},
              {key:"utilization",   label:"Utilization",       icon:"📊",  desc:"Items actually worn",    ...bd.utilization},
              {key:"valueEff",      label:"Value Efficiency",  icon:"💰",  desc:"Cost-per-wear",          ...bd.valueEfficiency},
              {key:"cohesion",      label:"Cohesion",          icon:"🎨",  desc:"Style consistency",      ...bd.cohesion},
              {key:"completeness",  label:"Completeness",      icon:"✦",   desc:"Occasion coverage",      ...bd.completeness},
            ] : [];
            return(
              <div style={{background:"linear-gradient(135deg,#1A160F,#1E1A12)",borderRadius:R18,padding:"20px",border:"1px solid #2A2418"}}>
                <div style={{..._btwn,marginBottom:16}}>
                  <div>
                    <Lbl mb={4}>Wardrobe Score</Lbl>
                    <div style={ss(9,400,DM,{lineHeight:1.5,maxWidth:200})}>Based on 5 dimensions · updates as your closet grows</div>
                  </div>
                  <div style={{textAlign:"center"}}>
                    <div style={{...sr(48,300,scoreColor),lineHeight:1}}>{total}</div>
                    <div style={ss(10,400,DM)}>/100</div>
                  </div>
                </div>
                <div style={{height:8,background:"#1A1A1A",borderRadius:4,overflow:"hidden",marginBottom:20}}>
                  <div style={{height:"100%",width:`${total}%`,background:`linear-gradient(90deg,${scoreColor},${G})`,borderRadius:4,transition:"width 0.8s ease"}}/>
                </div>
                {dims.map((d,i)=>(
                  <div key={d.key} style={{marginBottom:i<dims.length-1?14:0,paddingBottom:i<dims.length-1?14:0,borderBottom:i<dims.length-1?`1px solid #2A2418`:"none"}}>
                    <div style={{..._btwn,marginBottom:5}}>
                      <div style={{..._row,gap:8}}>
                        <span style={{fontSize:14}}>{d.icon}</span>
                        <div>
                          <div style={ss(10,600,MD,{letterSpacing:0.5})}>{d.label}</div>
                          <div style={ss(8,400,DM,{letterSpacing:0.5})}>{d.desc}</div>
                        </div>
                      </div>
                      <div style={{...sr(16,500,MD),minWidth:32,textAlign:"right"}}>{d.score}<span style={ss(9,400,DM)}>/20</span></div>
                    </div>
                    <div style={{height:3,background:"#1A1A1A",borderRadius:2,overflow:"hidden",marginBottom:5}}>
                      <div style={{height:"100%",width:`${(d.score/20)*100}%`,background:d.score>=16?"#80C880":d.score>=12?G:"#C4A060",borderRadius:2,transition:"width 0.8s ease"}}/>
                    </div>
                    <div style={ss(9,400,DM,{lineHeight:1.5,fontStyle:"italic"})}>{d.note}</div>
                  </div>
                ))}
                {!bd&&(
                  <div style={{textAlign:"center",padding:"8px 0"}}>
                    <button onClick={loadGaps} style={{padding:"8px 20px",borderRadius:R18,background:`${G}22`,border:`1px solid ${G}44`,...ss(9,600,G,{letterSpacing:1}),cursor:_p}}>CALCULATE MY SCORE</button>
                  </div>
                )}
              </div>
            );
          })()}
        </React.Fragment>
      )}

      {view==="gaps" && (
        <React.Fragment>
          {gapsLoading && (
            <AILoader label="Finding your gaps" size="lg"/>
          )}
          {!gapsLoading && (
            <React.Fragment>

              {/* ── GAPS ── */}
              <div style={ss(8,600,DM,{letterSpacing:1.5,marginBottom:10})}>KEY GAPS TO ADDRESS</div>
              {gaps.map((g,i)=>(
                <div key={i} style={{background:CD,borderRadius:R18,padding:"16px 18px",marginBottom:12,border:`1px solid ${BR}`}}>
                  <div style={{display:"flex",gap:12,marginBottom:10}}>
                    <div style={{width:40,height:40,borderRadius:12,background:`${G}18`,border:`1px solid ${G}33`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0}}>{g.emoji}</div>
                    <div style={{flex:1}}>
                      <div style={sr(15,500,undefined,{marginBottom:3})}>{g.gap}</div>
                      <div style={ss(10,400,DM,{lineHeight:1.5})}>{g.suggestion}</div>
                    </div>
                  </div>
                  <div style={{..._btwn}}>
                    <div style={sr(13,400,G)}>{g.price}</div>
                    <button className="pb" onClick={()=>{
                      if(!wishlist.find(w=>w.gap===g.gap)){
                        const newItem={id:Date.now(),emoji:g.emoji,name:g.gap,brand:"TBD",price:parseInt(g.price.replace(/\D.*$/,"")),gap:g.gap,inMarket:false};
                        if(addToWishlist) addToWishlist(newItem);
                        else setWishlist(prev=>[...prev,newItem]);
                      }
                      showToast("Added to wishlist \u2746");
                    }} style={{padding:"6px 14px",borderRadius:R18,background:_1a,border:_2a,...ss(9,400,MD,{letterSpacing:1}),cursor:_p}}>+ WISHLIST</button>
                  </div>
                </div>
              ))}
              <Btn onClick={loadGaps} full>{gapsLoading?"ANALYSING…":"ANALYSE MY WARDROBE"}</Btn>
            </React.Fragment>
          )}
        </React.Fragment>
      )}

    </div>
  );
}

// ── THE MIRROR ────────────────────────────────────────────────────────────────
// Per-category clothing layer SVG definitions, drawn over the base figure
const clothingLayers = {
  "👚": { label:"Top",      layer:"top",    draw:(c)=>`<path d="M148 172 C140 185,136 220,138 260 L242 260 C244 220,240 185,232 172 C220 164,206 160,190 160 C174 160,160 164,148 172Z" fill="${c}"/><path d="M148 172 C136 165,118 162,108 168 C102 180,100 210,104 240 L130 238 C130 210,134 185,140 174Z" fill="${c}"/><path d="M232 172 C244 165,262 162,272 168 C278 180,280 210,276 240 L250 238 C250 210,246 185,240 174Z" fill="${c}"/>` },
  "🧶": { label:"Knit",     layer:"top",    draw:(c)=>`<path d="M144 172 C136 185,132 225,134 265 L246 265 C248 225,244 185,236 172 C224 163,208 158,190 158 C172 158,156 163,144 172Z" fill="${c}"/><path d="M144 172 C130 163,112 160,104 168 C98 182,97 215,101 245 L128 242 C128 212,132 185,140 175Z" fill="${c}"/><path d="M236 172 C250 163,268 160,276 168 C282 182,283 215,279 245 L252 242 C252 212,248 185,240 175Z" fill="${c}"/><line x1="134" y1="185" x2="246" y2="185" stroke="${c}66" stroke-width="1" stroke-dasharray="4,4"/><line x1="134" y1="200" x2="246" y2="200" stroke="${c}66" stroke-width="1" stroke-dasharray="4,4"/><line x1="134" y1="215" x2="246" y2="215" stroke="${c}66" stroke-width="1" stroke-dasharray="4,4"/><line x1="134" y1="230" x2="246" y2="230" stroke="${c}66" stroke-width="1" stroke-dasharray="4,4"/><line x1="134" y1="248" x2="246" y2="248" stroke="${c}66" stroke-width="1" stroke-dasharray="4,4"/>` },
  "🥼": { label:"Blazer",   layer:"top",    draw:(c)=>`<path d="M118 165 C110 180,106 225,110 275 L155 268 C152 225,152 185,155 170 C140 164,128 163,118 165Z" fill="${c}"/><path d="M262 165 C270 180,274 225,270 275 L225 268 C228 225,228 185,225 170 C240 164,252 163,262 165Z" fill="${c}"/><path d="M155 170 L225 170 L228 268 L152 268Z" fill="${c}DD"/><path d="M155 170 C162 178,170 190,176 208 C180 192,185 178,190 170Z" fill="${c}AA"/><path d="M225 170 C218 178,210 190,204 208 C200 192,195 178,190 170Z" fill="${c}AA"/><rect x="126" y="228" width="18" height="3" rx="1" fill="${c}77"/><circle cx="190" cy="188" r="3" fill="${c}55"/><circle cx="190" cy="210" r="3" fill="${c}55"/>` },
  "🧥": { label:"Coat",     layer:"coat",   draw:(c)=>`<path d="M108 162 C100 178,96 230,100 285 L148 278 C145 230,146 182,150 166 C135 160,120 160,108 162Z" fill="${c}"/><path d="M272 162 C280 178,284 230,280 285 L232 278 C235 230,234 182,230 166 C245 160,260 160,272 162Z" fill="${c}"/><path d="M150 166 L230 166 L232 278 L148 278Z" fill="${c}EE"/><path d="M150 166 C157 175,165 188,172 208 C176 190,182 174,190 166Z" fill="${c}CC"/><path d="M230 166 C223 175,215 188,208 208 C204 190,198 174,190 166Z" fill="${c}CC"/><rect x="118" y="225" width="22" height="4" rx="2" fill="${c}66"/><rect x="240" y="225" width="22" height="4" rx="2" fill="${c}66"/>` },
  "👖": { label:"Trousers", layer:"bottom", draw:(c)=>`<path d="M148 256 L140 425 L166 425 L178 284 L202 284 L214 425 L240 425 L232 256Z" fill="${c}"/><rect x="144" y="250" width="92" height="10" rx="2" fill="${c}BB"/><line x1="178" y1="268" x2="174" y2="425" stroke="${c}77" stroke-width="0.8" opacity="0.5"/><line x1="202" y1="268" x2="206" y2="425" stroke="${c}77" stroke-width="0.8" opacity="0.5"/>` },
  "🩱": { label:"Skirt",    layer:"bottom", draw:(c)=>`<path d="M150 256 C145 285,142 330,148 395 L170 395 L190 325 L210 395 L232 395 C238 330,235 285,230 256Z" fill="${c}"/><line x1="150" y1="275" x2="230" y2="275" stroke="${c}77" stroke-width="0.6" stroke-dasharray="5,5"/>` },
  "👗": { label:"Dress",    layer:"dress",  draw:(c)=>`<path d="M152 162 C146 178,142 230,140 285 C144 330,150 375,148 425 L174 425 L190 345 L206 425 L232 425 C230 375,236 330,240 285 C238 230,234 178,228 162 C218 155,206 150,190 150 C174 150,162 155,152 162Z" fill="${c}"/><path d="M152 162 C138 153,120 150,110 156 C104 170,103 208,107 242 L132 238 C132 208,136 176,142 164Z" fill="${c}"/><path d="M228 162 C242 153,260 150,270 156 C276 170,277 208,273 242 L248 238 C248 208,244 176,238 164Z" fill="${c}"/><line x1="140" y1="195" x2="240" y2="195" stroke="${c}44" stroke-width="0.6" stroke-dasharray="8,10"/><line x1="140" y1="230" x2="240" y2="230" stroke="${c}44" stroke-width="0.6" stroke-dasharray="8,10"/><line x1="140" y1="270" x2="240" y2="270" stroke="${c}44" stroke-width="0.6" stroke-dasharray="8,10"/>` },
  "👟": { label:"Sneakers", layer:"shoes",  draw:(c)=>`<path d="M136 415 C122 417,110 421,108 428 L164 428 L166 415Z" fill="${c}"/><path d="M214 415 C228 417,240 421,242 428 L188 428 L186 415Z" fill="${c}"/><path d="M108 428 L164 428" stroke="${c}AA" stroke-width="3" stroke-linecap="round"/><path d="M188 428 L242 428" stroke="${c}AA" stroke-width="3" stroke-linecap="round"/><line x1="128" y1="421" x2="157" y2="421" stroke="${c}66" stroke-width="1"/><line x1="222" y1="421" x2="238" y2="421" stroke="${c}66" stroke-width="1"/>` },
  "👠": { label:"Heels",    layer:"shoes",  draw:(c)=>`<path d="M148 415 L174 415 L172 425 L146 425Z" fill="${c}"/><line x1="161" y1="415" x2="159" y2="382" stroke="${c}" stroke-width="5" stroke-linecap="round"/><rect x="144" y="422" width="5" height="13" rx="1" fill="${c}AA"/><path d="M208 415 L234 415 L236 425 L210 425Z" fill="${c}"/><line x1="221" y1="415" x2="223" y2="382" stroke="${c}" stroke-width="5" stroke-linecap="round"/><rect x="231" y="422" width="5" height="13" rx="1" fill="${c}AA"/>` },
  "👡": { label:"Sandals",  layer:"shoes",  draw:(c)=>`<line x1="150" y1="422" x2="170" y2="422" stroke="${c}" stroke-width="2" stroke-linecap="round"/><line x1="152" y1="416" x2="168" y2="416" stroke="${c}" stroke-width="1.5" stroke-linecap="round"/><line x1="161" y1="414" x2="161" y2="425" stroke="${c}" stroke-width="1.5"/><line x1="210" y1="422" x2="230" y2="422" stroke="${c}" stroke-width="2" stroke-linecap="round"/><line x1="212" y1="416" x2="228" y2="416" stroke="${c}" stroke-width="1.5" stroke-linecap="round"/><line x1="220" y1="414" x2="220" y2="425" stroke="${c}" stroke-width="1.5"/>` },
  "👢": { label:"Boots",    layer:"shoes",  draw:(c)=>`<path d="M145 355 C146 385,147 410,148 425 L170 425 L172 345" fill="none" stroke="${c}" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/><path d="M134 420 C128 423,118 427,116 433 L170 433 L172 420Z" fill="${c}"/><path d="M215 355 C214 385,213 410,212 425 L234 425 L232 345" fill="none" stroke="${c}" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/><path d="M226 420 C232 423,242 427,244 433 L190 433 L188 420Z" fill="${c}"/>` },
  "💛": { label:"Jewelry",layer:"acc",    draw:(c)=>`<path d="M175 150 C179 160,184 166,190 169 C196 166,201 160,205 150" stroke="${c}" stroke-width="1.5" fill="none" stroke-linecap="round"/><circle cx="190" cy="169" r="3" fill="${c}"/><circle cx="163" cy="98" r="4" fill="none" stroke="${c}" stroke-width="1.5"/><circle cx="217" cy="98" r="4" fill="none" stroke="${c}" stroke-width="1.5"/>` },
  "🧣": { label:"Scarf",    layer:"acc",    draw:(c)=>`<path d="M162 155 C168 172,178 190,182 222 C185 205,188 183,190 173 C192 183,195 205,198 222 C202 190,212 172,218 155 C208 163,200 167,190 167 C180 167,172 163,162 155Z" fill="${c}" opacity="0.92"/>` },
  "👜": { label:"Bag",      layer:"acc",    draw:(c)=>`<rect x="264" y="275" width="52" height="44" rx="5" fill="${c}"/><rect x="276" y="266" width="5" height="11" rx="1" fill="${c}CC"/><rect x="301" y="266" width="5" height="11" rx="1" fill="${c}CC"/><path d="M276 268 Q290 260,306 268" stroke="${c}CC" stroke-width="1.5" fill="none"/><rect x="272" y="288" width="36" height="22" rx="3" fill="${c}BB"/>` },
  "💼": { label:"Tote",     layer:"acc",    draw:(c)=>`<rect x="260" y="278" width="56" height="46" rx="6" fill="${c}"/><rect x="274" y="270" width="28" height="10" rx="3" fill="none" stroke="${c}BB" stroke-width="1.5"/><line x1="260" y1="294" x2="316" y2="294" stroke="${c}99" stroke-width="1"/><rect x="283" y="288" width="14" height="12" rx="2" fill="${c}BB"/>` },
};
const getLayer=(emoji)=>clothingLayers[emoji]||{label:"Item",layer:"acc",draw:(c)=>`<text x="290" y="295" text-anchor="middle" font-size="36">${emoji}</text>`};
const layerOrder=["dress","coat","top","bottom","shoes","acc"];



// Derive climate tag from AI daily data
function deriveClimate(daily){
  if(!daily?.length) return "Warm & Sunny";
  const avg=daily.reduce((s,d)=>s+d.tempMax,0)/daily.length;
  const rainy=daily.filter(d=>["Rain","Heavy Rain","Showers","Drizzle","Thunderstorm"].includes(d.condition)).length;
  const snowy=daily.filter(d=>["Snow","Light Snow","Blizzard"].includes(d.condition)).length;
  if(snowy>daily.length*0.3) return "Cold & Snowy";
  if(avg>86) return "Tropical & Humid";
  if(avg>72 && rainy<daily.length*0.3) return "Warm & Sunny";
  if(avg>57 && rainy<daily.length*0.4) return "Mediterranean";
  if(rainy>daily.length*0.4) return "Rainy & Cool";
  return "Mediterranean";
}

// Parse "Mar 18, 2026" or "Mar 18" → "2026-03-18"
function parseTripDate(str, fallbackYear=2026){
  const months={Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12};
  const m=String(str).match(/([A-Za-z]+)\s+(\d+)(?:\s*,?\s*(\d{4}))?/);
  if(!m) return null;
  const mo=months[m[1]]; if(!mo) return null;
  const yr=m[3]?parseInt(m[3]):fallbackYear;
  return `${yr}-${String(mo).padStart(2,"0")}-${String(m[2]).padStart(2,"0")}`;
}

// Weather: if trip is within 14 days, fetch day-by-day AI forecast
// If more than 14 days out, ask AI for a seasonal climate summary instead
async function fetchTripWeather(destination, startDate, endDate){
  const today = new Date();
  const start = new Date(startDate);
  const daysUntilTrip = Math.round((start - today) / (1000*60*60*24));
  const isFar = daysUntilTrip > 14;

  let prompt, systemPrompt;
  if(isFar){
    prompt = `What is the typical weather in ${destination} around ${startDate}? Give a seasonal climate summary and a representative daily forecast spread across the trip days from ${startDate} to ${endDate}. Use Fahrenheit. Respond ONLY with JSON:
{"city":"${destination.split(",")[0].trim()}","seasonal":true,"summary":"2 sentence description of typical weather e.g. warm and humid with occasional afternoon showers","days":[{"date":"YYYY-MM-DD","condition":"Partly Cloudy","tempMax":78,"tempMin":65},...]}`;
    systemPrompt = "You are a climate expert. Always respond with valid JSON only, no markdown.";
  } else {
    prompt = `Give a day-by-day weather forecast for ${destination} from ${startDate} to ${endDate}. Use your knowledge of typical seasonal climate. Use Fahrenheit. Respond ONLY with JSON:
{"city":"${destination.split(",")[0].trim()}","seasonal":false,"days":[{"date":"YYYY-MM-DD","condition":"Partly Cloudy","tempMax":72,"tempMin":57},...]}`;
    systemPrompt = "You are a weather assistant. Always respond with valid JSON only, no markdown.";
  }

  const raw = await callClaude(prompt, systemPrompt);
  const clean = raw.replace(/```json|```/g,"").trim();
  let parsed;
  try { parsed = JSON.parse(clean); }
  catch(e) { throw new Error("Invalid response format"); }
  const daily = (parsed.days||[]).map(d=>({
    date: d.date,
    condition: d.condition||"Partly Cloudy",
    tempMax: d.tempMax||68,
    tempMin: d.tempMin||52,
  }));
  return {
    daily,
    city: parsed.city||destination.split(",")[0],
    climate: deriveClimate(daily),
    seasonal: parsed.seasonal||false,
    summary: parsed.summary||null,
  };
}

function VacationPlanner({items,outfits,showToast,onBack,session}){
  const [trips,setTrips]           = useState([]);
  const [trip,setTrip]             = useState(null);      // active trip
  const [tripsLoading,setTripsLoading] = useState(true);
  const [activeTab,setActiveTab]   = useState('items');   // items | outfits | musthaves
  const [packed,setPacked]         = useState({});
  const [mustHaves,setMustHaves]   = useState([]);        // item IDs
  const [mustSearch,setMustSearch] = useState('');
  const [showMustPicker,setShowMustPicker] = useState(false);
  const [weather,setWeather]       = useState(null);
  const [wxLoading,setWxLoading]   = useState(false);
  const [selectedDay,setSelectedDay] = useState(0);
  const [showOutfitPicker,setShowOutfitPicker] = useState(null); // {dayIdx, slot: 'day'|'evening'}
  const [outfitSearch,setOutfitSearch] = useState('');
  const [aiSuggestions,setAiSuggestions] = useState([]);
  const [aiLoading,setAiLoading]   = useState(false);

  // ── SETUP FORM state (only shown on empty / new) ──
  const [dest,setDest]             = useState('');
  const [startDate,setStartDate]   = useState('');
  const [endDate,setEndDate]       = useState('');
  const [climate,setClimate]       = useState('Warm & Sunny');
  const [formWx,setFormWx]         = useState(null);
  const [formWxLoading,setFormWxLoading] = useState(false);
  const climateOpts=['Warm & Sunny','Cold & Snowy','Tropical & Humid','Mediterranean','Rainy & Mild'];

  // ── Load trips from Supabase ──
  useEffect(()=>{
    if(!session?.access_token){ setTripsLoading(false); return; }
    (async()=>{
      try{
        const userId=session.user?.id;
        if(!userId){ setTripsLoading(false); return; }
        const res=await fetch(`${SB_URL}/rest/v1/trips?user_id=eq.${userId}&order=created_at.desc`,{
          headers:{"Authorization":`Bearer ${session.access_token}`,"apikey":SB_KEY}
        });
        if(!res.ok){ setTripsLoading(false); return; }
        const data=await res.json();
        if(Array.isArray(data)&&data.length>0){
          const mapped=data.map(r=>({
            id:r.id,destination:r.destination,
            startDate:r.start_date,endDate:r.end_date,climate:r.climate||'Warm & Sunny',
            days_plan:r.days_plan||[],mustHaves:r.must_haves||[],packed:r.packed||{},
          }));
          setTrips(mapped);
          setTrip(mapped[0]);
          setPacked(mapped[0].packed||{});
          setMustHaves(mapped[0].mustHaves||[]);
        }
      }catch(e){ console.error('trips load error:',e); }
      setTripsLoading(false);
    })();
  },[session]);

  // ── Auto-fetch weather when trip set ──
  useEffect(()=>{
    if(!trip?.destination) return;
    setWxLoading(true); setWeather(null);
    const s=parseTripDate(trip.startDate), e=parseTripDate(trip.endDate);
    if(!s){ setWxLoading(false); return; }
    fetchTripWeather(trip.destination,s,e||s)
      .then(d=>setWeather(d))
      .catch(()=>setWeather({city:trip.destination,climate:trip.climate,daily:[]}))
      .finally(()=>setWxLoading(false));
  },[trip?.id]);

  // ── Save trip to Supabase ──
  const saveToDB=async(t)=>{
    if(!session?.access_token) return t;
    const userId=session.user?.id;
    const body={user_id:userId,destination:t.destination,start_date:t.startDate,
      end_date:t.endDate,climate:t.climate,days_plan:t.days_plan,
      must_haves:t.mustHaves||[],packed:t.packed||{}};
    try{
      if(t.id&&typeof t.id==='string'&&t.id.length>10){
        await fetch(`${SB_URL}/rest/v1/trips?id=eq.${t.id}`,{
          method:'PATCH',headers:{'Content-Type':'application/json',
          'Authorization':`Bearer ${session.access_token}`,'apikey':SB_KEY,'Prefer':'return=minimal'},
          body:JSON.stringify(body)});
        return t;
      } else {
        const res=await fetch(`${SB_URL}/rest/v1/trips`,{
          method:'POST',headers:{'Content-Type':'application/json',
          'Authorization':`Bearer ${session.access_token}`,'apikey':SB_KEY,'Prefer':'return=representation'},
          body:JSON.stringify(body)});
        const rows=await res.json();
        return rows?.[0]?{...t,id:rows[0].id}:t;
      }
    }catch(e){ return t; }
  };

  const updateTrip=(patch)=>{
    const updated={...trip,...patch};
    setTrip(updated);
    setTrips(prev=>prev.map(t=>t.id===updated.id?updated:t));
    saveToDB(updated);
  };

  // ── Build day skeleton from dates ──
  const buildDays=(start,end)=>{
    const s=parseTripDate(start), e=parseTripDate(end);
    if(!s) return [];
    const sD=new Date(s), eD=e?new Date(e):new Date(s);
    const n=Math.max(1,Math.round((eD-sD)/(1000*60*60*24))+1);
    return Array.from({length:n},(_,i)=>{
      const d=new Date(sD); d.setDate(d.getDate()+i);
      const label=d.toLocaleDateString('en-US',{month:'short',day:'numeric'});
      return{day:i+1,date:label,dayOutfitIds:[],eveningOutfitIds:[]};
    });
  };

  // ── Create trip ──
  const createTrip=async()=>{
    if(!dest.trim()||!startDate) return;
    const newT={id:null,destination:dest.trim(),startDate,endDate,
      climate:formWx?.climate||climate,days_plan:buildDays(startDate,endDate),
      mustHaves:[],packed:{}};
    showToast('Creating your trip… ✦');
    const saved=await saveToDB(newT);
    setTrips(prev=>[saved,...prev]);
    setTrip(saved);
    setPacked({});
    setMustHaves([]);
    setFormWx(null);
  };

  // ── AI packing suggestion ──
  const runAiSuggestions=async()=>{
    if(!trip) return;
    setAiLoading(true); setAiSuggestions([]);
    try{
      const itemList=items.slice(0,40).map(i=>`${i.name} (${i.category})`).join(', ');
      const raw=await callClaude(`Trip: ${trip.destination}, ${trip.startDate}–${trip.endDate}, climate: ${trip.climate}.\nCloset items: ${itemList}.\nReturn ONLY JSON array of item names to bring (max 10): ["item1","item2",...]`);
      const arr=JSON.parse(raw.replace(/```json|```/g,'').trim());
      const suggested=items.filter(i=>arr.some(n=>i.name.toLowerCase().includes(n.toLowerCase().slice(0,8))));
      setAiSuggestions(suggested.map(i=>i.id));
    }catch(e){}
    setAiLoading(false);
  };

  const togglePacked=(id)=>{
    const next={...packed,[id]:!packed[id]};
    setPacked(next);
    updateTrip({packed:next});
  };

  const toggleMustHave=(id)=>{
    const next=mustHaves.includes(id)?mustHaves.filter(m=>m!==id):[...mustHaves,id];
    setMustHaves(next);
    updateTrip({mustHaves:next});
  };

  const assignOutfit=(dayIdx,slot,outfitId)=>{
    const days=[...(trip.days_plan||[])];
    const key=slot==='day'?'dayOutfitIds':'eveningOutfitIds';
    const cur=days[dayIdx]?.[key]||[];
    days[dayIdx]={...days[dayIdx],[key]:cur.includes(outfitId)?cur.filter(id=>id!==outfitId):[...cur,outfitId]};
    updateTrip({days_plan:days});
    setShowOutfitPicker(null);
  };

  const removeOutfit=(dayIdx,slot,outfitId)=>{
    const days=[...(trip.days_plan||[])];
    const key=slot==='day'?'dayOutfitIds':'eveningOutfitIds';
    days[dayIdx]={...days[dayIdx],[key]:(days[dayIdx]?.[key]||[]).filter(id=>id!==outfitId)};
    updateTrip({days_plan:days});
  };

  const wxIcon=(cond)=>({Sunny:'☀️',Clear:'☀️','Partly Cloudy':'⛅',Cloudy:'☁️',Rainy:'🌧',Snowy:'❄️',Stormy:'⛈'}[cond]||'🌤');

  const packedCount=Object.values(packed).filter(Boolean).length;
  const climateEmoji=(c='')=>c.includes('Warm')||c.includes('Hot')?'☀️':c.includes('Cold')||c.includes('Snow')?'❄️':c.includes('Tropical')?'🌴':c.includes('Rain')?'🌧':'🌤';

  // ── LOADING ──
  if(tripsLoading) return(
    <div className="fu" style={{display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:12}}>
      <div style={{fontSize:28,animation:'spin 1.2s linear infinite'}}>✦</div>
      <div style={ss(10,400,DM,{letterSpacing:1})}>Loading your trips…</div>
    </div>
  );

  // ── EMPTY / SETUP FORM ──
  if(!trip) return(
    <div className="fu" style={{padding:'16px 20px'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:20}}>
        <div style={sr(20,300)}>Pack & Plan</div>
        <button onClick={onBack} style={{background:'none',border:'none',color:DM,fontSize:16,cursor:_p}}>✕</button>
      </div>

      {/* Saved trips list */}
      {trips.length>0&&(
        <div style={{marginBottom:16}}>
          <div style={ss(8,600,DM,{letterSpacing:1.5,marginBottom:8})}>YOUR TRIPS</div>
          {trips.map(t=>(
            <div key={t.id} onClick={()=>{setTrip(t);setPacked(t.packed||{});setMustHaves(t.mustHaves||[]);}}
              style={{background:CD,borderRadius:12,border:BR,padding:'10px 14px',marginBottom:6,display:'flex',alignItems:'center',gap:10,cursor:_p}}>
              <span style={{fontSize:18}}>✈️</span>
              <div style={{flex:1}}>
                <div style={ss(11,500,MD)}>{t.destination}</div>
                <div style={ss(8,400,DM,{marginTop:1})}>{t.startDate} – {t.endDate}</div>
              </div>
              <span style={ss(9,400,G)}>{climateEmoji(t.climate)}</span>
              <div style={ss(12,400,DM)}>›</div>
            </div>
          ))}
          <div style={ss(8,400,DM,{textAlign:'center',padding:'8px 0',letterSpacing:0.5})}>– or plan a new trip –</div>
        </div>
      )}

      {/* Empty hero */}
      {trips.length===0&&(
        <div style={{textAlign:'center',padding:'20px 0 24px'}}>
          <div style={{fontSize:48,marginBottom:12}}>✈️</div>
          <div style={sr(22,300,undefined,{marginBottom:6})}>Where to next?</div>
          <div style={ss(10,400,DM,{lineHeight:1.6,marginBottom:20})}>Pack from your actual closet — AI suggests what to bring</div>
        </div>
      )}

      {/* Form */}
      <div style={{display:'flex',flexDirection:'column',gap:10}}>
        <input value={dest} onChange={e=>setDest(e.target.value)} placeholder="Destination…"
          style={{width:'100%',boxSizing:'border-box',background:_1a,border:_2a,borderRadius:12,padding:'11px 14px',...ss(12,400,MD),color:'#C0B8B0',outline:'none'}}/>
        <div style={{display:'flex',gap:8}}>
          <input type="date" value={startDate} onChange={e=>setStartDate(e.target.value)}
            style={{flex:1,background:_1a,border:_2a,borderRadius:12,padding:'10px 12px',...ss(11,400,MD),color:MD,outline:'none'}}/>
          <input type="date" value={endDate} onChange={e=>setEndDate(e.target.value)}
            style={{flex:1,background:_1a,border:_2a,borderRadius:12,padding:'10px 12px',...ss(11,400,MD),color:MD,outline:'none'}}/>
        </div>

        {/* Weather fetch */}
        {dest&&startDate&&(
          <button onClick={async()=>{
            setFormWxLoading(true);setFormWx(null);
            const s=parseTripDate(startDate),e=parseTripDate(endDate);
            try{const d=await fetchTripWeather(dest,s||startDate,e||endDate);setFormWx(d);}
            catch(err){showToast('Could not fetch weather — pick climate manually');}
            finally{setFormWxLoading(false);}
          }} style={{background:formWxLoading?_1a:`${G}22`,border:formWxLoading?_2a:`1px solid ${G}44`,borderRadius:10,padding:'8px 14px',...ss(9,600,formWxLoading?DM:G,{letterSpacing:1}),cursor:_p}}>
            {formWxLoading?'✦ DETECTING WEATHER…':'✦ DETECT WEATHER'}
          </button>
        )}

        {formWx&&(
          <div style={{background:'#0D1620',border:'1px solid #2A3A5A',borderRadius:12,padding:'10px 12px'}}>
            <div style={{display:'flex',gap:6,overflowX:'auto',paddingBottom:2}}>
              {(formWx.daily||[]).slice(0,7).map((d,i)=>(
                <div key={i} style={{flexShrink:0,textAlign:'center',background:'#111',borderRadius:8,padding:'5px 7px',minWidth:36}}>
                  <div style={{fontSize:14}}>{wxIcon(d.condition)}</div>
                  <div style={ss(8,600,'#A0C0E0')}>{d.tempMax}°</div>
                </div>
              ))}
              {formWx.seasonal&&<div style={{...ss(9,400,'#6A90B8'),padding:'4px 8px',alignSelf:'center'}}>{formWx.summary}</div>}
            </div>
            <div style={ss(8,500,G,{marginTop:6})}>Climate: {formWx.climate||climate}</div>
          </div>
        )}

        {/* Climate manual override */}
        <div>
          <div style={ss(8,600,DM,{letterSpacing:1.5,marginBottom:5})}>CLIMATE</div>
          <div style={{display:'flex',gap:5,flexWrap:'wrap'}}>
            {climateOpts.map(c=>(
              <button key={c} onClick={()=>setClimate(c)} style={{padding:'5px 10px',borderRadius:R18,cursor:_p,
                background:c===(formWx?.climate||climate)?`${G}18`:_1a,
                border:c===(formWx?.climate||climate)?`1px solid ${G}44`:_2a,
                ...ss(8,c===(formWx?.climate||climate)?600:400,c===(formWx?.climate||climate)?G:DM)}}>
                {c}
              </button>
            ))}
          </div>
        </div>

        <button onClick={createTrip} disabled={!dest.trim()||!startDate}
          style={{padding:'13px',borderRadius:12,background:dest.trim()&&startDate?`linear-gradient(135deg,${G},#8A6E54)`:_1a,
          border:'none',...ss(10,700,dest.trim()&&startDate?BK:DM,{letterSpacing:1.5}),cursor:dest.trim()&&startDate?_p:'default',marginTop:4}}>
          START PACKING ✦
        </button>
      </div>
    </div>
  );

  // ── ACTIVE TRIP VIEW ──
  const days=trip.days_plan||[];
  const selDay=days[selectedDay]||{};
  const filteredItems=activeTab==='musthaves'
    ?items.filter(i=>mustHaves.includes(i.id))
    :items;
  const displayItems=activeTab==='musthaves'?filteredItems
    :aiSuggestions.length>0?items.filter(i=>aiSuggestions.includes(i.id)||packed[i.id])
    :items;

  return(
    <div className="fu" style={{display:'flex',flexDirection:'column',padding:0}}>

      {/* Trip header */}
      <div style={{padding:'12px 16px 8px',borderBottom:`1px solid ${BR}`,flexShrink:0}}>
        <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between'}}>
          <div>
            <div style={{display:'flex',alignItems:'center',gap:6}}>
              <div style={sr(20,300)}>{trip.destination}</div>
              <span style={{fontSize:16}}>✈️</span>
            </div>
            <div style={ss(8,400,DM,{letterSpacing:1,marginTop:1})}>
              {trip.startDate} – {trip.endDate}
              {weather&&<span style={{marginLeft:6}}>{climateEmoji(trip.climate)} {wxLoading?'…':weather.daily?.[0]?`${weather.daily[0].tempMax||'--'}°`:'--'}</span>}
            </div>
          </div>
          <div style={{display:'flex',gap:8,alignItems:'center'}}>
            <div style={{textAlign:'right'}}>
              <div style={ss(12,500,G)}>{packedCount}</div>
              <div style={ss(7,400,DM,{letterSpacing:1})}>PACKED</div>
            </div>
            <button onClick={()=>{setTrip(null);}} style={{width:26,height:26,borderRadius:'50%',background:_1a,border:_2a,color:DM,fontSize:14,display:'flex',alignItems:'center',justifyContent:'center',cursor:_p}}>×</button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{display:'flex',gap:0,background:'#0A0A0A',borderBottom:`1px solid ${BR}`,flexShrink:0}}>
        {[['items','Items'],['outfits','Outfits by Day'],['musthaves','Must-Haves']].map(([k,l])=>(
          <button key={k} onClick={()=>setActiveTab(k)} style={{flex:1,padding:'8px 4px',background:'none',border:'none',borderBottom:`2px solid ${activeTab===k?G:'transparent'}`,cursor:_p,...ss(8,activeTab===k?600:400,activeTab===k?G:DM,{letterSpacing:0.5})}}>
            {l}
          </button>
        ))}
      </div>

      {/* ── ITEMS TAB ── */}
      {activeTab==='items'&&(
        <React.Fragment>
          {/* AI suggestion strip */}
          <div onClick={()=>aiSuggestions.length?setAiSuggestions([]):runAiSuggestions()}
            style={{margin:'8px 14px 0',background:`linear-gradient(135deg,#1A1408,#201A08)`,border:`1px solid ${G}33`,borderRadius:12,padding:'9px 12px',display:'flex',alignItems:'center',gap:8,cursor:_p}}>
            <span style={{fontSize:14,animation:aiLoading?'spin 1.2s linear infinite':'none',display:'inline-block'}}>✦</span>
            <div style={{flex:1}}>
              <div style={ss(9,600,G,{letterSpacing:0.5})}>{aiLoading?'Finding best items for your trip…':aiSuggestions.length?`Showing ${aiSuggestions.length} AI suggestions`:'AI pack suggestion'}</div>
              <div style={ss(8,400,DM)}>{aiLoading?'One moment…':aiSuggestions.length?'Tap to show all closet items':'Tap to suggest items for '+trip.climate}</div>
            </div>
            <div style={ss(12,400,DM)}>›</div>
          </div>

          <div style={{flex:1,overflowY:'auto',padding:'8px 14px'}}>
            {displayItems.map(item=>(
              <div key={item.id} onClick={()=>togglePacked(item.id)}
                style={{display:'flex',alignItems:'center',gap:10,padding:'8px 10px',background:packed[item.id]?`${G}0A`:_1a,border:packed[item.id]?`1px solid ${G}33`:_2a,borderRadius:12,marginBottom:6,cursor:_p,opacity:aiSuggestions.length&&!aiSuggestions.includes(item.id)&&!packed[item.id]?0.4:1}}>
                <div style={{width:36,height:36,borderRadius:8,background:'#1A1A1A',flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center',overflow:'hidden'}}>
                  {item.sourceImage?<img src={item.sourceImage} style={{width:'100%',height:'100%',objectFit:'cover'}} alt=""/>:<span style={{fontSize:16}}>{item.emoji||'👕'}</span>}
                </div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={ss(11,500,packed[item.id]?G:MD,{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'})}>{item.name}</div>
                  <div style={ss(8,400,DM)}>{item.brand||item.category}</div>
                </div>
                <div style={{width:22,height:22,borderRadius:'50%',flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center',background:packed[item.id]?`${G}22`:'#1A1A1A',border:packed[item.id]?`1.5px solid ${G}`:'1px solid #2A2A2A'}}>
                  {packed[item.id]&&<span style={{fontSize:9,color:G}}>✦</span>}
                </div>
              </div>
            ))}
            {displayItems.length===0&&<div style={{textAlign:'center',padding:'32px 0',...ss(10,400,DM)}}>No items in your closet yet</div>}
          </div>
        </React.Fragment>
      )}

      {/* ── OUTFITS BY DAY TAB ── */}
      {activeTab==='outfits'&&(
        <React.Fragment>
          {/* Outfit picker overlay */}
          {showOutfitPicker&&(
            <div onClick={()=>setShowOutfitPicker(null)} style={{position:'absolute',inset:0,background:'#000000CC',zIndex:20,display:'flex',flexDirection:'column',justifyContent:'flex-end'}}>
              <div onClick={e=>e.stopPropagation()} style={{background:'#0D0D0D',borderRadius:'20px 20px 0 0',border:`1px solid ${G}33`,maxHeight:'70%',display:'flex',flexDirection:'column'}}>
                <div style={{padding:'14px 16px 8px',display:'flex',justifyContent:'space-between',alignItems:'center',flexShrink:0}}>
                  <div style={sr(17,300)}>Pick Outfit — {showOutfitPicker.slot==='day'?'Day':'Evening'}</div>
                  <button onClick={()=>setShowOutfitPicker(null)} style={{background:'none',border:'none',color:DM,fontSize:16,cursor:_p}}>×</button>
                </div>
                <input value={outfitSearch} onChange={e=>setOutfitSearch(e.target.value)} placeholder="Search outfits…"
                  style={{margin:'0 14px 8px',background:_1a,border:_2a,borderRadius:10,padding:'8px 12px',...ss(11,400,MD),color:MD,outline:'none'}}/>
                <div style={{overflowY:'auto',padding:'0 14px 16px'}}>
                  {outfits.filter(o=>!outfitSearch||o.name.toLowerCase().includes(outfitSearch.toLowerCase())).map(o=>{
                    const isAssigned=(selDay.dayOutfitIds||[]).includes(o.id)||(selDay.eveningOutfitIds||[]).includes(o.id);
                    return(
                      <div key={o.id} onClick={()=>assignOutfit(selectedDay,showOutfitPicker.slot,o.id)}
                        style={{display:'flex',alignItems:'center',gap:10,padding:'8px 10px',background:isAssigned?`${G}14`:_1a,border:isAssigned?`1px solid ${G}44`:_2a,borderRadius:12,marginBottom:6,cursor:_p}}>
                        <div style={{display:'flex',gap:3,flexShrink:0}}>
                          {(o.items||[]).slice(0,3).map(id=>{const it=items.find(i=>i.id===id);return it?<span key={id} style={{fontSize:14}}>{it.emoji||'👕'}</span>:null;})}
                        </div>
                        <div style={{flex:1}}>
                          <div style={ss(10,500,isAssigned?G:MD)}>{o.name}</div>
                          <div style={ss(8,400,DM)}>{o.occasion}</div>
                        </div>
                        {isAssigned&&<span style={{fontSize:10,color:G}}>✦</span>}
                      </div>
                    );
                  })}
                  {outfits.length===0&&<div style={{textAlign:'center',padding:'20px 0',...ss(10,400,DM)}}>No saved outfits yet — build some on the Outfits tab first</div>}
                </div>
              </div>
            </div>
          )}

          {/* Day chips */}
          <div style={{display:'flex',gap:5,padding:'8px 14px',overflowX:'auto',flexShrink:0,borderBottom:`1px solid ${BR}`}}>
            {days.map((d,i)=>(
              <button key={i} onClick={()=>setSelectedDay(i)} style={{flexShrink:0,padding:'5px 10px',borderRadius:8,cursor:_p,
                background:i===selectedDay?`${G}18`:_1a,border:i===selectedDay?`1px solid ${G}55`:_2a,
                ...ss(8,i===selectedDay?600:400,i===selectedDay?G:DM,{textAlign:'center',whiteSpace:'nowrap'})}}>
                {d.date}<br/><span style={{fontSize:7,opacity:0.7}}>{d.day===1?'Arrival':d.day===days.length?'Depart':'Day '+d.day}</span>
              </button>
            ))}
          </div>

          <div style={{flex:1,overflowY:'auto',padding:'10px 14px'}}>
            <div style={ss(9,600,DM,{letterSpacing:1,marginBottom:10})}>{selDay.date?.toUpperCase()||'SELECT A DAY'}</div>

            {/* DAY outfits */}
            <div style={ss(8,600,DM,{letterSpacing:1.5,marginBottom:6})}>DAY OUTFIT{(selDay.dayOutfitIds||[]).length>0?` · ${(selDay.dayOutfitIds||[]).length}`:''}</div>
            {(selDay.dayOutfitIds||[]).map(id=>{
              const o=outfits.find(x=>x.id===id); if(!o) return null;
              return(
                <div key={id} style={{background:CD,borderRadius:12,border:BR,padding:'10px 12px',marginBottom:6,display:'flex',alignItems:'center',gap:10}}>
                  <div style={{display:'flex',gap:3}}>{(o.items||[]).slice(0,3).map(iid=>{const it=items.find(i=>i.id===iid);return it?<span key={iid} style={{fontSize:16}}>{it.emoji||'👕'}</span>:null;})}</div>
                  <div style={{flex:1}}>
                    <div style={ss(10,500,MD)}>{o.name}</div>
                    <div style={ss(8,400,DM)}>{o.occasion}</div>
                  </div>
                  <button onClick={()=>removeOutfit(selectedDay,'day',id)} style={{background:'none',border:'none',color:DM,fontSize:14,cursor:_p}}>×</button>
                </div>
              );
            })}
            <button onClick={()=>setShowOutfitPicker({dayIdx:selectedDay,slot:'day'})}
              style={{width:'100%',padding:'9px',borderRadius:10,background:_1a,border:`1px dashed ${G}44`,...ss(8,600,G,{letterSpacing:1}),cursor:_p,marginBottom:14}}>
              + ADD DAY OUTFIT
            </button>

            {/* EVENING outfits */}
            <div style={ss(8,600,DM,{letterSpacing:1.5,marginBottom:6})}>EVENING OUTFIT{(selDay.eveningOutfitIds||[]).length>0?` · ${(selDay.eveningOutfitIds||[]).length}`:''}</div>
            {(selDay.eveningOutfitIds||[]).map(id=>{
              const o=outfits.find(x=>x.id===id); if(!o) return null;
              return(
                <div key={id} style={{background:CD,borderRadius:12,border:BR,padding:'10px 12px',marginBottom:6,display:'flex',alignItems:'center',gap:10}}>
                  <div style={{display:'flex',gap:3}}>{(o.items||[]).slice(0,3).map(iid=>{const it=items.find(i=>i.id===iid);return it?<span key={iid} style={{fontSize:16}}>{it.emoji||'👕'}</span>:null;})}</div>
                  <div style={{flex:1}}>
                    <div style={ss(10,500,MD)}>{o.name}</div>
                    <div style={ss(8,400,DM)}>{o.occasion}</div>
                  </div>
                  <button onClick={()=>removeOutfit(selectedDay,'evening',id)} style={{background:'none',border:'none',color:DM,fontSize:14,cursor:_p}}>×</button>
                </div>
              );
            })}
            <button onClick={()=>setShowOutfitPicker({dayIdx:selectedDay,slot:'evening'})}
              style={{width:'100%',padding:'9px',borderRadius:10,background:_1a,border:`1px dashed ${G}44`,...ss(8,600,G,{letterSpacing:1}),cursor:_p}}>
              + ADD EVENING OUTFIT
            </button>
          </div>
        </React.Fragment>
      )}

      {/* ── MUST-HAVES TAB ── */}
      {activeTab==='musthaves'&&(
        <React.Fragment>
          <div style={{padding:'8px 14px 0',flexShrink:0}}>
            <input value={mustSearch} onChange={e=>setMustSearch(e.target.value)} placeholder="Search your closet to add must-haves…"
              style={{width:'100%',boxSizing:'border-box',background:_1a,border:`1px solid ${G}33`,borderRadius:10,padding:'8px 12px',...ss(11,400,MD),color:MD,outline:'none'}}/>
          </div>
          <div style={{flex:1,overflowY:'auto',padding:'8px 14px'}}>
            {mustHaves.length>0&&(
              <React.Fragment>
                <div style={ss(8,600,DM,{letterSpacing:1.5,marginBottom:6})}>PINNED MUST-HAVES</div>
                {items.filter(i=>mustHaves.includes(i.id)).map(item=>(
                  <div key={item.id} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 10px',background:`${G}0A`,border:`1px solid ${G}33`,borderRadius:12,marginBottom:5}}>
                    <div style={{width:32,height:32,borderRadius:7,background:'#1A1A1A',flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center'}}>
                      {item.sourceImage?<img src={item.sourceImage} style={{width:'100%',height:'100%',objectFit:'cover',borderRadius:7}} alt=""/>:<span style={{fontSize:14}}>{item.emoji||'👕'}</span>}
                    </div>
                    <div style={{flex:1}}>
                      <div style={ss(10,500,G,{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'})}>{item.name}</div>
                      <div style={ss(8,400,DM)}>{item.brand||item.category}</div>
                    </div>
                    <button onClick={()=>toggleMustHave(item.id)} style={{background:'none',border:'none',color:DM,fontSize:14,cursor:_p}}>×</button>
                  </div>
                ))}
                <div style={{height:1,background:BR,margin:'10px 0'}}/>
              </React.Fragment>
            )}
            <div style={ss(8,600,DM,{letterSpacing:1.5,marginBottom:6})}>YOUR CLOSET</div>
            {items.filter(i=>!mustSearch||i.name.toLowerCase().includes(mustSearch.toLowerCase())||( i.brand||'').toLowerCase().includes(mustSearch.toLowerCase())).map(item=>(
              <div key={item.id} onClick={()=>toggleMustHave(item.id)}
                style={{display:'flex',alignItems:'center',gap:10,padding:'7px 10px',background:mustHaves.includes(item.id)?`${G}0A`:_1a,border:mustHaves.includes(item.id)?`1px solid ${G}33`:_2a,borderRadius:10,marginBottom:5,cursor:_p}}>
                <div style={{width:30,height:30,borderRadius:6,background:'#1A1A1A',flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center'}}>
                  {item.sourceImage?<img src={item.sourceImage} style={{width:'100%',height:'100%',objectFit:'cover',borderRadius:6}} alt=""/>:<span style={{fontSize:13}}>{item.emoji||'👕'}</span>}
                </div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={ss(10,400,mustHaves.includes(item.id)?G:MD,{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'})}>{item.name}</div>
                  <div style={ss(8,400,DM)}>{item.brand||item.category}</div>
                </div>
                <div style={{width:20,height:20,borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',background:mustHaves.includes(item.id)?`${G}22`:_1a,border:mustHaves.includes(item.id)?`1.5px solid ${G}`:'1px solid #2A2A2A'}}>
                  {mustHaves.includes(item.id)&&<span style={{fontSize:8,color:G}}>✦</span>}
                </div>
              </div>
            ))}
          </div>
        </React.Fragment>
      )}

    </div>
  );
}


function WornHistoryCalendar({outfits,items,showToast,logWear}){
  const today=new Date();
  const [curMonth,setCurMonth]=useState(new Date(today.getFullYear(),today.getMonth(),1));
  const [selectedDay,setSelectedDay]=useState(null);
  const [detailOutfit,setDetailOutfit]=useState(null);

  // Build a map: "YYYY-MM-DD" → [outfit, ...]
  const wornMap={};
  outfits.forEach(o=>{
    (o.wornHistory||[]).forEach(d=>{
      if(!wornMap[d]) wornMap[d]=[];
      wornMap[d].push(o);
    });
  });

  const year=curMonth.getFullYear();
  const month=curMonth.getMonth();
  const daysInMonth=new Date(year,month+1,0).getDate();
  const firstDow=new Date(year,month,1).getDay(); // 0=Sun
  const monthKey=(y,m,d)=>`${y}-${String(m+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
  const todayKey=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;

  // Stats for this month
  const monthDays=Object.keys(wornMap).filter(k=>k.startsWith(`${year}-${String(month+1).padStart(2,"0")}`));
  const monthTotal=monthDays.length;
  // Streak: count consecutive days ending today
  let streak=0;
  for(let i=0;i<30;i++){
    const d=new Date(today); d.setDate(today.getDate()-i);
    const k=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
    if(wornMap[k]) streak++; else break;
  }
  // Most worn outfit this month
  const outfitCounts={};
  monthDays.forEach(d=>{ wornMap[d].forEach(o=>{ outfitCounts[o.id]=(outfitCounts[o.id]||0)+1; }); });
  const topId=Object.keys(outfitCounts).sort((a,b)=>outfitCounts[b]-outfitCounts[a])[0];
  const topOutfit=outfits.find(o=>o.id===parseInt(topId));

  const occasionColour={"Work":"#7B9E87","Casual":"#8B9DC3","Evening":"#9B7BAE","Weekend":"#C4956A","Party":"#C47B7B","Date":"#B87BA8"};

  const prevMonth=()=>{ const d=new Date(curMonth); d.setMonth(d.getMonth()-1); setCurMonth(d); setSelectedDay(null); };
  const nextMonth=()=>{ const d=new Date(curMonth); d.setMonth(d.getMonth()+1); setCurMonth(d); setSelectedDay(null); };
  const monthName=curMonth.toLocaleString("default",{month:"long",year:"numeric"});

  const dayOutfits=selectedDay?wornMap[selectedDay]||[]:[];

  return(
    <div>
      {/* Stats strip */}
      <div style={{display:"flex",gap:8,marginBottom:16}}>
        {[[streak>0?`🔥 ${streak}`:"—","STREAK"],[monthTotal,"THIS MONTH"],[topOutfit?topOutfit.name.split(" ")[0]+"…":"—","FAV LOOK"]].map(([v,l])=>(
          <div key={l} style={{flex:1,background:_1a,borderRadius:12,padding:"10px 8px",textAlign:"center",border:"1px solid #222"}}>
            <div style={sr(14,500,G)}>{v}</div>
            <div style={ss(8,400,DM,{letterSpacing:1,marginTop:2})}>{l}</div>
          </div>
        ))}
      </div>

      {/* Month nav */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
        <button onClick={prevMonth} style={{width:32,height:32,borderRadius:"50%",background:_1a,border:_2a,color:MD,fontSize:16,cursor:_p,display:"flex",alignItems:"center",justifyContent:"center"}}>‹</button>
        <div style={sr(16,400)}>{monthName}</div>
        <button onClick={nextMonth} style={{width:32,height:32,borderRadius:"50%",background:_1a,border:_2a,color:MD,fontSize:16,cursor:_p,display:"flex",alignItems:"center",justifyContent:"center"}}>›</button>
      </div>

      {/* Day-of-week headers */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:3,marginBottom:3}}>
        {["Su","Mo","Tu","We","Th","Fr","Sa"].map(d=>(
          <div key={d} style={{textAlign:"center",...ss(8,600,"#444",{letterSpacing:0.5,paddingBottom:4})}}>{d}</div>
        ))}
      </div>

      {/* Calendar grid */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:3,marginBottom:16}}>
        {Array.from({length:firstDow}).map((_,i)=>(
          <div key={"e"+i}/>
        ))}
        {Array.from({length:daysInMonth}).map((_,i)=>{
          const d=i+1;
          const key=monthKey(year,month,d);
          const worn=wornMap[key]||[];
          const isToday=key===todayKey;
          const isSelected=selectedDay===key;
          const hasWorn=worn.length>0;
          return(
            <div key={d} onClick={()=>setSelectedDay(isSelected?null:key)}
              style={{aspectRatio:"1",borderRadius:12,background:isSelected?`${G}22`:isToday?"#1E1A12":hasWorn?"#161412":"#111",border:isSelected?`1px solid ${G}`:isToday?`1px solid ${G}44`:hasWorn?"1px solid #2A2418":"1px solid #1A1A1A",cursor:hasWorn||isToday?"pointer":"default",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:2,padding:2,position:"relative",transition:"all 0.15s"}}>
              <div style={ss(10,isToday?700:400,isToday?G:hasWorn?MD:"#444")}>{d}</div>
              {hasWorn&&(
                <div style={{display:"flex",gap:2,flexWrap:"wrap",justifyContent:"center"}}>
                  {worn.slice(0,2).map(o=>{
                    const col=occasionColour[o.occasion]||G;
                    return <div key={o.id} style={{width:5,height:5,borderRadius:"50%",background:col}}/>;
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div style={{display:"flex",gap:12,marginBottom:16,flexWrap:"wrap"}}>
        {Object.entries(occasionColour).map(([occ,col])=>(
          <div key={occ} style={{..._row,gap:4}}>
            <div style={{width:7,height:7,borderRadius:"50%",background:col}}/>
            <span style={ss(8,400,DM)}>{occ}</span>
          </div>
        ))}
      </div>

      {/* Selected day detail */}
      {selectedDay&&(
        <div style={{background:CD,borderRadius:R18,border:`1px solid ${G}33`,padding:"16px 18px",marginBottom:12,animation:"fadeDown 0.2s ease forwards"}}>
          <div style={{..._btwn,marginBottom:12}}>
            <div style={sr(15,400,G)}>{new Date(selectedDay+"T12:00:00").toLocaleDateString("default",{weekday:"long",month:"long",day:"numeric"})}</div>
            <button onClick={()=>setSelectedDay(null)} style={{background:"none",border:"none",color:DM,fontSize:18,cursor:_p,lineHeight:1}}>×</button>
          </div>
          {dayOutfits.length===0?(
            <div style={sr(13,300,"#444",{fontStyle:"italic"})}>No outfit logged this day</div>
          ):dayOutfits.map(o=>{
            const accentCol=occasionColour[o.occasion]||G;
            const outfitItems=o.items.map(id=>items.find(i=>i.id===id)).filter(Boolean);
            return(
              <div key={o.id} onClick={()=>setDetailOutfit(o)}
                style={{background:"#111",borderRadius:R14,padding:"12px 14px",marginBottom:8,border:`1px solid ${BR}`,cursor:_p,position:"relative",overflow:"hidden"}}>
                <div style={{position:"absolute",top:0,left:0,width:3,bottom:0,background:accentCol,borderRadius:"3px 0 0 3px"}}/>
                <div style={{paddingLeft:8}}>
                  <div style={{..._btwn,marginBottom:8}}>
                    <div style={sr(15,500)}>{o.name}</div>
                    <div style={{background:accentCol+"33",borderRadius:8,padding:"2px 8px",...ss(8,600,accentCol,{letterSpacing:0.8})}}>{o.occasion}</div>
                  </div>
                  <div style={{display:"flex",gap:6,marginBottom:6}}>
                    {outfitItems.map(it=>(
                      <ItemThumb key={it.id} item={it} size={44} r={10}/>
                    ))}
                  </div>
                  <div style={ss(8,400,DM,{letterSpacing:0.5})}>Tap to see full details →</div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── RECENT OUTFITS ── */}
      {(()=>{
        const allEntries=[];
        outfits.forEach(o=>{
          (o.wornHistory||[]).forEach(d=>{
            const outfitItems=o.items.map(id=>items.find(i=>i.id===id)).filter(Boolean);
            allEntries.push({date:d,outfit:o,outfitItems,dateObj:new Date(d+"T12:00:00")});
          });
        });
        allEntries.sort((a,b)=>b.dateObj-a.dateObj);
        const shown=allEntries.slice(0,8);
        if(!shown.length) return null;
        return(
          <div style={{marginTop:20}}>
            <div style={ss(8,600,DM,{letterSpacing:2,marginBottom:12})}>RECENT OUTFITS</div>
            {shown.map((entry,idx)=>{
              const accentCol={"Work":"#7B9E87","Casual":"#8B9DC3","Evening":"#9B7BAE","Weekend":"#C4956A"}[entry.outfit.occasion]||G;
              return(
                <div key={idx} onClick={()=>setDetailOutfit(entry.outfit)}
                  style={{background:CD,borderRadius:R14,padding:"11px 13px",marginBottom:8,border:`1px solid ${BR}`,display:"flex",gap:12,alignItems:"center",cursor:_p}}>
                  <div style={{textAlign:"center",flexShrink:0,minWidth:38}}>
                    <div style={ss(8,700,G)}>{entry.dateObj.toLocaleDateString("en-US",{month:"short"}).toUpperCase()}</div>
                    <div style={sr(19,500,G,{lineHeight:1.1})}>{entry.dateObj.getDate()}</div>
                    <div style={ss(8,400,DM)}>{entry.dateObj.toLocaleDateString("en-US",{weekday:"short"}).toUpperCase()}</div>
                  </div>
                  <div style={{width:1,height:36,background:BR,flexShrink:0}}/>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={sr(14,500,undefined,{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",marginBottom:5})}>{entry.outfit.name}</div>
                    <div style={{display:"flex",gap:4}}>
                      {entry.outfitItems.slice(0,4).map(item=>(
                        <div key={item.id} style={{width:26,height:26,borderRadius:6,background:`${item.color}33`,border:`1px solid ${BR}`,display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden"}}>
                          {item.sourceImage?<img src={item.sourceImage} style={{width:"100%",height:"100%",objectFit:"cover"}} alt={item.name}/>:<ItemIllustration item={item} size={20}/>}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div style={{background:accentCol+"33",borderRadius:8,padding:"3px 8px",flexShrink:0,...ss(8,600,accentCol,{letterSpacing:0.5})}}>{entry.outfit.occasion}</div>
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* Outfit detail modal (reuses same pattern) */}
      {detailOutfit&&(()=>{
        const o=detailOutfit;
        const accentCol=occasionColour[o.occasion]||G;
        const outfitItems=o.items.map(id=>items.find(i=>i.id===id)).filter(Boolean);
        const totalValue=outfitItems.reduce((s,i)=>s+i.price,0);
        return(
          <div onClick={()=>setDetailOutfit(null)} style={{..._fix,background:"#000C",zIndex:90,display:"flex",alignItems:"flex-start",paddingTop:60,justifyContent:"center"}}>
            <div onClick={e=>e.stopPropagation()} className="sc" style={{background:"#0D0D0D",borderRadius:"0 0 24px 24px",width:"100%",maxWidth:430,border:_2a,maxHeight:"85vh",overflowY:"auto",animation:"fadeDown 0.3s ease forwards"}}>
              <div style={{padding:"16px 20px 0"}}>
                <div style={{width:36,height:4,borderRadius:2,background:"#333",margin:"0 auto 16px"}}/>
                <div style={{..._btwnS,marginBottom:6}}>
                  <div>
                    <div style={sr(22,400)}>{o.name}</div>
                    <div style={{..._row,gap:8,marginTop:5}}>
                      <div style={{background:accentCol+"33",borderRadius:8,padding:"3px 10px",...ss(8,600,accentCol,{letterSpacing:1})}}>{o.occasion}</div>
                      <div style={ss(9,400,DM)}>{o.season}</div>
                    </div>
                  </div>
                  <IconBtn onClick={()=>setDetailOutfit(null)}>×</IconBtn>
                </div>
                <div style={{display:"flex",gap:10,marginBottom:18,marginTop:12}}>
                  {[[outfitItems.length+" pieces","ITEMS"],[`$${totalValue}`,"VALUE"]].map(([v,l])=>(
                    <div key={l} style={{flex:1,background:_1a,borderRadius:12,padding:"10px",textAlign:"center",border:"1px solid #222"}}>
                      <div style={sr(15,500,G)}>{v}</div>
                      <div style={ss(8,400,DM,{letterSpacing:1,marginTop:2})}>{l}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{padding:"0 20px"}}>
                {outfitItems.map(item=>(
                  <div key={item.id} style={{background:CD,borderRadius:R14,marginBottom:10,border:`1px solid ${BR}`,overflow:"hidden"}}>
                    <div style={{width:"100%",height:180,background:`linear-gradient(135deg,${item.color}22,${item.color}44)`,overflow:"hidden",display:"flex",alignItems:"center",justifyContent:"center"}}>
                      {item.sourceImage?<img src={item.sourceImage} style={{width:"100%",height:"100%",objectFit:"contain",padding:"8px",boxSizing:"border-box"}} alt={item.name}/>:<ItemIllustration item={item} size={130}/>}
                    </div>
                    <div style={{padding:"12px 14px"}}>
                      <div style={{..._btwn,marginBottom:4}}>
                        <div style={sr(15,500)}>{item.name}</div>
                        <div style={sr(15,400,G)}>${item.price}</div>
                      </div>
                      <div style={{..._row,gap:6,marginBottom:8}}>
                        <div style={{width:8,height:8,borderRadius:"50%",background:item.color,border:"1px solid #ffffff22"}}/>
                        <div style={ss(9,400,DM)}>{item.brand} · {hexToColorName(item.color)}</div>
                      </div>
                      <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                        {item.tags.map(t=><div key={t} style={{background:`${G}11`,borderRadius:8,padding:"3px 8px",border:`1px solid ${G}22`,...ss(8,400,G)}}>#{t}</div>)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{padding:"12px 20px 32px"}}>
                <Btn full onClick={()=>{logWear(o.id);showToast(`Wearing "${o.name}" today \u2746`);setDetailOutfit(null);}}>WEAR TODAY</Btn>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ── CALENDAR ──────────────────────────────────────────────────────────────────
function CalendarTab({outfits,items,showToast,logWear,events,setEvents,session,initialView}){
  const [sel,setSel]=useState(null);
  const [view,setView]=useState(initialView||"events");
  const [showAddEvent,setShowAddEvent]=useState(false);
  const [newLabel,setNewLabel]=useState("");
  const [newDate,setNewDate]=useState("");
  const [newOccasion,setNewOccasion]=useState("Casual");
  const [newEmoji,setNewEmoji]=useState("📅");
  const [planningEvent,setPlanningEvent]=useState(null); // event being planned
  const [aiOutfits,setAiOutfits]=useState([]);
  const [aiLoading,setAiLoading]=useState(false);
  const [selectedOutfitIds,setSelectedOutfitIds]=useState([]);
  const [outfitSearch,setOutfitSearch]=useState("");
  const [savedOutfitId,setSavedOutfitId]=useState(null);
  const [thumbsFeedback,setThumbsFeedback]=useState({});
  const [feedbackOpen,setFeedbackOpen]=useState(null);
  const [feedbackText,setFeedbackText]=useState("");
  const [feedbackProcessing,setFeedbackProcessing]=useState(false);

  const processFeedback=async(outfitId,rating,text,outfitName,outfitItemNames=[])=>{
    if(!text.trim()&&!rating) return;
    setFeedbackProcessing(true);
    try{
      const profileSummary=JSON.stringify({
        aesthetic:styleProfile.aesthetic,
        occasions:styleProfile.occasions,
        fitPref:styleProfile.fitPref,
        avoidPairings:styleProfile.avoidPairings,
        colorPalette:styleProfile.colorPalette,
        learnedLoves:styleProfile.learnedLoves||[],
        learnedDislikes:styleProfile.learnedDislikes||[],
      });
      const itemLine=outfitItemNames.length?`\nSpecific items in this outfit: ${outfitItemNames.join(", ")}`:"";
      const prompt=`You are a personal stylist AI. A user rated an outfit.\nOutfit: "${outfitName}"${itemLine}\nRating: ${rating==="up"?"👍 Loved it":"👎 Did not like it"}\nUser note: "${text||"No note"}"\nProfile: ${profileSummary}\n\nBe SPECIFIC. If they disliked loafers+jeans, add "dress loafers paired with jeans" to avoidPairings. If no note, infer from items.\nReturn ONLY JSON (add to existing, max 15 each): {"learnedLoves":[],"learnedDislikes":[],"avoidPairings":[]}`;
      const raw=await callClaude(prompt);
      const updates=JSON.parse(raw.replace(/```json|```/g,"").trim());
      const now=Date.now();
      const newDisliked=rating==="down"&&outfitItemNames.length
        ?[...(styleProfile.dislikedCombos||[]),{id:outfitId,names:outfitItemNames,vibe:outfitName,ts:now}].slice(-20)
        :(styleProfile.dislikedCombos||[]);
      const newLiked=rating==="up"&&outfitItemNames.length
        ?[...(styleProfile.likedCombos||[]),{id:outfitId,names:outfitItemNames,vibe:outfitName,ts:now}].slice(-20)
        :(styleProfile.likedCombos||[]);
      const merged={
        learnedLoves:[...new Set([...(styleProfile.learnedLoves||[]),...(updates.learnedLoves||[])])].slice(-15),
        learnedDislikes:[...new Set([...(styleProfile.learnedDislikes||[]),...(updates.learnedDislikes||[])])].slice(-15),
        avoidPairings:[...new Set([...(styleProfile.avoidPairings||[]),...(updates.avoidPairings||[])])].slice(-15),
        dislikedCombos:newDisliked,
        likedCombos:newLiked,
      };
      if(saveStyleProfile) await saveStyleProfile(merged);
      showToast("Style profile updated ✦");
    }catch(e){
      console.error("processFeedback error:",e);
    }finally{
      setFeedbackProcessing(false);
      setFeedbackOpen(null);
      setFeedbackText("");
    }
  };

  const occasionEmojis={"Work":"💼","Casual":"☀️","Date Night":"🕯️","Social Event":"🥂","Formal":"🎩","Active":"🏃","Travel":"✈️","Creative":"🎨"};
  const emojiOptions=["📅","💼","🥂","☀️","🌿","✈️","🎉","💫","🎂","🍽️","🎭","🛍️"];

  const saveEventToDB=async(ev)=>{
    if(!session?.access_token) return;
    const uid=session.user?.id; if(!uid) return;
    const headers={"Content-Type":"application/json","Authorization":`Bearer ${session.access_token}`,"apikey":SB_KEY,"Prefer":"resolution=merge-duplicates,return=representation"};
    try{
      const res=await fetch(`${SB_URL}/rest/v1/calendar_events`,{method:"POST",headers,body:JSON.stringify({
        id:String(ev.id),user_id:uid,label:ev.label,date:ev.date,occasion:ev.occasion,emoji:ev.emoji,
        outfit_name:ev.outfitName||null,outfit_items:ev.outfitItems||[],suggested_outfit:ev.suggestedOutfit||null,
      })});
      const body=await res.text();
      if(!res.ok){
        console.error("saveEventToDB failed:",res.status,body);
      } else {
      }
    }catch(e){
      console.error("saveEventToDB error:",e);
      showToast("Save error: "+e.message);
    }
  };
  const deleteEventFromDB=async(id)=>{
    if(!session?.access_token) return;
    await fetch(`${SB_URL}/rest/v1/calendar_events?id=eq.${id}`,{method:"DELETE",headers:{"Authorization":`Bearer ${session.access_token}`,"apikey":SB_KEY}}).catch(()=>{});
  };

  const addEvent=()=>{
    if(!newLabel.trim()||!newDate){showToast("Please fill in event name and date \u2746");return;}
    const newEv={id:Date.now(),date:newDate,label:newLabel.trim(),occasion:newOccasion,suggestedOutfit:null,emoji:newEmoji};
    setEvents(prev=>[newEv,...prev]);
    saveEventToDB(newEv);
    setNewLabel(""); setNewDate(""); setNewOccasion("Casual"); setNewEmoji("📅");
    setShowAddEvent(false);
    if(advanceOnboard) advanceOnboard(4);
    if(onboardStep===3) showToast("Your wardrobe is live \u2746 Onboarding complete!");
    // Immediately open outfit planner for the new event
    setPlanningEvent(newEv);
    setAiOutfits([]); setSelectedOutfitIds([]); setOutfitSearch(""); setSavedOutfitId(null);
  };

  const openPlanner=(ev)=>{
    setPlanningEvent(ev);
    setAiOutfits([]); setSelectedOutfitIds([]); setOutfitSearch(""); setSavedOutfitId(null);
  };

  const generateAIOutfit=async()=>{
    if(!planningEvent) return;
    setAiLoading(true); setAiOutfits([]);
    try{
      const closetSummary=items.slice(0,30).map(i=>`${i.name} (${i.category}, ${i.brand||""}, ${i.color})`).join("; ");
      const raw=await callClaude(
        `I have a ${planningEvent.occasion} event called "${planningEvent.label}" on ${planningEvent.date}. My closet includes: ${closetSummary}. Suggest 3 complete outfit combinations from these items. Each outfit should be cohesive and appropriate for the occasion. Return ONLY JSON: {"outfits":[{"name":"...","vibe":"...","itemNames":["exact item name 1","exact item name 2","exact item name 3"],"note":"one line why this works"}]}`
      );
      const json=JSON.parse(raw.replace(/```json|```/g,"").trim());
      // Map AI item names back to actual item objects
      const matched=(json.outfits||[]).map((o,i)=>({
        id:`ai-${i}`,
        name:o.name,
        vibe:o.vibe,
        note:o.note,
        items:o.itemNames.map(name=>items.find(it=>it.name.toLowerCase().includes(name.toLowerCase().split(" ")[0])||name.toLowerCase().includes(it.name.toLowerCase().split(" ")[0]))).filter(Boolean).map(it=>it.id),
      })).filter(o=>o.items.length>0);
      setAiOutfits(matched);
    }catch(e){showToast("Couldn't generate suggestions — try again \u2746");}
    setAiLoading(false);
  };

  const saveOutfitToEvent=(outfitObj)=>{
    // Save as a real outfit if it's AI-generated
    let outfitId = outfitObj.id;
    if(String(outfitId).startsWith("ai-")){
      const newOutfit={id:Date.now(),name:outfitObj.name,items:outfitObj.items,occasion:planningEvent.occasion,season:"All Year",wornHistory:[]};
      setEvents(prev=>prev); // trigger re-render
      outfitId=newOutfit.id;
      // Patch into outfits via event update — parent doesn't have setOutfits here
      // Store on event directly
    }
    setEvents(prev=>prev.map(ev=>{
      if(ev.id!==planningEvent.id) return ev;
      const updated={...ev,suggestedOutfit:outfitId,outfitItems:outfitObj.items,outfitName:outfitObj.name};
      saveEventToDB(updated);
      return updated;
    }));
    setSavedOutfitId(outfitId);
    showToast(`"${outfitObj.name}" saved for ${planningEvent.label} \u2746`);
  };

  // Outfits to show in search — existing saved outfits
  const filteredOutfits=outfitSearch.trim()
    ? outfits.filter(o=>o.name.toLowerCase().includes(outfitSearch.toLowerCase())||o.occasion?.toLowerCase().includes(outfitSearch.toLowerCase()))
    : outfits.slice(0,6);

  return(
    <div className="fu" style={{padding:"16px 24px"}}>
      <div style={{marginBottom:16}}>
        <div style={sr(22,300)}>Plan Ahead</div>
        <div style={ss(10,400,DM,{letterSpacing:1,marginTop:2})}>OCCASION PLANNING · OUTFIT SCHEDULING</div>
      </div>

      {/* Top-level toggle — always visible */}
      <div style={{display:"flex",gap:6,marginBottom:18}}>
        {[["events","Events","📅"],["vacation","Vacation","🌍"]].map(([k,l,ic])=>(
          <button key={k} className="pb" onClick={()=>setView(k)} style={{flex:1,padding:"10px 6px",borderRadius:R14,background:view===k?G:"#1A1A1A",border:view===k?"none":"1px solid #222",display:"flex",alignItems:"center",justifyContent:"center",gap:5,...ss(9,view===k?600:400,view===k?BK:DM,{letterSpacing:0.8})}}>
            <span style={{fontSize:13}}>{ic}</span>{l}
          </button>
        ))}
      </div>

      {/* EVENTS VIEW */}
      {view==="events"&&(
        <React.Fragment>
          <button className="sb" onClick={()=>setShowAddEvent(true)} style={{width:"100%",padding:"14px",borderRadius:R14,background:CD,border:`1.5px dashed ${G}44`,display:"flex",alignItems:"center",justifyContent:"center",gap:8,marginBottom:16,...ss(10,600,G,{letterSpacing:1.5}),cursor:_p}}>
            <span style={{fontSize:16}}>+</span> ADD UPCOMING EVENT
          </button>

          <div style={{background:"linear-gradient(135deg,#1A160F,#1E1A12)",borderRadius:R18,padding:"16px 18px",border:"1px solid #2A2418",marginBottom:18}}>
            <Lbl mb={4}>This Week</Lbl>
            <div style={sr(14,400,G,{fontStyle:"italic"})}>{events.length} events planned · {outfits.length} outfits ready</div>
          </div>

          {events.map(ev=>{
            const outfitItems=(ev.outfitItems||[]).map(id=>items.find(i=>i.id===id)).filter(Boolean);
            const hasOutfit=outfitItems.length>0 || ev.outfitName;
            const open=sel?.id===ev.id;
            // Parse date string (e.g. "Fri Mar 21" or "Mar 21" or "Sat Apr 5")
            const dateParts=(ev.date||"").replace(/^[A-Za-z]{3}\s/,"").split(" ");
            const mon=(dateParts[0]||"").substring(0,3).toUpperCase();
            const day=dateParts[1]||"";
            return(
              <div key={ev.id} className="ch" onClick={()=>setSel(open?null:ev)} style={{background:CD,borderRadius:R18,padding:"16px 18px",marginBottom:12,border:`1px solid ${open?"#C4A88266":BR}`}}>
                <div style={{display:"flex",gap:12,alignItems:"center",marginBottom:open?12:0}}>
                  {/* Calendar date badge */}
                  <div style={{width:44,flexShrink:0,borderRadius:12,overflow:"hidden",border:`1px solid ${G}55`,boxShadow:`0 0 8px ${G}22`}}>
                    <div style={{background:G,padding:"3px 0",textAlign:"center"}}>
                      <div style={{fontFamily:"'Montserrat',sans-serif",fontSize:9,fontWeight:700,color:BK,letterSpacing:1}}>{mon||"EVT"}</div>
                    </div>
                    <div style={{background:"#0D0D0D",padding:"4px 0",textAlign:"center"}}>
                      <div style={{fontFamily:"'Montserrat',sans-serif",fontSize:18,fontWeight:700,color:G,lineHeight:1}}>{day||"—"}</div>
                    </div>
                  </div>
                  <div style={{flex:1}}>
                    <div style={sr(15,500)}>{ev.label}</div>
                    <div style={ss(9,400,DM,{letterSpacing:1,marginTop:2})}>{ev.date} · {ev.occasion}</div>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    {hasOutfit&&<div style={ss(9,400,G)}>✓ Planned</div>}
                    <button onClick={e=>{e.stopPropagation();setEvents(prev=>prev.filter(x=>x.id!==ev.id));deleteEventFromDB(ev.id);showToast("Event removed \u2746");}} style={{background:"none",border:"none",cursor:_p,...ss(12,400,DM)}}>×</button>
                  </div>
                </div>
                {open&&(
                  <div style={{borderTop:`1px solid ${BR}`,paddingTop:12}}>
                    {hasOutfit?(
                      <React.Fragment>
                        <div style={ss(9,400,DM,{letterSpacing:1,marginBottom:10})}>OUTFIT: {(ev.outfitName||"").toUpperCase()}</div>
                        {outfitItems.length>0&&(
                          <div style={{borderRadius:R14,overflow:"hidden",marginBottom:12,border:`1px solid ${BR}`}}>
                            {outfitItems.slice(0,3).map((it,i)=>(
                              <div key={it.id} style={{width:"100%",paddingTop:"85%",position:"relative",background:`linear-gradient(135deg,${it.color||"#2A2A2A"}18,${it.color||"#2A2A2A"}33)`,borderTop:i>0?`1px solid #1E1E1E`:"none"}}>
                                {it.sourceImage
                                  ?<img src={it.sourceImage} style={{position:"absolute",inset:0,width:"100%",height:"100%",objectFit:"contain",padding:16,boxSizing:"border-box"}} alt={it.name}/>
                                  :<div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center"}}><ItemIllustration item={it} size={90}/></div>
                                }
                                <div style={{position:"absolute",bottom:8,left:12,...ss(10,500,"#E8E0D4")}}>{it.name}</div>
                              </div>
                            ))}
                          </div>
                        )}
                        <div style={{display:"flex",gap:8}}>
                          <Btn onClick={e=>{e.stopPropagation();openPlanner(ev);}} outline small>CHANGE</Btn>
                          <Btn onClick={e=>{e.stopPropagation();showToast("Outfit confirmed for "+ev.label+" \u2746");}} full small>CONFIRM ✓</Btn>
                        </div>
                      </React.Fragment>
                    ):(
                      <button onClick={e=>{e.stopPropagation();openPlanner(ev);}} style={{width:"100%",padding:"12px",borderRadius:12,background:`linear-gradient(135deg,${G},#8A6E54)`,border:"none",...ss(10,600,BK,{letterSpacing:1.5}),cursor:_p}}>
                        ✦ PLAN OUTFIT FOR THIS EVENT
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </React.Fragment>
      )}

      {/* VACATION VIEW */}
      {view==="vacation"&&(
        <VacationPlanner items={items} outfits={outfits} showToast={showToast} onBack={()=>setView("events")} session={session}/>
      )}

      {/* ── ADD EVENT MODAL ── */}
      {showAddEvent&&(
        <AddEventPage
          newLabel={newLabel} setNewLabel={setNewLabel}
          newOccasion={newOccasion} newEmoji={newEmoji}
          setNewOccasion={setNewOccasion} setNewEmoji={setNewEmoji}
          newDate={newDate} setNewDate={setNewDate}
          occasionEmojis={occasionEmojis}
          onCancel={()=>setShowAddEvent(false)}
          onSave={addEvent}
        />
      )}

      {/* ── OUTFIT PLANNER MODAL ── */}
      {planningEvent&&(
        <div onClick={()=>setPlanningEvent(null)} style={{..._fix,background:"#000000CC",zIndex:90,display:"flex",alignItems:"flex-end"}}>
          <div onClick={e=>e.stopPropagation()} style={{background:"#0D0D0D",borderRadius:"24px 24px 0 0",width:"100%",maxWidth:430,margin:"0 auto",border:_2a,maxHeight:"90vh",display:"flex",flexDirection:"column"}}>

            {/* Header */}
            <div style={{padding:"20px 22px 0",flexShrink:0}}>
              <div style={{width:36,height:4,borderRadius:2,background:"#333",margin:"0 auto 16px"}}/>
              <div style={{..._btwn,marginBottom:4}}>
                <div>
                  <div style={sr(20,400)}>Plan Outfit</div>
                  <div style={ss(9,400,DM,{letterSpacing:1,marginTop:2})}>{planningEvent.emoji} {planningEvent.label.toUpperCase()} · {planningEvent.date}</div>
                </div>
                <button onClick={()=>setPlanningEvent(null)} style={{width:32,height:32,borderRadius:"50%",background:_1a,border:_2a,...ss(14,400,MD),cursor:_p,display:"flex",alignItems:"center",justifyContent:"center"}}>×</button>
              </div>
            </div>

            <div className="sc" style={{flex:1,overflowY:"auto",padding:"16px 22px 32px"}}>

              {/* Success state */}
              {savedOutfitId&&(
                <div style={{background:"#0F1A0F",borderRadius:R14,padding:"14px 16px",border:"1px solid #2A4A2A",marginBottom:16,display:"flex",gap:10,alignItems:"center"}}>
                  <span style={{fontSize:18}}>✓</span>
                  <span style={ss(11,500,"#A8C4A0",{letterSpacing:0.5})}>Outfit saved for this event</span>
                  <button onClick={()=>setPlanningEvent(null)} style={{marginLeft:"auto",padding:"5px 14px",borderRadius:R18,background:`linear-gradient(135deg,${G},#8A6E54)`,border:"none",...ss(9,600,BK),cursor:_p}}>DONE</button>
                </div>
              )}

              {/* AI Generate */}
              <button onClick={generateAIOutfit} disabled={aiLoading} style={{width:"100%",padding:"12px 16px",borderRadius:R14,background:aiLoading?_1a:`linear-gradient(135deg,${G},#A08060,#C4A882)`,border:"none",display:"flex",alignItems:"center",justifyContent:"center",gap:8,cursor:aiLoading?"default":_p,marginBottom:16,opacity:aiLoading?0.7:1}}>
                <span style={{fontSize:15,animation:aiLoading?"spin 1.2s linear infinite":undefined}}>✦</span>
                <div style={ss(10,700,aiLoading?MD:BK,{letterSpacing:1.5})}>{aiLoading?"GENERATING LOOKS…":"AI SUGGEST OUTFITS FOR THIS EVENT"}</div>
              </button>

              {/* AI suggestions */}
              {aiOutfits.length>0&&(
                <div style={{marginBottom:20}}>
                  <div style={ss(9,600,DM,{letterSpacing:1.5,marginBottom:10})}>AI SUGGESTIONS</div>
                  {aiOutfits.map(o=>{
                    const oItems=o.items.map(id=>items.find(i=>i.id===id)).filter(Boolean);
                    return(
                      <div key={o.id} style={{background:CD,borderRadius:R14,padding:"14px",border:`1px solid ${BR}`,marginBottom:10}}>
                        <div style={{..._btwn,marginBottom:8}}>
                          <div>
                            <div style={sr(14,500)}>{o.name}</div>
                            <div style={ss(9,400,G,{marginTop:2,fontStyle:"italic"})}>{o.vibe}</div>
                          </div>
                        </div>
                        <div style={{display:"flex",gap:8,marginBottom:10,flexWrap:"wrap"}}>
                          {oItems.map(it=><ItemThumb key={it.id} item={it} size={48} r={11}/>)}
                        </div>
                        {o.note&&<div style={ss(9,400,DM,{marginBottom:10,lineHeight:1.5,fontStyle:"italic"})}>✦ {o.note}</div>}
                        <div style={{marginBottom:8}}>
                          <div style={{display:"flex",gap:8,marginBottom:6}}>
                            <button onClick={()=>{
                              const newRating=thumbsFeedback[o.id]==="up"?null:"up";
                              setThumbsFeedback(p=>({...p,[o.id]:newRating}));
                              if(newRating) setFeedbackOpen(o.id);
                              setFeedbackText("");
                            }} style={{padding:"6px 14px",borderRadius:R18,background:thumbsFeedback[o.id]==="up"?"#1A2A1A":"#111",border:thumbsFeedback[o.id]==="up"?"1px solid #2A4A2A":"1px solid #2A2A2A",cursor:_p,...ss(13,400,thumbsFeedback[o.id]==="up"?"#80C880":DM)}}>👍</button>
                            <button onClick={()=>{
                              const newRating=thumbsFeedback[o.id]==="down"?null:"down";
                              setThumbsFeedback(p=>({...p,[o.id]:newRating}));
                              if(newRating) setFeedbackOpen(o.id);
                              setFeedbackText("");
                            }} style={{padding:"6px 14px",borderRadius:R18,background:thumbsFeedback[o.id]==="down"?"#2A1A1A":"#111",border:thumbsFeedback[o.id]==="down"?"1px solid #4A2A2A":"1px solid #2A2A2A",cursor:_p,...ss(13,400,thumbsFeedback[o.id]==="down"?"#C08080":DM)}}>👎</button>
                            {thumbsFeedback[o.id]&&feedbackOpen!==o.id&&<div style={ss(9,400,DM,{alignSelf:"center",fontStyle:"italic"})}>Feedback saved ✦</div>}
                          </div>
                          {feedbackOpen===o.id&&(
                            <div style={{background:"#0F0F0F",borderRadius:12,padding:"12px",border:`1px solid ${G}33`}}>
                              <div style={ss(9,600,G,{letterSpacing:1,marginBottom:8})}>
                                {thumbsFeedback[o.id]==="up"?"WHAT DID YOU LOVE ABOUT THIS?":"WHAT DIDN'T WORK FOR YOU?"}
                              </div>
                              <textarea
                                value={feedbackText}
                                onChange={e=>setFeedbackText(e.target.value)}
                                placeholder={thumbsFeedback[o.id]==="up"?"e.g. Love the color combo, great for casual Fridays...":"e.g. Too formal, not my style, colors clash..."}
                                style={{width:"100%",boxSizing:"border-box",background:"#1A1A1A",border:"1px solid #2A2A2A",borderRadius:8,padding:"10px 12px",...ss(11,400,MD),color:"#C0B8B0",outline:"none",resize:"none",height:72,lineHeight:1.4}}
                              />
                              <div style={{display:"flex",gap:8,marginTop:8}}>
                                <button onClick={()=>{setFeedbackOpen(null);setFeedbackText("");}} style={{flex:1,padding:"8px",borderRadius:12,background:"#1A1A1A",border:"1px solid #2A2A2A",...ss(9,600,DM,{letterSpacing:0.8}),cursor:_p}}>SKIP</button>
                                <button onClick={()=>processFeedback(o.id,thumbsFeedback[o.id],feedbackText,o.name,(o.items||[]).map(id=>{const it=items.find(i=>i.id===id);return it?.name;}).filter(Boolean))} disabled={feedbackProcessing} style={{flex:2,padding:"8px",borderRadius:12,background:feedbackProcessing?"#1A1A1A":`linear-gradient(135deg,${G},#8A6E54)`,border:"none",...ss(9,700,feedbackProcessing?DM:BK,{letterSpacing:0.8}),cursor:_p,opacity:feedbackProcessing?0.6:1}}>
                                  {feedbackProcessing?"LEARNING…":"SAVE FEEDBACK"}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                        <button onClick={()=>saveOutfitToEvent(o)} style={{width:"100%",padding:"10px",borderRadius:12,background:savedOutfitId?`linear-gradient(135deg,#2A4A2A,#1A3A1A)`:`linear-gradient(135deg,${G},#8A6E54)`,border:"none",...ss(9,600,savedOutfitId?"#80C080":BK,{letterSpacing:1}),cursor:_p}}>
                          {savedOutfitId?"✓ SAVED":"SAVE THIS LOOK FOR EVENT"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Divider */}
              <div style={{..._row,gap:10,marginBottom:16}}>
                <div style={{flex:1,height:1,background:BR}}/>
                <div style={ss(8,400,DM,{letterSpacing:1})}>OR CHOOSE FROM YOUR CLOSET</div>
                <div style={{flex:1,height:1,background:BR}}/>
              </div>

              {/* Search existing outfits */}
              <div style={{..._row,gap:8,background:"#0D0D0D",border:`1px solid #2A2A2A`,borderRadius:12,padding:"8px 12px",marginBottom:12}}>
                <span style={{fontSize:12,opacity:0.4}}>🔍</span>
                <input value={outfitSearch} onChange={e=>setOutfitSearch(e.target.value)} placeholder="Search your saved outfits…"
                  style={{flex:1,background:"none",border:"none",outline:"none",...ss(11,400,MD),color:"#C0B8B0"}}/>
                {outfitSearch&&<button onClick={()=>setOutfitSearch("")} style={{background:"none",border:"none",cursor:_p,...ss(12,400,DM)}}>✕</button>}
              </div>

              {filteredOutfits.length===0&&<div style={sr(12,300,"#3A3028",{fontStyle:"italic",textAlign:"center",padding:"16px 0"})}>No saved outfits yet — use AI above to generate one</div>}
              {filteredOutfits.map(o=>{
                const oItems=(o.items||[]).map(id=>items.find(i=>i.id===id)).filter(Boolean);
                return(
                  <div key={o.id} style={{background:CD,borderRadius:R14,padding:"12px 14px",border:`1px solid ${BR}`,marginBottom:8,display:"flex",gap:12,alignItems:"center"}}>
                    <div style={{display:"flex",gap:6,flex:1,flexWrap:"wrap"}}>
                      {oItems.slice(0,4).map(it=><ItemThumb key={it.id} item={it} size={40} r={9}/>)}
                      <div style={{flex:1,minWidth:80}}>
                        <div style={sr(13,500,undefined,{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"})}>{o.name}</div>
                        <div style={ss(9,400,DM,{marginTop:2})}>{o.occasion}</div>
                      </div>
                    </div>
                    <button onClick={()=>saveOutfitToEvent({...o,items:o.items||[]})} style={{padding:"7px 14px",borderRadius:12,background:`linear-gradient(135deg,${G},#8A6E54)`,border:"none",...ss(9,600,BK,{letterSpacing:0.8}),cursor:_p,flexShrink:0}}>SELECT</button>
                  </div>
                );
              })}

            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── CREATE LISTING PAGE ───────────────────────────────────────────────────────
// ── Style subcategory clusters ──────────────────────────────────────────────
const STYLE_CLUSTERS={
  tee:["tee","t-shirt","tshirt","t shirt","crew neck","crewneck","graphic tee","pocket tee"],
  hoodie:["hoodie","hoody","sweatshirt","pullover","zip-up","fleece","zipup"],
  sweater:["sweater","knit","knitwear","cardigan","jumper","turtleneck","mock neck"],
  buttondown:["shirt","button","oxford","flannel","chambray","woven","linen shirt","dress shirt"],
  tank:["tank","cami","camisole","singlet","sleeveless"],
  blouse:["blouse","shell","bodysuit"],
  jeans:["jean","denim","501","levi","wrangler"],
  chino:["chino","khaki","twill","trouser","slacks"],
  shorts:["short","cargo short","swim short"],
  sweatpant:["sweatpant","jogger","track pant","legging","tight"],
  skirt:["skirt","mini","midi","maxi skirt","pleated"],
  sneaker:["sneaker","trainer","runner","running shoe","new balance","adidas","nike","asics","jordan","chuck","converse","vans","stan smith"],
  dress_shoe:["oxford","derby","brogue","loafer","monk","dress shoe","leather shoe","formal shoe","wingtip"],
  boot:["boot","chelsea","combat","work boot","ankle boot","chukka"],
  sandal:["sandal","slide","flip flop","birkenstock","mule"],
  jacket:["jacket","bomber","harrington","track jacket","varsity","windbreaker","rain jacket"],
  blazer:["blazer","sport coat","suit jacket"],
  coat:["coat","overcoat","topcoat","trench","peacoat","puffer","parka","down jacket","anorak"],
  bag:["bag","tote","backpack","crossbody","clutch","purse","satchel"],
  hat:["hat","cap","beanie","bucket hat","beret"],
};

const COLOR_FAMILIES=[
  ["#FFFFFF","#F5F5F5","#F0EBE3","#E8E0D4","#FFF8F0"],
  ["#F5F0E8","#E8D5B7","#D4B896","#C4A882","#B8976A","#A08060","#8B7355"],
  ["#F5DEB3","#DEB887","#D2691E","#A0522D","#8B4513","#7A5030","#6B3A2A"],
  ["#000000","#0D0D0D","#1A1A1A","#2A2A2A","#111111","#141414"],
  ["#3A3A3A","#4A4A4A","#5A5A5A","#666666","#808080","#555555"],
  ["#AAAAAA","#BBBBBB","#CCCCCC","#DDDDDD","#E5E5E5"],
  ["#000080","#00008B","#1A3A6A","#2A4A7A","#1E2A4A","#2C3E6A","#3A5A8A"],
  ["#4169E1","#1E90FF","#6495ED","#4682B4"],
  ["#006400","#228B22","#2D5A27","#1A4A1A","#2A5A2A"],
  ["#90EE90","#98FB98","#6B8E23"],
  ["#8B0000","#A52A2A","#C0392B","#CC3333","#800000"],
  ["#FF6B6B","#FF4444","#FF6347","#DC143C"],
  ["#FFB6C1","#FFC0CB","#FF69B4","#DB7093","#C8648C"],
  ["#800080","#9B59B6","#8B008B","#9370DB","#6A0DAD"],
  ["#FFA500","#FF8C00","#FF7F50","#E8750A"],
  ["#FFFF00","#FFD700","#F0E68C","#DAA520"],
];

function getColorFamily(hex){
  if(!hex) return -1;
  const h=hex.toUpperCase();
  for(let i=0;i<COLOR_FAMILIES.length;i++){
    if(COLOR_FAMILIES[i].some(c=>c.toUpperCase()===h)) return i;
  }
  try{
    const toRGB=c=>{const n=parseInt(c.replace("#",""),16);return[(n>>16)&255,(n>>8)&255,n&255];};
    const[r1,g1,b1]=toRGB(hex);
    let minDist=999999,minFam=-1;
    COLOR_FAMILIES.forEach((fam,fi)=>{
      fam.forEach(c=>{try{const[r2,g2,b2]=toRGB(c);const d=Math.abs(r1-r2)+Math.abs(g1-g2)+Math.abs(b1-b2);if(d<minDist){minDist=d;minFam=fi;}}catch(e){}});
    });
    return minDist<120?minFam:-1;
  }catch(e){return -1;}
}

function getStyleCluster(name){
  if(!name) return null;
  const n=name.toLowerCase();
  for(const[cluster,kws] of Object.entries(STYLE_CLUSTERS)){
    if(kws.some(k=>n.includes(k))) return cluster;
  }
  return null;
}

// Minimum closet size before duplicate detection runs — prevents false positives on new accounts
const MIN_ITEMS_FOR_DUPE_CHECK = 10;

function keywordFallbackDupes(items){
  const groups=[],used=new Set();
  items.forEach((a,i)=>{
    if(used.has(a.id)) return;
    const cA=getStyleCluster(a.name),fA=getColorFamily(a.color);
    const matches=items.slice(i+1).filter(b=>{
      if(used.has(b.id)||a.category!==b.category) return false;
      const cB=getStyleCluster(b.name);
      if(!cA||!cB||cA!==cB) return false;
      if(fA<0||getColorFamily(b.color)<0||fA!==getColorFamily(b.color)) return false;
      return true;
    });
    if(matches.length>0){
      const cluster=(cA||a.category.toLowerCase()).replace("_"," ");
      groups.push({id:`k${a.id}`,label:`Similar ${cluster}`,items:[a,...matches],similarity:72,source:"keyword",
        reason:`Both are ${cluster}s in a similar color — they serve the same purpose and compete for the same outfit slot.`});
      matches.forEach(m=>used.add(m.id));
      used.add(a.id);
    }
  });
  return groups;
}

function DuplicatesSection({items,showToast}){
  const [dismissed,setDismissed]=useState(new Set());
  const [aiGroups,setAiGroups]=useState(null);
  const [aiLoading,setAiLoading]=useState(false);
  const [aiError,setAiError]=useState(null);

  const fallbackGroups=useMemo(()=>keywordFallbackDupes(items).filter(g=>!dismissed.has(g.id)),[items,dismissed]);

  const loadAiDupes=async()=>{
    if(items.length<MIN_ITEMS_FOR_DUPE_CHECK) return;
    setAiLoading(true); setAiError(null);
    try{
      const summary=items.map(i=>`${i.id}|||${i.name}|||${i.category}|||${i.brand||""}|||${i.color||""}`).join("\n");
      const raw=await callClaude(
        `You are a wardrobe analyst. Identify groups of TRUE functional duplicates — items the user could swap for the same occasions. Be strict: a hoodie and a t-shirt are NOT duplicates. Dress shoes and sneakers are NOT duplicates. Only flag items that genuinely compete for the same outfit slot.\n\nItems (id|||name|||category|||brand|||color):\n${summary}\n\nReturn ONLY JSON:\n{"groups":[{"ids":["id1","id2"],"label":"Short group name","similarity":85,"reason":"One sentence explaining why these are true duplicates"}]}\n\nIf no true duplicates, return {"groups":[]}.`,
        "You are a fashion expert. Respond only with valid JSON."
      );
      const json=JSON.parse(raw.replace(/\`\`\`json|\`\`\`/g,"").trim());
      const mapped=(json.groups||[]).map((g,i)=>({
        id:`ai${i}`,label:g.label,similarity:g.similarity||80,source:"ai",reason:g.reason,
        items:g.ids.map(id=>items.find(it=>String(it.id)===String(id))).filter(Boolean),
      })).filter(g=>g.items.length>=2);
      setAiGroups(mapped);
    }catch(e){ setAiError("AI analysis failed — showing keyword results."); }
    setAiLoading(false);
  };

  useEffect(()=>{ if(items.length>=MIN_ITEMS_FOR_DUPE_CHECK&&aiGroups===null&&!aiLoading) loadAiDupes(); },[items.length]);

  const displayGroups=(aiGroups||fallbackGroups).filter(g=>!dismissed.has(g.id));
  const usingAI=aiGroups!==null&&!aiError;
  const belowMinimum = items.length < MIN_ITEMS_FOR_DUPE_CHECK;

  // ── Empty state: closet too small for reliable dupe detection ──
  if(belowMinimum){
    const remaining = MIN_ITEMS_FOR_DUPE_CHECK - items.length;
    const pct = Math.round((items.length / MIN_ITEMS_FOR_DUPE_CHECK) * 100);
    return(
      <div>
        <div style={{..._btwn,marginBottom:14}}>
          <div style={ss(8,600,DM,{letterSpacing:1.5})}>DUPLICATE ANALYSIS</div>
          <div style={{background:"#1A1408",border:`1px solid ${G}22`,borderRadius:R18,padding:"3px 10px",...ss(8,600,G,{letterSpacing:0.8})}}>
            BUILDING BASELINE
          </div>
        </div>
        <div style={{background:"linear-gradient(135deg,#141008,#1A1408)",borderRadius:R14,padding:"24px 20px",border:`1px solid ${G}22`,textAlign:"center"}}>
          <div style={{width:48,height:48,borderRadius:"50%",background:`${G}18`,border:`1px solid ${G}33`,display:"inline-flex",alignItems:"center",justifyContent:"center",marginBottom:14}}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <circle cx="9" cy="9" r="5.5" stroke={G} strokeWidth="1.4" fill="none"/>
              <path d="M13 13L17 17" stroke={G} strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
          </div>
          <div style={sr(18,400,"#E8E0D4",{marginBottom:8})}>Not quite enough to compare</div>
          <div style={ss(11,400,DM,{lineHeight:1.6,marginBottom:18,maxWidth:280,margin:"0 auto 18px"})}>
            Duplicate detection works best with at least {MIN_ITEMS_FOR_DUPE_CHECK} items. Right now we'd flag too many false matches.
          </div>
          {/* Progress bar */}
          <div style={{maxWidth:240,margin:"0 auto 10px"}}>
            <div style={{height:5,background:"#0A0A0A",borderRadius:3,overflow:"hidden",border:"1px solid #1E1A14"}}>
              <div style={{height:"100%",width:`${pct}%`,background:`linear-gradient(90deg,${G},#8A6E54)`,borderRadius:3,transition:"width 0.4s ease"}}/>
            </div>
          </div>
          <div style={ss(9,600,G,{letterSpacing:1})}>
            {items.length} / {MIN_ITEMS_FOR_DUPE_CHECK} ITEMS · {remaining} TO GO
          </div>
          <div style={ss(10,400,"#7A6E60",{lineHeight:1.55,marginTop:14,maxWidth:260,margin:"14px auto 0"})}>
            Keep adding pieces — we'll start analyzing automatically once you reach {MIN_ITEMS_FOR_DUPE_CHECK}.
          </div>
        </div>
      </div>
    );
  }

  return(
    <div>
      <div style={{..._btwn,marginBottom:14}}>
        <div style={ss(8,600,DM,{letterSpacing:1.5})}>DUPLICATE ANALYSIS</div>
        <div style={{..._row,gap:6}}>
          {aiLoading&&<AILoader size="micro"/>}
          <div style={{background:usingAI?"#0A1A0A":"#1A1A0A",border:`1px solid ${usingAI?"#2A4A2A":"#2A2A14"}`,borderRadius:R18,padding:"3px 10px",...ss(8,600,usingAI?"#60A870":"#A08040",{letterSpacing:0.8})}}>
            {aiLoading?"AI SCANNING…":usingAI?"✦ AI POWERED":"KEYWORD MODE"}
          </div>
          {!aiLoading&&<button onClick={loadAiDupes} style={{background:"none",border:"none",cursor:_p,...ss(10,400,DM)}}>↺</button>}
        </div>
      </div>
      {aiError&&<div style={{...ss(9,400,"#A08060",{marginBottom:12,padding:"8px 12px",background:"#1A1408",borderRadius:12,border:"1px solid #2A2010"})}}>{aiError}</div>}
      {displayGroups.map(group=>(
        <div key={group.id} style={{background:CD,borderRadius:R14,padding:"16px",marginBottom:12,border:`1px solid ${BR}`}}>
          <div style={{..._btwnS,marginBottom:12}}>
            <div style={{flex:1}}>
              <div style={{..._row,gap:6,marginBottom:4}}>
                <div style={ss(8,700,"#C4A060",{letterSpacing:1})}>{group.similarity}% SIMILAR</div>
                {group.source==="ai"&&<div style={{background:"#0A1A0A",border:"1px solid #1A3A1A",borderRadius:12,padding:"1px 6px",...ss(8,600,"#60A870",{letterSpacing:0.5})}}>AI</div>}
              </div>
              <div style={sr(15,500)}>{group.label}</div>
            </div>
            <button onClick={()=>setDismissed(d=>new Set([...d,group.id]))} style={{width:28,height:28,borderRadius:"50%",background:_1a,border:_2a,...ss(11,400,DM),display:"flex",alignItems:"center",justifyContent:"center",cursor:_p,flexShrink:0}}>✕</button>
          </div>
          <div style={{display:"flex",gap:10,marginBottom:12,overflowX:"auto"}}>
            {group.items.map(item=>(
              <div key={item.id} style={{flex:1,minWidth:80,background:"#111",borderRadius:12,padding:"10px",textAlign:"center"}}>
                <div style={{width:52,height:52,borderRadius:12,background:`${item.color||G}22`,margin:"0 auto 8px",display:"flex",alignItems:"center",justifyContent:"center",border:_2a,overflow:"hidden"}}>
                  {item.sourceImage
                    ?<img src={item.sourceImage} style={{width:"100%",height:"100%",objectFit:"contain",padding:4,boxSizing:"border-box"}} alt={item.name}/>
                    :<ItemIllustration item={item} size={40}/>}
                </div>
                <div style={sr(12,500,undefined,{lineHeight:1.3,marginBottom:2})}>{item.name}</div>
                <div style={ss(8,400,DM)}>{item.brand||""}</div>
                <div style={ss(8,400,"#8A7060",{marginTop:2})}>{item.wearCount||0}x worn</div>
              </div>
            ))}
          </div>
          <div style={{...ss(10,400,"#A09880",{lineHeight:1.6,marginBottom:12,fontStyle:"italic"})}}>{group.reason}</div>
          <div style={{display:"flex",gap:8}}>
            <button onClick={()=>showToast("Mark the item for sale in its detail view \u2746")} style={{flex:1,padding:"8px",borderRadius:11,background:_1a,border:_2a,...ss(8,500,DM,{letterSpacing:0.8}),cursor:_p}}>LIST ONE FOR SALE</button>
            <button onClick={()=>setDismissed(d=>new Set([...d,group.id]))} style={{flex:1,padding:"8px",borderRadius:11,background:G,border:"none",...ss(8,600,BK,{letterSpacing:0.8}),cursor:_p}}>KEEP BOTH</button>
          </div>
        </div>
      ))}
      {!aiLoading&&displayGroups.length===0&&(
        <div style={{textAlign:"center",padding:"32px 0"}}>
          <div style={{fontSize:40,marginBottom:12}}>✨</div>
          <div style={sr(18,300,G)}>Your closet is efficient</div>
          <div style={ss(10,400,DM,{marginTop:8,lineHeight:1.6})}>
            {usingAI?"AI found no true duplicates in your wardrobe.":"No keyword matches found. Run AI for deeper detection."}
          </div>
          {!usingAI&&<button onClick={loadAiDupes} style={{marginTop:16,padding:"9px 22px",borderRadius:R18,background:`${G}22`,border:`1px solid ${G}44`,...ss(9,600,G,{letterSpacing:1}),cursor:_p}}>\u2746 RUN AI ANALYSIS</button>}
        </div>
      )}
      {aiLoading&&(
        <AILoader label="Scanning for duplicates" detail="Checking style subcategories, color families & occasion overlap" size="lg"/>
      )}
    </div>
  );
}

function StatsTab({items, outfits, showToast, logWear}){
  const [section,setSection]=useState("overview"); // overview | dupes | valuation | history
  const total=items.reduce((s,i)=>s+i.price,0);
  const wornItems=items.filter(i=>i.wearCount>0);
  const wornPct=items.length>0?Math.round((wornItems.length/items.length)*100):0;
  const top=[...items].sort((a,b)=>b.wearCount-a.wearCount).filter(i=>i.wearCount>0).slice(0,5);
  const lessUsed=items.filter(i=>i.wearCount===0).slice(0,5);

  const subTabs=[["overview","Overview"],["dupes","Duplicates"],["history","Worn History"]];

  return(
    <div className="fu" style={{padding:"16px 24px"}}>
      <div style={{marginBottom:16}}>
        <div style={sr(22,300)}>Your Wardrobe</div>
        <div style={ss(10,400,DM,{letterSpacing:1,marginTop:2})}>WHAT'S WORKING FOR YOU</div>
      </div>

      {/* Sub-tab strip */}
      <div style={{display:"flex",background:"#111",borderRadius:R14,overflow:"hidden",border:"1px solid #1E1E1E",marginBottom:20,flexShrink:0}}>
        {subTabs.map(([k,l])=>(
          <button key={k} onClick={()=>setSection(k)} style={{flex:1,padding:"9px 4px",background:section===k?`linear-gradient(135deg,${G},#8A6E54)`:"transparent",border:"none",cursor:_p,...ss(8,section===k?600:400,section===k?BK:DM,{letterSpacing:0.5,whiteSpace:"nowrap"})}}>
            {l}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW ── */}
      {section==="overview"&&(
        <React.Fragment>
          {/* Positive lead stat */}
          {items.length>0&&(
            <div style={{background:`linear-gradient(135deg,#1A1610,#1E1A12)`,borderRadius:R18,padding:"18px 20px",border:`1px solid ${G}44`,marginBottom:14}}>
              <div style={ss(8,600,DM,{letterSpacing:1.5,marginBottom:10})}>YOUR CLOSET IS WORKING HARD</div>
              <div style={{display:"flex",alignItems:"baseline",gap:8,marginBottom:8}}>
                <div style={sr(44,300,G,{lineHeight:1})}>{wornPct}%</div>
                <div style={ss(12,400,MD,{lineHeight:1.5})}>of your pieces<br/>get regular wear</div>
              </div>
              <div style={{height:6,background:"#1A1A1A",borderRadius:3,overflow:"hidden",marginBottom:8}}>
                <div style={{height:"100%",width:`${wornPct}%`,background:`linear-gradient(90deg,${G},#A08060)`,borderRadius:3,transition:"width 0.8s ease"}}/>
              </div>
              <div style={ss(10,400,DM)}>{wornItems.length} piece{wornItems.length!==1?"s":""} pulling their weight in your rotation</div>
            </div>
          )}

          {/* Most worn — positive hero */}
          {top.length>0&&(
            <div style={{background:CD,borderRadius:R18,padding:"18px",border:`1px solid ${BR}`,marginBottom:14}}>
              <Lbl>MOST LOVED THIS SEASON</Lbl>
              <div style={ss(10,400,DM,{marginBottom:14,lineHeight:1.6})}>These {top.length} pieces are doing the most. Every wear drives their cost-per-wear down.</div>
              {top.map((item,i)=>(
                <div key={item.id} style={{..._row,gap:12,marginBottom:i<top.length-1?12:0,paddingBottom:i<top.length-1?12:0,borderBottom:i<top.length-1?`1px solid ${BR}`:"none"}}>
                  <ItemThumb item={item} size={48} r={12}/>
                  <div style={{flex:1}}>
                    <div style={sr(14,500)}>{item.name}</div>
                    <div style={ss(9,400,DM,{letterSpacing:1})}>{item.wearCount} wears · {item.brand}</div>
                  </div>
                  <div style={{textAlign:"right"}}>
                    <div style={ss(9,600,G)}>${item.wearCount>0?Math.round(item.price/item.wearCount):item.price} / wear</div>
                    <div style={ss(8,400,DM,{marginTop:1})}>cost per wear</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Hidden gems — reframed, not judgmental */}
          {lessUsed.length>0&&(
            <div style={{background:CD,borderRadius:R18,padding:"18px",border:`1px solid ${BR}`}}>
              <Lbl>READY FOR THEIR MOMENT</Lbl>
              <div style={ss(10,400,DM,{marginBottom:14,lineHeight:1.6})}>These pieces haven't been styled yet — each one is an outfit waiting to happen.</div>
              {lessUsed.map((item,i)=>(
                <div key={item.id} style={{..._row,gap:12,marginBottom:i<lessUsed.length-1?10:0}}>
                  <ItemThumb item={item} size={44} r={10}/>
                  <div style={{flex:1}}>
                    <div style={sr(13,500)}>{item.name}</div>
                    <div style={ss(9,400,DM,{letterSpacing:1})}>{item.brand} · Added {item.purchaseDate||"recently"}</div>
                  </div>
                  <div style={{background:"#1A1A2A",borderRadius:R18,padding:"3px 9px",...ss(8,600,"#8080C8")}}>style me →</div>
                </div>
              ))}
            </div>
          )}
        </React.Fragment>
      )}

      {/* ── WARDROBE HEALTH ── */}
      {section==="dupes"&&(
        <DuplicatesSection items={items} showToast={showToast} />
      )}

      {/* ── WORN HISTORY ── */}
      {section==="history"&&<WornHistoryCalendar outfits={outfits} items={items} showToast={showToast} logWear={logWear}/>}

    </div>
  );
}

// ── NOTIFICATIONS ────────────────────────────────────────────────────────────
// Real notifications are loaded via loadRealNotifs() in PushNotifPreview —
// no demo/seed data. Panel starts empty and populates from live Supabase data.

// ── CART & CHECKOUT ───────────────────────────────────────────────────────────
// ── PAYWALL GATE ─────────────────────────────────────────────────────────────
// ── PRICING MODAL ─────────────────────────────────────────────────────────────
function PricingModal({onClose,onSubscribe,currentPlan}){
  const [billing,setBilling]=useState("annual");

  const plans=[
    {
      id:"free", name:"Free", icon:"○",
      monthly:0, annual:0,
      color:"#3A3028", accent:"#8A7968",
      tagline:"Start building your closet",
      features:[
        ["✓","Unlimited closet items"],
        ["✓","Outfit builder (10 saved)"],
        ["✓","Get Dressed daily flow"],
        ["✓","Market — buy & sell"],
        ["✓","Social following feed"],
        ["✗","AI Stylist & missing pieces"],
        ["✗","Wardrobe stats"],
        ["✗","Occasion planner"],
        ["✗","Photo & URL item upload"],
        ["✗","Personal stylists"],
      ],
    },
    {
      id:"plus", name:"Outfix+", icon:"✦",
      monthly:5.99, annual:49.99,
      color:"#2A2418", accent:G,
      tagline:"Your full style system",
      badge:"MOST POPULAR",
      features:[
        ["✓","Everything in Free"],
        ["✓","AI Stylist — pairings & vibes"],
        ["✓","Missing Pieces & Wardrobe Score"],
        ["✓","Wishlist & market matching"],
        ["✓","Wardrobe stats"],
        ["✓","Occasion planner & calendar"],
        ["✓","Photo & URL item recognition"],
        ["✓","Unlimited saved outfits"],
        ["✓","Priority market listings"],
        ["✗","Personal stylist sessions"],
      ],
    },
    {
      id:"pro", name:"Outfix Pro", icon:"◆",
      monthly:14.99, annual:119.99,
      color:"#1A1A2E", accent:"#A0B0D4",
      tagline:"For the fashion-forward",
      features:[
        ["✓","Everything in Outfix+"],
        ["✓","Personal stylist marketplace"],
        ["✓","Book per-session — any budget"],
        ["✓","Shopper browses your closet"],
        ["✓","Sync chat between sessions"],
        ["✓","Early access to new features"],
        ["✓","Verified stylist reviews"],
        ["✓","5% off all Market purchases"],
        ["✓","Priority support"],
      ],
    },
  ];

  const saving=(p)=>Math.round(100-(p.annual/(p.monthly*12))*100);

  return(
    <div onClick={onClose} style={{..._fix,background:"#000000BB",zIndex:100,display:"flex",alignItems:"flex-start",paddingTop:60}}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#0D0D0D",borderRadius:"28px 28px 0 0",width:"100%",maxWidth:430,margin:"0 auto",border:_2a,animation:"fadeUp 0.35s ease forwards",maxHeight:"92vh",overflowY:"auto"}}>

        {/* Header */}
        <div style={{padding:"24px 24px 0",position:"sticky",top:0,background:"#0D0D0D",zIndex:2}}>
          <div style={{..._btwnS,marginBottom:6}}>
            <div>
              <div style={sr(26,300,undefined,{letterSpacing:1})}>Choose Your Plan</div>
              <div style={ss(9,400,DM,{letterSpacing:2,marginTop:4})}>OUTFIX SUBSCRIPTION</div>
            </div>
            <button className="tb" onClick={onClose} style={{width:32,height:32,borderRadius:"50%",background:_1a,border:_2a,...ss(14,400,MD),display:"flex",alignItems:"center",justifyContent:"center"}}>×</button>
          </div>

          {/* Billing toggle */}
          <div style={{display:"flex",background:_1a,borderRadius:30,padding:4,marginTop:16,marginBottom:20,border:_2a}}>
            {[["monthly","Monthly"],["annual","Annual"]].map(([k,l])=>(
              <button key={k} className="pb" onClick={()=>setBilling(k)} style={{flex:1,padding:"9px",borderRadius:26,background:billing===k?G:"transparent",border:"none",...ss(10,billing===k?600:400,billing===k?BK:DM,{letterSpacing:1}),cursor:_p}}>
                {l}{k==="annual"&&<span style={{...ss(8,600,billing==="annual"?"#0D0D0D88":"#4A6A3A",{marginLeft:4})}}> SAVE 30%</span>}
              </button>
            ))}
          </div>
        </div>

        {/* Plan cards */}
        <div style={{padding:"0 16px 24px",display:"flex",flexDirection:"column",gap:10}}>
          {plans.map(plan=>{
            const isCurrent=currentPlan===plan.id;
            const price=billing==="annual"?plan.annual:plan.monthly;
            const perMonth=billing==="annual"&&plan.id!=="free"?(plan.annual/12).toFixed(2):null;
            return(
              <div key={plan.id} style={{background:`linear-gradient(135deg,${plan.color},${plan.color}88)`,borderRadius:R18,padding:"14px 16px",border:`1.5px solid ${isCurrent?plan.accent:"#2A2A2A"}`,position:"relative",overflow:"hidden"}}>
                {/* Glow */}
                <div style={{position:"absolute",top:-30,right:-30,width:100,height:100,borderRadius:"50%",background:`radial-gradient(circle,${plan.accent}15,transparent)`}} />

                {plan.badge&&(
                  <div style={{position:"absolute",top:12,right:12,background:`linear-gradient(135deg,${G},#8A6E54)`,borderRadius:R18,padding:"3px 10px",...ss(8,700,BK,{letterSpacing:1.5})}}>{plan.badge}</div>
                )}
                {isCurrent&&(
                  <div style={{position:"absolute",top:12,right:12,background:"#1A2A1A",borderRadius:R18,padding:"3px 10px",...ss(8,600,"#A8C4A0",{letterSpacing:1})}}>CURRENT PLAN</div>
                )}

                <div style={{..._row,gap:10,marginBottom:10}}>
                  <div style={{width:36,height:36,borderRadius:11,background:`${plan.accent}22`,border:`1px solid ${plan.accent}44`,display:"flex",alignItems:"center",justifyContent:"center",...sr(16,400,plan.accent)}}>{plan.icon}</div>
                  <div style={{flex:1}}>
                    <div style={sr(17,500,plan.accent)}>{plan.name}</div>
                    <div style={ss(8,400,DM,{letterSpacing:0.8,marginTop:1})}>{plan.tagline.toUpperCase()}</div>
                  </div>
                  <div style={{textAlign:"right",...((plan.badge||isCurrent)?{paddingTop:18}:{})}}>
                    {plan.id==="free"?(
                      <div style={sr(22,300,"#6A6058")}>Free</div>
                    ):(
                      <React.Fragment>
                        <div style={sr(22,400,plan.accent)}>${billing==="annual"&&perMonth?perMonth:price}</div>
                        <div style={ss(8,400,DM,{letterSpacing:0.8})}>{billing==="annual"&&perMonth?"/mo billed annually":"/month"}</div>
                        {billing==="annual"&&<div style={ss(8,600,"#4A6A3A",{marginTop:1})}>${price}/yr · save {saving(plan)}%</div>}
                      </React.Fragment>
                    )}
                  </div>
                </div>

                {/* Features - 2 column grid */}
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"3px 8px",marginBottom:10}}>
                  {plan.features.map(([tick,feat],i)=>(
                    <div key={i} style={{display:"flex",gap:5,alignItems:"flex-start"}}>
                      <div style={{...ss(9,600,tick==="✓"?plan.accent:"#3A3028"),flexShrink:0,lineHeight:1.4}}>{tick}</div>
                      <div style={ss(9,400,tick==="✓"?MD:"#3A3028",{lineHeight:1.4})}>{feat}</div>
                    </div>
                  ))}
                </div>

                {!isCurrent&&(
                  <button className="sb" onClick={()=>onSubscribe(plan.id,billing)} style={{
                    width:"100%",padding:"10px",borderRadius:12,border:"none",cursor:_p,
                    background:plan.id==="free"?"#1A1A1A":plan.id==="plus"?`linear-gradient(135deg,${G},#8A6E54)`:"linear-gradient(135deg,#3A4A6A,#2A3A5A)",
                    ...ss(9,600,plan.id==="free"?DM:plan.id==="plus"?BK:"#C0D0F0",{letterSpacing:1.5}),
                  }}>
                    {plan.id==="free"?"STAY ON FREE PLAN":plan.id==="plus"?"START OUTFIX+":"START OUTFIX PRO"}
                  </button>
                )}
              </div>
            );
          })}

          {/* Shopper marketplace note */}
          <div style={{background:"linear-gradient(135deg,#1A1A2E,#16213E)",borderRadius:R18,padding:"18px",border:"1px solid #2A2A4A"}}>
            <div style={{display:"flex",gap:10,alignItems:"center",marginBottom:10}}>
              <div style={{fontSize:22}}>◆</div>
              <div style={sr(15,500,"#A0B0D4")}>Personal Shopper Marketplace</div>
            </div>
            <div style={ss(10,400,DM,{lineHeight:1.6,marginBottom:12})}>
              Book vetted personal shoppers per session — no subscription required. Shoppers set their own rates. Outfix takes a 22% platform fee.
            </div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              {["From $60/session","Pay per booking","All skill levels","Verified reviews"].map(t=>(
                <div key={t} style={{background:"#1A1A3A",borderRadius:R18,padding:"5px 12px",...ss(9,400,"#7A90C4",{letterSpacing:0.5})}}>✦ {t}</div>
              ))}
            </div>
            <div style={ss(9,400,"#4A5A7A",{marginTop:12,lineHeight:1.5})}>Available to Outfix Pro subscribers. Shopper marketplace sessions are billed separately at shopper rates.</div>
          </div>

          {/* Trust signals */}
          <div style={{display:"flex",justifyContent:"center",gap:20,padding:"8px 0"}}>
            {["Cancel anytime","No hidden fees","Secure payment"].map(t=>(
              <div key={t} style={ss(9,400,"#3A3028",{letterSpacing:0.5,textAlign:"center"})}>✓ {t}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── PREMIUM TAB ───────────────────────────────────────────────────────────────
const stylistData=[
  {id:1,name:"Isabelle M.",specialty:"Parisian Minimalism",rating:4.9,clients:214,avatar:"👩‍💼",available:true,
   tags:["Minimalist","Office","Capsule Wardrobes"],
   bio:"Former buyer at Le Bon Marche. Specialises in building effortless neutral wardrobes that work harder.",
   sessionRate:"From $75",
   sessionRates:{closet:140,outfit:95,shop:210,video:75}},
  {id:2,name:"Devon K.",specialty:"Streetwear & Hype",rating:4.8,clients:189,avatar:"🧑‍🎤",available:true,
   tags:["Streetwear","Sneakers","Statement Pieces"],
   bio:"10 years in NYC fashion. Expert in blending high and low, sneaker culture and editorial looks.",
   sessionRate:"From $60",
   sessionRates:{closet:110,outfit:80,shop:175,video:60}},
  {id:3,name:"Priya S.",specialty:"Sustainable Fashion",rating:5.0,clients:97,avatar:"👩‍🌾",available:false,
   tags:["Sustainable","Vintage","Conscious Fashion"],
   bio:"Sustainable fashion consultant and vintage curator. Helps clients build wardrobes with purpose.",
   sessionRate:"From $65",
   sessionRates:{closet:120,outfit:85,shop:190,video:65}},
  {id:4,name:"Marcus T.",specialty:"Formalwear & Tailoring",rating:4.7,clients:143,avatar:"🧑‍💼",available:true,
   tags:["Tailoring","Formalwear","Power Dressing"],
   bio:"Former Savile Row apprentice. Specialises in formalwear, suiting and occasion dressing.",
   sessionRate:"From $90",
   sessionRates:{closet:160,outfit:115,shop:240,video:90}},
];

function PremiumTab({showToast,currentPlan,setShowPricing}){
  const [notifyMe,setNotifyMe]=useState(()=>{
    try{ return localStorage.getItem("outfix_shoppers_waitlist")==="1"; }catch(e){ return false; }
  });

  const joinWaitlist=()=>{
    try{ localStorage.setItem("outfix_shoppers_waitlist","1"); }catch(e){}
    setNotifyMe(true);
    showToast("You're on the waitlist — we'll notify you at launch ✦");
  };

  const avatarColors=[
    ["#3A2818","#C4A050"],["#1A2838","#6090C4"],["#1A2818","#60A870"],["#2A1838","#A070C4"]
  ];

  const StarRating=({r})=>(
    <div style={{display:"flex",gap:1}}>
      {[1,2,3,4,5].map(i=>(
        <span key={i} style={{fontSize:10,color:i<=Math.round(r)?G:"#2A2A2A"}}>★</span>
      ))}
      <span style={ss(9,400,MD,{marginLeft:4})}>{r}</span>
    </div>
  );

  const steps=[
    {
      num:"01",
      title:"Share Your Closet",
      desc:"Your stylist gets read-only access to your wardrobe, style profile, and wishlist — so every suggestion is personal.",
      icon:(
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <path d="M12 3C12 3 12 2 14 2C15.5 2 15.5 3.5 15.5 3.5C15.5 4.5 14 5 12 6" stroke={G} strokeWidth="1.5" strokeLinecap="round"/>
          <path d="M12 6C8 8 2 10 2 12C2 13 2.5 13.5 3 13.5L21 13.5C21.5 13.5 22 13 22 12C22 10 16 8 12 6Z" stroke={G} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      ),
    },
    {
      num:"02",
      title:"Get Matched",
      desc:"Browse vetted stylists by aesthetic, specialty, and rate. Every shopper is interviewed and approved by the Outfix team.",
      icon:(
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="8" r="4" stroke={G} strokeWidth="1.5"/>
          <path d="M5 21C5 16 8 13 12 13C16 13 19 16 19 21" stroke={G} strokeWidth="1.5" strokeLinecap="round"/>
          <path d="M17 4L19 6L23 2" stroke={G} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      ),
    },
    {
      num:"03",
      title:"Book a Session",
      desc:"Closet audit, outfit build, shopping trip, or video call. One-time sessions — no subscription, no commitment.",
      icon:(
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="5" width="18" height="16" rx="2" stroke={G} strokeWidth="1.5"/>
          <line x1="3" y1="10" x2="21" y2="10" stroke={G} strokeWidth="1.5"/>
          <line x1="8" y1="3" x2="8" y2="7" stroke={G} strokeWidth="1.5" strokeLinecap="round"/>
          <line x1="16" y1="3" x2="16" y2="7" stroke={G} strokeWidth="1.5" strokeLinecap="round"/>
          <circle cx="8" cy="14.5" r="1" fill={G}/>
          <circle cx="12" cy="14.5" r="1" fill={G}/>
          <circle cx="16" cy="14.5" r="1" fill={G}/>
        </svg>
      ),
    },
    {
      num:"04",
      title:"Shop Together",
      desc:"Your shopper curates picks from the Market and external brands. Chat, share looks, and make decisions as a team.",
      icon:(
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <path d="M4 6H20L18.5 15H5.5L4 6Z" stroke={G} strokeWidth="1.5" strokeLinejoin="round"/>
          <circle cx="8" cy="19" r="1.5" stroke={G} strokeWidth="1.5"/>
          <circle cx="16" cy="19" r="1.5" stroke={G} strokeWidth="1.5"/>
          <path d="M1 2H3L4 6" stroke={G} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M14 2L17 6" stroke={G} strokeWidth="1.2" strokeLinecap="round" opacity="0.5"/>
        </svg>
      ),
    },
  ];

  return(
    <div className="fu" style={{padding:"0 0 40px"}}>

      {/* ── Hero: Coming Soon ── */}
      <div style={{margin:"16px 16px 14px",borderRadius:R18,overflow:"hidden",position:"relative",border:`1px solid ${G}33`}}>
        <div style={{background:`linear-gradient(135deg,#1A1408,#2A1E10 60%,#141008)`,padding:"28px 22px 24px",position:"relative"}}>
          {/* Top shine */}
          <div style={{position:"absolute",top:0,left:0,right:0,height:1,background:`linear-gradient(90deg,transparent,${G}66,transparent)`}}/>
          <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:10}}>
            <span style={{fontSize:11,color:G}}>✦</span>
            <div style={ss(8,700,G,{letterSpacing:2.5})}>COMING SOON</div>
          </div>
          <div style={sr(26,400,"#F0EBE3",{marginBottom:8,letterSpacing:0.3})}>Personal Shoppers</div>
          <div style={ss(11,400,"#A09080",{lineHeight:1.6,marginBottom:16,maxWidth:320})}>
            Work one-on-one with vetted stylists who know your taste. Book sessions, share your closet, and get curated picks — no subscription required.
          </div>
          {!notifyMe?(
            <button onClick={joinWaitlist} style={{padding:"10px 20px",borderRadius:R18,background:`linear-gradient(135deg,${G},#8A6E54)`,border:"none",...ss(9,700,BK,{letterSpacing:1.5}),cursor:_p,boxShadow:"0 4px 14px rgba(196,168,130,0.25)"}}>
              NOTIFY ME AT LAUNCH →
            </button>
          ):(
            <div style={{display:"flex",alignItems:"center",gap:8,background:`${G}18`,border:`1px solid ${G}44`,borderRadius:R18,padding:"8px 14px",width:"fit-content"}}>
              <div style={{width:7,height:7,borderRadius:"50%",background:"#60A870"}}/>
              <span style={ss(9,600,G,{letterSpacing:0.8})}>You're on the waitlist ✦</span>
            </div>
          )}
        </div>
      </div>

      {/* ── How It Works ── */}
      <div style={{padding:"0 20px",marginBottom:20}}>
        <div style={ss(8,700,DM,{letterSpacing:2,marginBottom:14})}>HOW IT WILL WORK</div>
        {steps.map((s,i)=>(
          <div key={s.num} style={{display:"flex",gap:14,marginBottom:i<steps.length-1?18:4,position:"relative"}}>
            {/* Vertical line connector */}
            {i<steps.length-1&&(
              <div style={{position:"absolute",left:17,top:44,bottom:-18,width:1,background:`linear-gradient(180deg,${G}33,transparent)`}}/>
            )}
            {/* Icon circle */}
            <div style={{width:36,height:36,borderRadius:"50%",background:"#141008",border:`1px solid ${G}44`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,position:"relative",zIndex:1}}>
              {s.icon}
            </div>
            <div style={{flex:1,paddingTop:2}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                <span style={ss(8,600,G,{letterSpacing:1.5,opacity:0.7})}>{s.num}</span>
                <span style={{fontFamily:"'Cormorant Garamond',serif",fontSize:16,fontWeight:400,color:"#E8E0D4"}}>{s.title}</span>
              </div>
              <div style={ss(10,400,"#7A6E60",{lineHeight:1.6})}>{s.desc}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Preview roster ── */}
      <div style={{padding:"0 20px 4px",marginBottom:12}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
          <div style={ss(8,700,DM,{letterSpacing:2})}>PREVIEW · INAUGURAL STYLIST ROSTER</div>
          <div style={{background:"#141008",border:`1px solid ${G}33`,borderRadius:10,padding:"2px 7px",...ss(7,700,G,{letterSpacing:0.8})}}>LOCKED</div>
        </div>
        <div style={ss(10,400,"#5A4E40",{lineHeight:1.6,marginBottom:14})}>A glimpse at the initial lineup — 4 stylists across every aesthetic. Available when Shoppers launches.</div>
      </div>

      {/* ── Shopper cards (locked preview) ── */}
      {stylistData.map((sh,idx)=>{
        const [bgCol,accentCol]=avatarColors[idx%avatarColors.length];
        return(
          <div key={sh.id} style={{margin:"0 16px 12px",borderRadius:R18,overflow:"hidden",border:`1px solid ${BR}`,position:"relative",opacity:0.85}}>

            {/* Lock overlay badge */}
            <div style={{position:"absolute",top:12,right:12,zIndex:2,background:"rgba(13,13,13,0.85)",border:`1px solid ${G}44`,borderRadius:R18,padding:"4px 10px",display:"flex",alignItems:"center",gap:5,backdropFilter:"blur(4px)"}}>
              <svg width="10" height="10" viewBox="0 0 14 14" fill="none">
                <rect x="3" y="6" width="8" height="7" rx="1" stroke={G} strokeWidth="1.2" fill="none"/>
                <path d="M5 6V4C5 2.5 6 1.5 7 1.5C8 1.5 9 2.5 9 4V6" stroke={G} strokeWidth="1.2" strokeLinecap="round" fill="none"/>
              </svg>
              <span style={ss(8,700,G,{letterSpacing:1})}>SOON</span>
            </div>

            {/* Card header */}
            <div style={{background:`linear-gradient(135deg,${bgCol},${bgCol}CC,#141414)`,padding:"18px 18px 14px"}}>
              <div style={{display:"flex",gap:12,alignItems:"center"}}>
                <div style={{width:52,height:52,borderRadius:R14,background:`linear-gradient(135deg,${bgCol}EE,${accentCol}44)`,border:`1.5px solid ${accentCol}44`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                  <span style={{fontSize:20}}>{sh.avatar}</span>
                </div>
                <div>
                  <div style={sr(17,500)}>{sh.name}</div>
                  <div style={ss(9,400,DM,{marginTop:2,letterSpacing:0.5})}>{sh.specialty}</div>
                  <div style={{marginTop:4}}><StarRating r={sh.rating}/></div>
                </div>
              </div>
            </div>

            {/* Card body (compact — preview only) */}
            <div style={{background:CD,padding:"12px 16px"}}>
              <div style={ss(10,400,"#A09880",{lineHeight:1.55,marginBottom:10})}>{sh.bio}</div>
              <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                {sh.tags.map(t=>(
                  <span key={t} style={{background:`${G}0D`,border:`1px solid ${G}22`,borderRadius:R18,padding:"3px 9px",...ss(8,400,G,{letterSpacing:0.3})}}>{t}</span>
                ))}
              </div>
            </div>
          </div>
        );
      })}

      {/* ── Bottom CTA ── */}
      <div style={{margin:"20px 16px 0",padding:"18px 20px",background:"linear-gradient(135deg,#141008,#1A1408)",borderRadius:R18,border:`1px solid ${G}22`,textAlign:"center"}}>
        <div style={{fontSize:20,marginBottom:8,color:G}}>✦</div>
        <div style={sr(16,400,"#E8E0D4",{marginBottom:6})}>Want early access?</div>
        <div style={ss(10,400,"#7A6E60",{lineHeight:1.55,marginBottom:14})}>Waitlist members get first picks when Shoppers launches — and an exclusive launch-week discount.</div>
        {!notifyMe?(
          <button onClick={joinWaitlist} style={{padding:"10px 22px",borderRadius:R18,background:`linear-gradient(135deg,${G},#8A6E54)`,border:"none",...ss(9,700,BK,{letterSpacing:1.5}),cursor:_p}}>
            JOIN WAITLIST
          </button>
        ):(
          <div style={ss(9,600,G,{letterSpacing:1})}>✓ You're in — we'll reach out soon</div>
        )}
      </div>

    </div>
  );
}

// ── MARKET (COMING SOON) ──────────────────────────────────────────────────────
function MarketTab({showToast}){
  const [notifyMe,setNotifyMe]=useState(()=>{
    try{ return localStorage.getItem("outfix_market_waitlist")==="1"; }catch(e){ return false; }
  });

  const joinWaitlist=()=>{
    try{ localStorage.setItem("outfix_market_waitlist","1"); }catch(e){}
    setNotifyMe(true);
    showToast("You're on the waitlist — we'll notify you at launch ✦");
  };

  const steps=[
    {
      num:"01",
      title:"List from Your Closet",
      desc:"Mark any piece in your closet as \"for sale\" in one tap. Photos, details, and styling context carry over automatically.",
      icon:(
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <path d="M5 7V4C5 3 5.5 2 7 2H17C18.5 2 19 3 19 4V7" stroke={G} strokeWidth="1.5" strokeLinecap="round" fill="none"/>
          <path d="M3 7H21L19.5 21H4.5L3 7Z" stroke={G} strokeWidth="1.5" strokeLinejoin="round" fill="none"/>
          <circle cx="17" cy="13" r="2" fill={G}/>
          <text x="17" y="15" fontSize="2.4" fill="#0D0D0D" textAnchor="middle" fontWeight="700">$</text>
        </svg>
      ),
    },
    {
      num:"02",
      title:"Get Matched to Gaps",
      desc:"Your listings surface to buyers whose closets have the exact gap your item fills — higher match, faster sale.",
      icon:(
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <circle cx="10" cy="10" r="6" stroke={G} strokeWidth="1.5" fill="none"/>
          <path d="M14.5 14.5L20 20" stroke={G} strokeWidth="1.5" strokeLinecap="round"/>
          <circle cx="10" cy="10" r="2" fill={G}/>
        </svg>
      ),
    },
    {
      num:"03",
      title:"Make & Receive Offers",
      desc:"Counter, accept, or decline — negotiate directly with buyers. Offer context shows their closet so you know who you're selling to.",
      icon:(
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <path d="M4 10H20C20.5 10 21 9.5 21 9V5C21 4.5 20.5 4 20 4H4C3.5 4 3 4.5 3 5V9C3 9.5 3.5 10 4 10Z" stroke={G} strokeWidth="1.5" strokeLinejoin="round" fill="none"/>
          <path d="M3 14H20C20.5 14 21 14.5 21 15V19C21 19.5 20.5 20 20 20H4C3.5 20 3 19.5 3 19V15C3 14.5 3.5 14 4 14Z" stroke={G} strokeWidth="1.5" strokeLinejoin="round" fill="none"/>
          <circle cx="6" cy="7" r="1" fill={G}/>
          <circle cx="6" cy="17" r="1" fill={G}/>
        </svg>
      ),
    },
    {
      num:"04",
      title:"Ship & Get Paid",
      desc:"Prepaid shipping label sent to your email. Once the buyer confirms receipt, payment lands in your account — minus a small platform fee.",
      icon:(
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <path d="M3 7H13V17H3V7Z" stroke={G} strokeWidth="1.5" strokeLinejoin="round" fill="none"/>
          <path d="M13 10H18L21 13V17H13V10Z" stroke={G} strokeWidth="1.5" strokeLinejoin="round" fill="none"/>
          <circle cx="7" cy="19" r="1.5" stroke={G} strokeWidth="1.5"/>
          <circle cx="17" cy="19" r="1.5" stroke={G} strokeWidth="1.5"/>
        </svg>
      ),
    },
  ];

  // Preview listings — placeholder shop cards that show how marketplace will look
  const previewListings=[
    {label:"Silk Slip Dress", brand:"Toteme", price:245, category:"Dresses",   tone:["#2A2420","#403830"]},
    {label:"Chelsea Boots",   brand:"Sezane", price:185, category:"Shoes",     tone:["#1A1612","#2A2218"]},
    {label:"Linen Blazer",    brand:"Arket",  price:120, category:"Outerwear", tone:["#4A3828","#5A4838"]},
    {label:"Cashmere Knit",   brand:"The Row",price:340, category:"Tops",      tone:["#3A2A20","#4A3A30"]},
  ];

  return(
    <div className="fu" style={{padding:"0 0 40px"}}>

      {/* ── Hero: Coming Soon ── */}
      <div style={{margin:"16px 16px 14px",borderRadius:R18,overflow:"hidden",position:"relative",border:`1px solid ${G}33`}}>
        <div style={{background:`linear-gradient(135deg,#1A1408,#2A1E10 60%,#141008)`,padding:"28px 22px 24px",position:"relative"}}>
          {/* Top shine */}
          <div style={{position:"absolute",top:0,left:0,right:0,height:1,background:`linear-gradient(90deg,transparent,${G}66,transparent)`}}/>
          <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:10}}>
            <span style={{fontSize:11,color:G}}>✦</span>
            <div style={ss(8,700,G,{letterSpacing:2.5})}>COMING SOON</div>
          </div>
          <div style={sr(26,400,"#F0EBE3",{marginBottom:8,letterSpacing:0.3})}>The Exchange</div>
          <div style={ss(11,400,"#A09080",{lineHeight:1.6,marginBottom:16,maxWidth:320})}>
            Buy, sell, and trade pieces directly with other Outfix members. Peer-to-peer resale with offers, styling context, and closet-aware matching.
          </div>
          {!notifyMe?(
            <button onClick={joinWaitlist} style={{padding:"10px 20px",borderRadius:R18,background:`linear-gradient(135deg,${G},#8A6E54)`,border:"none",...ss(9,700,BK,{letterSpacing:1.5}),cursor:_p,boxShadow:"0 4px 14px rgba(196,168,130,0.25)"}}>
              NOTIFY ME AT LAUNCH →
            </button>
          ):(
            <div style={{display:"flex",alignItems:"center",gap:8,background:`${G}18`,border:`1px solid ${G}44`,borderRadius:R18,padding:"8px 14px",width:"fit-content"}}>
              <div style={{width:7,height:7,borderRadius:"50%",background:"#60A870"}}/>
              <span style={ss(9,600,G,{letterSpacing:0.8})}>You're on the waitlist ✦</span>
            </div>
          )}
        </div>
      </div>

      {/* ── How It Works ── */}
      <div style={{padding:"0 20px",marginBottom:20}}>
        <div style={ss(8,700,DM,{letterSpacing:2,marginBottom:14})}>HOW IT WILL WORK</div>
        {steps.map((s,i)=>(
          <div key={s.num} style={{display:"flex",gap:14,marginBottom:i<steps.length-1?18:4,position:"relative"}}>
            {/* Vertical line connector */}
            {i<steps.length-1&&(
              <div style={{position:"absolute",left:17,top:44,bottom:-18,width:1,background:`linear-gradient(180deg,${G}33,transparent)`}}/>
            )}
            {/* Icon circle */}
            <div style={{width:36,height:36,borderRadius:"50%",background:"#141008",border:`1px solid ${G}44`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,position:"relative",zIndex:1}}>
              {s.icon}
            </div>
            <div style={{flex:1,paddingTop:2}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                <span style={ss(8,600,G,{letterSpacing:1.5,opacity:0.7})}>{s.num}</span>
                <span style={{fontFamily:"'Cormorant Garamond',serif",fontSize:16,fontWeight:400,color:"#E8E0D4"}}>{s.title}</span>
              </div>
              <div style={ss(10,400,"#7A6E60",{lineHeight:1.6})}>{s.desc}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Preview listings ── */}
      <div style={{padding:"0 20px 4px",marginBottom:12}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
          <div style={ss(8,700,DM,{letterSpacing:2})}>PREVIEW · WHAT LISTINGS WILL LOOK LIKE</div>
          <div style={{background:"#141008",border:`1px solid ${G}33`,borderRadius:10,padding:"2px 7px",...ss(7,700,G,{letterSpacing:0.8})}}>LOCKED</div>
        </div>
        <div style={ss(10,400,"#5A4E40",{lineHeight:1.6,marginBottom:14})}>A glimpse at how the marketplace feed will feel. Sample items — not yet shoppable.</div>
      </div>

      {/* ── Listing cards (locked preview — 2x2 grid) ── */}
      <div style={{padding:"0 16px",display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:4}}>
        {previewListings.map((item,idx)=>(
          <div key={idx} style={{borderRadius:R18,overflow:"hidden",border:`1px solid ${BR}`,position:"relative",opacity:0.85}}>
            {/* Lock badge */}
            <div style={{position:"absolute",top:8,right:8,zIndex:2,background:"rgba(13,13,13,0.85)",border:`1px solid ${G}44`,borderRadius:R18,padding:"3px 8px",display:"flex",alignItems:"center",gap:4,backdropFilter:"blur(4px)"}}>
              <svg width="9" height="9" viewBox="0 0 14 14" fill="none">
                <rect x="3" y="6" width="8" height="7" rx="1" stroke={G} strokeWidth="1.2" fill="none"/>
                <path d="M5 6V4C5 2.5 6 1.5 7 1.5C8 1.5 9 2.5 9 4V6" stroke={G} strokeWidth="1.2" strokeLinecap="round" fill="none"/>
              </svg>
              <span style={ss(7,700,G,{letterSpacing:0.8})}>SOON</span>
            </div>
            {/* Image placeholder — gold silhouette matching the item's category */}
            <div style={{height:130,background:`linear-gradient(135deg,${item.tone[0]},${item.tone[1]})`,display:"flex",alignItems:"center",justifyContent:"center",position:"relative"}}>
              <CatSVG cat={item.category} size={48} color={`${G}88`}/>
            </div>
            {/* Card body */}
            <div style={{background:CD,padding:"10px 12px"}}>
              <div style={sr(13,500,"#E8E0D4",{marginBottom:2,lineHeight:1.2})}>{item.label}</div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:4}}>
                <span style={ss(8,400,DM,{letterSpacing:0.3})}>{item.brand}</span>
                <span style={ss(11,600,G,{letterSpacing:0.3})}>${item.price}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Bottom CTA ── */}
      <div style={{margin:"20px 16px 0",padding:"18px 20px",background:"linear-gradient(135deg,#141008,#1A1408)",borderRadius:R18,border:`1px solid ${G}22`,textAlign:"center"}}>
        <div style={{fontSize:20,marginBottom:8,color:G}}>✦</div>
        <div style={sr(16,400,"#E8E0D4",{marginBottom:6})}>Want early access?</div>
        <div style={ss(10,400,"#7A6E60",{lineHeight:1.55,marginBottom:14})}>Waitlist members get first pick when the Exchange opens — plus lower platform fees for launch-week sellers.</div>
        {!notifyMe?(
          <button onClick={joinWaitlist} style={{padding:"10px 22px",borderRadius:R18,background:`linear-gradient(135deg,${G},#8A6E54)`,border:"none",...ss(9,700,BK,{letterSpacing:1.5}),cursor:_p}}>
            JOIN WAITLIST
          </button>
        ):(
          <div style={ss(9,600,G,{letterSpacing:1})}>✓ You're in — we'll reach out soon</div>
        )}
      </div>

    </div>
  );
}

// ── ONBOARDING FLOW ──────────────────────────────────────────────────────────
// ── PUSH NOTIFICATION PREVIEW ─────────────────────────────────────────────────

// ── MESSAGING ─────────────────────────────────────────────────────────────────

function MessageThread({session, otherUserId, otherUsername, onClose, showToast}){
  const [messages,setMessages]=useState([]);
  const [text,setText]=useState("");
  const [loading,setLoading]=useState(true);
  const [sending,setSending]=useState(false);
  const scrollRef=useRef();
  const uid=session?.user?.id;
  const token=session?.access_token;

  useEffect(()=>{
    if(!uid||!token) return;
    loadMessages();
    // Poll every 8s for new messages
    const iv=setInterval(loadMessages,8000);
    return ()=>clearInterval(iv);
  },[]);

  useEffect(()=>{
    if(scrollRef.current) scrollRef.current.scrollTop=scrollRef.current.scrollHeight;
  },[messages]);

  const loadMessages=async()=>{
    try{
      const headers={...sbHeaders(token)};
      const [sentRes, receivedRes] = await Promise.all([
        fetch(`${SB_URL}/rest/v1/messages?sender_id=eq.${uid}&receiver_id=eq.${otherUserId}&order=created_at.asc&limit=100`,{headers}),
        fetch(`${SB_URL}/rest/v1/messages?sender_id=eq.${otherUserId}&receiver_id=eq.${uid}&order=created_at.asc&limit=100`,{headers}),
      ]);
      if(!sentRes.ok||!receivedRes.ok){
        const errTxt = await sentRes.text().catch(()=>"");
        console.error("[MessageThread] loadMessages failed",{status:sentRes.status,body:errTxt});
        setLoading(false);
        return;
      }
      const sent = await sentRes.json().catch(()=>[]);
      const received = await receivedRes.json().catch(()=>[]);
      const fetched=[...(Array.isArray(sent)?sent:[]),...(Array.isArray(received)?received:[])];
      fetched.sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));
      // Merge: keep any optimistic (temp-*) messages not yet confirmed, add new real ones
      setMessages(prev=>{
        const realIds=new Set(fetched.map(m=>m.id));
        const pending=prev.filter(m=>String(m.id).startsWith("temp-")&&!realIds.has(m.id));
        return [...fetched,...pending];
      });
      // Mark unread as read
      const unread=fetched.filter(m=>m.receiver_id===uid&&!m.read).map(m=>m.id);
      if(unread.length){
        fetch(`${SB_URL}/rest/v1/messages?id=in.(${unread.join(",")})`,{
          method:"PATCH",
          headers:{...headers,"Content-Type":"application/json","Prefer":"return=minimal"},
          body:JSON.stringify({read:true}),
        }).catch(e=>console.error("[MessageThread] mark-read failed",e));
      }
    }catch(e){ console.error("[MessageThread] loadMessages error",e); }
    setLoading(false);
  };

  const sendMessage=async()=>{
    const content=text.trim();
    if(!content||sending) return;

    // ── Preflight validation — catch bad state before hitting the network ──
    if(!uid){
      showToast("You're not signed in — refresh and try again");
      return;
    }
    if(!otherUserId){
      console.error("[MessageThread] sendMessage: otherUserId is missing",{otherUserId,otherUsername});
      showToast("Can't identify recipient — close and reopen");
      return;
    }
    if(!token){
      showToast("Session expired — please sign in again");
      return;
    }

    setSending(true);
    setText("");
    // Optimistically add to UI immediately
    const optimistic={id:`temp-${Date.now()}`,sender_id:uid,receiver_id:otherUserId,content,read:false,created_at:new Date().toISOString()};
    setMessages(prev=>[...prev,optimistic]);
    try{
      const headers={...sbHeaders(token),"Content-Type":"application/json","Prefer":"return=representation"};
      const payload={sender_id:uid,receiver_id:otherUserId,content};
      console.log("[MessageThread] sendMessage payload:",payload); // diagnostic — remove after fix confirmed
      const res=await fetch(`${SB_URL}/rest/v1/messages`,{
        method:"POST",
        headers,
        body:JSON.stringify(payload),
      });
      if(!res.ok){
        const errTxt = await res.text().catch(()=>"");
        console.error("[MessageThread] sendMessage failed",{status:res.status,body:errTxt,payload});

        // Classify the failure and show a specific toast
        let userMsg;
        if(res.status === 401) userMsg = "Session expired — sign in again";
        else if(res.status === 403) {
          // 403 from PostgREST usually = RLS policy violation
          userMsg = "Messaging not enabled — RLS policy missing";
        }
        else if(res.status === 400 || res.status === 422){
          // Bad payload — show the Supabase error if we got one
          const match = errTxt.match(/"message":"([^"]+)"/);
          userMsg = match ? `Bad request: ${match[1].slice(0,60)}` : "Message format rejected";
        }
        else if(res.status === 409){
          // Conflict — foreign key or duplicate
          if(errTxt.includes("foreign key")) userMsg = "Recipient account not found";
          else userMsg = `Conflict (409) — check console`;
        }
        else if(res.status >= 500) userMsg = `Server error ${res.status} — try again`;
        else userMsg = `Send failed (${res.status}) — check console`;

        throw new Error(userMsg);
      }
      const data = await res.json();
      // Replace optimistic with real row
      if(Array.isArray(data)&&data[0]){
        setMessages(prev=>prev.map(m=>m.id===optimistic.id?data[0]:m));
      }
      // Reload to pick up any new messages from the other side too
      setTimeout(loadMessages, 500);
    }catch(e){
      console.error("[MessageThread] sendMessage error",e);
      showToast(e.message || "Couldn't send — check console for details");
      setText(content);
      setMessages(prev=>prev.filter(m=>m.id!==optimistic.id));
    }
    setSending(false);
  };

  const getTimeStr=(ts)=>{
    if(!ts) return "";
    const d=new Date(ts);
    const now=new Date();
    const diff=(now-d)/60000;
    if(diff<1) return "just now";
    if(diff<60) return `${Math.floor(diff)}m ago`;
    if(diff<1440) return d.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});
    return d.toLocaleDateString([],{month:"short",day:"numeric"});
  };

  return(
    <div style={{..._fix,background:"#000000BB",zIndex:600,display:"flex",alignItems:"flex-start"}} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#0D0D0D",borderRadius:"0 0 24px 24px",width:"100%",maxWidth:430,margin:"0 auto",border:_2a,animation:"fadeDown 0.3s ease",maxHeight:"88vh",display:"flex",flexDirection:"column"}}>
        {/* Header */}
        <div style={{padding:"16px 20px",flexShrink:0,borderBottom:"1px solid #1A1A1A",display:"flex",alignItems:"center",gap:12}}>
          <button onClick={onClose} style={{background:"none",border:"none",cursor:_p,...ss(14,400,MD)}}>←</button>
          <div style={{flex:1}}>
            <div style={sr(16,500)}>@{otherUsername||"user"}</div>
            <div style={ss(9,400,DM,{marginTop:1})}>Direct message</div>
          </div>
          <button onClick={onClose} style={{width:30,height:30,borderRadius:"50%",background:_1a,border:_2a,...ss(13,400,MD),cursor:_p,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="sc" style={{flex:1,overflowY:"auto",padding:"16px 20px",display:"flex",flexDirection:"column",gap:10}}>
          {loading&&<div style={{textAlign:"center",padding:"32px 0",opacity:0.4}}><div style={{fontSize:20,animation:"spin 1.2s linear infinite",display:"inline-block"}}>✦</div></div>}
          {!loading&&messages.length===0&&(
            <div style={{textAlign:"center",padding:"40px 0"}}>
              <div style={{fontSize:32,marginBottom:8}}>✉</div>
              <div style={sr(14,300,DM,{fontStyle:"italic"})}>Start the conversation</div>
              <div style={ss(9,400,DM,{marginTop:4})}>Messages are only visible to you and @{otherUsername}</div>
            </div>
          )}
          {messages.map(m=>{
            const mine=m.sender_id===uid;
            return(
              <div key={m.id} style={{display:"flex",flexDirection:"column",alignItems:mine?"flex-end":"flex-start"}}>
                <div style={{
                  maxWidth:"75%",padding:"10px 14px",borderRadius:mine?"18px 18px 4px 18px":"18px 18px 18px 4px",
                  background:mine?`linear-gradient(135deg,${G},#8A6E54)`:"#1A1A1A",
                  border:mine?"none":"1px solid #2A2A2A",
                }}>
                  <div style={ss(13,400,mine?BK:"#E0D8D0",{lineHeight:1.5})}>{m.content}</div>
                </div>
                <div style={ss(8,400,DM,{marginTop:2,marginLeft:mine?0:4,marginRight:mine?4:0})}>{getTimeStr(m.created_at)}</div>
              </div>
            );
          })}
        </div>

        {/* Input */}
        <div style={{padding:"12px 16px",flexShrink:0,borderTop:"1px solid #1A1A1A",display:"flex",gap:8,alignItems:"flex-end"}}>
          <input
            value={text}
            onChange={e=>setText(e.target.value)}
            onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendMessage();}}}
            placeholder="Message..."
            style={{flex:1,background:"#111",border:"1px solid #2A2A2A",borderRadius:R18,padding:"10px 16px",...ss(13,400,MD),color:"#E0D8D0",outline:"none"}}
          />
          <button onClick={sendMessage} disabled={!text.trim()||sending}
            style={{width:40,height:40,borderRadius:"50%",background:text.trim()?`linear-gradient(135deg,${G},#8A6E54)`:"#1A1A1A",border:"none",cursor:text.trim()?_p:"default",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,transition:"background 0.2s"}}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M2 8L14 2L9 14L7.5 9.5L2 8Z" fill={text.trim()?"#0D0D0D":"#3A3028"} strokeLinejoin="round"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

function InboxPanel({session, onClose, onOpenThread, showToast}){
  const [convos,setConvos]=useState([]);
  const [loading,setLoading]=useState(true);
  const [composing,setComposing]=useState(false);
  const [searchQuery,setSearchQuery]=useState("");
  const [searchResults,setSearchResults]=useState([]);
  const [searchLoading,setSearchLoading]=useState(false);
  const searchTimer=useRef();
  const uid=session?.user?.id;
  const token=session?.access_token;

  useEffect(()=>{ if(uid&&token) loadConvos(); },[]);

  const loadConvos=async()=>{
    try{
      const headers={...sbHeaders(token)};
      // Get latest message per conversation partner
      const res=await fetch(
        `${SB_URL}/rest/v1/messages?or=(sender_id.eq.${uid},receiver_id.eq.${uid})&order=created_at.desc&limit=100`,
        {headers}
      ).then(r=>r.json()).catch(()=>[]);

      if(!Array.isArray(res)){setLoading(false);return;}

      // Group by conversation partner
      const seen=new Set();
      const latest=[];
      res.forEach(m=>{
        const partner=m.sender_id===uid?m.receiver_id:m.sender_id;
        if(!seen.has(partner)){seen.add(partner);latest.push({...m,partnerId:partner});}
      });

      // Fetch partner profiles
      if(latest.length){
        const ids=latest.map(m=>m.partnerId);
        const profiles=await fetch(
          `${SB_URL}/rest/v1/profiles?id=in.(${ids.join(",")})&select=id,username,avatar_url`,
          {headers}
        ).then(r=>r.json()).catch(()=>[]);
        const profileMap={};
        (Array.isArray(profiles)?profiles:[]).forEach(p=>{profileMap[p.id]=p;});
        setConvos(latest.map(m=>({...m,profile:profileMap[m.partnerId]||{}})));
      } else {
        setConvos([]);
      }
    }catch(e){}
    setLoading(false);
  };

  const unreadCount=convos.filter(c=>c.receiver_id===uid&&!c.read).length;

  const runSearch = (q) => {
    clearTimeout(searchTimer.current);
    if(!q.trim()){ setSearchResults([]); return; }
    setSearchLoading(true);
    searchTimer.current = setTimeout(async()=>{
      try{
        const res = await fetch(
          `${SB_URL}/rest/v1/profiles?or=(username.ilike.*${encodeURIComponent(q)}*,bio.ilike.*${encodeURIComponent(q)}*)&select=id,username,bio,avatar_url&limit=20`,
          {headers:{"Authorization":`Bearer ${token}`,"apikey":SB_KEY}}
        );
        const data = await res.json();
        // Exclude yourself from results
        const filtered = (Array.isArray(data)?data:[]).filter(u=>u.id && u.id!==uid && u.username);
        setSearchResults(filtered);
      }catch(e){ setSearchResults([]); }
      setSearchLoading(false);
    }, 250);
  };

  const openCompose = () => { setComposing(true); setSearchQuery(""); setSearchResults([]); };
  const closeCompose = () => { setComposing(false); setSearchQuery(""); setSearchResults([]); };

  return(
    <div onClick={composing ? closeCompose : onClose} style={{..._fix,background:"#000000BB",zIndex:550,display:"flex",alignItems:"flex-start"}}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#0D0D0D",borderRadius:"0 0 24px 24px",width:"100%",maxWidth:430,margin:"0 auto",border:_2a,animation:"fadeDown 0.3s ease",maxHeight:"88vh",display:"flex",flexDirection:"column"}}>
        <div style={{padding:"20px 20px 14px",flexShrink:0}}>
          <div style={{..._btwn}}>
            <div style={{flex:1,minWidth:0}}>
              {composing ? (
                <React.Fragment>
                  <div style={sr(22,400)}>New message</div>
                  <div style={ss(10,400,DM,{marginTop:3,letterSpacing:0.5})}>Search by username</div>
                </React.Fragment>
              ) : (
                <React.Fragment>
                  <div style={sr(26,400)}>Messages</div>
                  {unreadCount>0&&<div style={ss(12,400,"#CC3333",{marginTop:3})}>{unreadCount} unread</div>}
                </React.Fragment>
              )}
            </div>
            <div style={{display:"flex",gap:8,alignItems:"center",flexShrink:0}}>
              {!composing && (
                <button onClick={openCompose} aria-label="New message" style={{width:36,height:36,borderRadius:"50%",background:`linear-gradient(135deg,${G},#8A6E54)`,border:"none",display:"flex",alignItems:"center",justifyContent:"center",cursor:_p,boxShadow:`0 2px 10px ${G}33`}}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M2 3H11L14 6V12C14 12.6 13.6 13 13 13H2C1.4 13 1 12.6 1 12V4C1 3.4 1.4 3 2 3Z" stroke="#0D0D0D" strokeWidth="1.4" fill="none" strokeLinejoin="round"/>
                    <path d="M10 2L13 5" stroke="#0D0D0D" strokeWidth="1.4" strokeLinecap="round"/>
                    <circle cx="12" cy="3" r="2.2" fill="#0D0D0D"/>
                    <path d="M12 2.2V3.8M11.2 3H12.8" stroke={G} strokeWidth="1" strokeLinecap="round"/>
                  </svg>
                </button>
              )}
              <button onClick={composing ? closeCompose : onClose} style={{width:30,height:30,borderRadius:"50%",background:_1a,border:_2a,...ss(13,400,MD),cursor:_p,display:"flex",alignItems:"center",justifyContent:"center"}}>{composing ? "←" : "✕"}</button>
            </div>
          </div>
          {composing && (
            <div style={{marginTop:14,position:"relative"}}>
              <span style={{position:"absolute",left:14,top:"50%",transform:"translateY(-50%)",fontSize:13,opacity:0.4,pointerEvents:"none"}}>🔍</span>
              <input
                autoFocus
                value={searchQuery}
                onChange={e=>{const q=e.target.value; setSearchQuery(q); runSearch(q);}}
                placeholder="Search by username..."
                style={{width:"100%",boxSizing:"border-box",padding:"11px 14px 11px 38px",borderRadius:R18,background:"#111",border:`1px solid ${BR}`,color:"#E0D8D0",outline:"none",...ss(12,400,MD)}}
              />
              {searchQuery&&<button onClick={()=>{setSearchQuery("");setSearchResults([]);}} style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",color:DM,cursor:_p,fontSize:13}}>✕</button>}
            </div>
          )}
        </div>
        <div className="sc" style={{flex:1,overflowY:"auto",padding:"4px 20px 20px"}}>
          {composing ? (
            // ── New message search view ──
            <React.Fragment>
              {searchLoading && <div style={{textAlign:"center",padding:"32px 0",opacity:0.4}}><div style={{fontSize:20,animation:"spin 1.2s linear infinite",display:"inline-block"}}>✦</div></div>}
              {!searchLoading && !searchQuery && (
                <div style={{textAlign:"center",padding:"40px 16px"}}>
                  <div style={{width:48,height:48,borderRadius:"50%",background:`${G}12`,border:`1px solid ${G}33`,display:"inline-flex",alignItems:"center",justifyContent:"center",marginBottom:14,fontSize:22,color:G}}>✉</div>
                  <div style={sr(16,400,"#E8E0D4",{marginBottom:6})}>Start a new message</div>
                  <div style={ss(10,400,DM,{lineHeight:1.6,maxWidth:240,margin:"0 auto"})}>
                    Search for someone by their username to start a conversation.
                  </div>
                </div>
              )}
              {!searchLoading && searchQuery && searchResults.length === 0 && (
                <div style={{textAlign:"center",padding:"32px 0"}}>
                  <div style={ss(11,400,DM,{fontStyle:"italic"})}>No users found for "{searchQuery}"</div>
                </div>
              )}
              {searchResults.map(u=>(
                <div key={u.id} onClick={()=>{ closeCompose(); onOpenThread(u.id, u.username); }}
                  style={{display:"flex",gap:12,alignItems:"center",padding:"12px 0",borderBottom:"1px solid #1A1A1A",cursor:_p}}>
                  <div style={{width:44,height:44,borderRadius:"50%",background:`${G}22`,border:`1px solid ${G}44`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,...ss(16,600,G),overflow:"hidden"}}>
                    {u.avatar_url
                      ?<img src={u.avatar_url} style={{width:"100%",height:"100%",objectFit:"cover"}} alt=""/>
                      :<span>{(u.username||"?")[0].toUpperCase()}</span>
                    }
                  </div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={ss(12,600,"#F0EBE3")}>@{u.username}</div>
                    {u.bio && <div style={{...ss(10,400,DM),overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",marginTop:2}}>{u.bio}</div>}
                  </div>
                  <div style={ss(9,600,G,{letterSpacing:0.8,flexShrink:0})}>MESSAGE →</div>
                </div>
              ))}
            </React.Fragment>
          ) : (
            // ── Existing conversations view ──
            <React.Fragment>
          {loading&&<div style={{textAlign:"center",padding:"32px 0",opacity:0.4}}><div style={{fontSize:20,animation:"spin 1.2s linear infinite",display:"inline-block"}}>✦</div></div>}
          {!loading&&convos.length===0&&(
            <div style={{textAlign:"center",padding:"40px 0"}}>
              <div style={{fontSize:36,marginBottom:8}}>✉</div>
              <div style={sr(15,300,DM,{fontStyle:"italic",opacity:0.5})}>No messages yet</div>
              <div style={ss(9,400,DM,{marginTop:4})}>Visit someone's profile to start a conversation</div>
            </div>
          )}
          {convos.map(c=>{
            const mine=c.sender_id===uid;
            const unread=c.receiver_id===uid&&!c.read;
            return(
              <div key={c.id} onClick={()=>onOpenThread(c.partnerId,c.profile?.username)}
                style={{display:"flex",gap:12,alignItems:"center",padding:"12px 0",borderBottom:"1px solid #1A1A1A",cursor:_p}}>
                <div style={{width:44,height:44,borderRadius:"50%",background:`${G}22`,border:`1px solid ${G}44`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,...ss(16,600,G),overflow:"hidden"}}>
                  {c.profile?.avatar_url
                    ?<img src={c.profile.avatar_url} style={{width:"100%",height:"100%",objectFit:"cover"}} alt=""/>
                    :<span>{(c.profile?.username||"?")[0].toUpperCase()}</span>
                  }
                </div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{..._btwn}}>
                    <div style={ss(12,unread?700:500,unread?"#F0EBE3":MD)}>@{c.profile?.username||"user"}</div>
                    <div style={ss(9,400,DM)}>{new Date(c.created_at).toLocaleDateString([],{month:"short",day:"numeric"})}</div>
                  </div>
                  <div style={{...ss(11,400,unread?"#C0B8B0":DM),overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",marginTop:2}}>
                    {mine?"You: ":""}{c.content}
                  </div>
                </div>
                {unread&&<div style={{width:8,height:8,borderRadius:"50%",background:G,flexShrink:0}}/>}
              </div>
            );
          })}
            </React.Fragment>
          )}
        </div>
      </div>
    </div>
  );
}

function PushNotifPreview({onClose,showToast,session,notifs,setNotifs,notifsLoaded,setNotifsLoaded,setViewProfile}){
  const [loading,setLoading]=useState(!notifsLoaded);
  const [notifError,setNotifError]=useState(false);

  const markRead=(id)=>{
    setNotifs(p=>p.map(n=>n.id===id?{...n,read:true}:n));
    try{
      const r=JSON.parse((()=>{try{const s=JSON.parse(localStorage.getItem("outfix_session")||"{}");return localStorage.getItem(`outfix_read_notifs_${s?.user?.id||"anon"}`)||"{}";}catch(e){return "{}";}})() );
      r[id]=true;
      (()=>{try{const s=JSON.parse(localStorage.getItem("outfix_session")||"{}");localStorage.setItem(`outfix_read_notifs_${s?.user?.id||"anon"}`,JSON.stringify(r));}catch(e){}})();
    }catch(e){}
  };
  const markAll=()=>{
    setNotifs(p=>p.map(n=>({...n,read:true})));
    try{
      const r=JSON.parse((()=>{try{const s=JSON.parse(localStorage.getItem("outfix_session")||"{}");return localStorage.getItem(`outfix_read_notifs_${s?.user?.id||"anon"}`)||"{}";}catch(e){return "{}";}})() );
      notifs.forEach(n=>{r[n.id]=true;});
      (()=>{try{const s=JSON.parse(localStorage.getItem("outfix_session")||"{}");localStorage.setItem(`outfix_read_notifs_${s?.user?.id||"anon"}`,JSON.stringify(r));}catch(e){}})();
    }catch(e){}
  };
  const unread=notifs.filter(n=>!n.read).length;

  const typeColor={like:"#C46080",follow:"#6090C4",suggest:"#B090C4",price_drop:"#6090C4",new_offer:"#C4A060",trend_match:"#B090C4",dupe_alert:"#C08040",booking:"#60A870",market:"#6090C4",ootd_like:"#C46080"};
  const typeBg={like:"#1A0810",follow:"#0A0F1A",suggest:"#140F1A",price_drop:"#0A0F1A",new_offer:"#1A1308",trend_match:"#140F1A",ootd_like:"#1A0810",dupe_alert:"#1A100A",booking:"#0A1A0A",market:"#0A0F1A"};

  useEffect(()=>{
    if(notifsLoaded) return; // already loaded — don't refetch
    if(!session?.access_token){ setLoading(false); setNotifsLoaded(true); return; }
    loadRealNotifs();
  },[]);

  const loadRealNotifs = async () => {
    setLoading(true);
    try {
      const uid = session.user?.id;
      const headers = {...sbHeaders(session.access_token)};

      // 1. Likes on my feed events
      const myEvents = await fetch(`${SB_URL}/rest/v1/feed_events?user_id=eq.${uid}&select=id,outfit_name,item_name,like_count,created_at&order=created_at.desc&limit=20`,{headers}).then(r=>r.json()).catch(()=>[]);

      // 2. New followers (people who followed me)
      const followers = await fetch(`${SB_URL}/rest/v1/follows?following_id=eq.${uid}&select=follower_id,created_at&order=created_at.desc&limit=20`,{headers}).then(r=>r.json()).catch(()=>[]);

      // 3. Who I follow
      const myFollowing = await fetch(`${SB_URL}/rest/v1/follows?follower_id=eq.${uid}&select=following_id`,{headers}).then(r=>r.json()).catch(()=>[]);
      const myFollowingIds = (Array.isArray(myFollowing)?myFollowing:[]).map(f=>f.following_id);

      // 4. Suggested: people who follow 5+ of the same people I follow
      let suggestNotifs = [];
      if(myFollowingIds.length >= 5){
        const allFollowers = await fetch(`${SB_URL}/rest/v1/follows?following_id=in.(${myFollowingIds.slice(0,10).join(",")})&select=follower_id`,{headers}).then(r=>r.json()).catch(()=>[]);
        const counts = {};
        (Array.isArray(allFollowers)?allFollowers:[]).forEach(f=>{
          if(f.follower_id !== uid && !myFollowingIds.includes(f.follower_id)){
            counts[f.follower_id] = (counts[f.follower_id]||0)+1;
          }
        });
        const topSuggest = Object.entries(counts).filter(([,c])=>c>=5).sort((a,b)=>b[1]-a[1]).slice(0,3);
        if(topSuggest.length){
          const ids = topSuggest.map(([id])=>id);
          const profiles = await fetch(`${SB_URL}/rest/v1/profiles?id=in.(${ids.join(",")})&select=id,username`,{headers}).then(r=>r.json()).catch(()=>[]);
          suggestNotifs = profiles.map(p=>({
            id:`sug-${p.id}`, type:"suggest", read:false, icon:"👤",
            title:`You may know`,
            username: p.username||null,
            userId: p.id,
            body:`${counts[p.id]} mutual connections`,
            time:"Suggested", urgent:false,
          }));
        }
      }

      // Fetch follower profiles
      const followerIds = (Array.isArray(followers)?followers:[]).map(f=>f.follower_id).filter(Boolean);
      let followerProfiles = {};
      if(followerIds.length){
        const profs = await fetch(`${SB_URL}/rest/v1/profiles?id=in.(${followerIds.slice(0,10).join(",")})&select=id,username`,{headers}).then(r=>r.json()).catch(()=>[]);
        (Array.isArray(profs)?profs:[]).forEach(p=>{ followerProfiles[p.id]=p; });
      }

      const getTimeAgo = (ts) => {
        if(!ts) return "";
        const m = Math.floor((Date.now()-new Date(ts).getTime())/60000);
        if(m<1) return "just now"; if(m<60) return `${m}m ago`;
        const h=Math.floor(m/60); if(h<24) return `${h}h ago`;
        return `${Math.floor(h/24)}d ago`;
      };

      // Restore read state from localStorage
      let readIds = {};
      try{ readIds=JSON.parse((()=>{try{const s=JSON.parse(localStorage.getItem("outfix_session")||"{}");return localStorage.getItem(`outfix_read_notifs_${s?.user?.id||"anon"}`)||"{}";}catch(e){return "{}";}})() ); }catch(e){}

      // Build like notifications
      const likeNotifsTs = (Array.isArray(myEvents)?myEvents:[])
        .filter(e=>(e.like_count||0)>0)
        .map(e=>({
          id:`like-${e.id}`, type:"like", read:readIds[`like-${e.id}`]||false, icon:"♥",
          title:`Your post got ${e.like_count} like${e.like_count>1?"s":""}`,
          body:`"${e.outfit_name||e.item_name||"post"}"`,
          time: getTimeAgo(e.created_at), urgent:false, _ts:new Date(e.created_at||0).getTime(),
        }));

      // Build follow notifications
      const followNotifsTs = (Array.isArray(followers)?followers:[]).slice(0,5).map(f=>({
        id:`follow-${f.follower_id}`, type:"follow", read:readIds[`follow-${f.follower_id}`]||false, icon:"👤",
        title:`followed you`,
        username: followerProfiles[f.follower_id]?.username||null,
        userId: f.follower_id,
        body:"Tap name to view their closet",
        time: getTimeAgo(f.created_at), urgent:false, _ts:new Date(f.created_at||0).getTime(),
      }));

      const allNotifs = [...likeNotifsTs, ...followNotifsTs, ...suggestNotifs]
        .sort((a,b)=> (b._ts||0) - (a._ts||0));

      setNotifs(allNotifs.length ? allNotifs : []);
    } catch(e){ setNotifError(true); }
    setLoading(false);
    setNotifsLoaded(true);
  };

  return(
    <div onClick={onClose} style={{..._fix,background:"#000000BB",zIndex:90,display:"flex",alignItems:"flex-start"}}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#0D0D0D",borderRadius:"0 0 24px 24px",width:"100%",maxWidth:430,margin:"0 auto",border:_2a,animation:"fadeDown 0.3s ease",maxHeight:"88vh",display:"flex",flexDirection:"column"}}>

        <div style={{padding:"20px 20px 14px",flexShrink:0}}>
          <div style={{..._btwn}}>
            <div>
              <div style={sr(26,400)}>Notifications</div>
              {unread>0&&<div style={ss(12,400,"#CC3333",{marginTop:3})}>{unread} unread</div>}
            </div>
            <div style={{..._row,gap:10}}>
              {unread>0&&<button onClick={markAll} style={{...ss(9,600,G,{letterSpacing:0.8}),background:"none",border:"none",cursor:_p}}>MARK ALL READ</button>}
              <button onClick={onClose} style={{width:30,height:30,borderRadius:"50%",background:_1a,border:_2a,...ss(13,400,MD),cursor:_p,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
            </div>
          </div>
        </div>

        <div className="sc" style={{flex:1,overflowY:"auto",padding:"4px 20px 20px"}}>
          {loading&&<div style={{textAlign:"center",padding:"32px 0",opacity:0.4}}><div style={{fontSize:20,animation:"spin 1.2s linear infinite",display:"inline-block"}}>✦</div></div>}
          {!loading&&notifError&&(
            <div style={{textAlign:"center",padding:"40px 16px",display:"flex",flexDirection:"column",alignItems:"center",gap:10}}>
              <div style={{fontSize:28}}>⚡</div>
              <div style={sr(15,400,"#E8E0D4")}>Couldn't load notifications.</div>
              <button onClick={()=>{setNotifError(false);setLoading(true);loadRealNotifs();}} style={{padding:"8px 20px",borderRadius:R18,background:`${G}22`,border:`1px solid ${G}44`,...ss(9,600,G,{letterSpacing:1}),cursor:_p}}>RETRY</button>
            </div>
          )}
          {!loading&&!notifError&&notifs.length===0&&(
            <div style={{textAlign:"center",padding:"48px 24px"}}>
              <div style={{width:52,height:52,borderRadius:"50%",background:`${G}12`,border:`1px solid ${G}33`,display:"inline-flex",alignItems:"center",justifyContent:"center",marginBottom:14}}>
                <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                  <path d="M11 2C11 2 7 3.5 7 9V14H15V9C15 3.5 11 2 11 2Z" stroke={G} strokeWidth="1.4" strokeLinejoin="round" fill="none"/>
                  <path d="M5 14H17" stroke={G} strokeWidth="1.4" strokeLinecap="round"/>
                  <path d="M9.5 14C9.5 15.4 10.2 16 11 16C11.8 16 12.5 15.4 12.5 14" stroke={G} strokeWidth="1.3" strokeLinecap="round" fill="none"/>
                </svg>
              </div>
              <div style={sr(17,400,"#E8E0D4",{marginBottom:6})}>No notifications yet</div>
              <div style={ss(10,400,DM,{lineHeight:1.6,maxWidth:260,margin:"0 auto"})}>
                You'll see updates here when someone likes your outfit, follows you, or when AI finds wardrobe insights.
              </div>
            </div>
          )}
          {notifs.map(n=>{
            const col=typeColor[n.type]||G;
            const bg=typeBg[n.type]||"#141414";
            const hasProfile = (n.type==="follow"||n.type==="suggest") && (n.userId||n.username);
            return(
              <div key={n.id}
                style={{background:n.read?"#111":bg,border:`1px solid ${n.read?"#1E1E1E":col+"44"}`,borderRadius:R14,padding:"12px 14px",marginBottom:8,position:"relative",opacity:n.read?0.65:1,transition:"all 0.2s"}}>
                <div style={{display:"flex",gap:10,alignItems:"flex-start"}}>
                  {/* Icon */}
                  <div style={{width:36,height:36,borderRadius:12,background:`${col}22`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:17,flexShrink:0}}>{n.icon}</div>
                  {/* Content */}
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{..._btwnS,marginBottom:3}}>
                      <div style={{flex:1,paddingRight:8,lineHeight:1.4}}>
                        {/* Clickable username for follow/suggest */}
                        {hasProfile ? (
                          <span>
                            <span
                              onClick={()=>{ if(setViewProfile&&n.userId) setViewProfile({userId:n.userId,username:n.username}); markRead(n.id); onClose(); }}
                              style={{fontFamily:"'Montserrat',sans-serif",fontSize:11,fontWeight:700,color:col,cursor:_p,textDecoration:"underline"}}>
                              @{n.username||"user"}
                            </span>
                            <span style={ss(11,n.read?400:500,n.read?MD:"#E0D8D0")}> {n.title}</span>
                          </span>
                        ) : (
                          <span style={ss(11,n.read?400:600,n.read?MD:"#E0D8D0")}>{n.title}</span>
                        )}
                      </div>
                      <div style={ss(9,400,DM,{flexShrink:0})}>{n.time}</div>
                    </div>
                    <div style={ss(10,400,"#8A8078",{lineHeight:1.5})}>{n.body}</div>
                  </div>
                  {/* Read checkbox */}
                  <button
                    onClick={e=>{ e.stopPropagation(); markRead(n.id); }}
                    title="Mark as read"
                    style={{width:20,height:20,borderRadius:4,flexShrink:0,cursor:_p,border:`1.5px solid ${n.read?"#2A2A2A":col+"88"}`,background:n.read?"#1A1A1A":"transparent",display:"flex",alignItems:"center",justifyContent:"center",marginTop:1}}>
                    {n.read&&<div style={{width:10,height:10,borderRadius:2,background:"#3A3A3A"}}/>}
                    {!n.read&&<div style={{width:8,height:8,borderRadius:"50%",background:col}}/>}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── NOTIF TOGGLES (extracted so hooks are at component top level) ─────────────
function NotifToggles({CD,BR,MD,DM,G}){
  const [prefs,setPrefs]=useState({
    "Push Notifications":true,"Weekly Style Report":true,
    "Market Suggestions":false,"Trend Alerts":true,
  });
  const descs={
    "Push Notifications":"Get alerts for offers, price drops & trends",
    "Weekly Style Report":"AI summary of your wardrobe activity",
    "Market Suggestions":"Personalized listings based on your style",
    "Trend Alerts":"Be notified when runway trends match your closet",
  };
  return(
    <React.Fragment>
      {Object.entries(prefs).map(([title,on])=>(
        <div key={title} style={{background:CD,border:`1px solid ${BR}`,borderRadius:R14,padding:"14px 16px",marginBottom:10,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div style={{flex:1,paddingRight:12}}>
            <div style={ss(11,600,MD)}>{title}</div>
            <div style={ss(9,400,DM,{marginTop:3})}>{descs[title]}</div>
          </div>
          <button onClick={()=>setPrefs(p=>({...p,[title]:!p[title]}))}
            style={{width:46,height:26,borderRadius:13,background:on?G:"#2A2A2A",border:"none",position:"relative",cursor:_p,transition:"background 0.3s",flexShrink:0}}>
            <div style={{width:18,height:18,borderRadius:"50%",background:"#FFF",position:"absolute",top:4,left:on?24:4,transition:"left 0.3s",boxShadow:"0 1px 3px #0006"}}/>
          </button>
        </div>
      ))}
    </React.Fragment>
  );
}

// ── SETTINGS / PROFILE TAB ────────────────────────────────────────────────────

function computeStats(items, outfits=[]){ return { items:items.length, outfits:outfits.length, listed:items.filter(i=>i.forSale).length, sold:0, followers:0, usedMirror:true, usedAI:true, usedPlanner:true }; }


function SettingsTab({currentPlan,setShowPricing,showToast,items,outfits=[],userName="",userEmail="",onSignOut,userProfile={},saveProfile,styleProfile={},saveStyleProfile,onViewOwnProfile,session,autoOpenQuiz,onQuizOpened,onNavigateToAIRules,onBatchBgRemoval,batchBgProgress,onResetBgProgress}){
  const [avatarUploading,setAvatarUploading]=useState(false);
  const [showMore,setShowMore]=useState(false);
  const [editField,setEditField]=useState(null);
  const [editVal,setEditVal]=useState("");
  const avatarInputRef=useRef(null);
  const totalValue=items.reduce((s,i)=>s+(i.price||0),0);
  const totalResale=items.reduce((s,i)=>s+calcResale(i),0);
  const stats=computeStats(items,outfits);

  const uploadAvatar=async(file)=>{
    if(!file||!session?.access_token) return;
    setAvatarUploading(true);
    try{
      // Read file as data URL
      const dataUrl = await new Promise((resolve,reject)=>{
        const reader=new FileReader();
        reader.onload=ev=>resolve(ev.target.result);
        reader.onerror=reject;
        reader.readAsDataURL(file);
      });

      // OPTIMISTIC: show the new avatar immediately using the data URL
      // so user sees change before the network upload completes
      if(saveProfile) await saveProfile({avatar_url:dataUrl});

      // Upload to Supabase Storage
      const userId=session.user?.id;
      const url=await sb.uploadPhoto(session.access_token,userId,dataUrl);

      // Replace local+DB value with the real hosted URL
      if(url && url!==dataUrl){
        if(saveProfile) await saveProfile({avatar_url:url});
      }

      showToast("Profile photo updated \u2746");
    }catch(e){
      console.error("uploadAvatar error:",e);
      showToast("Upload failed — try again");
    }
    setAvatarUploading(false);
  };

  const openQuiz=()=>{
    if(typeof setQuizDraft==="function") setQuizDraft({aesthetic:styleProfile.aesthetic||[],occasions:styleProfile.occasions||[],fitPref:styleProfile.fitPref||[],avoidPairings:styleProfile.avoidPairings||[],styleIcons:styleProfile.styleIcons||"",colorPalette:styleProfile.colorPalette||""});
    if(typeof setQuizStep==="function") setQuizStep(0);
    if(typeof setShowQuiz==="function") setShowQuiz(true);
  };

  const openEdit=(field,val)=>{ setEditField(field); setEditVal(val||""); };
  const confirmEdit=async()=>{
    if(!editField) return;
    await saveProfile({[editField]:editVal.trim()});
    showToast("Updated \u2746");
    setEditField(null);
  };

  const planLabel = currentPlan==="free"?"Free Plan":currentPlan==="plus"?"Outfix+":"Outfix Pro";
  const learnedCount = (styleProfile.learnedLoves?.length||0)+(styleProfile.learnedDislikes?.length||0);

  return(
    <div className="fu" style={{padding:"0 0 40px"}}>

      {/* ── ZONE 1: IDENTITY ── */}
      <div style={{padding:"24px 20px 0",display:"flex",flexDirection:"column",alignItems:"center",textAlign:"center"}}>
        {/* Avatar */}
        <input ref={avatarInputRef} type="file" accept="image/*" style={{display:"none"}} onChange={e=>uploadAvatar(e.target.files?.[0])}/>
        <div style={{position:"relative",marginBottom:14,cursor:_p}} onClick={()=>avatarInputRef.current?.click()}>
          <div style={{width:84,height:84,borderRadius:"50%",background:`linear-gradient(135deg,${G},#8A6E54)`,display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden",border:`2px solid ${G}33`,boxShadow:`0 0 0 4px #0D0D0D, 0 0 0 6px ${G}22`}}>
            {userProfile.avatar_url
              ? <img src={userProfile.avatar_url} style={{width:"100%",height:"100%",objectFit:"cover"}} alt="avatar"/>
              : <span style={{fontSize:34,color:"#0D0D0D"}}>✦</span>
            }
          </div>
          <div style={{position:"absolute",bottom:2,right:2,width:24,height:24,borderRadius:"50%",background:G,border:"2px solid #0D0D0D",display:"flex",alignItems:"center",justifyContent:"center"}}>
            {avatarUploading
              ? <span style={{fontSize:9,animation:"spin 1.2s linear infinite",display:"inline-block",color:"#0D0D0D"}}>✦</span>
              : <span style={{fontSize:11}}>📷</span>
            }
          </div>
        </div>

        {/* Name — tap to edit */}
        {editField==="username" ? (
          <div style={{width:"100%",maxWidth:280,marginBottom:8}}>
            <input autoFocus value={editVal} onChange={e=>setEditVal(e.target.value)}
              onKeyDown={e=>{if(e.key==="Enter")confirmEdit();if(e.key==="Escape")setEditField(null);}}
              onBlur={confirmEdit}
              placeholder="your_username"
              style={{width:"100%",boxSizing:"border-box",background:"#111",border:`1.5px solid ${G}`,borderRadius:12,padding:"10px 14px",textAlign:"center",...sr(20,400,G),color:G,outline:"none"}}
            />
          </div>
        ) : (
          <div onClick={()=>openEdit("username",userProfile.username||"")} style={{cursor:_p,marginBottom:4,display:"flex",alignItems:"center",gap:6}}>
            <div style={sr(22,400,G)}>{userProfile.username?`@${userProfile.username}`:userName||"Add username"}</div>
            <div style={{...ss(10,400,DM),opacity:0.5}}>✎</div>
          </div>
        )}
        <div style={ss(10,400,DM,{marginBottom:6})}>{userEmail}</div>

        {/* Plan badge */}
        <div onClick={currentPlan==="free"?()=>setShowPricing(true):undefined}
          style={{display:"inline-flex",alignItems:"center",gap:6,background:currentPlan==="free"?"#1A1A1A":`${G}18`,border:currentPlan==="free"?"1px solid #2A2A2A":`1px solid ${G}44`,borderRadius:R18,padding:"5px 14px",cursor:currentPlan==="free"?_p:"default",marginBottom:20}}>
          <span style={{fontSize:10,color:currentPlan==="free"?"#4A4038":G}}>✦</span>
          <span style={ss(9,600,currentPlan==="free"?DM:G,{letterSpacing:1})}>{planLabel.toUpperCase()}</span>
          {currentPlan==="free"&&<span style={ss(9,400,"#A08060")}>· Upgrade →</span>}
        </div>

        {/* Quick stats row */}
        <div style={{display:"flex",gap:0,width:"100%",maxWidth:320,background:"#111",borderRadius:R14,border:"1px solid #1E1E1E",overflow:"hidden",marginBottom:24}}>
          {[[items.length,"Pieces"],[`$${totalValue.toLocaleString()}`,"Value"],[`$${totalResale.toLocaleString()}`,"Resale"]].map(([v,l],i)=>(
            <div key={l} style={{flex:1,textAlign:"center",padding:"12px 8px",borderRight:i<2?"1px solid #1E1E1E":"none"}}>
              <div style={sr(17,400,G)}>{v}</div>
              <div style={ss(8,600,DM,{letterSpacing:1,marginTop:2})}>{l.toUpperCase()}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── ZONE 2: STYLE PROFILE ── */}
      <div style={{padding:"0 16px",marginBottom:10}}>
        <div onClick={openQuiz} style={{background:styleProfile.quizCompleted?"linear-gradient(135deg,#0A1A0A,#0F200F)":"linear-gradient(135deg,#1A1408,#221A08)",border:styleProfile.quizCompleted?"1px solid #2A4A2A":`1px solid ${G}44`,borderRadius:R14,padding:"16px",cursor:_p,display:"flex",gap:12,alignItems:"flex-start"}}>
          <div style={{width:42,height:42,borderRadius:12,background:styleProfile.quizCompleted?"#1A3A1A":`${G}18`,border:styleProfile.quizCompleted?"1px solid #4A8A4A":`1px solid ${G}33`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>
            {styleProfile.quizCompleted?"✓":"✦"}
          </div>
          <div style={{flex:1,minWidth:0}}>
            <div style={ss(11,600,styleProfile.quizCompleted?"#80C880":G,{marginBottom:3})}>
              {styleProfile.quizCompleted?"Your style profile":"Set up your style profile"}
            </div>
            {styleProfile.quizCompleted ? (
              <React.Fragment>
                <div style={ss(10,400,DM,{lineHeight:1.6,marginBottom:learnedCount>0?4:0})}>
                  {(styleProfile.aesthetic||[]).slice(0,3).join(" · ")||"Tap to update your aesthetic"}
                  {styleProfile.colorPalette?` · ${styleProfile.colorPalette}`:""}
                </div>
                {learnedCount>0&&(
                  <div onClick={e=>{e.stopPropagation();if(onNavigateToAIRules) onNavigateToAIRules();}}
                    style={{display:"flex",alignItems:"center",justifyContent:"space-between",background:`${G}0D`,border:`1px solid ${G}22`,borderRadius:8,padding:"5px 10px",marginTop:2,cursor:_p}}>
                    <div style={ss(9,400,G,{letterSpacing:0.3})}>✦ AI has learned {learnedCount} style rules</div>
                    <div style={ss(9,400,DM,{letterSpacing:0.5})}>see rules ›</div>
                  </div>
                )}
              </React.Fragment>
            ) : (
              <div style={ss(10,400,DM,{lineHeight:1.6})}>Teach the AI your aesthetic — outfit suggestions get dramatically better</div>
            )}
          </div>
          <div style={ss(14,300,DM)}>›</div>
        </div>
      </div>

      {/* ── ZONE 3: MORE SETTINGS (collapsed) ── */}
      <div style={{padding:"0 16px"}}>
        <button onClick={()=>setShowMore(m=>!m)}
          style={{width:"100%",padding:"12px 16px",borderRadius:R14,background:"#111",border:"1px solid #1E1E1E",display:"flex",alignItems:"center",justifyContent:"space-between",cursor:_p,marginBottom:showMore?12:0}}>
          <span style={ss(10,600,DM,{letterSpacing:1})}>MORE SETTINGS</span>
          <span style={{...ss(12,400,DM),transform:showMore?"rotate(90deg)":"rotate(0deg)",transition:"transform .2s"}}>›</span>
        </button>

        {showMore&&(
          <div style={{display:"flex",flexDirection:"column",gap:8}}>

            {/* Profile details */}
            <div style={{background:"#111",borderRadius:R14,border:"1px solid #1E1E1E",overflow:"hidden"}}>
              <div style={ss(8,600,DM,{letterSpacing:1.5,padding:"12px 14px 6px"})}>PROFILE DETAILS</div>
              {[
                {key:"username",label:"Username",placeholder:"your_username"},
                {key:"bio",label:"Bio",placeholder:"A short line about your style"},
                {key:"location",label:"Location",placeholder:"New York, NY"},
              ].map(({key,label,placeholder},i,arr)=>(
                <div key={key} style={{borderTop:i>0?"1px solid #1A1A1A":"none"}}>
                  {editField===key ? (
                    <div style={{padding:"10px 14px"}}>
                      <input autoFocus value={editVal} onChange={e=>setEditVal(e.target.value)}
                        onKeyDown={e=>{if(e.key==="Enter")confirmEdit();if(e.key==="Escape")setEditField(null);}}
                        placeholder={placeholder}
                        style={{width:"100%",boxSizing:"border-box",background:"#0D0D0D",border:`1px solid ${G}55`,borderRadius:8,padding:"8px 12px",...ss(11,400,MD),color:"#E8E0D4",outline:"none",marginBottom:8}}/>
                      <div style={{display:"flex",gap:6}}>
                        <button onClick={()=>setEditField(null)} style={{flex:1,padding:"7px",borderRadius:8,background:"#1A1A1A",border:"1px solid #2A2A2A",...ss(8,600,DM,{letterSpacing:1}),cursor:_p}}>CANCEL</button>
                        <button onClick={confirmEdit} style={{flex:2,padding:"7px",borderRadius:8,background:`linear-gradient(135deg,${G},#8A6E54)`,border:"none",...ss(8,600,BK,{letterSpacing:1}),cursor:_p}}>SAVE</button>
                      </div>
                    </div>
                  ):(
                    <div onClick={()=>openEdit(key,userProfile[key]||"")} style={{padding:"12px 14px",display:"flex",justifyContent:"space-between",alignItems:"center",cursor:_p}}>
                      <div>
                        <div style={ss(9,500,MD,{marginBottom:1})}>{label}</div>
                        <div style={ss(10,400,userProfile[key]?MD:DM)}>{userProfile[key]||placeholder}</div>
                      </div>
                      <div style={ss(10,400,DM)}>✎</div>
                    </div>
                  )}
                </div>
              ))}
            </div>



            {/* Privacy */}
            <div style={{background:"#111",borderRadius:R14,border:"1px solid #1E1E1E",overflow:"hidden"}}>
              <div style={ss(8,600,DM,{letterSpacing:1.5,padding:"12px 14px 6px"})}>YOUR STYLE, YOUR RULES</div>
              {[
                {key:"closet_public",label:"Closet visible to followers",icon:"👗"},
                {key:"outfits_public",label:"Outfits visible to followers",icon:"✦"},
              ].map(({key,label,icon},i)=>{
                const isOn=userProfile[key]!==false;
                return(
                  <div key={key} style={{borderTop:i>0?"1px solid #1A1A1A":"none",padding:"12px 14px",display:"flex",alignItems:"center",gap:10}}>
                    <span style={{fontSize:14,flexShrink:0}}>{icon}</span>
                    <div style={{flex:1,...ss(10,400,MD)}}>{label}</div>
                    <button onClick={()=>{saveProfile({[key]:!isOn});showToast(`Updated \u2746`);}}
                      style={{flexShrink:0,width:44,height:24,borderRadius:12,border:"none",cursor:_p,position:"relative",background:isOn?`linear-gradient(135deg,${G},#8A6E54)`:"#2A2A2A",transition:"background 0.2s"}}>
                      <div style={{position:"absolute",top:2,left:isOn?22:2,width:20,height:20,borderRadius:"50%",background:"#FFF",transition:"left 0.2s",boxShadow:"0 1px 3px #0006"}}/>
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Notifications */}
            <NotifToggles CD={CD} BR={BR} MD={MD} DM={DM} G={G}/>

            {/* ── Closet Cleanup ── */}
            {onBatchBgRemoval&&(
              <div style={{background:"linear-gradient(135deg,#141008,#1A1408)",borderRadius:R14,padding:"14px 16px",border:"1px solid rgba(196,168,130,0.15)",marginBottom:6}}>
                <div style={ss(8,700,G,{letterSpacing:1.5,marginBottom:4})}>CLOSET CLEANUP</div>
                <div style={ss(10,400,DM,{lineHeight:1.55,marginBottom:12})}>
                  Automatically remove backgrounds from all your existing closet photos — making every item look clean and professional.
                </div>
                {batchBgProgress?(
                  <div>
                    {/* Progress bar */}
                    <div style={{height:4,background:"#1A1A1A",borderRadius:2,marginBottom:8,overflow:"hidden"}}>
                      <div style={{height:"100%",borderRadius:2,background:batchBgProgress.failed===batchBgProgress.total&&!batchBgProgress.running?"#C4464680":`linear-gradient(90deg,${G},#8A6E54)`,width:`${Math.round((batchBgProgress.done/batchBgProgress.total)*100)}%`,transition:"width 0.4s ease"}}/>
                    </div>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:batchBgProgress.lastError&&!batchBgProgress.running?8:0}}>
                      <div style={ss(9,400,DM)}>
                        {batchBgProgress.running
                          ? `Processing ${batchBgProgress.done} of ${batchBgProgress.total}…`
                          : `Done — ${batchBgProgress.total - batchBgProgress.failed} cleaned${batchBgProgress.failed>0?`, ${batchBgProgress.failed} skipped`:""}`
                        }
                      </div>
                      {batchBgProgress.running&&(
                        <span style={{fontSize:10,color:G,animation:"spin 1.2s linear infinite",display:"inline-block"}}>✦</span>
                      )}
                    </div>
                    {/* Diagnostic error + retry (only after run completes with failures) */}
                    {!batchBgProgress.running && batchBgProgress.failed > 0 && batchBgProgress.lastError && (
                      <div style={{marginTop:10,padding:"10px 12px",borderRadius:10,background:"#1A0F0A",border:"1px solid #3A1F14"}}>
                        <div style={ss(8,700,"#C47060",{letterSpacing:1,marginBottom:4})}>DIAGNOSTIC</div>
                        <div style={ss(9,400,"#A08070",{lineHeight:1.5,fontFamily:"monospace"})}>
                          {(() => {
                            const [stage, msg] = batchBgProgress.lastError.split(":");
                            if(stage === "fetch") return "Image downloads failed. Check Supabase Storage CORS settings and that photos are publicly accessible.";
                            if(stage === "remove_bg" && msg.includes("402")) return "remove.bg API quota exceeded. Upgrade or wait for monthly reset.";
                            if(stage === "remove_bg" && msg.includes("429")) return "Rate limited. Wait a few minutes and retry.";
                            if(stage === "remove_bg" && msg.includes("401")) return "remove.bg API key invalid. Check REMOVE_BG_API_KEY in Vercel env.";
                            if(stage === "remove_bg") return `remove.bg returned ${msg}. Check console for response body.`;
                            if(stage === "upload") return "Storage upload failed. Check Supabase Storage bucket + RLS policies.";
                            if(stage === "save") return "DB save failed. Check console for details.";
                            return `Unknown error (${batchBgProgress.lastError})`;
                          })()}
                        </div>
                        <button onClick={()=>{onResetBgProgress&&onResetBgProgress();}} style={{marginTop:8,padding:"6px 12px",borderRadius:8,background:"#2A1F14",border:"1px solid #3A2F24",...ss(8,600,G,{letterSpacing:0.8}),cursor:_p}}>
                          RESET · TRY AGAIN
                        </button>
                      </div>
                    )}
                  </div>
                ):(
                  <button onClick={onBatchBgRemoval}
                    disabled={!items.filter(i=>i.sourceImage).length}
                    style={{width:"100%",padding:"10px",borderRadius:11,background:`linear-gradient(135deg,${G},#8A6E54)`,border:"none",...ss(9,700,"#0D0D0D",{letterSpacing:1}),cursor:_p,opacity:items.filter(i=>i.sourceImage).length?1:0.4}}>
                    CLEAN {items.filter(i=>i.sourceImage).length} PHOTOS
                  </button>
                )}
              </div>
            )}

            {/* Sign out + delete */}
            {onSignOut&&(
              <button onClick={onSignOut} style={{width:"100%",padding:"13px",borderRadius:R14,background:"none",border:"1px solid #2A2A2A",...ss(10,600,DM,{letterSpacing:1}),cursor:_p}}>
                Sign Out
              </button>
            )}
            <button onClick={()=>showToast("Account deletion requested \u2746")} style={{width:"100%",padding:"13px",borderRadius:R14,background:"#1A0808",border:"1px solid #3A1A1A",...ss(10,600,"#C06060",{letterSpacing:1}),cursor:_p}}>
              Delete Account
            </button>

          </div>
        )}
      </div>

    </div>
  );
}


// ── CAPSULE COLLECTIONS ────────────────────────────────────────────────────────

// ── VAULT ────────────────────────────────────────────────────────────────────
function AddEventPage({newLabel,setNewLabel,newOccasion,newEmoji,setNewOccasion,setNewEmoji,newDate,setNewDate,occasionEmojis,onCancel,onSave}){
  const today=new Date();
  const [curMonth,setCurMonth]=useState(new Date(today.getFullYear(),today.getMonth(),1));
  const y=curMonth.getFullYear(), m=curMonth.getMonth();
  const daysInMonth=new Date(y,m+1,0).getDate();
  const firstDow=new Date(y,m,1).getDay();
  const monthLabel=curMonth.toLocaleString("default",{month:"long",year:"numeric"});
  const prevMonth=()=>{const d=new Date(curMonth);d.setMonth(d.getMonth()-1);setCurMonth(d);};
  const nextMonth=()=>{const d=new Date(curMonth);d.setMonth(d.getMonth()+1);setCurMonth(d);};
  const toKey=(d)=>`${y}-${String(m+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
  const todayKey=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;
  const parseSelected=()=>{
    if(!newDate) return null;
    const parts=newDate.replace(/^[A-Za-z]+\s/,"").split(" ");
    const months=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const mIdx=months.findIndex(ms=>parts[0]?.startsWith(ms));
    const d=parseInt(parts[1]);
    if(mIdx>=0&&!isNaN(d)) return `${today.getFullYear()}-${String(mIdx+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
    return null;
  };
  const selectedKey=parseSelected();
  const emitDate=(key)=>{
    const [,km,kd]=key.split("-").map(Number);
    const months=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const dateObj=new Date(y,km-1,kd);
    const wd=dateObj.toLocaleDateString("en-US",{weekday:"short"});
    setNewDate(`${wd} ${months[km-1]} ${kd}`);
  };

  return(
    <div className="fu" style={{padding:"16px 24px 100px"}}>
      {/* Header */}
      <div style={{..._btwn,marginBottom:24}}>
        <div>
          <div style={sr(22,400)}>Add Event</div>
          <div style={ss(9,400,DM,{letterSpacing:1,marginTop:2})}>PLAN YOUR UPCOMING OCCASION</div>
        </div>
        <button onClick={onCancel} style={{width:34,height:34,borderRadius:"50%",background:_1a,border:_2a,cursor:_p,...ss(18,300,MD),display:"flex",alignItems:"center",justifyContent:"center"}}>×</button>
      </div>

      {/* Event name */}
      <div style={ss(8,600,DM,{letterSpacing:1.5,marginBottom:8})}>EVENT NAME</div>
      <input value={newLabel} onChange={e=>setNewLabel(e.target.value)}
        placeholder="e.g. Birthday Dinner, Work Presentation..."
        style={{width:"100%",boxSizing:"border-box",background:_1a,border:_2a,borderRadius:12,padding:"12px 14px",...ss(13,400,MD),color:"#C0B8B0",marginBottom:24,outline:"none"}}/>

      {/* Occasion */}
      <div style={ss(8,600,DM,{letterSpacing:1.5,marginBottom:10})}>OCCASION</div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:28}}>
        {Object.keys(occasionEmojis).map(occ=>(
          <button key={occ} onClick={()=>{setNewOccasion(occ);setNewEmoji(occasionEmojis[occ]);}}
            style={{padding:"8px 16px",borderRadius:R18,background:newOccasion===occ?G:_1a,border:newOccasion===occ?"none":_2a,...ss(10,newOccasion===occ?600:400,newOccasion===occ?BK:DM,{letterSpacing:0.5}),cursor:_p}}>
            {occasionEmojis[occ]} {occ}
          </button>
        ))}
      </div>

      {/* Calendar */}
      <div style={ss(8,600,DM,{letterSpacing:1.5,marginBottom:12})}>DATE</div>
      {newDate&&(
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 12px",borderRadius:12,background:`${G}18`,border:`1px solid ${G}44`,marginBottom:12}}>
          <div style={sr(13,400,G)}>{newDate}</div>
          <button onClick={()=>setNewDate("")} style={{background:"none",border:"none",cursor:_p,...ss(13,400,DM)}}>×</button>
        </div>
      )}
      {/* Month nav */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
        <button onClick={prevMonth} style={{width:36,height:36,borderRadius:"50%",background:_1a,border:_2a,color:MD,fontSize:18,cursor:_p,display:"flex",alignItems:"center",justifyContent:"center"}}>‹</button>
        <div style={sr(16,400)}>{monthLabel}</div>
        <button onClick={nextMonth} style={{width:36,height:36,borderRadius:"50%",background:_1a,border:_2a,color:MD,fontSize:18,cursor:_p,display:"flex",alignItems:"center",justifyContent:"center"}}>›</button>
      </div>
      {/* Day headers */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:4,marginBottom:4}}>
        {["Su","Mo","Tu","We","Th","Fr","Sa"].map(d=>(
          <div key={d} style={{textAlign:"center",...ss(9,600,"#555",{letterSpacing:0.5,paddingBottom:4})}}>{d}</div>
        ))}
      </div>
      {/* Day grid */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:4,marginBottom:32}}>
        {Array.from({length:firstDow}).map((_,i)=><div key={"e"+i}/>)}
        {Array.from({length:daysInMonth}).map((_,i)=>{
          const d=i+1;
          const key=toKey(d);
          const dayDate=new Date(y,m,d); dayDate.setHours(0,0,0,0);
          today.setHours(0,0,0,0);
          const isPast=dayDate<today;
          const isSelected=key===selectedKey;
          const isToday=key===todayKey;
          let bg=_1a, color="#888", border="1px solid #222";
          if(isSelected){bg=G;color=BK;border="none";}
          else if(isToday){border=`1px solid ${G}66`;color=MD;}
          if(isPast){color="#333";bg="#0A0A0A";border="1px solid #141414";}
          return(
            <div key={d} onClick={()=>!isPast&&emitDate(key)}
              style={{aspectRatio:"1",borderRadius:8,background:bg,border,cursor:isPast?"default":_p,display:"flex",alignItems:"center",justifyContent:"center"}}>
              <span style={{...ss(11,isSelected?700:400,color)}}>{d}</span>
            </div>
          );
        })}
      </div>

      {/* Buttons */}
      <div style={{display:"flex",gap:12}}>
        <Btn onClick={onCancel} outline>CANCEL</Btn>
        <Btn onClick={onSave} full>SAVE & PLAN OUTFIT</Btn>
      </div>
    </div>
  );
}

function VaultTab({items,outfits,showToast,wishlist,setWishlist,addToWishlist,removeFromWishlist,currentPlan,setShowPricing,logWear,events,setEvents,session,styleProfile={},saveStyleProfile,onboardStep=4,advanceOnboard,initialSection,initialView,onInitialSectionHandled}){
  const [section,setSection]=useState(initialSection||"discover"); // discover | planner | stats
  useEffect(()=>{
    if(initialSection){ setSection(initialSection); if(onInitialSectionHandled) onInitialSectionHandled(); }
  },[initialSection]);
  const isPro = currentPlan!=="free";

  const sections=[
    ["discover","AI Stylist",null,"AI pairings, missing pieces & trend matching"],
    ["planner","Pack & Plan",null,"Occasion calendar & vacation packing"],
    ["stats","Insights",null,"Wardrobe analytics, duplicates & valuation"],
    ["shoppers","Shoppers",null,"Book a personal stylist session"],
  ];

  const VaultIcon = ({id, active}) => {
    const c = active ? BK : MD;
    const icons = {
      discover: (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="6.5" stroke={c} strokeWidth="1.3" fill="none"/>
          <path d="M8 4L9.2 7.2L12 8L9.2 8.8L8 12L6.8 8.8L4 8L6.8 7.2L8 4Z" fill={c}/>
        </svg>
      ),
      planner: (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <rect x="1.5" y="3" width="13" height="11.5" rx="2" stroke={c} strokeWidth="1.3" fill="none"/>
          <line x1="1.5" y1="6.5" x2="14.5" y2="6.5" stroke={c} strokeWidth="1.2"/>
          <line x1="5" y1="1.5" x2="5" y2="4.5" stroke={c} strokeWidth="1.3" strokeLinecap="round"/>
          <line x1="11" y1="1.5" x2="11" y2="4.5" stroke={c} strokeWidth="1.3" strokeLinecap="round"/>
          <rect x="4.5" y="9" width="2.5" height="2.5" rx="0.5" fill={c} opacity="0.8"/>
          <rect x="9" y="9" width="2.5" height="2.5" rx="0.5" fill={c} opacity="0.8"/>
        </svg>
      ),
      stats: (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <line x1="2" y1="14" x2="14" y2="14" stroke={c} strokeWidth="1.3" strokeLinecap="round"/>
          <rect x="3" y="9" width="2.5" height="5" rx="0.5" fill={c}/>
          <rect x="6.8" y="6" width="2.5" height="8" rx="0.5" fill={c} opacity="0.8"/>
          <rect x="10.5" y="3" width="2.5" height="11" rx="0.5" fill={c} opacity="0.6"/>
        </svg>
      ),
      shoppers: (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="5.5" r="3" stroke={c} strokeWidth="1.3" fill="none"/>
          <path d="M2 14.5C2 11.5 4.7 9 8 9C11.3 9 14 11.5 14 14.5" stroke={c} strokeWidth="1.3" strokeLinecap="round" fill="none"/>
        </svg>
      ),
    };
    return icons[id]||null;
  };

  // ── Locked gate card shown per-section when not subscribed ──
  const gateDesc={
    "AI Stylist":["Let AI analyze your closet and suggest perfect pairings.","Get personalized missing pieces and real-time trend matching."],
    "Occasion Planner":["Plan outfits around upcoming events and trips.","Never wonder what to wear — your calendar does the work."],
    "Wardrobe Stats":["See your most-worn pieces, cost-per-wear, and closet duplicates.","Understand your wardrobe at a glance with rich analytics."],
    "Personal Shoppers":["Work 1-on-1 with expert stylists who know your taste.","Book sessions, share your closet, and get curated picks."],
  };

  const Gate=({feature,children})=>(
    isPro ? children : (
      <div style={{padding:"16px"}}>
        <div style={{background:"linear-gradient(135deg,#14100A,#1E1812)",borderRadius:R18,padding:"20px 18px",border:`1px solid ${G}33`,textAlign:"center"}}>
          <div style={{fontSize:28,marginBottom:10}}>✦</div>
          <div style={sr(20,300,G,{marginBottom:6})}>{feature}</div>
          <div style={ss(10,400,MD,{lineHeight:1.6,marginBottom:16})}>
            {(gateDesc[feature]||[]).map((l,i)=><div key={i}>{l}</div>)}
          </div>
          <div style={{..._col,gap:7,marginBottom:18,textAlign:"left"}}>
            {["AI outfit pairings & missing pieces","Trend matching from your closet","Occasion planner & calendar","Vacation packer","Wardrobe stats & duplicate detector","Personal stylist booking"].map(f=>(
              <div key={f} style={{..._row,gap:8}}>
                <div style={{width:15,height:15,borderRadius:"50%",background:`${G}22`,border:`1px solid ${G}44`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,...ss(8,700,G)}}>✓</div>
                <div style={ss(9,400,MD)}>{f}</div>
              </div>
            ))}
          </div>
          <button onClick={()=>setShowPricing(true)} style={{width:"100%",padding:"12px",borderRadius:12,background:`linear-gradient(135deg,${G},#8A6E54)`,border:"none",...ss(9,700,BK,{letterSpacing:1.5}),cursor:_p}}>
            UNLOCK THE VAULT
          </button>
          <div style={ss(8,400,DM,{marginTop:10,letterSpacing:0.5})}>From $8/mo · Cancel anytime</div>
        </div>
      </div>
    )
  );

  return(
    <div className="fu" style={{padding:"0 0 24px"}}>
      {/* Header */}
      <div style={{padding:"12px 16px 6px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:10}}>
        <div style={{minWidth:0,flex:1}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <div style={sr(22,300,undefined,{whiteSpace:"nowrap"})}>The Vault</div>
          </div>
        </div>
        <div style={{display:"flex",gap:5,flexShrink:0}}>
          {sections.map(([k,l])=>(
            <button key={k} onClick={()=>setSection(k)} style={{
              display:"flex",flexDirection:"column",alignItems:"center",gap:3,
              padding:"8px 6px",borderRadius:12,minWidth:48,
              background:section===k?G:"#1A1A1A",
              border:section===k?"none":"1px solid #2A2A2A",
              cursor:_p,
            }}>
              <VaultIcon id={k} active={section===k}/>
              <span style={{...ss(7,section===k?700:400,section===k?BK:MD,{letterSpacing:0.5}),whiteSpace:"nowrap"}}>{l.toUpperCase()}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── ONBOARDING STEP 3 BANNER ── */}
      {onboardStep===3&&(
        <div style={{background:"linear-gradient(135deg,#1A1610,#141008)",border:`1px solid ${G}44`,borderRadius:R14,padding:"14px 16px",marginBottom:0,margin:"0 16px 16px"}}>
          <div style={{..._row,gap:8,marginBottom:8}}>
            <span style={{fontSize:14}}>✦</span>
            <div style={ss(10,700,G,{letterSpacing:1})}>STEP 3 OF 3 — PLAN YOUR FIRST EVENT</div>
          </div>
          <div style={ss(11,400,"#A09080",{marginBottom:12,lineHeight:1.5})}>Add an upcoming event and your wardrobe setup is complete</div>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            <div style={{..._row,gap:6}}>
              {["👚","✦","📅"].map((e,i)=>(
                <div key={i} style={{width:28,height:28,borderRadius:8,background:i<2?`${G}22`:"#111",border:i<2?`1px solid ${G}44`:"1px solid #2A2A2A",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13}}>{i<2?"✓":e}</div>
              ))}
            </div>
            <div style={ss(9,400,DM,{marginLeft:4})}>2 of 3 complete</div>
          </div>
        </div>
      )}

      {/* Content */}
      {section==="discover"&&(
        <Gate feature="AI Stylist">
          <DiscoverTab showToast={showToast} wishlist={wishlist} setWishlist={setWishlist} addToWishlist={addToWishlist} items={items} styleProfile={styleProfile}/>
        </Gate>
      )}
      {section==="planner"&&(
        <Gate feature="Occasion Planner">
          <CalendarTab outfits={outfits} items={items} showToast={showToast} logWear={logWear} events={events} setEvents={setEvents} session={session} initialView={initialView}/>
        </Gate>
      )}
      {section==="stats"&&(
        <Gate feature="Wardrobe Stats">
          <StatsTab items={items} outfits={outfits} showToast={showToast} logWear={logWear}/>
        </Gate>
      )}
      {section==="shoppers"&&(
        <Gate feature="Personal Shoppers">
          <PremiumTab showToast={showToast} currentPlan={currentPlan} setShowPricing={setShowPricing}/>
        </Gate>
      )}
    </div>
  );
}

// ── ONBOARDING ────────────────────────────────────────────────────────────────
// ── Typography helpers ──
const obSerif = (sz,extra={})=>({fontFamily:"'Cormorant Garamond','Georgia',serif",fontSize:sz,fontWeight:300,color:"#F0EBE3",lineHeight:1.18,letterSpacing:0.5,...extra});
const obSans  = (sz,col="#4A4038",extra={})=>({fontFamily:"'Montserrat',sans-serif",fontSize:sz,color:col,...extra});
const ZONE_VIS = {flex:1,position:"relative",overflow:"hidden"};
const ZONE_HEAD = {flexShrink:0,padding:"16px 22px 14px",background:"#0D0D0D",borderTop:"1px solid #1A1A1A"};
const overline = (gold)=>({fontFamily:"'Montserrat',sans-serif",fontSize:8,fontWeight:700,letterSpacing:3,color:gold?"#C4A882":"#4A4038",marginBottom:5});

function ObSlide1(){
  return(
    <React.Fragment>
      {/* Visual zone — wordmark hero */}
      <div style={{...ZONE_VIS,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",background:"#0D0D0D"}}>
        <div style={{width:88,height:88,borderRadius:22,background:"#141210",border:"1px solid rgba(196,168,130,0.2)",display:"flex",alignItems:"center",justifyContent:"center",marginBottom:22}}>
          <span style={{fontSize:40,color:"#C4A882"}}>✦</span>
        </div>
        <div style={{...obSerif(50),letterSpacing:7,marginBottom:6}}>Outfix</div>
        <div style={obSans(8,"#2A2418",{letterSpacing:3.5,fontWeight:600})}>YOUR WARDROBE. ELEVATED.</div>
      </div>
      {/* Headline zone */}
      <div style={ZONE_HEAD}>
        <div style={overline(false)}>WELCOME</div>
        <div style={obSerif(28,{marginBottom:5})}>The only wardrobe<br/><em>app you'll ever need.</em></div>
        <div style={obSans(9,"#4A4038",{lineHeight:1.6})}>Swipe to see what's inside →</div>
      </div>
    </React.Fragment>
  );
}

function ObSlide2(){
  const cards=[
    {name:"Linen Tee",brand:"Uniqlo",cat:"Tops",      bg:"linear-gradient(135deg,#1E1612,#2A2016)"},
    {name:"511 Slim", brand:"Levi's",cat:"Bottoms",   bg:"linear-gradient(135deg,#141822,#1C2030)"},
    {name:"Wool Coat",brand:"COS",   cat:"Outerwear", bg:"linear-gradient(135deg,#141414,#1E1C1A)"},
    {name:"Pegasus 41",brand:"Nike", cat:"Shoes",     bg:"linear-gradient(135deg,#141418,#1C1C20)"},
  ];
  const G="#C4A882";
  return(
    <React.Fragment>
      <div style={{...ZONE_VIS,background:"#0D0D0D",padding:"14px 14px 0"}}>
        {/* Grid */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7,marginBottom:8}}>
          {cards.map((c,i)=>(
            <div key={i} style={{background:"#141414",borderRadius:11,overflow:"hidden",border:"1px solid #1E1E1E"}}>
              <div style={{height:70,background:c.bg,display:"flex",alignItems:"center",justifyContent:"center"}}>
                <CatSVG cat={c.cat} size={28} color={G}/>
              </div>
              <div style={{padding:"5px 8px 7px"}}>
                <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:11,color:"#E8E0D4",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{c.name}</div>
                <div style={obSans(7,"#4A4038",{marginTop:1})}>{c.brand}</div>
              </div>
            </div>
          ))}
        </div>
        {/* Closet value */}
        <div style={{background:"linear-gradient(135deg,#141008,#1A1408)",borderRadius:10,padding:"7px 12px",border:"1px solid rgba(196,168,130,0.2)",display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:7}}>
          <div style={obSans(7,"#4A4038",{letterSpacing:1,fontWeight:700})}>CLOSET VALUE</div>
          <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:18,color:G}}>$2,840</div>
        </div>
        {/* Add methods */}
        <div style={{display:"flex",gap:6}}>
          {/* Camera */}
          <div style={{flex:1,background:"#111",borderRadius:9,padding:"7px 4px",border:"1px solid #1E1E1E",textAlign:"center",display:"flex",flexDirection:"column",alignItems:"center",gap:3}}>
            <svg width="16" height="14" viewBox="0 0 20 18" fill="none">
              <rect x="1" y="4" width="18" height="13" rx="2" stroke={G} strokeWidth="1.4" fill="none"/>
              <circle cx="10" cy="11" r="3.5" stroke={G} strokeWidth="1.3" fill="none"/>
              <path d="M7 4V3C7 2 7.5 1.5 8.5 1.5H11.5C12.5 1.5 13 2 13 3V4" stroke={G} strokeWidth="1.3" strokeLinecap="round" fill="none"/>
            </svg>
            <div style={obSans(7,"#4A4038")}>Camera</div>
          </div>
          {/* Link */}
          <div style={{flex:1,background:"#111",borderRadius:9,padding:"7px 4px",border:"1px solid #1E1E1E",textAlign:"center",display:"flex",flexDirection:"column",alignItems:"center",gap:3}}>
            <svg width="15" height="15" viewBox="0 0 20 20" fill="none">
              <path d="M8 12L12 8" stroke={G} strokeWidth="1.4" strokeLinecap="round"/>
              <path d="M9.5 6.5L11 5C12.2 3.8 14.2 3.8 15.4 5C16.6 6.2 16.6 8.2 15.4 9.4L13.5 11.3" stroke={G} strokeWidth="1.4" strokeLinecap="round" fill="none"/>
              <path d="M10.5 13.5L9 15C7.8 16.2 5.8 16.2 4.6 15C3.4 13.8 3.4 11.8 4.6 10.6L6.5 8.7" stroke={G} strokeWidth="1.4" strokeLinecap="round" fill="none"/>
            </svg>
            <div style={obSans(7,"#4A4038")}>Link</div>
          </div>
          {/* AI fills it */}
          <div style={{flex:1,background:"rgba(196,168,130,0.06)",borderRadius:9,padding:"7px 4px",border:"1px solid rgba(196,168,130,0.3)",textAlign:"center",display:"flex",flexDirection:"column",alignItems:"center",gap:3}}>
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
              <path d="M10 1L11.8 8.2L19 10L11.8 11.8L10 19L8.2 11.8L1 10L8.2 8.2L10 1Z" stroke={G} strokeWidth="1.4" strokeLinejoin="round"/>
            </svg>
            <div style={obSans(7,G)}>AI fills it</div>
          </div>
        </div>
      </div>
      <div style={ZONE_HEAD}>
        <div style={overline(false)}>YOUR CLOSET</div>
        <div style={obSerif(26,{marginBottom:5})}>Never wonder what's<br/>in your wardrobe again.</div>
        <div style={obSans(9,"#4A4038",{lineHeight:1.6})}>Snap or paste a link — <span style={{color:"#9A8A78"}}>AI names the brand, price & category.</span></div>
      </div>
    </React.Fragment>
  );
}

function ObSlide3(){
  const mockRows=[
    {label:"TOPS",    name:"Linen Oversized Tee", brand:"Uniqlo",  cat:"Tops",     color:"#D4C8B4", dots:[1,0,0]},
    {label:"BOTTOMS", name:"511 Slim Jeans",       brand:"Levi's",  cat:"Bottoms",  color:"#3A5070", dots:[1,1,0]},
    {label:"SHOES",   name:"Pegasus 41",           brand:"Nike",    cat:"Shoes",    color:"#2A2A2A", dots:[1,0,0]},
  ];
  return(
    <React.Fragment>
      <div style={{...ZONE_VIS,background:"#0D0D0D",padding:"10px 14px 0",display:"flex",flexDirection:"column",gap:0}}>
        {/* Weather + AI strip */}
        <div style={{display:"flex",gap:7,marginBottom:10}}>
          <div style={{flex:1,background:"#141C30",borderRadius:11,padding:"8px 10px",border:"1px solid #1E2A4A",display:"flex",alignItems:"center",gap:7}}>
            {/* Cloud + sun SVG */}
            <svg width="18" height="16" viewBox="0 0 22 18" fill="none">
              <circle cx="16" cy="6" r="4" stroke="#E8C870" strokeWidth="1.3"/>
              <line x1="16" y1="1" x2="16" y2="0" stroke="#E8C870" strokeWidth="1.2" strokeLinecap="round"/>
              <line x1="19.5" y1="2.5" x2="20.5" y2="1.5" stroke="#E8C870" strokeWidth="1.2" strokeLinecap="round"/>
              <line x1="21" y1="6" x2="22" y2="6" stroke="#E8C870" strokeWidth="1.2" strokeLinecap="round"/>
              <path d="M3 16C1.3 16 0 14.8 0 13.2C0 11.6 1.3 10.5 3 10.5C3.3 9 4.7 8 6.5 8C8.3 8 9.5 9 9.8 10.5H10.5C12.2 10.5 13.5 11.6 13.5 13.2C13.5 14.8 12.2 16 10.5 16H3Z" stroke="#8AAAD8" strokeWidth="1.2" fill="none"/>
            </svg>
            <div>
              <div style={obSans(7,"#5A6090",{letterSpacing:1})}>NEW YORK</div>
              <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:15,color:"#C0C8F0"}}>62°F</div>
            </div>
          </div>
          <div style={{flex:2,background:"linear-gradient(135deg,#C4A882,#A08060)",borderRadius:11,padding:"8px 10px",display:"flex",alignItems:"center",gap:7}}>
            {/* Wand + sparkle SVG */}
            <svg width="14" height="14" viewBox="0 0 18 18" fill="none">
              <line x1="2" y1="16" x2="11" y2="7" stroke="#0D0D0D" strokeWidth="1.6" strokeLinecap="round"/>
              <path d="M11 7L13 5" stroke="#0D0D0D" strokeWidth="1.4" strokeLinecap="round"/>
              <path d="M13 3L13.6 5L15.6 5.6L13.6 6.2L13 8L12.4 6.2L10.4 5.6L12.4 5L13 3Z" stroke="#0D0D0D" strokeWidth="1.1" strokeLinejoin="round"/>
            </svg>
            <div>
              <div style={obSans(8,"#0D0D0D",{fontWeight:700,letterSpacing:1})}>STYLE WITH AI</div>
              <div style={obSans(7,"#3A2A10",{marginTop:1})}>Tap to generate a look</div>
            </div>
          </div>
        </div>
        {/* Mock SwipeRow cards */}
        {mockRows.map((row,ri)=>(
          <div key={ri} style={{position:"relative",marginBottom:ri<2?16:6}}>
            <div style={{borderRadius:18,overflow:"hidden",background:"linear-gradient(135deg,#1A1510,#1E1A14)",border:`1px solid ${row.color}44`,height:82,display:"flex",alignItems:"center"}}>
              {/* Item image placeholder */}
              <div style={{width:"38%",height:"100%",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",padding:"8px 0 8px 10px",boxSizing:"border-box"}}>
                <div style={{width:58,height:58,borderRadius:10,background:`${row.color}22`,border:`1px solid ${row.color}33`,display:"flex",alignItems:"center",justifyContent:"center"}}>
                  <CatSVG cat={row.cat} size={26} color={row.color==="rgb(42,42,42)"||row.color==="#2A2A2A"?"#C4A882":row.color}/>
                </div>
              </div>
              {/* Divider */}
              <div style={{width:1,height:"55%",background:"#2A2A2A",flexShrink:0}}/>
              {/* Text */}
              <div style={{flex:1,padding:"0 14px",minWidth:0}}>
                <div style={obSans(7,"#4A4038",{letterSpacing:2,marginBottom:4})}>{row.label}</div>
                <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:15,fontWeight:400,color:"#F0EBE3",lineHeight:1.2,marginBottom:3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{row.name}</div>
                <div style={obSans(9,"#4A4038")}>{row.brand}</div>
              </div>
            </div>
            {/* Dot indicators below each card */}
            <div style={{position:"absolute",bottom:-10,left:0,right:0,display:"flex",justifyContent:"center",gap:3}}>
              {row.dots.map((on,i)=>(
                <div key={i} style={{width:on?14:5,height:4,borderRadius:2,background:on?"#C4A882":"#2A2A2A",transition:"width 0.2s"}}/>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div style={ZONE_HEAD}>
        <div style={overline(false)}>AI STYLING</div>
        <div style={obSerif(26,{marginBottom:5})}>Dressed for today,<br/>not yesterday.</div>
        <div style={obSans(9,"#4A4038",{lineHeight:1.6})}>Weather-aware looks from <span style={{color:"#9A8A78"}}>your actual closet</span> — every morning.</div>
      </div>
    </React.Fragment>
  );
}

function ObSlide5(){
  const G="#C4A882";
  const feats=[
    {
      label:"AI Stylist",
      desc:"Outfits from your closet",
      icon:(
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path d="M10 2L11.6 7L17 8L11.6 9L10 14L8.4 9L3 8L8.4 7L10 2Z" stroke={G} strokeWidth="1.4" strokeLinejoin="round"/>
          <circle cx="16" cy="15.5" r="1.5" stroke={G} strokeWidth="1.2" fill="none"/>
          <path d="M16 14V12.5" stroke={G} strokeWidth="1.2" strokeLinecap="round"/>
        </svg>
      )
    },
    {
      label:"Missing Pieces",
      desc:"Wardrobe gaps, filled",
      icon:(
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <circle cx="8.5" cy="8.5" r="5.5" stroke={G} strokeWidth="1.4"/>
          <path d="M13 13L17 17" stroke={G} strokeWidth="1.4" strokeLinecap="round"/>
          <path d="M6.5 8.5H10.5" stroke={G} strokeWidth="1.3" strokeLinecap="round"/>
          <path d="M8.5 6.5V10.5" stroke={G} strokeWidth="1.3" strokeLinecap="round"/>
        </svg>
      )
    },
    {
      label:"Try On",
      desc:"See outfits on yourself",
      icon:(
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <circle cx="10" cy="5.5" r="3" stroke={G} strokeWidth="1.4"/>
          <path d="M3.5 18C3.5 14.4 6.5 12 10 12C13.5 12 16.5 14.4 16.5 18" stroke={G} strokeWidth="1.4" strokeLinecap="round"/>
          <path d="M7.5 12.5L10 16L12.5 12.5" stroke={G} strokeWidth="1.2" strokeLinejoin="round" strokeLinecap="round" opacity="0.7"/>
        </svg>
      )
    },
    {
      label:"Pack & Plan",
      desc:"Pack perfectly, always",
      icon:(
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <rect x="2" y="7" width="16" height="11" rx="2" stroke={G} strokeWidth="1.4"/>
          <path d="M7 7V5.5C7 4.4 8.2 4 10 4C11.8 4 13 4.4 13 5.5V7" stroke={G} strokeWidth="1.4" strokeLinecap="round"/>
          <line x1="10" y1="7" x2="10" y2="18" stroke={G} strokeWidth="1.2" strokeLinecap="round" opacity="0.35"/>
          <line x1="2" y1="12" x2="18" y2="12" stroke={G} strokeWidth="1.1" strokeLinecap="round" opacity="0.35"/>
        </svg>
      )
    },
    {
      label:"Wardrobe Insights",
      desc:"Cost-per-wear & value",
      icon:(
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <rect x="2" y="12" width="4" height="6" rx="1" stroke={G} strokeWidth="1.3"/>
          <rect x="8" y="8" width="4" height="10" rx="1" stroke={G} strokeWidth="1.3"/>
          <rect x="14" y="4" width="4" height="14" rx="1" stroke={G} strokeWidth="1.3"/>
          <line x1="1" y1="18.5" x2="19" y2="18.5" stroke={G} strokeWidth="1.1" strokeLinecap="round" opacity="0.4"/>
        </svg>
      )
    },
    {
      label:"Occasion Planner",
      desc:"Right outfit, every event",
      icon:(
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <rect x="2" y="4" width="16" height="14" rx="2" stroke={G} strokeWidth="1.4"/>
          <line x1="2" y1="8.5" x2="18" y2="8.5" stroke={G} strokeWidth="1.2" strokeLinecap="round"/>
          <line x1="6.5" y1="2" x2="6.5" y2="6" stroke={G} strokeWidth="1.4" strokeLinecap="round"/>
          <line x1="13.5" y1="2" x2="13.5" y2="6" stroke={G} strokeWidth="1.4" strokeLinecap="round"/>
          <circle cx="7" cy="13" r="1" fill={G}/>
          <circle cx="10" cy="13" r="1" fill={G}/>
          <circle cx="13" cy="13" r="1" fill={G}/>
        </svg>
      )
    },
  ];
  return(
    <React.Fragment>
      <div style={{...ZONE_VIS,background:"#0D0D0D",padding:"14px 14px 0"}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:10}}>
          {feats.map(({icon,label,desc})=>(
            <div key={label} style={{
              background:"linear-gradient(145deg,#151210,#1C1814)",
              borderRadius:14,
              padding:"14px 12px",
              border:"1px solid rgba(196,168,130,0.16)",
              display:"flex",
              flexDirection:"column",
            }}>
              <div style={{
                width:34,height:34,borderRadius:9,
                background:"rgba(196,168,130,0.07)",
                border:"1px solid rgba(196,168,130,0.18)",
                display:"flex",alignItems:"center",justifyContent:"center",
                marginBottom:10,flexShrink:0,
              }}>
                {icon}
              </div>
              <div style={obSans(8,"#C4A882",{fontWeight:700,marginBottom:4,letterSpacing:0.3})}>{label}</div>
              <div style={obSans(7,"#5A4A3A",{lineHeight:1.45})}>{desc}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={ZONE_HEAD}>
        <div style={overline(true)}>THE VAULT ✦</div>
        <div style={obSerif(26,{marginBottom:5})}>Your full style<br/>system, unlocked.</div>
        <div style={obSans(9,"#4A4038",{lineHeight:1.6})}>Free to start · <span style={{color:"#9A8A78"}}>upgrade anytime.</span></div>
      </div>
    </React.Fragment>
  );
}

const OB_SCREENS=[ObSlide1,ObSlide2,ObSlide3,ObSlide5];



function Onboarding({onDone}){
  const [slide,setSlide]=useState(0);
  const [exiting,setExiting]=useState(false);
  const touchStartX=useRef(null);
  const total=OB_SCREENS.length;

  const goNext=()=>{ if(slide<total-1) setSlide(s=>s+1); else finish(); };
  const goPrev=()=>{ if(slide>0) setSlide(s=>s-1); };
  const finish=()=>{
    setExiting(true);
    try{
      const s=JSON.parse(localStorage.getItem("outfix_session")||"{}");
      const uid=s?.user?.id||"anon";
      localStorage.setItem(`outfix_onboarded_${uid}`,"1");
    }catch(e){}
    setTimeout(()=>onDone(),400);
  };
  const onTouchStart=e=>{ touchStartX.current=e.touches[0].clientX; };
  const onTouchEnd=e=>{
    if(touchStartX.current===null) return;
    const dx=e.changedTouches[0].clientX-touchStartX.current;
    touchStartX.current=null;
    if(dx<-50) goNext();
    else if(dx>50) goPrev();
  };

  const Screen=OB_SCREENS[slide];

  return(
    <div style={{position:"fixed",inset:0,zIndex:200,background:"#0D0D0D",display:"flex",flexDirection:"column",maxWidth:430,margin:"0 auto",fontFamily:"'Cormorant Garamond','Georgia',serif",color:"#F0EBE3",opacity:exiting?0:1,transition:"opacity 0.4s ease"}}
      onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <style>{`@keyframes obIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}`}</style>

      {/* Skip */}
      <div style={{display:"flex",justifyContent:"flex-end",padding:"18px 22px 0",flexShrink:0,position:"absolute",top:0,right:0,zIndex:5}}>
        {slide<total-1&&<button onClick={finish} style={{background:"rgba(13,13,13,0.6)",border:"1px solid #1E1E1E",borderRadius:12,padding:"4px 10px",cursor:_p,fontFamily:"'Montserrat',sans-serif",fontSize:9,fontWeight:400,color:"#3A3028",letterSpacing:1.5}}>SKIP</button>}
      </div>

      {/* Slide content — now self-contained with visual + headline zones */}
      <div key={slide} style={{flex:1,display:"flex",flexDirection:"column",animation:"obIn 0.35s ease forwards",overflow:"hidden"}}>
        <Screen/>
      </div>

      {/* Dots + CTA */}
      <div style={{padding:"12px 24px 44px",display:"flex",flexDirection:"column",alignItems:"center",gap:14,flexShrink:0,background:"#0D0D0D"}}>
        <div style={{display:"flex",gap:8}}>
          {Array.from({length:total}).map((_,i)=>(
            <div key={i} onClick={()=>setSlide(i)} style={{width:i===slide?22:7,height:7,borderRadius:4,background:i===slide?"#C4A882":"#2A2418",transition:"all 0.3s ease",cursor:_p}}/>
          ))}
        </div>
        <button onClick={goNext} style={{width:"100%",padding:"16px",borderRadius:R14,background:`linear-gradient(135deg,#C4A882,#8A6E54)`,border:"none",fontFamily:"'Montserrat',sans-serif",fontSize:13,fontWeight:700,color:"#0D0D0D",letterSpacing:2,cursor:_p}}>
          {slide===total-1?"LET'S BUILD YOUR CLOSET  ✦":"NEXT  →"}
        </button>
      </div>
    </div>
  );
}

// ── ROOT ──────────────────────────────────────────────────────────────────────
export default function App(){
  // ── Auth state ──
  const [session,setSession] = useState(null);
  const [authLoading,setAuthLoading] = useState(true);

  // Restore session on mount — refresh token if expired
  useEffect(()=>{
    const saved = sb.loadSession();
    if(!saved?.access_token || !saved.access_token.startsWith("eyJ")){
      sb.clearSession();
      setAuthLoading(false);
      return;
    }

    // Check if access token is expired
    const isExpired = ()=>{
      try {
        const payload = JSON.parse(atob(saved.access_token.split(".")[1]));
        return payload.exp && Date.now() / 1000 > payload.exp;
      } catch(e){ return true; }
    };

    if(!isExpired()){
      // Token still valid — use it directly
      setSession(saved);
      setAuthLoading(false);
      return;
    }

    // Token expired — try refresh
    if(saved.refresh_token){
      fetch(`${SB_URL}/auth/v1/token?grant_type=refresh_token`, {
        method: "POST",
        headers: sbHeaders(),
        body: JSON.stringify({ refresh_token: saved.refresh_token }),
      }).then(r=>r.json()).then(data=>{
        if(data?.access_token && data.access_token.startsWith("eyJ")){
          sb.saveSession(data);
          setSession(data);
        } else {
          sb.clearSession();
        }
        setAuthLoading(false);
      }).catch(()=>{ sb.clearSession(); setAuthLoading(false); });
    } else {
      sb.clearSession();
      setAuthLoading(false);
    }
  },[]);

  const handleAuth = (sess) => {
    if (!sess?.access_token || typeof sess.access_token !== "string" || !sess.access_token.startsWith("eyJ")) {
      return;
    }
    const uid = sess.user?.id || "";
    // Clear previous user's state immediately to prevent data bleed
    setItems([]);
    setOutfits([]);
    setAppEvents([]);
    setWishlist([]);
    setStyleProfile({aesthetic:[],occasions:[],fitPref:[],avoidPairings:[],styleIcons:"",colorPalette:"",likedCombos:[],dislikedCombos:[],quizCompleted:false});
    setLiveNotifs([]);
    setNotifsLoaded(false);
    // Load onboard step for this user
    try {
      const savedStep = parseInt(localStorage.getItem(`outfix_onboard_step_${uid}`)||"0");
      const forcePreview = new URLSearchParams(window.location.search).get('preview')==='onboarding';
      if(forcePreview){
        // Reset onboarding flags so full flow plays from slide 1
        localStorage.removeItem(`outfix_onboarded_${uid}`);
        localStorage.removeItem(`outfix_onboard_step_${uid}`);
        setOnboardStep(0);
        setShowOnboarding(true);
      } else {
        setOnboardStep(savedStep);
        if(!localStorage.getItem(`outfix_onboarded_${uid}`)) setShowOnboarding(true);
      }
    } catch(e){}
    setSession(sess);
  };
  const handleSignOut = async () => {
    if(session?.access_token) await sb.signOut(session.access_token);
    sb.clearSession();
    setSession(null);
  };

  // ── Core state ──
  const [tab,setTab]               = useState("home");
  const [viewProfile,setViewProfile] = useState(null); // lifted from HomeTab for cross-tab access
  const [items,setItems]           = useState([]);
  const [outfits,setOutfits]       = useState([]);
  const [wishlist,setWishlist]     = useState([]);
  const [toast,setToast]           = useState(null);
  const [milestone,setMilestone]   = useState(null); // {count, unlock, emoji}
  const [showPricing,setShowPricing]     = useState(false);
  const [currentPlan,setCurrentPlan]     = useState("free");
  const [liveNotifs,setLiveNotifs] = useState([]); // persists across panel open/close
  const [notifsLoaded,setNotifsLoaded] = useState(false);

  // ── Background notification polling (every 60s) ──
  useEffect(()=>{
    if(!session?.access_token) return;
    const poll = async () => {
      try {
        const uid = session.user?.id;
        const headers = {...sbHeaders(session.access_token)};
        const [myEvents, followers] = await Promise.all([
          fetch(`${SB_URL}/rest/v1/feed_events?user_id=eq.${uid}&select=id,outfit_name,item_name,like_count,created_at&order=created_at.desc&limit=20`,{headers}).then(r=>r.json()).catch(()=>[]),
          fetch(`${SB_URL}/rest/v1/follows?following_id=eq.${uid}&select=follower_id,created_at&order=created_at.desc&limit=20`,{headers}).then(r=>r.json()).catch(()=>[]),
        ]);
        let readIds = {};
        try{ readIds=JSON.parse((()=>{try{const s=JSON.parse(localStorage.getItem("outfix_session")||"{}");return localStorage.getItem(`outfix_read_notifs_${s?.user?.id||"anon"}`)||"{}";}catch(e){return "{}";}})() ); }catch(e){}
        const getTimeAgo=(ts)=>{ if(!ts) return ""; const m=Math.floor((Date.now()-new Date(ts).getTime())/60000); if(m<1) return "just now"; if(m<60) return `${m}m ago`; const h=Math.floor(m/60); if(h<24) return `${h}h ago`; return `${Math.floor(h/24)}d ago`; };
        const followerIds=(Array.isArray(followers)?followers:[]).map(f=>f.follower_id).filter(Boolean);
        let followerProfiles={};
        if(followerIds.length){
          const profs=await fetch(`${SB_URL}/rest/v1/profiles?id=in.(${followerIds.slice(0,10).join(",")})&select=id,username`,{headers}).then(r=>r.json()).catch(()=>[]);
          (Array.isArray(profs)?profs:[]).forEach(p=>{ followerProfiles[p.id]=p; });
        }
        const likeN=(Array.isArray(myEvents)?myEvents:[]).filter(e=>(e.like_count||0)>0).map(e=>({
          id:`like-${e.id}`,type:"like",read:readIds[`like-${e.id}`]||false,icon:"♥",
          title:`Your post got ${e.like_count} like${e.like_count>1?"s":""}`,
          body:`"${e.outfit_name||e.item_name||"post"}"`,time:getTimeAgo(e.created_at),urgent:false,_ts:new Date(e.created_at||0).getTime(),
        }));
        const followN=(Array.isArray(followers)?followers:[]).slice(0,5).map(f=>({
          id:`follow-${f.follower_id}`,type:"follow",read:readIds[`follow-${f.follower_id}`]||false,icon:"👤",
          title:`followed you`,
          username: followerProfiles[f.follower_id]?.username||null,
          userId: f.follower_id,
          body:"Tap name to view their closet",time:getTimeAgo(f.created_at),urgent:false,_ts:new Date(f.created_at||0).getTime(),
        }));
        const merged=[...likeN,...followN].sort((a,b)=>(b._ts||0)-(a._ts||0));
        setLiveNotifs(merged);
      } catch(e){}
    };
    poll(); // immediate on login
    const interval = setInterval(poll, 60000); // then every 60s
    return ()=>clearInterval(interval);
  },[session?.access_token]);
  const [closetLoading,setClosetLoading] = useState(false);
  const [closetError,setClosetError] = useState(false);
  const [showOnboarding,setShowOnboarding] = useState(false);
  const [onboardStep,setOnboardStep] = useState(0);
  const advanceOnboard=(step)=>{
    if(onboardStep>=step) return;
    setOnboardStep(step);
    try{
      const s=JSON.parse(localStorage.getItem("outfix_session")||"{}");
      const uid=s?.user?.id||"anon";
      localStorage.setItem(`outfix_onboard_step_${uid}`,String(step));
    }catch(e){}
  };
  const [userProfile,setUserProfile] = useState({username:"",bio:"",location:"",styleIdentity:""});
  const [styleProfile,setStyleProfile] = useState({aesthetic:[],occasions:[],fitPref:[],avoidPairings:[],styleIcons:"",colorPalette:"",likedCombos:[],dislikedCombos:[],quizCompleted:false});

  const [styleNudgeDismissed,setStyleNudgeDismissed] = useState(()=>{
    try{
      // Also treat as dismissed if quiz was already completed (cached locally)
      if(localStorage.getItem("outfix_quiz_completed")==="1") return true;
      return localStorage.getItem("outfix_style_nudge_dismissed")==="1";
    }catch(e){return false;}
  });
  const [autoOpenQuiz,setAutoOpenQuiz]   = useState(false);
  const [showQuiz,setShowQuiz]           = useState(false);
  const [quizStep,setQuizStep]           = useState(0);
  const [quizDraft,setQuizDraft]         = useState({aesthetic:[],occasions:[],fitPref:[],avoidPairings:[],styleIcons:"",colorPalette:""});

  const dismissStyleNudge = () => { setStyleNudgeDismissed(true); try{localStorage.setItem("outfix_style_nudge_dismissed","1");}catch(e){} };
  const openStyleQuiz = () => { setQuizDraft({aesthetic:styleProfile?.aesthetic||[],occasions:styleProfile?.occasions||[],fitPref:styleProfile?.fitPref||[],avoidPairings:styleProfile?.avoidPairings||[],styleIcons:styleProfile?.styleIcons||"",colorPalette:styleProfile?.colorPalette||""});setQuizStep(0);setShowQuiz(true); };

  // Auto-dismiss nudge once quiz is confirmed complete from Supabase
  useEffect(()=>{
    if(styleProfile?.quizCompleted){
      setStyleNudgeDismissed(true);
      try{ localStorage.setItem("outfix_quiz_completed","1"); }catch(e){}
    }
  },[styleProfile?.quizCompleted]);

  // ── Load + save style profile ──
  const loadStyleProfile = async (token, uid) => {
    try {
      const data = await sb.select("style_profiles", token, `&user_id=eq.${uid}`);
      if(Array.isArray(data) && data.length > 0){
        const r = data[0];
        setStyleProfile({
          aesthetic: r.aesthetic || [],
          occasions: r.occasions || [],
          fitPref: r.fit_pref || [],
          avoidPairings: r.avoid_pairings || [],
          styleIcons: r.style_icons || "",
          colorPalette: r.color_palette || "",
          likedCombos: r.liked_combos || [],
          dislikedCombos: r.disliked_combos || [],
          quizCompleted: r.quiz_completed || false,
        });
      }
    } catch(e){ }
  };

  const saveStyleProfile = async (updates) => {
    const uid = session?.user?.id;
    if(!uid) return;
    const merged = {...styleProfile, ...updates};
    setStyleProfile(merged);
    try {
      const existing = await sb.select("style_profiles", session.access_token, `&user_id=eq.${uid}`);
      const payload = {
        user_id: uid,
        aesthetic: merged.aesthetic,
        occasions: merged.occasions,
        fit_pref: merged.fitPref,
        avoid_pairings: merged.avoidPairings,
        style_icons: merged.styleIcons,
        color_palette: merged.colorPalette,
        liked_combos: merged.likedCombos,
        disliked_combos: merged.dislikedCombos,
        quiz_completed: merged.quizCompleted,
        learned_loves: merged.learnedLoves,
        learned_dislikes: merged.learnedDislikes,
      };
      if(Array.isArray(existing) && existing.length > 0){
        await fetch(`${SB_URL}/rest/v1/style_profiles?user_id=eq.${uid}`, {
          method:"PATCH",
          headers:{...sbHeaders(session.access_token),"Prefer":"return=representation"},
          body:JSON.stringify(payload),
        });
      } else {
        await sb.insert("style_profiles", session.access_token, payload);
      }
    } catch(e){ }
  };

  // ── Load user's closet from Supabase on login ──
  const loadClosetData = async () => {
    if(!session?.access_token) return;
    setClosetLoading(true);
    setClosetError(false);

    const userId = session.user?.id ||
      (() => { try { return JSON.parse(atob(session.access_token.split(".")[1])).sub; } catch(e){ return null; } })();

    if(!userId){ console.error("No userId found in session"); setClosetLoading(false); return; }

    try {
    // Explicitly filter by user_id — belt AND suspenders alongside RLS
    const [itemData, outfitData, wishlistData, eventsData] = await Promise.all([
      sb.select("items", session.access_token, `&user_id=eq.${userId}`).catch(e=>{ console.error("items load failed:", e); return []; }),
      sb.select("outfits", session.access_token, `&user_id=eq.${userId}`).catch(e=>{ console.error("outfits load failed:", e); return []; }),
      sb.select("wishlist", session.access_token, `&user_id=eq.${userId}`).catch(e=>{ console.error("wishlist load failed:", e); return []; }),
      sb.select("calendar_events", session.access_token, `&user_id=eq.${userId}&order=date.asc`).catch(()=>[]),
    ]);
    loadStyleProfile(session.access_token, userId);


    // ── Items ──
    if(itemData?.code || itemData?.error){
      console.error("Items load error:", itemData);
    } else if(Array.isArray(itemData) && itemData.length > 0){
      const mapped = itemData.map(r=>({
        id: r.id,
        name: r.name,
        brand: r.brand || "",
        category: r.category || "Tops",
        color: r.color || "#C4A882",
        price: r.price || 0,
        wearCount: r.wear_count || 0,
        lastWorn: r.last_worn || "Never",
        purchaseDate: r.purchase_date || "",
        condition: r.condition || "Good",
        forSale: r.for_sale || false,
        emoji: r.emoji || "👚",
        tags: r.tags || [],
        sourceImage: r.source_image || null,
        sourceImages: r.source_images || null,
        size: r.size || "",
      }));
      setItems(mapped);
    } else {
    }

    // ── Outfits ──
    if(Array.isArray(outfitData) && outfitData.length > 0){
      const mapped = outfitData.map(r=>({
        id: r.id,
        name: r.name,
        occasion: r.occasion || "Casual",
        season: r.season || "All Year",
        items: r.item_ids || [],
        wornHistory: r.worn_history || [],
      }));
      setOutfits(mapped);
    }

    // ── Wishlist ──
    if(Array.isArray(wishlistData) && wishlistData.length > 0){
      const mapped = wishlistData.map(r=>({
        id: r.id,
        name: r.name,
        brand: r.brand || "",
        price: r.price || 0,
        emoji: r.emoji || "♡",
        gap: r.gap || "",
        inMarket: r.in_market || false,
        sourceImage: r.source_image || null,
        color: r.color || null,
      }));
      setWishlist(mapped);
    }

    // ── Calendar Events ──
    if(Array.isArray(eventsData) && eventsData.length > 0){
      const mapped = eventsData.map(r=>({
        id: r.id,
        label: r.label || "",
        date: r.date || "",
        occasion: r.occasion || "Casual",
        emoji: r.emoji || "📅",
        outfitName: r.outfit_name || null,
        outfitItems: r.outfit_items || [],
        suggestedOutfit: r.suggested_outfit || null,
      }));
      setAppEvents(mapped);
    }

    setClosetLoading(false);
    } catch(e) { console.error("Closet load error:", e); setClosetError(true); setClosetLoading(false); }
  };
  useEffect(()=>{ loadClosetData(); },[session]);

  // ── Load profile from Supabase ──
  useEffect(()=>{
    if(!session?.access_token) return;
    (async()=>{
      try{
        const data = await sb.select("profiles", session.access_token, `&id=eq.${session.user?.id}`);
        if(data?.[0]){
          const p = data[0];
          setUserProfile({
            username: p.username||"",
            bio: p.bio||"",
            location: p.location||"",
            styleIdentity: p.style_identity||"",
            avatar_url: p.avatar_url||null,
          });
          // Restore plan tier
          if(p.plan_tier && ["free","plus","pro"].includes(p.plan_tier)){
            setCurrentPlan(p.plan_tier);
          }
        }
      }catch(e){}
    })();
  },[session]);

  const saveProfile = async (updates) => {
    if(!session?.access_token) return;
    const userId = session.user?.id;
    if(!userId) return;
    const merged = {...userProfile,...updates};
    setUserProfile(merged);
    try{
      // Use upsert — id in body + explicit filter ensures only own row is touched
      const r = await fetch(`${SB_URL}/rest/v1/profiles?id=eq.${userId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`,
          "apikey": SB_KEY,
          "Prefer": "return=representation",
        },
        body: JSON.stringify({
          username: merged.username,
          bio: merged.bio,
          location: merged.location,
          style_identity: merged.styleIdentity,
          avatar_url: merged.avatar_url||null,
          closet_public: merged.closet_public !== false, // default true
          outfits_public: merged.outfits_public !== false, // default true
          updated_at: new Date().toISOString(),
        }),
      });
      // If no row existed yet (new user), fall back to INSERT
      if(r.status === 404 || r.status === 406) {
        await fetch(`${SB_URL}/rest/v1/profiles`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${session.access_token}`,
            "apikey": SB_KEY,
            "Prefer": "resolution=merge-duplicates,return=representation",
          },
          body: JSON.stringify({
            id: userId,
            username: merged.username,
            bio: merged.bio,
            location: merged.location,
            style_identity: merged.styleIdentity,
            avatar_url: merged.avatar_url||null,
            closet_public: merged.closet_public !== false,
            outfits_public: merged.outfits_public !== false,
            updated_at: new Date().toISOString(),
          }),
        });
      }
    }catch(e){ console.error("saveProfile error:", e); }
  };
  const saveItemToDB = async (item, isNewItem=false) => {
    if(!session?.access_token) return;
    try {
      // Extract user ID from session — Supabase stores it in different places
      const userId = session.user?.id || session.user_id ||
        (() => { try { return JSON.parse(atob(session.access_token.split(".")[1])).sub; } catch(e){ return null; } })();


      if(!userId) { console.error("No user ID found in session"); return; }

      let sourceImageUrl = null;
      if(item.sourceImage) {
        if(item.sourceImage.startsWith("http")) {
          sourceImageUrl = item.sourceImage;
        } else if(item.sourceImage.startsWith("data:")) {
          sourceImageUrl = await sb.uploadPhoto(session.access_token, userId, item.sourceImage);
        }
      }

      // Upload any base64 images in sourceImages array to Storage
      let sourceImagesUrls = null;
      if(item.sourceImages && item.sourceImages.length > 0){
        sourceImagesUrls = await Promise.all(item.sourceImages.map(async img => {
          if(!img) return null;
          if(img.startsWith("http")) return img;
          if(img.startsWith("data:")) return await sb.uploadPhoto(session.access_token, userId, img);
          return img;
        }));
        sourceImagesUrls = sourceImagesUrls.filter(Boolean);
        // Keep sourceImageUrl in sync with first image
        if(sourceImagesUrls.length > 0 && !sourceImageUrl){
          sourceImageUrl = sourceImagesUrls[0];
        }
      }

      const itemPayload = {
        user_id: userId,
        name: item.name,
        brand: item.brand,
        category: item.category,
        color: item.color,
        price: item.price,
        wear_count: item.wearCount || 0,
        last_worn: item.lastWorn || "Never",
        purchase_date: item.purchaseDate || "",
        condition: item.condition || "Good",
        for_sale: item.forSale || false,
        emoji: item.emoji || "👚",
        tags: item.tags || [],
        source_image: sourceImageUrl,
        source_images: sourceImagesUrls || item.sourceImages || null,
        size: item.size || null,
      };

      // UPDATE for any existing item (UUID or numeric timestamp id), INSERT only for brand-new items
      const hasExistingId = item.id && !isNewItem;
      let result;
      if(hasExistingId) {
        result = await sb.update("items", session.access_token, item.id, itemPayload);
      } else {
        result = await sb.insert("items", session.access_token, itemPayload);
      }
      // Post feed event for followers — only on first add, not edits
      const savedRow = Array.isArray(result) ? result[0] : result;
      if(isNewItem && savedRow?.id) {
        sb.insert("feed_events", session.access_token, {
          user_id: userId,
          type: "added_item",
          item_id: String(savedRow.id),
          item_name: item.name,
          item_brand: item.brand || "",
          item_emoji: item.emoji || "👗",
          item_image: sourceImageUrl || null,
          item_category: item.category || "",
          item_price: item.price || 0,
        }).catch(()=>{});
      }
    } catch(e){ console.error("saveItemToDB error:", e); }
  };

  // ── Delete an item from Supabase ──
  const deleteItemFromDB = async (id) => {
    if(!session?.access_token) return;
    try {
      await sb.delete("items", session.access_token, id);
    } catch(e){ console.error("deleteItemFromDB error:", e); }
  };

  // ── Batch background removal — processes all closet items with photos ──
  const [batchBgProgress, setBatchBgProgress] = useState(null); // null | {total,done,failed,running,lastError}

  const runBatchBgRemoval = async () => {
    if(!session?.access_token) return;
    const userId = session.user?.id ||
      (() => { try { return JSON.parse(atob(session.access_token.split(".")[1])).sub; } catch(e){ return null; } })();
    if(!userId) return;

    const targets = items.filter(i => i.sourceImage);
    if(!targets.length){ showToast("No photos to process ✦"); return; }

    setBatchBgProgress({ total: targets.length, done: 0, failed: 0, running: true, lastError: null });
    let failureReasons = {}; // tallies per-stage failures for diagnostic summary

    for(let i = 0; i < targets.length; i++){
      const item = targets[i];
      let stage = "start"; // track where it fails
      try {
        let b64;
        // ── Stage 1: Fetch image as base64 ──
        stage = "fetch";
        if(item.sourceImage.startsWith("http")){
          const r = await fetch(item.sourceImage);
          if(!r.ok) throw new Error(`fetch_${r.status}`);
          const blob = await r.blob();
          if(blob.size > 12 * 1024 * 1024) throw new Error("fetch_too_large"); // remove.bg limit is 12MB
          b64 = await new Promise((res, rej) => {
            const reader = new FileReader();
            reader.onload = e => res(e.target.result.split(",")[1]);
            reader.onerror = () => rej(new Error("fetch_readfail"));
            reader.readAsDataURL(blob);
          });
        } else if(item.sourceImage.startsWith("data:")){
          b64 = item.sourceImage.split(",")[1];
        } else {
          throw new Error("fetch_unknown_format");
        }

        // ── Stage 2: Remove background ──
        stage = "remove_bg";
        const res = await fetch("/api/remove-bg", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageBase64: b64 }),
        });
        if(!res.ok) {
          const errBody = await res.text().catch(() => "");
          console.error(`[Batch BG] remove-bg failed for "${item.name}":`, { status: res.status, body: errBody.slice(0,200) });
          throw new Error(`remove_bg_${res.status}`);
        }
        const data = await res.json();
        if(!data.imageBase64) throw new Error("remove_bg_empty");

        // ── Stage 3: Upload cleaned PNG ──
        stage = "upload";
        const cleanDataUrl = `data:image/png;base64,${data.imageBase64}`;
        const cleanUrl = await sb.uploadPhoto(session.access_token, userId, cleanDataUrl);
        if(!cleanUrl) throw new Error("upload_failed");

        // ── Stage 4: Save to DB ──
        stage = "save";
        const updated = { ...item, sourceImage: cleanUrl };
        setItems(prev => prev.map(x => x.id === item.id ? updated : x));
        await saveItemToDB(updated);

        setBatchBgProgress(p => ({ ...p, done: p.done + 1 }));
      } catch(e){
        const reason = `${stage}:${e.message}`;
        failureReasons[reason] = (failureReasons[reason] || 0) + 1;
        console.error(`[Batch BG] "${item.name}" failed at stage ${stage}:`, e.message);
        setBatchBgProgress(p => ({ ...p, failed: p.failed + 1, done: p.done + 1, lastError: reason }));
      }
      // Small pause between API calls to avoid rate limits
      if(i < targets.length - 1) await new Promise(r => setTimeout(r, 600));
    }

    setBatchBgProgress(p => ({ ...p, running: false }));

    // Telemetry-friendly summary — surfaced to user
    const cleaned = targets.length - Object.values(failureReasons).reduce((a,b)=>a+b, 0);
    if(cleaned > 0 && Object.keys(failureReasons).length === 0){
      showToast(`Backgrounds cleaned on ${cleaned} photos ✦`);
    } else if(cleaned === 0){
      // Find most common failure — tell the user what happened
      const topReason = Object.entries(failureReasons).sort((a,b)=>b[1]-a[1])[0];
      const [stage, msg] = (topReason?.[0] || "unknown:unknown").split(":");
      let userMsg = "Couldn't clean photos — ";
      if(stage === "fetch") userMsg += "image downloads blocked (check storage permissions)";
      else if(stage === "remove_bg" && msg.includes("402")) userMsg += "remove.bg API quota exceeded";
      else if(stage === "remove_bg" && msg.includes("429")) userMsg += "too many requests — try again later";
      else if(stage === "remove_bg") userMsg += `remove.bg error (${msg})`;
      else if(stage === "upload") userMsg += "upload to storage failed";
      else if(stage === "save") userMsg += "save to DB failed";
      else userMsg += "check console for details";
      showToast(userMsg);
      console.error("[Batch BG] Full failure summary:", failureReasons);
    } else {
      showToast(`${cleaned} cleaned · ${targets.length - cleaned} skipped — check console`);
      console.error("[Batch BG] Partial failure summary:", failureReasons);
    }
  };

  // ── Update wear count in Supabase ──
  const updateWearInDB = async (id, wearCount) => {
    if(!session?.access_token) return;
    try {
      const today = new Date().toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"});
      await sb.update("items", session.access_token, id, { wear_count: wearCount, last_worn: today });
    } catch(e){ console.error("updateWearInDB error:", e); }
  };

  // ── Save a new outfit to Supabase ──
  const saveOutfitToDB = async (outfit) => {
    if(!session?.access_token) return null;
    try {
      const userId = session.user?.id || session.user_id ||
        (() => { try { return JSON.parse(atob(session.access_token.split(".")[1])).sub; } catch(e){ return null; } })();
      if(!userId) { console.error("No user ID for outfit save"); return null; }
      const res = await sb.insert("outfits", session.access_token, {
        user_id: userId,
        name: outfit.name,
        occasion: outfit.occasion || "Casual",
        season: outfit.season || "All Year",
        item_ids: outfit.items || [],
        worn_history: outfit.wornHistory || [],
      });
      return Array.isArray(res) ? res[0] : res;
    } catch(e){ console.error("saveOutfitToDB error:", e); return null; }
  };

  // ── Delete an outfit from Supabase ──
  const deleteOutfitFromDB = async (id) => {
    if(!session?.access_token) return;
    try {
      await sb.delete("outfits", session.access_token, id);
    } catch(e){ console.error("deleteOutfitFromDB error:", e); }
  };

  // ── Save a wishlist item to Supabase ──
  const saveWishlistItemToDB = async (item) => {
    if(!session?.access_token) return;
    try {
      const userId = session.user?.id || session.user_id ||
        (() => { try { return JSON.parse(atob(session.access_token.split(".")[1])).sub; } catch(e){ return null; } })();
      if(!userId) return;
      // Coerce price to a number — guard against strings like "$25-45"
      const price = typeof item.price === "number" ? item.price
        : parseInt(String(item.price).replace(/[^\d]/g,"")) || 0;
      const res = await sb.insert("wishlist", session.access_token, {
        user_id: userId,
        name: item.name || "Unnamed",
        brand: item.brand || "",
        price,
        emoji: item.emoji || "♡",
        gap: item.gap || "",
        in_market: item.inMarket || false,
        source_image: item.sourceImage || null,
        color: item.color || null,
      });
    } catch(e){ console.error("saveWishlistItemToDB error:", e); }
  };

  // ── Delete a wishlist item from Supabase ──
  const deleteWishlistItemFromDB = async (id) => {
    if(!session?.access_token) return;
    try {
      await sb.delete("wishlist", session.access_token, id);
    } catch(e){ console.error("deleteWishlistItemFromDB error:", e); }
  };

  // ── Wishlist helpers (state + DB) ──
  const addToWishlist = (item) => {
    setWishlist(prev => {
      if(prev.find(w => w.name === item.name)) return prev;
      const newItem = { id: item.id || Date.now(), ...item };
      saveWishlistItemToDB(newItem);
      return [...prev, newItem];
    });
  };

  const removeFromWishlist = (id) => {
    setWishlist(prev => prev.filter(w => w.id !== id));
    deleteWishlistItemFromDB(id);
  };

  // ── New feature state ──
  const [showPushNotifs,setShowPushNotifs] = useState(false);
  const [showInbox,setShowInbox] = useState(false);
  const [showClosetAdd,setShowClosetAdd] = useState(false);
  const [draftCount,setDraftCount]       = useState(0);
  const [unreadMsgCount,setUnreadMsgCount] = useState(0);
  const [lastMsgSenderIds,setLastMsgSenderIds] = useState(new Set()); // dedupe toasts

  // Poll window.__outfix_draftCount (set by ClosetTab) to drive FAB badge
  useEffect(()=>{
    const id = setInterval(()=>{
      const n = window.__outfix_draftCount||0;
      setDraftCount(prev=>prev!==n?n:prev);
    },500);
    return ()=>clearInterval(id);
  },[]);
  const [vaultSection,setVaultSection]   = useState(null); // null | "planner" | "discover" etc
  const [activeThread,setActiveThread] = useState(null); // {userId, username}
  const [appEvents,setAppEvents] = useState([]);


  // ── Helpers ──
  const showToast = msg   => { setToast(msg); setTimeout(()=>setToast(null), 2600); };

  // ── Global unread-messages poller — runs every 30s while logged in ──
  useEffect(()=>{
    if(!session?.access_token||!session.user?.id) return;
    const uid = session.user.id;
    const token = session.access_token;
    const headers = {...sbHeaders(token)};

    const loadUnread = async () => {
      try {
        const res = await fetch(
          `${SB_URL}/rest/v1/messages?receiver_id=eq.${uid}&read=eq.false&order=created_at.desc&limit=50`,
          {headers}
        );
        if(!res.ok){ console.error("[Unread] fetch failed",res.status); return; }
        const rows = await res.json();
        if(!Array.isArray(rows)) return;
        setUnreadMsgCount(rows.length);

        // Surface a one-time toast for new senders since last poll
        const senderIds = new Set(rows.map(r=>r.sender_id));
        setLastMsgSenderIds(prev=>{
          const newSenders = [...senderIds].filter(id=>!prev.has(id));
          if(newSenders.length > 0 && prev.size > 0){
            // Only toast if not already viewing that thread
            if(!activeThread || !newSenders.includes(activeThread.userId)){
              setToast("New message ✦");
              setTimeout(()=>setToast(null), 2600);
            }
          }
          return senderIds;
        });
      } catch(e){ console.error("[Unread] poll error",e); }
    };

    loadUnread(); // initial
    const id = setInterval(loadUnread, 30000);
    return () => clearInterval(id);
  },[session?.access_token, activeThread]);

  const MILESTONES = {
    5:  { emoji:"✦", unlock:"Outfit suggestions unlocked",   color:"#C4A882" },
    10: { emoji:"✧", unlock:"Style DNA report unlocked",     color:"#A0B8D0" },
    20: { emoji:"✦", unlock:"Full AI Stylist activated",     color:"#C4A882" },
  };

  // ── Silent missing-pieces scan — runs at milestones and monthly ──
  const runSilentGapsScan = async (currentItems) => {
    if(!currentItems || currentItems.length < 5) return;
    try {
      const closetSummary = currentItems.slice(0,30).map(i=>`${i.name} (${i.category}${i.brand?', '+i.brand:''})`).join('; ');
      const raw = await callClaude(
        `I have ${currentItems.length} clothing items: ${closetSummary}.\n\nIdentify the 3 most impactful missing pieces that would complete the most outfit combinations. Be brief and specific.\n\nReturn ONLY JSON: {"gaps":[{"gap":"item name","why":"one short reason"}],"summary":"one sentence like '3 pieces would complete 80% of your looks'"}`
      );
      const json = JSON.parse(raw.replace(/```json|```/g,'').trim());
      const summary = json.summary || `${(json.gaps||[]).length} pieces would upgrade your wardrobe`;
      const gaps = json.gaps || [];
      if(!gaps.length) return;
      // Push as an in-app notification
      const notif = {
        id: `gaps_${Date.now()}`,
        type: 'gaps_alert',
        read: false,
        time: 'Just now',
        title: 'Wardrobe insight ✦',
        body: summary,
        action: 'View Gaps',
        _gaps: gaps,
        urgent: false,
      };
      setLiveNotifs(prev => [notif, ...prev.filter(n=>n.type!=='gaps_alert')]);
      localStorage.setItem('outfix_last_gaps_scan', String(Date.now()));
    } catch(e) { /* silent — gaps scan is best-effort */ }
  };

  // Monthly gaps re-scan trigger (checked on app load)
  useEffect(()=>{
    if(!items.length) return;
    try {
      const last = parseInt(localStorage.getItem('outfix_last_gaps_scan')||'0');
      const thirtyDays = 30 * 24 * 60 * 60 * 1000;
      if(Date.now() - last > thirtyDays) runSilentGapsScan(items);
    } catch(e) {}
  }, [items.length > 0]);

  const checkMilestone = (newCount) => {
    const m = MILESTONES[newCount];
    if(m) { setMilestone({count:newCount, ...m}); setTimeout(()=>setMilestone(null), 3500); }
    // Trigger silent gaps scan at key closet milestones
    if([10,25,50].includes(newCount)) runSilentGapsScan(items);
  };

  const logWear = (outfitId) => {
    const today = new Date();
    const key = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;
    const displayDate = today.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"});

    // Use string comparison — Supabase IDs are UUIDs, local IDs may be numbers
    const wornOutfit = outfits.find(o => String(o.id) === String(outfitId));
    const outfitItemIds = wornOutfit?.items || [];
    const alreadyWorn = (wornOutfit?.wornHistory||[]).includes(key);

    if(!wornOutfit){ console.warn("logWear: outfit not found for id", outfitId, "available:", outfits.map(o=>o.id)); return; }

    setOutfits(prev => prev.map(o => {
      if(String(o.id) !== String(outfitId)) return o;
      if(!alreadyWorn) {
        const newHistory = [key, ...(o.wornHistory||[])];
        const updatedOutfit = { ...o, wornHistory: newHistory };
        // Save full outfit row to guarantee worn_history persists
        if(session?.access_token) {
          const uid = session.user?.id;
          if(uid) {
            fetch(`${SB_URL}/rest/v1/outfits?id=eq.${o.id}`, {
              method: "PATCH",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${session.access_token}`,
                "apikey": SB_KEY,
                "Prefer": "return=minimal",
              },
              body: JSON.stringify({
                worn_history: newHistory,
                wear_count: (o.wearCount||0) + 1,
              }),
            }).catch(e=>console.error("worn_history save failed:", e));
          }
        }
        return updatedOutfit;
      }
      return o;
    }));

    setItems(prev => prev.map(i => {
      if(!outfitItemIds.map(String).includes(String(i.id))) return i;
      const newCount = (i.wearCount||0) + 1;
      updateWearInDB(i.id, newCount);
      return { ...i, wearCount: newCount, lastWorn: displayDate };
    }));

    // Post feed event
    if(session?.access_token && wornOutfit) {
      const uid = session.user?.id;
      const outfitItemObjs = outfitItemIds.map(id=>items.find(i=>String(i.id)===String(id))).filter(Boolean);
      if(uid) sb.insert("feed_events", session.access_token, {
        user_id: uid,
        type: "wore_outfit",
        outfit_name: wornOutfit.name,
        outfit_id: String(outfitId),
        item_emojis: outfitItemObjs.map(i=>i.emoji).filter(Boolean).slice(0,3),
        item_names: outfitItemObjs.map(i=>i.name).slice(0,3),
        item_images: outfitItemObjs.map(i=>i.sourceImage||null).slice(0,3),
        item_colors: outfitItemObjs.map(i=>i.color||"#2A2A2A").slice(0,3),
        item_brands: outfitItemObjs.map(i=>i.brand||"").slice(0,3),
        item_ids: outfitItemObjs.map(i=>String(i.id)).slice(0,3),
        item_prices: outfitItemObjs.map(i=>i.price||0).slice(0,3),
      }).catch(()=>{});
    }
  };

  // Reusable — post a wore_outfit feed event for any combo of items
  const postWearFeedEvent = (outfitName, itemObjs) => {
    if(!session?.access_token) return;
    const uid = session.user?.id;
    if(!uid) return;
    sb.insert("feed_events", session.access_token, {
      user_id: uid,
      type: "wore_outfit",
      outfit_name: outfitName,
      outfit_id: String(Date.now()),
      item_emojis: itemObjs.map(i=>i.emoji).filter(Boolean).slice(0,3),
      item_names: itemObjs.map(i=>i.name).slice(0,3),
      item_images: itemObjs.map(i=>i.sourceImage||null).slice(0,3),
      item_colors: itemObjs.map(i=>i.color||"#2A2A2A").slice(0,3),
      item_brands: itemObjs.map(i=>i.brand||"").slice(0,3),
    }).catch(()=>{});
  };

  const handleSubscribe = (planId) => {
    setCurrentPlan(planId);
    setShowPricing(false);
    if(planId!=="free") showToast(`Welcome to ${planId==="plus"?"Outfix+":"Outfix Pro"} \u2746`);
    // Persist plan tier to profiles table
    if(session?.access_token && session.user?.id){
      fetch(`${SB_URL}/rest/v1/profiles?id=eq.${session.user.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`,
          "apikey": SB_KEY,
        },
        body: JSON.stringify({ plan_tier: planId }),
      }).catch(()=>{});
    }
  };

  const planBadge = { free:null, plus:{label:"PLUS",color:G}, pro:{label:"PRO",color:"#A0B0D4"} };
  const badge = planBadge[currentPlan];

  const tabs = [
    ["home","Home",null],["closet","Closet",null],["outfits","Outfits",null],
    ["market","Market",null],["vault","Vault",null],
  ];

  // SVG nav icons — black/gold theme, consistent 20×20 viewport
  const NavIcon = ({id, active}) => {
    const c = active ? G : "#4A4038";
    const icons = {
      home: (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path d="M2 9L10 2L18 9V18H13V13H7V18H2V9Z" stroke={c} strokeWidth="1.4" strokeLinejoin="round" fill="none"/>
        </svg>
      ),
      closet: (
        <svg width="20" height="18" viewBox="0 -2 20 18" fill="none">
          <path d="M10 1 C10 1 10 0 11.5 0 C13 0 13 1.5 13 1.5 C13 2.5 12 3 10 4" stroke={c} strokeWidth="1.4" strokeLinecap="round" fill="none"/>
          <path d="M10 4 C7 5.5 2 8 1 9 C0.5 9.5 1 10 1.5 10 L18.5 10 C19 10 19.5 9.5 19 9 C18 8 13 5.5 10 4Z" stroke={c} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
        </svg>
      ),
      outfits: (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <rect x="3" y="2" width="14" height="16" rx="2" stroke={c} strokeWidth="1.4" fill="none"/>
          <line x1="6" y1="7" x2="14" y2="7" stroke={c} strokeWidth="1.3" strokeLinecap="round"/>
          <line x1="6" y1="10.5" x2="14" y2="10.5" stroke={c} strokeWidth="1.3" strokeLinecap="round"/>
          <line x1="6" y1="14" x2="11" y2="14" stroke={c} strokeWidth="1.3" strokeLinecap="round"/>
        </svg>
      ),
      market: (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path d="M3 4H17L15.5 12H4.5L3 4Z" stroke={c} strokeWidth="1.4" strokeLinejoin="round" fill="none"/>
          <circle cx="7" cy="16" r="1.5" stroke={c} strokeWidth="1.3" fill="none"/>
          <circle cx="13" cy="16" r="1.5" stroke={c} strokeWidth="1.3" fill="none"/>
          <path d="M1 1H3L3 4" stroke={c} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
          <line x1="6" y1="8" x2="6" y2="12" stroke={c} strokeWidth="1.1" strokeLinecap="round" opacity="0.6"/>
          <line x1="10" y1="8" x2="10" y2="12" stroke={c} strokeWidth="1.1" strokeLinecap="round" opacity="0.6"/>
          <line x1="14" y1="8" x2="14" y2="12" stroke={c} strokeWidth="1.1" strokeLinecap="round" opacity="0.6"/>
        </svg>
      ),
      vault: (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <rect x="2" y="3" width="16" height="14" rx="2.5" stroke={c} strokeWidth="1.4" fill="none"/>
          <circle cx="10" cy="10" r="3" stroke={c} strokeWidth="1.3" fill="none"/>
          <circle cx="10" cy="10" r="1" fill={c}/>
          <line x1="10" y1="7" x2="10" y2="5" stroke={c} strokeWidth="1.3" strokeLinecap="round"/>
          <line x1="13" y1="10" x2="15" y2="10" stroke={c} strokeWidth="1.3" strokeLinecap="round"/>
          <line x1="7" y1="10" x2="5" y2="10" stroke={c} strokeWidth="1.3" strokeLinecap="round"/>
          <line x1="18" y1="7" x2="18" y2="13" stroke={c} strokeWidth="1.4" strokeLinecap="round"/>
        </svg>
      ),
    };
    return <div style={{opacity:active?1:0.4,transition:"opacity 0.2s"}}>{icons[id]||null}</div>;
  };

  // Notification badge count
  const totalUnread = liveNotifs.filter(n=>!n.read).length;

  // Light mode overrides for the wrapper
  const wrapBg     = "#0D0D0D";
  const wrapColor  = "#F0EBE3";
  const hdrBg      = "#0D0D0D";
  const divLine    = "#1E1E1E";

  // Show loading spinner while checking saved session
  if(authLoading) return(
    <div style={{background:"#0D0D0D",minHeight:"100vh",maxWidth:430,margin:"0 auto",
      display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:16}}>
      <div style={{fontSize:36,color:"#C4A882"}}>✦</div>
      <div style={{fontFamily:"'Montserrat',sans-serif",fontSize:9,color:"#3A3028",letterSpacing:3}}>LOADING…</div>
    </div>
  );

  // Show auth screen if not signed in
  if(!session) return <AuthScreen onAuth={handleAuth}/>;

  // User info for display
  const userEmail = session?.user?.email || "";
  const userName  = session?.user?.user_metadata?.name || userEmail.split("@")[0] || "You";


  // If viewing a profile, render it as a full page — no nav, no home feed underneath
  if(viewProfile){
    return(
      <div style={{fontFamily:"'Cormorant Garamond','Georgia',serif",background:BK,minHeight:"100vh",color:"#E8E0D4",maxWidth:430,margin:"0 auto",position:"relative"}}>
        <style>{GCSS}</style>
        <UserProfilePage
          handle={typeof viewProfile==="string"?viewProfile:null}
          userId={viewProfile?.userId||null}
          username={viewProfile?.username||null}
          session={session}
          onClose={()=>setViewProfile(null)}
          onViewProfile={(u)=>setViewProfile(u)}
          showToast={showToast}
          onAddToCloset={async(item)=>{
            const newItem={...item,id:Date.now(),wearCount:0,lastWorn:"Never",purchaseDate:"",forSale:false};
            setItems(prev=>{ const next=[...prev,newItem]; checkMilestone(next.length); return next; });
            await saveItemToDB(newItem, true);
          }}
          addToWishlist={addToWishlist}
          onMessage={(userId,username)=>setActiveThread({userId,username})}
        />
        {activeThread&&(
          <MessageThread session={session} otherUserId={activeThread.userId} otherUsername={activeThread.username}
            onClose={()=>setActiveThread(null)} showToast={showToast}/>
        )}
        {/* ── BOTTOM NAV ── */}
        <div style={{
          position:"fixed",bottom:0,left:"50%",transform:"translateX(-50%)",
          width:"100%",maxWidth:430,
          background:"rgba(13,13,13,0.96)",
          borderTop:`2px solid ${G}`,
          backdropFilter:"blur(12px)",
          display:"flex",justifyContent:"space-around",alignItems:"center",
          padding:"8px 0 12px",
          zIndex:500,
        }}>
          {[["home","Home"],["closet","Closet"],["outfits","Outfits"],["market","Market"],["vault","Vault"]].map(([key,lbl])=>(
            <button key={key} onClick={()=>{setViewProfile(null);setTab(key);}} style={{
              display:"flex",flexDirection:"column",alignItems:"center",gap:3,
              background:"none",border:"none",cursor:_p,padding:"2px 6px",flex:1,
            }}>
              <NavIcon id={key} active={tab===key}/>
              <span style={{...ss(7,tab===key?700:400,tab===key?G:"#4A4038",{letterSpacing:0.8}),whiteSpace:"nowrap"}}>
                {lbl.toUpperCase()}
              </span>
              {tab===key&&<div style={{width:18,height:2,borderRadius:2,background:G,marginTop:1}}/>}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return(
    <div style={{fontFamily:"'Cormorant Garamond','Georgia',serif",background:wrapBg,minHeight:"100vh",color:wrapColor,maxWidth:430,margin:"0 auto",position:"relative",transition:"background 0.3s,color 0.3s"}}>
      <style>{GCSS}</style>

      {/* ── Invisible status bar tap target — scrolls to top like Instagram ── */}
      <div onClick={()=>document.getElementById('main-scroll')?.scrollTo({top:0,behavior:'smooth'})}
        style={{position:"fixed",top:0,left:0,right:0,height:44,zIndex:21,cursor:"pointer"}}/>

      {/* ── HEADER ── fixed so it stays on every page/scroll */}
      <div onClick={()=>document.getElementById('main-scroll')?.scrollTo({top:0,behavior:'smooth'})}
        style={{position:"fixed",top:0,left:0,right:0,maxWidth:430,margin:"0 auto",padding:"20px 24px 7px",background:hdrBg,zIndex:20,transition:"background 0.3s",borderBottom:`2px solid ${G}`,cursor:"pointer"}}>
        <div style={{..._btwn}}>
          <div style={{display:"flex",alignItems:"baseline",gap:10}}>
            <div style={sr(34,400,"#F0EBE3",{letterSpacing:3,lineHeight:1})}>Outfix</div>
            {badge&&(
              <div style={{background:`${badge.color}22`,border:`1px solid ${badge.color}55`,borderRadius:R18,padding:"3px 10px",...ss(8,700,badge.color,{letterSpacing:2})}}>
                {badge.label}
              </div>
            )}
          </div>
          <div style={{..._row,gap:14}} onClick={e=>e.stopPropagation()}>
            <button className="tb" onClick={e=>{e.stopPropagation();setShowPushNotifs(true);}} style={{width:44,height:44,borderRadius:"50%",border:`1px solid ${divLine}`,display:"flex",alignItems:"center",justifyContent:"center",background:"none",cursor:_p,position:"relative",padding:0}}>
              <svg width="22" height="22" viewBox="0 0 20 20" fill="none">
                <path d="M10 2C10 2 6 3.5 6 9V14H14V9C14 3.5 10 2 10 2Z" stroke={G} strokeWidth="1.4" strokeLinejoin="round" fill="none"/>
                <path d="M4 14H16" stroke={G} strokeWidth="1.4" strokeLinecap="round"/>
                <path d="M8.5 14C8.5 15.4 9.2 16 10 16C10.8 16 11.5 15.4 11.5 14" stroke={G} strokeWidth="1.3" strokeLinecap="round" fill="none"/>
              </svg>
              {totalUnread>0&&<div style={{position:"absolute",top:-2,right:-2,minWidth:16,height:16,borderRadius:8,background:"#CC3333",border:`2px solid ${wrapBg}`,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Montserrat',sans-serif",fontSize:8,fontWeight:700,color:"#FFFFFF",padding:"0 3px"}}>{totalUnread}</div>}
            </button>
            <button className="tb" onClick={e=>{e.stopPropagation();setShowInbox(true);setUnreadMsgCount(0);}} style={{width:44,height:44,borderRadius:"50%",border:`1px solid ${divLine}`,display:"flex",alignItems:"center",justifyContent:"center",background:"none",cursor:_p,position:"relative",padding:0}}>
              <svg width="20" height="20" viewBox="0 0 18 18" fill="none">
                <path d="M2 3H16C16.6 3 17 3.4 17 4V12C17 12.6 16.6 13 16 13H2C1.4 13 1 12.6 1 12V4C1 3.4 1.4 3 2 3Z" stroke={G} strokeWidth="1.3" fill="none" strokeLinejoin="round"/>
                <path d="M1 4L9 9L17 4" stroke={G} strokeWidth="1.3" strokeLinecap="round"/>
              </svg>
              {unreadMsgCount>0&&<div style={{position:"absolute",top:-2,right:-2,minWidth:16,height:16,borderRadius:8,background:"#CC3333",border:`2px solid ${wrapBg}`,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Montserrat',sans-serif",fontSize:8,fontWeight:700,color:"#FFFFFF",padding:"0 3px"}}>{unreadMsgCount}</div>}
            </button>
            <button className="tb" onClick={e=>{e.stopPropagation();setTab("__settings");}} style={{width:44,height:44,borderRadius:"50%",border:`1.5px solid ${G}44`,display:"flex",alignItems:"center",justifyContent:"center",background:userProfile?.avatar_url?"none":`${G}18`,cursor:_p,overflow:"hidden",padding:0}}>
              {userProfile?.avatar_url
                ? <img src={userProfile.avatar_url} style={{width:"100%",height:"100%",objectFit:"cover",objectPosition:"center top"}} alt="profile"/>
                : <span style={{fontFamily:"'Montserrat',sans-serif",fontSize:15,fontWeight:700,color:G}}>{(userProfile?.username||userName||"?")[0].toUpperCase()}</span>
              }
            </button>
          </div>
        </div>
      </div>

      {/* ── CONTENT — offset by header height ── */}
      <div id="main-scroll" className="sc" style={{height:"100vh",paddingTop:84,paddingBottom:80,boxSizing:"border-box"}}>
        {tab==="home"     && <HomeTab items={items} outfits={outfits} showToast={showToast} setTab={setTab} setWishlist={setWishlist} addToWishlist={addToWishlist} removeFromWishlist={removeFromWishlist} setItems={setItems} session={session} viewProfile={viewProfile} setViewProfile={setViewProfile} userProfile={userProfile} onMessage={(userId,username)=>setActiveThread({userId,username})} styleProfile={styleProfile} styleNudgeDismissed={styleNudgeDismissed} onDismissStyleNudge={dismissStyleNudge} onOpenStyleQuiz={openStyleQuiz} onAddToCloset={async(item)=>{
          const newItem={...item,id:Date.now()};
          setItems(prev=>{ const next=[...prev,newItem]; checkMilestone(next.length); return next; });
          await saveItemToDB(newItem, true);
        }}/>}
        {tab==="closet"    && <ClosetTab items={items} setItems={setItems} showToast={showToast} wishlist={wishlist} setWishlist={setWishlist} addToWishlist={addToWishlist} removeFromWishlist={removeFromWishlist} onSaveItem={saveItemToDB} onDeleteItem={deleteItemFromDB} onboardStep={onboardStep} advanceOnboard={advanceOnboard} externalShowAdd={showClosetAdd} onExternalShowAddHandled={()=>setShowClosetAdd(false)} closetError={closetError} onRetryCloset={loadClosetData} setTab={setTab} onMilestone={checkMilestone}/>}
        {tab==="outfits"   && <OutfitsTab items={items} outfits={outfits} setOutfits={setOutfits} setItems={setItems} showToast={showToast} logWear={logWear} onSaveOutfit={saveOutfitToDB} onDeleteOutfit={deleteOutfitFromDB} styleProfile={styleProfile} saveStyleProfile={saveStyleProfile} postWearFeedEvent={postWearFeedEvent} onboardStep={onboardStep} advanceOnboard={advanceOnboard} onOpenStyleQuiz={openStyleQuiz} styleNudgeDismissed={styleNudgeDismissed} onDismissStyleNudge={dismissStyleNudge} onOpenVacation={()=>{setVaultSection("planner");setTab("vault");}}/>}
        {tab==="market"    && <MarketTab showToast={showToast}/>}
        {tab==="vault"     && <VaultTab items={items} outfits={outfits} showToast={showToast} wishlist={wishlist} setWishlist={setWishlist} addToWishlist={addToWishlist} removeFromWishlist={removeFromWishlist} currentPlan={currentPlan} setShowPricing={setShowPricing} logWear={logWear} events={appEvents} setEvents={setAppEvents} session={session} styleProfile={styleProfile} saveStyleProfile={saveStyleProfile} onboardStep={onboardStep} advanceOnboard={advanceOnboard} initialSection={vaultSection} initialView={vaultSection==="planner"?"vacation":undefined} onInitialSectionHandled={()=>setVaultSection(null)}/>}
      </div>

      {/* ── BOTTOM NAV ── */}
      <div style={{
        position:"fixed",bottom:0,left:"50%",transform:"translateX(-50%)",
        width:"100%",maxWidth:430,
        background:"rgba(13,13,13,0.96)",
        borderTop:`2px solid ${G}`,
        backdropFilter:"blur(12px)",
        display:"flex",justifyContent:"space-around",alignItems:"center",
        padding:"8px 0 12px",
        zIndex:20,
      }}>
        {tabs.map(([key,lbl])=>{
          const isActive=tab===key;
          const iconColor=isActive?G:"#4A4038";
          return(
            <button key={key} onClick={()=>setTab(key)} style={{
              display:"flex",flexDirection:"column",alignItems:"center",gap:3,
              background:"none",border:"none",cursor:_p,padding:"2px 6px",
              flex:1,
            }}>
              <NavIcon id={key} active={isActive}/>
              <span style={{...ss(7,isActive?700:400,iconColor,{letterSpacing:0.8,transition:"color 0.2s"}),whiteSpace:"nowrap"}}>
                {lbl.toUpperCase()}
              </span>
              {isActive&&<div style={{width:18,height:2,borderRadius:2,background:G,marginTop:1}}/>}
            </button>
          );
        })}
      </div>

      {/* ── SETTINGS OVERLAY (slides up from bottom) ── */}
      {tab==="__settings"&&(
        <div onClick={()=>setTab("home")} style={{..._fix,background:"#000000BB",zIndex:90,display:"flex",alignItems:"flex-start",paddingTop:60}}>
          <div onClick={e=>e.stopPropagation()} style={{background:"#0D0D0D",borderRadius:"0 0 24px 24px",width:"100%",maxWidth:430,margin:"0 auto",border:_2a,animation:"fadeDown 0.3s ease",maxHeight:"90vh",display:"flex",flexDirection:"column"}}>
            <div style={{padding:"12px 24px 0",display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0}}>
              <div style={sr(20,400)}>Settings</div>
              <button onClick={()=>setTab("home")} style={{width:30,height:30,borderRadius:"50%",background:_1a,border:_2a,...ss(12,400,MD),cursor:_p,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
            </div>
            <div className="sc" style={{overflowY:"auto",flex:1}}>
              <SettingsTab currentPlan={currentPlan} setShowPricing={setShowPricing} showToast={showToast} items={items} outfits={outfits} userName={userName} userEmail={userEmail} onSignOut={handleSignOut} userProfile={userProfile} saveProfile={saveProfile} styleProfile={styleProfile} saveStyleProfile={saveStyleProfile} session={session} autoOpenQuiz={autoOpenQuiz} onQuizOpened={()=>setAutoOpenQuiz(false)} onViewOwnProfile={()=>{const uid=session?.user?.id;if(uid){setViewProfile({userId:uid,username:userProfile?.username||userName});}}} onNavigateToAIRules={()=>{setVaultSection("discover");setTab("vault");}} onBatchBgRemoval={runBatchBgRemoval} batchBgProgress={batchBgProgress} onResetBgProgress={()=>setBatchBgProgress(null)}/>            </div>
          </div>
        </div>
      )}

      {/* ── OVERLAYS ── */}

      {showPricing && (
        <PricingModal onClose={()=>setShowPricing(false)} onSubscribe={handleSubscribe} currentPlan={currentPlan} />

      )}

      {/* Push notification preview (new) */}
      {showPushNotifs && (
        <PushNotifPreview onClose={()=>setShowPushNotifs(false)} showToast={showToast} session={session} notifs={liveNotifs} setNotifs={setLiveNotifs} notifsLoaded={notifsLoaded} setNotifsLoaded={setNotifsLoaded} setViewProfile={setViewProfile}/>
      )}

      {showInbox&&(
        <InboxPanel session={session} onClose={()=>setShowInbox(false)}
          onOpenThread={(userId,username)=>{ setShowInbox(false); setActiveThread({userId,username}); }}
          showToast={showToast}/>
      )}

      {activeThread&&(
        <MessageThread session={session} otherUserId={activeThread.userId} otherUsername={activeThread.username}
          onClose={()=>setActiveThread(null)} showToast={showToast}/>
      )}


      {/* ── CAPSULE COLLECTIONS OVERLAY ── */}

      {/* ── ONBOARDING ── */}
      {showOnboarding && <Onboarding onDone={()=>{setShowOnboarding(false);advanceOnboard(1);}}/>}

      {/* ── FAB: Add to Closet ── */}
      {tab==="closet"&&(()=>{
        const handleFabTap=()=>{
          // If add flow already open, go to step 1 (camera/link) to add another piece
          const setStep=window.__outfix_setAddStep;
          if(setStep) setStep(1);
          else setShowClosetAdd(true);
        };
        return(
        <button
          onClick={handleFabTap}
          onTouchEnd={e=>{
            // Bypass iOS click synthesis — fire immediately on finger-release so the
            // paste-suggestion pill can't intercept the first tap
            e.preventDefault();
            handleFabTap();
          }}
          style={{position:"fixed",bottom:82,right:20,width:56,height:56,borderRadius:"50%",background:`linear-gradient(135deg,${G},#8A6E54)`,border:"none",boxShadow:"0 4px 20px #00000088",display:"flex",alignItems:"center",justifyContent:"center",cursor:_p,zIndex:50,touchAction:"manipulation"}}>
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none" style={{pointerEvents:"none"}}>
            <path d="M11 4V18M4 11H18" stroke="#0D0D0D" strokeWidth="2.2" strokeLinecap="round"/>
          </svg>
          {draftCount>0&&(
            <div style={{position:"absolute",top:-4,right:-4,minWidth:18,height:18,borderRadius:9,background:"#E05050",border:"2px solid #0D0D0D",display:"flex",alignItems:"center",justifyContent:"center",padding:"0 4px",pointerEvents:"none"}}>
              <span style={{fontFamily:"'Montserrat',sans-serif",fontSize:9,fontWeight:700,color:"#fff",lineHeight:1}}>{draftCount}</span>
            </div>
          )}
        </button>
        );
      })()}

      {/* ── STYLE QUIZ (App-level, always available) ── */}
      {showQuiz&&(()=>{
        const QUIZ_STEPS=[
          {key:"aesthetic",label:"What's your aesthetic?",multi:true,hint:"Pick up to 3",options:["Minimalist","Classic","Streetwear","Bohemian","Preppy","Romantic","Edgy","Coastal","Dark Academia","Quiet Luxury"]},
          {key:"occasions",label:"What do you mainly dress for?",multi:true,hint:"Select all that apply",options:["Work / Office","Weekends","Evenings out","Travel","Active / Athletic","Special events"]},
          {key:"fitPref",label:"How do you like your clothes to fit?",multi:true,hint:"Pick all that apply",options:["Fitted","Relaxed","Oversized","Tailored","Flowy","Structured"]},
          {key:"avoidPairings",label:"Anything you never want combined?",multi:true,hint:"Optional — helps AI avoid bad combos",options:["Athletic shoes + formal tops","Sneakers + dresses","Loud prints + patterns","Athleisure + dress shoes","Oversized top + oversized bottom"]},
          {key:"colorPalette",label:"Your colour palette?",multi:false,hint:"Pick one",options:["Neutrals only","Mostly neutrals, occasional colour","Pops of colour","Bold & expressive","Dark & moody"]},
          {key:"styleIcons",label:"Any style references? (optional)",multi:false,freeText:true,hint:"e.g. Hailey Bieber off-duty, quiet luxury, 90s minimalism",options:[]},
        ];
        const step=QUIZ_STEPS[quizStep];
        const val=quizDraft[step.key];
        const isLast=quizStep===QUIZ_STEPS.length-1;
        const [showSummary, setShowSummary] = React.useState(false);
        const toggle=(opt)=>{
          if(step.multi) setQuizDraft(d=>({...d,[step.key]:(d[step.key]||[]).includes(opt)?(d[step.key]||[]).filter(x=>x!==opt):[...(d[step.key]||[]),opt]}));
          else setQuizDraft(d=>({...d,[step.key]:opt}));
        };
        const finish=async()=>{
          if(saveStyleProfile) await saveStyleProfile({...quizDraft,quizCompleted:true});
          try{ localStorage.setItem("outfix_quiz_completed","1"); }catch(e){}
          // Clear the daily suggest flag so user gets a fresh AI outfit using their new profile
          try{ localStorage.removeItem("outfix_last_ai_suggest"); }catch(e){}
          setShowSummary(true);
        };

        // ── Summary screen — "Here's what we learned" with data-driven insights ──
        if(showSummary){
          const d = quizDraft;
          const primaryAesthetic = (d.aesthetic||[])[0] || "your style";
          const aesthetics = d.aesthetic || [];
          const occasions = d.occasions || [];
          const fits = d.fitPref || [];
          const avoids = d.avoidPairings || [];
          const palette = d.colorPalette || "";
          const ref = (d.styleIcons||"").trim();

          // Build data points that demonstrate what the AI learned
          const insights = [];

          // 1. Aesthetic direction
          if(aesthetics.length > 0){
            const aestheticText = aesthetics.length === 1
              ? `Your wardrobe leans ${aesthetics[0].toLowerCase()}`
              : `You blend ${aesthetics.slice(0,2).join(" + ").toLowerCase()}`;
            insights.push({
              icon:(
                <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
                  <path d="M10 1L11.8 8.2L19 10L11.8 11.8L10 19L8.2 11.8L1 10L8.2 8.2L10 1Z" stroke={G} strokeWidth="1.4" strokeLinejoin="round"/>
                </svg>
              ),
              label:"AESTHETIC",
              value:aestheticText,
              detail:`AI will prioritize ${aesthetics.slice(0,3).join(", ").toLowerCase()} in every suggestion.`
            });
          }

          // 2. Life occasions mix
          if(occasions.length > 0){
            const occText = occasions.length === 1
              ? `Built for ${occasions[0].toLowerCase()}`
              : `${occasions.length} main occasion${occasions.length>1?"s":""} covered`;
            insights.push({
              icon:(
                <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
                  <rect x="2" y="4" width="16" height="14" rx="2" stroke={G} strokeWidth="1.4" fill="none"/>
                  <line x1="2" y1="8.5" x2="18" y2="8.5" stroke={G} strokeWidth="1.3"/>
                  <line x1="6.5" y1="2" x2="6.5" y2="6" stroke={G} strokeWidth="1.4" strokeLinecap="round"/>
                  <line x1="13.5" y1="2" x2="13.5" y2="6" stroke={G} strokeWidth="1.4" strokeLinecap="round"/>
                </svg>
              ),
              label:"LIFESTYLE",
              value:occText,
              detail:`We'll weight suggestions toward ${occasions.slice(0,2).join(" & ").toLowerCase()} by default.`
            });
          }

          // 3. Fit preferences
          if(fits.length > 0){
            insights.push({
              icon:(
                <svg width="18" height="18" viewBox="0 0 20 22" fill="none">
                  <path d="M7 2C7 2 7.5 1 10 1C12.5 1 13 2 13 2L16.5 8H12.5L14 21H6L7.5 8H3.5L7 2Z" stroke={G} strokeWidth="1.4" strokeLinejoin="round"/>
                </svg>
              ),
              label:"SILHOUETTE",
              value:`${fits.slice(0,2).join(" & ")} fits`,
              detail:`We'll skip combinations that fight your preferred silhouette.`
            });
          }

          // 4. Color direction
          if(palette){
            const paletteShort = palette.split(",")[0].split(" —")[0];
            insights.push({
              icon:(
                <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
                  <circle cx="7" cy="7" r="3" stroke={G} strokeWidth="1.3" fill="none"/>
                  <circle cx="13" cy="7" r="3" stroke={G} strokeWidth="1.3" fill="none"/>
                  <circle cx="10" cy="13" r="3" stroke={G} strokeWidth="1.3" fill="none"/>
                </svg>
              ),
              label:"COLOR STORY",
              value:paletteShort,
              detail:`Outfit suggestions will respect your palette — no loud surprises.`
            });
          }

          // 5. Avoids (fifth card only shown when avoids exist)
          if(avoids.length > 0){
            insights.push({
              icon:(
                <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
                  <circle cx="10" cy="10" r="8" stroke={G} strokeWidth="1.4" fill="none"/>
                  <line x1="5" y1="5" x2="15" y2="15" stroke={G} strokeWidth="1.4" strokeLinecap="round"/>
                </svg>
              ),
              label:"HARD NO",
              value:`${avoids.length} combo${avoids.length>1?"s":""} blacklisted`,
              detail:`AI will never suggest these — your rules override its instincts.`
            });
          }

          return(
            <div style={{position:"fixed",inset:0,background:BK,zIndex:500,maxWidth:430,margin:"0 auto",display:"flex",flexDirection:"column",fontFamily:"'Cormorant Garamond','Georgia',serif"}}>
              <style>{GCSS}</style>
              {/* Header */}
              <div style={{flexShrink:0,padding:"20px 24px 0",display:"flex",justifyContent:"flex-end"}}>
                <button onClick={()=>{setShowQuiz(false);showToast("Style profile saved \u2746");}} style={{background:"none",border:"none",cursor:_p,...ss(20,300,DM),lineHeight:1}}>×</button>
              </div>
              {/* Content */}
              <div style={{flex:1,overflowY:"auto",padding:"12px 24px 32px"}}>
                {/* Hero */}
                <div style={{textAlign:"center",marginBottom:32}}>
                  <div style={{width:64,height:64,borderRadius:"50%",background:`linear-gradient(135deg,${G},#8A6E54)`,display:"inline-flex",alignItems:"center",justifyContent:"center",marginBottom:18,boxShadow:`0 0 36px ${G}33`}}>
                    <span style={{fontSize:24}}>✦</span>
                  </div>
                  <div style={sr(28,300,"#F0EBE3",{marginBottom:8,letterSpacing:0.3})}>Here's what we learned</div>
                  <div style={ss(11,400,DM,{lineHeight:1.6,maxWidth:300,margin:"0 auto"})}>
                    Your AI stylist now has {insights.length} data point{insights.length===1?"":"s"} to personalize every suggestion.
                  </div>
                </div>

                {/* Insight cards */}
                <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:28}}>
                  {insights.map((ins,i)=>(
                    <div key={i} style={{background:"linear-gradient(135deg,#141008,#1A1408)",borderRadius:R14,padding:"14px 16px",border:`1px solid ${G}22`,display:"flex",gap:12,alignItems:"flex-start"}}>
                      {/* Icon in gold circle */}
                      <div style={{width:36,height:36,borderRadius:9,background:`${G}12`,border:`1px solid ${G}33`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                        {ins.icon}
                      </div>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={ss(7,700,G,{letterSpacing:1.5,marginBottom:3,opacity:0.85})}>{ins.label}</div>
                        <div style={sr(15,400,"#E8E0D4",{marginBottom:4,lineHeight:1.3})}>{ins.value}</div>
                        <div style={ss(10,400,"#8A7E70",{lineHeight:1.55})}>{ins.detail}</div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Style reference — full-width editorial card */}
                {ref&&(
                  <div style={{background:`linear-gradient(135deg,${G}08,${G}14)`,border:`1px solid ${G}33`,borderRadius:R14,padding:"18px 20px",marginBottom:28,textAlign:"center"}}>
                    <div style={ss(7,700,G,{letterSpacing:2,marginBottom:8,opacity:0.85})}>STYLE REFERENCE</div>
                    <div style={sr(17,300,"#E8E0D4",{fontStyle:"italic",lineHeight:1.35})}>"{ref}"</div>
                    <div style={ss(9,400,DM,{marginTop:10,lineHeight:1.55})}>AI will calibrate to this direction when generating looks.</div>
                  </div>
                )}

                {/* Learning note */}
                <div style={{background:_1a,borderRadius:R14,padding:"14px 18px",marginBottom:24,border:_2a,display:"flex",gap:10,alignItems:"flex-start"}}>
                  <span style={{fontSize:14,color:G,flexShrink:0,lineHeight:1.2}}>✦</span>
                  <div style={ss(10,400,"#9A8E80",{lineHeight:1.6})}>
                    <span style={{color:"#E8E0D4",fontWeight:600}}>This gets smarter over time.</span> Every outfit you rate 👍 or 👎 teaches the AI more about what you actually wear.
                  </div>
                </div>

                {/* CTA */}
                <button onClick={()=>{setShowQuiz(false);setTab&&setTab("outfits");showToast("Style profile saved \u2746");}}
                  style={{width:"100%",padding:"15px",borderRadius:R14,background:`linear-gradient(135deg,${G},#8A6E54)`,border:"none",...ss(11,700,BK,{letterSpacing:2}),cursor:_p,boxShadow:`0 4px 20px ${G}22`}}>
                  TRY MY FIRST AI OUTFIT →
                </button>
                <button onClick={()=>{setShowQuiz(false);showToast("Style profile saved \u2746");}}
                  style={{width:"100%",marginTop:8,padding:"12px",borderRadius:R14,background:"none",border:"none",...ss(9,600,DM,{letterSpacing:1}),cursor:_p}}>
                  MAYBE LATER
                </button>
              </div>
            </div>
          );
        }
        return(
          <div style={{position:"fixed",inset:0,background:BK,zIndex:500,maxWidth:430,margin:"0 auto",display:"flex",flexDirection:"column",overflowY:"auto",fontFamily:"'Cormorant Garamond','Georgia',serif"}}>
            <style>{GCSS}</style>
            <div style={{flexShrink:0,padding:"18px 24px 0",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <div style={ss(9,600,DM,{letterSpacing:2})}>STYLE PROFILE</div>
              <button onClick={()=>setShowQuiz(false)} style={{background:"none",border:"none",cursor:_p,...ss(20,300,DM),lineHeight:1}}>×</button>
            </div>
            <div style={{padding:"20px 24px 48px"}}>
              <div style={{display:"flex",gap:4,marginBottom:24}}>
                {QUIZ_STEPS.map((_,i)=><div key={i} style={{flex:1,height:3,borderRadius:2,background:i<=quizStep?G:"#2A2A2A",transition:"background 0.3s"}}/>)}
              </div>
              <div style={ss(8,600,DM,{letterSpacing:2,marginBottom:8})}>{`STEP ${quizStep+1} OF ${QUIZ_STEPS.length}`}</div>
              <div style={sr(26,400,undefined,{marginBottom:6,lineHeight:1.3})}>{step.label}</div>
              <div style={ss(11,400,DM,{marginBottom:24})}>{step.hint}</div>
              {step.freeText?(
                <input value={quizDraft[step.key]||""} onChange={e=>setQuizDraft(d=>({...d,[step.key]:e.target.value}))} placeholder={step.hint}
                  style={{width:"100%",boxSizing:"border-box",background:_1a,border:_2a,borderRadius:12,padding:"14px 16px",...ss(13,400,MD),color:"#E8E0D4",outline:"none",marginBottom:28}}/>
              ):(
                <div style={{display:"flex",flexWrap:"wrap",gap:10,marginBottom:28}}>
                  {step.options.map(opt=>{
                    const active=step.multi?(val||[]).includes(opt):val===opt;
                    return <button key={opt} onClick={()=>toggle(opt)} style={{padding:"10px 18px",borderRadius:24,cursor:_p,background:active?`${G}22`:_1a,border:active?`1.5px solid ${G}`:`1px solid #2A2A2A`,...ss(11,active?600:400,active?G:DM)}}>{opt}</button>;
                  })}
                </div>
              )}
              <div style={{display:"flex",gap:10,marginTop:8}}>
                {quizStep>0&&<button onClick={()=>setQuizStep(s=>s-1)} style={{flex:1,padding:"14px",borderRadius:R14,background:_1a,border:_2a,...ss(10,600,DM,{letterSpacing:1}),cursor:_p}}>BACK</button>}
                <button onClick={isLast?finish:()=>setQuizStep(s=>s+1)} style={{flex:2,padding:"14px",borderRadius:R14,background:`linear-gradient(135deg,${G},#8A6E54)`,border:"none",...ss(10,700,BK,{letterSpacing:1.5}),cursor:_p}}>
                  {isLast?"SAVE MY PROFILE →":"NEXT →"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── MILESTONE CELEBRATION OVERLAY ── */}
      {milestone && (
        <div onClick={()=>setMilestone(null)} style={{position:"fixed",inset:0,zIndex:999,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",background:"#000000E8",maxWidth:430,margin:"0 auto",cursor:"pointer"}}>
          <style>{`
            @keyframes milestoneIn { from { transform:scale(0.6); opacity:0; } to { transform:scale(1); opacity:1; } }
            @keyframes confettiFall { 0% { transform:translateY(-20px) rotate(0deg); opacity:1; } 100% { transform:translateY(80px) rotate(360deg); opacity:0; } }
          `}</style>
          {/* Confetti particles */}
          {[...Array(18)].map((_,i)=>{
            const colors=["#C4A882","#E8D8B8","#8A6E54","#F0E8D0","#A08060","#D4BC90"];
            const left=5+(i*5.2)%90;
            const delay=(i*0.12)%1.4;
            const size=4+((i*3)%8);
            const col=colors[i%colors.length];
            return(
              <div key={i} style={{position:"absolute",top:"20%",left:`${left}%`,width:size,height:size,borderRadius:i%3===0?"50%":2,background:col,animation:`confettiFall ${1.2+delay}s ease-in ${delay*0.3}s both`}}/>
            );
          })}
          {/* Content */}
          <div style={{textAlign:"center",padding:"40px 32px",animation:"milestoneIn 0.4s cubic-bezier(0.34,1.56,0.64,1) both"}}>
            {/* Big number */}
            <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:110,fontWeight:300,lineHeight:1,color:milestone.color,marginBottom:8,textShadow:`0 0 60px ${milestone.color}66`}}>
              {milestone.count}
            </div>
            <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:18,fontWeight:300,letterSpacing:6,color:"#E8E0D4",marginBottom:24,textTransform:"uppercase"}}>
              pieces
            </div>
            {/* Divider */}
            <div style={{width:48,height:1,background:`${milestone.color}66`,margin:"0 auto 24px"}}/>
            {/* Unlock message */}
            <div style={{fontFamily:"'Montserrat',sans-serif",fontSize:11,fontWeight:600,letterSpacing:2,color:milestone.color,marginBottom:8}}>
              {milestone.emoji} {milestone.unlock.toUpperCase()}
            </div>
            <div style={{fontFamily:"'Montserrat',sans-serif",fontSize:10,fontWeight:400,letterSpacing:1,color:"#4A4038",marginTop:32}}>
              TAP TO CONTINUE
            </div>
          </div>
        </div>
      )}

      <Toast msg={toast} />
    </div>
  );
}
