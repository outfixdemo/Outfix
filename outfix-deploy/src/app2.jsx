import React, { useState, useRef, useEffect, useMemo } from "react";

// ── SUPABASE CLIENT ───────────────────────────────────────────────────────────
const SB_URL = "https://asvrbeonxmskllkshwbl.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFzdnJiZW9ueG1za2xsa3Nod2JsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4NjIyOTcsImV4cCI6MjA4OTQzODI5N30.XKcXvNydVhHcHTjCA7xJ2z7Ey82UA7ojmh81GdTyrVA";

const sbHeaders = (token) => ({
  "Content-Type": "application/json",
  "apikey": SB_KEY,
  "Authorization": `Bearer ${token || SB_KEY}`,
});

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
    console.log("Supabase signIn status:", r.status, "response:", JSON.stringify(data).slice(0,200));
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
  const [pendingSession, setPendingSession] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const inputStyle = {
    width:"100%", boxSizing:"border-box", background:"#141414",
    border:"1px solid #2A2A2A", borderRadius:12, padding:"13px 16px",
    color:"#F0EBE3", outline:"none", fontFamily:"Montserrat,sans-serif", fontSize:12,
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
        body: JSON.stringify({ id: userId, username: u }),
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
          <div style={{fontFamily:"Montserrat,sans-serif",fontSize:11,color:"#5A5048",letterSpacing:1}}>CHOOSE YOUR USERNAME</div>
        </div>

        <div style={{width:"100%",maxWidth:320}}>
          <div style={{fontFamily:"Montserrat,sans-serif",fontSize:9,color:"#5A5048",letterSpacing:1.5,marginBottom:10}}>
            This is how other Outfix users will find and follow you.
          </div>

          {/* Username input with @ prefix */}
          <div style={{display:"flex",alignItems:"center",background:"#141414",border:`1px solid ${username.trim().length>=3?"#C4A88266":"#2A2A2A"}`,borderRadius:12,padding:"13px 16px",marginBottom:10,gap:6}}>
            <span style={{fontFamily:"Montserrat,sans-serif",fontSize:14,color:"#C4A882",fontWeight:600}}>@</span>
            <input
              value={username}
              onChange={e=>{setUsername(e.target.value.replace(/\s/g,"").toLowerCase());setUsernameError("");}}
              onKeyDown={e=>e.key==="Enter"&&saveUsername()}
              placeholder="yourname"
              autoFocus
              style={{flex:1,background:"none",border:"none",outline:"none",color:"#F0EBE3",fontFamily:"Montserrat,sans-serif",fontSize:14}}
            />
            {username.length>=3&&/^[a-zA-Z0-9_\.]+$/.test(username)&&(
              <span style={{color:"#80C880",fontSize:16}}>✓</span>
            )}
          </div>

          {/* Rules hint */}
          <div style={{fontFamily:"Montserrat,sans-serif",fontSize:9,color:"#3A3028",marginBottom:usernameError?8:20,lineHeight:1.6}}>
            Letters, numbers, _ and . only · Min 3 characters
          </div>

          {usernameError&&(
            <div style={{background:"#1A0A0A",border:"1px solid #3A1A1A",borderRadius:10,padding:"9px 12px",fontFamily:"Montserrat,sans-serif",fontSize:10,color:"#C08080",marginBottom:12}}>
              {usernameError}
            </div>
          )}

          <button onClick={saveUsername} disabled={loading}
            style={{width:"100%",padding:"14px",borderRadius:12,background:loading?"#2A2A2A":"linear-gradient(135deg,#C4A882,#8A6E54)",border:"none",cursor:loading?"default":"pointer",fontFamily:"Montserrat,sans-serif",fontSize:10,fontWeight:700,color:loading?"#5A5048":"#0D0D0D",letterSpacing:1.5,marginBottom:10}}>
            {loading?"SAVING…":"LET'S GO →"}
          </button>

          <button onClick={()=>onAuth(pendingSession)}
            style={{width:"100%",padding:"11px",borderRadius:12,background:"transparent",border:"none",cursor:"pointer",fontFamily:"Montserrat,sans-serif",fontSize:9,color:"#3A3028",letterSpacing:1}}>
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
        <div style={{fontSize:10, fontWeight:400, letterSpacing:3, color:"#5A5048", marginTop:6, fontFamily:"Montserrat,sans-serif"}}>YOUR WARDROBE. ELEVATED.</div>
      </div>

      {/* Toggle */}
      <div style={{display:"flex", background:"#1A1A1A", borderRadius:12, overflow:"hidden", border:"1px solid #2A2A2A", marginBottom:24, width:"100%", maxWidth:320}}>
        {[["signin","Sign In"],["signup","Create Account"]].map(([k,l])=>(
          <button key={k} onClick={()=>{setMode(k);setError("");}}
            style={{flex:1, padding:"10px", background:mode===k?"#C4A882":"transparent", border:"none",
              fontFamily:"Montserrat,sans-serif", fontSize:10, fontWeight:mode===k?700:400,
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
            <div style={{fontFamily:"Montserrat,sans-serif",fontSize:8,color:"#5A4030",marginTop:5,letterSpacing:0.5}}>
              Outfix is currently invite-only. You need a code to create an account.
            </div>
          </div>
        )}

        {error && (
          <div style={{background:"#1A0A0A", border:"1px solid #3A1A1A", borderRadius:10,
            padding:"9px 12px", fontFamily:"Montserrat,sans-serif", fontSize:10, color:"#C08080"}}>
            {error}
          </div>
        )}

        <button onClick={submit} disabled={loading}
          style={{width:"100%", padding:"14px", borderRadius:12, marginTop:4,
            background:loading?"#2A2A2A":"linear-gradient(135deg,#C4A882,#8A6E54)",
            border:"none", cursor:loading?"default":"pointer",
            fontFamily:"Montserrat,sans-serif", fontSize:10, fontWeight:700,
            color:loading?"#5A5048":"#0D0D0D", letterSpacing:1.5}}>
          {loading ? "PLEASE WAIT…" : mode==="signup" ? "CREATE ACCOUNT" : "SIGN IN"}
        </button>
      </div>

      <div style={{marginTop:20, fontFamily:"Montserrat,sans-serif", fontSize:9,
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

const suggestions = [];

const shoppers = [
  { id:1, name:"Isabelle M.", specialty:"Parisian Minimalism", rate:"$120/hr", rating:4.9, clients:214, avatar:"👩‍💼", available:true  },
  { id:2, name:"Devon K.",    specialty:"Streetwear & Hype",   rate:"$95/hr",  rating:4.8, clients:189, avatar:"🧑‍🎤", available:true  },
  { id:3, name:"Priya S.",    specialty:"Sustainable Fashion", rate:"$85/hr",  rating:5.0, clients:97,  avatar:"👩‍🌾", available:false },
];

const initChats = {
  1: [
    { from:"shopper", text:"Bonjour! I have reviewed your closet and you have a beautiful neutral base. I would love to suggest a few statement pieces to elevate your looks.", time:"10:32 AM" },
    { from:"user",    text:"That sounds great! I feel like my outfits are always missing something.", time:"10:35 AM" },
    { from:"shopper", text:"Exactly. A structured blazer in camel or a silk scarf would do wonders. I am pulling some options from the Market now.", time:"10:36 AM" },
  ],
  2: [],
  3: [],
};


const initWishlist = [];

const calendarEvents = [];


// ── NEW FEATURE DATA ─────────────────────────────────────────────────────────

// Seller ratings data
const sellerRatings = {
  "@jess.styles":   { avg:4.8, count:34, reviews:[
    {user:"@minimal.edit",  rating:5, text:"Super fast shipping, item exactly as described. Will buy again!", date:"Mar 2026"},
    {user:"@curated.claire",rating:5, text:"Beautiful condition, even better in person. Jess is a dream seller.", date:"Feb 2026"},
    {user:"@the.closet.co", rating:4, text:"Item was great, packaging could be a bit more careful next time.", date:"Jan 2026"},
  ]},
  "@minimal.edit":  { avg:4.9, count:52, reviews:[
    {user:"@jess.styles",   rating:5, text:"Impeccably packaged. The silk dress was flawless.", date:"Mar 2026"},
    {user:"@curated.claire",rating:5, text:"Maya is the best seller on this platform. Quick, honest, gorgeous pieces.", date:"Feb 2026"},
    {user:"@the.closet.co", rating:5, text:"Everything checks out perfectly. 10/10.", date:"Jan 2026"},
  ]},
  "@the.closet.co": { avg:5.0, count:89, reviews:[
    {user:"@jess.styles",   rating:5, text:"Sofia truly curates the most stunning pieces. A++", date:"Mar 2026"},
    {user:"@minimal.edit",  rating:5, text:"The blazer arrived tissue-wrapped with a handwritten note. Incredible.", date:"Feb 2026"},
    {user:"@curated.claire",rating:5, text:"Every item I have bought from Sofia has been better than advertised.", date:"Feb 2026"},
  ]},
  "@you": { avg:4.7, count:12, reviews:[
    {user:"@jess.styles",   rating:5, text:"Great seller, honest about condition. Lovely piece!", date:"Feb 2026"},
    {user:"@minimal.edit",  rating:4, text:"Item was as described. Shipping took a little longer than expected.", date:"Jan 2026"},
  ]},
};

// Price history per market item id
const priceHistory = {
  1: [{date:"Nov 2025",price:65},{date:"Dec 2025",price:60},{date:"Jan 2026",price:55},{date:"Feb 2026",price:50},{date:"Mar 2026",price:45}],
  2: [{date:"Oct 2025",price:80},{date:"Nov 2025",price:75},{date:"Dec 2025",price:70},{date:"Jan 2026",price:65},{date:"Feb 2026",price:60},{date:"Mar 2026",price:55}],
  3: [{date:"Dec 2025",price:150},{date:"Jan 2026",price:140},{date:"Feb 2026",price:130},{date:"Mar 2026",price:120}],
  4: [{date:"Jan 2026",price:110},{date:"Feb 2026",price:100},{date:"Mar 2026",price:89}],
};
const lastSoldFor = { 1:52, 2:68, 3:125, 4:95 };

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

// Push notification scenarios
const initPushNotifs = [
  { id:"p1", type:"price_drop",  read:false, time:"Just now",  icon:"📉", title:"Price drop on your wishlist",  body:"Chelsea Boots by Sezane dropped from $270 to $229. Still 2 left in your size.", action:"View Item",     urgent:true  },
  { id:"p2", type:"new_offer",   read:false, time:"3m ago",    icon:"💬", title:"New offer on Slingback Heels", body:"@curated.claire offered $72 on your Mango Slingbacks. Listed at $89.", action:"Respond",       urgent:true  },
  { id:"p3", type:"trend_match", read:false, time:"1h ago",    icon:"✦",  title:"You're ahead of the trend",   body:"3 pieces in your closet match the Quiet Luxury trend trending this season.", action:"See Trend",    urgent:false },
  { id:"p5", type:"ootd_like",   read:true,  time:"4h ago",    icon:"♥",  title:"@minimal.edit liked your look",body:"Your 'Office Flow' OOTD post got 12 new likes today.", action:"View Post",     urgent:false },
  { id:"p6", type:"dupe_alert",  read:true,  time:"1d ago",    icon:"⚠️", title:"Duplicate detected",          body:"The Silk Slip Dress you wishlisted is very similar to your Linen Midi Dress.", action:"Compare",       urgent:false },
  { id:"p7", type:"booking",     read:true,  time:"1d ago",    icon:"📅", title:"Booking confirmed",           body:"Isabelle M. confirmed your Closet Audit for Thursday at 2:00 PM.", action:"View Booking",  urgent:false },
  { id:"p8", type:"market",      read:true,  time:"2d ago",    icon:"🛍", title:"Someone is watching your listing", body:"9 people have saved your Mini Leather Skirt. Consider a price nudge to close.", action:"View Listing",  urgent:false },
];

// Onboarding is controlled by first-run state in Root

// ── THEME ────────────────────────────────────────────────────────────────────
const G = "#C4A882"; const BK = "#0D0D0D"; const CD = "#141414";
const BR = "#1E1E1E"; const DM = "#5A5048"; const MD = "#8A7968";

const GCSS = `
  @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;1,300;1,400&family=Montserrat:wght@300;400;500;600&display=swap');
  *{box-sizing:border-box;margin:0;padding:0;}
  ::-webkit-scrollbar{width:3px;} ::-webkit-scrollbar-track{background:transparent;} ::-webkit-scrollbar-thumb{background:#3A3028;border-radius:2px;}
  .tb{background:none;border:none;cursor:pointer;transition:all 0.2s;} .tb:active{transform:scale(0.94);}
  .ch{transition:transform 0.2s;cursor:pointer;} .ch:hover{transform:translateY(-2px);}
  .pb{cursor:pointer;border:none;transition:all 0.2s;} .pb:active{transform:scale(0.96);}
  .sb{position:relative;overflow:hidden;cursor:pointer;border:none;}
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
function Tag({children}){return <span style={{background:"#1E1E1E",borderRadius:20,padding:"5px 12px",...ss(9,400,MD,{letterSpacing:1})}}>{children}</span>;}

// ── DATE PICKERS ──────────────────────────────────────────────────────────────
const MONTHS=["January","February","March","April","May","June","July","August","September","October","November","December"];
const MONTHS_SHORT=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const selStyle=(active)=>({
  flex:1,background:"#0D0D0D",border:`1px solid ${active?"#C4A882":"#2A2A2A"}`,
  borderRadius:10,padding:"9px 6px",color:active?"#C4A882":"#8A7968",
  fontFamily:"'Montserrat',sans-serif",fontSize:11,fontWeight:400,
  outline:"none",cursor:"pointer",appearance:"none",WebkitAppearance:"none",
  backgroundImage:`url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%238A7968'/%3E%3C/svg%3E")`,
  backgroundRepeat:"no-repeat",backgroundPosition:"calc(100% - 8px) center",paddingRight:22,
  textAlign:"center",
});

// Month + Year only (for purchase dates)
function MonthYearPicker({value, onChange, label}){
  const [month,setMonth]=useState(-1);
  const [year,setYear]=useState(-1);

  useEffect(()=>{
    const parts = value ? value.split(" ") : [];
    const m = parts[0] ? MONTHS_SHORT.indexOf(parts[0]) : -1;
    const y = parts[1] ? parseInt(parts[1]) : -1;
    if(m>=0) setMonth(m);
    if(y>0) setYear(y);
  },[]);

  const currentYear=new Date().getFullYear();
  const years=Array.from({length:30},(_,i)=>currentYear-i);

  const emit=(m,y)=>{
    if(m>=0 && y>0) onChange(`${MONTHS_SHORT[m]} ${y}`);
    else onChange("");
  };

  return(
    <div>
      {label&&<div style={ss(9,400,"#5A5048",{letterSpacing:1.5,textTransform:"uppercase",marginBottom:6})}>{label}</div>}
      <div style={{display:"flex",gap:8}}>
        <select value={month} onChange={e=>{const m=parseInt(e.target.value);setMonth(m);emit(m,year);}} style={selStyle(month>=0)}>
          <option value={-1}>Month</option>
          {MONTHS.map((m,i)=><option key={i} value={i}>{m}</option>)}
        </select>
        <select value={year} onChange={e=>{const y=parseInt(e.target.value);setYear(y);emit(month,y);}} style={{...selStyle(year>0),flex:"0 0 90px"}}>
          <option value={-1}>Year</option>
          {years.map(y=><option key={y} value={y}>{y}</option>)}
        </select>
      </div>
    </div>
  );
}

// Day + Month + Year (for events / travel)
function FullDatePicker({value, onChange, label}){
  const [day,setDay]=useState(-1);
  const [month,setMonth]=useState(-1);
  const [year,setYear]=useState(-1);

  useEffect(()=>{
    if(!value) return;
    const iso=value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if(iso){ setDay(parseInt(iso[3])); setMonth(parseInt(iso[2])-1); setYear(parseInt(iso[1])); return; }
    const parts=value.replace(/^[A-Za-z]+\s/,"").split(" ");
    const mIdx=MONTHS_SHORT.findIndex(ms=>parts[0]?.startsWith(ms));
    const d=parseInt(parts[1]);
    if(mIdx>=0) setMonth(mIdx);
    if(!isNaN(d)) setDay(d);
  },[]);

  const currentYear=new Date().getFullYear();
  const years=Array.from({length:5},(_,i)=>currentYear+i);
  const daysInMonth=month>=0 && year>0 ? new Date(year,month+1,0).getDate() : 31;
  const days=Array.from({length:daysInMonth},(_,i)=>i+1);

  const emit=(d,m,y)=>{
    if(d>0 && m>=0 && y>0){
      const dateObj=new Date(y,m,d);
      const wd=dateObj.toLocaleDateString("en-US",{weekday:"short"});
      onChange(`${wd} ${MONTHS_SHORT[m]} ${d}`);
    } else onChange("");
  };

  return(
    <div>
      {label&&<div style={ss(9,400,"#5A5048",{letterSpacing:1.5,textTransform:"uppercase",marginBottom:6})}>{label}</div>}
      <div style={{display:"flex",gap:8}}>
        <select value={month} onChange={e=>{const m=parseInt(e.target.value);setMonth(m);if(day>0&&year>0)emit(day,m,year);}} style={selStyle(month>=0)}>
          <option value={-1}>Month</option>
          {MONTHS.map((m,i)=><option key={i} value={i}>{m}</option>)}
        </select>
        <select value={day} onChange={e=>{const d=parseInt(e.target.value);setDay(d);if(month>=0&&year>0)emit(d,month,year);}} style={{...selStyle(day>0),flex:"0 0 68px"}}>
          <option value={-1}>Day</option>
          {days.map(d=><option key={d} value={d}>{d}</option>)}
        </select>
        <select value={year} onChange={e=>{const y=parseInt(e.target.value);setYear(y);if(day>0&&month>=0)emit(day,month,y);}} style={{...selStyle(year>0),flex:"0 0 82px"}}>
          <option value={-1}>Year</option>
          {years.map(y=><option key={y} value={y}>{y}</option>)}
        </select>
      </div>
    </div>
  );
}

// Shared calendar grid used by both pickers
function CalGrid({curMonth,setCurMonth,selectedStart,selectedEnd,onDayClick,hoverDay,setHoverDay}){
  const today=new Date(); today.setHours(0,0,0,0);
  const y=curMonth.getFullYear(), m=curMonth.getMonth();
  const daysInMonth=new Date(y,m+1,0).getDate();
  const firstDow=new Date(y,m,1).getDay();
  const monthLabel=curMonth.toLocaleString("default",{month:"long",year:"numeric"});
  const toKey=(d)=>`${y}-${String(m+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
  const prevMonth=()=>{const d=new Date(curMonth);d.setMonth(d.getMonth()-1);setCurMonth(d);};
  const nextMonth=()=>{const d=new Date(curMonth);d.setMonth(d.getMonth()+1);setCurMonth(d);};

  return(
    <div>
      {/* Month nav */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
        <button onClick={prevMonth} style={{width:32,height:32,borderRadius:"50%",background:"#1A1A1A",border:"1px solid #2A2A2A",color:MD,fontSize:16,cursor:_p,display:"flex",alignItems:"center",justifyContent:"center"}}>&#8249;</button>
        <div style={sr(15,400)}>{monthLabel}</div>
        <button onClick={nextMonth} style={{width:32,height:32,borderRadius:"50%",background:"#1A1A1A",border:"1px solid #2A2A2A",color:MD,fontSize:16,cursor:_p,display:"flex",alignItems:"center",justifyContent:"center"}}>&#8250;</button>
      </div>
      {/* Day-of-week headers */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:2,marginBottom:4}}>
        {["Su","Mo","Tu","We","Th","Fr","Sa"].map(d=>(
          <div key={d} style={{textAlign:"center",...ss(8,600,"#444",{letterSpacing:0.5,paddingBottom:3})}}>{d}</div>
        ))}
      </div>
      {/* Day cells */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:2}}>
        {Array.from({length:firstDow}).map((_,i)=><div key={"e"+i}/>)}
        {Array.from({length:daysInMonth}).map((_,i)=>{
          const d=i+1;
          const key=toKey(d);
          const dayDate=new Date(y,m,d);
          const isPast=dayDate<today;
          const isStart=key===selectedStart;
          const isEnd=key===selectedEnd;
          const isSelected=isStart||isEnd;
          const inRange=selectedStart&&selectedEnd&&key>selectedStart&&key<selectedEnd;
          const inHover=selectedStart&&!selectedEnd&&hoverDay&&key>selectedStart&&key<=hoverDay;
          const isToday=key===`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;

          let bg="#111", color="#444", border="1px solid #1A1A1A", radius=8;
          if(isSelected){bg=G;color=BK;border="none";}
          else if(inRange||inHover){bg=`${G}22`;color=G;border=`1px solid ${G}33`;}
          else if(isToday){border=`1px solid ${G}66`;color=MD;}
          if(isPast){color="#333";bg="#0D0D0D";border="1px solid #141414";}

          return(
            <div key={d}
              onClick={()=>!isPast&&onDayClick(key)}
              onMouseEnter={()=>setHoverDay&&setHoverDay(key)}
              onMouseLeave={()=>setHoverDay&&setHoverDay(null)}
              style={{aspectRatio:"1",borderRadius:radius,background:bg,border,cursor:isPast?"default":_p,display:"flex",alignItems:"center",justifyContent:"center",transition:"all 0.1s",position:"relative"}}>
              <span style={{...ss(10,isSelected?700:400,color)}}>{d}</span>
              {isStart&&selectedEnd&&<div style={{position:"absolute",top:"50%",right:0,width:"50%",height:"100%",background:`${G}22`,transform:"translateY(-50%)",zIndex:-1}}/>}
              {isEnd&&selectedStart&&<div style={{position:"absolute",top:"50%",left:0,width:"50%",height:"100%",background:`${G}22`,transform:"translateY(-50%)",zIndex:-1}}/>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Range picker for vacation (click start, click end)
function RangeDatePicker({startVal, endVal, onChangeStart, onChangeEnd}){
  const today=new Date();
  const [curMonth,setCurMonth]=useState(new Date(today.getFullYear(),today.getMonth(),1));
  const [hoverDay,setHoverDay]=useState(null);
  const [picking,setPicking]=useState("start"); // "start" | "end"

  // Parse existing values
  const parseToKey=(str)=>{
    if(!str) return null;
    const parts=str.replace(/^[A-Za-z]+\s/,"").split(" ");
    const mIdx=MONTHS_SHORT.findIndex(ms=>parts[0]?.startsWith(ms));
    const d=parseInt(parts[1]);
    const y=new Date().getFullYear();
    if(mIdx>=0&&!isNaN(d)) return `${y}-${String(mIdx+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
    return null;
  };
  const emitKey=(key)=>{
    const [ky,km,kd]=key.split("-").map(Number);
    const dateObj=new Date(ky,km-1,kd);
    const wd=dateObj.toLocaleDateString("en-US",{weekday:"short"});
    return `${wd} ${MONTHS_SHORT[km-1]} ${kd}`;
  };

  const selectedStart=parseToKey(startVal);
  const selectedEnd=parseToKey(endVal);

  const onDayClick=(key)=>{
    if(picking==="start"||(!selectedStart||key<selectedStart)){
      onChangeStart(emitKey(key));
      onChangeEnd("");
      setPicking("end");
    } else {
      onChangeEnd(emitKey(key));
      setPicking("start");
    }
  };

  return(
    <div>
      {/* Selected range display */}
      <div style={{display:"flex",gap:8,marginBottom:12}}>
        {[["CHECK-IN",startVal,()=>{setPicking("start");onChangeStart("");onChangeEnd("");}],
          ["CHECK-OUT",endVal,()=>{setPicking("end");onChangeEnd("");}]].map(([lbl,val,onClear])=>(
          <div key={lbl} onClick={()=>lbl==="CHECK-IN"?setPicking("start"):setPicking("end")}
            style={{flex:1,padding:"10px 12px",borderRadius:12,background:picking===(lbl==="CHECK-IN"?"start":"end")?`${G}22`:"#111",border:`1.5px solid ${picking===(lbl==="CHECK-IN"?"start":"end")?G:"#2A2A2A"}`,cursor:_p,position:"relative"}}>
            <div style={ss(7,600,"#5A5048",{letterSpacing:1.5,marginBottom:3})}>{lbl}</div>
            <div style={sr(13,400,val?G:DM)}>{val||"Select"}</div>
            {val&&<button onClick={e=>{e.stopPropagation();onClear();}} style={{position:"absolute",top:6,right:8,background:"none",border:"none",cursor:_p,...ss(12,400,DM)}}>×</button>}
          </div>
        ))}
      </div>
      <div style={{...ss(8,400,picking==="start"?G:DM,{letterSpacing:1,textAlign:"center",marginBottom:8})}}>
        {picking==="start"?"Click your check-in date":"Click your check-out date"}
      </div>
      <CalGrid curMonth={curMonth} setCurMonth={setCurMonth}
        selectedStart={selectedStart} selectedEnd={selectedEnd}
        onDayClick={onDayClick} hoverDay={hoverDay} setHoverDay={setHoverDay}/>
    </div>
  );
}

// Single date picker for events
function SingleDatePicker({value, onChange, label}){
  const today=new Date();
  const [curMonth,setCurMonth]=useState(new Date(today.getFullYear(),today.getMonth(),1));

  const parseToKey=(str)=>{
    if(!str) return null;
    const parts=str.replace(/^[A-Za-z]+\s/,"").split(" ");
    const mIdx=MONTHS_SHORT.findIndex(ms=>parts[0]?.startsWith(ms));
    const d=parseInt(parts[1]);
    const y=new Date().getFullYear();
    if(mIdx>=0&&!isNaN(d)) return `${y}-${String(mIdx+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
    return null;
  };
  const emitKey=(key)=>{
    const [ky,km,kd]=key.split("-").map(Number);
    const dateObj=new Date(ky,km-1,kd);
    const wd=dateObj.toLocaleDateString("en-US",{weekday:"short"});
    return `${wd} ${MONTHS_SHORT[km-1]} ${kd}`;
  };

  const selectedKey=parseToKey(value);

  return(
    <div>
      {label&&<div style={ss(9,400,DM,{letterSpacing:1.5,marginBottom:8})}>{label}</div>}
      {value&&<div style={{padding:"8px 12px",borderRadius:10,background:`${G}18`,border:`1px solid ${G}44`,marginBottom:10,..._btwn}}>
        <div style={sr(13,400,G)}>{value}</div>
        <button onClick={()=>onChange("")} style={{background:"none",border:"none",cursor:_p,...ss(12,400,DM)}}>×</button>
      </div>}
      <CalGrid curMonth={curMonth} setCurMonth={setCurMonth}
        selectedStart={selectedKey} selectedEnd={null}
        onDayClick={key=>onChange(emitKey(key))}/>
    </div>
  );
}

function Btn({children,onClick,full,outline,small,disabled}){
  const p = small?"7px 14px":"12px 20px";
  return(
    <button type="button" className="sb" onClick={onClick} disabled={disabled} style={{
      width:full?"100%":"auto", padding:p, borderRadius:14,
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
    <div style={{position:"fixed",bottom:24,left:"50%",transform:"translateX(-50%)",
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
  const bg=useImageBg(item.sourceImage, item.color||"#1A1A1A");
  return(
    <div className="ch" onClick={onSelect} style={{background:selected?"#1A1610":CD,borderRadius:16,overflow:"hidden",border:selected?`1.5px solid ${G}66`:`1px solid ${BR}`,position:"relative"}}>
      <div style={{height:160,background:item.sourceImage?bg:`linear-gradient(135deg,${item.color}22,${item.color}55)`,display:"flex",alignItems:"center",justifyContent:"center",position:"relative",overflow:"hidden",transition:"background 0.4s ease"}}>
        {item.sourceImage
          ? <img src={item.sourceImage} style={{width:"100%",height:"100%",objectFit:"contain",padding:"8px",boxSizing:"border-box"}} alt={item.name}/>
          : <ItemIllustration item={item} size={110}/>
        }
        {item.forSale && <div style={{position:"absolute",top:8,right:8,background:G,color:BK,...ss(8,700,BK,{letterSpacing:1,padding:"3px 7px",borderRadius:10})}}>FOR SALE</div>}
        {item.wearCount===0 && <div style={{position:"absolute",top:8,left:8,background:"#2A1A1A",...ss(8,600,"#C4A0A0",{letterSpacing:1,padding:"3px 7px",borderRadius:10})}}>UNWORN</div>}
        <button onClick={e=>{e.stopPropagation();onToggleFav();}} style={{position:"absolute",bottom:8,right:8,width:28,height:28,borderRadius:"50%",background:"#0D0D0D99",border:"none",display:"flex",alignItems:"center",justifyContent:"center",cursor:_p,fontSize:14,backdropFilter:"blur(4px)"}}>
          <span style={{color:isFav?G:"#4A4038",transition:"color 0.15s"}}>{isFav?"♥":"♡"}</span>
        </button>
      </div>
      <div style={{padding:"10px 12px 12px"}}>
        <div style={sr(14,500,"#E8E0D4",{lineHeight:1.2})}>{item.name}</div>
        <div style={{..._btwn,marginTop:3}}>
          <div style={{..._row,gap:5}}>
            {(()=>{const cols=item.colors&&item.colors.length>1?item.colors:[item.color];return <div style={{width:8,height:8,borderRadius:"50%",flexShrink:0,border:"1px solid #FFFFFF22",background:cols.length===1?cols[0]:`conic-gradient(${cols.map((c,i)=>`${c} ${i/cols.length*360}deg ${(i+1)/cols.length*360}deg`).join(",")})`}}/>;})()}
            <div style={ss(9,400,DM,{letterSpacing:1})}>{item.brand}</div>
          </div>
          <div style={ss(9,400,DM)}>Worn {item.wearCount}x</div>
        </div>
      </div>
    </div>
  );
}

// ── HOME ─────────────────────────────────────────────────────────────────────
// ── STORY VIEWER ─────────────────────────────────────────────────────────────
function HomeTab({items,outfits,showToast,setTab,setWishlist,addToWishlist,removeFromWishlist,setItems,session,onAddToCloset,viewProfile,setViewProfile,userProfile}){
  const [liked,setLiked]         = useState({});
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
  const [refreshing,setRefreshing] = useState(false);
  const [pullProgress,setPullProgress] = useState(0);
  const [feedHasMore,setFeedHasMore] = useState(false);
  const [feedOffset,setFeedOffset] = useState(0);
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
    } catch(e){ console.log("Feed load error:", e); }
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

      // Direction 1: who do my followers also follow?
      if(myFollowerIds.length > 0){
        const res = await fetch(`${SB_URL}/rest/v1/follows?follower_id=in.(${myFollowerIds.join(",")})&select=following_id`, {headers}).then(r=>r.json());
        if(Array.isArray(res)) res.forEach(f=>addCandidate(f.following_id));
      }

      // Direction 2: who else follows the same people I follow?
      if(myFollowingIds.length > 0){
        const res = await fetch(`${SB_URL}/rest/v1/follows?following_id=in.(${myFollowingIds.join(",")})&select=follower_id`, {headers}).then(r=>r.json());
        if(Array.isArray(res)) res.forEach(f=>addCandidate(f.follower_id));
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
    } catch(e){ console.log("Suggested accounts error:", e); }
    setSuggestedLoading(false);
  };

  const now = new Date();
  const dayName = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][now.getDay()];
  const greeting = now.getHours()<12?"Morning":now.getHours()<17?"Afternoon":"Evening";
  const nextEvent = calendarEvents[1]||calendarEvents[0];
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
      showToast(item.name+" added to closet ✦");
      return [...prev, newItem];
    });
    setActiveItem(null);
  };

  // ── Live event card (wore outfit / added item) ──
  const LiveEventCard = ({event}) => {
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
    return(
      <div style={{background:CD,borderRadius:20,overflow:"hidden",marginBottom:20,border:`1px solid ${G}22`}}>
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
          <div style={{position:"absolute",top:10,left:12,background:isWore?"#1A2A1A":"#1A1A2A",border:isWore?"1px solid #2A5A2A":"1px solid #2A2A5A",borderRadius:8,padding:"3px 9px",...ss(7,700,isWore?"#80C880":"#8080C8",{letterSpacing:1})}}>
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
        </div>
      </div>
    );
  };

  // ── Render a single community post card ──
  const POST_ACCENTS = ["#C4A882","#8A7A9A","#7A9A8A","#9A8A7A","#8A9A7A"];
  // ── Today's Suggestion card (acts like a pinned post) ──
  // ── Next Event card (compact) ──
  const EventCard = ()=>nextEvent?(
    <div onClick={()=>setTab("vault")} style={{background:"linear-gradient(135deg,#0F1A2E,#162236)",borderRadius:14,padding:"10px 14px",border:"1px solid #2A3A5A",marginBottom:14,cursor:_p,display:"flex",gap:12,alignItems:"center"}}>
      <div style={{width:34,height:34,borderRadius:10,background:"#1A2A4A",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>{nextEvent.emoji}</div>
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
        style={{borderRadius:18,marginBottom:16,overflow:"hidden",border:`1px solid ${BR}`,cursor:_p}}>
        <div style={{height:64,background:`linear-gradient(135deg,${trend.palette[0]}66,${trend.palette[1]}99,${trend.palette[2]}66)`,display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0 16px"}}>
          <div style={ss(7,700,DM,{letterSpacing:2,background:"#0D0D0D55",padding:"3px 8px",borderRadius:6,backdropFilter:"blur(4px)"})}>TRENDING NOW</div>
          <div style={{display:"flex",gap:6}}>
            {trend.palette.map((c,i)=><div key={i} style={{width:14,height:14,borderRadius:"50%",background:c,border:"1.5px solid #0D0D0D44"}}/>)}
          </div>
        </div>
        <div style={{background:CD,padding:"14px 16px"}}>
          <div style={{..._btwn,marginBottom:6}}>
            <div style={sr(18,500)}>{trend.trend}</div>
            {closetMatches>0&&<div style={{background:"#0A1A0A",border:"1px solid #1A3A1A",borderRadius:10,padding:"3px 10px",...ss(8,700,"#60A870",{letterSpacing:0.8}),flexShrink:0,marginLeft:8}}>{closetMatches} in your closet</div>}
          </div>
          <div style={ss(9,400,DM,{marginBottom:8,letterSpacing:0.5})}>{trend.source} · {trend.season}</div>
          <div style={ss(10,400,"#9A9080",{lineHeight:1.6,marginBottom:10})}>{trend.description.slice(0,100)}…</div>
          <div style={{..._btwn}}>
            <div style={{display:"flex",gap:5}}>{trend.tags.map(t=><span key={t} style={{background:_1a,borderRadius:20,padding:"3px 10px",...ss(8,400,DM,{letterSpacing:0.8})}}>{t}</span>)}</div>
            <div style={ss(9,600,G)}>Explore →</div>
          </div>
        </div>
      </div>
    );
  };

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
                    <div style={{fontSize:18,animation:"spin 1s linear infinite",display:"inline-block",marginBottom:6}}>✦</div>
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
                      <div style={ss(8,400,DM,{marginTop:1})}>{acct.mutualCount} mutual follower{acct.mutualCount!==1?"s":""}</div>
                    </div>
                    <button onClick={e=>{
                      e.stopPropagation();
                      const myId = session?.user?.id;
                      if(!myId) return;
                      fetch(`${SB_URL}/rest/v1/follows`,{method:"POST",headers:{...sbHeaders(session.access_token),"Prefer":"return=representation"},body:JSON.stringify({follower_id:myId,following_id:acct.id})})
                        .then(()=>{ setSuggestedAccounts(prev=>prev.filter(a=>a.id!==acct.id)); showToast(`Following @${acct.username} \u2746`); })
                        .catch(()=>showToast(`Following @${acct.username} \u2746`));
                    }} style={{padding:"6px 14px",borderRadius:20,background:`${G}22`,border:`1px solid ${G}55`,...ss(9,600,G,{letterSpacing:0.5}),cursor:_p,flexShrink:0}}>
                      Follow
                    </button>
                  </div>
                ))}
              </React.Fragment>
            ) : (
              <React.Fragment>
                {searchLoading&&(
                  <div style={{textAlign:"center",padding:"32px 0"}}>
                    <div style={{fontSize:22,animation:"spin 1s linear infinite",display:"inline-block",marginBottom:8}}>✦</div>
                    <div style={ss(10,400,DM)}>Searching users…</div>
                  </div>
                )}
                {!searchLoading&&userResults.length>0&&(
                  <React.Fragment>
                    <div style={ss(9,600,DM,{letterSpacing:1.5,marginBottom:12})}>USERS</div>
                    {userResults.map(u=>(
                      <div key={u.id} style={{..._row,gap:12,marginBottom:14,cursor:_p,background:CD,borderRadius:14,padding:"12px 14px",border:`1px solid ${BR}`}}
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
      {feedLoading && liveEvents.length === 0 && !refreshing && (
        <div style={{textAlign:"center",padding:"12px 0",marginBottom:4}}>
          <div style={ss(9,400,DM,{letterSpacing:1,animation:"pulse 1.2s infinite"})}>Loading following feed…</div>
        </div>
      )}

      {/* ── Empty feed state ── */}
      {!feedLoading && liveEvents.length === 0 && (
        <div style={{textAlign:"center",padding:"60px 24px 40px",display:"flex",flexDirection:"column",alignItems:"center",gap:12}}>
          <div style={{fontSize:40,marginBottom:4}}>👗</div>
          <div style={sr(20,400)}>Your feed is empty</div>
          <div style={ss(11,400,DM,{lineHeight:1.6,maxWidth:260})}>Follow some friends to see their outfits and closet updates here</div>
          <div style={{marginTop:8,background:`${G}18`,border:`1px solid ${G}44`,borderRadius:20,padding:"8px 20px",...ss(9,600,G,{letterSpacing:1})}}>✦ Discover people in the feed tab</div>
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

      {/* ── User profile overlay ── */}
      {viewProfile&&<UserProfilePage
        handle={typeof viewProfile==="string"?viewProfile:null}
        userId={viewProfile?.userId||null}
        username={viewProfile?.username||null}
        session={session}
        onClose={()=>setViewProfile(null)}
        onViewProfile={(u)=>setViewProfile(u)}
        showToast={showToast}
        onAddToCloset={onAddToCloset}
        addToWishlist={addToWishlist}
      />}

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
              {selectedTrend.tags.map(t=><span key={t} style={{background:_1a,borderRadius:20,padding:"4px 12px",...ss(9,400,MD,{letterSpacing:0.8})}}>{t}</span>)}
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
              <div key={i} style={{..._btwn,background:CD,borderRadius:14,padding:"12px 14px",marginBottom:8,border:`1px solid ${BR}`}}>
                <div style={{..._row,gap:10}}>
                  <div style={{width:36,height:36,borderRadius:10,background:_1a,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20}}>{s.emoji}</div>
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
                <button onClick={()=>{handleWishlist(selectedFeedItem);setSelectedFeedItem(null);}} style={{flex:1,padding:"12px",borderRadius:14,background:"#1A1A2A",border:`1px solid ${G}44`,...ss(10,600,G,{letterSpacing:1}),cursor:_p}}>♡ WISHLIST</button>
                <button onClick={()=>{handleAddToCloset(selectedFeedItem);setSelectedFeedItem(null);}} style={{flex:1,padding:"12px",borderRadius:14,background:`linear-gradient(135deg,${G},#8A6E54)`,border:"none",...ss(10,700,BK,{letterSpacing:1.5}),cursor:_p}}>+ CLOSET</button>
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
                  <div key={l} style={{flex:1,background:"#111",borderRadius:10,padding:"8px 4px",textAlign:"center",border:"1px solid #1E1E1E"}}>
                    <div style={sr(13,500,G)}>{v}</div>
                    <div style={ss(7,400,DM,{letterSpacing:1,marginTop:2})}>{l}</div>
                  </div>
                ))}
              </div>
              <div style={{display:"flex",gap:8}}>
                <button onClick={()=>{handleWishlist(selectedFeedItem);setSelectedFeedItem(null);}} style={{flex:1,padding:"12px",borderRadius:14,background:"#1A1A2A",border:`1px solid ${G}44`,...ss(10,600,G,{letterSpacing:1}),cursor:_p}}>♡ WISHLIST</button>
                <button onClick={()=>{handleAddToCloset(selectedFeedItem);setSelectedFeedItem(null);}} style={{flex:1,padding:"12px",borderRadius:14,background:`linear-gradient(135deg,${G},#8A6E54)`,border:"none",...ss(10,700,BK,{letterSpacing:1.5}),cursor:_p}}>+ CLOSET</button>
              </div>
            </React.Fragment>
          )}
        </div>
      </div>
    </div>
  )}
    </React.Fragment>
  );
}

// ── CLOSET DETAIL IMAGE (needs own component to use useImageBg hook) ──────────
function ClosetDetailImage({item, onSaveItem, setItems, setSelectedClosetItem, showToast}){
  const bg = useImageBg(item.sourceImage, item.color||"#1A1A1A");
  const [cropSrc, setCropSrc] = useState(null);
  return(
    <React.Fragment>
      {cropSrc&&(
        <CropModal
          src={cropSrc}
          onCancel={()=>setCropSrc(null)}
          onSave={async cropped=>{
            setCropSrc(null);
            const updated={...item,sourceImage:cropped};
            setItems(prev=>prev.map(x=>x.id===item.id?updated:x));
            setSelectedClosetItem(updated);
            if(onSaveItem) onSaveItem(updated);
            showToast("Photo updated \u2746");
          }}
          autoRemoveBg={true}
        />
      )}
      <div style={{position:"relative",width:"100%",height:200,background:item.sourceImage?bg:`linear-gradient(135deg,${item.color||"#2A2A2A"}22,${item.color||"#2A2A2A"}44)`,borderRadius:12,overflow:"hidden",marginBottom:12,transition:"background 0.4s ease"}}>
        {item.sourceImage
          ?<img src={item.sourceImage} style={{width:"100%",height:"100%",objectFit:"contain",padding:12,boxSizing:"border-box"}} alt={item.name}/>
          :<div style={{width:"100%",height:"100%",display:"flex",alignItems:"center",justifyContent:"center"}}><ItemIllustration item={item} size={120}/></div>
        }
        <label style={{position:"absolute",bottom:8,right:8,background:"#0D0D0DAA",borderRadius:10,padding:"5px 10px",cursor:"pointer",display:"flex",alignItems:"center",gap:5,backdropFilter:"blur(4px)",border:`1px solid ${"#C4A882"}44`}}>
          <input type="file" accept="image/*" style={{display:"none"}} onChange={e=>{
            const file=e.target.files?.[0]; if(!file) return;
            const reader=new FileReader();
            reader.onload=ev=>setCropSrc(ev.target.result);
            reader.readAsDataURL(file);
          }}/>
          <span style={{fontSize:11}}>📷</span>
          <span style={{fontSize:8,fontWeight:600,color:"#C4A882",letterSpacing:0.5}}>CHANGE PHOTO</span>
        </label>
      </div>
    </React.Fragment>
  );
}

// ── CLOSET ───────────────────────────────────────────────────────────────────
function ClosetTab({items,setItems,setSelectedItem,showToast,wishlist,setWishlist,addToWishlist,removeFromWishlist,onSaveItem,onDeleteItem,onboardStep=4,advanceOnboard}){
  const [closetView,setClosetView]=useState("closet"); // "closet" | "wishlist"
  const [filterCat,setFilterCat]=useState("All");
  const [filterSale,setFilterSale]=useState(false);
  const [sortBy,setSortBy]=useState("date_new");
  const [closetSearch,setClosetSearch]=useState("");
  const [showFilterMenu,setShowFilterMenu]=useState(false);
  const [showSortExpanded,setShowSortExpanded]=useState(false);
  const [showCatExpanded,setShowCatExpanded]=useState(false);
  const [showAdd,setShowAdd]=useState(false);
  const [selectedClosetItem,setSelectedClosetItem]=useState(null);
  const [mName,setMName]=useState("");
  const [mBrand,setMBrand]=useState("");
  const [mPrice,setMPrice]=useState("");
  const [mCat,setMCat]=useState("Tops");
  const [mDate,setMDate]=useState("");
  const [mCondition,setMCondition]=useState("Good");
  const [mColor,setMColor]=useState("#C4A882");
  const [mColors,setMColors]=useState(["#C4A882"]); // multicolor support
  const [showBrandList,setShowBrandList]=useState(false);
  const [selectedWishItem,setSelectedWishItem]=useState(null);
  const [wishCropSrc,setWishCropSrc]=useState(null);
  const wishPhotoRef=useRef();
  const [showReverseSearch,setShowReverseSearch]=useState(false);
  const [url,setUrl]=useState("");
  const [scanning,setScanning]=useState(false);
  const [scanned,setScanned]=useState(null);
  const [addMode,setAddMode]=useState(null);
  const [describeResults,setDescribeResults]=useState([]);
  const [describeLoading,setDescribeLoading]=useState(false);
  const [voiceDesc,setVoiceDesc]=useState("");
  const [favorites,setFavorites]=useState(new Set([1,9]));
  const [photoPreview,setPhotoPreview]=useState(null);
  const [manualCropSrc,setManualCropSrc]=useState(null);
  const [scanCropSrc,setScanCropSrc]=useState(null);
  const [scanCropConfirm,setScanCropConfirm]=useState(true);
  const [scanCropBgRemove,setScanCropBgRemove]=useState(false); // true = remove bg after crop
  const [priceOverride,setPriceOverride]=useState("");
  const [detectedItems,setDetectedItems]=useState([]);
  const [selectedDetected,setSelectedDetected]=useState({});
  const fileRef=useRef();
  const manualFileRef=useRef();
  const photoOverrideRef=useRef();
  const cats=["All","Favorites","Tops","Bottoms","Dresses","Outerwear","Shoes","Accessories"];
  const filtered=(()=>{
    let base = filterCat==="All" ? items
      : filterCat==="Favorites" ? items.filter(i=>favorites.has(i.id))
      : items.filter(i=>i.category===filterCat);
    if(filterSale) base=base.filter(i=>i.forSale);
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
  const isFiltered = filterCat!=="All" || filterSale || sortBy!=="date_new" || closetSearch.trim()!=="";
  const clearFilters=()=>{setFilterCat("All");setFilterSale(false);setSortBy("default");setClosetSearch("");};

  const toggleFav=(e,id)=>{
    e.stopPropagation();
    setFavorites(prev=>{
      const n=new Set(prev);
      if(n.has(id)){n.delete(id);showToast("Removed from favorites \u2746");}
      else{n.add(id);showToast("Added to favorites \u2746");}
      return n;
    });
  };



  const setScannedItem=(item)=>{ setScanned(item); setPriceOverride(item ? String(item.price||"") : ""); };

  const doScan=async(fileOrDataUrl)=>{
    // Accept either a File object or an already-cropped dataUrl string
    const dataUrl = typeof fileOrDataUrl === "string"
      ? fileOrDataUrl
      : await new Promise(res=>{ const r=new FileReader(); r.onload=e=>res(e.target.result); r.readAsDataURL(fileOrDataUrl); });
    setScanning(true); setScanned(null); setDetectedItems([]); setSelectedDetected({});
    setPhotoPreview(dataUrl); // show original as preview while scanning
    try{
          const base64=dataUrl.split(",")[1];
          const raw=await callClaudeVision(base64,file.type,
            `Identify ALL visible clothing items and accessories worn or shown in this image. Return ONLY JSON: {"items":[{"id":1,"name":"...","brand":"...","category":"Tops|Bottoms|Dresses|Outerwear|Shoes|Accessories","color":"#hexcode","colorName":"e.g. Dark Brown","price":150,"tags":["..."],"emoji":"👚","condition":"Like New"},...]}`
          );
          const json=JSON.parse(raw.replace(/```json|```/g,"").trim());
          const found=json.items||[];

          // For each identified item, fetch a clean stock image in background
          const fetchStockImage=async(item)=>{
            try{
              const q=`${item.brand||""} ${item.name}${item.colorName?" "+item.colorName:""} product photo white background`.trim();
              const res=await fetch("/api/image-search",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({query:q})}).then(r=>r.json()).catch(()=>({imageUrl:null}));
              return res.imageUrl||null;
            }catch(e){return null;}
          };

          setScanning(false);
          if(found.length===1){
            const stockImg=await fetchStockImage(found[0]);
            // Store original dataUrl so user can crop/remove BG before saving
            setScannedItem({...found[0],wearCount:0,lastWorn:"Never",purchaseDate:"",forSale:false,stockImage:stockImg||null,_originalPhoto:dataUrl});
          } else if(found.length>1){
            // Fetch stock images for all detected items
            const withStock=await Promise.all(found.map(async item=>({...item,stockImage:await fetchStockImage(item)})));
            setDetectedItems(withStock);
            setSelectedDetected(Object.fromEntries(withStock.map(i=>[i.id,true])));
          } else {
            // Nothing detected — drop into manual add with photo pre-loaded
            setAddMode("manual");
            showToast("Couldn't identify item — fill in the details below \u2746");
          }
        }catch(err){
          setScanning(false);
          // On error — drop into manual add with photo pre-loaded
          setAddMode("manual");
          showToast("Couldn't recognize item — fill in the details below \u2746");
        }
  };

  // Scan directly from original file — crop happens AFTER AI identifies the item
  const doScanFile=(file)=>{
    if(!file||!file.type.startsWith("image/")) return;
    doScan(file);
  };

  // Simulate voice recording then AI parse
  const confirmAdd=(croppedPhoto)=>{
    const finalPrice = priceOverride.trim() ? parseInt(priceOverride) : scanned.price;
    // Use cropped photo if provided, else stock image, else original photo
    const finalImage = croppedPhoto || (scanned.useUserPhoto ? (photoPreview||undefined) : (scanned.stockImage || photoPreview || undefined));
    const newItem={...scanned,id:Date.now(),price:finalPrice,sourceImage:finalImage};
    setItems(prev=>[...prev,newItem]);
    if(onSaveItem) onSaveItem(newItem);
    closeAdd();
    showToast("Item added to your closet \u2746");
  };

  const confirmAddMulti=()=>{
    const toAdd=detectedItems.filter(i=>selectedDetected[i.id]);
    const now=Date.now();
    const newItems=toAdd.map((item,idx)=>({...item,id:now+idx,wearCount:0,lastWorn:"Never",purchaseDate:"",forSale:false,sourceImage:item.stockImage||photoPreview||undefined}));
    setItems(prev=>[...prev,...newItems]);
    if(onSaveItem) newItems.forEach(item=>onSaveItem(item));
    closeAdd();
    showToast(`${toAdd.length} item${toAdd.length>1?"s":""} added to your closet \u2746`);
  };

  const closeAdd=()=>{setShowAdd(false);setScanned(null);setUrl("");setAddMode(null);setVoiceDesc("");setPhotoPreview(null);setManualCropSrc(null);setDetectedItems([]);setSelectedDetected({});setDescribeResults([]);setDescribeLoading(false);setMName("");setMBrand("");setMPrice("");setMCat("Tops");setMDate("");setMCondition("Good");setMColor("#C4A882");setMColors(["#C4A882"]);setShowBrandList(false);};

  return(
    <div className="fu" style={{padding:"16px 24px"}}>
      <style>{`
        @keyframes wave{from{height:6px;opacity:0.4;}to{height:28px;opacity:1;}}
        @keyframes spin{from{transform:rotate(0deg);}to{transform:rotate(360deg);}}
      `}</style>

      {/* ── ONBOARDING STEP 1 BANNER ── */}
      {onboardStep===1&&closetView==="closet"&&(()=>{
        const hasTop=items.some(i=>["Tops","Dresses"].includes(i.category));
        const hasBottom=items.some(i=>["Bottoms","Dresses"].includes(i.category));
        const hasShoes=items.some(i=>["Shoes"].includes(i.category));
        const slots=[{label:"Top",emoji:"👚",done:hasTop},{label:"Bottom",emoji:"👖",done:hasBottom},{label:"Shoes",emoji:"👟",done:hasShoes}];
        const allDone=hasTop&&hasBottom&&hasShoes;
        if(allDone&&advanceOnboard) advanceOnboard(2);
        return(
          <div style={{background:"linear-gradient(135deg,#1A1610,#141008)",border:`1px solid ${G}44`,borderRadius:14,padding:"14px 16px",marginBottom:16}}>
            <div style={{..._row,gap:8,marginBottom:10}}>
              <span style={{fontSize:14}}>✦</span>
              <div style={ss(10,700,G,{letterSpacing:1})}>STEP 1 OF 3 — BUILD YOUR CLOSET</div>
            </div>
            <div style={ss(11,400,"#A09080",{marginBottom:12,lineHeight:1.5})}>Add a top, bottom, and shoes to build your first outfit</div>
            <div style={{display:"flex",gap:10}}>
              {slots.map(s=>(
                <div key={s.label} style={{flex:1,background:s.done?`${G}18`:"#111",borderRadius:10,padding:"8px 4px",textAlign:"center",border:s.done?`1px solid ${G}44`:"1px solid #2A2A2A",transition:"all 0.3s"}}>
                  <div style={{fontSize:18,marginBottom:3}}>{s.done?"✓":s.emoji}</div>
                  <div style={ss(8,s.done?600:400,s.done?G:DM,{letterSpacing:0.5})}>{s.label}</div>
                </div>
              ))}
            </div>
            {allDone&&<div style={{marginTop:10,...ss(9,600,G,{textAlign:"center",letterSpacing:1})}}>✦ Ready to build your first outfit!</div>}
          </div>
        );
      })()}

      {/* Header */}
      <div style={{..._btwnS,marginBottom:14}}>
        <div>
          <div style={sr(22,300)}>{closetView==="closet"?"Your Closet":"Wishlist"}</div>
          <div style={ss(10,400,DM,{letterSpacing:1,marginTop:2})}>
            {closetView==="closet"
              ? isFiltered
                ? `${filtered.length} OF ${items.length} PIECES SHOWN`
                : `${items.length} PIECES · $${items.reduce((s,i)=>s+i.price,0).toLocaleString()} VALUE`
              : `${wishlist.length} SAVED ITEMS`}
          </div>
        </div>
        {closetView==="closet" && isFiltered && (
          <button onClick={clearFilters} style={{padding:"5px 12px",borderRadius:20,background:"#2A1A1A",border:"1px solid #4A2A2A",...ss(9,600,"#C09090",{letterSpacing:1}),cursor:_p}}>× CLEAR</button>
        )}
      </div>

      {/* Closet / Wishlist toggle */}
      <div style={{display:"flex",background:"#111",borderRadius:14,overflow:"hidden",border:"1px solid #1E1E1E",marginBottom:16}}>
        {[["closet","Closet"],["wishlist","Wishlist ♡"]].map(([k,l])=>(
          <button key={k} onClick={()=>setClosetView(k)} style={{flex:1,padding:"9px 4px",background:closetView===k?`linear-gradient(135deg,${G},#8A6E54)`:"transparent",border:"none",cursor:_p,...ss(9,closetView===k?600:400,closetView===k?BK:DM,{letterSpacing:0.5})}}>
            {l}
          </button>
        ))}
      </div>

      {/* ── WISHLIST VIEW ── */}
      {closetView==="wishlist"&&(
        <React.Fragment>
          <div onClick={()=>setShowReverseSearch(true)} style={{background:"linear-gradient(135deg,#1A160F,#141008)",borderRadius:16,padding:"14px 18px",border:`1px solid ${G}44`,marginBottom:14,cursor:_p,display:"flex",gap:14,alignItems:"center"}}>
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
                  <div key={item.id} className="ch" onClick={()=>setSelectedWishItem(item)} style={{background:CD,borderRadius:16,overflow:"hidden",border:`1px solid ${BR}`,position:"relative",cursor:_p}}>
                    {/* Image area */}
                    <div style={{height:120,background:`linear-gradient(135deg,${item.color||G}22,${item.color||G}44)`,display:"flex",alignItems:"center",justifyContent:"center",position:"relative",overflow:"hidden"}}>
                      {item.sourceImage
                        ?<img src={item.sourceImage} style={{width:"100%",height:"100%",objectFit:"cover"}} alt={item.name}/>
                        :<ItemIllustration item={item} size={80}/>
                      }
                      {item.inMarket&&<div style={{position:"absolute",top:8,right:8,background:"#1A3A1A",border:"1px solid #2A5A2A",borderRadius:8,padding:"2px 7px",...ss(7,700,"#80C880",{letterSpacing:0.8})}}>IN MARKET</div>}
                      {item.sourceUrl&&!item.inMarket&&<div style={{position:"absolute",top:8,right:8,background:"#0D0D0DCC",borderRadius:8,padding:"2px 7px",backdropFilter:"blur(4px)",...ss(7,600,G,{letterSpacing:0.5})}}>🔗 URL</div>}
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
              <Btn onClick={()=>showToast("Finding market matches\u2026 \u2746")} full>FIND IN MARKET</Btn>
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

        {/* Filter dropdown panel */}
        {showFilterMenu&&(
          <div style={{background:"#0F0F0F",borderRadius:14,border:_2a,padding:"16px",marginBottom:12}}>
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
                  <div style={{background:"#2C2C2E",borderRadius:14,overflow:"hidden",marginBottom:8}}>
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
                    width:"100%",padding:"16px",borderRadius:14,background:"#2C2C2E",border:"none",cursor:_p,
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
                    {{"default":"Default","date_new":"Date: Newest → Oldest","date_old":"Date: Oldest → Newest","worn_desc":"Worn: Most → Least","worn_asc":"Worn: Least → Most","price_desc":"Price: High → Low","price_asc":"Price: Low → High"}[sortBy]}
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
                  <div style={{background:"#2C2C2E",borderRadius:14,overflow:"hidden",marginBottom:8}}>
                    <div style={{padding:"12px 16px 8px",textAlign:"center"}}>
                      <div style={ss(13,500,"#8E8E93")}>Sort By</div>
                    </div>
                    {[
                      ["default","Default"],
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
                    width:"100%",padding:"16px",borderRadius:14,background:"#2C2C2E",border:"none",
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
                <div style={{position:"absolute",top:2,left:filterSale?22:2,width:20,height:20,borderRadius:10,background:"#FFF",transition:"left 0.2s"}}/>
              </button>
            </div>

            {/* Apply / Clear */}
            <div style={{..._row,gap:8,marginTop:14}}>
              {isFiltered&&<button onClick={()=>{clearFilters();setShowFilterMenu(false);}} style={{flex:1,padding:"8px",borderRadius:10,background:"#1A1A1A",border:"1px solid #3A2A2A",...ss(9,600,"#C09090",{letterSpacing:1}),cursor:_p}}>CLEAR ALL</button>}
              <button onClick={()=>setShowFilterMenu(false)} style={{flex:2,padding:"8px",borderRadius:10,background:`linear-gradient(135deg,${G},#8A6E54)`,border:"none",...ss(9,600,BK,{letterSpacing:1}),cursor:_p}}>APPLY</button>
            </div>
          </div>
        )}
      </div>

      {/* ── ADD ITEM BAR ── */}
      <div onClick={()=>setShowAdd(true)} className="ch" style={{
        display:"flex",alignItems:"center",justifyContent:"space-between",
        padding:"14px 18px",marginBottom:14,borderRadius:14,
        background:`linear-gradient(135deg,#1E180A,#181410)`,
        border:`2px solid ${G}66`,cursor:_p,
        boxShadow:`0 0 20px ${G}18`,
      }}>
        <div style={{..._row,gap:12}}>
          <div style={{width:34,height:34,borderRadius:10,background:`${G}22`,border:`1.5px solid ${G}55`,display:"flex",alignItems:"center",justifyContent:"center",...ss(18,300,G)}}>+</div>
          <div>
            <div style={ss(11,700,G,{letterSpacing:1.2})}>ADD TO YOUR CLOSET</div>
            <div style={ss(8,400,"#7A6A4A",{marginTop:2})}>Photo · URL · Voice · Manual · AI fills details</div>
          </div>
        </div>
        <div style={{...ss(20,300,G),opacity:0.6}}>›</div>
      </div>

      {filtered.length===0?(
        <div style={{textAlign:"center",padding:"40px 0"}}>
          <div style={{fontSize:36,marginBottom:12}}>🔍</div>
          <div style={sr(16,300,"#3A3028",{fontStyle:"italic",marginBottom:8})}>Nothing matches your filters</div>
          <button onClick={clearFilters} style={{padding:"8px 20px",borderRadius:20,background:_1a,border:`1px solid ${G}44`,...ss(9,600,G,{letterSpacing:1}),cursor:_p}}>CLEAR FILTERS</button>
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
                  <div style={{gridColumn:"1 / -1",background:"#141210",borderRadius:16,border:`1px solid ${G}33`,padding:"16px",marginTop:-6}}>
                    <div style={{..._btwn,marginBottom:12}}>
                      <div>
                        <div style={sr(17,500)}>{it.name}</div>
                        <div style={{..._row,gap:6,marginTop:3}}>
                          {it.brand&&<div style={ss(9,400,DM)}>{it.brand}</div>}
                          {it.category&&<div style={ss(9,400,DM)}>· {it.category}</div>}
                        </div>
                      </div>
                      <button onClick={()=>setSelectedClosetItem(null)} style={{width:26,height:26,borderRadius:"50%",background:_1a,border:_2a,cursor:_p,...ss(13,300,MD),display:"flex",alignItems:"center",justifyContent:"center"}}>×</button>
                    </div>
                    {/* Image with matching background */}
                    <ClosetDetailImage item={it} onSaveItem={onSaveItem} setItems={setItems} setSelectedClosetItem={setSelectedClosetItem} showToast={showToast}/>
                    {/* Stats */}
                    <div style={{display:"flex",gap:8,marginBottom:12}}>
                      {[[`$${it.price||0}`,"VALUE"],[(it.wearCount||0)+"×","WORN"],[it.condition||"—","CONDITION"]].map(([v,l])=>(
                        <div key={l} style={{flex:1,background:"#111",borderRadius:10,padding:"8px 4px",textAlign:"center",border:"1px solid #1E1E1E"}}>
                          <div style={sr(13,500,G)}>{v}</div>
                          <div style={ss(7,400,DM,{letterSpacing:1,marginTop:1})}>{l}</div>
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
                        const updated={...it,forSale:!it.forSale};
                        setItems(prev=>prev.map(x=>x.id===it.id?updated:x));
                        if(onSaveItem) onSaveItem(updated);
                        setSelectedClosetItem(updated);
                        showToast(updated.forSale?`${it.name} listed for sale \u2746`:`${it.name} removed from sale \u2746`);
                      }} style={{flex:1,padding:"11px",borderRadius:12,background:it.forSale?"#1A2A1A":"#1A1A2A",border:it.forSale?`1px solid ${G}44`:`1px solid ${G}44`,...ss(9,600,G,{letterSpacing:1}),cursor:_p}}>
                        {it.forSale?"✓ LISTED":"LIST FOR SALE"}
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

      {/* ADD ITEM MODAL */}
      {showAdd && (
        <div onClick={closeAdd} style={{..._fix,background:"#000000AA",display:"flex",alignItems:"flex-start",zIndex:60}}>
          {/* CropModals live here - inside the overlay but NOT inside the animated child, so position:fixed works */}
          {manualCropSrc&&(
            <div onClick={e=>e.stopPropagation()} onTouchStart={e=>e.stopPropagation()} onTouchEnd={e=>e.stopPropagation()}>
              <CropModal src={manualCropSrc} onCancel={()=>setManualCropSrc(null)}
                onSave={cropped=>{setPhotoPreview(cropped);setManualCropSrc(null);}} autoRemoveBg={true}/>
            </div>
          )}
          {scanCropSrc&&(
            <div onClick={e=>e.stopPropagation()} onTouchStart={e=>e.stopPropagation()} onTouchEnd={e=>e.stopPropagation()}>
              <CropModal src={scanCropSrc} onCancel={()=>setScanCropSrc(null)}
                onSave={cropped=>{
                  setScanCropSrc(null);
                  setPhotoPreview(cropped);
                  setScannedItem(prev=>prev?({...prev,stockImage:cropped,sourceImage:cropped,useUserPhoto:true}):prev);
                  if(scanCropConfirm) confirmAdd(cropped);
                }}
                removeBgOnSave={scanCropBgRemove}
                saveLabel={scanCropConfirm?"SAVE TO CLOSET":null}/>
            </div>
          )}
          <div onClick={e=>e.stopPropagation()} style={{background:CD,borderRadius:"0 0 24px 24px",padding:"24px",width:"100%",maxWidth:430,margin:"0 auto",border:_2a,animation:"fadeDown 0.3s ease forwards",maxHeight:"88vh",overflowY:"auto"}}>

            {/* Header */}
            <div style={{..._btwnS,marginBottom:4}}>
              <div>
                <div style={sr(20,500)}>
                  {addMode==="describe" ? "Describe Your Item" : "Add to Closet"}
                </div>
                <div style={ss(9,400,DM,{letterSpacing:1,marginTop:2})}>
                  {addMode==="describe" ? "TYPE A DESCRIPTION · AI FINDS MATCHES" : "PHOTO UPLOAD  |  PASTE URL  |  DESCRIBE"}
                </div>
              </div>
              {addMode&&(
                <button onClick={()=>{setAddMode(null);setVoiceDesc("");setScanned(null);}} style={{background:"none",border:"none",cursor:_p,...ss(12,400,DM)}}>← Back</button>
              )}
            </div>

            {/* ── DEFAULT OPTIONS (no mode selected) ── */}
            {!addMode && !scanned && !scanning && (
              <React.Fragment>
                <input ref={fileRef} type="file" accept="image/*" style={{display:"none"}} onChange={e=>{ if(e.target.files[0]) doScanFile(e.target.files[0]); }} />

                {/* Single photo button */}
                <button className="sb" onClick={()=>fileRef.current.click()} style={{width:"100%",padding:"22px 16px",borderRadius:16,background:_1a,border:_2a,display:"flex",alignItems:"center",gap:16,cursor:_p,marginBottom:10,marginTop:20}}>
                  <div style={{width:52,height:52,borderRadius:14,background:`linear-gradient(135deg,${G}22,${G}44)`,border:`1px solid ${G}44`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:26,flexShrink:0}}>📷</div>
                  <div style={{textAlign:"left"}}>
                    <div style={ss(11,600,MD,{letterSpacing:1})}>SCAN FROM PHOTO</div>
                    <div style={ss(9,400,DM,{marginTop:3})}>Take a photo or choose from your library</div>
                    <div style={ss(8,400,G,{marginTop:2})}>AI identifies all items in the image</div>
                  </div>
                  <div style={{marginLeft:"auto",...ss(18,300,DM),flexShrink:0}}>›</div>
                </button>

                {/* URL row */}
                <div style={{marginBottom:10}}>
                  <div style={ss(9,400,DM,{letterSpacing:1.5,textTransform:"uppercase",marginBottom:8})}>Paste product URL</div>
                  <div style={{display:"flex",gap:8}}>
                    <input value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://store.com/item-link…"
                      style={{flex:1,background:_1a,border:_2a,borderRadius:12,padding:"10px 14px",...ss(11,400,MD),color:"#C0B8B0"}} />
                    <button className="sb" onClick={async()=>{
                      if(!url.trim()) return;
                      setScanning(true); setScanned(null);
                      try{
                        // Fetch scraped product data
                        const scraped = await fetch("/api/fetch-product", {
                          method:"POST",
                          headers:{"Content-Type":"application/json"},
                          body:JSON.stringify({url:url.trim()})
                        }).then(r=>r.json()).catch(()=>({price:null,image:null,name:null,brand:null,description:null}));

                        // Extract URL slug — use the most product-relevant path segment
                        let slugContext = "";
                        let detectedBrand = "";
                        let detectedProductSlug = "";
                        try {
                          const urlObj = new URL(url.trim());
                          const hostname = urlObj.hostname.replace("www.","");
                          const parts = urlObj.pathname.split("/").filter(Boolean);
                          // For aritzia.com: /us/en/product/cozy-sweatfleece-perfect-hoodie/116209067.html
                          // For revolve.com: /brand-name-product/dp/SKU/
                          const productPart = parts.find(p=>p.length>10&&p.includes("-")&&!/^\d+/.test(p)&&!p.includes(".html")) || parts[parts.length-2] || parts[0];
                          detectedProductSlug = productPart?.replace(/-/g," ") || "";
                          // Detect brand from domain
                          const domainBrands = {"aritzia.com":"Aritzia","zara.com":"Zara","hm.com":"H&M","nordstrom.com":"Nordstrom","net-a-porter.com":"Net-a-Porter","ssense.com":"SSENSE","farfetch.com":"Farfetch","shopbop.com":"Shopbop","revolve.com":"","mango.com":"Mango","cos.com":"COS","arket.com":"Arket","uniqlo.com":"Uniqlo","everlane.com":"Everlane","reformation.com":"Reformation","hermes.com":"Hermès","prada.com":"Prada","gucci.com":"Gucci","loewe.com":"Loewe","bottegaveneta.com":"Bottega Veneta","valentino.com":"Valentino","balenciaga.com":"Balenciaga","saint-laurent.com":"Saint Laurent","ysl.com":"Saint Laurent","celine.com":"Céline","dior.com":"Dior","louisvuitton.com":"Louis Vuitton","lv.com":"Louis Vuitton","chanel.com":"Chanel","burberry.com":"Burberry","givenchy.com":"Givenchy","acnestudios.com":"Acne Studios","toteme.com":"Totême","loropiana.com":"Loro Piana","brunellocucinelli.com":"Brunello Cucinelli","kith.com":"Kith","newbalance.com":"New Balance","nike.com":"Nike","adidas.com":"Adidas","levi.com":"Levi's","levis.com":"Levi's","gap.com":"Gap","jcrew.com":"J.Crew","anthropologie.com":"Anthropologie","freepeople.com":"Free People","miumiu.com":"Miu Miu"};
                          detectedBrand = domainBrands[hostname] || "";
                          if(detectedProductSlug) slugContext = `\nURL product slug: "${detectedProductSlug}"`;
                          if(detectedBrand) slugContext += `\nRetailer/Brand: ${detectedBrand}`;
                        } catch(e){}

                        const scrapedContext = [
                          scraped.name ? `Product title: "${scraped.name}"` : null,
                          scraped.brand ? `Brand: "${scraped.brand}"` : null,
                          scraped.description ? `Description: "${scraped.description?.slice(0,300)}"` : null,
                          scraped.price ? `Price: $${scraped.price}` : null,
                        ].filter(Boolean).join("\n");

                        const prompt = `A user is adding a clothing item from this URL to their wardrobe app.
URL: "${url}"${slugContext}
${scrapedContext || "No scraped data available — infer from URL slug and domain."}

Instructions:
- Brand: ${detectedBrand || "infer from domain or slug"}
- Parse the product slug to get the item name (e.g. "cozy-sweatfleece-perfect-hoodie" → "Cozy Sweatfleece Perfect Hoodie")
- For Aritzia items, typical prices: basics $30-80, sweatshirts/hoodies $60-120, jackets $150-400, dresses $80-200
- For Revolve URLs, the slug format is typically "brand-name-product-name" — split brand from product name
- For luxury brands (Hermès, Prada, Gucci, LV, Dior, Chanel, Loewe, Bottega Veneta, Valentino, Balenciaga), you MAY infer a reasonable price based on the item type and brand tier — e.g. Hermès sneakers ~$900-1500, Prada sneakers ~$800-1200, Gucci loafers ~$700-1000
- Pick color hex from any color words in the slug or use a neutral default
- Return ONLY valid JSON, no markdown:
{"name":"...","brand":"...","category":"Tops|Bottoms|Dresses|Outerwear|Shoes|Accessories","color":"#hexcode","price":${scraped.price||0},"tags":["..."],"emoji":"👚","condition":"Like New"}`;

                        const aiRaw = await callClaude(prompt);
                        const json = JSON.parse(aiRaw.replace(/```json|```/g,"").trim());
                        const finalPrice = scraped.price || json.price || 0;

                        // Image: scraped.image (og:image from backend) → targeted image search fallback
                        let finalImage = scraped.image || null;
                        if(!finalImage){
                          const searchName = scraped.name || json.name;
                          const searchBrand = scraped.brand || json.brand || detectedBrand;
                          // Use the most specific queries first — exact product name from slug works best
                          const queries = [
                            `${searchBrand} ${searchName} official`,
                            `${searchBrand} ${detectedProductSlug}`,
                            `${searchName} ${searchBrand}`,
                          ].filter(q=>q.trim().length>3);
                          for(const q of queries){
                            try{
                              const imgRes = await fetch("/api/image-search",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({query:q.trim()})}).then(x=>x.json()).catch(()=>({imageUrl:null}));
                              if(imgRes.imageUrl){ finalImage = imgRes.imageUrl; break; }
                            }catch(e){}
                          }
                        }
                        setScanning(false);
                        setScannedItem({...json,price:finalPrice,wearCount:0,lastWorn:"Never",purchaseDate:"",forSale:false,stockImage:finalImage,sourceImage:finalImage});
                      }catch(e){
                        setScanning(false);
                        setScannedItem({name:"Unknown Item",brand:"Unknown",category:"Tops",color:"#C4A882",price:0,tags:[],emoji:"👚",wearCount:0,lastWorn:"Never",purchaseDate:"",condition:"Like New",forSale:false});
                      }
                    }} style={{padding:"10px 16px",borderRadius:12,background:`linear-gradient(135deg,${G},#8A6E54)`,...ss(9,600,BK,{letterSpacing:1}),cursor:_p,border:"none"}}>FIND</button>
                  </div>
                </div>

                {/* Describe option */}
                <button className="sb" onClick={()=>setAddMode("describe")} style={{
                  width:"100%",padding:"16px",borderRadius:14,
                  background:"linear-gradient(135deg,#1A1424,#120E1C)",
                  border:"1px solid #2A2040",
                  display:"flex",alignItems:"center",gap:14,cursor:_p,marginBottom:10,
                }}>
                  <div style={{width:44,height:44,borderRadius:12,background:"#2A2040",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,fontSize:22}}>🎙️</div>
                  <div style={{textAlign:"left"}}>
                    <div style={ss(10,600,"#C0B0D8",{letterSpacing:1})}>DESCRIBE YOUR ITEM</div>
                    <div style={ss(8,400,"#6A5A88",{marginTop:3})}>Speak or type · AI identifies brand, category & details</div>
                  </div>
                  <div style={{marginLeft:"auto",...ss(14,300,"#3A2A58")}}>›</div>
                </button>

                {/* Manual entry option */}
                <button className="sb" onClick={()=>setAddMode("manual")} style={{
                  width:"100%",padding:"16px",borderRadius:14,
                  background:"linear-gradient(135deg,#0F1A14,#0C150F)",
                  border:"1px solid #1E3028",
                  display:"flex",alignItems:"center",gap:14,cursor:_p,
                }}>
                  <div style={{width:44,height:44,borderRadius:12,background:"#1A3020",border:"1px solid #2A4030",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,fontSize:22}}>✏️</div>
                  <div style={{textAlign:"left"}}>
                    <div style={ss(10,600,"#80C8A0",{letterSpacing:1})}>ADD MANUALLY</div>
                    <div style={ss(8,400,"#3A6048",{marginTop:3})}>Fill in all details yourself</div>
                  </div>
                  <div style={{marginLeft:"auto",...ss(14,300,"#2A4030")}}>›</div>
                </button>
              </React.Fragment>
            )}

            {/* ── DESCRIBE MODE ── */}
            {addMode==="describe" && !scanned && (
              <div style={{marginTop:20}}>
                <div style={ss(9,400,DM,{letterSpacing:1,marginBottom:10,textAlign:"center"})}>DESCRIBE WHAT YOU'RE LOOKING FOR</div>
                <div style={ss(9,400,"#4A3A58",{lineHeight:1.6,marginBottom:16,textAlign:"center"})}>e.g. "navy wool blazer from Zara" or "white linen shirt Equipment size XS"</div>

                <textarea
                  value={voiceDesc}
                  onChange={e=>{setVoiceDesc(e.target.value);setDescribeResults([]);}}
                  placeholder="Describe your item…"
                  rows={3}
                  style={{width:"100%",background:_1a,border:_2a,borderRadius:14,padding:"12px 14px",...ss(11,400,MD),color:"#C0B8B0",resize:"none",boxSizing:"border-box",lineHeight:1.6,marginBottom:10}}
                />

                {voiceDesc.trim() && !describeLoading && describeResults.length===0 && (
                  <button onClick={async()=>{
                    setDescribeLoading(true); setDescribeResults([]);
                    try{
                      const raw = await callClaude(
                        `A user is describing a clothing item they want to add to their wardrobe app: "${voiceDesc}"\n\nGenerate 4 specific product matches. Be as precise as possible — use exact product line names, real brand names, and realistic prices. Include specific color/material details from the description.\nReturn ONLY JSON:\n{"results":[{"name":"exact product name","brand":"exact brand","category":"Tops|Bottoms|Dresses|Outerwear|Shoes|Accessories","color":"#hexcode","colorName":"e.g. Dark Brown","price":150,"emoji":"👚","condition":"New","tags":["..."]},...]}`
                      );
                      const json=JSON.parse(raw.replace(/```json|```/g,"").trim());
                      const results = json.results||[];
                      // Fetch real product images — use specific queries with color and product name
                      const withImages = await Promise.all(results.map(async r=>{
                        try{
                          // Try specific query first (brand + exact name + color)
                          const specificQuery = `${r.brand} ${r.name}${r.colorName?" "+r.colorName:""} product photo white background`;
                          const imgRes = await fetch("/api/image-search",{
                            method:"POST",
                            headers:{"Content-Type":"application/json"},
                            body:JSON.stringify({query:specificQuery})
                          }).then(x=>x.json()).catch(()=>({imageUrl:null}));
                          // If no result, try a simpler fallback query
                          if(!imgRes.imageUrl){
                            const fallbackRes = await fetch("/api/image-search",{
                              method:"POST",
                              headers:{"Content-Type":"application/json"},
                              body:JSON.stringify({query:`${r.brand} ${r.name} official`})
                            }).then(x=>x.json()).catch(()=>({imageUrl:null}));
                            return {...r, imageUrl:fallbackRes.imageUrl||null};
                          }
                          return {...r, imageUrl:imgRes.imageUrl||null};
                        }catch(e){ return {...r, imageUrl:null}; }
                      }));
                      setDescribeResults(withImages);
                    }catch(e){ setDescribeResults([]); }
                    setDescribeLoading(false);
                  }} style={{width:"100%",padding:"12px",borderRadius:12,background:`linear-gradient(135deg,${G},#8A6E54)`,border:"none",...ss(10,700,BK,{letterSpacing:1.5}),cursor:_p}}>
                    SEARCH ✦
                  </button>
                )}

                {describeLoading && (
                  <div style={{textAlign:"center",padding:"24px 0"}}>
                    <div style={{fontSize:32,marginBottom:12,display:"inline-block",animation:"spin 1.2s linear infinite"}}>✦</div>
                    <div style={sr(14,400,G,{marginBottom:4})}>Finding matches…</div>
                    <div style={ss(9,400,DM)}>Searching for items matching your description</div>
                  </div>
                )}

                {describeResults.length>0 && (
                  <div>
                    <div style={ss(9,600,DM,{letterSpacing:1.5,marginBottom:12,marginTop:4})}>SELECT THE BEST MATCH</div>
                    <div style={{display:"flex",flexDirection:"column",gap:10}}>
                      {describeResults.map((r,i)=>(
                        <div key={i} onClick={()=>{
                          setScannedItem({...r,wearCount:0,lastWorn:"Never",purchaseDate:"",forSale:false,stockImage:r.imageUrl||null,sourceImage:r.imageUrl||null});
                          setDescribeResults([]);
                        }}
                          className="ch" style={{background:CD,borderRadius:16,border:`1px solid ${BR}`,display:"flex",gap:12,padding:"12px",cursor:_p,alignItems:"center"}}>
                          {/* Image */}
                          <div style={{width:64,height:64,borderRadius:12,background:`linear-gradient(135deg,${r.color}22,${r.color}44)`,flexShrink:0,overflow:"hidden",display:"flex",alignItems:"center",justifyContent:"center",border:_2a}}>
                            {r.imageUrl
                              ? <img src={r.imageUrl} style={{width:"100%",height:"100%",objectFit:"cover"}}
                                  onError={e=>{e.target.style.display="none";e.target.nextSibling.style.display="flex";}}
                                  alt={r.name}/>
                              : null}
                            <div style={{display:r.imageUrl?"none":"flex",width:"100%",height:"100%",alignItems:"center",justifyContent:"center"}}>
                              <ItemIllustration item={r} size={50}/>
                            </div>
                          </div>
                          {/* Info */}
                          <div style={{flex:1,minWidth:0}}>
                            <div style={sr(14,500,undefined,{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"})}>{r.name}</div>
                            <div style={ss(9,400,DM,{marginTop:2,letterSpacing:0.5})}>{r.brand} · {r.category}</div>
                            <div style={sr(13,400,G,{marginTop:3})}>${r.price}</div>
                          </div>
                          <div style={{...ss(11,400,G),flexShrink:0}}>→</div>
                        </div>
                      ))}
                    </div>
                    <button onClick={()=>{setDescribeResults([]);}}
                      style={{width:"100%",marginTop:10,padding:"10px",borderRadius:12,background:_1a,border:_2a,...ss(9,400,MD,{letterSpacing:1}),cursor:_p}}>
                      TRY DIFFERENT DESCRIPTION
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* ── MANUAL ENTRY MODE ── */}
            {addMode==="manual" && !scanned && (
              <div style={{marginTop:16}}>
                {(()=>{
                  const catList=["Tops","Bottoms","Dresses","Outerwear","Shoes","Accessories"];
                  const condList=["Like New","Excellent","Good","Fair"];
                  const catEmoji={Tops:"👕",Bottoms:"👖",Dresses:"👗",Outerwear:"🧥",Shoes:"👟",Accessories:"✨"};
                  const colorSwatches=[
                    {name:"White",   hex:"#F5F5F5"},
                    {name:"Cream",   hex:"#F5F0E8"},
                    {name:"Yellow",  hex:"#F0C040"},
                    {name:"Orange",  hex:"#E07830"},
                    {name:"Red",     hex:"#C03030"},
                    {name:"Pink",    hex:"#E88090"},
                    {name:"Purple",  hex:"#8060A0"},
                    {name:"Blue",    hex:"#3060A0"},
                    {name:"Sky",     hex:"#60A0D0"},
                    {name:"Green",   hex:"#407840"},
                    {name:"Olive",   hex:"#6A7040"},
                    {name:"Tan",     hex:"#C4A882"},
                    {name:"Brown",   hex:"#7A5030"},
                    {name:"Grey",    hex:"#808080"},
                    {name:"Charcoal",hex:"#3A3A3A"},
                    {name:"Black",   hex:"#1A1A1A"},
                  ];
                  const iStyle={width:"100%",boxSizing:"border-box",background:"#0D0D0D",border:"1px solid #2A2A2A",borderRadius:10,padding:"10px 14px",...ss(12,400,MD),color:"#C0B8B0",outline:"none"};
                  const confirmManual=()=>{
                    if(!mName.trim()){showToast("Please enter an item name \u2746");return;}
                    const emoji={Tops:"👚",Bottoms:"👖",Dresses:"👗",Outerwear:"🧥",Shoes:"👟",Accessories:"✨"}[mCat]||"👗";
                    const item={name:mName.trim(),brand:mBrand.trim()||"Unknown",category:mCat,color:mColor,colors:mColors,price:parseInt(mPrice)||0,tags:[],emoji,condition:mCondition,wearCount:0,lastWorn:"Never",purchaseDate:mDate,forSale:false,sourceImage:photoPreview||null};
                    setScannedItem(item);
                    // Open crop immediately if there's a photo — save happens after crop
                    if(photoPreview){ setScanCropConfirm(true); setScanCropSrc(photoPreview); }
                  };
                  return(
                    <React.Fragment>
                      {/* Banner shown when auto-redirected from failed scan */}
                      {photoPreview&&!manualCropSrc&&(
                        <div style={{marginBottom:12,padding:"8px 12px",borderRadius:10,background:"#1A1A2A",border:"1px solid #3A3A5A",display:"flex",alignItems:"center",gap:8}}>
                          <span style={{fontSize:14}}>📷</span>
                          <div style={ss(9,500,"#8888CC",{flex:1})}>Photo carried over from scan — fill in the details below</div>
                        </div>
                      )}
                      {/* Photo upload */}
                      <div style={{marginBottom:14}}>
                        <div style={ss(9,400,DM,{letterSpacing:1.5,marginBottom:8})}>PHOTO (OPTIONAL)</div>
                        <input ref={manualFileRef} type="file" accept="image/*" style={{display:"none"}} onChange={e=>{if(e.target.files[0]){const r=new FileReader();r.onload=ev=>setManualCropSrc(ev.target.result);r.readAsDataURL(e.target.files[0]);}}}/>
                        {photoPreview ? (
                          <div style={{position:"relative",borderRadius:14,overflow:"hidden",height:260,background:_1a}}>
                            <img src={photoPreview} style={{width:"100%",height:"100%",objectFit:"contain"}} alt="preview"/>
                            <button onClick={()=>setPhotoPreview(null)} style={{position:"absolute",top:8,right:8,width:28,height:28,borderRadius:"50%",background:"#0D0D0D99",border:"none",cursor:_p,...ss(14,400,"#F0EBE3"),display:"flex",alignItems:"center",justifyContent:"center"}}>×</button>
                          </div>
                        ) : (
                          <button onClick={()=>manualFileRef.current.click()} style={{width:"100%",padding:"16px",borderRadius:14,background:_1a,border:`1px dashed ${G}44`,display:"flex",alignItems:"center",gap:12,cursor:_p}}>
                            <div style={{width:40,height:40,borderRadius:10,background:`${G}18`,border:`1px solid ${G}33`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>📷</div>
                            <div style={{textAlign:"left"}}>
                              <div style={ss(10,600,G,{letterSpacing:0.5})}>UPLOAD PHOTO</div>
                              <div style={ss(8,400,DM,{marginTop:2})}>Take a photo or choose from library</div>
                            </div>
                          </button>
                        )}
                      </div>

                      <div style={{marginBottom:12}}>
                        <div style={ss(9,400,DM,{letterSpacing:1.5,marginBottom:6})}>ITEM NAME *</div>
                        <input value={mName} onChange={e=>setMName(e.target.value)} placeholder="e.g. Silk Ivory Blouse" style={iStyle}/>
                      </div>
                      <div style={{marginBottom:12,position:"relative"}}>
                        <div style={ss(9,400,DM,{letterSpacing:1.5,marginBottom:6})}>BRAND</div>
                        <input
                          value={mBrand}
                          onChange={e=>{setMBrand(e.target.value);setShowBrandList(true);}}
                          onFocus={()=>{if(mBrand.length>=1) setShowBrandList(true);}}
                          onBlur={()=>setTimeout(()=>setShowBrandList(false),150)}
                          placeholder="e.g. Aritzia, Zara…"
                          style={iStyle}
                          autoComplete="off"
                        />
                        {showBrandList&&mBrand.length>=1&&(()=>{
                          const q=mBrand.toLowerCase();
                          const matches=FASHION_BRANDS.filter(b=>b.toLowerCase().startsWith(q)||b.toLowerCase().includes(q)).slice(0,6);
                          return matches.length>0?(
                            <div style={{position:"absolute",top:"100%",left:0,right:0,zIndex:50,background:"#1A1A1A",borderRadius:"0 0 10px 10px",border:`1px solid ${G}44`,borderTop:"none",overflow:"hidden"}}>
                              {matches.map((b,i)=>(
                                <div key={b} onMouseDown={()=>{setMBrand(b);setShowBrandList(false);}}
                                  style={{padding:"10px 14px",cursor:_p,borderTop:i>0?"1px solid #2A2A2A":"none",display:"flex",alignItems:"center",gap:10,...ss(12,400,MD)}}
                                  className="ch">
                                  <span style={{fontSize:12,opacity:0.4}}>✦</span>
                                  <span>{b}</span>
                                  {b.toLowerCase().startsWith(q)&&<span style={ss(9,400,DM,{marginLeft:"auto"})}>brand</span>}
                                </div>
                              ))}
                            </div>
                          ):null;
                        })()}
                      </div>
                      <div style={{marginBottom:12}}>
                        <div style={ss(9,400,DM,{letterSpacing:1.5,marginBottom:6})}>PRICE ($)</div>
                        <input value={mPrice} onChange={e=>setMPrice(e.target.value.replace(/\D/g,""))} placeholder="0" inputMode="numeric" style={iStyle}/>
                      </div>

                      {/* Color swatches — multiselect */}
                      <div style={{marginBottom:12}}>
                        <div style={{..._btwn,marginBottom:8}}>
                          <div style={ss(9,400,DM,{letterSpacing:1.5})}>COLOR</div>
                          {mColors.length>1&&<div style={ss(8,400,G)}>MULTICOLOR SELECTED</div>}
                        </div>
                        <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
                          {colorSwatches.map(({name,hex})=>{
                            const sel=mColors.includes(hex);
                            return(
                              <button key={hex} onClick={()=>{
                                setMColors(prev=>{
                                  if(prev.includes(hex)){
                                    const next=prev.filter(h=>h!==hex);
                                    if(next.length===0) return prev; // always keep at least one
                                    setMColor(next[0]);
                                    return next;
                                  } else {
                                    if(!prev.includes(hex)) setMColor(hex); // update primary
                                    return [...prev,hex];
                                  }
                                });
                              }} title={name} style={{
                                width:32,height:32,borderRadius:"50%",background:hex,cursor:_p,
                                border:sel?`3px solid ${G}`:"2px solid #2A2A2A",
                                boxShadow:sel?`0 0 0 2px ${G}66`:"none",
                                flexShrink:0,transition:"all 0.15s",outline:"none",
                                position:"relative",
                              }}>
                                {sel&&mColors.length>1&&<div style={{position:"absolute",top:-2,right:-2,width:10,height:10,borderRadius:"50%",background:G,border:"1.5px solid #0D0D0D",...ss(7,700,BK)}}>{mColors.indexOf(hex)+1}</div>}
                              </button>
                            );
                          })}
                        </div>
                        <div style={{marginTop:6,display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                          {mColors.length===1
                            ? <span style={ss(9,400,DM)}>Selected: <span style={{color:G}}>{colorSwatches.find(c=>c.hex===mColors[0])?.name||"Custom"}</span></span>
                            : mColors.map(h=>(
                                <div key={h} style={{display:"flex",alignItems:"center",gap:4}}>
                                  <div style={{width:8,height:8,borderRadius:"50%",background:h,border:"1px solid #FFFFFF22"}}/>
                                  <span style={ss(9,400,DM)}>{colorSwatches.find(c=>c.hex===h)?.name||"Custom"}</span>
                                </div>
                              ))
                          }
                        </div>
                      </div>

                      <div style={{marginBottom:12}}>
                        <div style={ss(9,400,DM,{letterSpacing:1.5,marginBottom:8})}>CATEGORY</div>
                        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                          {catList.map(c=>(
                            <button key={c} onClick={()=>setMCat(c)} style={{padding:"6px 12px",borderRadius:20,cursor:_p,background:mCat===c?`${G}22`:_1a,border:mCat===c?`1.5px solid ${G}`:`1px solid #2A2A2A`,...ss(9,mCat===c?600:400,mCat===c?G:DM),display:"flex",alignItems:"center",gap:4}}>
                              <span>{catEmoji[c]}</span>{c}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div style={{marginBottom:12}}>
                        <div style={ss(9,400,DM,{letterSpacing:1.5,marginBottom:8})}>CONDITION</div>
                        <div style={{display:"flex",gap:6}}>
                          {condList.map(c=>(
                            <button key={c} onClick={()=>setMCondition(c)} style={{flex:1,padding:"7px 4px",borderRadius:10,cursor:_p,background:mCondition===c?`${G}22`:_1a,border:mCondition===c?`1.5px solid ${G}`:`1px solid #2A2A2A`,...ss(8,mCondition===c?600:400,mCondition===c?G:DM,{letterSpacing:0.3})}}>{c}</button>
                          ))}
                        </div>
                      </div>
                      <div style={{marginBottom:20}}>
                        <MonthYearPicker label="DATE PURCHASED (OPTIONAL)" value={mDate} onChange={setMDate}/>
                      </div>
                      <button onClick={confirmManual} style={{width:"100%",padding:"13px",borderRadius:14,background:`linear-gradient(135deg,${G},#8A6E54)`,border:"none",...ss(10,700,BK,{letterSpacing:1.5}),cursor:_p}}>
                        PREVIEW ITEM →
                      </button>
                    </React.Fragment>
                  );
                })()}
              </div>
            )}

            {scanning && (
              <div style={{textAlign:"center",padding:"32px 0"}}>
                <div style={{fontSize:44,marginBottom:16,animation:"pulse 1.2s infinite"}}>🔍</div>
                <div style={sr(16,400,G,{marginBottom:6})}>Identifying item…</div>
                <div style={ss(10,400,DM,{marginBottom:20})}>Recognizing brand, fetching stock photo</div>
                <div style={{height:3,background:_1a,borderRadius:2,overflow:"hidden"}}>
                  <div style={{height:"100%",width:"70%",background:`linear-gradient(90deg,${G},#8A6E54)`,borderRadius:2,animation:"pulse 1s infinite"}} />
                </div>
              </div>
            )}

            {/* ── RESULT (all modes) ── */}
            {scanned && (
              <div style={{marginTop:addMode==="describe"?20:0}}>
                <div style={{background:"#0F1A0F",borderRadius:14,padding:"12px 14px",border:"1px solid #1A3A1A",marginBottom:16,display:"flex",gap:10,alignItems:"center"}}>
                  <span style={{fontSize:18}}>✓</span>
                  <span style={ss(10,500,"#A8C4A0",{letterSpacing:1})}>ITEM RECOGNIZED</span>
                  {addMode==="describe"&&<span style={ss(9,400,"#4A7A4A",{marginLeft:"auto"})}>via description</span>}
                </div>
                <div style={{display:"flex",gap:14,marginBottom:16}}>
                  {/* Image box — click to crop/remove bg, pencil to replace */}
                  <div style={{position:"relative",width:72,height:72,flexShrink:0}}>
                    <input ref={photoOverrideRef} type="file" accept="image/*" style={{display:"none"}} onChange={e=>{
                      const file=e.target.files?.[0]; if(!file) return;
                      const reader=new FileReader();
                      reader.onload=ev=>{ setScanCropConfirm(true); setScanCropSrc(ev.target.result); setScannedItem(prev=>({...prev,useUserPhoto:true})); };
                      reader.readAsDataURL(file);
                    }}/>
                    {/* Clicking the image opens crop on the current photo */}
                    <div onClick={()=>{
                      const currentImg = (!scanned.useUserPhoto && scanned.stockImage) ? scanned.stockImage : photoPreview || null;
                      if(currentImg){ setScanCropConfirm(false); setScanCropSrc(currentImg); }
                      else photoOverrideRef.current?.click();
                    }} style={{width:72,height:72,borderRadius:14,background:`linear-gradient(135deg,${scanned.color}22,${scanned.color}55)`,overflow:"hidden",display:"flex",alignItems:"center",justifyContent:"center",border:_2a,cursor:_p,position:"relative"}}>
                      {(!scanned.useUserPhoto && scanned.stockImage)
                        ? <img src={scanned.stockImage} style={{width:"100%",height:"100%",objectFit:"contain",padding:4,boxSizing:"border-box"}} alt={scanned.name}/>
                        : photoPreview
                          ? <img src={photoPreview} style={{width:"100%",height:"100%",objectFit:"cover"}} alt="item"/>
                          : <ItemIllustration item={scanned} size={60}/>
                      }
                      {/* Crop overlay hint */}
                      {(scanned.stockImage||photoPreview)&&(
                        <div style={{position:"absolute",inset:0,background:"#00000055",display:"flex",alignItems:"center",justifyContent:"center",borderRadius:14,opacity:0,transition:"opacity 0.15s"}}
                          onMouseEnter={e=>e.currentTarget.style.opacity=1}
                          onMouseLeave={e=>e.currentTarget.style.opacity=0}>
                          <span style={{fontSize:16}}>✂️</span>
                        </div>
                      )}
                    </div>
                    {/* Pencil = replace with new photo */}
                    <button onClick={()=>photoOverrideRef.current?.click()}
                      style={{position:"absolute",bottom:-4,right:-4,width:22,height:22,borderRadius:"50%",background:G,border:"2px solid #0D0D0D",display:"flex",alignItems:"center",justifyContent:"center",cursor:_p}}>
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                        <path d="M7 1L9 3L3.5 8.5L1 9L1.5 6.5L7 1Z" fill="#0D0D0D" stroke="#0D0D0D" strokeWidth="0.5" strokeLinejoin="round"/>
                        <path d="M6.5 1.5L8.5 3.5" stroke="#0D0D0D" strokeWidth="0.5"/>
                      </svg>
                    </button>
                  </div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={sr(17,500)}>{scanned.name}</div>
                    <div style={ss(9,400,DM,{letterSpacing:1,marginTop:3})}>{scanned.brand}</div>
                    {/* Category — AI suggested, tappable to change */}
                    <div style={{marginTop:8}}>
                      <div style={{..._row,gap:4,alignItems:"center",marginBottom:5}}>
                        <div style={ss(7,700,G,{letterSpacing:1})}>✦ AI SUGGESTED</div>
                      </div>
                      <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                        {["Tops","Bottoms","Dresses","Outerwear","Shoes","Accessories"].map(cat=>(
                          <button key={cat} onClick={()=>setScannedItem(prev=>({...prev,category:cat,emoji:{Tops:"👚",Bottoms:"👖",Dresses:"👗",Outerwear:"🧥",Shoes:"👟",Accessories:"✨"}[cat]||"👗"}))}
                            style={{padding:"4px 10px",borderRadius:16,cursor:_p,
                              background:scanned.category===cat?`${G}22`:_1a,
                              border:scanned.category===cat?`1.5px solid ${G}`:`1px solid #2A2A2A`,
                              ...ss(8,scanned.category===cat?700:400,scanned.category===cat?G:DM),
                            }}>
                            {cat}
                          </button>
                        ))}
                      </div>
                    </div>
                    {/* Stock/user photo toggle — only show when stock image available AND user has a photo */}
                    {scanned.stockImage && photoPreview && (
                      <div style={{..._row,gap:6,marginTop:6}}>
                        <button onClick={()=>setScannedItem(prev=>({...prev,useUserPhoto:false}))}
                          style={{padding:"3px 8px",borderRadius:8,background:!scanned.useUserPhoto?`${G}22`:"transparent",border:!scanned.useUserPhoto?`1px solid ${G}44`:"1px solid #2A2A2A",cursor:_p,...ss(7,600,!scanned.useUserPhoto?G:DM,{letterSpacing:0.5})}}>
                          🖼 Stock
                        </button>
                        <button onClick={()=>setScannedItem(prev=>({...prev,useUserPhoto:true}))}
                          style={{padding:"3px 8px",borderRadius:8,background:scanned.useUserPhoto?`${G}22`:"transparent",border:scanned.useUserPhoto?`1px solid ${G}44`:"1px solid #2A2A2A",cursor:_p,...ss(7,600,scanned.useUserPhoto?G:DM,{letterSpacing:0.5})}}>
                          📷 My Photo
                        </button>
                      </div>
                    )}
                    {/* Editable price */}
                    <div style={{display:"flex",alignItems:"center",gap:6,marginTop:6}}>
                      <span style={sr(13,400,G)}>$</span>
                      <input
                        value={priceOverride}
                        onChange={e=>setPriceOverride(e.target.value.replace(/\D/g,""))}
                        inputMode="numeric"
                        placeholder={String(scanned.price)}
                        style={{width:72,background:"#0D0D0D",border:`1px solid ${G}55`,borderRadius:8,padding:"4px 8px",...ss(12,400,G),color:G,outline:"none"}}
                      />
                      {priceOverride && parseInt(priceOverride) !== scanned.price && (
                        <span style={ss(8,400,DM,{fontStyle:"italic"})}>AI suggested ${scanned.price}</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Add your own photo prompt — shown in describe mode */}
                {addMode==="describe" && !photoPreview && (
                  <label style={{display:"flex",alignItems:"center",gap:10,background:"#111",border:`1px dashed ${G}44`,borderRadius:12,padding:"10px 14px",marginBottom:12,cursor:_p}}>
                    <input type="file" accept="image/*" capture="environment" style={{display:"none"}}
                      onChange={e=>{
                        const file=e.target.files?.[0];
                        if(!file) return;
                        const reader=new FileReader();
                        reader.onload=ev=>setManualCropSrc(ev.target.result);
                        reader.readAsDataURL(file);
                      }}/>
                    <span style={{fontSize:18}}>📷</span>
                    <div>
                      <div style={ss(10,600,G,{letterSpacing:0.5})}>Add your own photo</div>
                      <div style={ss(8,400,DM,{marginTop:1})}>Take or upload a photo of your actual item</div>
                    </div>
                  </label>
                )}
                {addMode==="describe" && photoPreview && (
                  <button onClick={()=>setPhotoPreview(null)} style={{width:"100%",padding:"8px",borderRadius:10,background:_1a,border:_2a,...ss(9,400,"#A86060",{letterSpacing:0.5}),cursor:_p,marginBottom:12}}>
                    × Remove photo
                  </button>
                )}

                <div style={{display:"flex",gap:8}}>
                  <Btn onClick={()=>{setScanned(null);setVoiceDesc("");setDescribeResults([]);}} outline>RE-SCAN</Btn>
                  <Btn onClick={()=>{
                    const src = photoPreview || scanned?.stockImage || scanned?._originalPhoto;
                    if(src){ setScanCropConfirm(true); setScanCropBgRemove(false); setScanCropSrc(src); }
                    else confirmAdd();
                  }}>CROP</Btn>
                  <Btn onClick={()=>{
                    const src = photoPreview || scanned?.stockImage || scanned?._originalPhoto;
                    if(src){ setScanCropConfirm(true); setScanCropBgRemove(true); setScanCropSrc(src); }
                    else confirmAdd();
                  }} full>CROP + REMOVE BG</Btn>
                </div>
              </div>
            )}

            {/* ── MULTI-ITEM SELECTION ── */}
            {detectedItems.length>1 && (
              <div>
                {/* Photo thumbnail + badge */}
                <div style={{position:"relative",marginBottom:14}}>
                  <div style={{width:"100%",borderRadius:14,overflow:"hidden",maxHeight:160,background:_1a,display:"flex",alignItems:"center",justifyContent:"center"}}>
                    {photoPreview&&<img src={photoPreview} style={{width:"100%",objectFit:"cover",maxHeight:160}} alt="scanned"/>}
                  </div>
                  <div style={{position:"absolute",top:8,right:8,background:"linear-gradient(135deg,#0F1A0F,#162416)",border:"1px solid #2A3A2A",borderRadius:10,padding:"5px 10px"}}>
                    <div style={ss(9,600,"#A8C4A0",{letterSpacing:1})}>{detectedItems.length} ITEMS FOUND</div>
                  </div>
                </div>

                <div style={ss(9,400,DM,{letterSpacing:1.5,textTransform:"uppercase",marginBottom:10})}>Select items to add to your closet</div>

                {detectedItems.map(item=>{
                  const isSel=!!selectedDetected[item.id];
                  return(
                    <div key={item.id} onClick={()=>setSelectedDetected(p=>({...p,[item.id]:!p[item.id]}))} style={{
                      background:isSel?"linear-gradient(135deg,#1A160F,#1E1A12)":CD,
                      borderRadius:14,padding:"12px 14px",marginBottom:8,
                      border:`1.5px solid ${isSel?G:BR}`,
                      cursor:_p,transition:"all 0.2s",
                      display:"flex",gap:12,alignItems:"center",
                    }}>
                      <div style={{width:44,height:44,borderRadius:10,background:`linear-gradient(135deg,${item.color}22,${item.color}44)`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,flexShrink:0,border:`1px solid ${item.color}33`}}>
                        {item.emoji}
                      </div>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={sr(14,500,isSel?G:undefined)}>{item.name}</div>
                        <div style={ss(9,400,DM,{marginTop:2})}>{item.brand} · {item.category}</div>
                        <div style={sr(12,400,G,{marginTop:2})}>${item.price}</div>
                      </div>
                      <div style={{width:24,height:24,borderRadius:6,background:isSel?G:"#1A1A1A",border:`1.5px solid ${isSel?G:"#3A3028"}`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,transition:"all 0.2s",...ss(12,700,BK)}}>
                        {isSel?"✓":""}
                      </div>
                    </div>
                  );
                })}

                <div style={{display:"flex",gap:10,marginTop:4}}>
                  <Btn onClick={()=>{setDetectedItems([]);setPhotoPreview(null);setSelectedDetected({});}} outline>RE-SCAN</Btn>
                  <Btn onClick={confirmAddMulti} full disabled={!Object.values(selectedDetected).some(Boolean)}>
                    ADD {Object.values(selectedDetected).filter(Boolean).length} ITEM{Object.values(selectedDetected).filter(Boolean).length!==1?"S":""} TO CLOSET
                  </Btn>
                </div>
              </div>
            )}

          </div>
        </div>
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
                  <div style={{width:88,height:88,borderRadius:18,background:_1a,overflow:"hidden",display:"flex",alignItems:"center",justifyContent:"center",border:_2a}}>
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
            <div style={{background:_1a,borderRadius:14,padding:"14px 16px",marginBottom:20,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <div style={ss(10,400,DM,{letterSpacing:1})}>Available in Market</div>
              {selectedWishItem.inMarket
                ?<div style={{background:"#1A2A1A",borderRadius:20,padding:"4px 12px",...ss(8,700,"#A8C4A0",{letterSpacing:1})}}>IN MARKET</div>
                :<div style={{background:_1a,borderRadius:20,padding:"4px 12px",border:_2a,...ss(8,400,DM,{letterSpacing:1})}}>NOT LISTED</div>}
            </div>
            {selectedWishItem.sourceUrl&&(
              <a href={selectedWishItem.sourceUrl} target="_blank" rel="noopener noreferrer"
                style={{display:"flex",alignItems:"center",gap:10,background:"#0A0A14",borderRadius:14,padding:"12px 16px",marginBottom:16,border:`1px solid ${G}33`,textDecoration:"none",cursor:_p}}>
                <div style={{width:32,height:32,borderRadius:10,background:`${G}22`,border:`1px solid ${G}44`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,...ss(14,400)}}>🔗</div>
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
                setItems(prev=>[...prev,newItem]);
                if(onSaveItem) onSaveItem(newItem);
                // Remove from wishlist
                if(removeFromWishlist) removeFromWishlist(selectedWishItem.id);
                else setWishlist(prev=>prev.filter(w=>w.id!==selectedWishItem.id));
                setSelectedWishItem(null);
                showToast(`${newItem.name} added to your closet \u2746`);
              }} style={{width:"100%",padding:"14px",borderRadius:14,background:`linear-gradient(135deg,${G},#8A6E54)`,border:"none",...ss(10,700,BK,{letterSpacing:1.5}),cursor:_p,display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
                <span style={{fontSize:16}}>🛍</span> I BOUGHT IT — ADD TO CLOSET
              </button>
              <div style={{display:"flex",gap:10}}>
                <Btn onClick={()=>{if(removeFromWishlist) removeFromWishlist(selectedWishItem.id); else setWishlist(prev=>prev.filter(w=>w.id!==selectedWishItem.id));setSelectedWishItem(null);showToast("Removed from wishlist \u2746");}} outline>REMOVE</Btn>
                <Btn onClick={()=>{showToast("Finding in market\u2026 \u2746");setSelectedWishItem(null);}} full>FIND IN MARKET</Btn>
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
    // Ensure we have a data URL to work with — ref is always current unlike closure state
    if(!resolvedSrcRef.current && !src.startsWith("data:")){
      try{
        const blob=await fetch(src).then(r=>r.blob());
        resolvedSrcRef.current=await new Promise(res=>{ const r=new FileReader(); r.onload=e=>res(e.target.result); r.readAsDataURL(blob); });
      }catch(e){}
    }
    const croppedB64=await buildCroppedB64();
    if(!croppedB64||!croppedB64.startsWith("data:")){
      setRemovingBg(false);
      setBgError("Could not read image — try re-uploading the photo.");
      return;
    }
    try{
      // Lazy-load @imgly/background-removal — runs fully in-browser via WASM, no API needed
      if(!window._imglyBgRemoval){
        setBgError("Loading background removal (first time ~5s)…");
        const mod=await import("https://esm.sh/@imgly/background-removal@1.4.5");
        window._imglyBgRemoval=mod.removeBackground;
        setBgError(null);
      }
      // Convert base64 → Blob for the library
      const fetchRes=await fetch(croppedB64);
      const blob=await fetchRes.blob();
      const resultBlob=await window._imglyBgRemoval(blob,{
        debug:false,
        model:"medium",
        output:{format:"image/png",quality:0.9}
      });
      // Post-process: remove small isolated pixel islands (arrows, UI chrome, etc.)
      // Only the largest connected blob (the clothing item) is kept.
      const finalBlob=await cleanIsolatedPixels(resultBlob);
      const reader=new FileReader();
      reader.onload=e=>{ onSave(e.target.result); };
      reader.readAsDataURL(finalBlob);
    }catch(e){
      setRemovingBg(false);
      setBgError("Background removal failed: "+e.message);
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
          <div style={{marginBottom:8,padding:"7px 12px",borderRadius:10,
            background:bgError.startsWith("Loading")||bgError.startsWith("Removing")?"transparent":"#2A1A1A",
            border:bgError.startsWith("Loading")||bgError.startsWith("Removing")?"none":"1px solid #CC333344",
            ...ss(9,500,bgError.startsWith("Loading")||bgError.startsWith("Removing")?DM:"#CC6666",{textAlign:"center"})}}>
            {bgError}
          </div>
        )}
        <div style={{display:"flex",gap:8}}>
          <button onClick={onCancel} disabled={removingBg} style={{flex:1,padding:"14px",borderRadius:14,background:"#1A1A1A",border:"1px solid #2A2A2A",...ss(10,600,DM,{letterSpacing:1}),cursor:_p,opacity:removingBg?0.5:1}}>CANCEL</button>
          {saveLabel ? (
            // Simplified 2-button mode: Cancel + Save (auto-does bg removal if removeBgOnSave)
            <button onClick={removeBgOnSave ? applyWithBgRemoval : applyCrop} disabled={removingBg}
              style={{flex:2,padding:"14px",borderRadius:14,background:removingBg?"#2A2A2A":`linear-gradient(135deg,${G},#8A6E54)`,border:"none",...ss(10,700,removingBg?DM:BK,{letterSpacing:1}),cursor:_p,transition:"all 0.3s"}}>
              {removingBg?"REMOVING BG...":saveLabel}
            </button>
          ) : (
            // Full 3-button mode for other flows
            <React.Fragment>
              <button onClick={applyCrop} disabled={removingBg} style={{flex:1,padding:"14px",borderRadius:14,background:"#1A1A1A",border:`1px solid ${G}`,...ss(10,600,G,{letterSpacing:1}),cursor:_p,opacity:removingBg?0.5:1}}>CROP</button>
              <button onClick={applyWithBgRemoval} disabled={removingBg} style={{flex:2,padding:"14px",borderRadius:14,background:removingBg?"#2A2A2A":`linear-gradient(135deg,${G},#8A6E54)`,border:"none",...ss(9,700,removingBg?DM:BK,{letterSpacing:0.8}),cursor:_p,transition:"all 0.3s"}}>
                {removingBg?"REMOVING BG...":"CROP & REMOVE BACKGROUND"}
              </button>
            </React.Fragment>
          )}
        </div>
      </div>
    </div>
  );
}

function ItemDetail({item,onClose,onAddToOutfit,showToast,onRemove,onUpdate}){
  const [activePair,setActivePair]=useState(null);
  const [editing,setEditing]=useState(false);
  const [editName,setEditName]=useState("");
  const [editPrice,setEditPrice]=useState("");
  const [editDate,setEditDate]=useState("");
  const [editCategory,setEditCategory]=useState("");
  const [editBrand,setEditBrand]=useState("");
  const [editImage,setEditImage]=useState(null);
  const [editColor,setEditColor]=useState("#C4A882");
  const [cropSrc,setCropSrc]=useState(null); // image waiting to be cropped
  const imgRef=useRef();

  if(!item) return null;

  const categories=["Tops","Bottoms","Dresses","Outerwear","Shoes","Accessories"];
  const categoryEmoji={Tops:"👕",Bottoms:"👖",Dresses:"👗",Outerwear:"🧥",Shoes:"👟",Accessories:"✨"};

  const openEdit=()=>{
    setEditName(item.name);
    setEditPrice(String(item.price));
    setEditDate(item.purchaseDate||"");
    setEditCategory(item.category||"Tops");
    setEditBrand(item.brand||"");
    setEditImage(item.sourceImage||null);
    setEditColor(item.color||"#C4A882");
    setEditing(true);
  };

  const saveEdit=()=>{
    const updated={
      ...item,
      name: editName.trim()||item.name,
      brand: editBrand.trim()||item.brand,
      price: parseInt(editPrice)||item.price,
      purchaseDate: editDate||item.purchaseDate,
      category: editCategory||item.category,
      color: editColor||item.color,
      sourceImage: editImage,
      _oldSourceImage: item.sourceImage, // for feed sync — old URL before edit
    };
    if(onUpdate) onUpdate(updated);
    setEditing(false);
    showToast("Changes saved \u2746");
  };

  const pairingMap={Tops:["Bottoms","Shoes","Outerwear"],Bottoms:["Tops","Shoes","Accessories"],Dresses:["Shoes","Outerwear","Accessories"],Outerwear:["Tops","Bottoms","Shoes"],Shoes:["Bottoms","Dresses","Tops"],Accessories:["Tops","Dresses","Outerwear"]};
  const tipMap={
    Tops:{Bottoms:"Tuck in for a polished silhouette",Shoes:"Match shoe tone to your top for harmony",Outerwear:"Layer open for an effortless look"},
    Bottoms:{Tops:"A fitted top balances wide-leg cuts",Shoes:"Ankle-grazing length elongates the leg",Accessories:"A belt ties the whole look together"},
    Dresses:{Shoes:"Block heels add height without effort",Outerwear:"A structured coat elevates any dress",Accessories:"One statement piece is enough"},
    Outerwear:{Tops:"Let the collar peek above the lapel",Bottoms:"Straight-leg trousers keep it clean",Shoes:"Boots ground an oversized coat perfectly"},
    Shoes:{Bottoms:"Match hem length to shoe style",Dresses:"Let the shoe be the focal point",Tops:"Tuck in to show off the full shoe"},
    Accessories:{Tops:"Wear with a simple neckline",Dresses:"One layer of jewellery reads luxe",Outerwear:"Pin a brooch to the lapel"},
  };
  const catIcon={Tops:"👕",Bottoms:"👖",Shoes:"👟",Dresses:"👗",Outerwear:"🧥",Accessories:"✨"};
  const pairCats=pairingMap[item.category]||["Tops","Bottoms","Shoes"];

  const inputStyle={width:"100%",boxSizing:"border-box",background:"#0D0D0D",border:`1px solid ${G}44`,borderRadius:10,padding:"10px 14px",...ss(12,400,"#C0B8B0"),color:"#C0B8B0",outline:"none"};

  return(
    <div onClick={onClose} style={{..._fix,background:"#00000099",display:"flex",alignItems:"flex-start",paddingTop:60,zIndex:80}}>
      <div onClick={e=>e.stopPropagation()} style={{background:CD,borderRadius:"0 0 24px 24px",padding:"24px",width:"100%",maxWidth:430,margin:"0 auto",border:_2a,animation:"fadeDown 0.3s ease forwards",maxHeight:"90vh",overflowY:"auto"}}>

        {/* ── EDIT MODE ── */}
        {editing ? (
          <React.Fragment>
            <div style={{..._btwn,marginBottom:20}}>
              <div style={sr(18,400)}>Edit Item</div>
              <button onClick={()=>setEditing(false)} style={{background:"none",border:"none",cursor:_p,...ss(12,400,DM)}}>Cancel</button>
            </div>

            {/* Image */}
            <div style={{marginBottom:16}}>
              <div style={ss(9,400,DM,{letterSpacing:1.5,marginBottom:8})}>PHOTO</div>
              <input ref={imgRef} type="file" accept="image/*" style={{display:"none"}} onChange={e=>{
                const file=e.target.files?.[0]; if(!file) return;
                const reader=new FileReader();
                reader.onload=ev=>setCropSrc(ev.target.result);
                reader.readAsDataURL(file);
              }}/>
              <div style={{display:"flex",gap:12,alignItems:"center"}}>
                <div style={{width:80,height:80,borderRadius:14,background:`linear-gradient(135deg,${item.color}22,${item.color}44)`,overflow:"hidden",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",border:`1px solid ${G}33`}}>
                  {editImage
                    ? <img src={editImage} style={{width:"100%",height:"100%",objectFit:"cover"}} alt="preview"/>
                    : <ItemIllustration item={item} size={60}/>
                  }
                </div>
                <div style={{display:"flex",flexDirection:"column",gap:8,flex:1}}>
                  <button onClick={()=>imgRef.current.click()} style={{padding:"9px 14px",borderRadius:10,background:_1a,border:`1px solid ${G}44`,...ss(9,600,G,{letterSpacing:1}),cursor:_p}}>
                    📷 {editImage?"REPLACE PHOTO":"UPLOAD PHOTO"}
                  </button>
                  {editImage && (
                    <button onClick={()=>setCropSrc(editImage)} style={{padding:"9px 14px",borderRadius:10,background:_1a,border:`1px solid ${G}44`,...ss(9,600,G,{letterSpacing:1}),cursor:_p}}>
                      ✂️ CROP PHOTO
                    </button>
                  )}
                  {editImage && (
                    <button onClick={()=>setEditImage(null)} style={{padding:"9px 14px",borderRadius:10,background:"#1A0A0A",border:"1px solid #3A1A1A",...ss(9,600,"#A86060",{letterSpacing:1}),cursor:_p}}>
                      × REMOVE
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Crop modal */}
            {cropSrc&&(
              <CropModal
                src={cropSrc}
                onCancel={()=>setCropSrc(null)}
                onSave={cropped=>{setEditImage(cropped);setCropSrc(null);}}
                autoRemoveBg={true}
              />
            )}

            {/* Name */}
            <div style={{marginBottom:12}}>
              <div style={ss(9,400,DM,{letterSpacing:1.5,marginBottom:6})}>ITEM NAME</div>
              <input value={editName} onChange={e=>setEditName(e.target.value)} style={inputStyle} placeholder="e.g. Silk Ivory Blouse"/>
            </div>

            {/* Brand */}
            <div style={{marginBottom:12}}>
              <div style={ss(9,400,DM,{letterSpacing:1.5,marginBottom:6})}>BRAND</div>
              <input value={editBrand} onChange={e=>setEditBrand(e.target.value)} style={inputStyle} placeholder="e.g. Aritzia, Zara, Unknown"/>
            </div>

            {/* Price */}
            <div style={{marginBottom:12}}>
              <div style={ss(9,400,DM,{letterSpacing:1.5,marginBottom:6})}>PRICE ($)</div>
              <input value={editPrice} onChange={e=>setEditPrice(e.target.value.replace(/\D/g,""))} style={inputStyle} placeholder="e.g. 180" inputMode="numeric"/>
            </div>

            {/* Category */}
            <div style={{marginBottom:12}}>
              <div style={ss(9,400,DM,{letterSpacing:1.5,marginBottom:8})}>CATEGORY</div>
              <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                {categories.map(cat=>(
                  <button key={cat} onClick={()=>setEditCategory(cat)} style={{
                    padding:"7px 14px",borderRadius:20,cursor:_p,
                    background:editCategory===cat?`${G}22`:_1a,
                    border:editCategory===cat?`1.5px solid ${G}`:`1px solid #2A2A2A`,
                    display:"flex",alignItems:"center",gap:5,
                    ...ss(10,editCategory===cat?600:400,editCategory===cat?G:DM,{letterSpacing:0.5}),
                  }}>
                    <span>{categoryEmoji[cat]}</span>{cat}
                  </button>
                ))}
              </div>
            </div>

            {/* Color */}
            <div style={{marginBottom:16}}>
              <div style={ss(9,400,DM,{letterSpacing:1.5,marginBottom:8})}>COLOR</div>
              <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
                {["#F5F0EB","#1A1A1A","#C4A882","#7A5030","#808080","#3A3A3A","#C03030","#E88090","#8060A0","#3060A0","#60A0D0","#407840","#6A7040","#F0C040","#E07830"].map(hex=>(
                  <button key={hex} onClick={()=>setEditColor(hex)} style={{
                    width:28,height:28,borderRadius:"50%",background:hex,border:editColor===hex?`3px solid ${G}`:"2px solid #2A2A2A",
                    cursor:_p,flexShrink:0,boxShadow:editColor===hex?`0 0 0 1px #0D0D0D inset`:""
                  }}/>
                ))}
                <input type="color" value={editColor} onChange={e=>setEditColor(e.target.value)}
                  style={{width:28,height:28,borderRadius:"50%",border:"2px solid #2A2A2A",background:"none",cursor:_p,padding:0,outline:"none"}}
                  title="Custom color"/>
              </div>
            </div>

            {/* Purchase date */}
            <div style={{marginBottom:20}}>
              <MonthYearPicker label="DATE PURCHASED" value={editDate} onChange={setEditDate}/>
            </div>

            <button onClick={saveEdit} style={{width:"100%",padding:"13px",borderRadius:14,background:`linear-gradient(135deg,${G},#8A6E54)`,border:"none",...ss(10,700,BK,{letterSpacing:1.5}),cursor:_p}}>
              SAVE CHANGES
            </button>
          </React.Fragment>
        ) : (
          <React.Fragment>
            {/* ── VIEW MODE ── */}
            <div style={{display:"flex",gap:18,marginBottom:20}}>
              <div style={{width:88,height:88,borderRadius:18,background:`linear-gradient(135deg,${item.color}22,${item.color}55)`,overflow:"hidden",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}>
                {item.sourceImage?<img src={item.sourceImage} style={{width:"100%",height:"100%",objectFit:"cover"}} alt={item.name}/>:<ItemIllustration item={item} size={80}/>}
              </div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{..._btwn,alignItems:"flex-start"}}>
                  <div style={sr(20,500,undefined,{lineHeight:1.2,flex:1,marginRight:8})}>{item.name}</div>
                  <button onClick={openEdit} style={{flexShrink:0,padding:"5px 12px",borderRadius:20,background:_1a,border:`1px solid ${G}44`,...ss(9,600,G,{letterSpacing:0.5}),cursor:_p}}>EDIT</button>
                </div>
                <div style={ss(10,400,DM,{letterSpacing:1,marginTop:4})}>{item.brand} · {item.category}</div>
                <div style={sr(18,400,G,{marginTop:6})}>${item.price}</div>
              </div>
            </div>

            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:16}}>
              {[["Worn",item.wearCount+"x"],["Last Worn",item.lastWorn],["Purchased",item.purchaseDate]].map(([l,v])=>(
                <div key={l} style={{background:_1a,borderRadius:12,padding:"10px 12px",textAlign:"center"}}>
                  <div style={sr(16,500,G)}>{v}</div>
                  <div style={ss(9,400,DM,{letterSpacing:1,textTransform:"uppercase",marginTop:3})}>{l}</div>
                </div>
              ))}
            </div>

            <div style={{background:_1a,borderRadius:14,padding:"14px",marginBottom:14}}>
              {[["Condition",item.condition],["Category",item.category]].map(([k,v])=>(
                <div key={k} style={{display:"flex",justifyContent:"space-between",marginBottom:8,paddingBottom:8,borderBottom:`1px solid ${BR}`}}>
                  <div style={ss(12,400,DM,{letterSpacing:1})}>{k}</div>
                  <div style={ss(12,400,MD)}>{v}</div>
                </div>
              ))}
              <div style={{..._btwn}}>
                <div style={ss(12,400,DM,{letterSpacing:1})}>Color</div>
                <div style={{..._row,gap:7}}>
                  <div style={{width:14,height:14,borderRadius:"50%",background:item.color,border:"1px solid #FFFFFF22"}}/>
                  <div style={ss(12,400,MD)}>{hexToColorName(item.color)}</div>
                </div>
              </div>
            </div>

            <div style={{marginBottom:16}}>
              <Lbl mb={10}>PAIRS WELL WITH</Lbl>
              <div style={{display:"flex",gap:8}}>
                {pairCats.map(cat=>{
                  const isActive=activePair===cat;
                  return(
                    <div key={cat} onClick={()=>setActivePair(isActive?null:cat)}
                      style={{flex:1,borderRadius:14,background:isActive?`linear-gradient(135deg,${G}18,${G}28)`:"#1A1A1A",border:`1px solid ${isActive?G:BR}`,padding:"10px 6px",textAlign:"center",cursor:_p,transition:"all 0.2s"}}>
                      <div style={{fontSize:22,marginBottom:5}}>{catIcon[cat]||"✦"}</div>
                      <div style={ss(9,isActive?600:400,isActive?G:MD,{letterSpacing:0.3})}>{cat}</div>
                    </div>
                  );
                })}
              </div>
              {activePair&&(
                <div style={{marginTop:10,background:`linear-gradient(135deg,${G}10,${G}18)`,borderRadius:12,padding:"10px 14px",border:`1px solid ${G}33`}}>
                  <div style={ss(11,400,MD,{lineHeight:1.5,fontStyle:"italic"})}>
                    ✦ {(tipMap[item.category]||{})[activePair]||`${activePair} pair beautifully with ${item.category.toLowerCase()}.`}
                  </div>
                </div>
              )}
            </div>

            <div style={{display:"flex",gap:10,flexDirection:"column"}}>
              {item.tags?.includes("demo") && (
                <div style={{background:"#1A1A0A",border:`1px solid ${G}33`,borderRadius:10,padding:"8px 14px",display:"flex",alignItems:"center",gap:8}}>
                  <span style={{fontSize:12}}>ℹ️</span>
                  <span style={ss(9,400,DM,{lineHeight:1.4})}>This is a demo item. Add your own items via Photo Upload or URL to build your real closet.</span>
                </div>
              )}
              <div style={{display:"flex",gap:10}}>
                <Btn onClick={()=>{showToast("Go to Market tab to list this item \u2746");onClose();}} outline>LIST FOR SALE</Btn>
                <Btn onClick={()=>{onAddToOutfit(item.id);onClose();}} full>ADD TO OUTFIT</Btn>
              </div>
              {onRemove && (
                <button onClick={()=>{
                  if(window.confirm(`Remove "${item.name}" from your closet?`)){
                    onRemove(item.id);
                    onClose();
                    showToast(`${item.name} removed \u2746`);
                  }
                }} style={{width:"100%",padding:"11px",borderRadius:12,background:"#1A0A0A",border:"1px solid #3A1A1A",...ss(9,600,"#A86060",{letterSpacing:1}),cursor:_p}}>
                  REMOVE FROM CLOSET
                </button>
              )}
            </div>
          </React.Fragment>
        )}
      </div>
    </div>
  );
}

// ── OUTFITS ──────────────────────────────────────────────────────────────────
// ── SWIPE ROW ─────────────────────────────────────────────────────────────────
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
    <div style={{borderRadius:20,overflow:"hidden",marginBottom:6,background:CD,border:`1px solid ${BR}`,height:130,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:8}}>
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
        <div style={{position:"absolute",top:0,bottom:0,left:20,right:20,borderRadius:20,overflow:"hidden",background:"linear-gradient(135deg,#1A1510,#1E1A14)",border:`1px solid ${behindItem.color}33`,transform:`scale(${0.94+dragPct*0.06})`,transition:"transform 0.1s",display:"flex",alignItems:"center"}}>
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
          borderRadius:20,overflow:"hidden",
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
            <div style={{marginTop:8,display:"inline-block",background:G,borderRadius:8,padding:"3px 10px",...ss(7,700,BK,{letterSpacing:1})}}>FOR SALE</div>
          )}
        </div>

        {/* Swipe hints */}
        {dragX<-20&&<div style={{position:"absolute",top:14,right:14,border:"2px solid #E08080",borderRadius:10,padding:"3px 10px",...ss(10,700,"#E08080",{letterSpacing:2}),opacity:Math.min(1,(-dragX-20)/60),transform:"rotate(-4deg)"}}>NEXT</div>}
        {dragX>20&&<div style={{position:"absolute",top:14,left:14,border:"2px solid #80C880",borderRadius:10,padding:"3px 10px",...ss(10,700,"#80C880",{letterSpacing:2}),opacity:Math.min(1,(dragX-20)/60),transform:"rotate(4deg)"}}>PREV</div>}

        {/* Laundry overlay */}
        {showLaundry&&(
          <div style={{..._abs0,background:"#0D0D0DEE",borderRadius:20,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:10,zIndex:10}}
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
function MixMatchBuilder({tops,bottoms,shoes,outerwear,accessories,showToast,logWear,outfits,setOutfits,setItems,items,onNewLook,onSaveOutfit,styleProfile={},saveStyleProfile,postWearFeedEvent,onboardStep=4,advanceOnboard}){
  const TEMP = 58; // degrees F — drives outerwear default
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
    const weather=`${TEMP}°F, Partly Cloudy`;

    // Build style profile context for the prompt
    const profileParts = [];
    if(styleProfile.aesthetic?.length) profileParts.push(`Aesthetic: ${styleProfile.aesthetic.join(", ")}`);
    if(styleProfile.occasions?.length) profileParts.push(`Dresses for: ${styleProfile.occasions.join(", ")}`);
    if(styleProfile.fitPref?.length) profileParts.push(`Fit preference: ${styleProfile.fitPref.join(", ")}`);
    if(styleProfile.avoidPairings?.length) profileParts.push(`Avoid: ${styleProfile.avoidPairings.join(", ")}`);
    if(styleProfile.colorPalette) profileParts.push(`Color palette: ${styleProfile.colorPalette}`);
    if(styleProfile.styleIcons) profileParts.push(`Style reference: ${styleProfile.styleIcons}`);
    if(styleProfile.likedCombos?.length > 0){
      const vibes = [...new Set(styleProfile.likedCombos.slice(-5).map(c=>c.vibe).filter(Boolean))];
      if(vibes.length) profileParts.push(`Vibes the user has enjoyed: ${vibes.join(", ")} — use as style inspiration, not to repeat exact items`);
    }
    if(styleProfile.dislikedCombos?.length > 0){
      const recent = styleProfile.dislikedCombos.slice(-5).map(c=>c.names?.join(" + ")).filter(Boolean);
      if(recent.length) profileParts.push(`Combinations the user is less keen on (suggest less often, but not never): ${recent.join(" | ")}`);
    }
    const profileContext = profileParts.length
      ? `\nUser style profile — use as soft guidance:\n${profileParts.map(p=>`• ${p}`).join("\n")}\n`
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
    if(combo.length===0){showToast("Add items to your closet first \u2746");return;}
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

      {/* Header row */}
      <div style={{marginBottom:10}}>
        <div style={sr(18,400)}>Mix & Match</div>
        <div style={ss(9,400,DM,{letterSpacing:1,marginTop:1})}>SWIPE  ·  HOLD TO REMOVE  ·  TAP TWICE TO LOCK</div>
      </div>

      {/* Laundry restore pill */}
      {unavailable.size>0&&(
        <div style={{..._btwn,background:"#2A1A0A",border:"1px solid #4A3020",borderRadius:10,padding:"7px 12px",marginBottom:10}}>
          <div style={ss(9,400,"#C8A060")}>🧺 {unavailable.size} item{unavailable.size>1?"s":""} in laundry</div>
          <button onClick={restoreAll} style={{background:"none",border:"none",cursor:_p,...ss(9,600,"#C8A060",{letterSpacing:0.5})}}>RESTORE ALL</button>
        </div>
      )}

      {/* ── AI STYLE BUTTON ── */}
      <button onClick={suggestWithAI} disabled={aiLoading}
        style={{width:"100%",marginBottom:14,padding:"9px 16px",borderRadius:14,
          background:aiLoading?_1a:`linear-gradient(135deg,${G},#A08060,#C4A882)`,
          border:"none",display:"flex",alignItems:"center",justifyContent:"center",gap:8,
          cursor:aiLoading?"default":_p,
          boxShadow:aiLoading?"none":`0 0 16px ${G}33`,
          transition:"box-shadow 0.3s,background 0.3s",
          opacity:aiLoading?0.7:1,
        }}>
        <span style={{fontSize:15,animation:aiLoading?"spin 1s linear infinite":undefined}}>✦</span>
        <div style={{textAlign:"left"}}>
          <div style={ss(10,700,aiLoading?MD:BK,{letterSpacing:2})}>
            {aiLoading?"STYLING YOUR LOOK…"
              : Object.values(locked).some(Boolean) ? "RE-STYLE UNLOCKED ROWS" : "STYLE WITH AI"}
          </div>
          <div style={ss(7,400,aiLoading?"#4A4038":BK,{letterSpacing:0.8,opacity:0.65,marginTop:1})}>
            {aiLoading?"Picking the perfect combination"
              : Object.values(locked).some(Boolean)
                ? `Keeping ${[locked.top&&top?.name,locked.bottom&&bottom?.name,locked.shoe&&shoe?.name,locked.outerwear&&outer?.name,locked.accessory&&accessory?.name].filter(Boolean).join(", ")}`
                : "Let AI build today's outfit from your closet"}
          </div>
        </div>
      </button>

      {/* ── AI FEEDBACK (shown after AI generates) ── */}
      {lastAiCombo && !aiLoading && (
        <div style={{marginBottom:14}}>
          <div style={{display:"flex",gap:8,marginBottom:6,alignItems:"center",justifyContent:"center"}}>
            <div style={ss(9,400,DM,{letterSpacing:0.5})}>Rate this combo:</div>
            <button onClick={()=>{
              setMixFeedbackRating(r=>r==="up"?null:"up");
              setMixFeedbackText("");
            }} style={{padding:"6px 14px",borderRadius:20,background:mixFeedbackRating==="up"?"#1A2A1A":"#111",border:mixFeedbackRating==="up"?"1px solid #2A4A2A":"1px solid #2A2A2A",cursor:_p,...ss(13,400,mixFeedbackRating==="up"?"#80C880":DM),display:"flex",alignItems:"center",gap:4}}>
              👍
            </button>
            <button onClick={()=>{
              setMixFeedbackRating(r=>r==="down"?null:"down");
              setMixFeedbackText("");
            }} style={{padding:"6px 14px",borderRadius:20,background:mixFeedbackRating==="down"?"#2A1A1A":"#111",border:mixFeedbackRating==="down"?"1px solid #4A2A2A":"1px solid #2A2A2A",cursor:_p,...ss(13,400,mixFeedbackRating==="down"?"#C08080":DM),display:"flex",alignItems:"center",gap:4}}>
              👎
            </button>
          </div>
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
                }} style={{flex:1,padding:"8px",borderRadius:10,background:"#1A1A1A",border:"1px solid #2A2A2A",...ss(9,600,DM,{letterSpacing:0.8}),cursor:_p}}>SKIP</button>
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
                }} style={{flex:2,padding:"8px",borderRadius:10,background:mixFeedbackProcessing?"#1A1A1A":`linear-gradient(135deg,${G},#8A6E54)`,border:"none",...ss(9,700,mixFeedbackProcessing?DM:BK,{letterSpacing:0.8}),cursor:_p,opacity:mixFeedbackProcessing?0.6:1}}>
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
          style={{padding:"5px 10px",borderRadius:20,background:showOuterwear?`${G}22`:_1a,border:showOuterwear?`1px solid ${G}66`:_2a,cursor:_p,...ss(9,showOuterwear?600:400,showOuterwear?G:DM,{letterSpacing:0.5}),display:"flex",alignItems:"center",gap:3,flexShrink:0,whiteSpace:"nowrap"}}>
          <span>🧥</span> Outerwear {TEMP<65&&!showOuterwear?<span style={{fontSize:7,background:"#2A3A2A",color:"#80C080",borderRadius:4,padding:"1px 4px",marginLeft:2}}>cold</span>:null}
        </button>
        <button onClick={()=>setShowAccessories(v=>!v)}
          style={{padding:"5px 10px",borderRadius:20,background:showAccessories?`${G}22`:_1a,border:showAccessories?`1px solid ${G}66`:_2a,cursor:_p,...ss(9,showAccessories?600:400,showAccessories?G:DM,{letterSpacing:0.5}),display:"flex",alignItems:"center",gap:3,flexShrink:0,whiteSpace:"nowrap"}}>
          <span>💍</span> Accessories
        </button>
        <button onClick={()=>{setDressMode(v=>!v);setTi(0);setAiVibe(null);}}
          style={{padding:"5px 10px",borderRadius:20,background:dressMode?`${G}22`:_1a,border:dressMode?`1px solid ${G}66`:_2a,cursor:_p,...ss(9,dressMode?600:400,dressMode?G:DM,{letterSpacing:0.5}),display:"flex",alignItems:"center",gap:3,flexShrink:0,whiteSpace:"nowrap"}}>
          <span>👗</span> Dresses
        </button>
        <button onClick={onNewLook} title="Build new look" style={{marginLeft:"auto",width:32,height:32,borderRadius:10,background:CD,border:`1px solid ${BR}`,display:"flex",alignItems:"center",justifyContent:"center",cursor:_p,flexShrink:0,...ss(18,300,MD)}}>+</button>
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
      {showOuterwear&&avOuterwear.length>0&&(
        <React.Fragment>
          <SwipeRow label="Outerwear"   arr={avOuterwear}   idx={oSafe}  setIdx={setOi} emoji="🧥" isLocked={locked.outerwear} onLockToggle={()=>toggleLock("outerwear")} onMarkUnavailable={markUnavailable} onCycleEnd={()=>setAiVibe(null)}/>
          <div style={{height:28}}/>
        </React.Fragment>
      )}
      {showOuterwear&&avOuterwear.length===0&&(
        <div style={{borderRadius:16,background:CD,border:`1px solid ${BR}`,height:60,display:"flex",alignItems:"center",justifyContent:"center",marginBottom:8,...ss(9,400,DM,{fontStyle:"italic"})}}>No outerwear in your closet yet</div>
      )}
      <SwipeRow label={isDress?"Dress":"Tops"} arr={avTops} idx={tSafe} setIdx={setTi} emoji="👚" isLocked={locked.top} onLockToggle={()=>toggleLock("top")} onMarkUnavailable={markUnavailable} onCycleEnd={()=>setAiVibe(null)}/>
      {dressMode&&avTops.length===0&&(
        <div style={{borderRadius:16,background:CD,border:`1px solid ${BR}`,height:60,display:"flex",alignItems:"center",justifyContent:"center",marginBottom:8,...ss(9,400,DM,{fontStyle:"italic"})}}>No dresses in your closet yet</div>
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
        <div style={{borderRadius:16,background:CD,border:`1px solid ${BR}`,height:60,display:"flex",alignItems:"center",justifyContent:"center",marginBottom:8,...ss(9,400,DM,{fontStyle:"italic"})}}>No accessories in your closet yet</div>
      )}

      {/* Action row */}
      <div style={{display:"flex",gap:8,marginTop:6}}>
        <button onClick={()=>setShowSaveModal(true)} style={{flex:1,padding:"13px",borderRadius:14,background:CD,border:`1px solid ${G}44`,...ss(10,700,G,{letterSpacing:1.5}),cursor:_p}}>
          SAVE OUTFIT
        </button>
        <button onClick={wearToday} style={{flex:1,padding:"13px",borderRadius:14,background:saved?`linear-gradient(135deg,#2A4A2A,#1A3A1A)`:`linear-gradient(135deg,${G},#8A6E54)`,border:"none",...ss(10,700,saved?"#80C080":BK,{letterSpacing:1.5}),cursor:_p,transition:"background 0.3s"}}>
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
              <button onClick={()=>setShowSaveModal(false)} style={{flex:1,padding:"12px",borderRadius:14,background:_1a,border:_2a,...ss(9,600,DM,{letterSpacing:1}),cursor:_p}}>CANCEL</button>
              <button onClick={saveCurrentAsOutfit} style={{flex:2,padding:"12px",borderRadius:14,background:`linear-gradient(135deg,${G},#8A6E54)`,border:"none",...ss(9,600,BK,{letterSpacing:1.5}),cursor:_p}}>SAVE LOOK ✦</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function OutfitsTab({items,outfits,setOutfits,setItems,showToast,logWear,onSaveOutfit,onDeleteOutfit,styleProfile={},saveStyleProfile,postWearFeedEvent,onboardStep=4,advanceOnboard}){
  const [builder,setBuilder]=useState([]);
  const [name,setName]=useState("");
  const [occasion,setOccasion]=useState("Casual");
  const [mirror,setMirror]=useState(null);
  const [activeFilter,setActiveFilter]=useState("All");
  const [showBuilder,setShowBuilder]=useState(false);
  const [pinned,setPinned]=useState(new Set([1]));
  const [favorites,setFavorites]=useState(new Set([1,3]));
  const [todayOccasion,setTodayOccasion]=useState(null);
  const [selectedOutfit,setSelectedOutfit]=useState(null);
  const [bSearch,setBSearch]=useState("");

  const weather={temp:"58°F",condition:"Partly Cloudy",icon:"⛅"};
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

      {/* ── ONBOARDING STEP 2 BANNER ── */}
      {onboardStep===2&&(
        <div style={{background:"linear-gradient(135deg,#1A1610,#141008)",border:`1px solid ${G}44`,borderRadius:14,padding:"14px 16px",marginBottom:16}}>
          <div style={{..._row,gap:8,marginBottom:8}}>
            <span style={{fontSize:14}}>✦</span>
            <div style={ss(10,700,G,{letterSpacing:1})}>STEP 2 OF 3 — BUILD YOUR FIRST OUTFIT</div>
          </div>
          <div style={ss(11,400,"#A09080",{marginBottom:10,lineHeight:1.5})}>Use Mix & Match or the outfit builder to create and save your first look</div>
          <div style={{display:"flex",gap:8}}>
            <div style={{flex:1,background:"#111",borderRadius:10,padding:"8px",textAlign:"center",border:"1px solid #2A2A2A"}}>
              <div style={{fontSize:16,marginBottom:3}}>🔀</div>
              <div style={ss(8,400,DM)}>Mix & Match</div>
            </div>
            <div style={{flex:1,background:"#111",borderRadius:10,padding:"8px",textAlign:"center",border:"1px solid #2A2A2A"}}>
              <div style={{fontSize:16,marginBottom:3}}>✦</div>
              <div style={ss(8,400,DM)}>Style with AI</div>
            </div>
            <div style={{flex:1,background:"#111",borderRadius:10,padding:"8px",textAlign:"center",border:"1px solid #2A2A2A"}}>
              <div style={{fontSize:16,marginBottom:3}}>💾</div>
              <div style={ss(8,400,DM)}>Save Look</div>
            </div>
          </div>
        </div>
      )}
      <div style={{..._btwnS,marginBottom:16}}>
        <div>
          <div style={sr(22,300)}>Your Looks</div>
          <div style={ss(10,400,DM,{letterSpacing:1,marginTop:2})}>{outfits.length} SAVED OUTFITS</div>
        </div>
        <div style={{..._row,gap:8}}>
          <button onClick={()=>setShowBuilder(b=>!b)} style={{padding:"8px 16px",borderRadius:20,background:showBuilder?G:"#1A1A1A",border:showBuilder?"none":"1px solid #2A2A2A",...ss(9,600,showBuilder?BK:MD,{letterSpacing:1}),cursor:_p}}>
            {showBuilder?"✕ CLOSE":"+ NEW LOOK"}
          </button>
        </div>
      </div>

      {/* ── TODAY STRIP + STYLE WITH AI ── */}
      <div style={{display:"flex",gap:8,marginBottom:14}}>
        {/* Weather card */}
        <div style={{flex:1,background:"linear-gradient(135deg,#1A1A2E,#16213E)",borderRadius:16,padding:"10px 12px",border:"1px solid #2A2A4A",display:"flex",alignItems:"center",gap:10}}>
          <div style={{fontSize:24,flexShrink:0}}>{weather.icon}</div>
          <div style={{minWidth:0}}>
            <div style={ss(7,400,"#8A90B8",{letterSpacing:1.2,textTransform:"uppercase"})}>{today}</div>
            <div style={{display:"flex",alignItems:"baseline",gap:5,marginTop:1}}>
              <div style={sr(17,300,"#D0D4F0")}>{weather.temp}</div>
              <div style={ss(8,400,"#6A70A8")}>{weather.condition}</div>
            </div>
          </div>
        </div>
        {/* Style with AI card */}
        <button onClick={()=>setShowBuilder(true)}
          style={{width:88,flexShrink:0,background:"linear-gradient(135deg,#1A1410,#201810)",borderRadius:16,padding:"10px 8px",border:`1px solid ${G}44`,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:4,cursor:_p}}>
          <div style={{fontSize:20}}>✦</div>
          <div style={ss(8,600,G,{letterSpacing:0.8,textAlign:"center"})}>STYLE WITH AI</div>
        </button>
      </div>

      {/* ── MIX & MATCH ── */}
      {activeFilter==="All" && (()=>{
        const tops       = items.filter(i=>["Tops","Dresses"].includes(i.category));
        const bottoms    = items.filter(i=>i.category==="Bottoms");
        const shoes      = items.filter(i=>i.category==="Shoes");
        const outerwear  = items.filter(i=>i.category==="Outerwear");
        const accessories= items.filter(i=>i.category==="Accessories");
        return <MixMatchBuilder tops={tops} bottoms={bottoms} shoes={shoes} outerwear={outerwear} accessories={accessories} items={items} showToast={showToast} logWear={logWear} outfits={outfits} setOutfits={setOutfits} setItems={setItems} onNewLook={()=>setShowBuilder(true)} onSaveOutfit={onSaveOutfit} styleProfile={styleProfile} saveStyleProfile={saveStyleProfile} postWearFeedEvent={postWearFeedEvent} onboardStep={onboardStep} advanceOnboard={advanceOnboard}/>;
      })()}


      {/* Filter chips */}
      <div style={{display:"flex",gap:6,overflowX:"auto",marginBottom:16,paddingBottom:2}}>
        {filters.map(f=>{
          const isActive=activeFilter===f;
          const count=counts[f]||0;
          return(
            <button key={f} onClick={()=>setActiveFilter(f)} className="pb" style={{
              flexShrink:0,padding:"6px 12px",borderRadius:20,
              background:isActive?G:"#1A1A1A",
              border:isActive?"none":"1px solid #222",
              display:"flex",alignItems:"center",gap:5,
              cursor:_p,
            }}>
              <span style={ss(9,isActive?600:400,isActive?BK:DM,{letterSpacing:0.8,whiteSpace:"nowrap"})}>
                {f==="Pinned"?"📌 "+f:f==="Favorites"?"♡ "+f:f}
              </span>
              {count>0&&<span style={{...ss(8,700,isActive?BK:DM),background:isActive?"#0000002A":"#2A2A2A",borderRadius:10,padding:"1px 5px"}}>{count}</span>}
            </button>
          );
        })}
      </div>

      {/* Outfit list */}
      {filtered.length===0?(
        <div style={{textAlign:"center",padding:"32px 0",opacity:0.4}}>
          <div style={sr(16,300,DM,{fontStyle:"italic"})}>No outfits here yet</div>
          <div style={ss(9,400,DM,{marginTop:6})}>Save a new look or change the filter</div>
        </div>
      ):filtered.filter(o=>!todayOccasion||o.occasion===todayOccasion).map(outfit=>{
        const isPinned=pinned.has(outfit.id);
        const isFav=favorites.has(outfit.id);
        const accentCol=occasionColour[outfit.occasion]||"#4A4038";
        return(
          <React.Fragment key={outfit.id}>
          <div className="ch" onClick={()=>setSelectedOutfit(outfit)} style={{background:CD,borderRadius:18,padding:"16px 18px",marginBottom:12,border:`1px solid ${BR}`,position:"relative",overflow:"hidden",cursor:_p}}>
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
              <button onClick={e=>{e.stopPropagation();setMirror({itemIds:outfit.items,name:outfit.name});}} style={{flex:1,padding:"8px",borderRadius:11,background:"linear-gradient(135deg,#14101A,#1A1424)",border:"1px solid #2A2040",display:"flex",alignItems:"center",justifyContent:"center",gap:5,cursor:_p,...ss(9,600,"#C0B0D8",{letterSpacing:1})}}>
                <span style={{fontSize:12}}>🪞</span>MIRROR
              </button>
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
              <div style={{background:CD,borderRadius:18,padding:"16px 18px",marginBottom:12,border:`1px solid ${G}44`}}>
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
                    <div key={l} style={{flex:1,background:_1a,borderRadius:10,padding:"8px",textAlign:"center",border:"1px solid #222"}}>
                      <div style={sr(14,500,G)}>{v}</div>
                      {l&&<div style={ss(7,400,DM,{letterSpacing:1,marginTop:1})}>{l}</div>}
                    </div>
                  ))}
                </div>
                {/* Actions */}
                <div style={{display:"flex",gap:8,marginBottom:16}}>
                  <button onClick={()=>{logWear(o.id);showToast(`Wearing "${o.name}" today \u2746`);setSelectedOutfit(null);}} style={{flex:2,padding:"11px",borderRadius:12,background:`linear-gradient(135deg,${G},#8A6E54)`,border:"none",...ss(10,700,BK,{letterSpacing:1}),cursor:_p}}>WEAR TODAY</button>
                  <button onClick={()=>{setMirror({itemIds:o.items,name:o.name});setSelectedOutfit(null);}} style={{padding:"11px 14px",borderRadius:12,background:"linear-gradient(135deg,#14101A,#1A1424)",border:"1px solid #2A2040",display:"flex",alignItems:"center",gap:5,cursor:_p,...ss(9,600,"#C0B0D8",{letterSpacing:1})}}>
                    <span style={{fontSize:13}}>🪞</span>MIRROR
                  </button>
                  <button onClick={()=>{showToast(`"${o.name}" shared to feed \u2746`);setSelectedOutfit(null);}} style={{padding:"11px 12px",borderRadius:12,background:_1a,border:_2a,display:"flex",alignItems:"center",gap:5,cursor:_p,...ss(9,600,MD,{letterSpacing:0.5})}}>
                    <span style={{fontSize:12}}>✦</span>SHARE
                  </button>
                </div>
                {/* Items */}
                <div style={ss(8,600,DM,{letterSpacing:2,marginBottom:10})}>ITEMS IN THIS OUTFIT</div>
                {outfitItems.map(item=>(
                  <div key={item.id} style={{background:"#111",borderRadius:14,marginBottom:10,border:`1px solid ${BR}`,overflow:"hidden"}}>
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
                            <div style={sr(11,400,G)}>{v}</div>
                            <div style={ss(6,400,DM,{letterSpacing:1,marginTop:1})}>{l}</div>
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


      {mirror&&<MirrorModal items={items} outfitItemIds={mirror.itemIds} outfitName={mirror.name} onClose={()=>setMirror(null)}/>}
    </div>
  );
}

// ── MARKET ────────────────────────────────────────────────────────────────────
// ── OFFERS DATA ──────────────────────────────────────────────────────────────
// ── USER PROFILE DATA ─────────────────────────────────────────────────────────
const userProfiles = {};
// ── USER PROFILE PAGE ─────────────────────────────────────────────────────────
function UserProfilePage({ handle, userId, username, onClose, showToast, session, onAddToCloset, addToWishlist, onViewProfile }) {
  const [activeTab, setActiveTab] = useState("items");
  const [following, setFollowing] = useState(false);
  const [loading, setLoading] = useState(false);
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
        const resaleValue = items.reduce((s,i)=>s+Math.round((i.price||0)*0.45),0);
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
      }catch(e){ console.error("Profile load error:", e); }
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
      <button onClick={onClose} style={{padding:"10px 24px",borderRadius:20,background:_1a,border:_2a,...ss(9,600,G,{letterSpacing:1}),cursor:_p}}>GO BACK</button>
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
    <div style={{..._fix,background:BK,zIndex:400,maxWidth:430,margin:"0 auto",display:"flex",flexDirection:"column",height:"100%",overflow:"hidden"}}>

      {/* ── HEADER BAR ── */}
      <div style={{flexShrink:0,background:"#0A0908",borderBottom:"1px solid #1A1A1A",padding:"14px 18px",display:"flex",alignItems:"center",gap:12}}>
        <IconBtn onClick={onClose} sz={18}>←</IconBtn>
        <div style={{flex:1}}>
          <div style={ss(11,600,MD,{letterSpacing:0.5})}>{profile?.handle}</div>
          <div style={ss(9,400,DM,{letterSpacing:0.5})}>{profile?.posts} outfits</div>
        </div>
        <IconBtn onClick={()=>showToast("Shared \u2746")} sz={14}>↑</IconBtn>
      </div>

      {/* ── SCROLLABLE BODY ── */}
      <div style={{flex:1,overflowY:"auto"}} className="sc">

      {/* ── HERO + AVATAR WRAPPER ── */}
      <div style={{position:"relative",flexShrink:0,marginBottom:44}}>
        {/* Hero banner — overflow:hidden clips orbs only, NOT the avatar */}
        <div style={{height:90,background:"linear-gradient(160deg,#1A1510,#0F0D0A,#16120E)",overflow:"hidden"}}>
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
        {/* Avatar — outside overflow:hidden, fully visible */}
        <div style={{position:"absolute",bottom:-38,left:18,zIndex:2}}>
          <div style={{width:76,height:76,borderRadius:"50%",background:"linear-gradient(135deg,#2A2420,#1A1410)",border:`3px solid #0D0D0D`,overflow:"hidden",display:"flex",alignItems:"center",justifyContent:"center",boxShadow:`0 0 0 2px ${G}44`}}>
            {realProfile?.avatar_url
              ? <img src={realProfile.avatar_url} style={{width:"100%",height:"100%",objectFit:"cover",objectPosition:"center top"}} alt={profile?.name}/>
              : demoProfile
                ? (AVATAR_DEFS[profile?.handle]?<AvatarPortrait user={profile?.handle} size={72}/>:<span style={{fontSize:30}}>{profile?.avatar}</span>)
                : <span style={{...sr(28,600,G)}}>{profile?.avatar}</span>
            }
          </div>
        </div>
        {/* Action buttons — right side, aligned with avatar bottom */}
        {!isOwnProfile&&(
          <div style={{position:"absolute",bottom:-38,right:18,zIndex:2,display:"flex",gap:8,alignItems:"flex-end"}}>
            <button onClick={()=>showToast("Message coming soon \u2746")} style={{width:36,height:36,borderRadius:"50%",background:_1a,border:_2a,display:"flex",alignItems:"center",justifyContent:"center",...ss(14,400,MD),cursor:_p}}>✉</button>
            <button onClick={demoProfile?()=>{setFollowing(f=>!f);showToast(following?"Unfollowed \u2746":"Following \u2746");}:toggleFollow}
              style={{padding:"8px 22px",borderRadius:20,background:following?"#1A1A1A":`linear-gradient(135deg,${G},#8A6E54)`,border:following?"1px solid #2A2A2A":"none",...ss(10,600,following?MD:"#0D0D0D",{letterSpacing:1}),cursor:_p}}>
              {following?"FOLLOWING":"FOLLOW"}
            </button>
          </div>
        )}
      </div>

      {/* ── PROFILE IDENTITY ── */}
      <div style={{padding:"0 18px",flexShrink:0}}>
        {/* Name + handle directly below avatar */}
        <div style={{marginBottom:16}}>
          {(()=>{
            const rawName = realProfile?.name || profile?.name || "";
            const parts = rawName.trim().split(" ").filter(Boolean);
            const displayName = parts.length >= 2
              ? `${parts[0]} ${parts[parts.length-1][0].toUpperCase()}.`
              : parts[0] || rawName;
            const handle = realProfile?.username ? `@${realProfile.username}` : profile?.handle || "";
            return(
              <React.Fragment>
                <div style={{..._row,gap:6,marginBottom:2}}>
                  <div style={sr(22,500)}>{displayName}</div>
                  {profile?.verified&&<div style={{width:16,height:16,borderRadius:"50%",background:G,display:"flex",alignItems:"center",justifyContent:"center",...ss(8,700,"#0D0D0D"),flexShrink:0}}>✓</div>}
                </div>
                <div style={ss(11,400,DM,{letterSpacing:0.5,marginBottom:profile?.bio||profile?.style?8:0})}>{handle}</div>
                {profile?.bio&&<div style={{...ss(12,400,"#A09880"),lineHeight:1.6,marginBottom:profile?.style?4:0}}>{profile?.bio}</div>}
                {profile?.style&&<div style={{...ss(10,300,"#6A5E50"),fontStyle:"italic"}}>{profile?.style}</div>}
              </React.Fragment>
            );
          })()}
        </div>

        {/* Unified stats row */}
        <div style={{display:"flex",gap:0,marginBottom:16,borderRadius:14,overflow:"hidden",border:"1px solid #1E1E1E",background:"#111"}}>
          {[
            {label:"Followers", value:profile?.followers, tap:()=>loadFollowList("followers")},
            {label:"Following", value:profile?.following, tap:()=>loadFollowList("following")},
            {label:"Pieces",    value:profile?.items,     tap:null},
            {label:"Outfits",   value:profile?.posts,     tap:null},
          ].map((s,i)=>(
            <div key={i} onClick={s.tap||undefined}
              style={{flex:1,padding:"10px 4px",textAlign:"center",borderRight:i<3?"1px solid #1E1E1E":"none",cursor:s.tap?_p:"default"}}>
              <div style={sr(16,600,G)}>{s.value}</div>
              <div style={ss(7,400,DM,{letterSpacing:0.8,marginTop:2})}>{s.label.toUpperCase()}</div>
            </div>
          ))}
        </div>

        {/* Own profile value cards */}
        {isOwnProfile&&(
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14}}>
            {[
              {label:"Closet Value", value:profile?.stats?.closetValue, icon:"💰"},
              {label:"Est. Resale",  value:profile?.stats?.resaleValue,  icon:"✦"},
            ].map((s,i)=>(
              <div key={i} style={{background:"#111",borderRadius:12,padding:"10px 14px",border:"1px solid #1E1E1E"}}>
                <div style={{fontSize:13,marginBottom:3}}>{s.icon}</div>
                <div style={sr(16,500,G)}>{s.value}</div>
                <div style={ss(7,400,DM,{letterSpacing:0.8,marginTop:2})}>{s.label.toUpperCase()}</div>
              </div>
            ))}
          </div>
        )}

        {/* Brand chips */}
        {(profile?.brands||[]).length>0&&(
          <div style={{display:"flex",flexWrap:"wrap",gap:5,marginBottom:14}}>
            {profile?.brands.slice(0,10).map((b,i)=>(
              <div key={i} style={{padding:"3px 10px",borderRadius:20,background:"#111",border:"1px solid #1E1E1E",...ss(8,400,"#6A6058",{letterSpacing:0.3})}}>
                {b}
              </div>
            ))}
          </div>
        )}

        {profile?.location&&<div style={{...ss(9,400,DM,{letterSpacing:0.8,marginBottom:14})}}> 📍 {profile?.location}</div>}
      </div>

            {/* ── STICKY CONTENT TABS ── */}
      <div style={{position:"sticky",top:0,zIndex:10,background:"#0A0908",borderBottom:"1px solid #1A1A1A",display:"flex",flexShrink:0}}>
        {tabs.map(t=>(
          <button key={t.id} onClick={()=>setActiveTab(t.id)} style={{flex:1,padding:"14px 4px",background:"none",border:"none",borderBottom:activeTab===t.id?`2px solid ${G}`:"2px solid transparent",...ss(9,activeTab===t.id?700:400,activeTab===t.id?G:"#4A4438",{letterSpacing:1.2}),cursor:_p}}>
            {t.label}{t.count!==undefined?` (${t.count})`:""}</button>
        ))}
      </div>
      {/* ── OUTFITS TAB ── */}
      {activeTab==="posts"&&(
        <div style={{padding:"16px 18px",paddingBottom:32,flexShrink:0}}>
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
              <div key={post.id||pi} style={{background:"#111",borderRadius:18,overflow:"hidden",marginBottom:14,border:"1px solid #1E1E1E"}}>
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
                            <div style={sr(11,500,G)}>${item.price||0}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <div style={{..._btwn}}>
                    <div style={ss(10,400,DM)}>♡ {post.likes||0}</div>
                    <button onClick={()=>showToast("Saved \u2746")} style={{padding:"5px 14px",borderRadius:20,background:_1a,border:_2a,...ss(8,400,MD,{letterSpacing:1}),cursor:_p}}>SAVE LOOK</button>
                  </div>
                </div>
              </div>
            );
          });
          })()}
        </div>
      )}

      {/* ── ITEMS TAB ── */}
      {activeTab==="items"&&(
        <div style={{padding:"16px 18px",paddingBottom:32,flexShrink:0}}>
          {(profile?.allItems||[]).length===0&&(
            <div style={{textAlign:"center",padding:"48px 0",opacity:0.4}}>
              <div style={sr(14,300,DM,{fontStyle:"italic"})}>No items in closet yet</div>
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
                  <div onClick={()=>setSelectedProfileItem(isSelected?null:{...item,_idx:i})} style={{background:isSelected?"#1A1610":"#111",borderRadius:14,overflow:"hidden",border:isSelected?`1.5px solid ${G}44`:"1px solid #1E1E1E",cursor:_p}}>
                    <div style={{height:120,background:`linear-gradient(135deg,${item.color||"#2A2A2A"}18,${item.color||"#2A2A2A"}33)`,display:"flex",alignItems:"center",justifyContent:"center",position:"relative"}}>
                      {item.sourceImage||item.source_image
                        ? <img src={item.sourceImage||item.source_image} style={{width:"100%",height:"100%",objectFit:"contain",padding:8,boxSizing:"border-box"}} alt={item.name}/>
                        : <ItemIllustration item={item} size={70}/>
                      }
                      {(item.forSale||item.for_sale)&&<div style={{position:"absolute",top:6,right:6,background:G,borderRadius:6,padding:"2px 6px",...ss(7,700,BK,{letterSpacing:0.5})}}>FOR SALE</div>}
                    </div>
                    <div style={{padding:"8px 10px 10px"}}>
                      <div style={ss(11,500,MD,{overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis"})}>{item.name}</div>
                      <div style={ss(9,400,DM,{marginTop:1})}>{item.brand}</div>
                      <div style={{..._btwn,marginTop:6}}>
                        <div style={sr(12,500,G)}>${item.price||0}</div>
                        <button onClick={async e=>{
                          e.stopPropagation();
                          if(alreadyAdded||!onAddToCloset) return;
                          const newItem={id:Date.now(),name:item.name,brand:item.brand||"Unknown",category:item.category||"Tops",color:item.color||"#C4A882",price:item.price||0,emoji:item.emoji||"👗",wearCount:0,lastWorn:"Never",purchaseDate:"",condition:item.condition||"Good",forSale:false,tags:[],sourceImage:item.sourceImage||item.source_image||null};
                          await onAddToCloset(newItem);
                          setAddedItems(prev=>new Set([...prev,item.id||i]));
                          showToast(`${item.name} added to your closet \u2746`);
                        }} style={{padding:"4px 10px",borderRadius:20,cursor:alreadyAdded?"default":_p,background:alreadyAdded?"#1A2A1A":`${G}22`,border:alreadyAdded?"1px solid #2A4A2A":`1px solid ${G}55`,...ss(8,600,alreadyAdded?"#80C880":G,{letterSpacing:0.5})}}>
                          {alreadyAdded?"✓ Added":"+ Closet"}
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
                      <div style={{gridColumn:"1 / -1",background:"#141210",borderRadius:16,border:`1px solid ${G}33`,padding:"16px",marginTop:-4}}>
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
                          {[[`$${it.price||0}`,"VALUE"],[(it.wear_count||it.wearCount||0)+"×","WORN"],[it.category||"—","CATEGORY"]].map(([v,l])=>(
                            <div key={l} style={{flex:1,background:"#111",borderRadius:10,padding:"8px 4px",textAlign:"center",border:"1px solid #1E1E1E"}}>
                              <div style={sr(13,500,G)}>{v}</div>
                              <div style={ss(7,400,DM,{letterSpacing:1,marginTop:1})}>{l}</div>
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
        <div style={{padding:"16px 18px",paddingBottom:32,flexShrink:0}}>
          {profile?.forSaleCount===0&&(
            <div style={{textAlign:"center",padding:"48px 0",opacity:0.4}}>
              <div style={sr(14,300,DM,{fontStyle:"italic"})}>Nothing for sale right now</div>
            </div>
          )}
          {(profile?.forSale||[]).map((item,i)=>(
            <div key={i} style={{background:"#111",borderRadius:16,padding:"14px 16px",marginBottom:10,border:"1px solid #1E1E1E",display:"flex",gap:14,alignItems:"center"}}>
              <div style={{width:60,height:60,borderRadius:12,background:_1a,overflow:"hidden",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}>
                {item.sourceImage?<img src={item.sourceImage} style={{width:"100%",height:"100%",objectFit:"contain"}} alt={item.name}/>:<ItemIllustration item={item} size={52}/>}
              </div>
              <div style={{flex:1,minWidth:0}}>
                <div style={sr(14,500)}>{item.name}</div>
                <div style={ss(9,400,DM,{marginTop:2})}>{item.brand}{item.size&&item.size!=="—"?` · Size ${item.size}`:""}</div>
                <div style={{..._row,gap:8,marginTop:6}}>
                  <div style={{background:"#1A2A1A",borderRadius:10,padding:"2px 8px",...ss(8,600,"#A8C4A0",{letterSpacing:0.5})}}>{item.condition}</div>
                </div>
              </div>
              <div style={{textAlign:"right",flexShrink:0}}>
                <div style={sr(18,500,G)}>${item.price}</div>
                <button onClick={()=>showToast(`Offer sent on ${item.name} \u2746`)} style={{marginTop:6,padding:"6px 14px",borderRadius:10,background:`linear-gradient(135deg,${G},#8A6E54)`,border:"none",...ss(8,600,BK,{letterSpacing:1}),cursor:_p}}>OFFER</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── ABOUT TAB ── */}
      {activeTab==="about"&&(
        <div style={{padding:"16px 18px",paddingBottom:32,flexShrink:0}}>
          <div style={{background:"#111",borderRadius:16,padding:"18px",marginBottom:14,border:"1px solid #1E1E1E"}}>
            <div style={ss(9,400,DM,{letterSpacing:1.5,marginBottom:10})}>STYLE IDENTITY</div>
            {profile?.style
              ? <div style={sr(16,400,"#C0B09A",{lineHeight:1.8,fontStyle:"italic"})}>&ldquo;{profile?.style}&rdquo;</div>
              : <div style={ss(10,400,DM,{fontStyle:"italic"})}>No style identity set yet</div>
            }
            {profile?.bio&&<div style={{marginTop:14,...ss(10,400,"#907860",{lineHeight:1.7})}}>{profile?.bio}</div>}
          </div>
          <div style={{background:"#111",borderRadius:16,padding:"18px",marginBottom:14,border:"1px solid #1E1E1E"}}>
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
          <div style={{background:"#111",borderRadius:16,padding:"18px",border:"1px solid #1E1E1E"}}>
            <div style={ss(9,400,DM,{letterSpacing:1.5,marginBottom:12})}>CONNECT</div>
            <button onClick={()=>showToast("Messaging coming soon \u2746")} style={{width:"100%",padding:"12px",borderRadius:12,background:`linear-gradient(135deg,${G},#8A6E54)`,border:"none",display:"flex",alignItems:"center",justifyContent:"center",gap:8,...ss(10,600,BK,{letterSpacing:1}),cursor:_p}}>
              ✉ SEND A MESSAGE
            </button>
          </div>
        </div>
      )}

      </div>{/* end scroll */}
    </div>
    {followList&&(
      <div onClick={()=>setFollowList(null)} style={{position:"fixed",top:76,left:0,right:0,bottom:0,background:"#000C",zIndex:600,display:"flex",alignItems:"flex-start",justifyContent:"center"}}>
        <div onClick={e=>e.stopPropagation()} style={{background:"#0D0D0D",borderRadius:"0 0 24px 24px",width:"100%",maxWidth:430,maxHeight:"85vh",display:"flex",flexDirection:"column",border:`1px solid ${G}22`}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"16px 20px",borderBottom:"1px solid #1E1E1E",flexShrink:0}}>
            <div style={sr(18,400)}>{followList.type==="followers"?"Followers":"Following"}</div>
            <button onClick={()=>setFollowList(null)} style={{width:28,height:28,borderRadius:"50%",background:"#1A1A1A",border:"1px solid #2A2A2A",cursor:_p,...ss(13,400,DM),display:"flex",alignItems:"center",justifyContent:"center"}}>×</button>
          </div>
          <div style={{overflowY:"auto",padding:"12px 16px 32px"}}>
            {followList.loading&&<div style={{textAlign:"center",padding:"32px 0",opacity:0.4}}><div style={{fontSize:20,animation:"spin 1s linear infinite",display:"inline-block"}}>✦</div></div>}
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
  const [mode,setMode]=useState(null); // null | photo | url | describe | manual
  const [scanning,setScanning]=useState(false);
  const [url,setUrl]=useState("");
  const [desc,setDesc]=useState("");
  const [descResults,setDescResults]=useState([]);
  const [descLoading,setDescLoading]=useState(false);
  const [photoPreview,setPhotoPreview]=useState(null);
  const [detected,setDetected]=useState([]);
  const [added,setAdded]=useState({});
  const [scanPct,setScanPct]=useState(0);
  const [scanMsg,setScanMsg]=useState("Analyzing…");
  const [scanStage,setScanStage]=useState("upload"); // upload | scanning | results | error
  const [cropSrc,setCropSrc]=useState(null); // pending crop before scan
  // Manual fields
  const [wName,setWName]=useState("");
  const [wBrand,setWBrand]=useState("");
  const [wPrice,setWPrice]=useState("");
  const [wColor,setWColor]=useState("#C4A882");
  const [wGap,setWGap]=useState("");
  const fileRef=useRef();

  const colorSwatches=[
    {name:"White",hex:"#F5F5F5"},{name:"Cream",hex:"#F5F0E8"},{name:"Yellow",hex:"#F0C040"},
    {name:"Orange",hex:"#E07830"},{name:"Red",hex:"#C03030"},{name:"Pink",hex:"#E88090"},
    {name:"Purple",hex:"#8060A0"},{name:"Blue",hex:"#3060A0"},{name:"Sky",hex:"#60A0D0"},
    {name:"Green",hex:"#407840"},{name:"Olive",hex:"#6A7040"},{name:"Tan",hex:"#C4A882"},
    {name:"Brown",hex:"#7A5030"},{name:"Grey",hex:"#808080"},{name:"Charcoal",hex:"#3A3A3A"},
    {name:"Black",hex:"#1A1A1A"},
  ];
  const iStyle={width:"100%",boxSizing:"border-box",background:"#0D0D0D",border:"1px solid #2A2A2A",borderRadius:10,padding:"10px 14px",...ss(12,400,MD),color:"#C0B8B0",outline:"none"};

  const reset=()=>{setMode(null);setUrl("");setDesc("");setDescResults([]);setPhotoPreview(null);setDetected([]);setAdded({});setScanPct(0);setScanStage("upload");setWName("");setWBrand("");setWPrice("");setWColor("#C4A882");setWGap("");setCropSrc(null);};

  const handlePhotoFile=async(file)=>{
    if(!file||!file.type.startsWith("image/")) return;
    const reader=new FileReader();
    reader.onload=(e)=>setCropSrc(e.target.result); // go to crop first
    reader.readAsDataURL(file);
  };

  const handleCroppedPhoto=async(dataUrl)=>{
    setCropSrc(null);
    setPhotoPreview(dataUrl);
    setScanStage("scanning");
    let pct=0;
    const msgs=["Analyzing image…","Detecting clothing items…","Identifying styles & brands…","Finding similar pieces…"];
    let msgIdx=0;
    const tick=setInterval(()=>{
      pct+=Math.random()*8+3; msgIdx=Math.min(Math.floor(pct/25),msgs.length-1);
      setScanPct(Math.min(pct,90)); setScanMsg(msgs[msgIdx]);
    },200);
    try{
      const base64=dataUrl.split(",")[1];
      const raw=await callClaudeVision(base64,"image/jpeg",
        `Identify all visible clothing items and accessories in this fashion image. For each item provide a name, brand/style, estimated price range, confidence 70-99, emoji, and a short note. Respond ONLY with JSON: {"items":[{"id":1,"name":"...","brand":"...","price":"$X-Y","confidence":95,"emoji":"👗","note":"...","color":"#hexcode"}]}. Max 5 items.`
      );
      clearInterval(tick); setScanPct(100); setScanMsg("Done!");
      const json=JSON.parse(raw.replace(/```json|```/g,"").trim());
      setTimeout(()=>{ setDetected(json.items||[]); setScanStage("results"); },400);
    }catch(err){ clearInterval(tick); setScanStage("error"); }
  };

  const confirmPhoto=()=>{
    detected.filter(d=>added[d.id]).forEach(item=>onAddToWishlist({
      id:Date.now()+item.id,name:item.name,brand:item.brand,
      price:parseInt((item.price||"0").replace(/\D/g,""))||0,
      emoji:item.emoji||"👗",gap:item.note||"Saved from photo",
      inMarket:false,sourceImage:photoPreview,color:item.color||"#C4A882",
    }));
    onClose();
  };

  const fetchUrl=async()=>{
    if(!url.trim()) return;
    setScanning(true);
    try{
      const [raw,productRes]=await Promise.all([
        callClaude(`A user pasted this product URL into a wishlist app: "${url}"\nIdentify the item. Return ONLY JSON: {"name":"...","brand":"...","price":150,"emoji":"👗","color":"#hexcode","note":"..."}`),
        fetch("/api/fetch-product",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({url:url.trim()})}).then(r=>r.json()).catch(()=>({price:null,image:null}))
      ]);
      const json=JSON.parse(raw.replace(/```json|```/g,"").trim());
      onAddToWishlist({id:Date.now(),name:json.name,brand:json.brand,price:productRes.price||json.price||0,emoji:json.emoji||"👗",gap:json.note||"Saved from URL",inMarket:false,sourceImage:productRes.image||null,color:json.color||"#C4A882",sourceUrl:url.trim()});
      onClose();
    }catch(e){ setScanning(false); }
    setScanning(false);
  };

  const fetchDesc=async()=>{
    if(!desc.trim()) return;
    setDescLoading(true); setDescResults([]);
    try{
      const raw=await callClaude(`A user is describing an item they want for their wishlist: "${desc}"\nGenerate 4 specific matches with exact brand names and product names. Return ONLY JSON: {"results":[{"name":"...","brand":"...","price":150,"emoji":"👗","color":"#hexcode","note":"..."}]}`);
      const json=JSON.parse(raw.replace(/```json|```/g,"").trim());
      const results=json.results||[];
      // Fetch real product images in parallel via Google Image Search
      const withImages=await Promise.all(results.map(async r=>{
        try{
          const imgRes=await fetch("/api/image-search",{
            method:"POST",
            headers:{"Content-Type":"application/json"},
            body:JSON.stringify({query:`${r.brand} ${r.name} official product photo`})
          }).then(x=>x.json()).catch(()=>({imageUrl:null}));
          return {...r,imageUrl:imgRes.imageUrl||null};
        }catch(e){ return {...r,imageUrl:null}; }
      }));
      setDescResults(withImages);
    }catch(e){}
    setDescLoading(false);
  };

  const addManual=()=>{
    if(!wName.trim()){return;}
    onAddToWishlist({id:Date.now(),name:wName.trim(),brand:wBrand.trim()||"Unknown",price:parseInt(wPrice)||0,emoji:"👗",gap:wGap.trim()||"Manually added",inMarket:false,sourceImage:null,color:wColor});
    onClose();
  };

  const addedCount=Object.keys(added).length;

  return(
    <React.Fragment>
    {cropSrc&&(
      <CropModal
        src={cropSrc}
        onCancel={()=>setCropSrc(null)}
        onSave={handleCroppedPhoto}
        autoRemoveBg={true}
      />
    )}
    <div onClick={onClose} style={{..._fix,background:"#000000CC",zIndex:200,display:"flex",alignItems:"flex-end",justifyContent:"center"}}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#0D0D0D",borderRadius:"24px 24px 0 0",width:"100%",maxWidth:430,border:_2a,animation:"fadeUp 0.3s ease forwards",maxHeight:"92vh",display:"flex",flexDirection:"column"}}>

        {/* Header */}
        <div style={{padding:"20px 22px 0",flexShrink:0}}>
          <div style={{..._btwn,marginBottom:4}}>
            <div>
              {mode&&<button onClick={reset} style={{background:"none",border:"none",cursor:_p,...ss(11,400,DM),marginBottom:4}}>← Back</button>}
              <div style={sr(20,400)}>{!mode?"Add to Wishlist":mode==="photo"?"Scan Photo":mode==="url"?"Paste URL":mode==="describe"?"Describe Item":"Add Manually"}</div>
              <div style={ss(9,400,DM,{letterSpacing:1,marginTop:2})}>{!mode?"CHOOSE HOW TO ADD":""}</div>
            </div>
            <button onClick={onClose} style={{width:32,height:32,borderRadius:"50%",background:_1a,border:_2a,display:"flex",alignItems:"center",justifyContent:"center",...ss(14,400,MD),cursor:_p}}>×</button>
          </div>
        </div>

        <div className="sc" style={{flex:1,padding:"16px 22px 32px",overflowY:"auto"}}>

          {/* ── MODE SELECT ── */}
          {!mode&&(
            <div style={{display:"flex",flexDirection:"column",gap:10,marginTop:8}}>
              <input ref={fileRef} type="file" accept="image/*" style={{display:"none"}} onChange={e=>{
                if(e.target.files[0]){
                  setMode("photo");
                  setTimeout(()=>handlePhotoFile(e.target.files[0]),0);
                }
              }}/>

              <button className="sb" onClick={()=>fileRef.current.click()} style={{width:"100%",padding:"18px 16px",borderRadius:16,background:_1a,border:_2a,display:"flex",alignItems:"center",gap:14,cursor:_p}}>
                <div style={{width:48,height:48,borderRadius:14,background:`${G}22`,border:`1px solid ${G}44`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:24,flexShrink:0}}>📷</div>
                <div style={{textAlign:"left"}}>
                  <div style={ss(11,600,MD,{letterSpacing:1})}>SCAN FROM PHOTO</div>
                  <div style={ss(9,400,DM,{marginTop:3})}>Upload a fashion photo — AI detects items</div>
                  <div style={ss(8,400,G,{marginTop:2})}>AI identifies all items in the image</div>
                </div>
                <div style={{marginLeft:"auto",...ss(18,300,DM)}}>›</div>
              </button>

              <button className="sb" onClick={()=>setMode("url")} style={{width:"100%",padding:"18px 16px",borderRadius:16,background:_1a,border:_2a,display:"flex",alignItems:"center",gap:14,cursor:_p}}>
                <div style={{width:48,height:48,borderRadius:14,background:`${G}22`,border:`1px solid ${G}44`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:24,flexShrink:0}}>🔗</div>
                <div style={{textAlign:"left"}}>
                  <div style={ss(11,600,MD,{letterSpacing:1})}>PASTE URL</div>
                  <div style={ss(9,400,DM,{marginTop:3})}>Paste a product link from any store</div>
                  <div style={ss(8,400,G,{marginTop:2})}>AI reads the item details automatically</div>
                </div>
                <div style={{marginLeft:"auto",...ss(18,300,DM)}}>›</div>
              </button>

              <button className="sb" onClick={()=>setMode("describe")} style={{width:"100%",padding:"18px 16px",borderRadius:14,background:"linear-gradient(135deg,#1A1424,#120E1C)",border:"1px solid #2A2040",display:"flex",alignItems:"center",gap:14,cursor:_p}}>
                <div style={{width:48,height:48,borderRadius:14,background:"#2A2040",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,fontSize:22}}>🎙️</div>
                <div style={{textAlign:"left"}}>
                  <div style={ss(10,600,"#C0B0D8",{letterSpacing:1})}>DESCRIBE YOUR ITEM</div>
                  <div style={ss(8,400,"#6A5A88",{marginTop:3})}>Type what you're looking for — AI finds matches</div>
                </div>
                <div style={{marginLeft:"auto",...ss(14,300,"#3A2A58")}}>›</div>
              </button>

              <button className="sb" onClick={()=>setMode("manual")} style={{width:"100%",padding:"18px 16px",borderRadius:14,background:"linear-gradient(135deg,#0F1A14,#0C150F)",border:"1px solid #1E3028",display:"flex",alignItems:"center",gap:14,cursor:_p}}>
                <div style={{width:48,height:48,borderRadius:14,background:"#1A3020",border:"1px solid #2A4030",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,fontSize:22}}>✏️</div>
                <div style={{textAlign:"left"}}>
                  <div style={ss(10,600,"#80C8A0",{letterSpacing:1})}>ADD MANUALLY</div>
                  <div style={ss(8,400,"#3A6048",{marginTop:3})}>Fill in all details yourself</div>
                </div>
                <div style={{marginLeft:"auto",...ss(14,300,"#2A4030")}}>›</div>
              </button>
            </div>
          )}

          {/* ── PHOTO MODE ── */}
          {mode==="photo"&&(
            <React.Fragment>
              {scanStage==="scanning"&&(
                <div style={{textAlign:"center",padding:"32px 0"}}>
                  {photoPreview&&<div style={{width:"100%",borderRadius:14,overflow:"hidden",maxHeight:180,marginBottom:20}}><img src={photoPreview} style={{width:"100%",objectFit:"cover",maxHeight:180}} alt="scan"/></div>}
                  <div style={{fontSize:44,marginBottom:16,animation:"pulse 1.2s infinite"}}>🔍</div>
                  <div style={sr(16,400,G,{marginBottom:6})}>{scanMsg}</div>
                  <div style={{height:3,background:_1a,borderRadius:2,overflow:"hidden",marginTop:12}}>
                    <div style={{height:"100%",width:`${scanPct}%`,background:`linear-gradient(90deg,${G},#8A6E54)`,borderRadius:2,transition:"width 0.3s"}}/>
                  </div>
                </div>
              )}
              {scanStage==="results"&&(
                <React.Fragment>
                  {photoPreview&&<div style={{width:"100%",borderRadius:14,overflow:"hidden",maxHeight:160,marginBottom:14,position:"relative"}}><img src={photoPreview} style={{width:"100%",objectFit:"cover",maxHeight:160}} alt="scan"/><div style={{position:"absolute",top:8,right:8,background:"linear-gradient(135deg,#0F1A0F,#162416)",border:"1px solid #2A3A2A",borderRadius:10,padding:"5px 10px",...ss(9,600,"#A8C4A0",{letterSpacing:1})}}>{detected.length} ITEMS FOUND</div></div>}
                  <div style={ss(9,400,DM,{letterSpacing:1.5,marginBottom:12})}>SELECT ITEMS TO ADD TO WISHLIST</div>
                  {detected.map(item=>{
                    const isSel=!!added[item.id];
                    return(
                      <div key={item.id} onClick={()=>setAdded(p=>isSel?Object.fromEntries(Object.entries(p).filter(([k])=>k!==String(item.id))):({...p,[item.id]:true}))}
                        style={{background:isSel?"linear-gradient(135deg,#1A160F,#1E1A12)":CD,borderRadius:14,padding:"12px 14px",marginBottom:8,border:`1.5px solid ${isSel?G:BR}`,cursor:_p,transition:"all 0.2s"}}>
                        <div style={{..._row,gap:10}}>
                          <div style={{width:44,height:44,borderRadius:12,background:_1a,display:"flex",alignItems:"center",justifyContent:"center",fontSize:24,border:_2a,flexShrink:0}}>{item.emoji||"👗"}</div>
                          <div style={{flex:1}}>
                            <div style={sr(14,500,isSel?G:undefined)}>{item.name}</div>
                            <div style={ss(9,400,DM,{marginTop:2})}>{item.brand} · {item.price}</div>
                          </div>
                          <div style={{width:24,height:24,borderRadius:7,background:isSel?G:_1a,border:`1.5px solid ${isSel?G:"#3A3028"}`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,...ss(12,700,BK)}}>{isSel?"✓":""}</div>
                        </div>
                      </div>
                    );
                  })}
                  <div style={{display:"flex",gap:8,marginTop:8}}>
                    <button onClick={()=>{setScanStage("upload");setPhotoPreview(null);setDetected([]);setAdded({});}} style={{flex:1,padding:"11px",borderRadius:12,background:_1a,border:_2a,...ss(9,600,DM,{letterSpacing:1}),cursor:_p}}>NEW SCAN</button>
                    <button onClick={confirmPhoto} disabled={addedCount===0} style={{flex:2,padding:"11px",borderRadius:12,background:addedCount>0?`linear-gradient(135deg,${G},#8A6E54)`:"#1A1A1A",border:"none",...ss(9,600,addedCount>0?BK:"#3A3028",{letterSpacing:1}),cursor:addedCount>0?_p:"default"}}>
                      {addedCount>0?`ADD ${addedCount} TO WISHLIST`:"SELECT ITEMS"}
                    </button>
                  </div>
                </React.Fragment>
              )}
              {scanStage==="error"&&(
                <div style={{textAlign:"center",padding:"32px 0"}}>
                  <div style={{fontSize:32,marginBottom:12}}>⚠️</div>
                  <div style={sr(16,300,G,{marginBottom:8})}>Scan failed</div>
                  <button onClick={()=>{setScanStage("upload");setPhotoPreview(null);}} style={{padding:"10px 24px",borderRadius:20,background:G,border:"none",...ss(9,700,BK,{letterSpacing:1}),cursor:_p}}>TRY AGAIN</button>
                </div>
              )}
            </React.Fragment>
          )}

          {/* ── URL MODE ── */}
          {mode==="url"&&(
            <div style={{marginTop:8}}>
              <div style={ss(9,400,DM,{letterSpacing:1.5,marginBottom:8})}>PASTE PRODUCT URL</div>
              <div style={{display:"flex",gap:8,marginBottom:14}}>
                <input value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://store.com/item…"
                  style={{flex:1,background:_1a,border:_2a,borderRadius:12,padding:"11px 14px",...ss(11,400,MD),color:"#C0B8B0",outline:"none"}}/>
                <button onClick={fetchUrl} disabled={scanning||!url.trim()} style={{padding:"11px 16px",borderRadius:12,background:`linear-gradient(135deg,${G},#8A6E54)`,border:"none",...ss(9,600,BK,{letterSpacing:1}),cursor:_p}}>
                  {scanning?"…":"FIND"}
                </button>
              </div>
              <div style={ss(9,400,DM,{lineHeight:1.6})}>AI will read the item name, brand, and price from the page and add it directly to your wishlist.</div>
            </div>
          )}

          {/* ── DESCRIBE MODE ── */}
          {mode==="describe"&&(
            <div style={{marginTop:8}}>
              <div style={ss(9,400,DM,{letterSpacing:1,marginBottom:8,textAlign:"center"})}>DESCRIBE WHAT YOU'RE LOOKING FOR</div>
              <textarea value={desc} onChange={e=>{setDesc(e.target.value);setDescResults([]);}} placeholder='e.g. "cream linen blazer from COS" or "strappy heeled sandal"'
                rows={3} style={{width:"100%",background:_1a,border:_2a,borderRadius:12,padding:"11px 14px",...ss(11,400,MD),color:"#C0B8B0",resize:"none",boxSizing:"border-box",lineHeight:1.6,marginBottom:10,outline:"none"}}/>
              {desc.trim()&&!descLoading&&descResults.length===0&&(
                <button onClick={fetchDesc} style={{width:"100%",padding:"11px",borderRadius:12,background:`linear-gradient(135deg,${G},#8A6E54)`,border:"none",...ss(9,700,BK,{letterSpacing:1.5}),cursor:_p}}>FIND MATCHES</button>
              )}
              {descLoading&&<div style={{textAlign:"center",padding:"24px 0"}}><div style={{fontSize:28,marginBottom:8,animation:"spin 1s linear infinite"}}>✦</div><div style={ss(9,400,DM)}>Finding matches…</div></div>}
              {descResults.length>0&&(
                <div>
                  <div style={ss(9,600,DM,{letterSpacing:1.5,marginBottom:10})}>SELECT THE BEST MATCH</div>
                  {descResults.map((r,i)=>(
                    <div key={i} onClick={()=>{onAddToWishlist({id:Date.now()+i,name:r.name,brand:r.brand,price:r.price||0,emoji:r.emoji||"👗",gap:r.note||"Saved from description",inMarket:false,sourceImage:r.imageUrl||null,color:r.color||"#C4A882"});onClose();}}
                      className="ch" style={{background:CD,borderRadius:14,border:`1px solid ${BR}`,display:"flex",gap:12,padding:"12px",cursor:_p,alignItems:"center",marginBottom:8}}>
                      <div style={{width:56,height:56,borderRadius:12,background:`${r.color||G}22`,flexShrink:0,overflow:"hidden",display:"flex",alignItems:"center",justifyContent:"center",border:_2a}}>
                        {r.imageUrl
                          ? <img src={r.imageUrl} style={{width:"100%",height:"100%",objectFit:"cover"}} alt={r.name}
                              onError={e=>{e.target.style.display="none";e.target.parentNode.innerHTML=`<span style="font-size:24px">${r.emoji||"👗"}</span>`;}}/>
                          : <span style={{fontSize:24}}>{r.emoji||"👗"}</span>
                        }
                      </div>
                      <div style={{flex:1}}>
                        <div style={sr(14,500)}>{r.name}</div>
                        <div style={ss(9,400,DM,{marginTop:2})}>{r.brand}</div>
                        <div style={sr(13,400,G,{marginTop:3})}>${r.price}</div>
                      </div>
                      <div style={{...ss(11,400,G),flexShrink:0}}>→</div>
                    </div>
                  ))}
                  <button onClick={()=>{setDescResults([]);}} style={{width:"100%",marginTop:4,padding:"10px",borderRadius:12,background:_1a,border:_2a,...ss(9,400,MD,{letterSpacing:1}),cursor:_p}}>TRY DIFFERENT DESCRIPTION</button>
                </div>
              )}
            </div>
          )}

          {/* ── MANUAL MODE ── */}
          {mode==="manual"&&(
            <div style={{marginTop:8}}>
              <div style={{marginBottom:12}}>
                <div style={ss(9,400,DM,{letterSpacing:1.5,marginBottom:6})}>ITEM NAME *</div>
                <input value={wName} onChange={e=>setWName(e.target.value)} placeholder="e.g. Chelsea Boots" style={iStyle}/>
              </div>
              <div style={{marginBottom:12}}>
                <div style={ss(9,400,DM,{letterSpacing:1.5,marginBottom:6})}>BRAND</div>
                <input value={wBrand} onChange={e=>setWBrand(e.target.value)} placeholder="e.g. Sezane, & Other Stories…" style={iStyle}/>
              </div>
              <div style={{marginBottom:12}}>
                <div style={ss(9,400,DM,{letterSpacing:1.5,marginBottom:6})}>PRICE ($)</div>
                <input value={wPrice} onChange={e=>setWPrice(e.target.value.replace(/\D/g,""))} placeholder="0" inputMode="numeric" style={iStyle}/>
              </div>
              <div style={{marginBottom:12}}>
                <div style={ss(9,400,DM,{letterSpacing:1.5,marginBottom:6})}>WHY I WANT IT (OPTIONAL)</div>
                <input value={wGap} onChange={e=>setWGap(e.target.value)} placeholder="e.g. Need transitional footwear" style={iStyle}/>
              </div>
              <div style={{marginBottom:20}}>
                <div style={ss(9,400,DM,{letterSpacing:1.5,marginBottom:8})}>COLOR</div>
                <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
                  {colorSwatches.map(({name,hex})=>(
                    <button key={hex} onClick={()=>setWColor(hex)} title={name} style={{width:30,height:30,borderRadius:"50%",background:hex,cursor:_p,border:wColor===hex?`3px solid ${G}`:"2px solid #2A2A2A",boxShadow:wColor===hex?`0 0 0 2px ${G}66`:"none",flexShrink:0,outline:"none"}}/>
                  ))}
                </div>
                <div style={ss(9,400,DM,{marginTop:6})}>Selected: <span style={{color:G}}>{colorSwatches.find(c=>c.hex===wColor)?.name||"Custom"}</span></div>
              </div>
              <button onClick={addManual} disabled={!wName.trim()} style={{width:"100%",padding:"13px",borderRadius:14,background:wName.trim()?`linear-gradient(135deg,${G},#8A6E54)`:"#1A1A1A",border:"none",...ss(10,700,wName.trim()?BK:"#3A3028",{letterSpacing:1.5}),cursor:wName.trim()?_p:"default"}}>
                ADD TO WISHLIST
              </button>
            </div>
          )}

        </div>
      </div>
    </div>
    </React.Fragment>
  );
}

async function callClaude(prompt, systemPrompt) {
  const res = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system: systemPrompt || "You are a luxury fashion stylist AI. Always respond with valid JSON only, no markdown, no explanation.",
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await res.json();
  return data.content?.[0]?.text || "";
}

async function callClaudeVision(base64Image, mediaType, prompt) {
  const res = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system: "You are a luxury fashion AI. Analyze clothing in images. Always respond with valid JSON only, no markdown.",
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: base64Image } },
          { type: "text", text: prompt },
        ],
      }],
    }),
  });
  const data = await res.json();
  return data.content?.[0]?.text || "";
}

function DiscoverTab({showToast,wishlist,setWishlist,addToWishlist,items}){
  const [view,setView]=useState("pairings");
  const [selectedTrend,setSelectedTrend]=useState(null);

  // AI state — pairings
  const [aiAnalysis,setAiAnalysis]=useState(null);
  const [aiPairings,setAiPairings]=useState([]);
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
    if(!items.length) return {score:0,label:"No data",note:"Add items to your closet."};
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
      const raw = await callClaude(
        `My wardrobe: ${closetSummary}. Give me a short one-sentence style analysis of my overall wardrobe aesthetic, then 3 specific outfit pairing suggestions. Respond ONLY with JSON in this exact shape: {"analysis":"...","pairings":[{"id":1,"trigger":"item name","suggestion":"what to pair it with","vibe":"style label","score":97},...]}`
      );
      const json = JSON.parse(raw.replace(/```json|```/g,"").trim());
      setAiAnalysis(json.analysis);
      setAiPairings(json.pairings);
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

Rate my wardrobe on TWO dimensions (0-20 points each) and identify 3 missing pieces. Be honest and specific — don't just give high scores.

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
      ]);
    }
    setGapsLoading(false);
  };

  // Auto-load when switching to tab
  useEffect(()=>{
    if(view==="pairings" && prevView.current!=="pairings" && !aiPairings.length && !pairingsLoading) loadPairings();
    if((view==="gaps"||view==="score") && prevView.current!=="gaps" && prevView.current!=="score" && !aiGaps && !gapsLoading) loadGaps();
    prevView.current = view;
  },[view]);

  const gaps = aiGaps || [
    {emoji:"👜",gap:"No structured bag",suggestion:"A Toteme or Polene tote would complete your office looks.",price:"$200-500"},
    {emoji:"🥾",gap:"No ankle boots",suggestion:"Chelsea boots in tan or black bridge casual and evening.",price:"$150-350"},
    {emoji:"🧣",gap:"No silk scarf",suggestion:"A printed silk scarf adds color without bold commitment.",price:"$80-200"},
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
          <div style={{background:"linear-gradient(135deg,#0A1A0A,#0F1F0F)",border:"1px solid #1A3A1A",borderRadius:16,padding:"16px",marginBottom:20}}>
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
            <div key={i} style={{background:CD,borderRadius:14,padding:"12px 14px",marginBottom:10,border:`1px solid ${BR}`,display:"flex",alignItems:"center",gap:12}}>
              <div style={{width:44,height:44,borderRadius:10,background:_1a,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,flexShrink:0}}>{s.emoji}</div>
              <div style={{flex:1,minWidth:0}}>
                <div style={sr(14,500,undefined,{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"})}>{s.name}</div>
                <div style={ss(9,400,DM,{marginTop:2})}>{s.brand}</div>
              </div>
              <div style={{textAlign:"right",flexShrink:0}}>
                <div style={sr(14,400,G)}>${s.price.toLocaleString()}</div>
                <button onClick={()=>showToast("Added to wishlist \u2746")} style={{marginTop:4,...ss(7,600,G,{background:"none",border:"none",cursor:_p,letterSpacing:0.8})}}>+ WISHLIST</button>
              </div>
            </div>
          ))}
          {trend.tags.map(t=><span key={t} style={{display:"inline-block",background:_1a,border:_2a,borderRadius:20,padding:"4px 12px",marginRight:6,marginBottom:6,...ss(9,400,DM,{letterSpacing:0.8})}}>#{t}</span>)}
        </div>
      </div>
    );
  }

  return(
    <div className="fu" style={{padding:"16px 24px"}}>
      <div style={{marginBottom:16}}>
        <div style={sr(22,300)}>Discover</div>
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
          {pairingsLoading && (
            <div style={{textAlign:"center",padding:"40px 0"}}>
              <div style={{fontSize:32,marginBottom:12,animation:"spin 1.5s linear infinite",display:"inline-block"}}>✦</div>
              <div style={ss(11,400,MD,{letterSpacing:1})}>Analyzing your wardrobe…</div>
            </div>
          )}
          {!pairingsLoading && (aiAnalysis || aiPairings.length>0) && (
            <React.Fragment>
              <div style={{background:"linear-gradient(135deg,#1A160F,#1E1A12)",borderRadius:18,padding:"18px",border:"1px solid #2A2418",marginBottom:18}}>
                <div style={{display:"flex",gap:10,alignItems:"center",marginBottom:12}}>
                  <div style={{width:36,height:36,borderRadius:"50%",background:`linear-gradient(135deg,${G},#8A6E54)`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16}}>✦</div>
                  <div><div style={sr(15,500)}>Closet Analysis</div><div style={ss(9,400,MD,{letterSpacing:1})}>BASED ON {items.length} ITEMS</div></div>
                </div>
                <div style={sr(14,400,G,{fontStyle:"italic",lineHeight:1.6})}>
                  "{aiAnalysis}"
                </div>
              </div>
              {aiPairings.map(s=>(
                <div key={s.id} className="ch" style={{background:CD,borderRadius:18,padding:"16px 18px",marginBottom:12,border:`1px solid ${BR}`}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
                    <div style={ss(9,400,MD,{letterSpacing:1})}>STARTING WITH</div>
                    <div style={{background:"#C4A88222",borderRadius:20,padding:"3px 10px",...ss(9,400,G)}}>Match {s.score}%</div>
                  </div>
                  <div style={sr(15,500,undefined,{marginBottom:4})}>{s.trigger}</div>
                  <div style={sr(13,400,MD,{marginBottom:10})}>to {s.suggestion}</div>
                  <Tag>{s.vibe}</Tag>
                </div>
              ))}
            </React.Fragment>
          )}
          {!pairingsLoading && !aiAnalysis && aiPairings.length===0 && !pairingsError && (
            <React.Fragment>
              <div style={{background:"linear-gradient(135deg,#1A160F,#1E1A12)",borderRadius:18,padding:"18px",border:"1px solid #2A2418",marginBottom:18}}>
                <div style={{display:"flex",gap:10,alignItems:"center",marginBottom:12}}>
                  <div style={{width:36,height:36,borderRadius:"50%",background:`linear-gradient(135deg,${G},#8A6E54)`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16}}>✦</div>
                  <div><div style={sr(15,500)}>Closet Analysis</div><div style={ss(9,400,MD,{letterSpacing:1})}>BASED ON {items.length} ITEMS</div></div>
                </div>
                <div style={sr(14,400,G,{fontStyle:"italic",lineHeight:1.6})}>
                  "Your wardrobe leans minimal-elegant. Neutral tones dominate with quiet luxury brands. Adding a statement coat and bold accessories could expand outfit combinations by 40%."
                </div>
              </div>
              {suggestions.map(s=>(
                <div key={s.id} className="ch" style={{background:CD,borderRadius:18,padding:"16px 18px",marginBottom:12,border:`1px solid ${BR}`}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
                    <div style={ss(9,400,MD,{letterSpacing:1})}>STARTING WITH</div>
                    <div style={{background:"#C4A88222",borderRadius:20,padding:"3px 10px",...ss(9,400,G)}}>Match {s.score}%</div>
                  </div>
                  <div style={sr(15,500,undefined,{marginBottom:4})}>{s.trigger}</div>
                  <div style={sr(13,400,MD,{marginBottom:10})}>to {s.suggestion}</div>
                  <Tag>{s.vibe}</Tag>
                </div>
              ))}
            </React.Fragment>
          )}
          <Btn onClick={loadPairings} full disabled={pairingsLoading}>
            {pairingsLoading ? "GENERATING…" : "GENERATE NEW PAIRINGS"}
          </Btn>
        </React.Fragment>
      )}

      {view==="score" && (
        <React.Fragment>
          {gapsLoading && (
            <div style={{textAlign:"center",padding:"40px 0"}}>
              <div style={{fontSize:32,marginBottom:12,animation:"spin 1.5s linear infinite",display:"inline-block"}}>✦</div>
              <div style={ss(11,400,MD,{letterSpacing:1})}>Calculating your score…</div>
            </div>
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
              <div style={{background:"linear-gradient(135deg,#1A160F,#1E1A12)",borderRadius:18,padding:"20px",border:"1px solid #2A2418"}}>
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
                    <button onClick={loadGaps} style={{padding:"8px 20px",borderRadius:20,background:`${G}22`,border:`1px solid ${G}44`,...ss(9,600,G,{letterSpacing:1}),cursor:_p}}>CALCULATE MY SCORE</button>
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
            <div style={{textAlign:"center",padding:"40px 0"}}>
              <div style={{fontSize:32,marginBottom:12,animation:"spin 1.5s linear infinite",display:"inline-block"}}>✦</div>
              <div style={ss(11,400,MD,{letterSpacing:1})}>Analyzing your wardrobe gaps…</div>
            </div>
          )}
          {!gapsLoading && (
            <React.Fragment>
              {/* ── SCORE CARD ── */}
              {(()=>{
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
                  <div style={{background:"linear-gradient(135deg,#1A160F,#1E1A12)",borderRadius:18,padding:"20px",border:"1px solid #2A2418",marginBottom:16}}>
                    {/* Total score header */}
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
                    {/* Total bar */}
                    <div style={{height:8,background:"#1A1A1A",borderRadius:4,overflow:"hidden",marginBottom:20}}>
                      <div style={{height:"100%",width:`${total}%`,background:`linear-gradient(90deg,${scoreColor},${G})`,borderRadius:4,transition:"width 0.8s ease"}}/>
                    </div>

                    {/* Dimension breakdown */}
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
                          <div style={{..._row,gap:6,flexShrink:0}}>
                            <div style={{...ss(9,600,d.score>=16?"#80C880":d.score>=12?G:"#C4A060"),background:"#0D0D0D",padding:"2px 8px",borderRadius:8}}>
                              {d.label}
                            </div>
                            <div style={{...sr(16,500,MD),minWidth:32,textAlign:"right"}}>{d.score}<span style={ss(9,400,DM)}>/20</span></div>
                          </div>
                        </div>
                        {/* Dimension bar */}
                        <div style={{height:3,background:"#1A1A1A",borderRadius:2,overflow:"hidden",marginBottom:5}}>
                          <div style={{height:"100%",width:`${(d.score/20)*100}%`,background:d.score>=16?"#80C880":d.score>=12?G:"#C4A060",borderRadius:2,transition:"width 0.8s ease"}}/>
                        </div>
                        <div style={ss(9,400,DM,{lineHeight:1.5,fontStyle:"italic"})}>{d.note}</div>
                      </div>
                    ))}

                    {!bd&&(
                      <div style={{textAlign:"center",padding:"8px 0"}}>
                        <button onClick={loadGaps} style={{padding:"8px 20px",borderRadius:20,background:`${G}22`,border:`1px solid ${G}44`,...ss(9,600,G,{letterSpacing:1}),cursor:_p}}>CALCULATE MY SCORE</button>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* ── GAPS ── */}
              <div style={ss(8,600,DM,{letterSpacing:1.5,marginBottom:10})}>KEY GAPS TO ADDRESS</div>
              {gaps.map((g,i)=>(
                <div key={i} style={{background:CD,borderRadius:18,padding:"16px 18px",marginBottom:12,border:`1px solid ${BR}`}}>
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
                    }} style={{padding:"6px 14px",borderRadius:20,background:_1a,border:_2a,...ss(9,400,MD,{letterSpacing:1}),cursor:_p}}>+ WISHLIST</button>
                  </div>
                </div>
              ))}
              <Btn onClick={loadGaps} full>{gapsLoading?"ANALYZING…":"REFRESH SCORE"}</Btn>
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

function MirrorModal({items,outfitItemIds,outfitName,onClose}){
  const [selectedIds,setSelectedIds]=useState(outfitItemIds||[]);
  const [photoStage,setPhotoStage]=useState("prompt"); // prompt | ready
  const [skin,setSkin]=useState(2);
  const [hair,setHair]=useState(1);
  const fileRef=useRef(null);

  const skins=["#F5DEB3","#E8C4A0","#C8906A","#A06040","#6A3820"];
  const hairCols=["#F0DCA0","#8B6914","#4A2C0A","#1A0A0A","#C0C0C0"];
  const sc=skins[skin]; const hc=hairCols[hair];

  const outfitItems=selectedIds.map(id=>items.find(i=>i.id===id)).filter(Boolean);
  const toggle=(id)=>setSelectedIds(p=>p.includes(id)?p.filter(x=>x!==id):[...p,id]);

  // Build ordered layers
  const layerMap={};
  outfitItems.forEach(it=>{
    const def=getLayer(it.emoji);
    if(!layerMap[def.layer]) layerMap[def.layer]=[];
    layerMap[def.layer].push({...def,color:it.color,item:it});
  });
  const orderedLayers=layerOrder.flatMap(l=>layerMap[l]||[]);

  // Label positions per layer type
  const labelPos=(def,it)=>{
    if(def.layer==="shoes") return {x:190,y:438};
    if(def.layer==="bottom") return {x:190,y:340};
    if(def.layer==="dress") return {x:190,y:290};
    if(def.layer==="coat"||def.layer==="top") return {x:190,y:220};
    if(it.emoji==="👜"||it.emoji==="💼") return {x:298,y:300};
    if(it.emoji==="🧣") return {x:190,y:175};
    return {x:190,y:160};
  };

  return(
    <div style={{..._fix,background:"#060504",zIndex:300,display:"flex",flexDirection:"column",maxWidth:430,margin:"0 auto"}}>

      {/* Header */}
      <div style={{padding:"18px 20px 14px",borderBottom:"1px solid #1A1A1A",flexShrink:0,background:"#0A0908",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div>
          <div style={{...sr(24,300,"#F0EBE3"),letterSpacing:3}}>The Mirror</div>
          {outfitName&&<div style={ss(8,400,DM,{letterSpacing:2,marginTop:3})}>{outfitName.toUpperCase()}</div>}
        </div>
        <IconBtn onClick={onClose}>×</IconBtn>
      </div>

      {/* First-use: photo prompt */}
      {photoStage==="prompt"&&(
        <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"32px 28px",gap:16,background:"#0A0908"}}>
          <div style={{fontSize:54,marginBottom:4}}>🪞</div>
          <div style={sr(22,400,undefined,{textAlign:"center"})}>Set up your Mirror</div>
          <div style={ss(10,400,DM,{textAlign:"center",lineHeight:1.75,maxWidth:280})}>Take a full-body photo and outfits will be previewed on you. Your photo stays on your device — never uploaded.</div>
          <div style={{display:"flex",gap:12,width:"100%",marginTop:8}}>
            <button onClick={()=>fileRef.current?.click()} style={{flex:1,padding:"18px 12px",borderRadius:16,background:`linear-gradient(135deg,${G},#8A6E54)`,border:"none",...ss(10,600,BK,{letterSpacing:1}),cursor:_p,display:"flex",flexDirection:"column",alignItems:"center",gap:7}}>
              <span style={{fontSize:26}}>📸</span>TAKE PHOTO
            </button>
            <button onClick={()=>fileRef.current?.click()} style={{flex:1,padding:"18px 12px",borderRadius:16,background:_1a,border:_2a,...ss(10,600,MD,{letterSpacing:1}),cursor:_p,display:"flex",flexDirection:"column",alignItems:"center",gap:7}}>
              <span style={{fontSize:26}}>🖼️</span>UPLOAD
            </button>
          </div>
          <button onClick={()=>setPhotoStage("ready")} style={{width:"100%",padding:"14px",borderRadius:14,background:"#141414",border:_2a,...ss(9,400,DM,{letterSpacing:1.5}),cursor:_p,marginTop:4}}>
            USE ILLUSTRATED AVATAR
          </button>
          <input ref={fileRef} type="file" accept="image/*" style={{display:"none"}} onChange={()=>setPhotoStage("ready")}/>
        </div>
      )}

      {/* Mirror canvas + controls */}
      {photoStage==="ready"&&(
        <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>

          {/* SVG canvas */}
          <div style={{flex:1,position:"relative",background:"linear-gradient(180deg,#1C1810 0%,#0E0C09 100%)",overflow:"hidden",minHeight:0}}>
            {/* Subtle dot-grid texture */}
            <div style={{..._abs0,backgroundImage:"radial-gradient(#2A2418 1px,transparent 1px)",backgroundSize:"22px 22px",opacity:0.25,pointerEvents:"none"}}/>
            {/* Floor reflection glow */}
            <div style={{position:"absolute",bottom:0,left:"50%",transform:"translateX(-50%)",width:200,height:60,background:`radial-gradient(ellipse,${G}18 0%,transparent 70%)`,pointerEvents:"none"}}/>

            <div style={{..._abs0,display:"flex",alignItems:"flex-end",justifyContent:"center",paddingBottom:8}}>
              <svg viewBox="0 0 380 480" fill="none" xmlns="http://www.w3.org/2000/svg"
                style={{height:"100%",maxHeight:"100%",width:"auto"}}>
                <defs>
                  <linearGradient id="mirSkin" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={sc}/>
                    <stop offset="100%" stopColor={sc} stopOpacity="0.88"/>
                  </linearGradient>
                </defs>

                {/* Shadow on floor */}
                <ellipse cx="190" cy="448" rx="88" ry="10" fill="#000000" opacity="0.35"/>

                {/* ── BASE FIGURE — skin underneath clothing ── */}
                {/* Legs */}
                <path d="M155 262 L146 438 L168 438 L180 284 L200 284 L212 438 L234 438 L225 262Z" fill="url(#mirSkin)"/>
                {/* Torso */}
                <path d="M152 156 C146 172,143 216,145 262 L235 262 C237 216,234 172,228 156 C218 149,206 145,190 145 C174 145,162 149,152 156Z" fill="url(#mirSkin)"/>
                {/* Arms */}
                <path d="M152 158 C138 174,128 210,130 248 L146 245 C146 215,150 182,158 167Z" fill="url(#mirSkin)"/>
                <path d="M228 158 C242 174,252 210,250 248 L234 245 C234 215,230 182,222 167Z" fill="url(#mirSkin)"/>
                {/* Hands */}
                <ellipse cx="138" cy="253" rx="10" ry="13" fill={sc}/>
                <ellipse cx="242" cy="253" rx="10" ry="13" fill={sc}/>
                {/* Feet */}
                <path d="M140 435 C128 437,116 441,114 447 L168 447 L170 435Z" fill={sc}/>
                <path d="M210 435 C222 437,234 441,236 447 L182 447 L180 435Z" fill={sc}/>

                {/* ── CLOTHING LAYERS ── */}
                {orderedLayers.map((layer,i)=>(
                  <g key={i} dangerouslySetInnerHTML={{__html:layer.draw(layer.color||"#666666")}}/>
                ))}

                {/* ── HEAD (always on top of clothing) ── */}
                <path d="M181 118 L181 149 L199 149 L199 118Z" fill={sc}/>
                <ellipse cx="190" cy="89" rx="34" ry="38" fill={sc}/>
                {/* Hair */}
                <path d={`M157 79 C154 49,168 25,190 23 C212 25,226 49,223 79 C218 63,207 55,200 59 L190 51 L180 59 C173 55,162 63,157 79Z`} fill={hc}/>
                {[1,2].includes(hair)&&<React.Fragment>
                  <path d="M157 79 C151 97,150 115,154 131 C158 137,166 139,172 136 C167 123,162 107,165 91Z" fill={hc}/>
                  <path d="M223 79 C229 97,230 115,226 131 C222 137,214 139,208 136 C213 123,218 107,215 91Z" fill={hc}/>
                </React.Fragment>}
                {hair===0&&<ellipse cx="192" cy="42" rx="16" ry="12" fill={hc}/>}
                {/* Eyes */}
                <circle cx="178" cy="87" r="4.5" fill={hc==="#C0C0C0"?"#2A2A2A":hc} opacity="0.9"/>
                <circle cx="202" cy="87" r="4.5" fill={hc==="#C0C0C0"?"#2A2A2A":hc} opacity="0.9"/>
                <circle cx="179" cy="86" r="1.8" fill="#FFFFFF" opacity="0.7"/>
                <circle cx="203" cy="86" r="1.8" fill="#FFFFFF" opacity="0.7"/>
                {/* Brows */}
                <path d="M172 77 C176 74,182 74,186 76" stroke={hc} strokeWidth="1.5" strokeLinecap="round" fill="none"/>
                <path d="M194 76 C198 74,204 74,208 77" stroke={hc} strokeWidth="1.5" strokeLinecap="round" fill="none"/>
                {/* Lips */}
                <path d="M183 101 Q190 107,197 101" stroke="#A06050" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
                {/* Cheeks */}
                <ellipse cx="175" cy="96" rx="6" ry="3.5" fill="#E09080" opacity="0.14"/>
                <ellipse cx="205" cy="96" rx="6" ry="3.5" fill="#E09080" opacity="0.14"/>

                {/* ── NUMBERED ITEM PINS ── */}
                {outfitItems.map((it,i)=>{
                  const def=getLayer(it.emoji);
                  const pos=labelPos(def,it);
                  return(
                    <g key={it.id}>
                      <circle cx={pos.x} cy={pos.y} r="9" fill="#0D0D0D" opacity="0.75"/>
                      <circle cx={pos.x} cy={pos.y} r="8" fill={G}/>
                      <text x={pos.x} y={pos.y+0.5} textAnchor="middle" dominantBaseline="middle" fontSize="9" fill={BK} fontFamily="Montserrat,sans-serif" fontWeight="700">{i+1}</text>
                    </g>
                  );
                })}
              </svg>
            </div>

            {/* Legend — bottom left float */}
            {outfitItems.length>0&&(
              <div style={{position:"absolute",bottom:12,left:12,display:"flex",flexDirection:"column",gap:5,maxWidth:"55%"}}>
                {outfitItems.map((it,i)=>(
                  <div key={it.id} style={{..._row,gap:6,background:"#060504CC",backdropFilter:"blur(6px)",borderRadius:20,padding:"5px 10px 5px 5px",border:`1px solid ${G}28`}}>
                    <div style={{width:18,height:18,borderRadius:"50%",background:G,display:"flex",alignItems:"center",justifyContent:"center",...ss(8,700,BK),flexShrink:0}}>{i+1}</div>
                    <div style={ss(9,500,"#E8E0D4",{lineHeight:1.2,overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis"})}>{it.name}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Empty state */}
            {outfitItems.length===0&&(
              <div style={{..._abs0,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:10}}>
                <div style={{fontSize:36,opacity:0.2}}>🪞</div>
                <div style={sr(14,300,"#3A3028",{fontStyle:"italic",textAlign:"center"})}>Select items below<br/>to build your look</div>
              </div>
            )}
          </div>

          {/* Appearance controls */}
          <div style={{padding:"10px 18px 8px",background:"#0A0908",borderTop:"1px solid #181818",borderBottom:"1px solid #181818",display:"flex",gap:14,alignItems:"center",flexShrink:0}}>
            <div style={ss(8,400,DM,{letterSpacing:1.5,flexShrink:0})}>SKIN</div>
            {skins.map((s,i)=>(
              <button key={i} onClick={()=>setSkin(i)} style={{width:22,height:22,borderRadius:"50%",background:s,border:skin===i?`2.5px solid ${G}`:"2px solid transparent",cursor:_p,flexShrink:0}}/>
            ))}
            <div style={{width:1,height:16,background:"#222",flexShrink:0}}/>
            <div style={ss(8,400,DM,{letterSpacing:1.5,flexShrink:0})}>HAIR</div>
            {hairCols.map((h,i)=>(
              <button key={i} onClick={()=>setHair(i)} style={{width:22,height:22,borderRadius:"50%",background:h,border:hair===i?`2.5px solid ${G}`:"2px solid transparent",cursor:_p,flexShrink:0}}/>
            ))}
          </div>

          {/* Item selector strip */}
          <div style={{padding:"12px 16px 18px",background:"#0A0908",flexShrink:0}}>
            <div style={ss(8,400,DM,{letterSpacing:1.5,marginBottom:10})}>TAP ITEMS TO ADD OR REMOVE</div>
            <div style={{display:"flex",gap:8,overflowX:"auto",paddingBottom:4}}>
              {items.map(it=>{
                const on=selectedIds.includes(it.id);
                return(
                  <button key={it.id} onClick={()=>toggle(it.id)} style={{flexShrink:0,width:64,borderRadius:14,overflow:"hidden",border:`1.5px solid ${on?G:"#252525"}`,background:on?"#18140C":"#141414",cursor:_p,padding:0,transition:"all 0.18s"}}>
                    <div style={{height:52,display:"flex",alignItems:"center",justifyContent:"center",fontSize:26,background:on?`linear-gradient(135deg,${it.color}28,${it.color}48)`:"#1C1C1C",position:"relative"}}>
                      <ItemIllustration item={it} size={38}/>
                      {on&&<div style={{position:"absolute",bottom:0,left:0,right:0,height:2,background:`linear-gradient(90deg,${G},#8A6E54)`}}/>}
                    </div>
                    <div style={{padding:"5px 4px 7px",textAlign:"center"}}>
                      <div style={{...ss(7.5,on?600:400,on?G:"#484038"),letterSpacing:0.3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{it.name.split(" ")[0]}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── VACATION PLANNER
// Weather helpers — emoji + label maps
const CONDITION_EMOJI = {"Clear":"☀️","Sunny":"☀️","Mostly Sunny":"🌤️","Partly Cloudy":"⛅","Mostly Cloudy":"🌥️","Overcast":"☁️","Foggy":"🌫️","Drizzle":"🌦️","Light Rain":"🌦️","Rain":"🌧️","Heavy Rain":"🌧️","Showers":"🌧️","Thunderstorm":"⛈️","Snow":"❄️","Light Snow":"🌨️","Blizzard":"❄️","Hail":"⛈️","Windy":"💨","Hot":"🌞","Humid":"🌊"};
function condEmoji(label){ return CONDITION_EMOJI[label] || "🌤️"; }

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
  const [trips,setTrips]=useState([]);
  const [vacation,setVacation]=useState(null);
  const [vacIdx,setVacIdx]=useState(0); // carousel index
  const [carouselDir,setCarouselDir]=useState(0); // -1 left, 1 right, 0 none
  const [carouselAnimating,setCarouselAnimating]=useState(false);
  const [swipeStartX,setSwipeStartX]=useState(null);
  const [activeDay,setActiveDay]=useState(null);
  const [view,setView]=useState("itinerary");
  const [newTrip,setNewTrip]=useState(false);
  const [tripsLoading,setTripsLoading]=useState(true);
  const [form,setForm]=useState({name:"",destination:"",startDate:"",endDate:"",climate:"Warm & Sunny"});
  const [destSuggestions,setDestSuggestions]=useState([]);
  const [destLoading,setDestLoading]=useState(false);
  const [showDestList,setShowDestList]=useState(false);
  const destTimer=useRef(null);
  const [weather,setWeather]=useState(null);
  const [wxLoading,setWxLoading]=useState(false);
  const [formWx,setFormWx]=useState(null);
  const [formWxLoading,setFormWxLoading]=useState(false);
  const [packed,setPacked]=useState({});
  const [aiItineraryLoading,setAiItineraryLoading]=useState(false);
  const [editingDay,setEditingDay]=useState(null); // day index being edited
  const [editDayForm,setEditDayForm]=useState({label:"",activity:"",emoji:""});
  const [showOutfitPicker,setShowOutfitPicker]=useState(null); // day index for outfit picker
  const [outfitSearch,setOutfitSearch]=useState("");
  const [confirmDeleteTrip,setConfirmDeleteTrip]=useState(false);
  const [editTripForm,setEditTripForm]=useState({name:"",destination:"",startDate:"",endDate:"",climate:""});
  const [editingTrip,setEditingTrip]=useState(false);
  const togglePacked=(id)=>setPacked(p=>({...p,[id]:!p[id]}));
  const climates=["Warm & Sunny","Cold & Snowy","Tropical & Humid","Mediterranean","Rainy & Cool"];

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
            id:r.id,name:r.name,destination:r.destination,
            startDate:r.start_date,endDate:r.end_date,climate:r.climate||"Warm & Sunny",
            days_plan:r.days_plan||[],
          }));
          setTrips(mapped);
          setVacation(mapped[0]);
          setVacIdx(0);
        }
      }catch(e){ console.error("trips load error:",e); }
      setTripsLoading(false);
    })();
  },[session]);

  // ── Save trip to Supabase ──
  const saveTripToDB=async(trip)=>{
    if(!session?.access_token) return trip;
    const userId=session.user?.id;
    try{
      const body={user_id:userId,name:trip.name,destination:trip.destination,
        start_date:trip.startDate,end_date:trip.endDate,climate:trip.climate,days_plan:trip.days_plan};
      if(trip.id&&typeof trip.id==="string"&&trip.id.length>10){
        await fetch(`${SB_URL}/rest/v1/trips?id=eq.${trip.id}`,{
          method:"PATCH",headers:{"Content-Type":"application/json","Authorization":`Bearer ${session.access_token}`,"apikey":SB_KEY},
          body:JSON.stringify(body)
        });
        return trip;
      } else {
        const res=await fetch(`${SB_URL}/rest/v1/trips`,{
          method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${session.access_token}`,"apikey":SB_KEY,"Prefer":"return=representation"},
          body:JSON.stringify(body)
        });
        const rows=await res.json();
        return rows?.[0]?{...trip,id:rows[0].id}:trip;
      }
    }catch(e){ return trip; }
  };

  // ── Update vacation in state + DB ──
  const updateVacation=async(updated)=>{
    setVacation(updated);
    setTrips(prev=>prev.map(t=>t.id===updated.id?updated:t));
    await saveTripToDB(updated);
  };

  // ── Auto-fetch weather on trip change ──
  useEffect(()=>{
    if(!vacation?.destination||!vacation?.startDate||!vacation?.endDate) return;
    const start=parseTripDate(vacation.startDate);
    const end=parseTripDate(vacation.endDate);
    if(!start||!end) return;
    let cancelled=false;
    setWxLoading(true); setWeather(null);
    fetchTripWeather(vacation.destination,start,end)
      .then(data=>{ if(!cancelled) setWeather(data); })
      .catch(()=>{
        if(!cancelled){
          const climate=vacation.climate||"Mild";
          const baseMax=climate.includes("Warm")||climate.includes("Hot")?76:climate.includes("Cold")?45:64;
          const days=[];
          for(let i=0;i<Math.max(1,vacation.days_plan?.length||7);i++){
            const d=new Date(start); d.setDate(d.getDate()+i);
            days.push({date:d.toISOString().slice(0,10),condition:climate.includes("Sunny")?"Sunny":climate.includes("Rain")?"Rainy":"Partly Cloudy",tempMax:baseMax+Math.round(Math.random()*6-3),tempMin:baseMax-14+Math.round(Math.random()*4-2)});
          }
          setWeather({daily:days,city:vacation.destination.split(",")[0],climate});
        }
      })
      .finally(()=>{ if(!cancelled) setWxLoading(false); });
    return ()=>{ cancelled=true; };
  },[vacation?.destination,vacation?.startDate,vacation?.endDate]);

  const wxForDate=(dateStr)=>{
    if(!weather?.daily) return null;
    const key=parseTripDate(dateStr);
    return weather.daily.find(d=>d.date===key)||null;
  };

  // ── Generate itinerary with AI ──
  const generateItinerary=async(tripData)=>{
    setAiItineraryLoading(true);
    try{
      const raw=await callClaude(
        `Create a day-by-day travel itinerary for a trip to ${tripData.destination} from ${tripData.startDate} to ${tripData.endDate}. Climate: ${tripData.climate}. 
For each day provide a label (what you'll do), activity type, and emoji. Calculate the exact number of days.
Respond ONLY with JSON: {"days":[{"day":1,"date":"${tripData.startDate}","label":"Arrival & Check-in","activity":"Travel","emoji":"✈️"},...]}`
      );
      const json=JSON.parse(raw.replace(/```json|```/g,"").trim());
      return (json.days||[]).map(d=>({...d,dayOutfitIds:[],eveningOutfitIds:[],packed:false}));
    }catch(e){
      // Fallback: generate basic skeleton from dates
      const start=parseTripDate(tripData.startDate);
      if(!start) return [];
      const end=parseTripDate(tripData.endDate);
      const startD=new Date(start), endD=end?new Date(end):new Date(start);
      const numDays=Math.max(1,Math.round((endD-startD)/(1000*60*60*24))+1);
      return Array.from({length:numDays},(_,i)=>{
        const d=new Date(startD); d.setDate(d.getDate()+i);
        const dateStr=d.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"});
        return{day:i+1,date:dateStr,label:i===0?"Arrival":`Day ${i+1}`,activity:i===0?"Travel":"Explore",emoji:i===0?"✈️":"🗺️",dayOutfitIds:[],eveningOutfitIds:[],packed:false};
      });
    } finally { setAiItineraryLoading(false); }
  };

  // ── Packing list ──
  const allOutfitItemIds=[...new Set((vacation?.days_plan||[]).flatMap(d=>[...(d.dayOutfitIds||d.outfitIds||[]),...(d.eveningOutfitIds||[])]))];
  const packingItems=allOutfitItemIds.map(id=>items.find(i=>i.id===id)).filter(Boolean);
  const essentials=[
    {id:"e1",emoji:"🧴",name:"Sunscreen SPF 50",category:"Toiletries"},
    {id:"e2",emoji:"💊",name:"Travel medications",category:"Health"},
    {id:"e3",emoji:"🔌",name:"Universal adapter",category:"Tech"},
    {id:"e4",emoji:"📄",name:"Passport & documents",category:"Documents"},
    {id:"e5",emoji:"💳",name:"Travel cards & cash",category:"Documents"},
    {id:"e6",emoji:"🕶️",name:"Sunglasses",category:"Accessories"},
    {id:"e7",emoji:"🧳",name:"Packing cubes",category:"Luggage"},
  ];
  const totalPacked=Object.values(packed).filter(Boolean).length;
  const totalItems=packingItems.length+essentials.length;
  const pct=totalItems>0?Math.round((totalPacked/totalItems)*100):0;

  // ── NEW TRIP FORM ──
  if(newTrip){
    return(
      <div className="fu" style={{padding:"16px 24px"}}>
        <div style={{display:"flex",gap:12,alignItems:"center",marginBottom:20}}>
          <button className="tb" onClick={()=>setNewTrip(false)} style={{fontSize:18,color:MD}}>←</button>
          <div style={sr(20,400)}>Plan a New Trip</div>
        </div>
        <div style={{..._col,gap:12}}>
          <div>
            <div style={ss(9,400,DM,{letterSpacing:1.5,textTransform:"uppercase",marginBottom:6})}>Trip Name</div>
            <input value={form.name} onChange={e=>setForm(p=>({...p,name:e.target.value}))}
              placeholder="e.g. Paris Honeymoon" style={{width:"100%",boxSizing:"border-box",background:_1a,border:_2a,borderRadius:12,padding:"12px 14px",...ss(13,400,MD),color:"#C0B8B0",outline:"none"}} />
          </div>
          {/* Destination autocomplete */}
          <div style={{position:"relative"}}>
            <div style={ss(9,400,DM,{letterSpacing:1.5,textTransform:"uppercase",marginBottom:6})}>Destination</div>
            <div style={{..._row,gap:8,background:_1a,border:showDestList?`1px solid ${G}66`:_2a,borderRadius:12,padding:"12px 14px"}}>
              <input value={form.destination} onChange={e=>{
                  const v=e.target.value; setForm(p=>({...p,destination:v})); setShowDestList(true);
                  clearTimeout(destTimer.current);
                  if(v.length<2){setDestSuggestions([]);return;}
                  setDestLoading(true);
                  destTimer.current=setTimeout(async()=>{
                    try{
                      const res=await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(v)}&format=json&limit=6&addressdetails=1`,{headers:{"Accept-Language":"en"}});
                      const data=await res.json();
                      const seen=new Set();
                      const suggestions=data.map(r=>{
                        const city=r.address?.city||r.address?.town||r.address?.village||r.address?.county||r.name;
                        const country=r.address?.country||"";
                        return country&&city!==country?`${city}, ${country}`:city;
                      }).filter(l=>{if(!l||seen.has(l))return false;seen.add(l);return true;});
                      setDestSuggestions(suggestions);
                    }catch(e){setDestSuggestions([]);}
                    setDestLoading(false);
                  },350);
                }}
                onFocus={()=>{if(form.destination.length>=2)setShowDestList(true);}}
                onBlur={()=>setTimeout(()=>setShowDestList(false),150)}
                placeholder="City, Country"
                style={{flex:1,background:"none",border:"none",outline:"none",...ss(13,400,MD),color:"#C0B8B0"}}/>
              {destLoading&&<span style={{fontSize:12,animation:"spin 1s linear infinite",display:"inline-block",opacity:0.5}}>✦</span>}
              {form.destination&&!destLoading&&<button onClick={()=>{setForm(p=>({...p,destination:""}));setDestSuggestions([]);}} style={{background:"none",border:"none",cursor:_p,...ss(12,400,DM)}}>✕</button>}
            </div>
            {showDestList&&destSuggestions.length>0&&(
              <div style={{position:"absolute",top:"100%",left:0,right:0,zIndex:50,background:"#1A1A1A",borderRadius:"0 0 12px 12px",border:`1px solid ${G}44`,borderTop:"none",overflow:"hidden",marginTop:-2}}>
                {destSuggestions.map((s,i)=>(
                  <div key={i} onMouseDown={()=>{setForm(p=>({...p,destination:s}));setDestSuggestions([]);setShowDestList(false);}}
                    style={{padding:"11px 14px",cursor:_p,borderTop:i>0?`1px solid #2A2A2A`:"none",display:"flex",alignItems:"center",gap:10,...ss(13,400,MD)}} className="ch">
                    <span style={{fontSize:14,opacity:0.5}}>📍</span>{s}
                  </div>
                ))}
              </div>
            )}
          </div>
          <RangeDatePicker
            startVal={form.startDate} endVal={form.endDate}
            onChangeStart={v=>setForm(p=>({...p,startDate:v}))}
            onChangeEnd={v=>setForm(p=>({...p,endDate:v}))}
          />
          {/* Climate */}
          <div>
            <div style={ss(9,400,DM,{letterSpacing:1.5,textTransform:"uppercase",marginBottom:8})}>Climate</div>
            <button className="pb" disabled={!form.destination||!form.startDate||!form.endDate||formWxLoading}
              onClick={async()=>{
                const s=parseTripDate(form.startDate),e=parseTripDate(form.endDate);
                if(!s||!e){showToast("Enter valid dates first");return;}
                setFormWxLoading(true);setFormWx(null);
                try{const data=await fetchTripWeather(form.destination,s,e);setFormWx(data);setForm(p=>({...p,climate:data.climate}));showToast(`Weather detected: ${data.climate} ✦`);}
                catch(err){showToast("Could not detect weather — pick manually");}
                finally{setFormWxLoading(false);}
              }}
              style={{..._row,gap:8,padding:"9px 16px",borderRadius:20,background:formWxLoading?"#1A1A1A":G,border:"none",...ss(9,600,formWxLoading?DM:BK,{letterSpacing:1}),cursor:_p,marginBottom:12,opacity:(!form.destination||!form.startDate||!form.endDate)?0.5:1}}>
              {formWxLoading?<React.Fragment>✦ DETECTING…</React.Fragment>:<React.Fragment>☁️ AUTO-DETECT WEATHER</React.Fragment>}
            </button>
            {formWx&&(
              <div style={{background:"#0D1928",borderRadius:14,padding:"10px 14px",border:"1px solid #1A2A40",marginBottom:12}}>
                <div style={{display:"flex",gap:6,overflowX:"auto",paddingBottom:2}}>
                  {formWx.daily.slice(0,7).map(d=>(
                    <div key={d.date} style={{flexShrink:0,textAlign:"center",background:"#091420",borderRadius:10,padding:"6px 8px",minWidth:42}}>
                      <div style={{fontSize:16,marginBottom:3}}>{condEmoji(d.condition)}</div>
                      <div style={ss(8,600,"#A0C0E0")}>{d.tempMax}°</div>
                      <div style={ss(7,400,"#3A5070")}>{d.tempMin}°</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              {climates.map(c=>(
                <button key={c} className="pb" onClick={()=>setForm(p=>({...p,climate:c}))} style={{padding:"7px 14px",borderRadius:20,background:form.climate===c?G:"#1A1A1A",border:form.climate===c?"none":"1px solid #222",...ss(9,form.climate===c?600:400,form.climate===c?BK:DM,{letterSpacing:1})}}>{c}</button>
              ))}
            </div>
          </div>
          <div style={{marginTop:8,display:"flex",flexDirection:"column",gap:8}}>
            <button disabled={!form.name||!form.destination||aiItineraryLoading} onClick={async()=>{
              if(!form.name||!form.destination){showToast("Please fill in name and destination");return;}
              const newTripData={id:null,name:form.name,destination:form.destination,startDate:form.startDate,endDate:form.endDate,climate:form.climate,days_plan:[]};
              showToast("Generating your itinerary… ✦");
              const days=await generateItinerary(newTripData);
              newTripData.days_plan=days;
              const saved=await saveTripToDB(newTripData);
              setTrips(prev=>[saved,...prev]);
              setVacation(saved);
              setVacIdx(0);
              setNewTrip(false);
              showToast("Trip created ✦");
            }} style={{width:"100%",padding:"14px",borderRadius:14,background:aiItineraryLoading||!form.name||!form.destination?"#1A1A1A":`linear-gradient(135deg,${G},#8A6E54)`,border:"none",...ss(10,700,aiItineraryLoading||!form.name||!form.destination?"#3A3028":BK,{letterSpacing:1.5}),cursor:_p}}>
              {aiItineraryLoading?"✦ GENERATING ITINERARY…":"✦ CREATE TRIP WITH AI ITINERARY"}
            </button>
            <button disabled={!form.name||!form.destination} onClick={async()=>{
              if(!form.name||!form.destination){showToast("Please fill in name and destination");return;}
              // Build empty skeleton from dates
              const start=parseTripDate(form.startDate);
              const end=parseTripDate(form.endDate);
              const days=[];
              if(start){
                const startD=new Date(start),endD=end?new Date(end):new Date(start);
                const numDays=Math.max(1,Math.round((endD-startD)/(1000*60*60*24))+1);
                for(let i=0;i<numDays;i++){
                  const d=new Date(startD); d.setDate(d.getDate()+i);
                  const dateStr=d.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"});
                  days.push({day:i+1,date:dateStr,label:i===0?"Arrival":`Day ${i+1}`,activity:i===0?"Travel":"",emoji:i===0?"✈️":"📅",dayOutfitIds:[],eveningOutfitIds:[],packed:false});
                }
              }
              const newTripData={id:null,name:form.name,destination:form.destination,startDate:form.startDate,endDate:form.endDate,climate:form.climate,days_plan:days};
              const saved=await saveTripToDB(newTripData);
              setTrips(prev=>[saved,...prev]);
              setVacation(saved);
              setVacIdx(0);
              setNewTrip(false);
              showToast("Trip created — fill in your own itinerary ✦");
            }} style={{width:"100%",padding:"14px",borderRadius:14,background:_1a,border:_2a,...ss(10,600,MD,{letterSpacing:1}),cursor:_p}}>
              ADD MY OWN ITINERARY
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── NO TRIPS STATE ──
  if(tripsLoading){
    return(
      <div className="fu" style={{display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:16,padding:40}}>
        <div style={{fontSize:32,animation:"spin 1.2s linear infinite"}}>✦</div>
        <div style={ss(11,400,DM,{letterSpacing:1})}>Loading your trips…</div>
      </div>
    );
  }

  if(!vacation){
    return(
      <div className="fu" style={{padding:"16px 24px",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:16,textAlign:"center",minHeight:"50vh"}}>
        <div style={{fontSize:52}}>✈️</div>
        <div style={sr(22,300)}>No trips planned yet</div>
        <div style={ss(10,400,DM,{lineHeight:1.6,maxWidth:260})}>Plan your first trip and let AI build your day-by-day itinerary and packing list.</div>
        <button onClick={()=>setNewTrip(true)} style={{padding:"13px 28px",borderRadius:14,background:`linear-gradient(135deg,${G},#8A6E54)`,border:"none",...ss(10,700,BK,{letterSpacing:1.5}),cursor:_p}}>+ PLAN A TRIP</button>
      </div>
    );
  }

  // ── MAIN PLANNER VIEW ──
  // Animated carousel navigation
  const goToTrip=(newIdx,dir)=>{
    if(carouselAnimating||newIdx===vacIdx) return;
    setCarouselDir(dir);
    setCarouselAnimating(true);
    setTimeout(()=>{
      setVacIdx(newIdx);
      setVacation(trips[newIdx]);
      setCarouselDir(-dir); // incoming from opposite side
      setTimeout(()=>{
        setCarouselAnimating(false);
        setCarouselDir(0);
      },30);
    },260);
  };
  const handleVacSwipeStart=e=>setSwipeStartX(e.touches[0].clientX);
  const handleVacSwipeEnd=e=>{
    if(swipeStartX===null) return;
    const dx=e.changedTouches[0].clientX-swipeStartX;
    if(Math.abs(dx)>50){
      const newIdx=dx<0?Math.min(vacIdx+1,trips.length-1):Math.max(vacIdx-1,0);
      goToTrip(newIdx,dx<0?-1:1);
    }
    setSwipeStartX(null);
  };

  return(
    <div className="fu" style={{padding:"16px 12px"}}>
      {/* Header — no back button */}
      <div style={{..._btwn,marginBottom:trips.length>1?8:16}}>
        <div>
          <div style={sr(22,300)}>Vacation Planner</div>
          <div style={ss(10,400,DM,{letterSpacing:1,marginTop:2})}>ITINERARY · OUTFITS · PACKING</div>
        </div>
        <button className="sb" onClick={()=>setNewTrip(true)} style={{padding:"6px 14px",borderRadius:20,background:_1a,border:_2a,...ss(9,400,MD,{letterSpacing:1}),cursor:_p}}>+ NEW</button>
      </div>

      {/* Carousel indicator — only shown with multiple trips */}
      {trips.length>1&&(
        <div style={{marginBottom:14}}>
          {/* Swipe hint — shown only while more than 1 trip exists */}
          <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:8,marginBottom:10}}>
            <div style={{height:1,flex:1,background:"#2A2A2A"}}/>
            <div style={{..._row,gap:5,...ss(8,400,DM,{letterSpacing:1})}}>
              <span style={{fontSize:11}}>←</span>
              SWIPE TO SWITCH TRIPS
              <span style={{fontSize:11}}>→</span>
            </div>
            <div style={{height:1,flex:1,background:"#2A2A2A"}}/>
          </div>
          {/* Dot indicators */}
          <div style={{display:"flex",justifyContent:"center",gap:6}}>
            {trips.map((_,i)=>(
              <div key={i} onClick={()=>goToTrip(i,i>vacIdx?-1:1)}
                style={{width:i===vacIdx?20:6,height:6,borderRadius:3,background:i===vacIdx?G:"#2A2A2A",transition:"all 0.25s ease",cursor:_p}}/>
            ))}
          </div>
        </div>
      )}

      {/* Trip hero — swipeable with slide animation */}
      <div onTouchStart={handleVacSwipeStart} onTouchEnd={handleVacSwipeEnd}
        style={{
          background:"linear-gradient(135deg,#0F1A2E,#162236)",borderRadius:20,padding:"20px",
          border:"1px solid #2A3A5A",marginBottom:16,position:"relative",overflow:"hidden",
          transform:carouselAnimating&&carouselDir!==0?`translateX(${carouselDir*110}%)`:"translateX(0)",
          opacity:carouselAnimating&&carouselDir!==0?0:1,
          transition:carouselAnimating?"transform 0.26s ease, opacity 0.26s ease":"none",
        }}>
        <div style={{position:"absolute",top:-20,right:-20,fontSize:80,opacity:0.1}}>✈️</div>

        {confirmDeleteTrip ? (
          <div>
            <div style={{textAlign:"center",padding:"8px 0 16px"}}>
              <div style={{fontSize:32,marginBottom:10}}>🗑</div>
              <div style={sr(18,400,"#D0E0F4",{marginBottom:8})}>Delete "{vacation.name}"?</div>
              <div style={ss(10,400,"#5A7090",{lineHeight:1.5,marginBottom:20})}>This will permanently remove the trip, all itinerary days, and outfit assignments. This cannot be undone.</div>
            </div>
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>setConfirmDeleteTrip(false)} style={{flex:1,padding:"11px",borderRadius:12,background:"#0D1928",border:"1px solid #2A3A5A",...ss(9,600,"#7A90B8",{letterSpacing:1}),cursor:_p}}>KEEP TRIP</button>
              <button onClick={async()=>{
                if(!vacation.id) return;
                try{
                  await fetch(`${SB_URL}/rest/v1/trips?id=eq.${vacation.id}`,{
                    method:"DELETE",headers:{"Authorization":`Bearer ${session?.access_token}`,"apikey":SB_KEY}
                  });
                }catch(e){}
                const remaining=trips.filter(t=>t.id!==vacation.id);
                setTrips(remaining);
                setVacation(remaining[0]||null);
                setConfirmDeleteTrip(false);
                showToast("Trip deleted \u2746");
              }} style={{flex:1,padding:"11px",borderRadius:12,background:"#2A0A0A",border:"1px solid #5A1A1A",...ss(9,700,"#E08080",{letterSpacing:1}),cursor:_p}}>DELETE</button>
            </div>
          </div>
        ) : editingTrip ? (
          <div>
            <div style={{..._btwn,marginBottom:16}}>
              <div style={ss(9,400,"#6A90B8",{letterSpacing:2})}>EDITING TRIP</div>
              <button onClick={()=>setEditingTrip(false)} style={{width:28,height:28,borderRadius:"50%",background:"#1A2A40",border:"1px solid #2A3A5A",cursor:_p,...ss(14,300,"#7AAAD0"),display:"flex",alignItems:"center",justifyContent:"center"}}>×</button>
            </div>
            <div style={ss(8,600,"#5A7090",{letterSpacing:1.5,marginBottom:6})}>TRIP NAME</div>
            <input value={editTripForm.name} onChange={e=>setEditTripForm(p=>({...p,name:e.target.value}))}
              style={{width:"100%",boxSizing:"border-box",background:"#0D1928",border:"1px solid #2A3A5A",borderRadius:10,padding:"10px 12px",...ss(13,400,"#A0C0E0"),color:"#A0C0E0",marginBottom:12,outline:"none"}}/>
            <div style={ss(8,600,"#5A7090",{letterSpacing:1.5,marginBottom:6})}>DESTINATION</div>
            <input value={editTripForm.destination} onChange={e=>setEditTripForm(p=>({...p,destination:e.target.value}))}
              style={{width:"100%",boxSizing:"border-box",background:"#0D1928",border:"1px solid #2A3A5A",borderRadius:10,padding:"10px 12px",...ss(13,400,"#A0C0E0"),color:"#A0C0E0",marginBottom:12,outline:"none"}}/>
            <div style={{marginBottom:12}}>
              <RangeDatePicker
                startVal={editTripForm.startDate} endVal={editTripForm.endDate}
                onChangeStart={v=>setEditTripForm(p=>({...p,startDate:v}))}
                onChangeEnd={v=>setEditTripForm(p=>({...p,endDate:v}))}
              />
            </div>
            <div style={ss(8,600,"#5A7090",{letterSpacing:1.5,marginBottom:8})}>CLIMATE</div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:16}}>
              {["Warm & Sunny","Cold & Snowy","Tropical & Humid","Mediterranean","Rainy & Cool"].map(c=>(
                <button key={c} onClick={()=>setEditTripForm(p=>({...p,climate:c}))}
                  style={{padding:"5px 10px",borderRadius:16,background:editTripForm.climate===c?"#2A4A6A":"#0D1928",border:editTripForm.climate===c?"1px solid #4A7AAA":"1px solid #2A3A5A",...ss(8,editTripForm.climate===c?600:400,editTripForm.climate===c?"#A0C8E8":"#5A7090",{letterSpacing:0.3}),cursor:_p}}>{c}</button>
              ))}
            </div>
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>setEditingTrip(false)} style={{flex:1,padding:"10px",borderRadius:12,background:"#0D1928",border:"1px solid #2A3A5A",...ss(9,600,"#5A7090",{letterSpacing:1}),cursor:_p}}>CANCEL</button>
              <button onClick={async()=>{
                if(!editTripForm.name.trim()) return;
                const updated={...vacation,name:editTripForm.name,destination:editTripForm.destination,startDate:editTripForm.startDate,endDate:editTripForm.endDate,climate:editTripForm.climate};
                await updateVacation(updated);
                setEditingTrip(false);
                showToast("Trip updated \u2746");
              }} style={{flex:2,padding:"10px",borderRadius:12,background:"linear-gradient(135deg,#2A4A6A,#1A3A5A)",border:"1px solid #4A7AAA",...ss(9,700,"#A0C8E8",{letterSpacing:1}),cursor:_p}}>SAVE CHANGES</button>
            </div>
          </div>
        ) : (
          <div>
            <div style={{..._btwn,marginBottom:6}}>
              <div style={ss(9,400,"#6A90B8",{letterSpacing:3,textTransform:"uppercase"})}>Current Trip</div>
              <div style={{display:"flex",gap:6}}>
                <button onClick={()=>{setEditTripForm({name:vacation.name,destination:vacation.destination,startDate:vacation.startDate,endDate:vacation.endDate,climate:vacation.climate});setEditingTrip(true);}}
                  style={{padding:"4px 10px",borderRadius:10,background:"#1A2A40",border:"1px solid #2A3A5A",cursor:_p,...ss(8,600,"#7AAAD0",{letterSpacing:0.5})}}>✏️ EDIT</button>
                <button onClick={()=>setConfirmDeleteTrip(true)} style={{padding:"4px 10px",borderRadius:10,background:"#2A1A1A",border:"1px solid #3A2020",cursor:_p,...ss(8,600,"#A06060",{letterSpacing:0.5})}}>🗑 DELETE</button>
              </div>
            </div>
            <div style={sr(24,400,"#D0E0F4",{marginBottom:4})}>{vacation.name}</div>
            <div style={ss(10,400,"#7A90B8",{marginBottom:14})}>{vacation.destination}</div>
            <div style={{display:"flex",gap:16,flexWrap:"wrap"}}>
              {[["📅",`${vacation.startDate}${vacation.endDate?" – "+vacation.endDate:""}`],["🌤️",vacation.climate],["📆",`${vacation.days_plan.length} days`]].map(([icon,val])=>(
                <div key={val} style={{..._row,gap:6}}><span style={{fontSize:12}}>{icon}</span><span style={ss(9,400,"#7A90B8",{letterSpacing:0.5})}>{val}</span></div>
              ))}
            </div>
            {wxLoading&&<div style={{marginTop:14,..._row,gap:8}}><div style={{fontSize:14,animation:"spin 1.5s linear infinite",display:"inline-block"}}>✦</div><span style={ss(9,400,"#5A7090",{letterSpacing:1})}>Fetching weather…</span></div>}
            {weather&&!wxLoading&&(
              <div style={{marginTop:14}}>
                <div style={{..._btwn,marginBottom:8}}>
                  <div style={ss(8,400,"#5A7090",{letterSpacing:2,textTransform:"uppercase"})}>
                    {weather.seasonal?"Typical Climate":"Forecast"} · {weather.city}
                  </div>
                  {weather.seasonal&&<div style={{...ss(7,600,"#4A7090"),background:"#0D1928",padding:"2px 7px",borderRadius:6,border:"1px solid #1A3050"}}>SEASONAL EST.</div>}
                </div>
                {weather.seasonal&&weather.summary&&(
                  <div style={{...ss(9,400,"#7A90B8",{lineHeight:1.5,fontStyle:"italic",marginBottom:4})}}>{weather.summary}</div>
                )}
                {!weather.seasonal&&(
                  <div style={{display:"flex",gap:6,overflowX:"auto",paddingBottom:4}}>
                    {weather.daily.map(d=>{
                      const dateObj=new Date(d.date+"T12:00:00");
                      const dayLabel=["Su","Mo","Tu","We","Th","Fr","Sa"][dateObj.getDay()];
                      const dateLabel=`${dateObj.getMonth()+1}/${dateObj.getDate()}`;
                      return(
                        <div key={d.date} style={{flexShrink:0,textAlign:"center",background:"#0D1928",borderRadius:12,padding:"8px 8px 6px",border:"1px solid #1A2A40",minWidth:44}}>
                          <div style={ss(7,600,"#4A7090",{letterSpacing:0.3,marginBottom:2})}>{dayLabel}</div>
                          <div style={{fontSize:18,marginBottom:3}}>{condEmoji(d.condition)}</div>
                          <div style={ss(8,600,"#A0C0E0")}>{d.tempMax}°</div>
                          <div style={ss(7,400,"#4A6080")}>{d.tempMin}°</div>
                          <div style={ss(7,400,"#3A5070",{marginTop:3})}>{dateLabel}</div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
      {/* View toggle */}
      <div style={{display:"flex",gap:8,marginBottom:18}}>
        {[["itinerary","Day-by-Day","📋"],["packing","What to Pack","🧳"]].map(([k,l,ic])=>(
          <button key={k} className="pb" onClick={()=>setView(k)} style={{flex:1,padding:"10px",borderRadius:14,background:view===k?G:"#1A1A1A",border:view===k?"none":"1px solid #222",display:"flex",alignItems:"center",justifyContent:"center",gap:6,...ss(10,view===k?600:400,view===k?BK:DM,{letterSpacing:1})}}>
            <span style={{fontSize:14}}>{ic}</span>{l}
          </button>
        ))}
      </div>

      {/* ITINERARY */}
      {view==="itinerary"&&(
        <React.Fragment>
          {vacation.days_plan.length===0&&(
            <div style={{textAlign:"center",padding:"32px 0",opacity:0.5}}>
              <div style={ss(10,400,DM,{fontStyle:"italic",marginBottom:12})}>No itinerary yet</div>
              <button onClick={async()=>{
                const days=await generateItinerary(vacation);
                const updated={...vacation,days_plan:days};
                await updateVacation(updated);
                showToast("Itinerary generated ✦");
              }} style={{padding:"11px 24px",borderRadius:12,background:`linear-gradient(135deg,${G},#8A6E54)`,border:"none",...ss(10,600,BK,{letterSpacing:1}),cursor:_p}}>
                {aiItineraryLoading?"GENERATING…":"✦ GENERATE WITH AI"}
              </button>
            </div>
          )}
          {vacation.days_plan.map((day,di)=>{
            const isOpen=activeDay===di;
            const isEditing=editingDay===di;
            const dayItems=[...(day.dayOutfitIds||day.outfitIds||[]),...(day.eveningOutfitIds||[])].map(id=>items.find(i=>i.id===id)).filter(Boolean);
            const wx=wxForDate(day.date);
            return(
              <div key={di} style={{background:CD,borderRadius:18,padding:"14px 16px",marginBottom:10,border:`1.5px solid ${isOpen?"#C4A88266":BR}`}}>
                <div style={{..._row,gap:12,cursor:_p}} onClick={()=>{setActiveDay(isOpen?null:di);setEditingDay(null);}}>
                  <div style={{width:40,height:40,borderRadius:12,background:isOpen?`linear-gradient(135deg,${G},#8A6E54)`:"#1A1A1A",border:`1px solid ${isOpen?"transparent":"#2A2A2A"}`,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                    <div style={ss(7,600,isOpen?BK:DM,{letterSpacing:1})}>DAY</div>
                    <div style={sr(15,500,isOpen?BK:G)}>{day.day}</div>
                  </div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{..._row,gap:6,marginBottom:2}}>
                      <span style={{fontSize:14}}>{day.emoji}</span>
                      <div style={sr(14,500,undefined,{whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"})}>{day.label||`Day ${day.day}`}</div>
                    </div>
                    <div style={{..._row,gap:8}}>
                      <span style={ss(9,400,DM,{letterSpacing:1})}>{day.date}{day.activity?` · ${day.activity}`:""}</span>
                      {wx&&<span style={{display:"inline-flex",alignItems:"center",gap:3,background:"#0D1928",borderRadius:8,padding:"2px 7px",border:"1px solid #1A2A40"}}>
                        <span style={{fontSize:11}}>{condEmoji(wx.condition)}</span>
                        <span style={ss(9,500,"#7AAAD0")}>{wx.tempMax}°</span>
                      </span>}
                    </div>
                  </div>
                  <div style={{display:"flex",gap:4,flexShrink:0}}>
                    {dayItems.slice(0,3).map(it=>(
                      <div key={it.id} style={{width:28,height:28,borderRadius:8,background:`${it.color||G}22`,overflow:"hidden",display:"flex",alignItems:"center",justifyContent:"center"}}>
                        {it.sourceImage?<img src={it.sourceImage} style={{width:"100%",height:"100%",objectFit:"contain"}} alt={it.name}/>:<ItemIllustration item={it} size={24}/>}
                      </div>
                    ))}
                    {dayItems.length>3&&<div style={{width:28,height:28,borderRadius:8,background:_1a,...ss(9,600,DM),display:"flex",alignItems:"center",justifyContent:"center"}}>+{dayItems.length-3}</div>}
                  </div>
                </div>

                {isOpen&&(
                  <div style={{marginTop:14,borderTop:`1px solid ${BR}`,paddingTop:14}}>
                    {isEditing?(
                      <div style={{marginBottom:14}}>
                        <div style={ss(9,600,DM,{letterSpacing:1.5,marginBottom:10})}>EDIT DAY</div>
                        <div style={{display:"flex",gap:8,marginBottom:8}}>
                          <input value={editDayForm.emoji} onChange={e=>setEditDayForm(p=>({...p,emoji:e.target.value}))} placeholder="✈️" style={{width:48,background:_1a,border:_2a,borderRadius:10,padding:"9px",textAlign:"center",...ss(16,400,MD),color:MD,outline:"none"}}/>
                          <input value={editDayForm.label} onChange={e=>setEditDayForm(p=>({...p,label:e.target.value}))} placeholder="What are you doing?" style={{flex:1,background:_1a,border:_2a,borderRadius:10,padding:"9px 12px",...ss(12,400,MD),color:"#C0B8B0",outline:"none"}}/>
                        </div>
                        <input value={editDayForm.activity} onChange={e=>setEditDayForm(p=>({...p,activity:e.target.value}))} placeholder="Activity type (e.g. Sightseeing, Beach...)" style={{width:"100%",boxSizing:"border-box",background:_1a,border:_2a,borderRadius:10,padding:"9px 12px",...ss(12,400,MD),color:"#C0B8B0",outline:"none",marginBottom:10}}/>
                        <div style={{display:"flex",gap:8}}>
                          <button onClick={()=>setEditingDay(null)} style={{flex:1,padding:"9px",borderRadius:11,background:_1a,border:_2a,...ss(9,600,DM,{letterSpacing:1}),cursor:_p}}>CANCEL</button>
                          <button onClick={async()=>{
                            const updated={...vacation,days_plan:vacation.days_plan.map((d,i)=>i===di?{...d,label:editDayForm.label||d.label,activity:editDayForm.activity||d.activity,emoji:editDayForm.emoji||d.emoji}:d)};
                            await updateVacation(updated);
                            setEditingDay(null);
                            showToast("Day updated ✦");
                          }} style={{flex:2,padding:"9px",borderRadius:11,background:`linear-gradient(135deg,${G},#8A6E54)`,border:"none",...ss(9,700,BK,{letterSpacing:1}),cursor:_p}}>SAVE</button>
                        </div>
                      </div>
                    ):(
                      <button onClick={e=>{e.stopPropagation();setEditingDay(di);setEditDayForm({label:day.label,activity:day.activity||"",emoji:day.emoji||"📅"});}} style={{width:"100%",padding:"8px",borderRadius:11,background:_1a,border:`1px dashed #2A2A2A`,...ss(9,400,DM,{letterSpacing:1}),cursor:_p,marginBottom:12,display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
                        ✏️ EDIT THIS DAY
                      </button>
                    )}

                    {/* DAY outfit slot */}
                    {(()=>{
                      const slotItems=(day.dayOutfitIds||day.outfitIds||[]).map(id=>items.find(i=>i.id===id)).filter(Boolean);
                      return(
                        <div style={{marginBottom:14}}>
                          <div style={{..._row,gap:6,marginBottom:8}}>
                            <div style={{background:"#2A3A20",borderRadius:6,padding:"2px 8px",...ss(7,700,"#80B870",{letterSpacing:1.5})}}>DAY</div>
                          </div>
                          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                            {slotItems.map(it=>(
                              <div key={it.id} style={{..._col,alignItems:"center",gap:4}}>
                                <div style={{position:"relative"}}>
                                  <ItemThumb item={it} size={52} r={14}/>
                                  <button onClick={e=>{e.stopPropagation();const updated={...vacation,days_plan:vacation.days_plan.map((d,i)=>i===di?{...d,dayOutfitIds:(d.dayOutfitIds||d.outfitIds||[]).filter(id=>id!==it.id)}:d)};updateVacation(updated);}} style={{position:"absolute",top:-4,right:-4,width:16,height:16,borderRadius:"50%",background:"#3A1A1A",border:"1px solid #5A2A2A",display:"flex",alignItems:"center",justifyContent:"center",cursor:_p,...ss(10,600,"#C08080")}}>×</button>
                                </div>
                                <div style={ss(8,400,DM,{textAlign:"center",maxWidth:52,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"})}>{it.name.split(" ")[0]}</div>
                              </div>
                            ))}
                            <button onClick={e=>{e.stopPropagation();setShowOutfitPicker({di,slot:"day"});setOutfitSearch("");}} style={{width:52,height:52,borderRadius:14,background:"#0F0F0F",border:"1.5px dashed #2A2A2A",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,color:"#3A3028",cursor:_p}}>+</button>
                          </div>
                        </div>
                      );
                    })()}
                    {/* EVENING outfit slot */}
                    {(()=>{
                      const slotItems=(day.eveningOutfitIds||[]).map(id=>items.find(i=>i.id===id)).filter(Boolean);
                      return(
                        <div style={{marginBottom:12}}>
                          <div style={{..._row,gap:6,marginBottom:8}}>
                            <div style={{background:"#2A1A3A",borderRadius:6,padding:"2px 8px",...ss(7,700,"#A080C8",{letterSpacing:1.5})}}>EVENING</div>
                          </div>
                          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                            {slotItems.map(it=>(
                              <div key={it.id} style={{..._col,alignItems:"center",gap:4}}>
                                <div style={{position:"relative"}}>
                                  <ItemThumb item={it} size={52} r={14}/>
                                  <button onClick={e=>{e.stopPropagation();const updated={...vacation,days_plan:vacation.days_plan.map((d,i)=>i===di?{...d,eveningOutfitIds:(d.eveningOutfitIds||[]).filter(id=>id!==it.id)}:d)};updateVacation(updated);}} style={{position:"absolute",top:-4,right:-4,width:16,height:16,borderRadius:"50%",background:"#3A1A1A",border:"1px solid #5A2A2A",display:"flex",alignItems:"center",justifyContent:"center",cursor:_p,...ss(10,600,"#C08080")}}>×</button>
                                </div>
                                <div style={ss(8,400,DM,{textAlign:"center",maxWidth:52,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"})}>{it.name.split(" ")[0]}</div>
                              </div>
                            ))}
                            <button onClick={e=>{e.stopPropagation();setShowOutfitPicker({di,slot:"evening"});setOutfitSearch("");}} style={{width:52,height:52,borderRadius:14,background:"#0F0F0F",border:"1.5px dashed #2A2A2A",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,color:"#3A3028",cursor:_p}}>+</button>
                          </div>
                        </div>
                      );
                    })()}

                    {wx&&<div style={{background:"linear-gradient(135deg,#1A1A2E,#16213E)",borderRadius:12,padding:"10px 14px",marginBottom:10,display:"flex",alignItems:"center",gap:12}}>
                      <div style={{fontSize:28}}>{condEmoji(wx.condition)}</div>
                      <div>
                        <div style={ss(8,600,"#7AAAD0",{letterSpacing:1.5,marginBottom:2})}>{wx.condition}</div>
                        <div style={{..._row,gap:10}}><span style={ss(11,600,"#A0C8E8")}>↑ {wx.tempMax}°F</span><span style={ss(11,400,"#4A6080")}>↓ {wx.tempMin}°F</span></div>
                      </div>
                    </div>}

                    <button onClick={e=>{e.stopPropagation();showToast(`Day ${day.day} confirmed ✦`);}} style={{width:"100%",padding:"10px",borderRadius:12,background:`linear-gradient(135deg,${G},#8A6E54)`,border:"none",...ss(9,600,BK,{letterSpacing:1}),cursor:_p}}>CONFIRM LOOK</button>
                  </div>
                )}
              </div>
            );
          })}
          {vacation.days_plan.length>0&&(
            <button onClick={async()=>{
              showToast("Regenerating itinerary… ✦");
              const days=await generateItinerary(vacation);
              const updated={...vacation,days_plan:days};
              await updateVacation(updated);
              showToast("Itinerary regenerated ✦");
            }} style={{width:"100%",padding:"11px",borderRadius:14,background:_1a,border:`1px dashed ${G}44`,...ss(9,400,G,{letterSpacing:1}),cursor:_p,marginTop:4}}>
              {aiItineraryLoading?"✦ GENERATING…":"✦ REGENERATE WITH AI"}
            </button>
          )}
        </React.Fragment>
      )}

      {/* PACKING LIST */}
      {view==="packing"&&(
        <React.Fragment>
          <div style={{background:CD,borderRadius:18,padding:"16px 18px",border:`1px solid ${BR}`,marginBottom:16}}>
            <div style={{..._btwn,marginBottom:10}}>
              <div style={ss(9,400,DM,{letterSpacing:2,textTransform:"uppercase"})}>Packing Progress</div>
              <div style={sr(16,500,G)}>{totalPacked}/{totalItems} packed</div>
            </div>
            <div style={{height:6,background:_1a,borderRadius:4,overflow:"hidden",marginBottom:6}}>
              <div style={{height:"100%",width:pct+"%",background:`linear-gradient(90deg,${G},#8A6E54)`,borderRadius:4,transition:"width 0.4s ease"}}/>
            </div>
            <div style={ss(9,400,pct===100?"#A8C4A0":DM,{letterSpacing:1})}>{pct===100?"All packed! Have a wonderful trip ✦":pct+"% complete"}</div>
          </div>

          {packingItems.length>0&&(
            <div style={{background:CD,borderRadius:18,padding:"16px 18px",border:`1px solid ${BR}`,marginBottom:12}}>
              <div style={{..._btwn,marginBottom:14}}>
                <Lbl>CLOTHING FROM YOUR CLOSET</Lbl>
                <div style={ss(9,400,DM)}>{packingItems.filter(it=>packed[it.id]).length}/{packingItems.length}</div>
              </div>
              {packingItems.map(it=>(
                <div key={it.id} onClick={()=>togglePacked(it.id)} style={{display:"flex",gap:12,alignItems:"center",marginBottom:10,cursor:_p,opacity:packed[it.id]?0.5:1,transition:"opacity 0.2s"}}>
                  <ItemThumb item={it} size={36} r={10}/>
                  <div style={{flex:1}}>
                    <div style={sr(13,500,packed[it.id]?"#3A3028":undefined,{textDecoration:packed[it.id]?"line-through":"none"})}>{it.name}</div>
                    <div style={ss(9,400,DM,{letterSpacing:1})}>{it.brand} · {it.category}</div>
                  </div>
                  <div style={{width:22,height:22,borderRadius:6,background:packed[it.id]?G:"#1A1A1A",border:`1.5px solid ${packed[it.id]?G:"#3A3028"}`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,...ss(11,700,BK)}}>{packed[it.id]?"✓":""}</div>
                </div>
              ))}
            </div>
          )}

          {packingItems.length===0&&(
            <div style={{background:CD,borderRadius:18,padding:"16px 18px",border:`1px solid ${BR}`,marginBottom:12,textAlign:"center"}}>
              <div style={ss(10,400,DM,{fontStyle:"italic"})}>Add outfits to your days in the itinerary and they'll appear here.</div>
            </div>
          )}

          <div style={{background:CD,borderRadius:18,padding:"16px 18px",border:`1px solid ${BR}`,marginBottom:12}}>
            <div style={{..._btwn,marginBottom:14}}>
              <Lbl>TRAVEL ESSENTIALS</Lbl>
              <div style={ss(9,400,DM)}>{essentials.filter(e=>packed[e.id]).length}/{essentials.length}</div>
            </div>
            {essentials.map(e=>(
              <div key={e.id} onClick={()=>togglePacked(e.id)} style={{display:"flex",gap:12,alignItems:"center",marginBottom:10,cursor:_p,opacity:packed[e.id]?0.5:1,transition:"opacity 0.2s"}}>
                <div style={{width:36,height:36,borderRadius:10,background:_1a,border:_2a,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>{e.emoji}</div>
                <div style={{flex:1}}>
                  <div style={sr(13,500,packed[e.id]?"#3A3028":undefined,{textDecoration:packed[e.id]?"line-through":"none"})}>{e.name}</div>
                  <div style={ss(9,400,DM,{letterSpacing:1})}>{e.category}</div>
                </div>
                <div style={{width:22,height:22,borderRadius:6,background:packed[e.id]?G:"#1A1A1A",border:`1.5px solid ${packed[e.id]?G:"#3A3028"}`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,...ss(11,700,BK)}}>{packed[e.id]?"✓":""}</div>
              </div>
            ))}
          </div>
        </React.Fragment>
      )}

      {/* EDIT TRIP SHEET */}
      {/* DELETE CONFIRMATION SHEET */}
      {/* OUTFIT PICKER SHEET */}
      {showOutfitPicker!==null&&(()=>{
        const {di:pickerDi,slot:pickerSlot}=showOutfitPicker;
        const pickerDay=vacation.days_plan[pickerDi];
        const slotKey=pickerSlot==="evening"?"eveningOutfitIds":"dayOutfitIds";
        const slotLabel=pickerSlot==="evening"?"Evening":"Day";
        const slotColor=pickerSlot==="evening"?"#A080C8":"#80B870";
        return(
          <div onClick={()=>setShowOutfitPicker(null)} style={{..._fix,inset:0,background:"#000000BB",zIndex:200,display:"flex",alignItems:"flex-end"}}>
            <div onClick={e=>e.stopPropagation()} style={{background:"#0D0D0D",borderRadius:"24px 24px 0 0",width:"100%",maxWidth:430,margin:"0 auto",padding:"20px 20px 40px",maxHeight:"70vh",overflowY:"auto",border:`1px solid #2A2A2A`}}>
              <div style={{width:36,height:4,borderRadius:2,background:"#333",margin:"0 auto 16px"}}/>
              <div style={{..._row,gap:8,marginBottom:14}}>
                <div style={sr(18,400)}>Day {pickerDay?.day}</div>
                <div style={{background:pickerSlot==="evening"?"#2A1A3A":"#2A3A20",borderRadius:6,padding:"2px 8px",...ss(8,700,slotColor,{letterSpacing:1.2})}}>{slotLabel.toUpperCase()}</div>
              </div>
              <div style={{..._row,gap:8,background:"#141414",borderRadius:10,padding:"8px 12px",marginBottom:12,border:"1px solid #2A2A2A"}}>
                <span style={{fontSize:12,opacity:0.4}}>🔍</span>
                <input value={outfitSearch} onChange={e=>setOutfitSearch(e.target.value)} placeholder="Search your items…" style={{flex:1,background:"none",border:"none",outline:"none",...ss(11,400,MD),color:"#C0B8B0"}}/>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
                {(()=>{
                  // Build a map: itemId → [day numbers it appears on across whole trip]
                  const wornOnDays={};
                  vacation.days_plan.forEach(d=>{
                    [...(d.dayOutfitIds||d.outfitIds||[]),...(d.eveningOutfitIds||[])].forEach(id=>{
                      if(!wornOnDays[id]) wornOnDays[id]=[];
                      if(!wornOnDays[id].includes(d.day)) wornOnDays[id].push(d.day);
                    });
                  });
                  return items.filter(it=>{
                    const q=outfitSearch.toLowerCase();
                    return !q||it.name.toLowerCase().includes(q)||it.brand.toLowerCase().includes(q)||(it.category||"").toLowerCase().includes(q);
                  }).map(it=>{
                    const currentSlotIds=pickerDay?.[slotKey]||(slotKey==="dayOutfitIds"?pickerDay?.outfitIds||[]:[])||[];
                    const inThisSlot=currentSlotIds.includes(it.id);
                    const wornDays=(wornOnDays[it.id]||[]).filter(d=>d!==pickerDay?.day);
                    return(
                      <div key={it.id} onClick={()=>{
                        if(inThisSlot) return;
                        const updated={...vacation,days_plan:vacation.days_plan.map((d,i)=>i===pickerDi?{...d,[slotKey]:[...currentSlotIds,it.id]}:d)};
                        updateVacation(updated);
                        showToast(`${it.name} added to ${slotLabel} ✦`);
                      }} style={{background:inThisSlot?`${G}18`:"#111",borderRadius:12,overflow:"hidden",border:inThisSlot?`1.5px solid ${G}44`:"1px solid #2A2A2A",cursor:inThisSlot?"default":_p}}>
                        <div style={{height:80,background:`${it.color||"#2A2A2A"}18`,display:"flex",alignItems:"center",justifyContent:"center",position:"relative"}}>
                          {it.sourceImage?<img src={it.sourceImage} style={{width:"100%",height:"100%",objectFit:"contain",padding:4,boxSizing:"border-box"}} alt={it.name}/>:<ItemIllustration item={it} size={56}/>}
                          {inThisSlot&&<div style={{position:"absolute",inset:0,background:"#00000066",display:"flex",alignItems:"center",justifyContent:"center",...ss(18,600,G)}}>✓</div>}
                          {!inThisSlot&&wornDays.length>0&&(
                            <div style={{position:"absolute",bottom:4,left:0,right:0,display:"flex",justifyContent:"center",gap:2,flexWrap:"wrap",padding:"0 4px"}}>
                              {wornDays.slice(0,3).map(d=>(
                                <div key={d} style={{background:"#000000AA",borderRadius:4,padding:"1px 4px",...ss(7,600,"#C4A882",{letterSpacing:0.3})}}>Day {d}</div>
                              ))}
                              {wornDays.length>3&&<div style={{background:"#000000AA",borderRadius:4,padding:"1px 4px",...ss(7,600,"#C4A882")}}>+{wornDays.length-3}</div>}
                            </div>
                          )}
                        </div>
                        <div style={{padding:"6px 8px 8px"}}>
                          <div style={ss(9,500,MD,{overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis"})}>{it.name}</div>
                          <div style={ss(8,400,DM)}>{it.brand}</div>
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
              <button onClick={()=>setShowOutfitPicker(null)} style={{width:"100%",marginTop:16,padding:"13px",borderRadius:14,background:`linear-gradient(135deg,${G},#8A6E54)`,border:"none",...ss(10,700,BK,{letterSpacing:1.5}),cursor:_p}}>DONE</button>
            </div>
          </div>
        );
      })()}

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
            <div style={ss(7,400,DM,{letterSpacing:1,marginTop:2})}>{l}</div>
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
              style={{aspectRatio:"1",borderRadius:10,background:isSelected?`${G}22`:isToday?"#1E1A12":hasWorn?"#161412":"#111",border:isSelected?`1px solid ${G}`:isToday?`1px solid ${G}44`:hasWorn?"1px solid #2A2418":"1px solid #1A1A1A",cursor:hasWorn||isToday?"pointer":"default",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:2,padding:2,position:"relative",transition:"all 0.15s"}}>
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
        <div style={{background:CD,borderRadius:18,border:`1px solid ${G}33`,padding:"16px 18px",marginBottom:12,animation:"fadeDown 0.2s ease forwards"}}>
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
                style={{background:"#111",borderRadius:14,padding:"12px 14px",marginBottom:8,border:`1px solid ${BR}`,cursor:_p,position:"relative",overflow:"hidden"}}>
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
                  style={{background:CD,borderRadius:14,padding:"11px 13px",marginBottom:8,border:`1px solid ${BR}`,display:"flex",gap:12,alignItems:"center",cursor:_p}}>
                  <div style={{textAlign:"center",flexShrink:0,minWidth:38}}>
                    <div style={ss(8,700,G)}>{entry.dateObj.toLocaleDateString("en-US",{month:"short"}).toUpperCase()}</div>
                    <div style={sr(19,500,G,{lineHeight:1.1})}>{entry.dateObj.getDate()}</div>
                    <div style={ss(7,400,DM)}>{entry.dateObj.toLocaleDateString("en-US",{weekday:"short"}).toUpperCase()}</div>
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
                  <div style={{background:accentCol+"33",borderRadius:8,padding:"3px 8px",flexShrink:0,...ss(7,600,accentCol,{letterSpacing:0.5})}}>{entry.outfit.occasion}</div>
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
                      <div style={ss(7,400,DM,{letterSpacing:1,marginTop:2})}>{l}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{padding:"0 20px"}}>
                {outfitItems.map(item=>(
                  <div key={item.id} style={{background:CD,borderRadius:16,marginBottom:10,border:`1px solid ${BR}`,overflow:"hidden"}}>
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
function CalendarTab({outfits,items,showToast,logWear,events,setEvents,session}){
  const [sel,setSel]=useState(null);
  const [view,setView]=useState("events");
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

  const processFeedback=async(outfitId,rating,text,outfitName)=>{
    if(!text.trim()&&!rating) return;
    setFeedbackProcessing(true);
    try{
      const profileSummary=JSON.stringify({
        aesthetic:styleProfile.aesthetic,
        occasions:styleProfile.occasions,
        fitPref:styleProfile.fitPref,
        avoidPairings:styleProfile.avoidPairings,
        colorPalette:styleProfile.colorPalette,
        styleIcons:styleProfile.styleIcons,
        learnedLoves:styleProfile.learnedLoves||[],
        learnedDislikes:styleProfile.learnedDislikes||[],
      });
      const prompt=`You are a personal stylist AI. A user rated an outfit suggestion.

Outfit: "${outfitName}"
Rating: ${rating==="up"?"👍 Thumbs Up":"👎 Thumbs Down"}
User explanation: "${text||"No explanation given"}"

Current style profile:
${profileSummary}

Based on this feedback, update the user's style profile. Extract specific learnings — e.g. if they thumbs-downed and said "too formal", add "avoids overly formal looks" to learnedDislikes. If they thumbs-upped and said "love the layering", add "enjoys layered outfits" to learnedLoves.

Return ONLY valid JSON with these fields (keep existing values, only ADD new learnings, max 10 items each array):
{"learnedLoves":[],"learnedDislikes":[],"avoidPairings":[]}`;

      const raw=await callClaude(prompt);
      const updates=JSON.parse(raw.replace(/```json|```/g,"").trim());
      const merged={
        learnedLoves:[...new Set([...(styleProfile.learnedLoves||[]),...(updates.learnedLoves||[])])].slice(-10),
        learnedDislikes:[...new Set([...(styleProfile.learnedDislikes||[]),...(updates.learnedDislikes||[])])].slice(-10),
        avoidPairings:[...new Set([...(styleProfile.avoidPairings||[]),...(updates.avoidPairings||[])])].slice(-10),
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
        console.log("saveEventToDB OK:",res.status,body.slice(0,100));
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
          <button key={k} className="pb" onClick={()=>setView(k)} style={{flex:1,padding:"10px 6px",borderRadius:14,background:view===k?G:"#1A1A1A",border:view===k?"none":"1px solid #222",display:"flex",alignItems:"center",justifyContent:"center",gap:5,...ss(9,view===k?600:400,view===k?BK:DM,{letterSpacing:0.8})}}>
            <span style={{fontSize:13}}>{ic}</span>{l}
          </button>
        ))}
      </div>

      {/* EVENTS VIEW */}
      {view==="events"&&(
        <React.Fragment>
          <button className="sb" onClick={()=>setShowAddEvent(true)} style={{width:"100%",padding:"14px",borderRadius:14,background:CD,border:`1.5px dashed ${G}44`,display:"flex",alignItems:"center",justifyContent:"center",gap:8,marginBottom:16,...ss(10,600,G,{letterSpacing:1.5}),cursor:_p}}>
            <span style={{fontSize:16}}>+</span> ADD UPCOMING EVENT
          </button>

          <div style={{background:"linear-gradient(135deg,#1A160F,#1E1A12)",borderRadius:18,padding:"16px 18px",border:"1px solid #2A2418",marginBottom:18}}>
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
              <div key={ev.id} className="ch" onClick={()=>setSel(open?null:ev)} style={{background:CD,borderRadius:18,padding:"16px 18px",marginBottom:12,border:`1px solid ${open?"#C4A88266":BR}`}}>
                <div style={{display:"flex",gap:12,alignItems:"center",marginBottom:open?12:0}}>
                  {/* Calendar date badge */}
                  <div style={{width:44,flexShrink:0,borderRadius:10,overflow:"hidden",border:`1px solid ${G}55`,boxShadow:`0 0 8px ${G}22`}}>
                    <div style={{background:G,padding:"3px 0",textAlign:"center"}}>
                      <div style={{fontFamily:"Montserrat,sans-serif",fontSize:9,fontWeight:700,color:BK,letterSpacing:1}}>{mon||"EVT"}</div>
                    </div>
                    <div style={{background:"#0D0D0D",padding:"4px 0",textAlign:"center"}}>
                      <div style={{fontFamily:"Montserrat,sans-serif",fontSize:18,fontWeight:700,color:G,lineHeight:1}}>{day||"—"}</div>
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
                          <div style={{borderRadius:14,overflow:"hidden",marginBottom:12,border:`1px solid ${BR}`}}>
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
                <div style={{background:"#0F1A0F",borderRadius:14,padding:"14px 16px",border:"1px solid #2A4A2A",marginBottom:16,display:"flex",gap:10,alignItems:"center"}}>
                  <span style={{fontSize:18}}>✓</span>
                  <span style={ss(11,500,"#A8C4A0",{letterSpacing:0.5})}>Outfit saved for this event</span>
                  <button onClick={()=>setPlanningEvent(null)} style={{marginLeft:"auto",padding:"5px 14px",borderRadius:20,background:`linear-gradient(135deg,${G},#8A6E54)`,border:"none",...ss(9,600,BK),cursor:_p}}>DONE</button>
                </div>
              )}

              {/* AI Generate */}
              <button onClick={generateAIOutfit} disabled={aiLoading} style={{width:"100%",padding:"12px 16px",borderRadius:14,background:aiLoading?_1a:`linear-gradient(135deg,${G},#A08060,#C4A882)`,border:"none",display:"flex",alignItems:"center",justifyContent:"center",gap:8,cursor:aiLoading?"default":_p,marginBottom:16,opacity:aiLoading?0.7:1}}>
                <span style={{fontSize:15,animation:aiLoading?"spin 1s linear infinite":undefined}}>✦</span>
                <div style={ss(10,700,aiLoading?MD:BK,{letterSpacing:1.5})}>{aiLoading?"GENERATING LOOKS…":"AI SUGGEST OUTFITS FOR THIS EVENT"}</div>
              </button>

              {/* AI suggestions */}
              {aiOutfits.length>0&&(
                <div style={{marginBottom:20}}>
                  <div style={ss(9,600,DM,{letterSpacing:1.5,marginBottom:10})}>AI SUGGESTIONS</div>
                  {aiOutfits.map(o=>{
                    const oItems=o.items.map(id=>items.find(i=>i.id===id)).filter(Boolean);
                    return(
                      <div key={o.id} style={{background:CD,borderRadius:16,padding:"14px",border:`1px solid ${BR}`,marginBottom:10}}>
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
                            }} style={{padding:"6px 14px",borderRadius:20,background:thumbsFeedback[o.id]==="up"?"#1A2A1A":"#111",border:thumbsFeedback[o.id]==="up"?"1px solid #2A4A2A":"1px solid #2A2A2A",cursor:_p,...ss(13,400,thumbsFeedback[o.id]==="up"?"#80C880":DM)}}>👍</button>
                            <button onClick={()=>{
                              const newRating=thumbsFeedback[o.id]==="down"?null:"down";
                              setThumbsFeedback(p=>({...p,[o.id]:newRating}));
                              if(newRating) setFeedbackOpen(o.id);
                              setFeedbackText("");
                            }} style={{padding:"6px 14px",borderRadius:20,background:thumbsFeedback[o.id]==="down"?"#2A1A1A":"#111",border:thumbsFeedback[o.id]==="down"?"1px solid #4A2A2A":"1px solid #2A2A2A",cursor:_p,...ss(13,400,thumbsFeedback[o.id]==="down"?"#C08080":DM)}}>👎</button>
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
                                <button onClick={()=>{setFeedbackOpen(null);setFeedbackText("");}} style={{flex:1,padding:"8px",borderRadius:10,background:"#1A1A1A",border:"1px solid #2A2A2A",...ss(9,600,DM,{letterSpacing:0.8}),cursor:_p}}>SKIP</button>
                                <button onClick={()=>processFeedback(o.id,thumbsFeedback[o.id],feedbackText,o.name)} disabled={feedbackProcessing} style={{flex:2,padding:"8px",borderRadius:10,background:feedbackProcessing?"#1A1A1A":`linear-gradient(135deg,${G},#8A6E54)`,border:"none",...ss(9,700,feedbackProcessing?DM:BK,{letterSpacing:0.8}),cursor:_p,opacity:feedbackProcessing?0.6:1}}>
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
              <div style={{..._row,gap:8,background:"#0D0D0D",border:`1px solid #2A2A2A`,borderRadius:10,padding:"8px 12px",marginBottom:12}}>
                <span style={{fontSize:12,opacity:0.4}}>🔍</span>
                <input value={outfitSearch} onChange={e=>setOutfitSearch(e.target.value)} placeholder="Search your saved outfits…"
                  style={{flex:1,background:"none",border:"none",outline:"none",...ss(11,400,MD),color:"#C0B8B0"}}/>
                {outfitSearch&&<button onClick={()=>setOutfitSearch("")} style={{background:"none",border:"none",cursor:_p,...ss(12,400,DM)}}>✕</button>}
              </div>

              {filteredOutfits.length===0&&<div style={sr(12,300,"#3A3028",{fontStyle:"italic",textAlign:"center",padding:"16px 0"})}>No saved outfits yet — use AI above to generate one</div>}
              {filteredOutfits.map(o=>{
                const oItems=(o.items||[]).map(id=>items.find(i=>i.id===id)).filter(Boolean);
                return(
                  <div key={o.id} style={{background:CD,borderRadius:14,padding:"12px 14px",border:`1px solid ${BR}`,marginBottom:8,display:"flex",gap:12,alignItems:"center"}}>
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
    if(items.length<2) return;
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

  useEffect(()=>{ if(items.length>=2&&aiGroups===null&&!aiLoading) loadAiDupes(); },[items.length]);

  const displayGroups=(aiGroups||fallbackGroups).filter(g=>!dismissed.has(g.id));
  const usingAI=aiGroups!==null&&!aiError;

  return(
    <div>
      <div style={{..._btwn,marginBottom:14}}>
        <div style={ss(8,600,DM,{letterSpacing:1.5})}>DUPLICATE ANALYSIS</div>
        <div style={{..._row,gap:6}}>
          {aiLoading&&<div style={{fontSize:12,animation:"spin 1.5s linear infinite",display:"inline-block",color:G}}>✦</div>}
          <div style={{background:usingAI?"#0A1A0A":"#1A1A0A",border:`1px solid ${usingAI?"#2A4A2A":"#2A2A14"}`,borderRadius:20,padding:"3px 10px",...ss(7,600,usingAI?"#60A870":"#A08040",{letterSpacing:0.8})}}>
            {aiLoading?"AI SCANNING…":usingAI?"✦ AI POWERED":"KEYWORD MODE"}
          </div>
          {!aiLoading&&<button onClick={loadAiDupes} style={{background:"none",border:"none",cursor:_p,...ss(10,400,DM)}}>↺</button>}
        </div>
      </div>
      {aiError&&<div style={{...ss(9,400,"#A08060",{marginBottom:12,padding:"8px 12px",background:"#1A1408",borderRadius:10,border:"1px solid #2A2010"})}}>{aiError}</div>}
      {displayGroups.map(group=>(
        <div key={group.id} style={{background:CD,borderRadius:16,padding:"16px",marginBottom:12,border:`1px solid ${BR}`}}>
          <div style={{..._btwnS,marginBottom:12}}>
            <div style={{flex:1}}>
              <div style={{..._row,gap:6,marginBottom:4}}>
                <div style={ss(8,700,"#C4A060",{letterSpacing:1})}>{group.similarity}% SIMILAR</div>
                {group.source==="ai"&&<div style={{background:"#0A1A0A",border:"1px solid #1A3A1A",borderRadius:10,padding:"1px 6px",...ss(7,600,"#60A870",{letterSpacing:0.5})}}>AI</div>}
              </div>
              <div style={sr(15,500)}>{group.label}</div>
            </div>
            <button onClick={()=>setDismissed(d=>new Set([...d,group.id]))} style={{width:28,height:28,borderRadius:"50%",background:_1a,border:_2a,...ss(11,400,DM),display:"flex",alignItems:"center",justifyContent:"center",cursor:_p,flexShrink:0}}>✕</button>
          </div>
          <div style={{display:"flex",gap:10,marginBottom:12,overflowX:"auto"}}>
            {group.items.map(item=>(
              <div key={item.id} style={{flex:1,minWidth:80,background:"#111",borderRadius:12,padding:"10px",textAlign:"center"}}>
                <div style={{width:52,height:52,borderRadius:10,background:`${item.color||G}22`,margin:"0 auto 8px",display:"flex",alignItems:"center",justifyContent:"center",border:_2a,overflow:"hidden"}}>
                  {item.sourceImage
                    ?<img src={item.sourceImage} style={{width:"100%",height:"100%",objectFit:"contain",padding:4,boxSizing:"border-box"}} alt={item.name}/>
                    :<ItemIllustration item={item} size={40}/>}
                </div>
                <div style={sr(11,500,undefined,{lineHeight:1.3,marginBottom:2})}>{item.name}</div>
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
          {!usingAI&&<button onClick={loadAiDupes} style={{marginTop:16,padding:"9px 22px",borderRadius:20,background:`${G}22`,border:`1px solid ${G}44`,...ss(9,600,G,{letterSpacing:1}),cursor:_p}}>\u2746 RUN AI ANALYSIS</button>}
        </div>
      )}
      {aiLoading&&(
        <div style={{textAlign:"center",padding:"40px 0"}}>
          <div style={{fontSize:32,marginBottom:12,animation:"spin 1.5s linear infinite",display:"inline-block"}}>✦</div>
          <div style={ss(11,400,MD,{letterSpacing:1})}>AI is analyzing your wardrobe…</div>
          <div style={ss(9,400,DM,{marginTop:6})}>Checking style subcategories, color families & occasion overlap</div>
        </div>
      )}
    </div>
  );
}

function StatsTab({items, outfits, showToast, logWear}){
  const [section,setSection]=useState("overview"); // overview | dupes | valuation | history
  const total=items.reduce((s,i)=>s+i.price,0);
  const top=[...items].sort((a,b)=>b.wearCount-a.wearCount).slice(0,3);
  const neglected=items.filter(i=>i.wearCount<4);

  const subTabs=[["overview","Overview"],["dupes","Duplicates"],["history","Worn History"]];

  return(
    <div className="fu" style={{padding:"16px 24px"}}>
      <div style={{marginBottom:16}}>
        <div style={sr(22,300)}>Stats</div>
        <div style={ss(10,400,DM,{letterSpacing:1,marginTop:2})}>WARDROBE INTELLIGENCE</div>
      </div>

      {/* Sub-tab strip */}
      <div style={{display:"flex",background:"#111",borderRadius:14,overflow:"hidden",border:"1px solid #1E1E1E",marginBottom:20,flexShrink:0}}>
        {subTabs.map(([k,l])=>(
          <button key={k} onClick={()=>setSection(k)} style={{flex:1,padding:"9px 4px",background:section===k?`linear-gradient(135deg,${G},#8A6E54)`:"transparent",border:"none",cursor:_p,...ss(8,section===k?600:400,section===k?BK:DM,{letterSpacing:0.5,whiteSpace:"nowrap"})}}>
            {l}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW ── */}
      {section==="overview"&&(
        <React.Fragment>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:16}}>
            {[["$"+total.toLocaleString(),"Total Value","#C4A882"],[items.reduce((s,i)=>s+i.wearCount,0),"Total Wears","#A0B8C4"],[neglected.length,"Underused","#C4A0A0"]].map(([v,l,c])=>(
              <div key={l} style={{background:CD,borderRadius:16,padding:"14px 12px",border:`1px solid ${BR}`}}>
                <div style={sr(22,500,c)}>{v}</div>
                <div style={ss(8,400,DM,{letterSpacing:1,marginTop:4,textTransform:"uppercase"})}>{l}</div>
              </div>
            ))}
          </div>


          <div style={{background:CD,borderRadius:18,padding:"18px",border:`1px solid ${BR}`,marginBottom:14}}>
            <Lbl>MOST WORN</Lbl>
            {top.map((item,i)=>(
              <div key={item.id} style={{..._row,gap:12,marginBottom:i<2?12:0,paddingBottom:i<2?12:0,borderBottom:i<2?`1px solid ${BR}`:"none"}}>
                <ItemThumb item={item} size={48} r={12}/>
                <div style={{flex:1}}>
                  <div style={sr(14,500)}>{item.name}</div>
                  <div style={ss(9,400,DM,{letterSpacing:1})}>{item.wearCount} wears · {item.brand}</div>
                </div>
                <div style={{background:"#1E1E1E",borderRadius:20,padding:"4px 10px",...ss(9,600,"#A8C4A0",{letterSpacing:1})}}>#{i+1}</div>
              </div>
            ))}
          </div>

          <div style={{background:CD,borderRadius:18,padding:"18px",border:"1px solid #2A1818"}}>
            <Lbl>RARELY WORN — CONSIDER SELLING</Lbl>
            {neglected.map(item=>(
              <div key={item.id} style={{..._row,gap:12,marginBottom:10}}>
                <ItemThumb item={item} size={44} r={10}/>
                <div style={{flex:1}}>
                  <div style={sr(13,500)}>{item.name}</div>
                  <div style={ss(9,400,DM,{letterSpacing:1})}>{item.wearCount} wears · Last: {item.lastWorn}</div>
                </div>
              </div>
            ))}
          </div>
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
const initNotifications = [
  { id:1, type:"sale",     read:false, time:"2m ago",  icon:"🏷️", title:"Your item sold!",            body:"Someone just bought your Mini Leather Skirt for $55. Payment is on its way." },
  { id:2, type:"wishlist", read:false, time:"2h ago",  icon:"✦",  title:"Wishlist match found!",      body:"Chelsea Boots by Sezane just listed in the Market by @the.closet.co — size 38, $185." },
  { id:3, type:"ai",       read:true,  time:"1d ago",  icon:"✧",  title:"Wardrobe insight",           body:"Your most-worn item has a cost-per-wear under $2. Keep it up." },
];

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
              <div key={plan.id} style={{background:`linear-gradient(135deg,${plan.color},${plan.color}88)`,borderRadius:18,padding:"14px 16px",border:`1.5px solid ${isCurrent?plan.accent:"#2A2A2A"}`,position:"relative",overflow:"hidden"}}>
                {/* Glow */}
                <div style={{position:"absolute",top:-30,right:-30,width:100,height:100,borderRadius:"50%",background:`radial-gradient(circle,${plan.accent}15,transparent)`}} />

                {plan.badge&&(
                  <div style={{position:"absolute",top:12,right:12,background:`linear-gradient(135deg,${G},#8A6E54)`,borderRadius:20,padding:"3px 10px",...ss(7,700,BK,{letterSpacing:1.5})}}>{plan.badge}</div>
                )}
                {isCurrent&&(
                  <div style={{position:"absolute",top:12,right:12,background:"#1A2A1A",borderRadius:20,padding:"3px 10px",...ss(7,600,"#A8C4A0",{letterSpacing:1})}}>CURRENT PLAN</div>
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
                        <div style={ss(7,400,DM,{letterSpacing:0.8})}>{billing==="annual"&&perMonth?"/mo billed annually":"/month"}</div>
                        {billing==="annual"&&<div style={ss(7,600,"#4A6A3A",{marginTop:1})}>${price}/yr · save {saving(plan)}%</div>}
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
          <div style={{background:"linear-gradient(135deg,#1A1A2E,#16213E)",borderRadius:18,padding:"18px",border:"1px solid #2A2A4A"}}>
            <div style={{display:"flex",gap:10,alignItems:"center",marginBottom:10}}>
              <div style={{fontSize:22}}>◆</div>
              <div style={sr(15,500,"#A0B0D4")}>Personal Shopper Marketplace</div>
            </div>
            <div style={ss(10,400,DM,{lineHeight:1.6,marginBottom:12})}>
              Book vetted personal shoppers per session — no subscription required. Shoppers set their own rates. Outfix takes a 22% platform fee.
            </div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              {["From $60/session","Pay per booking","All skill levels","Verified reviews"].map(t=>(
                <div key={t} style={{background:"#1A1A3A",borderRadius:20,padding:"5px 12px",...ss(9,400,"#7A90C4",{letterSpacing:0.5})}}>✦ {t}</div>
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

// ── STYLIST CHAT ──────────────────────────────────────────────────────────────
function ShopperChat({stylist,onBack,chats,setChats}){
  const [msg,setMsg]=useState("");
  const replies=["Love that idea! Let me pull some options.","Great taste! That pairs beautifully with your neutral base.","I will send curated picks from the Market shortly.","I can arrange a full closet audit session for next week if you would like."];
  const msgs=chats[stylist.id]||[];

  const send=()=>{
    if(!msg.trim()) return;
    const t=new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});
    setChats(p=>({...p,[stylist.id]:[...(p[stylist.id]||[]),{from:"user",text:msg.trim(),time:t}]}));
    setMsg("");
    setTimeout(()=>{
      const r={from:"stylist",text:replies[Math.floor(Math.random()*replies.length)],time:new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})};
      setChats(p=>({...p,[stylist.id]:[...(p[stylist.id]||[]),r]}));
    },1400);
  };

  return(
    <div className="fu" style={{..._col,height:"calc(100vh - 190px)"}}>
      <div style={{padding:"14px 20px",borderBottom:`1px solid ${BR}`,display:"flex",gap:12,alignItems:"center",flexShrink:0}}>
        <button className="tb" onClick={onBack} style={{fontSize:18,color:MD}}>←</button>
        <div style={{fontSize:28}}>{stylist.avatar}</div>
        <div style={{flex:1}}>
          <div style={sr(15,500)}>{stylist.name}</div>
          <div style={ss(9,400,"#4CAF50",{letterSpacing:1})}>● ONLINE</div>
        </div>
        <div style={{textAlign:"right"}}>
          <div style={sr(13,400,G)}>{stylist.sessionRate}</div>
          <div style={ss(8,400,DM)}>per session</div>
        </div>
      </div>
      <div className="sc" style={{flex:1,padding:"16px 20px",display:"flex",flexDirection:"column",gap:10}}>
        {msgs.map((m,i)=>(
          <div key={i} style={{display:"flex",justifyContent:m.from==="user"?"flex-end":"flex-start"}}>
            <div style={{maxWidth:"78%",background:m.from==="user"?`linear-gradient(135deg,${G},#8A6E54)`:"#1E1E1E",borderRadius:m.from==="user"?"18px 18px 4px 18px":"18px 18px 18px 4px",padding:"10px 14px"}}>
              <div style={ss(12,400,m.from==="user"?BK:"#D0C8C0",{lineHeight:1.5})}>{m.text}</div>
              <div style={ss(8,400,m.from==="user"?"#0D0D0D88":DM,{marginTop:4})}>{m.time}</div>
            </div>
          </div>
        ))}
      </div>
      <div style={{padding:"12px 16px",borderTop:`1px solid ${BR}`,display:"flex",gap:10,flexShrink:0}}>
        <input value={msg} onChange={e=>setMsg(e.target.value)} onKeyDown={e=>e.key==="Enter"&&send()} placeholder="Message your shopper…"
          style={{flex:1,background:_1a,border:_2a,borderRadius:24,padding:"10px 16px",...ss(12,400,MD),color:"#C0B8B0"}} />
        <button className="sb" onClick={send} style={{width:44,height:44,borderRadius:"50%",background:`linear-gradient(135deg,${G},#8A6E54)`,border:"none",cursor:_p,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",...ss(18,400,BK)}}>↑</button>
      </div>
    </div>
  );
}

// ── SHOPPER BOOKING MODAL ─────────────────────────────────────────────────────
function BookingModal({stylist,onClose,onConfirm}){
  const [session,setSession]=useState(null);
  const [selDay,setSelDay]=useState(null);
  const [selTime,setSelTime]=useState(null);

  const sessions=[
    {id:"closet",label:"Closet Audit",desc:"Full review of your wardrobe with written recommendations",duration:"60 min",price:stylist.sessionRates.closet},
    {id:"outfit",label:"Outfit Planning",desc:"Build 5 curated outfits from your existing closet",duration:"45 min",price:stylist.sessionRates.outfit},
    {id:"shop",label:"Personal Shopping",desc:"Your shopper sources new pieces to fill your wardrobe gaps",duration:"90 min",price:stylist.sessionRates.shop},
    {id:"video",label:"Video Consultation",desc:"Live 1-on-1 call with screen-share of your closet",duration:"30 min",price:stylist.sessionRates.video},
  ];

  // Build 14-day calendar from today
  const today = new Date(2026,2,10); // March 10 2026
  const days = Array.from({length:14},(_,i)=>{
    const d = new Date(today); d.setDate(today.getDate()+i);
    return d;
  });
  const dayNames=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const monthNames=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  // Mock availability — shopper unavailable on Sundays + a few random days
  const unavailDates = new Set([10,12,17]); // day-of-month unavailable
  const isAvail = d => d.getDay()!==0 && !unavailDates.has(d.getDate());

  // Time slots
  const allSlots=["9:00 AM","10:30 AM","12:00 PM","2:00 PM","3:30 PM","5:00 PM"];
  // Mock some slots as taken per day
  const takenSlots = {11:["9:00 AM","2:00 PM"],13:["10:30 AM","3:30 PM"],14:["12:00 PM","5:00 PM"],15:["9:00 AM"],16:["10:30 AM","5:00 PM"],18:["12:00 PM","2:00 PM"],19:["9:00 AM","3:30 PM"],20:["10:30 AM"],21:["2:00 PM","5:00 PM"],22:["9:00 AM","12:00 PM"],23:["3:30 PM"]};
  const slotsForDay = d => allSlots.filter(t => !(takenSlots[d.getDate()]||[]).includes(t));

  const sel=sessions.find(s=>s.id===session);
  const outfixFee=sel?Math.round(sel.price*0.22):0;
  const canConfirm = sel && selDay && selTime;

  // Current calendar month label
  const calMonth = selDay
    ? `${monthNames[selDay.getMonth()]} ${selDay.getFullYear()}`
    : `${monthNames[today.getMonth()]} ${today.getFullYear()}`;

  return(
    <div style={{position:"fixed",top:0,bottom:0,left:"50%",transform:"translateX(-50%)",width:"100%",maxWidth:430,background:"#0D0D0D",zIndex:110,display:"flex",flexDirection:"column"}}>
      {/* Pinned header */}
      <div style={{flexShrink:0,padding:"16px 24px 12px",borderBottom:`1px solid ${BR}`,display:"flex",gap:14,alignItems:"center"}}>
        <div style={{fontSize:32}}>{stylist.avatar}</div>
        <div style={{flex:1}}>
          <div style={sr(18,500)}>{stylist.name}</div>
          <div style={ss(9,400,DM,{letterSpacing:1})}>{stylist.specialty}</div>
          <div style={ss(9,400,MD,{marginTop:2})}>★ {stylist.rating} · {stylist.clients} sessions completed</div>
        </div>
        <button onClick={onClose} style={{background:"none",border:"none",cursor:_p,fontSize:22,color:DM,lineHeight:1,padding:"4px 8px"}}>×</button>
      </div>
      {/* Scrollable body */}
      <div className="sc" style={{flex:1,overflowY:"auto",padding:"20px 24px 40px"}}>

        {/* Session type */}
        <Lbl>CHOOSE A SESSION TYPE</Lbl>
        <div style={{..._col,gap:10,marginBottom:20}}>
          {sessions.map(s=>(
            <div key={s.id} className="ch" onClick={()=>{setSession(s.id);setSelDay(null);setSelTime(null);}}
              style={{background:session===s.id?"linear-gradient(135deg,#2A2418,#1E1A12)":CD,borderRadius:16,padding:"14px 16px",border:`1.5px solid ${session===s.id?G:BR}`}}>
              <div style={{..._btwnS,marginBottom:4}}>
                <div style={sr(15,500,session===s.id?G:undefined)}>{s.label}</div>
                <div style={sr(15,500,G)}>${s.price}</div>
              </div>
              <div style={ss(10,400,DM,{lineHeight:1.4,marginBottom:4})}>{s.desc}</div>
              <div style={ss(9,400,"#4A4038",{letterSpacing:1})}>{s.duration}</div>
            </div>
          ))}
        </div>

        {/* Calendar — only appears once session is chosen */}
        {sel&&(<React.Fragment>
          <Lbl>SELECT A DATE</Lbl>
          <div style={{background:CD,borderRadius:18,border:`1px solid ${BR}`,padding:"16px",marginBottom:16}}>

            {/* Month label */}
            <div style={{...ss(10,600,MD,{letterSpacing:2,textAlign:"center",marginBottom:14})}}>
              {calMonth.toUpperCase()}
            </div>

            {/* Day-of-week header */}
            <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",marginBottom:8}}>
              {dayNames.map(d=>(
                <div key={d} style={{textAlign:"center",...ss(8,400,DM,{letterSpacing:0.5})}}>{d}</div>
              ))}
            </div>

            {/* Day grid — 14 days starting today, offset to correct weekday column */}
            {(()=>{
              const startDow = today.getDay(); // 0=Sun
              const cells = [];
              // Leading empty cells
              for(let i=0;i<startDow;i++) cells.push(<div key={`e${i}`}/>);
              days.forEach(d=>{
                const avail=isAvail(d);
                const isToday=d.getDate()===today.getDate();
                const picked=selDay&&d.toDateString()===selDay.toDateString();
                cells.push(
                  <div key={d.toDateString()} onClick={()=>{if(avail){setSelDay(d);setSelTime(null);}}}
                    style={{
                      textAlign:"center",padding:"7px 2px",borderRadius:10,cursor:avail?"pointer":"default",
                      background:picked?G:isToday?"#2A2010":"transparent",
                      border:isToday&&!picked?`1px solid ${G}55`:"1px solid transparent",
                      opacity:avail?1:0.28,transition:"all 0.15s",
                    }}>
                    <div style={ss(11,picked?700:400,picked?BK:avail?MD:DM)}>{d.getDate()}</div>
                    {avail&&!picked&&(
                      <div style={{width:4,height:4,borderRadius:"50%",background:G,margin:"2px auto 0",opacity:0.7}}/>
                    )}
                  </div>
                );
              });
              return <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:"2px"}}>{cells}</div>;
            })()}

            {/* Legend */}
            <div style={{display:"flex",gap:14,marginTop:12,justifyContent:"center"}}>
              {[["Available",G,true],[`Unavailable`,"#3A3028",false]].map(([label,col,dot])=>(
                <div key={label} style={{..._row,gap:5}}>
                  <div style={{width:8,height:8,borderRadius:"50%",background:col,opacity:dot?1:0.4}}/>
                  <div style={ss(8,400,DM,{letterSpacing:0.5})}>{label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Time slots — appear once a day is picked */}
          {selDay&&(()=>{
            const slots=slotsForDay(selDay);
            return(
              <div style={{marginBottom:16}}>
                <Lbl>AVAILABLE TIMES · {selDay.toLocaleDateString("en-US",{weekday:"long",month:"short",day:"numeric"}).toUpperCase()}</Lbl>
                {slots.length===0?(
                  <div style={{...ss(10,400,DM),textAlign:"center",padding:"16px 0",opacity:0.5}}>No times available — pick another day</div>
                ):(
                  <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8}}>
                    {slots.map(t=>{
                      const picked=selTime===t;
                      return(
                        <div key={t} onClick={()=>setSelTime(t)} className="ch"
                          style={{textAlign:"center",padding:"10px 6px",borderRadius:12,cursor:_p,
                            background:picked?`linear-gradient(135deg,${G},#8A6E54)`:"#1A1A1A",
                            border:`1px solid ${picked?G:BR}`,transition:"all 0.15s"}}>
                          <div style={ss(11,picked?600:400,picked?BK:MD)}>{t}</div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })()}

          {/* Booking Summary */}
          <div style={{background:_1a,borderRadius:14,padding:"14px 16px",marginBottom:16}}>
            <Lbl mb={10}>Booking Summary</Lbl>
            {[
              ["Session", sel.label],
              ["Date", selDay ? selDay.toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"}) : "—"],
              ["Time", selTime||"—"],
              [`${stylist.name}'s fee`, "$"+sel.price],
              ["Outfix fee (22%)", "$"+outfixFee],
              ["Total", "$"+(sel.price+outfixFee)],
            ].map(([k,v],i,arr)=>(
              <div key={k} style={{display:"flex",justifyContent:"space-between",marginBottom:i<arr.length-1?8:0,paddingBottom:i<arr.length-1?8:0,borderBottom:i===arr.length-2?`1px solid ${BR}`:"none"}}>
                <div style={ss(10,400,i===arr.length-1?MD:DM,{letterSpacing:0.5})}>{k}</div>
                <div style={i===arr.length-1?sr(14,600,G):ss(10,400,selDay&&i===1?MD:selTime&&i===2?MD:MD)}>{v}</div>
              </div>
            ))}
          </div>
        </React.Fragment>)}

        <div style={{display:"flex",gap:10}}>
          <Btn onClick={onClose} outline>CANCEL</Btn>
          <Btn onClick={()=>canConfirm&&onConfirm({...sel,date:selDay,time:selTime})} full>
            {!sel?"SELECT A SESSION":!selDay?"PICK A DATE":!selTime?"PICK A TIME":"CONFIRM BOOKING"}
          </Btn>
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
  const [chat,setChat]=useState(null);
  const [booking,setBooking]=useState(null);
  const [chats,setChats]=useState(initChats);

  if(chat){
    const stylist=stylistData.find(s=>s.id===chat);
    return <ShopperChat stylist={stylist} onBack={()=>setChat(null)} chats={chats} setChats={setChats} />;
  }

  const isProUser=currentPlan==="pro";

  const sessionLabels={closet:"Closet Audit",outfit:"Outfit Build",shop:"Shopping Trip",video:"Video Call"};
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

  return(
    <div className="fu" style={{padding:"0 0 24px"}}>

      {/* ── Header ── */}
      <div style={{padding:"16px 20px 12px"}}>
        <div style={sr(22,300)}>Shoppers</div>
        <div style={ss(10,400,DM,{letterSpacing:1,marginTop:2})}>VETTED STYLISTS · BOOK PER SESSION</div>
      </div>

      {/* ── Plan banner (compact) ── */}
      {!isProUser?(
        <div onClick={()=>setShowPricing(true)} style={{margin:"0 20px 16px",background:"linear-gradient(135deg,#1A1A2E,#16213E)",borderRadius:14,padding:"12px 16px",border:"1px solid #2A2A4A",display:"flex",alignItems:"center",gap:12,cursor:_p}}>
          <div style={{flex:1}}>
            <div style={ss(8,700,"#7A90C4",{letterSpacing:1.5})}>OUTFIX PRO</div>
            <div style={ss(10,400,DM,{marginTop:2})}>Upgrade to book any shopper</div>
          </div>
          <div style={{padding:"7px 14px",borderRadius:20,background:"linear-gradient(135deg,#3A4A6A,#2A3A5A)",...ss(9,600,"#C0D0F0",{letterSpacing:0.5}),cursor:_p}}>Upgrade</div>
        </div>
      ):(
        <div style={{margin:"0 20px 16px",background:"linear-gradient(135deg,#0F1A0F,#1A2A1A)",borderRadius:14,padding:"10px 16px",border:"1px solid #2A3A2A",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div style={ss(9,600,"#60A870",{letterSpacing:1})}>◆ PRO ACCESS ACTIVE</div>
          <div style={ss(9,400,"#4A6A3A")}>All shoppers unlocked ✓</div>
        </div>
      )}

      {/* ── Shopper cards ── */}
      {stylistData.map((sh,idx)=>{
        const [bgCol,accentCol]=avatarColors[idx%avatarColors.length];
        const initials=sh.name.split(" ").map(w=>w[0]).join("").slice(0,2);
        return(
          <div key={sh.id} style={{margin:"0 16px 16px",borderRadius:20,overflow:"hidden",border:`1px solid ${BR}`}}>

            {/* Card header — gradient with avatar */}
            <div style={{background:`linear-gradient(135deg,${bgCol},${bgCol}CC,#141414)`,padding:"20px 18px 16px",position:"relative"}}>
              {/* Demo banner */}
              <div style={{background:"#1A1208",border:"1px solid #3A2A10",borderRadius:8,padding:"5px 10px",marginBottom:12,textAlign:"center"}}>
                <span style={ss(8,700,"#C4A060",{letterSpacing:2})}>DEMO VERSION · COMING SOON</span>
              </div>
              {/* Availability pill */}
              <div style={{position:"absolute",top:14,right:14,background:sh.available?"#0A1A0A":"#1A1A1A",border:`1px solid ${sh.available?"#2A4A2A":"#2A2A2A"}`,borderRadius:20,padding:"3px 10px",display:"flex",alignItems:"center",gap:4}}>
                <div style={{width:6,height:6,borderRadius:"50%",background:sh.available?"#60A870":"#3A3028"}}/>
                <span style={ss(8,600,sh.available?"#60A870":"#3A3028",{letterSpacing:0.8})}>{sh.available?"AVAILABLE":"UNAVAILABLE"}</span>
              </div>

              <div style={{display:"flex",gap:14,alignItems:"center"}}>
                {/* Avatar */}
                <div style={{width:58,height:58,borderRadius:16,background:`linear-gradient(135deg,${bgCol}EE,${accentCol}44)`,border:`1.5px solid ${accentCol}44`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                  <span style={{fontSize:22}}>{sh.avatar}</span>
                </div>
                <div>
                  <div style={sr(19,500)}>{sh.name}</div>
                  <div style={ss(9,400,DM,{marginTop:2,letterSpacing:0.5})}>{sh.specialty}</div>
                  <div style={{marginTop:5}}><StarRating r={sh.rating}/></div>
                </div>
              </div>
            </div>

            {/* Card body */}
            <div style={{background:CD,padding:"14px 18px"}}>
              {/* Stats row */}
              <div style={{display:"flex",gap:16,marginBottom:12}}>
                {[["Sessions",sh.clients],[" Rate",sh.sessionRate]].map(([l,v])=>(
                  <div key={l}>
                    <div style={sr(15,500,G)}>{v}</div>
                    <div style={ss(8,400,DM,{letterSpacing:0.8,marginTop:1})}>{l.toUpperCase()}</div>
                  </div>
                ))}
              </div>

              {/* Bio */}
              <div style={ss(10,400,"#A09880",{lineHeight:1.6,marginBottom:12})}>{sh.bio}</div>

              {/* Session type chips */}
              <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:14}}>
                {Object.entries(sh.sessionRates).map(([key,price])=>(
                  <div key={key} style={{background:_1a,border:`1px solid ${BR}`,borderRadius:20,padding:"4px 10px",display:"flex",gap:4,alignItems:"center"}}>
                    <span style={ss(8,500,"#C0B8A8")}>{sessionLabels[key]}</span>
                    <span style={ss(8,400,DM)}>· ${price}</span>
                  </div>
                ))}
              </div>

              {/* Tags */}
              <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:14}}>
                {sh.tags.map(t=>(
                  <span key={t} style={{background:`${G}11`,border:`1px solid ${G}22`,borderRadius:20,padding:"3px 9px",...ss(8,400,G,{letterSpacing:0.3})}}>{t}</span>
                ))}
              </div>

              {/* Actions */}
              {sh.available?(
                <div style={{display:"flex",gap:8}}>
                  <button onClick={()=>isProUser?setChat(sh.id):setShowPricing(true)}
                    style={{flex:1,padding:"10px",borderRadius:12,background:_1a,border:_2a,...ss(9,500,MD,{letterSpacing:0.8}),cursor:_p}}>
                    💬 Message
                  </button>
                  <button onClick={()=>isProUser?setBooking(sh):setShowPricing(true)}
                    style={{flex:2,padding:"10px",borderRadius:12,background:`linear-gradient(135deg,${G},#8A6E54)`,border:"none",...ss(9,700,BK,{letterSpacing:1.5}),cursor:_p}}>
                    BOOK SESSION
                  </button>
                </div>
              ):(
                <div style={{padding:"10px",borderRadius:12,background:"#111",border:"1px solid #1E1E1E",textAlign:"center",...ss(9,400,"#3A3028",{letterSpacing:1})}}>CURRENTLY UNAVAILABLE</div>
              )}
            </div>
          </div>
        );
      })}

      {booking&&(
        <BookingModal
          stylist={booking}
          onClose={()=>setBooking(null)}
          onConfirm={(session)=>{setBooking(null);const dateStr=session.date?session.date.toLocaleDateString("en-US",{month:"short",day:"numeric"}):"";showToast(`${booking.name} booked · ${session.label}${dateStr?" · "+dateStr:""}${session.time?" · "+session.time:""} ✦`);}}
        />
      )}
    </div>
  );
}

// ── ONBOARDING FLOW ──────────────────────────────────────────────────────────
// ── PUSH NOTIFICATION PREVIEW ─────────────────────────────────────────────────
function PushNotifPreview({onClose,showToast,session,notifs,setNotifs,notifsLoaded,setNotifsLoaded}){
  const [loading,setLoading]=useState(!notifsLoaded);

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
            title:`You may know @${p.username||"someone"}`,
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
        title:`@${followerProfiles[f.follower_id]?.username||"Someone"} followed you`,
        body:"Check out their closet",
        time: getTimeAgo(f.created_at), urgent:false, _ts:new Date(f.created_at||0).getTime(),
      }));

      const allNotifs = [...likeNotifsTs, ...followNotifsTs, ...suggestNotifs]
        .sort((a,b)=> (b._ts||0) - (a._ts||0));

      setNotifs(allNotifs.length ? allNotifs : []);
    } catch(e){ console.log("notifs error",e); }
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
          {loading&&<div style={{textAlign:"center",padding:"32px 0",opacity:0.4}}><div style={{fontSize:20,animation:"spin 1s linear infinite",display:"inline-block"}}>✦</div></div>}
          {!loading&&notifs.length===0&&<div style={{textAlign:"center",padding:"40px 0",...sr(15,300,DM,{fontStyle:"italic",opacity:0.5})}}>No notifications yet</div>}
          {notifs.map(n=>{
            const col=typeColor[n.type]||G;
            const bg=typeBg[n.type]||"#141414";
            return(
              <div key={n.id} onClick={()=>markRead(n.id)}
                style={{background:n.read?"#111":bg,border:`1px solid ${n.read?"#1E1E1E":col+"44"}`,borderRadius:14,padding:"12px 14px",marginBottom:8,cursor:_p,position:"relative",opacity:n.read?0.7:1,transition:"all 0.2s"}}>
                {!n.read&&<div style={{position:"absolute",top:12,right:12,width:7,height:7,borderRadius:"50%",background:col}}/>}
                <div style={{display:"flex",gap:10,alignItems:"flex-start"}}>
                  <div style={{width:36,height:36,borderRadius:10,background:`${col}22`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:17,flexShrink:0}}>{n.icon}</div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{..._btwnS,marginBottom:4}}>
                      <div style={ss(11,n.read?400:600,n.read?MD:"#E0D8D0",{flex:1,paddingRight:8,lineHeight:1.4})}>{n.title}</div>
                      <div style={ss(9,400,DM,{flexShrink:0})}>{n.time}</div>
                    </div>
                    <div style={ss(10,400,"#8A8078",{lineHeight:1.5})}>{n.body}</div>
                  </div>
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
        <div key={title} style={{background:CD,border:`1px solid ${BR}`,borderRadius:16,padding:"14px 16px",marginBottom:10,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
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
// ── BADGE DEFINITIONS ─────────────────────────────────────────────────────────
const ALL_BADGES = [
  // Closet milestones
  { id:"closet_1",   emoji:"🧺", name:"First Piece",       desc:"Added your first closet item",         cat:"Closet",   check:(s)=>s.items>=1   },
  { id:"closet_5",   emoji:"👗", name:"Style Starter",     desc:"Added 5 items to your closet",         cat:"Closet",   check:(s)=>s.items>=5   },
  { id:"closet_10",  emoji:"🗂️", name:"Curator",           desc:"Added 10 items to your closet",        cat:"Closet",   check:(s)=>s.items>=10  },
  { id:"closet_50",  emoji:"🏛️", name:"Collector",         desc:"Built a closet of 50+ pieces",         cat:"Closet",   check:(s)=>s.items>=50  },
  { id:"closet_100", emoji:"💎", name:"Archivist",         desc:"An extraordinary closet of 100+ pieces",cat:"Closet",  check:(s)=>s.items>=100 },
  // Outfit milestones
  { id:"outfit_1",   emoji:"✦",  name:"First Look",        desc:"Created your first outfit",            cat:"Outfits",  check:(s)=>s.outfits>=1  },
  { id:"outfit_5",   emoji:"🎨", name:"Stylist",           desc:"Created 5 outfits",                    cat:"Outfits",  check:(s)=>s.outfits>=5  },
  { id:"outfit_10",  emoji:"🪡", name:"Fashion Editor",    desc:"Created 10 outfits",                   cat:"Outfits",  check:(s)=>s.outfits>=10 },
  { id:"outfit_50",  emoji:"👑", name:"Creative Director", desc:"Created an incredible 50 outfits",     cat:"Outfits",  check:(s)=>s.outfits>=50 },
  // Market
  { id:"listed_1",   emoji:"🏷️", name:"First Listing",     desc:"Listed your first item for sale",      cat:"Market",   check:(s)=>s.listed>=1  },
  { id:"sold_1",     emoji:"💰", name:"First Sale",        desc:"Made your first sale on Outfix",       cat:"Market",   check:(s)=>s.sold>=1    },
  { id:"sold_10",    emoji:"🌟", name:"Power Seller",      desc:"Completed 10 sales",                   cat:"Market",   check:(s)=>s.sold>=10   },
  // Social / followers
  { id:"follow_10",  emoji:"🌱", name:"Rising",            desc:"Reached 10 followers",                 cat:"Social",   check:(s)=>s.followers>=10  },
  { id:"follow_50",  emoji:"🔥", name:"Trending",          desc:"Reached 50 followers",                 cat:"Social",   check:(s)=>s.followers>=50  },
  { id:"follow_100", emoji:"⭐", name:"Influencer",        desc:"Reached 100 followers",                cat:"Social",   check:(s)=>s.followers>=100 },
  { id:"follow_500", emoji:"💫", name:"Icon",              desc:"Reached 500 followers",                cat:"Social",   check:(s)=>s.followers>=500 },
  // Special
  { id:"mirror",     emoji:"🪞", name:"Mirror User",       desc:"Tried on an outfit in The Mirror",     cat:"Special",  check:(s)=>s.usedMirror     },
  { id:"ai_explore", emoji:"🤖", name:"AI Explorer",       desc:"Used both Pairings & The Missing Pieces",    cat:"Special",  check:(s)=>s.usedAI         },
  { id:"planner",    emoji:"📅", name:"Vacation Planner",  desc:"Created a vacation packing plan",      cat:"Special",  check:(s)=>s.usedPlanner    },
];

function computeStats(items, outfits=[]){ return { items:items.length, outfits:outfits.length, listed:items.filter(i=>i.forSale).length, sold:0, followers:0, usedMirror:true, usedAI:true, usedPlanner:true }; }

function BadgesSection({stats}){
  const [tip,setTip]=useState(null);
  const cats=["Closet","Outfits","Market","Social","Special"];
  return(
    <div>
      {cats.map(cat=>{
        const catBadges=ALL_BADGES.filter(b=>b.cat===cat);
        return(
          <div key={cat} style={{marginBottom:20}}>
            <div style={ss(8,600,DM,{letterSpacing:2,marginBottom:10})}>{cat.toUpperCase()}</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10}}>
              {catBadges.map(b=>{
                const earned=b.check(stats);
                return(
                  <div key={b.id} onClick={()=>setTip(tip===b.id?null:b.id)} style={{position:"relative",cursor:_p,textAlign:"center"}}>
                    <div style={{width:"100%",aspectRatio:"1",borderRadius:16,background:earned?`linear-gradient(135deg,${G}22,${G}44)`:"linear-gradient(135deg,#161616,#1C1C1C)",border:`1.5px solid ${earned?G:"#222"}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:26,marginBottom:5,transition:"all 0.2s",opacity:earned?1:0.18,filter:earned?"none":"grayscale(1) blur(0.6px)"}}>
                      {b.emoji}
                    </div>
                    {!earned&&<div style={{position:"absolute",top:0,left:0,right:0,bottom:20,borderRadius:16,background:"radial-gradient(ellipse at center,#FFFFFF06 0%,transparent 70%)",pointerEvents:"none"}}/>}
                    <div style={ss(8,earned?600:400,earned?G:"#333",{letterSpacing:0.3,lineHeight:1.2})}>{b.name}</div>
                    {tip===b.id&&(
                      <div style={{position:"absolute",bottom:"calc(100% + 8px)",left:"50%",transform:"translateX(-50%)",background:"#1A1A14",border:`1px solid ${G}44`,borderRadius:10,padding:"8px 12px",zIndex:99,pointerEvents:"none",boxShadow:"0 4px 20px #000A",minWidth:140}}>
                        <div style={ss(9,700,earned?"#A8C4A0":"#554433",{letterSpacing:0.5,marginBottom:3})}>{earned?"✓ EARNED":"🔒 LOCKED"}</div>
                        <div style={ss(9,600,G,{marginBottom:3})}>{b.name}</div>
                        <div style={ss(8,400,DM,{lineHeight:1.45})}>{b.desc}</div>
                        <div style={{position:"absolute",bottom:-5,left:"50%",transform:"translateX(-50%)",width:8,height:8,background:"#1A1A14",border:`1px solid ${G}44`,borderRight:"none",borderTop:"none",rotate:"45deg"}}/>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SettingsTab({currentPlan,setShowPricing,showToast,items,outfits=[],userName="",userEmail="",onSignOut,userProfile={},saveProfile,styleProfile={},saveStyleProfile,onViewOwnProfile,session}){
  const [section,setSection]=useState("profile");
  const [editField,setEditField]=useState(null);
  const [editVal,setEditVal]=useState("");
  const [showQuiz,setShowQuiz]=useState(false);
  const [quizStep,setQuizStep]=useState(0);
  const [quizDraft,setQuizDraft]=useState({aesthetic:[],occasions:[],fitPref:[],avoidPairings:[],styleIcons:"",colorPalette:""});
  const [avatarUploading,setAvatarUploading]=useState(false);
  const avatarInputRef=useRef(null);
  const totalValue=items.reduce((s,i)=>s+i.price,0);
  const totalResale=items.reduce((s,i)=>s+Math.round(i.price*0.45),0);
  const stats=computeStats(items, outfits);
  const earnedBadges=ALL_BADGES.filter(b=>b.check(stats));

  const uploadAvatar=async(file)=>{
    if(!file||!session?.access_token) return;
    setAvatarUploading(true);
    try{
      const reader=new FileReader();
      reader.onload=async ev=>{
        const dataUrl=ev.target.result;
        const userId=session.user?.id;
        const url=await sb.uploadPhoto(session.access_token,userId,dataUrl)||dataUrl;
        await saveProfile({avatar_url:url});
        showToast("Profile photo updated \u2746");
        setAvatarUploading(false);
      };
      reader.readAsDataURL(file);
    }catch(e){ setAvatarUploading(false); showToast("Upload failed"); }
  };

  const sections=[["profile","Profile"],["badges","Badges"],["preferences","Preferences"],["privacy","Privacy & Data"]];

  const openEdit=(field,currentVal)=>{
    setEditField(field);
    setEditVal(currentVal||"");
  };

  const confirmEdit=async()=>{
    if(!editField) return;
    await saveProfile({[editField]: editVal.trim()});
    showToast("Profile updated \u2746");
    setEditField(null);
  };

  const profileFields=[
    {key:"username", label:"Username", placeholder:"e.g. mike_style", hint:"How others will find and tag you"},
    {key:"bio", label:"Bio", placeholder:"e.g. Building a forever closet, one piece at a time.", hint:"A short line about your style"},
    {key:"location", label:"Location", placeholder:"e.g. New York, NY", hint:"City or region"},
    {key:"styleIdentity", label:"Style Identity", placeholder:"e.g. Minimal · Classic · Investment pieces", hint:"Describe your aesthetic"},
  ];

  return(
    <div className="fu" style={{padding:"16px 24px"}}>
      {/* Profile hero */}
      <div style={{background:"linear-gradient(135deg,#1A1A0A,#2A2010)",borderRadius:20,padding:"20px",marginBottom:20,border:`1px solid ${G}33`,textAlign:"center"}}>
        <input ref={avatarInputRef} type="file" accept="image/*" style={{display:"none"}} onChange={e=>uploadAvatar(e.target.files?.[0])}/>
        <div style={{position:"relative",width:72,height:72,margin:"0 auto 12px",cursor:_p}} onClick={()=>avatarInputRef.current?.click()}>
          <div style={{width:72,height:72,borderRadius:"50%",background:`linear-gradient(135deg,${G},#8A6E54)`,display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden",border:`2px solid ${G}44`}}>
            {userProfile.avatar_url
              ? <img src={userProfile.avatar_url} style={{width:"100%",height:"100%",objectFit:"cover"}} alt="avatar"/>
              : <span style={{fontSize:32}}>✦</span>
            }
          </div>
          <div style={{position:"absolute",bottom:0,right:0,width:22,height:22,borderRadius:"50%",background:G,border:`2px solid #1A1A0A`,display:"flex",alignItems:"center",justifyContent:"center"}}>
            {avatarUploading
              ? <span style={{fontSize:9,animation:"spin 1s linear infinite",display:"inline-block"}}>✦</span>
              : <span style={{fontSize:10}}>📷</span>
            }
          </div>
        </div>
        <div onClick={onViewOwnProfile} style={{...sr(22,400,G),cursor:onViewOwnProfile?_p:"default",display:"inline-block"}}>{userProfile.username ? `@${userProfile.username}` : userName||"Your Wardrobe"}</div>
        <div style={ss(9,400,DM,{letterSpacing:1,marginTop:2})}>{userEmail}</div>
        {userProfile.bio&&<div style={ss(10,400,"#8A7A60",{marginTop:4,fontStyle:"italic"})}>{userProfile.bio}</div>}
        <div style={ss(9,400,DM,{letterSpacing:1,marginTop:4})}>{currentPlan==="free"?"FREE PLAN":currentPlan==="plus"?"OUTFIX+ MEMBER":"OUTFIX PRO MEMBER"}</div>
        <div style={{display:"flex",gap:16,justifyContent:"center",marginTop:14}}>
          {[[items.length,"Pieces"],[`$${totalValue.toLocaleString()}`,"Value"],[`$${totalResale.toLocaleString()}`,"Resale"]].map(([v,l])=>(
            <div key={l} style={{textAlign:"center"}}>
              <div style={sr(18,400,G)}>{v}</div>
              <div style={ss(8,400,DM,{letterSpacing:1})}>{l.toUpperCase()}</div>
            </div>
          ))}
        </div>
        {onSignOut&&(
          <button onClick={onSignOut} style={{marginTop:16,padding:"7px 20px",borderRadius:20,background:"#1A0A0A",border:"1px solid #3A1A1A",...ss(9,600,"#A86060",{letterSpacing:1}),cursor:_p}}>
            Sign Out
          </button>
        )}
      </div>

      {/* Section tabs */}
      <div style={{display:"flex",gap:0,background:"#111",borderRadius:14,overflow:"hidden",border:"1px solid #1E1E1E",marginBottom:20}}>
        {sections.map(([k,l])=>(
          <button key={k} onClick={()=>setSection(k)} style={{flex:1,padding:"10px 4px",background:section===k?`linear-gradient(135deg,${G},#8A6E54)`:"transparent",border:"none",cursor:_p,...ss(9,section===k?600:400,section===k?BK:DM,{letterSpacing:0.5})}}>
            {l}
          </button>
        ))}
      </div>

      {/* BADGES */}
      {section==="badges"&&(
        <div>
          <div style={{background:"linear-gradient(135deg,#14101A,#1A1424)",borderRadius:16,padding:"14px 16px",border:"1px solid #2A2040",marginBottom:18,display:"flex",gap:12,alignItems:"center"}}>
            <div style={{fontSize:28}}>🏅</div>
            <div>
              <div style={sr(15,500,"#D0C0E8")}>{earnedBadges.length} of {ALL_BADGES.length} badges earned</div>
              <div style={ss(9,400,"#7A6898",{marginTop:3})}>Tap any badge to see details</div>
            </div>
          </div>
          <BadgesSection stats={stats}/>
        </div>
      )}

      {/* PROFILE — real editable fields */}
      {section==="profile"&&(
        <div>
          <div style={{background:"#0A1008",borderRadius:14,padding:"12px 14px",border:"1px solid #1A2A18",marginBottom:16,display:"flex",gap:10}}>
            <span style={{fontSize:14}}>💡</span>
            <div style={ss(10,400,"#6A8A68",{lineHeight:1.6})}>Set a username so other Outfix users can find and follow you. All fields are optional.</div>
          </div>
          {profileFields.map(({key,label,placeholder,hint})=>(
            <div key={key} style={{marginBottom:14}}>
              <div style={ss(8,600,DM,{letterSpacing:1.5,marginBottom:6})}>{label.toUpperCase()}</div>
              {editField===key ? (
                <div>
                  <input
                    autoFocus
                    value={editVal}
                    onChange={e=>setEditVal(e.target.value)}
                    placeholder={placeholder}
                    onKeyDown={e=>{if(e.key==="Enter") confirmEdit(); if(e.key==="Escape") setEditField(null);}}
                    style={{width:"100%",boxSizing:"border-box",background:"#0D0D0D",border:`1.5px solid ${G}`,borderRadius:12,padding:"11px 14px",...ss(12,400,MD),color:"#E8E0D4",outline:"none",marginBottom:8}}
                  />
                  <div style={{display:"flex",gap:8}}>
                    <button onClick={()=>setEditField(null)} style={{flex:1,padding:"9px",borderRadius:12,background:"#1A1A1A",border:"1px solid #2A2A2A",...ss(9,600,DM,{letterSpacing:1}),cursor:_p}}>CANCEL</button>
                    <button onClick={confirmEdit} style={{flex:2,padding:"9px",borderRadius:12,background:`linear-gradient(135deg,${G},#8A6E54)`,border:"none",...ss(9,600,BK,{letterSpacing:1}),cursor:_p}}>SAVE</button>
                  </div>
                </div>
              ) : (
                <div onClick={()=>openEdit(key, userProfile[key]||"")} style={{background:_1a,border:_2a,borderRadius:12,padding:"11px 14px",display:"flex",justifyContent:"space-between",alignItems:"center",cursor:_p}}>
                  <div>
                    <div style={ss(12,400,userProfile[key]?MD:DM)}>{userProfile[key]||placeholder}</div>
                    {hint&&<div style={ss(8,400,DM,{marginTop:2})}>{hint}</div>}
                  </div>
                  <div style={ss(10,600,G,{letterSpacing:0.8,flexShrink:0,marginLeft:12})}>EDIT</div>
                </div>
              )}
            </div>
          ))}
          {currentPlan==="free"&&(
            <button onClick={()=>setShowPricing(true)} style={{width:"100%",padding:"14px",borderRadius:16,background:`linear-gradient(135deg,${G},#8A6E54)`,border:"none",...ss(10,700,BK,{letterSpacing:1.5}),cursor:_p,marginTop:8}}>
              UPGRADE TO OUTFIX+
            </button>
          )}
        </div>
      )}

      {/* PREFERENCES */}
      {section==="preferences"&&(
        <div>
          {/* Style Profile Quiz row */}
          <div onClick={()=>{setQuizDraft({aesthetic:styleProfile.aesthetic||[],occasions:styleProfile.occasions||[],fitPref:styleProfile.fitPref||[],avoidPairings:styleProfile.avoidPairings||[],styleIcons:styleProfile.styleIcons||"",colorPalette:styleProfile.colorPalette||""});setQuizStep(0);setShowQuiz(true);}}
            style={{background:styleProfile.quizCompleted?"#0A1A0A":"linear-gradient(135deg,#1A1408,#2A2010)",border:styleProfile.quizCompleted?"1px solid #2A4A2A":`1px solid ${G}44`,borderRadius:14,padding:"14px 16px",marginBottom:14,display:"flex",alignItems:"center",gap:12,cursor:_p}}>
            <div style={{width:38,height:38,borderRadius:10,background:styleProfile.quizCompleted?`#2A4A2A`:`${G}22`,border:styleProfile.quizCompleted?"1px solid #4A8A4A":`1px solid ${G}44`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>
              {styleProfile.quizCompleted?"✓":"✦"}
            </div>
            <div style={{flex:1}}>
              <div style={ss(11,600,styleProfile.quizCompleted?"#80C880":G,{letterSpacing:0.5})}>
                {styleProfile.quizCompleted?"Style Profile Complete":"Set Up Your Style Profile"}
              </div>
              <div style={ss(9,400,DM,{marginTop:2})}>
                {styleProfile.quizCompleted
                  ? `${(styleProfile.aesthetic||[]).join(", ")||"Tap to update"}`
                  : "Teach AI your style — better outfit suggestions"}
              </div>
            </div>
            <div style={ss(12,400,DM)}>›</div>
          </div>

          {/* Notification toggles */}
          <NotifToggles CD={CD} BR={BR} MD={MD} DM={DM} G={G}/>

          {[["Currency","USD ($)"],["Size System","US"],["Language","English"]].map(([l,v])=>(
            <div key={l} style={{background:CD,border:`1px solid ${BR}`,borderRadius:14,padding:"12px 16px",marginBottom:10,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={ss(11,400,MD)}>{l}</div>
              <div style={{..._row,gap:8,...ss(10,400,DM)}}>
                {v}<span style={{...ss(10,400,DM)}}>›</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* PRIVACY */}
      {section==="privacy"&&(
        <div>
          <div style={{background:"#0A0A12",border:"1px solid #1A1A3A",borderRadius:14,padding:"14px",marginBottom:16,display:"flex",gap:10}}>
            <div style={{fontSize:16,flexShrink:0}}>🔒</div>
            <div style={ss(10,400,"#6A8AAA",{lineHeight:1.7})}>Your wardrobe data is encrypted and stored locally. Outfix never sells your data or shares it with third parties.</div>
          </div>
          {[["Wardrobe Data","All your items, outfits and wear logs","Export"],
            ["Transaction History","Market purchases and sales","Download"],
            ["Account Data","Full profile and settings export","Export"],
          ].map(([title,desc,action])=>(
            <div key={title} style={{background:CD,border:`1px solid ${BR}`,borderRadius:14,padding:"14px 16px",marginBottom:10,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{flex:1}}>
                <div style={ss(11,600,MD)}>{title}</div>
                <div style={ss(9,400,DM,{marginTop:3})}>{desc}</div>
              </div>
              <button onClick={()=>showToast(`${title} exported \u2746`)} style={{padding:"6px 14px",borderRadius:10,background:_1a,border:_2a,...ss(8,600,G,{letterSpacing:0.8}),cursor:_p}}>{action}</button>
            </div>
          ))}
          <button onClick={()=>showToast("Account deletion requested \u2746")} style={{width:"100%",marginTop:10,padding:"12px",borderRadius:14,background:"#1A0A0A",border:"1px solid #3A1A1A",...ss(10,600,"#C46060",{letterSpacing:1}),cursor:_p}}>
            DELETE ACCOUNT
          </button>
        </div>
      )}

      {/* ── STYLE QUIZ SHEET ── */}
      {showQuiz&&(()=>{
        const QUIZ_STEPS = [
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
        const toggle=(opt)=>{
          if(step.multi) setQuizDraft(d=>({...d,[step.key]:(d[step.key]||[]).includes(opt)?(d[step.key]||[]).filter(x=>x!==opt):[...(d[step.key]||[]),opt]}));
          else setQuizDraft(d=>({...d,[step.key]:opt}));
        };
        const finish=async()=>{
          if(saveStyleProfile) await saveStyleProfile({...quizDraft,quizCompleted:true});
          showToast("Style profile saved — AI will use this \u2746");
          setShowQuiz(false);
        };
        return(
          <div onClick={()=>setShowQuiz(false)} style={{..._fix,background:"#000000BB",zIndex:200,display:"flex",alignItems:"flex-end"}}>
            <div onClick={e=>e.stopPropagation()} style={{background:"#0D0D0D",borderRadius:"24px 24px 0 0",width:"100%",maxWidth:430,margin:"0 auto",padding:"24px 24px 48px",border:`1px solid ${G}33`,maxHeight:"85vh",overflowY:"auto"}}>
              <div style={{display:"flex",gap:4,marginBottom:20}}>
                {QUIZ_STEPS.map((_,i)=><div key={i} style={{flex:1,height:3,borderRadius:2,background:i<=quizStep?G:"#2A2A2A",transition:"background 0.3s"}}/>)}
              </div>
              <div style={ss(8,600,DM,{letterSpacing:2,marginBottom:6})}>{`STEP ${quizStep+1} OF ${QUIZ_STEPS.length}`}</div>
              <div style={sr(20,400,undefined,{marginBottom:4})}>{step.label}</div>
              <div style={ss(10,400,DM,{marginBottom:20})}>{step.hint}</div>
              {step.freeText?(
                <input value={quizDraft[step.key]||""} onChange={e=>setQuizDraft(d=>({...d,[step.key]:e.target.value}))} placeholder={step.hint}
                  style={{width:"100%",boxSizing:"border-box",background:_1a,border:_2a,borderRadius:12,padding:"12px 14px",...ss(12,400,MD),color:"#E8E0D4",outline:"none",marginBottom:20}}/>
              ):(
                <div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:20}}>
                  {step.options.map(opt=>{
                    const active=step.multi?(val||[]).includes(opt):val===opt;
                    return <button key={opt} onClick={()=>toggle(opt)} style={{padding:"8px 14px",borderRadius:20,cursor:_p,background:active?`${G}22`:_1a,border:active?`1.5px solid ${G}`:`1px solid #2A2A2A`,...ss(10,active?600:400,active?G:DM)}}>{opt}</button>;
                  })}
                </div>
              )}
              <div style={{display:"flex",gap:10}}>
                {quizStep>0&&<button onClick={()=>setQuizStep(s=>s-1)} style={{flex:1,padding:"12px",borderRadius:14,background:_1a,border:_2a,...ss(10,600,DM,{letterSpacing:1}),cursor:_p}}>BACK</button>}
                <button onClick={isLast?finish:()=>setQuizStep(s=>s+1)} style={{flex:2,padding:"12px",borderRadius:14,background:`linear-gradient(135deg,${G},#8A6E54)`,border:"none",...ss(10,700,BK,{letterSpacing:1.5}),cursor:_p}}>
                  {isLast?"SAVE MY PROFILE →":"NEXT →"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
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
            style={{padding:"8px 16px",borderRadius:20,background:newOccasion===occ?G:_1a,border:newOccasion===occ?"none":_2a,...ss(10,newOccasion===occ?600:400,newOccasion===occ?BK:DM,{letterSpacing:0.5}),cursor:_p}}>
            {occasionEmojis[occ]} {occ}
          </button>
        ))}
      </div>

      {/* Calendar */}
      <div style={ss(8,600,DM,{letterSpacing:1.5,marginBottom:12})}>DATE</div>
      {newDate&&(
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 12px",borderRadius:10,background:`${G}18`,border:`1px solid ${G}44`,marginBottom:12}}>
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

function VaultTab({items,outfits,showToast,wishlist,setWishlist,addToWishlist,removeFromWishlist,currentPlan,setShowPricing,logWear,events,setEvents,session,styleProfile={},saveStyleProfile,onboardStep=4,advanceOnboard}){
  const [section,setSection]=useState("discover"); // discover | planner | stats
  const isPro = currentPlan!=="free";

  const sections=[
    ["discover","Discover",null,"AI pairings, missing pieces & trend matching"],
    ["planner","Planner",null,"Occasion calendar & vacation packing"],
    ["stats","Stats",null,"Wardrobe analytics, duplicates & valuation"],
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
        <div style={{background:"linear-gradient(135deg,#14100A,#1E1812)",borderRadius:18,padding:"20px 18px",border:`1px solid ${G}33`,textAlign:"center"}}>
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
      <div style={{padding:"4px 24px 20px"}}>
        <div style={ss(9,400,MD,{letterSpacing:3,textTransform:"uppercase",marginBottom:4})}>Members Only</div>
        <div style={sr(30,300)}>The Vault ✦</div>
        {!isPro&&<div style={ss(10,400,DM,{marginTop:6,lineHeight:1.5})}>Subscribe to unlock all premium features</div>}
        {isPro&&<div style={{display:"inline-flex",alignItems:"center",gap:6,marginTop:8,background:`${G}18`,border:`1px solid ${G}44`,borderRadius:20,padding:"4px 12px"}}>
          <div style={ss(8,700,G,{letterSpacing:1.5})}>✦ VAULT ACCESS ACTIVE</div>
        </div>}
      </div>

      {/* ── ONBOARDING STEP 3 BANNER ── */}
      {onboardStep===3&&(
        <div style={{background:"linear-gradient(135deg,#1A1610,#141008)",border:`1px solid ${G}44`,borderRadius:14,padding:"14px 16px",marginBottom:0,margin:"0 16px 16px"}}>
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

      {/* Sub-nav pills */}
      <div style={{display:"flex",gap:6,padding:"0 16px 20px"}}>
        {sections.map(([k,l])=>(
          <button key={k} onClick={()=>setSection(k)} style={{
            flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:3,
            padding:"7px 4px",borderRadius:14,
            background:section===k?G:"#1A1A1A",
            border:section===k?"none":"1px solid #2A2A2A",
            cursor:_p,
          }}>
            <VaultIcon id={k} active={section===k}/>
            <span style={{...ss(7,section===k?700:400,section===k?BK:MD,{letterSpacing:0.5}),whiteSpace:"nowrap"}}>{l.toUpperCase()}</span>
          </button>
        ))}
      </div>

      {/* Content */}
      {section==="discover"&&(
        <Gate feature="AI Stylist">
          <DiscoverTab showToast={showToast} wishlist={wishlist} setWishlist={setWishlist} addToWishlist={addToWishlist} items={items}/>
        </Gate>
      )}
      {section==="planner"&&(
        <Gate feature="Occasion Planner">
          <CalendarTab outfits={outfits} items={items} showToast={showToast} logWear={logWear} events={events} setEvents={setEvents} session={session}/>
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
function ObSlide1(){
  return(
    <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",background:"linear-gradient(160deg,#1A140E,#0D0D0D)",padding:"40px 32px",textAlign:"center"}}>
      <div style={{width:120,height:120,borderRadius:32,background:"#C4A88218",border:"1px solid #C4A88244",display:"flex",alignItems:"center",justifyContent:"center",marginBottom:36,boxShadow:"0 0 60px #C4A88222"}}>
        <span style={{fontSize:56,color:"#C4A882"}}>✦</span>
      </div>
      <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:52,fontWeight:300,letterSpacing:6,color:"#F0EBE3",marginBottom:14}}>Outfix</div>
      <div style={{fontFamily:"Montserrat,sans-serif",fontSize:11,fontWeight:600,letterSpacing:3,color:"#5A5048",marginBottom:32}}>YOUR WARDROBE. ELEVATED.</div>
      <div style={{fontFamily:"Montserrat,sans-serif",fontSize:15,color:"#8A7868",lineHeight:1.8,maxWidth:280}}>A private, intelligent home for your wardrobe.</div>
    </div>
  );
}

function ObSlide2(){
  return(
    <div style={{flex:1,display:"flex",flexDirection:"column",background:"#0D0D0D",padding:"28px 24px"}}>
      <div style={{fontFamily:"Montserrat,sans-serif",fontSize:11,letterSpacing:2,color:"#5A5048",marginBottom:6}}>YOUR CLOSET</div>
      <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:32,fontWeight:300,color:"#F0EBE3",marginBottom:20}}>Build Your Closet</div>
      {[
        {ic:"📷",label:"SCAN FROM PHOTO",sub:"AI identifies all items in image",gold:true},
        {ic:"🔗",label:"PASTE URL",sub:"https://store.com/item…",gold:false},
        {ic:"🎙️",label:"DESCRIBE IT",sub:'"navy wool blazer from Zara…"',gold:false},
        {ic:"✏️",label:"ADD MANUALLY",sub:"Fill in all details yourself",gold:false},
      ].map(({ic,label,sub,gold})=>(
        <div key={label} style={{background:"#141414",borderRadius:14,padding:"14px 16px",border:`1px solid ${gold?"#C4A88244":"#2A2A2A"}`,display:"flex",alignItems:"center",gap:14,marginBottom:10}}>
          <div style={{width:46,height:46,borderRadius:12,background:gold?"#C4A88222":"#1A1A1A",border:`1px solid ${gold?"#C4A88244":"#2A2A2A"}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,flexShrink:0}}>{ic}</div>
          <div>
            <div style={{fontFamily:"Montserrat,sans-serif",fontSize:12,fontWeight:600,color:gold?"#C4A882":"#8A7060",letterSpacing:1}}>{label}</div>
            <div style={{fontFamily:"Montserrat,sans-serif",fontSize:11,color:"#3A3028",marginTop:3}}>{sub}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ObSlide3(){
  return(
    <div style={{flex:1,display:"flex",flexDirection:"column",background:"#0D0D0D",padding:"28px 24px"}}>
      <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:30,fontWeight:300,color:"#F0EBE3",marginBottom:6}}>Mix & Match</div>
      <div style={{fontFamily:"Montserrat,sans-serif",fontSize:10,letterSpacing:1.5,color:"#5A5048",marginBottom:18}}>SWIPE · HOLD TO REMOVE · TAP TWICE TO LOCK</div>
      {/* Tops — locked */}
      <div style={{marginBottom:14}}>
        <div style={{fontFamily:"Montserrat,sans-serif",fontSize:10,letterSpacing:1,color:"#C4A882",marginBottom:6}}>TOPS 🔒</div>
        <div style={{height:110,borderRadius:16,background:"linear-gradient(135deg,#F5F0E822,#EDE8DF44)",border:"1.5px solid #C4A882",display:"flex",alignItems:"center",justifyContent:"center",position:"relative",overflow:"hidden"}}>
          <svg viewBox="0 0 120 110" width="90" height="82" fill="none">
            <defs><linearGradient id="ob1" x1="0" y1="0" x2="0.3" y2="1"><stop offset="0%" stopColor="#FDFAF5"/><stop offset="100%" stopColor="#EDE8DF"/></linearGradient></defs>
            <path d="M36 26 C28 32,22 52,22 88 L98 88 C98 52,92 32,84 26 C76 20,66 18,60 18 C54 18,44 20,36 26Z" fill="url(#ob1)" stroke="#D8D2C8" strokeWidth="0.8"/>
            <path d="M36 26 C26 24,14 28,10 38 C8 48,10 66,14 74 L28 70 C26 62,25 48,28 40 C30 34,34 28,36 26Z" fill="url(#ob1)" stroke="#D8D2C8" strokeWidth="0.8"/>
            <path d="M84 26 C94 24,106 28,110 38 C112 48,110 66,106 74 L92 70 C94 62,95 48,92 40 C90 34,86 28,84 26Z" fill="url(#ob1)" stroke="#D8D2C8" strokeWidth="0.8"/>
            <path d="M46 26 L60 50 L74 26" fill="none" stroke="#C8C0B4" strokeWidth="1"/>
            <line x1="60" y1="50" x2="60" y2="88" stroke="#D0C8BC" strokeWidth="0.8" strokeDasharray="2,3"/>
          </svg>
          <div style={{position:"absolute",bottom:8,right:12,fontFamily:"Montserrat,sans-serif",fontSize:10,color:"#C4A882"}}>Ivory Blouse</div>
        </div>
      </div>
      {/* Bottoms */}
      <div style={{marginBottom:14}}>
        <div style={{fontFamily:"Montserrat,sans-serif",fontSize:10,letterSpacing:1,color:"#5A5048",marginBottom:6}}>BOTTOMS</div>
        <div style={{height:110,borderRadius:16,background:"linear-gradient(135deg,#2C3E5022,#1E304044)",border:"1.5px solid #2A2A2A",display:"flex",alignItems:"center",justifyContent:"center",position:"relative",overflow:"hidden"}}>
          <svg viewBox="0 0 120 120" width="86" height="82" fill="none">
            <defs><linearGradient id="ob2" x1="0.1" y1="0" x2="0.9" y2="1"><stop offset="0%" stopColor="#3A4F64"/><stop offset="100%" stopColor="#1E3040"/></linearGradient></defs>
            <rect x="26" y="14" width="68" height="10" rx="2" fill="#2A3E52" stroke="#1A2E40" strokeWidth="0.5"/>
            <path d="M26 24 C22 56,16 90,12 118 L54 118 C56 90,58 56,60 24Z" fill="url(#ob2)"/>
            <path d="M94 24 C98 56,104 90,108 118 L66 118 C64 90,62 56,60 24Z" fill="url(#ob2)"/>
            <line x1="60" y1="24" x2="44" y2="118" stroke="#162838" strokeWidth="0.8" opacity="0.6"/>
            <line x1="60" y1="24" x2="76" y2="118" stroke="#162838" strokeWidth="0.8" opacity="0.6"/>
          </svg>
          <div style={{position:"absolute",bottom:8,right:12,fontFamily:"Montserrat,sans-serif",fontSize:10,color:"#5A5048"}}>Wide Leg</div>
        </div>
      </div>
      {/* Shoes */}
      <div>
        <div style={{fontFamily:"Montserrat,sans-serif",fontSize:10,letterSpacing:1,color:"#5A5048",marginBottom:6}}>SHOES</div>
        <div style={{height:110,borderRadius:16,background:"linear-gradient(135deg,#1A100822,#2A180A44)",border:"1.5px solid #2A2A2A",display:"flex",alignItems:"center",justifyContent:"center",position:"relative",overflow:"hidden"}}>
          <svg viewBox="0 0 140 80" width="130" height="74" fill="none">
            <defs><linearGradient id="ob3" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#4A3020"/><stop offset="100%" stopColor="#2A1A0A"/></linearGradient></defs>
            <path d="M10 55 C10 40,20 28,40 26 C60 24,80 26,100 30 C115 33,128 40,130 50 C132 58,125 65,110 66 L30 66 C18 66,10 62,10 55Z" fill="url(#ob3)" stroke="#3A2010" strokeWidth="1"/>
            <path d="M40 26 C42 18,50 14,62 14 C72 14,78 18,80 26" fill="none" stroke="#3A2010" strokeWidth="1.5" strokeLinecap="round"/>
            <ellipse cx="62" cy="24" rx="8" ry="4" fill="#5A3A20" stroke="#3A2010" strokeWidth="0.8"/>
          </svg>
          <div style={{position:"absolute",bottom:8,right:12,fontFamily:"Montserrat,sans-serif",fontSize:10,color:"#5A5048"}}>Loafers</div>
        </div>
      </div>
    </div>
  );
}

function ObSlide4(){
  const posts=[
    {user:"@minimal.edit",followers:"8.1k",outfit:"Quiet Luxury Monday",likes:"834",c1:"#F0EBE3",c2:"#2C3E50",c3:"#C4A882",action:"+ CLOSET"},
    {user:"@jess.styles",followers:"12.4k",outfit:"Vintage Saturday",likes:"412",c1:"#C8A96E",c2:"#1A1A1A",c3:"#8B6B4A",action:"♡ SAVE"},
    {user:"@the.closet.co",followers:"31k",outfit:"Coastal Summer",likes:"291",c1:"#E8E0D4",c2:"#D4C8B8",c3:"#C4B8A4",action:"+ CLOSET"},
  ];
  return(
    <div style={{flex:1,display:"flex",flexDirection:"column",background:"#0D0D0D",padding:"24px 20px",overflow:"hidden"}}>
      <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:30,fontWeight:300,color:"#F0EBE3",marginBottom:14}}>Discover</div>
      {posts[0] && (
        <div style={{background:"#141414",borderRadius:14,overflow:"hidden",border:"1px solid #1E1E1E",marginBottom:10}}>
          <div style={{height:72,background:`linear-gradient(135deg,${posts[0].c1}22,${posts[0].c2}33,${posts[0].c3}22)`,display:"flex",alignItems:"flex-end",padding:"0 12px 8px"}}>
            <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:18,color:"#F0EBE3",fontWeight:300}}>{posts[0].outfit}</div>
          </div>
          <div style={{padding:"8px 12px",display:"flex",alignItems:"center",gap:8}}>
            <div style={{width:22,height:22,borderRadius:"50%",background:"#2A2A2A",flexShrink:0}}/>
            <div style={{fontFamily:"Montserrat,sans-serif",fontSize:10,color:"#5A5048",flex:1}}>{posts[0].user} · {posts[0].followers}</div>
            <span style={{fontFamily:"Montserrat,sans-serif",fontSize:10,color:"#5A5048"}}>♡ {posts[0].likes}</span>
            <span style={{fontFamily:"Montserrat,sans-serif",fontSize:10,color:"#C4A882",marginLeft:4}}>{posts[0].action}</span>
          </div>
        </div>
      )}
      {/* Trend card */}
      <div style={{borderRadius:14,overflow:"hidden",border:"1px solid #1E1E1E",marginBottom:10}}>
        <div style={{height:28,background:"linear-gradient(135deg,#D4C4A866,#8A786044,#C0B09066)",display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0 12px"}}>
          <div style={{fontFamily:"Montserrat,sans-serif",fontSize:9,fontWeight:600,letterSpacing:1.5,color:"#5A5040",background:"#0D0D0D55",padding:"2px 7px",borderRadius:4}}>TRENDING NOW</div>
          <div style={{display:"flex",gap:4}}>
            {["#D4C4A8","#8A7860","#C0B090","#E8E0D0"].map(c=>(
              <div key={c} style={{width:10,height:10,borderRadius:"50%",background:c,border:"1px solid #0D0D0D44"}}/>
            ))}
          </div>
        </div>
        <div style={{background:"#141414",padding:"10px 12px"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4}}>
            <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:18,color:"#F0EBE3"}}>Quiet Luxury</div>
            <div style={{background:"#0A1A0A",border:"1px solid #1A3A1A",borderRadius:6,padding:"3px 8px",fontFamily:"Montserrat,sans-serif",fontSize:9,color:"#60A870"}}>3 in closet</div>
          </div>
          <div style={{display:"flex",gap:5}}>
            {["neutral","minimal","investment"].map(t=>(
              <div key={t} style={{background:"#1A1A1A",borderRadius:8,padding:"3px 8px",fontFamily:"Montserrat,sans-serif",fontSize:9,color:"#4A4038"}}>{t}</div>
            ))}
          </div>
        </div>
      </div>
      {posts.slice(1).map(p=>(
        <div key={p.user} style={{background:"#141414",borderRadius:14,overflow:"hidden",border:"1px solid #1E1E1E",marginBottom:10}}>
          <div style={{height:60,background:`linear-gradient(135deg,${p.c1}22,${p.c2}33,${p.c3}22)`,display:"flex",alignItems:"flex-end",padding:"0 12px 8px"}}>
            <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:17,color:"#F0EBE3",fontWeight:300}}>{p.outfit}</div>
          </div>
          <div style={{padding:"7px 12px",display:"flex",alignItems:"center",gap:8}}>
            <div style={{width:20,height:20,borderRadius:"50%",background:"#2A2A2A",flexShrink:0}}/>
            <div style={{fontFamily:"Montserrat,sans-serif",fontSize:10,color:"#5A5048",flex:1}}>{p.user} · {p.followers}</div>
            <span style={{fontFamily:"Montserrat,sans-serif",fontSize:10,color:"#5A5048"}}>♡ {p.likes}</span>
            <span style={{fontFamily:"Montserrat,sans-serif",fontSize:10,color:"#C4A882",marginLeft:4}}>{p.action}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function ObSlide5(){
  return(
    <div style={{flex:1,display:"flex",flexDirection:"column",background:"#0D0D0D",padding:"28px 24px"}}>
      <div style={{fontFamily:"Montserrat,sans-serif",fontSize:11,letterSpacing:2,color:"#5A5048",marginBottom:4}}>MEMBERS ONLY</div>
      <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:32,fontWeight:300,color:"#F0EBE3",marginBottom:20}}>The Vault ✦</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:16}}>
        {[["✦","AI Stylist"],["📅","Planner"],["✈️","Vacation"],["📊","Stats"],["🛍","Shoppers"],["📈","Trends"]].map(([ic,l])=>(
          <div key={l} style={{background:"#141414",borderRadius:14,padding:"14px 10px",border:"1px solid #2A2A2A",textAlign:"center"}}>
            <div style={{fontSize:24,marginBottom:6}}>{ic}</div>
            <div style={{fontFamily:"Montserrat,sans-serif",fontSize:11,color:"#6A5A48"}}>{l}</div>
          </div>
        ))}
      </div>
      <div style={{background:"linear-gradient(135deg,#14100A,#1E1812)",borderRadius:14,padding:"16px",border:"1px solid #C4A88233",textAlign:"center"}}>
        <div style={{fontFamily:"Montserrat,sans-serif",fontSize:11,color:"#C4A882",letterSpacing:1,marginBottom:10}}>FROM $4 / MONTH</div>
        <div style={{padding:"12px",borderRadius:10,background:"linear-gradient(135deg,#C4A882,#8A6E54)",fontFamily:"Montserrat,sans-serif",fontSize:12,fontWeight:600,color:"#0D0D0D",letterSpacing:1.5}}>UNLOCK THE VAULT</div>
      </div>
    </div>
  );
}

const OB_BANNERS=[
  null,
  {label:"AI FILLS IN THE DETAILS",body:"Add pieces in seconds. Snap a photo, paste a URL, or describe an item — AI identifies everything automatically."},
  {label:"SWIPE · LOCK · STYLE WITH AI",body:"Double-tap to lock a piece you love, then let AI fill the rest — or build every look yourself."},
  {label:"FEED · TRENDS · WISHLIST",body:"Browse style inspiration from creators you follow, save looks you love, and add items directly to your wishlist."},
  {label:"PREMIUM FEATURES",body:"AI stylist, occasion planner, vacation packer, wear stats & personal shopper — from $4/month."},
];
const OB_SCREENS=[ObSlide1,ObSlide2,ObSlide3,ObSlide4,ObSlide5];

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
  const banner=OB_BANNERS[slide];

  return(
    <div style={{position:"fixed",inset:0,zIndex:200,background:"#0D0D0D",display:"flex",flexDirection:"column",maxWidth:430,margin:"0 auto",fontFamily:"'Cormorant Garamond','Georgia',serif",color:"#F0EBE3",opacity:exiting?0:1,transition:"opacity 0.4s ease"}}
      onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <style>{`@keyframes obIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}`}</style>

      {/* Skip */}
      <div style={{display:"flex",justifyContent:"flex-end",padding:"20px 24px 0",flexShrink:0}}>
        {slide<total-1&&<button onClick={finish} style={{background:"none",border:"none",cursor:_p,fontFamily:"Montserrat,sans-serif",fontSize:13,fontWeight:400,color:"#3A3028",letterSpacing:1.5}}>SKIP</button>}
      </div>

      {/* Slide content + banner */}
      <div key={slide} style={{flex:1,display:"flex",flexDirection:"column",animation:"obIn 0.35s ease forwards",overflow:"hidden"}}>
        <Screen/>
        {banner&&(
          <div style={{background:"linear-gradient(135deg,#1A1610,#141008)",borderTop:"1px solid #C4A88244",padding:"20px 24px 22px",flexShrink:0}}>
            <div style={{fontFamily:"Montserrat,sans-serif",fontSize:11,fontWeight:600,letterSpacing:2,color:"#C4A882",marginBottom:8}}>{banner.label}</div>
            <div style={{fontFamily:"Montserrat,sans-serif",fontSize:13,color:"#7A6A58",lineHeight:1.7}}>{banner.body}</div>
          </div>
        )}
      </div>

      {/* Dots + CTA */}
      <div style={{padding:"16px 28px 48px",display:"flex",flexDirection:"column",alignItems:"center",gap:16,flexShrink:0,background:"#0D0D0D"}}>
        <div style={{display:"flex",gap:8}}>
          {Array.from({length:total}).map((_,i)=>(
            <div key={i} onClick={()=>setSlide(i)} style={{width:i===slide?26:8,height:8,borderRadius:4,background:i===slide?"#C4A882":"#2A2418",transition:"all 0.3s ease",cursor:_p}}/>
          ))}
        </div>
        <button onClick={goNext} style={{width:"100%",padding:"18px",borderRadius:16,background:`linear-gradient(135deg,#C4A882,#8A6E54)`,border:"none",fontFamily:"Montserrat,sans-serif",fontSize:14,fontWeight:700,color:"#0D0D0D",letterSpacing:2,cursor:_p,boxShadow:"0 4px 24px #C4A88244"}}>
          {slide===total-1?"GET STARTED":"NEXT  →"}
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
      console.warn("handleAuth blocked — no valid token:", sess);
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
      setOnboardStep(savedStep);
      if(!localStorage.getItem(`outfix_onboarded_${uid}`)) setShowOnboarding(true);
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
  const [selectedItem,setSelectedItem] = useState(null);
  const [wishlist,setWishlist]     = useState(initWishlist);
  const [toast,setToast]           = useState(null);
  const [showPricing,setShowPricing]     = useState(false);
  const [currentPlan,setCurrentPlan]     = useState("free");
  const [notifications,setNotifications] = useState(initNotifications);
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
          title:`@${followerProfiles[f.follower_id]?.username||"Someone"} followed you`,
          body:"Check out their closet",time:getTimeAgo(f.created_at),urgent:false,_ts:new Date(f.created_at||0).getTime(),
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
    } catch(e){ console.log("Style profile not loaded:", e); }
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
    } catch(e){ console.log("Style profile save error:", e); }
  };

  // ── Load user's closet from Supabase on login ──
  useEffect(()=>{
    if(!session?.access_token) return;
    setClosetLoading(true);

    const userId = session.user?.id ||
      (() => { try { return JSON.parse(atob(session.access_token.split(".")[1])).sub; } catch(e){ return null; } })();

    if(!userId){ console.error("No userId found in session"); setClosetLoading(false); return; }
    console.log("Loading closet for user:", userId);

    (async () => {
    try {
    // Explicitly filter by user_id — belt AND suspenders alongside RLS
    const [itemData, outfitData, wishlistData, eventsData] = await Promise.all([
      sb.select("items", session.access_token, `&user_id=eq.${userId}`).catch(e=>{ console.error("items load failed:", e); return []; }),
      sb.select("outfits", session.access_token, `&user_id=eq.${userId}`).catch(e=>{ console.error("outfits load failed:", e); return []; }),
      sb.select("wishlist", session.access_token, `&user_id=eq.${userId}`).catch(e=>{ console.error("wishlist load failed:", e); return []; }),
      sb.select("calendar_events", session.access_token, `&user_id=eq.${userId}&order=date.asc`).catch(()=>[]),
    ]);
    loadStyleProfile(session.access_token, userId);

    console.log("Supabase items response:", JSON.stringify(itemData)?.slice(0,200));
    console.log("Supabase outfits response:", JSON.stringify(outfitData)?.slice(0,200));

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
      }));
      console.log("Loaded", mapped.length, "items from Supabase");
      setItems(mapped);
    } else {
      console.log("No items in Supabase — starting with empty closet");
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
      console.log("Loaded", mapped.length, "outfits from Supabase");
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
      console.log("Loaded", mapped.length, "wishlist items from Supabase");
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
    } catch(e) { console.error("Closet load error:", e); setClosetLoading(false); }
    })();
  },[session]);

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
            updated_at: new Date().toISOString(),
          }),
        });
      }
    }catch(e){ console.error("saveProfile error:", e); }
  };
  const saveItemToDB = async (item) => {
    if(!session?.access_token) return;
    try {
      // Extract user ID from session — Supabase stores it in different places
      const userId = session.user?.id || session.user_id ||
        (() => { try { return JSON.parse(atob(session.access_token.split(".")[1])).sub; } catch(e){ return null; } })();

      console.log("saveItemToDB — userId:", userId, "item:", item.name);

      if(!userId) { console.error("No user ID found in session"); return; }

      let sourceImageUrl = null;
      if(item.sourceImage) {
        if(item.sourceImage.startsWith("http")) {
          sourceImageUrl = item.sourceImage;
        } else if(item.sourceImage.startsWith("data:")) {
          sourceImageUrl = await sb.uploadPhoto(session.access_token, userId, item.sourceImage);
        }
      }

      const result = await sb.insert("items", session.access_token, {
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
      });
      console.log("saveItemToDB result:", JSON.stringify(result)?.slice(0,200));
      // Post feed event for followers
      const savedRow = Array.isArray(result) ? result[0] : result;
      if(savedRow?.id) {
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
      console.log("saveOutfitToDB result:", JSON.stringify(res)?.slice(0,200));
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
      console.log("saveWishlistItemToDB result:", JSON.stringify(res)?.slice(0,200));
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
  const [appEvents,setAppEvents] = useState(calendarEvents);


  // ── Helpers ──
  const showToast = msg   => { setToast(msg); setTimeout(()=>setToast(null), 2600); };

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
        if(session?.access_token) {
          sb.update("outfits", session.access_token, o.id, { worn_history: newHistory })
            .then(r=>console.log("worn_history saved:", r))
            .catch(e=>console.error("worn_history save failed:", e));
        }
        return { ...o, wornHistory: newHistory };
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
      <div style={{fontFamily:"Montserrat,sans-serif",fontSize:9,color:"#3A3028",letterSpacing:3}}>LOADING…</div>
    </div>
  );

  // Show auth screen if not signed in
  if(!session) return <AuthScreen onAuth={handleAuth}/>;

  // User info for display
  const userEmail = session?.user?.email || "";
  const userName  = session?.user?.user_metadata?.name || userEmail.split("@")[0] || "You";

  return(
    <div style={{fontFamily:"'Cormorant Garamond','Georgia',serif",background:wrapBg,minHeight:"100vh",color:wrapColor,maxWidth:430,margin:"0 auto",position:"relative",transition:"background 0.3s,color 0.3s"}}>
      <style>{GCSS}</style>

      {/* ── Invisible status bar tap target — scrolls to top like Instagram ── */}
      <div onClick={()=>document.getElementById('main-scroll')?.scrollTo({top:0,behavior:'smooth'})}
        style={{position:"fixed",top:0,left:0,right:0,height:44,zIndex:21,cursor:"pointer"}}/>

      {/* ── HEADER ── fixed so it stays on every page/scroll */}
      <div onClick={()=>document.getElementById('main-scroll')?.scrollTo({top:0,behavior:'smooth'})}
        style={{position:"fixed",top:0,left:0,right:0,maxWidth:430,margin:"0 auto",padding:"20px 24px 14px",background:hdrBg,zIndex:20,transition:"background 0.3s",borderBottom:`1px solid #1A1A1A`,cursor:"pointer"}}>
        <div style={{..._btwn}}>
          <div style={{display:"flex",alignItems:"baseline",gap:10}}>
            <div style={sr(34,400,"#F0EBE3",{letterSpacing:3,lineHeight:1})}>Outfix</div>
            {badge&&(
              <div style={{background:`${badge.color}22`,border:`1px solid ${badge.color}55`,borderRadius:20,padding:"3px 10px",...ss(8,700,badge.color,{letterSpacing:2})}}>
                {badge.label}
              </div>
            )}
          </div>
          <div style={{..._row,gap:10}}>
            <button className="tb" onClick={()=>setShowPricing(true)} style={{height:34,borderRadius:20,background:`linear-gradient(135deg,${G},#8A6E54)`,padding:"0 16px",border:"none",...ss(9,600,BK,{letterSpacing:1}),cursor:_p}}>
              {currentPlan==="free"?"UPGRADE":"MY PLAN"}
            </button>
            <button className="tb" onClick={()=>setShowPushNotifs(true)} style={{width:38,height:38,borderRadius:"50%",border:`1px solid ${divLine}`,display:"flex",alignItems:"center",justifyContent:"center",background:"none",cursor:_p,position:"relative",padding:0}}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M10 2C10 2 6 3.5 6 9V14H14V9C14 3.5 10 2 10 2Z" stroke={G} strokeWidth="1.4" strokeLinejoin="round" fill="none"/>
                <path d="M4 14H16" stroke={G} strokeWidth="1.4" strokeLinecap="round"/>
                <path d="M8.5 14C8.5 15.4 9.2 16 10 16C10.8 16 11.5 15.4 11.5 14" stroke={G} strokeWidth="1.3" strokeLinecap="round" fill="none"/>
              </svg>
              {totalUnread>0&&<div style={{position:"absolute",top:-2,right:-2,minWidth:16,height:16,borderRadius:8,background:"#CC3333",border:`2px solid ${wrapBg}`,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"Montserrat,sans-serif",fontSize:8,fontWeight:700,color:"#FFFFFF",padding:"0 3px"}}>{totalUnread}</div>}
            </button>
            <button className="tb" onClick={()=>setTab("__settings")} style={{width:44,height:44,borderRadius:"50%",border:`1px solid ${divLine}`,display:"flex",alignItems:"center",justifyContent:"center",background:"none",cursor:_p}}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <circle cx="10" cy="10" r="2.8" stroke={G} strokeWidth="1.4" fill="none"/>
                <path d="M10 1.5L11.2 3.8C11.5 3.9 11.8 4 12.1 4.2L14.6 3.5L16.5 6.5L14.6 8.3C14.6 8.6 14.7 8.8 14.7 9C14.7 9.2 14.6 9.4 14.6 9.7L16.5 11.5L14.6 14.5L12.1 13.8C11.8 14 11.5 14.1 11.2 14.2L10 16.5L7.8 16.5L6.8 14.2C6.5 14.1 6.2 14 5.9 13.8L3.4 14.5L1.5 11.5L3.4 9.7C3.4 9.4 3.3 9.2 3.3 9C3.3 8.8 3.4 8.6 3.4 8.3L1.5 6.5L3.4 3.5L5.9 4.2C6.2 4 6.5 3.9 6.8 3.8L8 1.5Z" stroke={G} strokeWidth="1.35" strokeLinejoin="round" fill="none"/>
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* ── CONTENT — offset by header height ── */}
      <div id="main-scroll" className="sc" style={{height:"100vh",paddingTop:76,paddingBottom:80,boxSizing:"border-box"}}>
        {tab==="home"     && <HomeTab items={items} outfits={outfits} showToast={showToast} setTab={setTab} setWishlist={setWishlist} addToWishlist={addToWishlist} removeFromWishlist={removeFromWishlist} setItems={setItems} session={session} viewProfile={viewProfile} setViewProfile={setViewProfile} userProfile={userProfile} onAddToCloset={async(item)=>{
          const newItem={...item,id:Date.now()};
          setItems(prev=>[...prev,newItem]);
          await saveItemToDB(newItem);
        }}/>}
        {tab==="closet"    && <ClosetTab items={items} setItems={setItems} setSelectedItem={setSelectedItem} showToast={showToast} wishlist={wishlist} setWishlist={setWishlist} addToWishlist={addToWishlist} removeFromWishlist={removeFromWishlist} onSaveItem={saveItemToDB} onDeleteItem={deleteItemFromDB} onboardStep={onboardStep} advanceOnboard={advanceOnboard}/>}
        {tab==="outfits"   && <OutfitsTab items={items} outfits={outfits} setOutfits={setOutfits} setItems={setItems} showToast={showToast} logWear={logWear} onSaveOutfit={saveOutfitToDB} onDeleteOutfit={deleteOutfitFromDB} styleProfile={styleProfile} saveStyleProfile={saveStyleProfile} postWearFeedEvent={postWearFeedEvent} onboardStep={onboardStep} advanceOnboard={advanceOnboard}/>}
        {tab==="market"    && (
          <div className="fu" style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"40px 32px",textAlign:"center",minHeight:"60vh"}}>
            <div style={{fontSize:52,marginBottom:20}}>🛍</div>
            <div style={sr(32,300,G,{letterSpacing:3,marginBottom:8})}>The Exchange</div>
            <div style={ss(10,600,DM,{letterSpacing:3,marginBottom:28})}>COMING SOON</div>
            <div style={{background:CD,borderRadius:20,padding:"24px",border:`1px solid ${G}33`,marginBottom:28,maxWidth:320}}>
              <div style={sr(15,400,"#C0B8B0",{lineHeight:1.8})}>
                Buy, sell and trade pieces directly with other Outfix members. Peer-to-peer resale with offers, styling context, and closet-aware recommendations.
              </div>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:10,width:"100%",maxWidth:280}}>
              {["Peer-to-peer resale","Make & receive offers","Closet gap matching","Vetted community sellers"].map(f=>(
                <div key={f} style={{..._row,gap:10,background:CD,borderRadius:12,padding:"11px 16px",border:`1px solid ${BR}`}}>
                  <span style={{color:G,fontSize:13}}>✦</span>
                  <span style={ss(11,400,"#C0B8B0")}>{f}</span>
                </div>
              ))}
            </div>
            <button onClick={()=>showToast("We'll notify you when Market launches \u2746")}
              style={{marginTop:28,padding:"13px 32px",borderRadius:20,background:`linear-gradient(135deg,${G},#8A6E54)`,border:"none",...ss(10,700,BK,{letterSpacing:1.5}),cursor:_p}}>
              NOTIFY ME AT LAUNCH
            </button>
          </div>
        )}
        {tab==="vault"     && <VaultTab items={items} outfits={outfits} showToast={showToast} wishlist={wishlist} setWishlist={setWishlist} addToWishlist={addToWishlist} removeFromWishlist={removeFromWishlist} currentPlan={currentPlan} setShowPricing={setShowPricing} logWear={logWear} events={appEvents} setEvents={setAppEvents} session={session} styleProfile={styleProfile} saveStyleProfile={saveStyleProfile} onboardStep={onboardStep} advanceOnboard={advanceOnboard}/>}
      </div>

      {/* ── BOTTOM NAV ── */}
      <div style={{
        position:"fixed",bottom:0,left:"50%",transform:"translateX(-50%)",
        width:"100%",maxWidth:430,
        background:"rgba(13,13,13,0.96)",
        borderTop:`1px solid ${divLine}`,
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
              {isActive&&<div style={{width:16,height:1.5,background:G,borderRadius:2}}/>}
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
              <SettingsTab currentPlan={currentPlan} setShowPricing={setShowPricing} showToast={showToast} items={items} outfits={outfits} userName={userName} userEmail={userEmail} onSignOut={handleSignOut} userProfile={userProfile} saveProfile={saveProfile} styleProfile={styleProfile} saveStyleProfile={saveStyleProfile} session={session} onViewOwnProfile={()=>{const uid=session?.user?.id;if(uid){setViewProfile({userId:uid,username:userProfile?.username||userName});}}}/>
            </div>
          </div>
        </div>
      )}

      {/* ── OVERLAYS ── */}
      <ItemDetail
        item={selectedItem}
        onClose={()=>setSelectedItem(null)}
        onAddToOutfit={()=>{setTab("outfits");showToast("Opening outfit builder \u2746");}}
        showToast={showToast}
        onRemove={(id)=>{ setItems(prev=>prev.filter(i=>i.id!==id)); deleteItemFromDB(id); }}
        onUpdate={(updated)=>{
          setItems(prev=>prev.map(i=>i.id===updated.id?updated:i));
          setSelectedItem(updated);
          // Persist to Supabase
          if(session?.access_token){
            // Handle image upload if it's a new base64
            const persist = async () => {
              let sourceImageUrl = updated.sourceImage;
              if(sourceImageUrl?.startsWith("data:")){
                const userId = session.user?.id ||
                  (() => { try { return JSON.parse(atob(session.access_token.split(".")[1])).sub; } catch(e){ return null; } })();
                if(userId) sourceImageUrl = await sb.uploadPhoto(session.access_token, userId, sourceImageUrl) || sourceImageUrl;
              }
              sb.update("items", session.access_token, updated.id, {
                name: updated.name,
                brand: updated.brand,
                price: updated.price,
                purchase_date: updated.purchaseDate,
                category: updated.category,
                source_image: sourceImageUrl,
              }).catch(e=>console.error("update item error:", e));
              // Sync feed posts — update item_image on matching feed_events
              if(sourceImageUrl){
                const userId2 = session.user?.id ||
                  (() => { try { return JSON.parse(atob(session.access_token.split(".")[1])).sub; } catch(e){ return null; } })();
                if(userId2){
                  const oldImageUrl = updated._oldSourceImage;
                  const queries = [];
                  if(oldImageUrl && oldImageUrl.startsWith("http")){
                    // Match by old image URL only — no user_id filter since it may differ across sessions
                    queries.push(fetch(`${SB_URL}/rest/v1/feed_events?item_image=eq.${encodeURIComponent(oldImageUrl)}`,{
                      method:"PATCH",
                      headers:{...sbHeaders(session.access_token),"Prefer":"return=representation"},
                      body:JSON.stringify({item_image:sourceImageUrl}),
                    }));
                  }
                  // Fallback: match by item name across all your events (no user_id filter)
                  if(updated.name){
                    queries.push(fetch(`${SB_URL}/rest/v1/feed_events?item_name=eq.${encodeURIComponent(updated.name)}`,{
                      method:"PATCH",
                      headers:{...sbHeaders(session.access_token),"Prefer":"return=representation"},
                      body:JSON.stringify({item_image:sourceImageUrl}),
                    }));
                  }
                  const results = await Promise.all(queries.map(q=>q.then(r=>r.json()).catch(()=>[])));
                  const totalUpdated = results.flat().filter(r=>r?.id).length;
                  console.log("feed sync rows updated:", totalUpdated);
                  if(totalUpdated > 0){
                    showToast(`Feed updated \u2746`);
                    setLiveEvents(prev=>prev.map(e=>
                      (e.item_image===oldImageUrl || e.item_name===updated.name)
                        ? {...e, item_image:sourceImageUrl}
                        : e
                    ));
                  } else {
                    showToast(`No matching feed posts found`);
                    console.log("No match. oldImage:", oldImageUrl, "name:", updated.name);
                  }
                }
                // Update liveEvents in memory immediately — no reload needed
                setLiveEvents(prev=>prev.map(e=>
                  (e.user_id===userId2 && e.item_name===updated.name)
                    ? {...e, item_image:sourceImageUrl}
                    : e
                ));
              }
            };
            persist();
          }
        }}
      />

      {showPricing && (
        <PricingModal onClose={()=>setShowPricing(false)} onSubscribe={handleSubscribe} currentPlan={currentPlan} />

      )}

      {/* Push notification preview (new) */}
      {showPushNotifs && (
        <PushNotifPreview onClose={()=>setShowPushNotifs(false)} showToast={showToast} session={session} notifs={liveNotifs} setNotifs={setLiveNotifs} notifsLoaded={notifsLoaded} setNotifsLoaded={setNotifsLoaded}/>
      )}


      {/* ── CAPSULE COLLECTIONS OVERLAY ── */}

      {/* ── ONBOARDING ── */}
      {showOnboarding && <Onboarding onDone={()=>{setShowOnboarding(false);advanceOnboard(1);}}/>}

      {/* App-level profile overlay — works from any tab including Settings */}
      {viewProfile&&tab!=="home"&&<UserProfilePage
        handle={typeof viewProfile==="string"?viewProfile:null}
        userId={viewProfile?.userId||null}
        username={viewProfile?.username||null}
        session={session}
        onClose={()=>setViewProfile(null)}
        onViewProfile={(u)=>setViewProfile(u)}
        showToast={showToast}
        onAddToCloset={async(item)=>{
          const newItem={...item,id:Date.now(),wearCount:0,lastWorn:"Never",purchaseDate:"",forSale:false};
          setItems(prev=>[...prev,newItem]);
          await saveItemToDB(newItem);
          showToast("Added to closet \u2746");
        }}
        addToWishlist={addToWishlist}
      />}

      <Toast msg={toast} />
    </div>
  );
}