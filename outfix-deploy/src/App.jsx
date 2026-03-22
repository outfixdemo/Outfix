import { useState, useRef, useEffect } from "react";

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
    setLoading(true); setError("");
    try {
      if (mode === "signup") {
        const res = await sb.signUp(email.trim(), password, name.trim());
        const err = res.error || res.error_description;
        if (err) { setError(typeof err === "string" ? err : err.message || "Sign up failed"); setLoading(false); return; }
        if (!res.access_token) {
          setLoading(false);
          alert("Account created! Please check your email and click the confirmation link before signing in.");
          setMode("signin");
          return;
        }
        // Account created — go to username step before entering app
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

// ── DATA ────────────────────────────────────────────────────────────────────
const initItems = [
  { id:1,  name:"Silk Ivory Blouse",    brand:"Aritzia",         category:"Tops",        color:"#F5F0E8", price:180,  tags:["elegant","office","demo"],    forSale:false, emoji:"👚", wearCount:12, lastWorn:"2 days ago",  purchaseDate:"Jan 2023", condition:"Excellent", sourceImage:null},
  { id:2,  name:"Wide Leg Trousers",    brand:"COS",             category:"Bottoms",     color:"#2C3E50", price:120,  tags:["minimal","office","demo"],    forSale:false, emoji:"👖", wearCount:18, lastWorn:"Yesterday",   purchaseDate:"Mar 2023", condition:"Good",     sourceImage:null},
  { id:3,  name:"Cashmere Crewneck",    brand:"Everlane",        category:"Tops",        color:"#C4A882", price:150,  tags:["cozy","casual","demo"],       forSale:false, emoji:"🧶", wearCount:9,  lastWorn:"1 week ago",  purchaseDate:"Oct 2022", condition:"Good",     sourceImage:null},
  { id:4,  name:"Mini Leather Skirt",   brand:"& Other Stories", category:"Bottoms",     color:"#1A1A1A", price:95,   tags:["edgy","night-out","demo"],    forSale:true,  emoji:"🩱", wearCount:3,  lastWorn:"3 months ago",purchaseDate:"Jun 2023", condition:"Like New", sourceImage:null},
  { id:5,  name:"Trench Coat",          brand:"Burberry",        category:"Outerwear",   color:"#C8A96E", price:1200, tags:["classic","rainy","demo"],     forSale:false, emoji:"🧥", wearCount:22, lastWorn:"4 days ago",  purchaseDate:"Feb 2021", condition:"Excellent",sourceImage:null},
  { id:6,  name:"White Sneakers",       brand:"Common Projects", category:"Shoes",       color:"#F5F5F0", price:420,  tags:["minimal","casual","demo"],    forSale:false, emoji:"👟", wearCount:41, lastWorn:"Today",       purchaseDate:"Apr 2022", condition:"Good",     sourceImage:null},
  { id:7,  name:"Slingback Heels",      brand:"Mango",           category:"Shoes",       color:"#1A1A1A", price:89,   tags:["elegant","office","demo"],    forSale:true,  emoji:"👠", wearCount:5,  lastWorn:"2 weeks ago", purchaseDate:"Sep 2023", condition:"Like New", sourceImage:null},
  { id:8,  name:"Gold Hoop Earrings",   brand:"Mejuri",          category:"Accessories", color:"#D4AF37", price:68,   tags:["everyday","gold","demo"],     forSale:false, emoji:"💛", wearCount:55, lastWorn:"Today",       purchaseDate:"Dec 2021", condition:"Excellent",sourceImage:null},
  { id:9,  name:"Linen Midi Dress",     brand:"Faithfull",       category:"Dresses",     color:"#E8DDD0", price:220,  tags:["summer","vacation","demo"],   forSale:false, emoji:"👗", wearCount:7,  lastWorn:"1 month ago", purchaseDate:"May 2023", condition:"Excellent",sourceImage:null},
  { id:10, name:"Merino Cardigan",      brand:"Uniqlo",          category:"Tops",        color:"#B0C4DE", price:59,   tags:["cozy","layering","demo"],     forSale:false, emoji:"🧣", wearCount:2,  lastWorn:"Never",       purchaseDate:"Nov 2023", condition:"Like New", sourceImage:null},
  // ── Tops ──
  { id:11, name:"Fitted Turtleneck",    brand:"Toteme",          category:"Tops",        color:"#F0EBE3", price:195,  tags:["minimal","elegant","demo"],   forSale:false, emoji:"👕", wearCount:6,  lastWorn:"5 days ago",  purchaseDate:"Sep 2023", condition:"Excellent",sourceImage:null},
  { id:12, name:"Striped Linen Shirt",  brand:"Sézane",          category:"Tops",        color:"#1A2A3A", price:110,  tags:["casual","summer","demo"],     forSale:false, emoji:"👔", wearCount:14, lastWorn:"Last week",   purchaseDate:"Apr 2023", condition:"Good",     sourceImage:null},
  // ── Bottoms ──
  { id:13, name:"Straight Leg Jeans",   brand:"Agolde",          category:"Bottoms",     color:"#4A6080", price:198,  tags:["casual","weekend","demo"],    forSale:false, emoji:"👖", wearCount:24, lastWorn:"2 days ago",  purchaseDate:"Jan 2023", condition:"Good",     sourceImage:null},
  { id:14, name:"Tailored Trousers",    brand:"COS",             category:"Bottoms",     color:"#3A3028", price:130,  tags:["office","minimal","demo"],    forSale:false, emoji:"👖", wearCount:11, lastWorn:"3 days ago",  purchaseDate:"Aug 2023", condition:"Excellent",sourceImage:null},
  { id:15, name:"Pleated Midi Skirt",   brand:"& Other Stories", category:"Bottoms",     color:"#D4C4A8", price:85,   tags:["feminine","elegant","demo"],  forSale:false, emoji:"🩳", wearCount:4,  lastWorn:"2 weeks ago", purchaseDate:"Mar 2024", condition:"Like New", sourceImage:null},
  // ── Dresses ──
  { id:16, name:"Wrap Silk Dress",      brand:"Vince",           category:"Dresses",     color:"#C4A882", price:380,  tags:["evening","elegant","demo"],   forSale:false, emoji:"👗", wearCount:5,  lastWorn:"Last month",  purchaseDate:"Nov 2022", condition:"Excellent",sourceImage:null},
  { id:17, name:"Knit Mini Dress",      brand:"Reformation",     category:"Dresses",     color:"#1A1A1A", price:248,  tags:["night-out","edgy","demo"],    forSale:false, emoji:"🩱", wearCount:3,  lastWorn:"6 weeks ago", purchaseDate:"Oct 2023", condition:"Like New", sourceImage:null},
  { id:18, name:"Floral Midi Dress",    brand:"Ulla Johnson",    category:"Dresses",     color:"#D0B8C0", price:395,  tags:["romantic","spring","demo"],   forSale:false, emoji:"👗", wearCount:2,  lastWorn:"Never",       purchaseDate:"Feb 2024", condition:"Like New", sourceImage:null},
  // ── Outerwear ──
  { id:19, name:"Oversized Blazer",     brand:"Zara",            category:"Outerwear",   color:"#E8E0D0", price:120,  tags:["office","smart","demo"],      forSale:false, emoji:"🥼", wearCount:17, lastWorn:"Yesterday",   purchaseDate:"Oct 2022", condition:"Good",     sourceImage:null},
  { id:20, name:"Wool Coat",            brand:"Arket",           category:"Outerwear",   color:"#8A7060", price:350,  tags:["winter","classic","demo"],    forSale:false, emoji:"🧥", wearCount:12, lastWorn:"Last week",   purchaseDate:"Dec 2021", condition:"Good",     sourceImage:null},
  { id:21, name:"Denim Jacket",         brand:"Levi's",          category:"Outerwear",   color:"#4A6080", price:98,   tags:["casual","weekend","demo"],    forSale:false, emoji:"🧥", wearCount:8,  lastWorn:"4 days ago",  purchaseDate:"May 2022", condition:"Good",     sourceImage:null},
  // ── Shoes ──
  { id:22, name:"Ankle Boots",          brand:"Vagabond",        category:"Shoes",       color:"#2A1A0A", price:180,  tags:["casual","versatile","demo"],  forSale:false, emoji:"👢", wearCount:19, lastWorn:"3 days ago",  purchaseDate:"Sep 2021", condition:"Good",     sourceImage:null},
  { id:23, name:"Loafers",              brand:"Gucci",           category:"Shoes",       color:"#1A1A1A", price:750,  tags:["smart","office","demo"],      forSale:false, emoji:"👞", wearCount:10, lastWorn:"Last week",   purchaseDate:"Mar 2022", condition:"Excellent",sourceImage:null},
  { id:24, name:"Strappy Sandals",      brand:"Mango",           category:"Shoes",       color:"#C8A96E", price:65,   tags:["summer","casual","demo"],     forSale:false, emoji:"👡", wearCount:6,  lastWorn:"Last month",  purchaseDate:"Apr 2023", condition:"Good",     sourceImage:null},
  // ── Accessories ──
  { id:25, name:"Silk Neck Scarf",      brand:"Hermès",          category:"Accessories", color:"#C04030", price:450,  tags:["elegant","colorful","demo"],  forSale:false, emoji:"🧣", wearCount:8,  lastWorn:"Last week",   purchaseDate:"Jun 2021", condition:"Excellent",sourceImage:null},
  { id:26, name:"Leather Belt",         brand:"A.P.C.",          category:"Accessories", color:"#2A1A0A", price:120,  tags:["minimal","everyday","demo"],  forSale:false, emoji:"👜", wearCount:30, lastWorn:"Yesterday",   purchaseDate:"Jan 2022", condition:"Good",     sourceImage:null},
];

const initOutfits = [
  { id:1, name:"Office Chic",   items:[1,2,7,8], occasion:"Work",   season:"All Year",   wornHistory:["2026-03-11","2026-03-05","2026-02-27"] },
  { id:2, name:"Weekend Ease",  items:[3,2,6],   occasion:"Casual", season:"All Year",   wornHistory:["2026-03-08","2026-03-01"] },
  { id:3, name:"Summer Soiree", items:[9,8],     occasion:"Social Event", season:"All Year", wornHistory:["2026-03-07"] },
];

const suggestions = [
  { id:1, trigger:"Silk Ivory Blouse",  suggestion:"Wide Leg Trousers + Slingback Heels + Gold Hoops", vibe:"Parisian Office",  score:97 },
  { id:2, trigger:"Mini Leather Skirt", suggestion:"Cashmere Crewneck + White Sneakers",               vibe:"Cool Casual",       score:94 },
  { id:3, trigger:"Trench Coat",        suggestion:"Linen Midi Dress + Slingback Heels",               vibe:"Effortless Chic",  score:91 },
];

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

const feedItems = [
  { id:1, user:"@jess.styles",    followers:"12.4k", outfit:"Sunday Market Run",      avatar:"🌸", likes:284,  time:"2h ago",
    items:[
      {emoji:"👖",name:"Vintage Levi 501",      brand:"Levi's",          price:45,  forSale:true,  category:"Bottoms",     color:"#3A4A5A", condition:"Good",      sourceImage:null},
      {emoji:"👟",name:"New Balance 574",        brand:"New Balance",     price:110, forSale:false, category:"Shoes",       color:"#D0C8BE", condition:"Good",      sourceImage:null},
      {emoji:"🧣",name:"Ribbed Wool Scarf",      brand:"Arket",           price:65,  forSale:true,  category:"Accessories", color:"#C4A882", condition:"Excellent", sourceImage:null},
    ]},
  { id:2, user:"@minimal.edit",   followers:"8.1k",  outfit:"All-Black Everything",   avatar:"🖤", likes:519,  time:"5h ago",
    items:[
      {emoji:"🩱",name:"Fitted Bodysuit",        brand:"Toteme",          price:180, forSale:false, category:"Tops",        color:"#1A1A1A", condition:"Excellent", sourceImage:null},
      {emoji:"🧥",name:"Oversized Blazer",       brand:"Zara",            price:89,  forSale:true,  category:"Outerwear",   color:"#1A1A1A", condition:"Good",      sourceImage:null},
      {emoji:"👠",name:"Block Heel Mules",       brand:"& Other Stories", price:120, forSale:true,  category:"Shoes",       color:"#1A1A1A", condition:"Like New",  sourceImage:null},
    ]},
  { id:3, user:"@the.closet.co",  followers:"31k",   outfit:"Linen and Light",        avatar:"🌿", likes:1203, time:"1d ago",
    items:[
      {emoji:"👗",name:"Linen Wrap Dress",       brand:"Faithfull",       price:240, forSale:false, category:"Dresses",     color:"#E8DDD0", condition:"Excellent", sourceImage:null},
      {emoji:"💛",name:"Gold Pendant Necklace",  brand:"Mejuri",          price:95,  forSale:false, category:"Accessories", color:"#D4AF37", condition:"Excellent", sourceImage:null},
      {emoji:"👡",name:"Strappy Sandals",        brand:"Mango",           price:79,  forSale:true,  category:"Shoes",       color:"#C8A96E", condition:"Good",      sourceImage:null},
    ]},
  { id:4, user:"@curated.claire", followers:"4.2k",  outfit:"Board Room Energy",      avatar:"💼", likes:97,   time:"1d ago",
    items:[
      {emoji:"🥼",name:"Camel Trench Coat",      brand:"Toteme",          price:590, forSale:false, category:"Outerwear",   color:"#C8A96E", condition:"Excellent", sourceImage:null},
      {emoji:"👖",name:"Tailored Trousers",      brand:"COS",             price:95,  forSale:true,  category:"Bottoms",     color:"#2C3E50", condition:"Good",      sourceImage:null},
      {emoji:"💼",name:"Structured Tote",        brand:"Polene",          price:350, forSale:false, category:"Accessories", color:"#8A7060", condition:"Excellent", sourceImage:null},
    ]},
  { id:5, user:"@jess.styles",    followers:"12.4k", outfit:"Golden Hour Walk",        avatar:"🌸", likes:441,  time:"2d ago",
    items:[
      {emoji:"🧥",name:"Caramel Wool Coat",      brand:"Sandro",          price:420, forSale:false, category:"Outerwear",   color:"#C8A050", condition:"Excellent", sourceImage:null},
      {emoji:"👗",name:"Slip Midi Skirt",        brand:"Reformation",     price:178, forSale:true,  category:"Bottoms",     color:"#D4B896", condition:"Like New",  sourceImage:null},
      {emoji:"👢",name:"Ankle Boots",            brand:"Vagabond",        price:160, forSale:false, category:"Shoes",       color:"#2A1A0A", condition:"Good",      sourceImage:null},
    ]},
  { id:6, user:"@minimal.edit",   followers:"8.1k",  outfit:"Quiet Saturday",         avatar:"🖤", likes:308,  time:"2d ago",
    items:[
      {emoji:"👚",name:"Relaxed Linen Shirt",    brand:"& Other Stories", price:75,  forSale:true,  category:"Tops",        color:"#F0EBE3", condition:"Good",      sourceImage:null},
      {emoji:"👖",name:"Straight Leg Jeans",     brand:"Agolde",          price:220, forSale:false, category:"Bottoms",     color:"#6A8090", condition:"Excellent", sourceImage:null},
      {emoji:"🎒",name:"Mini Leather Backpack",  brand:"A.P.C.",          price:385, forSale:false, category:"Accessories", color:"#1A1A1A", condition:"Excellent", sourceImage:null},
    ]},
  { id:7, user:"@the.closet.co",  followers:"31k",   outfit:"Parisian Errand Day",    avatar:"🌿", likes:892,  time:"3d ago",
    items:[
      {emoji:"🧶",name:"Striped Marinière",      brand:"Saint James",     price:130, forSale:false, category:"Tops",        color:"#1A2A3A", condition:"Excellent", sourceImage:null},
      {emoji:"🩱",name:"High Waist Trousers",    brand:"Jacquemus",       price:310, forSale:true,  category:"Bottoms",     color:"#2C3E50", condition:"Like New",  sourceImage:null},
      {emoji:"👜",name:"Baguette Bag",           brand:"Fendi",           price:890, forSale:false, category:"Accessories", color:"#D4A870", condition:"Excellent", sourceImage:null},
    ]},
  { id:8, user:"@curated.claire", followers:"4.2k",  outfit:"Spring Edit",            avatar:"💼", likes:163,  time:"3d ago",
    items:[
      {emoji:"🌸",name:"Floral Midi Dress",      brand:"Ulla Johnson",    price:395, forSale:true,  category:"Dresses",     color:"#E0C8D0", condition:"Excellent", sourceImage:null},
      {emoji:"👡",name:"Kitten Heel Mules",      brand:"Manolo Blahnik",  price:650, forSale:false, category:"Shoes",       color:"#C8A096", condition:"Like New",  sourceImage:null},
      {emoji:"💛",name:"Demi-fine Ring Set",     brand:"Mejuri",          price:145, forSale:false, category:"Accessories", color:"#D4AF37", condition:"Excellent", sourceImage:null},
    ]},
  { id:9, user:"@jess.styles",    followers:"12.4k", outfit:"Museum Day",             avatar:"🌸", likes:227,  time:"4d ago",
    items:[
      {emoji:"🧥",name:"Oversized Denim Jacket", brand:"Levi's",          price:98,  forSale:true,  category:"Outerwear",   color:"#4A6080", condition:"Good",      sourceImage:null},
      {emoji:"👗",name:"White Maxi Dress",       brand:"Staud",           price:295, forSale:false, category:"Dresses",     color:"#F5F5F0", condition:"Excellent", sourceImage:null},
      {emoji:"👜",name:"Canvas Tote",            brand:"Baggu",           price:38,  forSale:false, category:"Accessories", color:"#E8E0D4", condition:"Good",      sourceImage:null},
    ]},
  { id:10, user:"@minimal.edit",  followers:"8.1k",  outfit:"Evening Architecture",   avatar:"🖤", likes:674,  time:"4d ago",
    items:[
      {emoji:"🥼",name:"Structured Blazer Dress",brand:"The Row",         price:1850,forSale:false, category:"Dresses",     color:"#1A1A1A", condition:"Like New",  sourceImage:null},
      {emoji:"💍",name:"Sculptural Cuff",        brand:"Bottega Veneta",  price:480, forSale:true,  category:"Accessories", color:"#D4AF37", condition:"Excellent", sourceImage:null},
      {emoji:"👠",name:"Pointed Toe Pumps",      brand:"Gianvito Rossi",  price:790, forSale:false, category:"Shoes",       color:"#1A1A1A", condition:"Excellent", sourceImage:null},
    ]},
];

const initWishlist = [
  { id:1, emoji:"👜", name:"Toteme Tote",    brand:"Toteme", price:490, gap:"Missing a structured bag",    inMarket:false, sourceImage:null },
  { id:2, emoji:"🥾", name:"Chelsea Boots",  brand:"Sezane", price:270, gap:"No transitional footwear",    inMarket:true, sourceImage:null  },
  { id:3, emoji:"🧤", name:"Leather Gloves", brand:"Agnelle",price:120, gap:"No cold-weather accessories", inMarket:false, sourceImage:null },
];

const calendarEvents = [
  { id:1, date:"Mon Mar 10", label:"Team Presentation",  occasion:"Work",    suggestedOutfit:1, emoji:"💼" },
  { id:2, date:"Fri Mar 14", label:"Birthday Dinner",    occasion:"Evening", suggestedOutfit:3, emoji:"🥂" },
  { id:3, date:"Sat Mar 15", label:"Farmers Market",     occasion:"Casual",  suggestedOutfit:2, emoji:"☀️" },
  { id:4, date:"Sun Mar 16", label:"Brunch with Friends",occasion:"Casual",  suggestedOutfit:2, emoji:"🌿" },
];


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

// Insurance / valuation data (augments initItems)
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

function Btn({children,onClick,full,outline,small}){
  const p = small?"7px 14px":"12px 20px";
  return(
    <button className="sb" onClick={onClick} style={{
      width:full?"100%":"auto", padding:p, borderRadius:14,
      background:outline?"#1E1E1E":`linear-gradient(135deg,${G},#8A6E54)`,
      border:outline?"1px solid #2A2A2A":"none",
      ...ss(9,600,outline?MD:BK,{letterSpacing:1.5}), cursor:_p,
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
        const hex=`#${r.toString(16).padStart(2,"0")}${g.toString(16).padStart(2,"0")}${b.toString(16).padStart(2,"0")}`;
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
function ClosetItemCard({item,isFav,onSelect,onToggleFav}){
  const bg=useImageBg(item.sourceImage, item.color||"#1A1A1A");
  return(
    <div className="ch" onClick={onSelect} style={{background:CD,borderRadius:16,overflow:"hidden",border:`1px solid ${BR}`,position:"relative"}}>
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
            <div style={{width:8,height:8,borderRadius:"50%",background:item.color,border:"1px solid #FFFFFF22",flexShrink:0}}/>
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
function HomeTab({items,outfits,showToast,setTab,setWishlist,addToWishlist,removeFromWishlist,setItems,session,onAddToCloset}){
  const [liked,setLiked]         = useState({});
  const [activeItem,setActiveItem] = useState(null);
  const [viewProfile,setViewProfile] = useState(null);
  const [visibleCount,setVisibleCount] = useState(4);
  const [showSearch,setShowSearch] = useState(false);
  const [searchQuery,setSearchQuery] = useState("");
  const [userResults,setUserResults] = useState([]);
  const [searchLoading,setSearchLoading] = useState(false);
  const [selectedTrend,setSelectedTrend]=useState(null);
  const searchRef = useRef(null);
  const searchTimer = useRef(null);

  const now = new Date();
  const dayName = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][now.getDay()];
  const greeting = now.getHours()<12?"Morning":now.getHours()<17?"Afternoon":"Evening";
  const nextEvent = calendarEvents[1]||calendarEvents[0];
  const nextOutfit = nextEvent ? outfits.find(o=>o.id===nextEvent.suggestedOutfit)||outfits[0] : null;
  const nextOutfitItems = nextOutfit ? (nextOutfit.items||[]).map(id=>items.find(i=>i.id===id)).filter(Boolean) : [];

  // Feed helpers
  const getFeedItem=(feedId,itemIdx)=>{ const f=feedItems.find(f=>f.id===feedId); return f?f.items[itemIdx]:null; };
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

  // ── Render a single community post card ──
  const PostCard = ({feed})=>{
    const Pic = outfitPortraits[(feed.id-1)%outfitPortraits.length];
    return(
      <div style={{background:CD,borderRadius:20,overflow:"hidden",marginBottom:16,border:`1px solid ${BR}`}}>
        {/* Image */}
        <div style={{width:"100%",position:"relative",background:_1a}}>
          <div style={{width:"100%",paddingTop:"80%",position:"relative",overflow:"hidden"}}>
            <div style={{..._abs0}}><Pic/></div>
          </div>
          <div style={{position:"absolute",bottom:0,left:0,right:0,height:100,background:"linear-gradient(transparent,#141414EE)"}}/>
          <div style={{position:"absolute",bottom:14,left:16,right:16}}>
            <div style={{...sr(20,500,"#F0EBE3"),textShadow:"0 1px 8px #00000099"}}>{feed.outfit}</div>
          </div>
        </div>
        {/* User row */}
        <div style={{display:"flex",gap:12,alignItems:"center",padding:"14px 16px 0"}}>
          <div onClick={()=>setViewProfile(feed.user)} style={{width:40,height:40,borderRadius:"50%",background:"#2A2A2A",overflow:"hidden",flexShrink:0,cursor:_p,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20}}>{<AvatarPortrait user={feed.user} size={40}/>}</div>
          <div style={{flex:1,cursor:_p}} onClick={()=>setViewProfile(feed.user)}>
            <div style={ss(11,600,MD,{letterSpacing:0.5})}>{feed.user}</div>
            <div style={ss(9,400,DM)}>{feed.followers} followers · {feed.time}</div>
          </div>
          <button className="pb" onClick={()=>showToast("Following ❆")} style={{padding:"5px 12px",borderRadius:20,background:_1a,border:_2a,...ss(9,400,MD,{letterSpacing:1}),cursor:_p}}>FOLLOW</button>
        </div>
        {/* Item chips */}
        <div style={{padding:"12px 16px 0"}}>
          <div style={{display:"flex",gap:10,marginBottom:14,overflowX:"auto",paddingBottom:4}}>
            {feed.items.map((item,i)=>{
              const isSel=activeItem?.feedId===feed.id&&activeItem?.itemIdx===i;
              return(
                <div key={i} onClick={e=>{e.stopPropagation();setActiveItem(ai=>ai&&ai.feedId===feed.id&&ai.itemIdx===i?null:{feedId:feed.id,itemIdx:i});}}
                  style={{flexShrink:0,width:96,borderRadius:16,overflow:"hidden",border:`1.5px solid ${isSel?G:"#2A2A2A"}`,background:isSel?"#1A160F":"#1A1A1A",cursor:_p,transition:"all 0.2s",boxShadow:isSel?`0 0 0 2px ${G}44`:"none"}}>
                  <div style={{height:80,display:"flex",alignItems:"center",justifyContent:"center",background:isSel?"#241E12":"#1E1E1E",position:"relative",overflow:"hidden"}}>
                    {item.sourceImage?<img src={item.sourceImage} style={{width:"100%",height:"100%",objectFit:"cover"}} alt={item.name}/>:<ItemIllustration item={item} size={60}/>}
                    {item.forSale&&<div style={{position:"absolute",top:6,right:6,background:G,borderRadius:8,padding:"2px 5px",...ss(7,700,BK,{letterSpacing:0.5})}}>SALE</div>}
                    {isSel&&<div style={{position:"absolute",bottom:0,left:0,right:0,height:3,background:`linear-gradient(90deg,${G},#8A6E54)`}}/>}
                  </div>
                  <div style={{padding:"8px 8px 10px"}}>
                    <div style={ss(9,isSel?600:400,isSel?G:MD,{lineHeight:1.3,marginBottom:2,overflow:"hidden",display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical"})}>{item.name}</div>
                    <div style={ss(8,400,DM,{marginBottom:4})}>{item.brand}</div>
                    <div style={sr(12,500,G)}>${item.price}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        {/* Inline action panel */}
        <div style={{padding:"0 16px"}}>
          {activeItem?.feedId===feed.id&&(()=>{
            const selItem=getFeedItem(feed.id,activeItem.itemIdx);
            if(!selItem) return null;
            return(
              <div style={{background:"linear-gradient(135deg,#1A160F,#1E1A12)",borderRadius:14,padding:"14px 16px",marginBottom:14,border:`1px solid ${G}44`}}>
                <div style={{display:"flex",gap:10,alignItems:"center",marginBottom:12}}>
                  <ItemIllustration item={selItem} size={36}/>
                  <div style={{flex:1}}>
                    <div style={sr(14,500,G)}>{selItem.name}</div>
                    <div style={ss(9,400,DM,{marginTop:2})}>{selItem.brand} · ${selItem.price}</div>
                  </div>
                  <button className="tb" onClick={()=>setActiveItem(null)} style={{...ss(14,400,DM),padding:4}}>×</button>
                </div>
                <div style={{display:"flex",gap:8}}>
                  <button className="sb" onClick={()=>handleWishlist(selItem)} style={{flex:1,padding:"10px",borderRadius:12,background:_1a,border:_2a,...ss(9,600,MD,{letterSpacing:1}),cursor:_p}}>♡ SAVE</button>
                  <button className="sb" onClick={()=>handleAddToCloset(selItem)} style={{flex:1,padding:"10px",borderRadius:12,background:"#1A2A1A",border:"1px solid #2A4A2A",...ss(9,600,"#80C080",{letterSpacing:1}),cursor:_p}}>+ CLOSET</button>
                  {selItem.forSale
                    ?<button className="sb" onClick={()=>handleOffer(selItem)} style={{flex:1,padding:"10px",borderRadius:12,background:`linear-gradient(135deg,${G},#8A6E54)`,border:"none",...ss(9,600,BK,{letterSpacing:1}),cursor:_p}}>OFFER</button>
                    :<button className="sb" onClick={()=>{showToast("Message sent ❆");setActiveItem(null);}} style={{flex:1,padding:"10px",borderRadius:12,background:"#1A2A3A",border:"1px solid #2A3A4A",...ss(9,600,"#A0C0D4",{letterSpacing:1}),cursor:_p}}>ASK</button>
                  }
                </div>
              </div>
            );
          })()}
        </div>
        {/* Like row */}
        <div style={{..._btwn,padding:"8px 16px 16px"}}>
          <button className="pb" onClick={()=>setLiked(p=>({...p,[feed.id]:!p[feed.id]}))} style={{background:"none",border:"none",cursor:_p,display:"flex",alignItems:"center",gap:5,...ss(12,400,liked[feed.id]?"#E08080":MD)}}>
            {liked[feed.id]?"♥":"♡"} {(feed.likes+(liked[feed.id]?1:0)).toLocaleString()}
          </button>
          <button className="pb" onClick={()=>showToast("Full look saved ❆")} style={{padding:"5px 12px",borderRadius:20,background:_1a,border:_2a,...ss(9,400,MD,{letterSpacing:1}),cursor:_p}}>SAVE LOOK</button>
        </div>
      </div>
    );
  };

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

  // Build interleaved feed: posts + trend cards every 3 posts
  const interleavedFeed=[];
  const visibleFeed=feedItems.slice(0,visibleCount);
  visibleFeed.forEach((feed,i)=>{
    interleavedFeed.push({type:"post",data:feed});
    if((i+1)%3===0 && i<visibleFeed.length-1){
      const trendIdx=Math.floor((i+1)/3)-1;
      if(trendIdx<trendItems.length) interleavedFeed.push({type:"trend",data:trendItems[trendIdx]});
    }
  });

  return(
    <div style={{padding:"0 16px 24px"}}>

      {/* ── Search bar ── */}
      <div onClick={()=>{setShowSearch(true);setTimeout(()=>searchRef.current?.focus(),50);}}
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
                        `${SB_URL}/rest/v1/profiles?or=(username.ilike.*${encodeURIComponent(q)}*,bio.ilike.*${encodeURIComponent(q)}*)&select=id,username,bio,location,style_identity&limit=10`,
                        {headers:{"Authorization":`Bearer ${token}`,"apikey":SB_KEY}}
                      );
                      const data=await res.json();
                      setUserResults(Array.isArray(data)?data.filter(u=>u.username):[]);
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
              <>
                <div style={ss(9,600,DM,{letterSpacing:1.5,marginBottom:14})}>SUGGESTED FOR YOU</div>
                {[
                  {handle:"@minimal.edit",   name:"Maya Chen",     followers:"8.1k",  style:"Minimal · Monochrome",   mutual:2},
                  {handle:"@the.closet.co",  name:"Sofia Reyes",   followers:"31k",   style:"Quiet Luxury",           mutual:4},
                  {handle:"@jess.styles",    name:"Jessica Park",  followers:"12.4k", style:"Vintage · Casual",       mutual:1},
                  {handle:"@curated.claire", name:"Claire Dubois", followers:"4.2k",  style:"Classic · Parisian",     mutual:3},
                ].map(acct=>(
                  <div key={acct.handle} style={{..._row,gap:12,marginBottom:16,cursor:_p}} onClick={()=>showToast(`Viewing ${acct.name} \u2746`)}>
                    <div style={{width:46,height:46,borderRadius:"50%",background:`linear-gradient(135deg,${G}33,${G}55)`,border:`1px solid ${G}44`,overflow:"hidden",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                      <AvatarPortrait user={acct.handle} size={36}/>
                    </div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={ss(11,600,"#E8E0D4")}>{acct.name}</div>
                      <div style={ss(9,400,DM,{marginTop:1})}>{acct.handle} · {acct.followers} followers</div>
                      <div style={ss(8,400,DM,{fontStyle:"italic",marginTop:1})}>{acct.style}{acct.mutual>0?` · ${acct.mutual} mutual`:""}</div>
                    </div>
                    <button onClick={e=>{e.stopPropagation();showToast(`Following ${acct.name} \u2746`);}}
                      style={{padding:"6px 14px",borderRadius:20,background:`${G}22`,border:`1px solid ${G}55`,...ss(9,600,G,{letterSpacing:0.5}),cursor:_p,flexShrink:0}}>
                      Follow
                    </button>
                  </div>
                ))}
              </>
            ) : (
              <>
                {searchLoading&&(
                  <div style={{textAlign:"center",padding:"32px 0"}}>
                    <div style={{fontSize:22,animation:"spin 1s linear infinite",display:"inline-block",marginBottom:8}}>✦</div>
                    <div style={ss(10,400,DM)}>Searching users…</div>
                  </div>
                )}
                {!searchLoading&&userResults.length>0&&(
                  <>
                    <div style={ss(9,600,DM,{letterSpacing:1.5,marginBottom:12})}>USERS</div>
                    {userResults.map(u=>(
                      <div key={u.id} style={{..._row,gap:12,marginBottom:14,cursor:_p,background:CD,borderRadius:14,padding:"12px 14px",border:`1px solid ${BR}`}}
                        onClick={()=>{setViewProfile({userId:u.id,username:u.username});setShowSearch(false);setSearchQuery("");}}>
                        <div style={{width:46,height:46,borderRadius:"50%",background:`linear-gradient(135deg,${G}33,${G}55)`,border:`1px solid ${G}44`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,...ss(20,400)}}>
                          {u.username?.[0]?.toUpperCase()||"?"}
                        </div>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={ss(13,600,"#E8E0D4")}>@{u.username}</div>
                          {u.bio&&<div style={ss(9,400,DM,{marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"})}>{u.bio}</div>}
                          {u.location&&<div style={ss(9,400,DM,{marginTop:1})}>📍 {u.location}</div>}
                        </div>
                        <div style={ss(10,400,G,{flexShrink:0})}>›</div>
                      </div>
                    ))}
                  </>
                )}
                {!searchLoading&&userResults.length===0&&searchQuery.trim().length>=1&&(
                  <div style={{textAlign:"center",padding:"48px 0"}}>
                    <div style={{fontSize:32,marginBottom:12}}>🔍</div>
                    <div style={sr(15,300,DM,{fontStyle:"italic",marginBottom:6})}>No users found for "{searchQuery}"</div>
                    <div style={ss(9,400,DM)}>Try searching by exact username</div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Feed: Event card → posts + trends ── */}
      <EventCard/>
      {interleavedFeed.map((entry,i)=>
        entry.type==="post"
          ? <PostCard key={`post-${entry.data.id}`} feed={entry.data}/>
          : <FeedTrendCard key={`trend-${entry.data.id}`} trend={entry.data}/>
      )}

      {/* Load More */}
      {visibleCount < feedItems.length && (
        <button onClick={()=>setVisibleCount(v=>Math.min(v+3, feedItems.length))} style={{width:"100%",padding:"14px",borderRadius:14,background:CD,border:"1.5px solid #2A2A2A",marginBottom:16,...ss(10,600,MD,{letterSpacing:2}),cursor:_p}}>
          LOAD MORE
        </button>
      )}

      {/* ── User profile overlay ── */}
      {viewProfile&&<UserProfilePage
        handle={typeof viewProfile==="string"?viewProfile:null}
        userId={viewProfile?.userId||null}
        username={viewProfile?.username||null}
        session={session}
        onClose={()=>setViewProfile(null)}
        showToast={showToast}
        onAddToCloset={onAddToCloset}
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
  );
}

// ── CLOSET ───────────────────────────────────────────────────────────────────
function ClosetTab({items,setItems,setSelectedItem,showToast,wishlist,setWishlist,addToWishlist,removeFromWishlist,onSaveItem}){
  const [closetView,setClosetView]=useState("closet"); // "closet" | "wishlist"
  const [filterCat,setFilterCat]=useState("All");
  const [filterSale,setFilterSale]=useState(false);
  const [sortBy,setSortBy]=useState("default");
  const [closetSearch,setClosetSearch]=useState("");
  const [showFilterMenu,setShowFilterMenu]=useState(false);
  const [showSortExpanded,setShowSortExpanded]=useState(false);
  const [showCatExpanded,setShowCatExpanded]=useState(false);
  const [showAdd,setShowAdd]=useState(false);
  const [mName,setMName]=useState("");
  const [mBrand,setMBrand]=useState("");
  const [mPrice,setMPrice]=useState("");
  const [mCat,setMCat]=useState("Tops");
  const [mDate,setMDate]=useState("");
  const [mCondition,setMCondition]=useState("Good");
  const [mColor,setMColor]=useState("#C4A882");
  const [showBrandList,setShowBrandList]=useState(false);
  const [selectedWishItem,setSelectedWishItem]=useState(null);
  const [showReverseSearch,setShowReverseSearch]=useState(false);
  const [url,setUrl]=useState("");
  const [scanning,setScanning]=useState(false);
  const [scanned,setScanned]=useState(null);
  const [addMode,setAddMode]=useState(null);
  const [describeResults,setDescribeResults]=useState([]);
  const [describeLoading,setDescribeLoading]=useState(false);
  const [voiceStage,setVoiceStage]=useState("idle");
  const [transcript,setTranscript]=useState("");
  const [voiceDesc,setVoiceDesc]=useState("");
  const [favorites,setFavorites]=useState(new Set([1,9]));
  const [photoPreview,setPhotoPreview]=useState(null);
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
  const isFiltered = filterCat!=="All" || filterSale || sortBy!=="default" || closetSearch.trim()!=="";
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

  const doScan=async(file)=>{
    setScanning(true); setScanned(null); setDetectedItems([]); setSelectedDetected({});
    if(file && file.type.startsWith("image/")){
      const reader=new FileReader();
      reader.onload=async(e)=>{
        const dataUrl=e.target.result;
        setPhotoPreview(dataUrl);
        try{
          const base64=dataUrl.split(",")[1];
          const raw=await callClaudeVision(base64,file.type,
            `Identify ALL visible clothing items and accessories worn or shown in this image. Return ONLY JSON: {"items":[{"id":1,"name":"...","brand":"...","category":"Tops|Bottoms|Dresses|Outerwear|Shoes|Accessories","color":"#hexcode","price":150,"tags":["..."],"emoji":"👚","condition":"Like New"},...]}`
          );
          const json=JSON.parse(raw.replace(/```json|```/g,"").trim());
          const found=json.items||[];
          setScanning(false);
          if(found.length===1){
            setScannedItem({...found[0],wearCount:0,lastWorn:"Never",purchaseDate:"",forSale:false});
          } else if(found.length>1){
            setDetectedItems(found);
            // Pre-select all by default
            setSelectedDetected(Object.fromEntries(found.map(i=>[i.id,true])));
          }
        }catch(err){
          setScanning(false);
          showToast("Couldn't recognize item — please try again or describe it manually ❆");
        }
      };
      reader.readAsDataURL(file);
    } else {
      setScanning(false);
      showToast("Please upload an image file ❆");
    }
  };

  // Simulate voice recording then AI parse
  const startRecording=()=>{
    setVoiceStage("recording");
    setTranscript("");
    // Simulate live transcript appearing word by word
    const words=["navy","blue","wool","blazer","from","Zara,","size","small,","double-breasted,","gold","buttons,","paid","around","$120"];
    let i=0;
    const iv=setInterval(()=>{
      i++;
      setTranscript(words.slice(0,i).join(" "));
      if(i>=words.length){clearInterval(iv);setTimeout(()=>setVoiceStage("parsing"),600);}
    },200);
    // After parsing, show result
    setTimeout(()=>{
      setVoiceStage("done");
      setScannedItem({name:"Double-Breasted Wool Blazer",brand:"Zara",category:"Outerwear",color:"#1E2A3A",price:120,tags:["smart","office","evening"],emoji:"🥼",wearCount:0,lastWorn:"Never",purchaseDate:"",condition:"Like New",forSale:false});
    },5000);
  };

  const confirmAdd=()=>{
    const finalPrice = priceOverride.trim() ? parseInt(priceOverride) : scanned.price;
    const newItem={...scanned,id:Date.now(),price:finalPrice,sourceImage:photoPreview||undefined};
    setItems(prev=>[...prev,newItem]);
    if(onSaveItem) onSaveItem(newItem);
    closeAdd();
    showToast("Item added to your closet \u2746");
  };

  const confirmAddMulti=()=>{
    const toAdd=detectedItems.filter(i=>selectedDetected[i.id]);
    const now=Date.now();
    const newItems=toAdd.map((item,idx)=>({...item,id:now+idx,wearCount:0,lastWorn:"Never",purchaseDate:"",forSale:false,sourceImage:photoPreview||undefined}));
    setItems(prev=>[...prev,...newItems]);
    if(onSaveItem) newItems.forEach(item=>onSaveItem(item));
    closeAdd();
    showToast(`${toAdd.length} item${toAdd.length>1?"s":""} added to your closet \u2746`);
  };

  const closeAdd=()=>{setShowAdd(false);setScanned(null);setUrl("");setAddMode(null);setVoiceStage("idle");setTranscript("");setVoiceDesc("");setPhotoPreview(null);setDetectedItems([]);setSelectedDetected({});setDescribeResults([]);setDescribeLoading(false);setMName("");setMBrand("");setMPrice("");setMCat("Tops");setMDate("");setMCondition("Good");setMColor("#C4A882");setShowBrandList(false);};

  // Waveform bars for recording animation
  const WaveBar=({delay})=>(
    <div style={{width:3,borderRadius:2,background:G,animation:`wave 0.8s ease-in-out ${delay}s infinite alternate`}}/>
  );

  return(
    <div className="fu" style={{padding:"16px 24px"}}>
      <style>{`
        @keyframes wave{from{height:6px;opacity:0.4;}to{height:28px;opacity:1;}}
        @keyframes spin{from{transform:rotate(0deg);}to{transform:rotate(360deg);}}
      `}</style>

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
        <>
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
            <>
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
            </>
          )}
        </>
      )}

      {/* ── CLOSET VIEW ── */}
      {closetView==="closet"&&(<>

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
        {filtered.map(item=>{
          const isFav=favorites.has(item.id);
          return(
            <ClosetItemCard
              key={item.id}
              item={item}
              isFav={isFav}
              onSelect={()=>setSelectedItem(item)}
              onToggleFav={()=>toggleFav({stopPropagation:()=>{}},item.id)}
            />
          );
        })}
      </div>
      )}

      {/* ADD ITEM MODAL */}
      {showAdd && (
        <div onClick={closeAdd} style={{..._fix,background:"#000000AA",display:"flex",alignItems:"flex-start",zIndex:60}}>
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
                <button onClick={()=>{setAddMode(null);setVoiceStage("idle");setTranscript("");setVoiceDesc("");setScanned(null);}} style={{background:"none",border:"none",cursor:_p,...ss(12,400,DM)}}>← Back</button>
              )}
            </div>

            {/* ── DEFAULT OPTIONS (no mode selected) ── */}
            {!addMode && !scanned && !scanning && (
              <>
                <input ref={fileRef} type="file" accept="image/*" style={{display:"none"}} onChange={e=>{ if(e.target.files[0]) doScan(e.target.files[0]); }} />

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
                        // Fetch AI item details and real price/image from scraper in parallel
                        const [raw, productRes] = await Promise.all([
                          callClaude(
                            `A user pasted this product URL into a wardrobe app: "${url}"\n\nUsing the URL structure, domain, and any readable slug/path, identify the clothing item as accurately as possible. Infer the brand from the domain, the item name and category from the path, and estimate a realistic retail price. Return ONLY JSON: {"name":"...","brand":"...","category":"Tops|Bottoms|Dresses|Outerwear|Shoes|Accessories","color":"#hexcode","price":150,"tags":["..."],"emoji":"👚","condition":"Like New"}`
                          ),
                          fetch("/api/fetch-product", {
                            method:"POST",
                            headers:{"Content-Type":"application/json"},
                            body:JSON.stringify({url:url.trim()})
                          }).then(r=>r.json()).catch(()=>({price:null,image:null}))
                        ]);
                        const json=JSON.parse(raw.replace(/```json|```/g,"").trim());
                        // Use real scraped price if available, otherwise keep AI estimate
                        const finalPrice = productRes.price || json.price;
                        setScanning(false);
                        setScannedItem({...json,price:finalPrice,wearCount:0,lastWorn:"Never",purchaseDate:"",forSale:false,sourceImage:productRes.image||null});
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
              </>
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
                        `A user is describing a clothing item they want to add to their wardrobe app: "${voiceDesc}"\n\nGenerate 4 specific product matches with exact brand names and product names they might be describing. Return ONLY JSON:\n{"results":[{"name":"...","brand":"...","category":"Tops|Bottoms|Dresses|Outerwear|Shoes|Accessories","color":"#hexcode","price":150,"emoji":"👚","condition":"New","tags":["..."]},...]}`
                      );
                      const json=JSON.parse(raw.replace(/```json|```/g,"").trim());
                      const results = json.results||[];
                      // Fetch real product images via Google Image Search in parallel
                      const withImages = await Promise.all(results.map(async r=>{
                        try{
                          const imgRes = await fetch("/api/image-search",{
                            method:"POST",
                            headers:{"Content-Type":"application/json"},
                            body:JSON.stringify({query:`${r.brand} ${r.name} official product photo white background`})
                          }).then(x=>x.json()).catch(()=>({imageUrl:null}));
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
                          setScannedItem({...r,wearCount:0,lastWorn:"Never",purchaseDate:"",forSale:false,sourceImage:r.imageUrl||null});
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
                    setScannedItem({name:mName.trim(),brand:mBrand.trim()||"Unknown",category:mCat,color:mColor,price:parseInt(mPrice)||0,tags:[],emoji,condition:mCondition,wearCount:0,lastWorn:"Never",purchaseDate:mDate,forSale:false,sourceImage:null});
                  };
                  return(
                    <>
                      {/* Photo upload */}
                      <div style={{marginBottom:14}}>
                        <div style={ss(9,400,DM,{letterSpacing:1.5,marginBottom:8})}>PHOTO (OPTIONAL)</div>
                        <input ref={manualFileRef} type="file" accept="image/*" style={{display:"none"}} onChange={e=>{if(e.target.files[0]){const r=new FileReader();r.onload=ev=>setPhotoPreview(ev.target.result);r.readAsDataURL(e.target.files[0]);}}}/>
                        {photoPreview ? (
                          <div style={{position:"relative",borderRadius:14,overflow:"hidden",height:140,background:_1a}}>
                            <img src={photoPreview} style={{width:"100%",height:"100%",objectFit:"cover"}} alt="preview"/>
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

                      {/* Color swatches */}
                      <div style={{marginBottom:12}}>
                        <div style={ss(9,400,DM,{letterSpacing:1.5,marginBottom:8})}>COLOR</div>
                        <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
                          {colorSwatches.map(({name,hex})=>(
                            <button key={hex} onClick={()=>setMColor(hex)} title={name} style={{
                              width:32,height:32,borderRadius:"50%",background:hex,cursor:_p,
                              border:mColor===hex?`3px solid ${G}`:"2px solid #2A2A2A",
                              boxShadow:mColor===hex?`0 0 0 2px ${G}66`:"none",
                              flexShrink:0,transition:"all 0.15s",
                              outline:"none",
                            }}/>
                          ))}
                        </div>
                        <div style={{...ss(9,400,DM,{marginTop:6})}}>Selected: <span style={{color:G}}>{colorSwatches.find(c=>c.hex===mColor)?.name||"Custom"}</span></div>
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
                    </>
                  );
                })()}
              </div>
            )}

            {/* ── SCANNING (photo/url) ── */}
            {scanning && (
              <div style={{textAlign:"center",padding:"32px 0"}}>
                <div style={{fontSize:44,marginBottom:16,animation:"pulse 1.2s infinite"}}>🔍</div>
                <div style={sr(16,400,G,{marginBottom:6})}>Identifying item…</div>
                <div style={ss(10,400,DM,{marginBottom:20})}>Recognizing brand, category & details</div>
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
                  {/* Image box with pencil edit overlay */}
                  <div style={{position:"relative",width:72,height:72,flexShrink:0}}>
                    <input ref={photoOverrideRef} type="file" accept="image/*" style={{display:"none"}} onChange={e=>{
                      const file=e.target.files?.[0]; if(!file) return;
                      const reader=new FileReader();
                      reader.onload=ev=>setPhotoPreview(ev.target.result);
                      reader.readAsDataURL(file);
                    }}/>
                    <div style={{width:72,height:72,borderRadius:14,background:`linear-gradient(135deg,${scanned.color}22,${scanned.color}55)`,overflow:"hidden",display:"flex",alignItems:"center",justifyContent:"center",border:_2a}}>
                      {photoPreview
                        ? <img src={photoPreview} style={{width:"100%",height:"100%",objectFit:"cover"}} alt="item"/>
                        : scanned.sourceImage
                          ? <img src={scanned.sourceImage} style={{width:"100%",height:"100%",objectFit:"cover"}}
                              onError={e=>{e.target.style.display="none";}} alt={scanned.name}/>
                          : <ItemIllustration item={scanned} size={60}/>
                      }
                    </div>
                    {/* Pencil edit button */}
                    <button onClick={()=>photoOverrideRef.current?.click()}
                      style={{position:"absolute",bottom:-4,right:-4,width:22,height:22,borderRadius:"50%",background:G,border:"2px solid #0D0D0D",display:"flex",alignItems:"center",justifyContent:"center",cursor:_p}}>
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                        <path d="M7 1L9 3L3.5 8.5L1 9L1.5 6.5L7 1Z" fill="#0D0D0D" stroke="#0D0D0D" strokeWidth="0.5" strokeLinejoin="round"/>
                        <path d="M6.5 1.5L8.5 3.5" stroke="#0D0D0D" strokeWidth="0.5"/>
                      </svg>
                    </button>
                  </div>
                  <div>
                    <div style={sr(17,500)}>{scanned.name}</div>
                    <div style={ss(9,400,DM,{letterSpacing:1,marginTop:3})}>{scanned.brand} · {scanned.category}</div>
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
                        reader.onload=ev=>setPhotoPreview(ev.target.result);
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

                <div style={{display:"flex",gap:10}}>
                  <Btn onClick={()=>{setScanned(null);setVoiceStage("idle");setTranscript("");setVoiceDesc("");setDescribeResults([]);}} outline>RE-SCAN</Btn>
                  <Btn onClick={confirmAdd} full>ADD TO CLOSET</Btn>
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
    </>)}

      {/* ── WISHLIST ITEM DETAIL POPUP ── */}
      {selectedWishItem&&(
        <div onClick={()=>setSelectedWishItem(null)} style={{..._fix,background:"#00000099",display:"flex",alignItems:"flex-start",paddingTop:60,zIndex:80}}>
          <div onClick={e=>e.stopPropagation()} style={{background:CD,borderRadius:"0 0 24px 24px",padding:"24px",width:"100%",maxWidth:430,margin:"0 auto",border:_2a,animation:"fadeDown 0.3s ease forwards",maxHeight:"90vh",overflowY:"auto"}}>
            <div style={{..._btwnS,marginBottom:20}}>
              <div style={{display:"flex",gap:16,alignItems:"center"}}>
                <div style={{width:88,height:88,borderRadius:18,background:_1a,overflow:"hidden",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",border:_2a}}>
                  {selectedWishItem.sourceImage?<img src={selectedWishItem.sourceImage} style={{width:"100%",height:"100%",objectFit:"cover"}} alt={selectedWishItem.name}/>:<ItemIllustration item={selectedWishItem} size={72}/>}
                </div>
                <div>
                  <div style={sr(20,500)}>{selectedWishItem.name}</div>
                  <div style={ss(10,400,DM,{letterSpacing:1,marginTop:4})}>{selectedWishItem.brand}</div>
                  <div style={sr(18,400,G,{marginTop:6})}>from ${selectedWishItem.price}</div>
                </div>
              </div>
              <IconBtn onClick={()=>setSelectedWishItem(null)}>×</IconBtn>
            </div>
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
            <div style={{display:"flex",gap:10}}>
              <Btn onClick={()=>{if(removeFromWishlist) removeFromWishlist(selectedWishItem.id); else setWishlist(prev=>prev.filter(w=>w.id!==selectedWishItem.id));setSelectedWishItem(null);showToast("Removed from wishlist \u2746");}} outline>REMOVE</Btn>
              <Btn onClick={()=>{showToast("Finding in market\u2026 \u2746");setSelectedWishItem(null);}} full>FIND IN MARKET</Btn>
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
function CropModal({src, onCancel, onSave}){
  const canvasRef=useRef();
  const [cropX,setCropX]=useState(0);
  const [cropY,setCropY]=useState(0);
  const [cropSize,setCropSize]=useState(200);
  const [imgNatural,setImgNatural]=useState({w:1,h:1});
  const [displaySize,setDisplaySize]=useState({w:320,h:320});
  const [dragging,setDragging]=useState(false);
  const [dragStart,setDragStart]=useState({x:0,y:0,cx:0,cy:0});
  const containerRef=useRef();
  const imgRef=useRef();

  useEffect(()=>{
    const img=new Image();
    img.onload=()=>{
      const nat={w:img.naturalWidth,h:img.naturalHeight};
      setImgNatural(nat);
      const maxW=Math.min(window.innerWidth-48,380);
      const maxH=420;
      // Use contain logic: fit image within maxW x maxH preserving aspect ratio
      const scaleToFit=Math.min(maxW/nat.w, maxH/nat.h);
      const dispW=Math.round(nat.w*scaleToFit);
      const dispH=Math.round(nat.h*scaleToFit);
      setDisplaySize({w:dispW,h:dispH});
      const initSize=Math.min(dispW,dispH)*0.7;
      setCropSize(initSize);
      setCropX((dispW-initSize)/2);
      setCropY((dispH-initSize)/2);
    };
    img.src=src;
  },[src]);

  const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));

  const onTouchStart=e=>{
    const t=e.touches[0];
    setDragging(true);
    setDragStart({x:t.clientX,y:t.clientY,cx:cropX,cy:cropY});
  };
  const onTouchMove=e=>{
    if(!dragging) return;
    e.preventDefault();
    const t=e.touches[0];
    const dx=t.clientX-dragStart.x;
    const dy=t.clientY-dragStart.y;
    setCropX(clamp(dragStart.cx+dx,0,displaySize.w-cropSize));
    setCropY(clamp(dragStart.cy+dy,0,displaySize.h-cropSize));
  };
  const onTouchEnd=()=>setDragging(false);

  // Pinch to resize
  const lastPinch=useRef(null);
  const onTouchStartPinch=e=>{
    if(e.touches.length===2){
      const dx=e.touches[0].clientX-e.touches[1].clientX;
      const dy=e.touches[0].clientY-e.touches[1].clientY;
      lastPinch.current=Math.sqrt(dx*dx+dy*dy);
    } else onTouchStart(e);
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
        const next=clamp(prev+delta*0.8,60,Math.min(displaySize.w,displaySize.h));
        // Keep crop within bounds
        setCropX(cx=>clamp(cx,0,displaySize.w-next));
        setCropY(cy=>clamp(cy,0,displaySize.h-next));
        return next;
      });
    } else onTouchMove(e);
  };

  const applyCrop=async()=>{
    const canvas=document.createElement("canvas");
    const outputSize=600;
    canvas.width=outputSize; canvas.height=outputSize;
    const ctx=canvas.getContext("2d");

    // Convert remote URL to base64 first to avoid CORS canvas taint
    let imgSrc=src;
    if(src && !src.startsWith("data:")){
      try{
        const blob=await fetch(src).then(r=>r.blob());
        imgSrc=await new Promise(res=>{ const r=new FileReader(); r.onload=e=>res(e.target.result); r.readAsDataURL(blob); });
      }catch(e){ imgSrc=src; } // fall back to direct src
    }

    const img=new Image();
    img.crossOrigin="anonymous";
    img.onload=()=>{
      try{
        // With objectFit:contain the display is scaled uniformly — use single scale factor
        const scale=imgNatural.w/displaySize.w; // same as imgNatural.h/displaySize.h
        const sx=Math.round(cropX*scale);
        const sy=Math.round(cropY*scale);
        const sw=Math.round(cropSize*scale);
        const sh=Math.round(cropSize*scale);
        ctx.drawImage(img,sx,sy,sw,sh,0,0,outputSize,outputSize);
        onSave(canvas.toDataURL("image/jpeg",0.9));
      }catch(e){
        // Canvas tainted — save original src unchanged
        onSave(src);
      }
    };
    img.onerror=()=>onSave(src); // can't crop, save as-is
    img.src=imgSrc;
  };

  return(
    <div style={{..._fix,inset:0,background:"#000000EE",zIndex:200,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"0 24px"}}>
      <div style={{width:"100%",maxWidth:430}}>
        {/* Header */}
        <div style={{..._btwn,marginBottom:14}}>
          <div style={sr(18,400)}>Crop Photo</div>
          <div style={ss(9,400,DM)}>Drag to move · Pinch to resize</div>
        </div>

        {/* Image + crop overlay */}
        <div ref={containerRef} style={{position:"relative",width:displaySize.w,height:displaySize.h,margin:"0 auto",borderRadius:12,overflow:"hidden",cursor:"move",touchAction:"none"}}
          onTouchStart={onTouchStartPinch} onTouchMove={onTouchMovePinch} onTouchEnd={onTouchEnd}
          onMouseDown={e=>{setDragging(true);setDragStart({x:e.clientX,y:e.clientY,cx:cropX,cy:cropY});}}
          onMouseMove={e=>{if(!dragging) return; const dx=e.clientX-dragStart.x,dy=e.clientY-dragStart.y; setCropX(clamp(dragStart.cx+dx,0,displaySize.w-cropSize)); setCropY(clamp(dragStart.cy+dy,0,displaySize.h-cropSize));}}
          onMouseUp={()=>setDragging(false)}
        >
          <img ref={imgRef} src={src} style={{width:displaySize.w,height:displaySize.h,objectFit:"contain",display:"block",userSelect:"none",pointerEvents:"none"}} alt="crop"/>
          {/* Dark overlay with cut-out */}
          <svg style={{position:"absolute",inset:0,pointerEvents:"none"}} width={displaySize.w} height={displaySize.h}>
            <defs>
              <mask id="cropMask">
                <rect width={displaySize.w} height={displaySize.h} fill="white"/>
                <rect x={cropX} y={cropY} width={cropSize} height={cropSize} rx="4" fill="black"/>
              </mask>
            </defs>
            <rect width={displaySize.w} height={displaySize.h} fill="#000000AA" mask="url(#cropMask)"/>
            {/* Crop border */}
            <rect x={cropX} y={cropY} width={cropSize} height={cropSize} rx="4" fill="none" stroke={G} strokeWidth="2"/>
            {/* Rule of thirds grid */}
            {[1,2].map(n=>(
              <g key={n}>
                <line x1={cropX+cropSize*n/3} y1={cropY} x2={cropX+cropSize*n/3} y2={cropY+cropSize} stroke="#FFFFFF44" strokeWidth="0.5"/>
                <line x1={cropX} y1={cropY+cropSize*n/3} x2={cropX+cropSize} y2={cropY+cropSize*n/3} stroke="#FFFFFF44" strokeWidth="0.5"/>
              </g>
            ))}
            {/* Corner handles */}
            {[[0,0],[1,0],[0,1],[1,1]].map(([hx,hy])=>(
              <rect key={`${hx}${hy}`}
                x={cropX+(hx*cropSize)-6} y={cropY+(hy*cropSize)-6}
                width={12} height={12} rx={3} fill={G}/>
            ))}
          </svg>
        </div>

        {/* Size slider */}
        <div style={{marginTop:16,marginBottom:20}}>
          <div style={ss(9,400,DM,{letterSpacing:1,marginBottom:8,textAlign:"center"})}>DRAG TO POSITION · PINCH OR SLIDE TO RESIZE</div>
          <input type="range" min={60} max={Math.min(displaySize.w,displaySize.h)}
            value={cropSize}
            onChange={e=>{
              const s=parseInt(e.target.value);
              setCropSize(s);
              setCropX(cx=>clamp(cx,0,displaySize.w-s));
              setCropY(cy=>clamp(cy,0,displaySize.h-s));
            }}
            style={{width:"100%",accentColor:G}}
          />
        </div>

        {/* Actions */}
        <div style={{display:"flex",gap:10}}>
          <button onClick={onCancel} style={{flex:1,padding:"13px",borderRadius:14,background:"#1A1A1A",border:"1px solid #2A2A2A",...ss(10,600,DM,{letterSpacing:1}),cursor:_p}}>CANCEL</button>
          <button onClick={applyCrop} style={{flex:2,padding:"13px",borderRadius:14,background:`linear-gradient(135deg,${G},#8A6E54)`,border:"none",...ss(10,700,BK,{letterSpacing:1.5}),cursor:_p}}>APPLY CROP</button>
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
      sourceImage: editImage,
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
          <>
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

            {/* Purchase date */}
            <div style={{marginBottom:20}}>
              <MonthYearPicker label="DATE PURCHASED" value={editDate} onChange={setEditDate}/>
            </div>

            <button onClick={saveEdit} style={{width:"100%",padding:"13px",borderRadius:14,background:`linear-gradient(135deg,${G},#8A6E54)`,border:"none",...ss(10,700,BK,{letterSpacing:1.5}),cursor:_p}}>
              SAVE CHANGES
            </button>
          </>
        ) : (
          <>
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
                <Btn onClick={()=>{showToast("Listed for sale \u2746");onClose();}} outline>LIST FOR SALE</Btn>
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
          </>
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
            <div style={sr(18,400,"#E8E0D4",{opacity:0.35,lineHeight:1.3})}>{behindItem.name}</div>
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
function MixMatchBuilder({tops,bottoms,shoes,outerwear,accessories,showToast,logWear,outfits,setOutfits,setItems,items,onNewLook,onSaveOutfit}){
  const TEMP = 58; // degrees F — drives outerwear default
  const [ti,setTi]=useState(0);
  const [bi,setBi]=useState(0);
  const [si,setSi]=useState(0);
  const [oi,setOi]=useState(0); // outerwear index
  const [ai,setAi]=useState(0); // accessory index
  const [saved,setSaved]=useState(false);
  const [aiLoading,setAiLoading]=useState(false);
  const [aiVibe,setAiVibe]=useState(null);
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
    setAiLoading(true); setAiVibe(null);
    const weather=`${TEMP}°F, Partly Cloudy`;

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

    const prompt = `Weather: ${weather}. ${constraint}Pick a stylish outfit. You MUST choose exact names from the lists provided. Return ONLY JSON with these fields: {${wantFields}}`;

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
    }catch(e){
      if(needTop)       setTi(differentIdx(avTops,tSafe));
      if(needBottom)    setBi(differentIdx(avBottoms,bSafe));
      if(needShoe)      setSi(differentIdx(avShoes,sSafe));
      if(needOuterwear) setOi(differentIdx(avOuterwear,oSafe));
      if(needAccessory) setAi(differentIdx(avAccessories,acSafe));
      setAiVibe("AI Pick");
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
    setTimeout(()=>setSaved(false),3000);
  };

  return(
    <div style={{marginBottom:18}}>

      {/* Header row */}
      <div style={{marginBottom:10}}>
        <div style={sr(18,400)}>Mix & Match</div>
        <div style={ss(9,400,DM,{letterSpacing:1,marginTop:1})}>
          {aiVibe ? <span style={{color:G}}>✦ {aiVibe.toUpperCase()}</span> : "SWIPE  ·  HOLD TO REMOVE  ·  TAP TWICE TO LOCK"}
        </div>
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

      {/* ── ROW TOGGLES + NEW LOOK ── */}
      <div style={{display:"flex",gap:6,marginBottom:14,alignItems:"center",flexWrap:"wrap"}}>
        <div style={ss(9,400,DM,{alignSelf:"center",marginRight:2,letterSpacing:0.5})}>Add row:</div>
        <button onClick={()=>setShowOuterwear(v=>!v)}
          style={{padding:"5px 12px",borderRadius:20,background:showOuterwear?`${G}22`:_1a,border:showOuterwear?`1px solid ${G}66`:_2a,cursor:_p,...ss(9,showOuterwear?600:400,showOuterwear?G:DM,{letterSpacing:0.5}),display:"flex",alignItems:"center",gap:4}}>
          <span>🧥</span> Outerwear {TEMP<65&&!showOuterwear?<span style={{fontSize:7,background:"#2A3A2A",color:"#80C080",borderRadius:4,padding:"1px 4px",marginLeft:2}}>cold</span>:null}
        </button>
        <button onClick={()=>setShowAccessories(v=>!v)}
          style={{padding:"5px 12px",borderRadius:20,background:showAccessories?`${G}22`:_1a,border:showAccessories?`1px solid ${G}66`:_2a,cursor:_p,...ss(9,showAccessories?600:400,showAccessories?G:DM,{letterSpacing:0.5}),display:"flex",alignItems:"center",gap:4}}>
          <span>💍</span> Accessories
        </button>
        <button onClick={()=>{setDressMode(v=>!v);setTi(0);setAiVibe(null);}}
          style={{padding:"5px 12px",borderRadius:20,background:dressMode?`${G}22`:_1a,border:dressMode?`1px solid ${G}66`:_2a,cursor:_p,...ss(9,dressMode?600:400,dressMode?G:DM,{letterSpacing:0.5}),display:"flex",alignItems:"center",gap:4}}>
          <span>👗</span> Dresses
        </button>
        <button onClick={onNewLook} title="Build new look" style={{marginLeft:"auto",width:32,height:32,borderRadius:10,background:CD,border:`1px solid ${BR}`,display:"flex",alignItems:"center",justifyContent:"center",cursor:_p,flexShrink:0,...ss(18,300,MD)}}>+</button>
      </div>

      {/* Rows — Outerwear first when enabled */}
      {showOuterwear&&avOuterwear.length>0&&(
        <>
          <SwipeRow label="Outerwear"   arr={avOuterwear}   idx={oSafe}  setIdx={setOi} emoji="🧥" isLocked={locked.outerwear} onLockToggle={()=>toggleLock("outerwear")} onMarkUnavailable={markUnavailable} onCycleEnd={()=>setAiVibe(null)}/>
          <div style={{height:28}}/>
        </>
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
        <>
          <SwipeRow label="Bottoms" arr={avBottoms} idx={bSafe} setIdx={setBi} emoji="👖" isLocked={locked.bottom} onLockToggle={()=>toggleLock("bottom")} onMarkUnavailable={markUnavailable} onCycleEnd={()=>setAiVibe(null)}/>
          <div style={{height:28}}/>
        </>
      )}
      {isDress&&<div style={{height:8}}/>}
      <SwipeRow label="Shoes"   arr={avShoes}   idx={sSafe} setIdx={setSi} emoji="👟" isLocked={locked.shoe}      onLockToggle={()=>toggleLock("shoe")}      onMarkUnavailable={markUnavailable} onCycleEnd={()=>setAiVibe(null)}/>
      <div style={{height:28}}/>
      {showAccessories&&avAccessories.length>0&&(
        <>
          <SwipeRow label="Accessories" arr={avAccessories} idx={acSafe} setIdx={setAi} emoji="💍" isLocked={locked.accessory} onLockToggle={()=>toggleLock("accessory")} onMarkUnavailable={markUnavailable} onCycleEnd={()=>setAiVibe(null)}/>
          <div style={{height:28}}/>
        </>
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
              placeholder={[top,bottom,shoe].filter(Boolean).map(i=>i?.name.split(" ")[0]).join(" + ")||"My Outfit"}
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

function OutfitsTab({items,outfits,setOutfits,setItems,showToast,logWear,onSaveOutfit,onDeleteOutfit}){
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

      {/* Header */}
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

      {/* ── TODAY STRIP ── */}
      <div style={{background:"linear-gradient(135deg,#1A1A2E,#16213E)",borderRadius:16,padding:"12px 16px",marginBottom:14,border:"1px solid #2A2A4A",display:"flex",alignItems:"center",gap:12}}>
        <div style={{fontSize:30,flexShrink:0}}>{weather.icon}</div>
        <div style={{flex:1,minWidth:0}}>
          <div style={ss(8,400,"#8A90B8",{letterSpacing:1.5,textTransform:"uppercase"})}>{today}</div>
          <div style={{display:"flex",alignItems:"baseline",gap:6,marginTop:2}}>
            <div style={sr(20,300,"#D0D4F0")}>{weather.temp}</div>
            <div style={ss(9,400,"#6A70A8")}>{weather.condition}</div>
          </div>
        </div>
        <div style={{display:"flex",gap:6,flexShrink:0}}>
          {["Work","Casual","Evening"].map(o=>(
            <button key={o} onClick={()=>setTodayOccasion(o===todayOccasion?null:o)}
              style={{padding:"5px 10px",borderRadius:14,background:todayOccasion===o?G:"#1A2040",border:todayOccasion===o?"none":"1px solid #2A2A4A",...ss(8,todayOccasion===o?600:400,todayOccasion===o?BK:"#8A90B8",{letterSpacing:0.8}),cursor:_p,whiteSpace:"nowrap"}}>
              {o}
            </button>
          ))}
        </div>
      </div>

      {/* ── MIX & MATCH ── */}
      {activeFilter==="All" && (()=>{
        const tops       = items.filter(i=>["Tops","Dresses"].includes(i.category));
        const bottoms    = items.filter(i=>i.category==="Bottoms");
        const shoes      = items.filter(i=>i.category==="Shoes");
        const outerwear  = items.filter(i=>i.category==="Outerwear");
        const accessories= items.filter(i=>i.category==="Accessories");
        return <MixMatchBuilder tops={tops} bottoms={bottoms} shoes={shoes} outerwear={outerwear} accessories={accessories} items={items} showToast={showToast} logWear={logWear} outfits={outfits} setOutfits={setOutfits} setItems={setItems} onNewLook={()=>setShowBuilder(true)} onSaveOutfit={onSaveOutfit}/>;
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
          <div key={outfit.id} className="ch" onClick={()=>setSelectedOutfit(outfit)} style={{background:CD,borderRadius:18,padding:"16px 18px",marginBottom:12,border:`1px solid ${BR}`,position:"relative",overflow:"hidden",cursor:_p}}>
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
        );
      })}

      {/* ── OUTFIT DETAIL MODAL ── */}
      {selectedOutfit&&(()=>{
        const o=selectedOutfit;
        const accentCol=occasionColour[o.occasion]||"#4A4038";
        const outfitItems=o.items.map(id=>items.find(i=>i.id===id)).filter(Boolean);
        const totalValue=outfitItems.reduce((s,i)=>s+i.price,0);
        return(
          <div onClick={()=>setSelectedOutfit(null)} style={{..._fix,background:"#000C",zIndex:70,display:"flex",alignItems:"flex-start",paddingTop:60,justifyContent:"center"}}>
            <div onClick={e=>e.stopPropagation()} className="sc" style={{background:"#0D0D0D",borderRadius:"0 0 24px 24px",width:"100%",maxWidth:430,border:_2a,maxHeight:"90vh",overflowY:"auto",animation:"fadeDown 0.3s ease forwards"}}>

              {/* Handle + header */}
              <div style={{padding:"16px 20px 0"}}>
                <div style={{width:36,height:4,borderRadius:2,background:"#333",margin:"0 auto 16px"}}/>
                <div style={{..._btwnS,marginBottom:6}}>
                  <div>
                    <div style={sr(24,400)}>{o.name}</div>
                    <div style={{..._row,gap:8,marginTop:5}}>
                      <div style={{background:accentCol+"33",borderRadius:8,padding:"3px 10px",...ss(8,600,accentCol==="#4A4038"?MD:accentCol,{letterSpacing:1})}}>{o.occasion}</div>
                      <div style={ss(9,400,DM,{letterSpacing:0.5})}>{o.season}</div>
                    </div>
                  </div>
                  <IconBtn onClick={()=>setSelectedOutfit(null)}>×</IconBtn>
                </div>

                {/* Stats row */}
                <div style={{display:"flex",gap:10,marginBottom:14,marginTop:12}}>
                  {[[outfitItems.length+" pieces","ITEMS"],[`$${totalValue}`,"VALUE"],[(favorites.has(o.id)?"♥":"♡")+" Fav",""]].map(([v,l])=>(
                    <div key={l} style={{flex:1,background:_1a,borderRadius:12,padding:"10px",textAlign:"center",border:"1px solid #222"}}>
                      <div style={sr(15,500,G)}>{v}</div>
                      {l&&<div style={ss(7,400,DM,{letterSpacing:1,marginTop:2})}>{l}</div>}
                    </div>
                  ))}
                </div>

                {/* Actions */}
                <div style={{display:"flex",gap:8,marginBottom:20}}>
                  <button onClick={()=>{logWear(o.id);showToast(`Wearing "${o.name}" today \u2746`);setSelectedOutfit(null);}} style={{flex:2,padding:"13px",borderRadius:14,background:`linear-gradient(135deg,${G},#8A6E54)`,border:"none",...ss(10,700,BK,{letterSpacing:1}),cursor:_p}}>WEAR TODAY</button>
                  <button onClick={()=>{setMirror({itemIds:o.items,name:o.name});setSelectedOutfit(null);}} style={{padding:"13px 14px",borderRadius:14,background:"linear-gradient(135deg,#14101A,#1A1424)",border:"1px solid #2A2040",display:"flex",alignItems:"center",gap:6,cursor:_p,...ss(10,600,"#C0B0D8",{letterSpacing:1})}}>
                    <span style={{fontSize:14}}>🪞</span>MIRROR
                  </button>
                  <button onClick={()=>{showToast(`"${o.name}" shared to feed \u2746`);setSelectedOutfit(null);}} style={{padding:"13px 14px",borderRadius:14,background:_1a,border:_2a,display:"flex",alignItems:"center",gap:5,cursor:_p,...ss(10,600,MD,{letterSpacing:0.5})}}>
                    <span style={{fontSize:13}}>✦</span>SHARE
                  </button>
                </div>
              </div>

              {/* Item cards */}
              <div style={{padding:"0 20px 36px"}}>
                <div style={ss(8,600,DM,{letterSpacing:2,marginBottom:12})}>ITEMS IN THIS OUTFIT</div>
                {outfitItems.map(item=>(
                  <div key={item.id} style={{background:CD,borderRadius:16,marginBottom:10,border:`1px solid ${BR}`,overflow:"hidden"}}>
                    {/* Large image */}
                    <div style={{width:"100%",height:200,background:`linear-gradient(135deg,${item.color}22,${item.color}44)`,overflow:"hidden",display:"flex",alignItems:"center",justifyContent:"center"}}>
                      {item.sourceImage
                        ? <img src={item.sourceImage} style={{width:"100%",height:"100%",objectFit:"contain",padding:"8px",boxSizing:"border-box"}} alt={item.name}/>
                        : <ItemIllustration item={item} size={140}/>
                      }
                    </div>
                    {/* Item info */}
                    <div style={{padding:"12px 14px"}}>
                      <div style={{..._btwnS,marginBottom:6}}>
                        <div>
                          <div style={sr(16,500)}>{item.name}</div>
                          <div style={{..._row,gap:6,marginTop:3}}>
                            <div style={{width:9,height:9,borderRadius:"50%",background:item.color,border:"1px solid #FFFFFF22"}}/>
                            <div style={ss(9,400,DM,{letterSpacing:0.5})}>{item.brand} · {hexToColorName(item.color)}</div>
                          </div>
                        </div>
                        <div style={sr(16,400,G)}>${item.price}</div>
                      </div>
                      <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:6}}>
                        <div style={{background:_1a,borderRadius:8,padding:"3px 8px",border:_2a,...ss(8,400,DM)}}>{item.category}</div>
                        <div style={{background:_1a,borderRadius:8,padding:"3px 8px",border:_2a,...ss(8,400,DM)}}>{item.condition}</div>
                        {item.tags.map(t=><div key={t} style={{background:`${G}11`,borderRadius:8,padding:"3px 8px",border:`1px solid ${G}22`,...ss(8,400,G)}}>#{t}</div>)}
                      </div>
                      <div style={{display:"flex",gap:6,marginTop:10}}>
                        <div style={{flex:1,background:_1a,borderRadius:10,padding:"7px",textAlign:"center",border:"1px solid #222"}}>
                          <div style={sr(13,400,G)}>{item.wearCount}x</div>
                          <div style={ss(7,400,DM,{letterSpacing:1,marginTop:1})}>WORN</div>
                        </div>
                        <div style={{flex:1,background:_1a,borderRadius:10,padding:"7px",textAlign:"center",border:"1px solid #222"}}>
                          <div style={sr(13,400,G)}>{item.lastWorn}</div>
                          <div style={ss(7,400,DM,{letterSpacing:1,marginTop:1})}>LAST WORN</div>
                        </div>
                        <div style={{flex:1,background:_1a,borderRadius:10,padding:"7px",textAlign:"center",border:"1px solid #222"}}>
                          <div style={sr(13,400,G)}>{item.condition}</div>
                          <div style={ss(7,400,DM,{letterSpacing:1,marginTop:1})}>CONDITION</div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── OUTFIT BUILDER ── */}
      {showBuilder&&(
        <div onClick={()=>setShowBuilder(false)} style={{..._fix,background:"#000000AA",zIndex:60,display:"flex",alignItems:"flex-start"}}>
          <div onClick={e=>e.stopPropagation()} style={{background:"#111",borderRadius:"0 0 24px 24px",padding:24,width:"100%",maxWidth:430,margin:"0 auto",border:_2a,animation:"fadeDown 0.3s ease forwards",maxHeight:"88vh",overflowY:"auto"}} className="sc">
          <div style={sr(17,500,G,{marginBottom:4})}>Build New Look</div>
          <div style={ss(9,400,DM,{letterSpacing:1,marginBottom:14})}>TAP ITEMS TO ADD · TAP AGAIN TO REMOVE</div>

          {/* Name */}
          <input value={name} onChange={e=>setName(e.target.value)} placeholder="Name this look…"
            style={{width:"100%",background:_1a,border:_2a,borderRadius:12,padding:"10px 14px",...ss(12,400,MD),color:"#C0B8B0",marginBottom:10,boxSizing:"border-box"}} />

          {/* Occasion picker */}
          <div style={ss(8,400,DM,{letterSpacing:1.5,marginBottom:8})}>OCCASION</div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:14}}>
            {occasions.map(oc=>(
              <button key={oc} onClick={()=>setOccasion(oc)} className="pb" style={{padding:"5px 12px",borderRadius:20,background:occasion===oc?occasionColour[oc]||G:"#1A1A1A",border:occasion===oc?"none":"1px solid #2A2A2A",...ss(9,occasion===oc?600:400,occasion===oc?BK:DM,{letterSpacing:0.8}),cursor:_p}}>{oc}</button>
            ))}
          </div>

          {/* Selected items */}
          <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:10,minHeight:32}}>
            {builder.length===0
              ? <div style={sr(12,300,"#3A3028",{fontStyle:"italic"})}>No items added yet…</div>
              : builder.map(id=>{
                  const it=items.find(i=>i.id===id);
                  return(<div key={id} onClick={()=>setBuilder(builder.filter(x=>x!==id))}
                    style={{background:"#1E1E1E",borderRadius:10,padding:"4px 10px 4px 6px",display:"flex",alignItems:"center",gap:6,...ss(10,400,G),border:`1px solid ${G}33`,cursor:_p}}>
                    <ItemIllustration item={it} size={22}/>{it?.name} ×
                  </div>);
                })
            }
          </div>

          {/* Item picker with search */}
          <div style={ss(8,400,DM,{letterSpacing:1.5,marginBottom:8})}>YOUR CLOSET</div>
          <div style={{..._row,gap:8,background:"#0D0D0D",border:"1px solid #2A2A2A",borderRadius:10,padding:"8px 12px",marginBottom:10}}>
            <span style={{fontSize:12,opacity:0.4}}>🔍</span>
            <input value={bSearch} onChange={e=>setBSearch(e.target.value)} placeholder="Search closet…"
              style={{flex:1,background:"none",border:"none",outline:"none",...ss(11,400,MD),color:"#C0B8B0"}}/>
            {bSearch&&<button onClick={()=>setBSearch("")} style={{background:"none",border:"none",cursor:_p,...ss(12,400,DM)}}>✕</button>}
          </div>
          {!bSearch&&<div style={ss(8,400,DM,{letterSpacing:1,marginBottom:8})}>MOST WORN</div>}
          <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:14}}>
            {(bSearch.trim()
              ? items.filter(i=>i.name.toLowerCase().includes(bSearch.toLowerCase())||i.brand.toLowerCase().includes(bSearch.toLowerCase())||i.category.toLowerCase().includes(bSearch.toLowerCase()))
              : [...items].sort((a,b)=>b.wearCount-a.wearCount).slice(0,6)
            ).map(it=>{
              const inBuilder=builder.includes(it.id);
              return(
                <div key={it.id} onClick={()=>inBuilder?setBuilder(builder.filter(x=>x!==it.id)):setBuilder([...builder,it.id])}
                  style={{display:"flex",alignItems:"center",gap:10,background:inBuilder?`${G}18`:"#0D0D0D",border:inBuilder?`1.5px solid ${G}`:"1px solid #2A2A2A",borderRadius:12,padding:"8px 12px",cursor:_p,transition:"all 0.15s"}}>
                  <ItemThumb item={it} size={40} r={10}/>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={sr(13,500,inBuilder?G:undefined,{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"})}>{it.name}</div>
                    <div style={ss(9,400,DM,{marginTop:1})}>{it.brand} · {it.category} · Worn {it.wearCount}x</div>
                  </div>
                  {inBuilder&&<div style={{width:20,height:20,borderRadius:6,background:G,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,...ss(10,700,BK)}}>✓</div>}
                </div>
              );
            })}
            {bSearch.trim()&&items.filter(i=>i.name.toLowerCase().includes(bSearch.toLowerCase())||i.brand.toLowerCase().includes(bSearch.toLowerCase())).length===0&&(
              <div style={sr(12,300,"#3A3028",{fontStyle:"italic",textAlign:"center",padding:"12px 0"})}>No items match "{bSearch}"</div>
            )}
          </div>

          {/* Save / Mirror */}
          {builder.length>0&&(
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>setMirror({itemIds:builder,name:name||"New Look"})} style={{flex:1,padding:"12px",borderRadius:14,background:"linear-gradient(135deg,#14101A,#1A1424)",border:"1px solid #2A2040",display:"flex",alignItems:"center",justifyContent:"center",gap:6,cursor:_p,...ss(9,600,"#C0B0D8",{letterSpacing:1})}}>
                <span style={{fontSize:14}}>🪞</span>MIRROR
              </button>
              <button onClick={save} style={{flex:2,padding:"12px",borderRadius:14,background:`linear-gradient(135deg,${G},#8A6E54)`,border:"none",...ss(9,600,BK,{letterSpacing:1.5}),cursor:_p}}>SAVE LOOK</button>
            </div>
          )}
        </div>
        </div>
      )}

      {mirror&&<MirrorModal items={items} outfitItemIds={mirror.itemIds} outfitName={mirror.name} onClose={()=>setMirror(null)}/>}
    </div>
  );
}

// ── MARKET ────────────────────────────────────────────────────────────────────
// ── OFFERS DATA ──────────────────────────────────────────────────────────────
// ── USER PROFILE DATA ─────────────────────────────────────────────────────────
const userProfiles = {
  "@minimal.edit": {
    handle: "@minimal.edit",
    name: "Maya Chen",
    location: "London, UK",
    bio: "Less, but better. Architect by day. Wardrobe curator always. Obsessed with the intersection of function and beauty.", avatar: "🖤",
    followers: "8.1k",
    following: 312,
    totalFollowers: 8100,
    posts: 142,
    style: "Minimal · Monochrome · Investment pieces",
    verified: true,
    forSaleCount: 4,
    stats: { sustainabilityScore: 88, brandsCount: 23, resaleValue: "$1,240" },
    highlights: [
      { label:"All-Black", emoji:"🖤", count:18 },
      { label:"Capsule", emoji:"✦",   count:12 },
      { label:"For Sale", emoji:"🏷️", count:4  },
      { label:"Wishlist", emoji:"♡",  count:9  },
    ],
    recentPosts: [
      { id:"m1", outfit:"All-Black Everything",     likes:519,  items:[{emoji:"🩱",name:"Fitted Bodysuit",brand:"Toteme",price:180,forSale:false},{emoji:"🧥",name:"Oversized Blazer",brand:"Zara",price:89,forSale:true,sourceImage:null},{emoji:"👠",name:"Block Heel Mules",brand:"& Other Stories",price:120,forSale:true,sourceImage:null}], portrait:2 },
      { id:"m2", outfit:"Quiet Luxury Monday",      likes:834,  items:[{emoji:"👖",name:"Tailored Trousers",brand:"The Row",price:680,forSale:false},{emoji:"👚",name:"Silk Camisole",brand:"Vince",price:210,forSale:false},{emoji:"👜",name:"Mini Bag",brand:"Polène",price:320,forSale:false}], portrait:4 },
      { id:"m3", outfit:"Off-Duty Architecture",    likes:412,  items:[{emoji:"🧥",name:"Structured Coat",brand:"COS",price:290,forSale:false},{emoji:"👖",name:"Wide Leg Crop",brand:"Toteme",price:295,forSale:true},{emoji:"👟",name:"Low AF1",brand:"Nike",price:110,forSale:false}], portrait:1 },
    ],
    forSale: [
      { emoji:"🧥", name:"Oversized Blazer",    brand:"Zara",            price:89,  size:"XS", condition:"Good",     likes:24 },
      { emoji:"👠", name:"Block Heel Mules",    brand:"& Other Stories", price:120, size:"37", condition:"Like New", likes:31 },
      { emoji:"👖", name:"Wide Leg Crop",       brand:"Toteme",          price:295, size:"XS", condition:"Excellent",likes:18 },
      { emoji:"💛", name:"Geometric Earrings",  brand:"Completedworks",  price:95,  size:"OS", condition:"Like New", likes:9  },
    ],
    brands: ["Toteme","The Row","COS","Lemaire","Aesop","Completedworks","Jil Sander","Acne Studios"],
    colorPalette: ["#0D0D0D","#1A1A1A","#2A2A2A","#F0EBE3","#3A3028"],
  },
  "@jess.styles": {
    handle: "@jess.styles",
    name: "Jessica Park",
    location: "Brooklyn, NY",
    bio: "Vintage hunter. Market regular. Building a wardrobe that tells a story — slowly, intentionally, joyfully.", avatar: "🌸",
    followers: "12.4k",
    following: 891,
    totalFollowers: 12400,
    posts: 287,
    style: "Vintage · Eclectic · Sustainable",
    verified: false,
    forSaleCount: 7,
    stats: { sustainabilityScore: 96, brandsCount: 47, resaleValue: "$680" },
    highlights: [
      { label:"Vintage", emoji:"🪡", count:34 },
      { label:"Markets", emoji:"🌿", count:21 },
      { label:"For Sale", emoji:"🏷️", count:7  },
      { label:"Saved",   emoji:"♡",  count:16 },
    ],
    recentPosts: [
      { id:"j1", outfit:"Sunday Market Run",  likes:284, items:[{emoji:"👖",name:"Vintage Levi 501",brand:"Levi's",price:45,forSale:true,sourceImage:null},{emoji:"👟",name:"New Balance 574",brand:"New Balance",price:110,forSale:false},{emoji:"🧣",name:"Ribbed Wool Scarf",brand:"Arket",price:65,forSale:true,sourceImage:null}], portrait:1 },
      { id:"j2", outfit:"Flea Market Find",   likes:631, items:[{emoji:"🧥",name:"Vintage Trench",brand:"Unknown",price:35,forSale:false},{emoji:"👗",name:"Prairie Dress",brand:"Christy Dawn",price:280,forSale:false},{emoji:"👢",name:"Cowboy Boots",brand:"Frye",price:190,forSale:false}], portrait:3 },
      { id:"j3", outfit:"Easy Autumn",        likes:198, items:[{emoji:"🧶",name:"Cable Knit",brand:"Rowan",price:80,forSale:false},{emoji:"👖",name:"Corduroy Wide Leg",brand:"Madewell",price:98,forSale:true}], portrait:2 },
    ],
    forSale: [
      { emoji:"👖", name:"Vintage Levi 501",   brand:"Levi's",     price:45,  size:"W27", condition:"Good",     likes:12 },
      { emoji:"🧣", name:"Ribbed Wool Scarf",  brand:"Arket",      price:65,  size:"OS",  condition:"Excellent",likes:8  },
      { emoji:"🥼", name:"Vintage Blazer",     brand:"Thrifted",   price:30,  size:"S",   condition:"Good",     likes:19 },
      { emoji:"👟", name:"Nike Air Max 90",    brand:"Nike",       price:60,  size:"37",  condition:"Good",     likes:6  },
    ],
    brands: ["Levi's","Arket","New Balance","Christy Dawn","Madewell","Frye","& Other Stories","Everlane"],
    colorPalette: ["#C4A882","#8B7355","#E8DDD0","#4A6080","#D4B890"],
  },
  "@the.closet.co": {
    handle: "@the.closet.co",
    name: "Sofia Reyes",
    location: "Milan, IT",
    bio: "Personal stylist & closet therapist. I help people shop their own wardrobes. DMs open for styling sessions.", avatar: "🌿",
    followers: "31k",
    following: 1204,
    totalFollowers: 31000,
    posts: 634,
    style: "Mediterranean · Effortless · Feminine",
    verified: true,
    forSaleCount: 12,
    stats: { sustainabilityScore: 72, brandsCount: 61, resaleValue: "$3,800" },
    highlights: [
      { label:"Summer",   emoji:"☀️", count:48 },
      { label:"Styling",  emoji:"✦",  count:29 },
      { label:"For Sale", emoji:"🏷️", count:12 },
      { label:"Inspo",    emoji:"🌿", count:51 },
    ],
    recentPosts: [
      { id:"s1", outfit:"Linen and Light",      likes:1203, items:[{emoji:"👗",name:"Linen Wrap Dress",brand:"Faithfull",price:240,forSale:false,sourceImage:null},{emoji:"💛",name:"Gold Pendant Necklace",brand:"Mejuri",price:95,forSale:false,sourceImage:null},{emoji:"👡",name:"Strappy Sandals",brand:"Mango",price:79,forSale:true,sourceImage:null}], portrait:3 },
      { id:"s2", outfit:"Aperol Hour",           likes:2140, items:[{emoji:"👗",name:"Silk Slip Dress",brand:"Vince",price:320,forSale:true,sourceImage:null},{emoji:"💛",name:"Gold Hoop Earrings",brand:"Mejuri",price:68,forSale:false},{emoji:"👡",name:"Kitten Heel Mules",brand:"Mango",price:110,forSale:false}], portrait:3 },
      { id:"s3", outfit:"Market Morning",        likes:876,  items:[{emoji:"🧶",name:"Linen Shirt",brand:"Toteme",price:195,forSale:false},{emoji:"👖",name:"Cream Trousers",brand:"Arket",price:120,forSale:false},{emoji:"👜",name:"Woven Basket Bag",brand:"Zara",price:45,forSale:false}], portrait:1 },
    ],
    forSale: [
      { emoji:"👗", name:"Silk Slip Dress",   brand:"Vince",      price:320, size:"S",   condition:"Like New", likes:44 },
      { emoji:"👡", name:"Strappy Heels",     brand:"By Far",     price:280, size:"38",  condition:"Excellent",likes:38 },
      { emoji:"🥼", name:"Blazer Cream",      brand:"Sandro",     price:89,  size:"M",   condition:"Good",     likes:21 },
      { emoji:"👜", name:"Raffia Tote",       brand:"Cult Gaia",  price:150, size:"OS",  condition:"Good",     likes:17 },
    ],
    brands: ["Faithfull","Mejuri","Mango","Vince","By Far","Toteme","Cult Gaia","Sandro","Jacquemus"],
    colorPalette: ["#E8DDD0","#C4A882","#D4B890","#8B7355","#F5F0E8"],
  },
  "@curated.claire": {
    handle: "@curated.claire",
    name: "Claire Whitmore",
    location: "New York, NY",
    bio: "Fashion director. Uniform dressing devotee. Investing in fewer, better things since 2019. Business casual redefined.",
    avatar: "💼",
    followers: "4.2k",
    following: 204,
    totalFollowers: 4200,
    posts: 89,
    style: "Corporate Chic · Capsule · Investment",
    verified: false,
    forSaleCount: 2,
    stats: { sustainabilityScore: 81, brandsCount: 18, resaleValue: "$2,100" },
    highlights: [
      { label:"Office",  emoji:"💼", count:32 },
      { label:"Evening", emoji:"🥂", count:14 },
      { label:"For Sale",emoji:"🏷️", count:2  },
      { label:"Saved",   emoji:"♡",  count:7  },
    ],
    recentPosts: [
      { id:"c1", outfit:"Board Room Energy",  likes:97,  items:[{emoji:"🥼",name:"Camel Trench Coat",brand:"Toteme",price:590,forSale:false},{emoji:"👖",name:"Tailored Trousers",brand:"COS",price:95,forSale:true,sourceImage:null},{emoji:"💼",name:"Structured Tote",brand:"Polène",price:350,forSale:false,sourceImage:null}], portrait:4 },
      { id:"c2", outfit:"Monday Uniform",     likes:211, items:[{emoji:"👚",name:"Silk Blouse",brand:"Equipment",price:180,forSale:false},{emoji:"👖",name:"Slim Trousers",brand:"Theory",price:295,forSale:false},{emoji:"👠",name:"Pointed Pumps",brand:"Mango",price:89,forSale:false}], portrait:4 },
      { id:"c3", outfit:"After Hours",        likes:143, items:[{emoji:"👗",name:"Column Midi",brand:"Reformation",price:248,forSale:false},{emoji:"💛",name:"Pearl Drop Earrings",brand:"Sophie Bille Brahe",price:310,forSale:false}], portrait:2 },
    ],
    forSale: [
      { emoji:"👖", name:"Tailored Trousers", brand:"COS",       price:95, size:"XS", condition:"Excellent",likes:7  },
      { emoji:"👠", name:"Kitten Heel Pumps", brand:"Manolo",    price:380,size:"37", condition:"Good",     likes:14 },
    ],
    brands: ["Toteme","COS","Theory","Equipment","Reformation","Manolo","Polène","Sophie Bille Brahe"],
    colorPalette: ["#C8A96E","#1A1A1A","#F5F0E8","#2C3E50","#8B7355"],
  },
};

// ── USER PROFILE PAGE ─────────────────────────────────────────────────────────
function UserProfilePage({ handle, userId, username, onClose, showToast, session, onAddToCloset }) {
  const [activeTab, setActiveTab] = useState("items");
  const [following, setFollowing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [realProfile, setRealProfile] = useState(null);
  const [addedItems, setAddedItems] = useState(new Set()); // track items already added

  // Determine if this is a real user or demo profile
  const isDemoUser = handle && userProfiles[handle];
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

        // Build posts from outfits
        const posts = outfits.map(o=>({
          id: o.id,
          outfit: o.name,
          likes: Math.floor(Math.random()*300)+10, // placeholder until likes table exists
          occasion: o.occasion,
          items: (o.items||[]).map(id=>items.find(i=>i.id===id)).filter(Boolean),
          wornHistory: o.wornHistory||o.worn_history||[],
        }));

        const closetValue = items.reduce((s,i)=>s+(i.price||0),0);

        setRealProfile({
          handle: `@${prof?.username||username||"user"}`,
          name: prof?.username || username || "Outfix User",
          location: prof?.location || "",
          bio: prof?.bio || "",
          style: prof?.style_identity || "",
          avatar: (prof?.username||username||"?")[0]?.toUpperCase(),
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

  const profile = demoProfile || realProfile;

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

  const tabs = [
    { id:"items",   label:"ITEMS",   count: profile.items },
    { id:"posts",   label:"OUTFITS", count: profile.posts },
    { id:"forsale", label:"FOR SALE",count: profile.forSaleCount },
    { id:"about",   label:"ABOUT" },
  ];

  return (
    <div style={{..._fix,background:BK,zIndex:400,maxWidth:430,margin:"0 auto",display:"flex",flexDirection:"column"}}>

      {/* ── HEADER BAR ── */}
      <div style={{flexShrink:0,background:"#0A0908",borderBottom:"1px solid #1A1A1A",padding:"14px 18px",display:"flex",alignItems:"center",gap:12}}>
        <IconBtn onClick={onClose} sz={18}>←</IconBtn>
        <div style={{flex:1}}>
          <div style={ss(11,600,MD,{letterSpacing:0.5})}>{profile.handle}</div>
          <div style={ss(9,400,DM,{letterSpacing:0.5})}>{profile.posts} outfits</div>
        </div>
        <IconBtn onClick={()=>showToast("Shared \u2746")} sz={14}>↑</IconBtn>
      </div>

      {/* ── SCROLLABLE BODY ── */}
      <div style={{flex:1,overflowY:"auto"}} className="sc">

      {/* ── HERO ── */}
      <div style={{position:"relative",height:80,background:"linear-gradient(135deg,#1A1510,#0F0D0A)",flexShrink:0,overflow:"hidden"}}>
        {(profile.colorPalette||[]).map((col,i)=>(
          <div key={i} style={{position:"absolute",borderRadius:"50%",width:100,height:100,background:col,opacity:0.22,filter:"blur(28px)",top:`${-20+i*10}%`,left:`${i*24}%`}}/>
        ))}
        {profile.location&&<div style={{position:"absolute",bottom:10,right:14,...ss(9,400,DM,{letterSpacing:1})}}>📍 {profile.location}</div>}
      </div>

      {/* ── PROFILE IDENTITY ── */}
      <div style={{padding:"14px 18px 0",flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,marginBottom:12}}>
          {/* Avatar + name */}
          <div style={{display:"flex",gap:12,alignItems:"center",minWidth:0}}>
            <div style={{width:64,height:64,borderRadius:"50%",background:"linear-gradient(135deg,#2A2420,#1A1410)",border:`2px solid #2A2A2A`,overflow:"hidden",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,boxShadow:`0 0 0 1px ${G}33`}}>
              {demoProfile
                ? (AVATAR_DEFS[profile.handle]?<AvatarPortrait user={profile.handle} size={60}/>:<span style={{fontSize:28}}>{profile.avatar}</span>)
                : <span style={{...sr(26,600,G)}}>{profile.avatar}</span>
              }
            </div>
            <div style={{minWidth:0}}>
              <div style={{..._row,gap:5,marginBottom:2}}>
                <div style={sr(20,500)}>{profile.name}</div>
                {profile.verified&&<div style={{width:15,height:15,borderRadius:"50%",background:G,display:"flex",alignItems:"center",justifyContent:"center",...ss(8,700,BK),flexShrink:0}}>✓</div>}
              </div>
              <div style={ss(10,400,DM,{letterSpacing:1})}>{profile.handle}</div>
              {profile.style&&<div style={{...sr(11,300,"#7A6858"),fontStyle:"italic",marginTop:3}}>{profile.style}</div>}
            </div>
          </div>
          {/* Buttons */}
          <div style={{display:"flex",gap:8,flexShrink:0}}>
            <button onClick={()=>showToast("Message coming soon \u2746")} style={{width:36,height:36,borderRadius:"50%",background:_1a,border:_2a,display:"flex",alignItems:"center",justifyContent:"center",...ss(14,400,MD),cursor:_p}}>✉</button>
            <button onClick={demoProfile?()=>{setFollowing(f=>!f);showToast(following?"Unfollowed \u2746":"Following \u2746");}:toggleFollow}
              style={{padding:"8px 20px",borderRadius:20,background:following?"#1A1A1A":`linear-gradient(135deg,${G},#8A6E54)`,border:following?"1px solid #2A2A2A":"none",...ss(10,600,following?MD:BK,{letterSpacing:1}),cursor:_p}}>
              {following?"FOLLOWING":"FOLLOW"}
            </button>
          </div>
        </div>

        {profile.bio&&<div style={{...ss(11,400,"#A09880"),lineHeight:1.7,marginBottom:14}}>{profile.bio}</div>}

        {/* Stats row — Followers + Following only */}
        <div style={{display:"flex",gap:0,marginBottom:16,background:"#111",borderRadius:14,overflow:"hidden",border:"1px solid #1E1E1E"}}>
          {[
            {label:"Followers", value:profile.followers},
            {label:"Following", value:profile.following},
          ].map((s,i)=>(
            <div key={i} style={{flex:1,padding:"12px 8px",textAlign:"center",borderRight:i<1?"1px solid #1E1E1E":"none"}}>
              <div style={sr(18,500,G)}>{s.value}</div>
              <div style={ss(8,400,DM,{letterSpacing:1,marginTop:2})}>{String(s.label).toUpperCase()}</div>
            </div>
          ))}
        </div>

        {/* Highlight chips — Pieces + Outfits + For Sale + Brands */}
        <div style={{display:"flex",gap:8,marginBottom:16,overflowX:"auto",paddingBottom:4}}>
          {(profile.highlights||[]).map((h,i)=>(
            <div key={i} style={{flexShrink:0,textAlign:"center",width:72,cursor:_p}}>
              <div style={{width:64,height:64,borderRadius:18,background:"#161412",border:"1.5px solid #2A2418",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:3,margin:"0 auto 6px"}}>
                <div style={{fontSize:20}}>{h.emoji}</div>
                <div style={ss(9,700,G,{letterSpacing:0.5})}>{h.count}</div>
              </div>
              <div style={ss(8,400,DM,{letterSpacing:0.5,lineHeight:1.2})}>{h.label}</div>
            </div>
          ))}
        </div>

        {/* Wardrobe insight cards — Value + Est. Resale */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:18}}>
          {[
            {label:"Closet Value",  value:profile.stats.closetValue,  icon:"💰"},
            {label:"Est. Resale",   value:profile.stats.resaleValue,   icon:"✦"},
          ].map((s,i)=>(
            <div key={i} style={{background:"#111",borderRadius:12,padding:"12px 14px",border:"1px solid #1E1E1E"}}>
              <div style={{fontSize:14,marginBottom:4}}>{s.icon}</div>
              <div style={sr(18,500,G)}>{s.value}</div>
              <div style={ss(8,400,DM,{letterSpacing:0.8,marginTop:2})}>{s.label.toUpperCase()}</div>
            </div>
          ))}
        </div>

        {/* Brand DNA */}
        {profile.brands?.length>0&&(
          <div style={{marginBottom:18}}>
            <div style={ss(9,400,DM,{letterSpacing:1.5,marginBottom:10})}>BRAND DNA</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
              {profile.brands.slice(0,12).map((b,i)=>(
                <div key={i} style={{padding:"5px 12px",borderRadius:20,background:"#141210",border:"1px solid #2A2418",...ss(9,400,MD,{letterSpacing:0.5})}}>
                  {b}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── CONTENT TABS ── */}
      <div style={{background:"#0A0908",borderBottom:"1px solid #1A1A1A",display:"flex",flexShrink:0}}>
        {tabs.map(t=>(
          <button key={t.id} onClick={()=>setActiveTab(t.id)} style={{flex:1,padding:"12px 4px",background:"none",border:"none",borderBottom:activeTab===t.id?`2px solid ${G}`:"2px solid transparent",...ss(9,activeTab===t.id?600:400,activeTab===t.id?G:DM,{letterSpacing:1}),cursor:_p}}>
            {t.label}{t.count!==undefined?` (${t.count})`:""}
          </button>
        ))}
      </div>

      {/* ── OUTFITS TAB ── */}
      {activeTab==="posts"&&(
        <div style={{padding:"16px 18px",flex:1}}>
          {(profile.recentPosts||[]).length===0&&(
            <div style={{textAlign:"center",padding:"48px 0",opacity:0.4}}>
              <div style={sr(14,300,DM,{fontStyle:"italic"})}>No outfits posted yet</div>
            </div>
          )}
          {(profile.recentPosts||[]).map((post,pi)=>{
            const PortraitComp = demoProfile ? [Portrait1,Portrait2,Portrait3,Portrait4][(post.portrait-1)%4] : null;
            return(
              <div key={post.id||pi} style={{background:"#111",borderRadius:18,overflow:"hidden",marginBottom:14,border:"1px solid #1E1E1E"}}>
                {PortraitComp?(
                  <div style={{width:"100%",position:"relative"}}>
                    <div style={{width:"100%",paddingTop:"56%",position:"relative",overflow:"hidden"}}>
                      <div style={{..._abs0}}><PortraitComp/></div>
                    </div>
                    <div style={{position:"absolute",bottom:10,left:14}}>
                      <div style={{...sr(16,500,"#F0EBE3"),textShadow:"0 1px 8px #00000099"}}>{post.outfit}</div>
                    </div>
                  </div>
                ):(
                  <div style={{padding:"14px 14px 6px"}}>
                    <div style={sr(15,500,"#E8E0D4")}>{post.outfit}</div>
                    {post.occasion&&<div style={ss(9,400,DM,{marginTop:2})}>{post.occasion}</div>}
                  </div>
                )}
                <div style={{padding:"12px 14px"}}>
                  <div style={{display:"flex",gap:8,marginBottom:12,overflowX:"auto",paddingBottom:2}}>
                    {(post.items||[]).map((item,i)=>(
                      <div key={i} style={{flexShrink:0,width:80,borderRadius:12,overflow:"hidden",background:_1a,border:_2a}}>
                        <div style={{height:64,display:"flex",alignItems:"center",justifyContent:"center",background:"#1E1E1E",overflow:"hidden"}}>
                          {item.sourceImage||item.source_image
                            ? <img src={item.sourceImage||item.source_image} style={{width:"100%",height:"100%",objectFit:"contain",padding:4,boxSizing:"border-box"}} alt={item.name}/>
                            : <ItemIllustration item={item} size={52}/>
                          }
                        </div>
                        <div style={{padding:"6px 6px 8px"}}>
                          <div style={ss(8,500,MD,{overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis"})}>{item.name}</div>
                          <div style={sr(11,500,G)}>${item.price||0}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div style={{..._btwn}}>
                    <div style={ss(10,400,DM)}>♡ {post.likes}</div>
                    <button onClick={()=>showToast("Saved \u2746")} style={{padding:"5px 14px",borderRadius:20,background:_1a,border:_2a,...ss(8,400,MD,{letterSpacing:1}),cursor:_p}}>SAVE LOOK</button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── ITEMS TAB ── */}
      {activeTab==="items"&&(
        <div style={{padding:"16px 18px",flex:1}}>
          {(profile.allItems||[]).length===0&&(
            <div style={{textAlign:"center",padding:"48px 0",opacity:0.4}}>
              <div style={sr(14,300,DM,{fontStyle:"italic"})}>No items in closet yet</div>
            </div>
          )}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            {(profile.allItems||[]).map((item,i)=>{
              const alreadyAdded = addedItems.has(item.id||i);
              return(
              <div key={i} style={{background:"#111",borderRadius:14,overflow:"hidden",border:"1px solid #1E1E1E"}}>
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
                    <button onClick={async()=>{
                      if(alreadyAdded||!onAddToCloset) return;
                      const newItem={
                        id: Date.now(),
                        name: item.name,
                        brand: item.brand||"Unknown",
                        category: item.category||"Tops",
                        color: item.color||"#C4A882",
                        price: item.price||0,
                        emoji: item.emoji||"👗",
                        wearCount: 0,
                        lastWorn: "Never",
                        purchaseDate: "",
                        condition: item.condition||"Good",
                        forSale: false,
                        tags: [],
                        sourceImage: item.sourceImage||item.source_image||null,
                      };
                      await onAddToCloset(newItem);
                      setAddedItems(prev=>new Set([...prev,item.id||i]));
                      showToast(`${item.name} added to your closet \u2746`);
                    }} style={{
                      padding:"4px 10px",borderRadius:20,cursor:alreadyAdded?"default":_p,
                      background:alreadyAdded?"#1A2A1A":`${G}22`,
                      border:alreadyAdded?"1px solid #2A4A2A":`1px solid ${G}55`,
                      ...ss(8,600,alreadyAdded?"#80C880":G,{letterSpacing:0.5}),
                    }}>
                      {alreadyAdded?"✓ Added":"+ Closet"}
                    </button>
                  </div>
                </div>
              </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── FOR SALE TAB ── */}
      {activeTab==="forsale"&&(
        <div style={{padding:"16px 18px",flex:1}}>
          {profile.forSaleCount===0&&(
            <div style={{textAlign:"center",padding:"48px 0",opacity:0.4}}>
              <div style={sr(14,300,DM,{fontStyle:"italic"})}>Nothing for sale right now</div>
            </div>
          )}
          {(profile.forSale||[]).map((item,i)=>(
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
        <div style={{padding:"16px 18px",flex:1}}>
          <div style={{background:"#111",borderRadius:16,padding:"18px",marginBottom:14,border:"1px solid #1E1E1E"}}>
            <div style={ss(9,400,DM,{letterSpacing:1.5,marginBottom:10})}>STYLE IDENTITY</div>
            {profile.style
              ? <div style={sr(16,400,"#C0B09A",{lineHeight:1.8,fontStyle:"italic"})}>&ldquo;{profile.style}&rdquo;</div>
              : <div style={ss(10,400,DM,{fontStyle:"italic"})}>No style identity set yet</div>
            }
            {profile.bio&&<div style={{marginTop:14,...ss(10,400,"#907860",{lineHeight:1.7})}}>{profile.bio}</div>}
          </div>
          <div style={{background:"#111",borderRadius:16,padding:"18px",marginBottom:14,border:"1px solid #1E1E1E"}}>
            <div style={ss(9,400,DM,{letterSpacing:1.5,marginBottom:12})}>WARDROBE HEALTH</div>
            {[
              {label:"Item Utilization",  value:profile.stats.sustainabilityScore, color:"#4A8A4A"},
              {label:"Brands Diversity",  value:Math.min(100,Math.round((profile.stats.brandsCount/20)*100)), color:G},
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
  );
}

// ── OUTFIT PORTRAIT ILLUSTRATIONS ─────────────────────────────────────────────
// Four hand-crafted SVG fashion illustrations, one per feed post

function Portrait1() {
  // @jess.styles — "Sunday Market Run": denim jeans, white sneakers, knit scarf
  // Casual-cool, natural tones, outdoor morning vibe
  return (
    <svg viewBox="0 0 380 420" fill="none" xmlns="http://www.w3.org/2000/svg" style={{width:"100%",height:"100%"}}>
      <defs>
        <linearGradient id="p1bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#E8DDD0"/>
          <stop offset="100%" stopColor="#D4C4B0"/>
        </linearGradient>
        <linearGradient id="p1denim" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#4A6080"/>
          <stop offset="100%" stopColor="#2A4060"/>
        </linearGradient>
        <linearGradient id="p1skin" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#E8C4A0"/>
          <stop offset="100%" stopColor="#D4A880"/>
        </linearGradient>
        <radialGradient id="p1vignette" cx="50%" cy="50%" r="70%">
          <stop offset="60%" stopColor="transparent"/>
          <stop offset="100%" stopColor="#00000040"/>
        </radialGradient>
      </defs>

      {/* Background — warm linen */}
      <rect width="380" height="420" fill="url(#p1bg)"/>
      {/* Subtle grid texture */}
      <line x1="0" y1="210" x2="380" y2="210" stroke="#C8B89A" strokeWidth="0.5" opacity="0.4"/>
      <line x1="190" y1="0" x2="190" y2="420" stroke="#C8B89A" strokeWidth="0.5" opacity="0.4"/>
      {/* Shadow on floor */}
      <ellipse cx="190" cy="400" rx="80" ry="12" fill="#B0A090" opacity="0.3"/>

      {/* ── FIGURE ── */}
      {/* Legs — fitted denim */}
      <path d="M148 240 L140 390 L162 392 L172 270 L190 270 L208 270 L218 392 L240 390 L232 240 Z" fill="url(#p1denim)"/>
      {/* Denim seam details */}
      <line x1="172" y1="250" x2="168" y2="390" stroke="#3A5070" strokeWidth="0.8" opacity="0.5"/>
      <line x1="208" y1="250" x2="212" y2="390" stroke="#3A5070" strokeWidth="0.8" opacity="0.5"/>
      {/* Belt line */}
      <rect x="143" y="236" width="94" height="10" rx="2" fill="#3A2A1A"/>
      <rect x="183" y="237" width="14" height="8" rx="1" fill="#C4A860"/>

      {/* Torso — oversized cream knit top */}
      <path d="M140 150 C134 160, 130 200, 132 240 L248 240 C250 200, 246 160, 240 150 C230 144, 210 140, 190 140 C170 140, 150 144, 140 150Z" fill="#F0EAE0"/>
      {/* Knit texture lines */}
      {[155,165,175,185,195,205,215,225].map((y,i) => (
        `<line key="${i}" x1="136" y1="${y}" x2="244" y2="${y}" stroke="#DDD4C4" strokeWidth="0.7" strokeDasharray="3,3"/>`
      )).join("")}

      {/* Scarf — draped loosely over shoulders */}
      <path d="M155 148 C160 165, 170 180, 175 210 C178 195, 182 175, 190 168 C198 175, 202 195, 205 210 C210 180, 220 165, 225 148 C215 155, 205 158, 190 158 C175 158, 165 155, 155 148Z" fill="#C47A5A" opacity="0.9"/>
      {/* Scarf fringe */}
      {[170,176,182,188,194,200,206,212].map((x,i) => (
        `<line key="f${i}" x1="${x}" y1="208" x2="${x-2}" y2="226" stroke="#B06040" strokeWidth="1.2" strokeLinecap="round"/>`
      )).join("")}

      {/* Arms */}
      {/* Left arm */}
      <path d="M140 155 C128 170, 118 200, 120 230 L134 228 C134 205, 140 178, 148 162Z" fill="#F0EAE0"/>
      <path d="M120 228 C115 238, 112 245, 115 252 L130 248 C128 242, 128 236, 132 228Z" fill="url(#p1skin)"/>
      {/* Right arm — holding a coffee cup */}
      <path d="M240 155 C252 170, 262 200, 260 230 L246 228 C246 205, 240 178, 232 162Z" fill="#F0EAE0"/>
      <path d="M260 228 C265 238, 268 244, 265 252 L250 248 C252 242, 252 236, 248 228Z" fill="url(#p1skin)"/>
      {/* Coffee cup in right hand */}
      <rect x="255" y="245" width="22" height="28" rx="4" fill="#E8D4B0" stroke="#C4A880" strokeWidth="1"/>
      <rect x="255" y="245" width="22" height="8" rx="2" fill="#6A4020"/>
      <path d="M277 255 C283 255, 283 265, 277 265" stroke="#C4A880" strokeWidth="1.5" fill="none"/>

      {/* Sneakers */}
      <path d="M136 388 C124 390, 112 394, 110 400 L162 400 L164 388 Z" fill="#F5F0E8" stroke="#E0D8CC" strokeWidth="1"/>
      <path d="M218 388 C230 390, 242 394, 244 400 L192 400 L190 388 Z" fill="#F5F0E8" stroke="#E0D8CC" strokeWidth="1"/>
      {/* Shoe sole */}
      <path d="M110 400 L162 400" stroke="#D0C8B8" strokeWidth="3" strokeLinecap="round"/>
      <path d="M192 400 L244 400" stroke="#D0C8B8" strokeWidth="3" strokeLinecap="round"/>
      {/* Laces */}
      <line x1="128" y1="393" x2="154" y2="393" stroke="#C4A882" strokeWidth="1"/>
      <line x1="224" y1="393" x2="238" y2="393" stroke="#C4A882" strokeWidth="1"/>

      {/* Neck */}
      <path d="M180 105 L180 142 L200 142 L200 105 Z" fill="url(#p1skin)"/>
      {/* Head */}
      <ellipse cx="190" cy="80" rx="34" ry="38" fill="url(#p1skin)"/>
      {/* Hair — messy bun */}
      <path d="M158 70 C155 40, 170 20, 190 18 C210 20, 225 40, 222 70 C215 58, 206 52, 200 55 C195 42, 185 42, 180 55 C174 52, 166 58, 158 70Z" fill="#2A1A10"/>
      <ellipse cx="200" cy="34" rx="14" ry="12" fill="#3A2820"/>
      {/* Face */}
      <ellipse cx="180" cy="82" rx="4" ry="5" fill="#C4906A" opacity="0.6"/>
      <ellipse cx="200" cy="82" rx="4" ry="5" fill="#C4906A" opacity="0.6"/>
      <path d="M182 96 Q190 102, 198 96" stroke="#A06040" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
      <circle cx="179" cy="79" r="4.5" fill="#3A2A20"/>
      <circle cx="200" cy="79" r="4.5" fill="#3A2A20"/>
      <circle cx="180" cy="78" r="1.5" fill="#F0EBE3"/>
      <circle cx="201" cy="78" r="1.5" fill="#F0EBE3"/>
      {/* Sunglasses */}
      <rect x="170" y="73" width="18" height="12" rx="5" fill="none" stroke="#2A1A0A" strokeWidth="2"/>
      <rect x="192" y="73" width="18" height="12" rx="5" fill="none" stroke="#2A1A0A" strokeWidth="2"/>
      <line x1="188" y1="79" x2="192" y2="79" stroke="#2A1A0A" strokeWidth="1.5"/>
      <line x1="170" y1="79" x2="162" y2="77" stroke="#2A1A0A" strokeWidth="1.5"/>
      <line x1="210" y1="79" x2="218" y2="77" stroke="#2A1A0A" strokeWidth="1.5"/>

      {/* Vignette overlay */}
      <rect width="380" height="420" fill="url(#p1vignette)"/>
    </svg>
  );
}

function Portrait2() {
  // @minimal.edit — "All-Black Everything": fitted bodysuit, oversized blazer, heeled mules
  return (
    <svg viewBox="0 0 380 420" fill="none" xmlns="http://www.w3.org/2000/svg" style={{width:"100%",height:"100%"}}>
      <defs>
        <linearGradient id="p2bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#1A1A1A"/>
          <stop offset="100%" stopColor="#0A0A0A"/>
        </linearGradient>
        <linearGradient id="p2blazer" x1="0" y1="0" x2="0.3" y2="1">
          <stop offset="0%" stopColor="#2A2A2A"/>
          <stop offset="100%" stopColor="#111111"/>
        </linearGradient>
        <linearGradient id="p2skin2" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#C89878"/>
          <stop offset="100%" stopColor="#A87858"/>
        </linearGradient>
        <radialGradient id="p2light" cx="40%" cy="20%" r="60%">
          <stop offset="0%" stopColor="#FFFFFF08"/>
          <stop offset="100%" stopColor="transparent"/>
        </radialGradient>
      </defs>

      <rect width="380" height="420" fill="url(#p2bg)"/>
      <rect width="380" height="420" fill="url(#p2light)"/>
      {/* Floor reflection */}
      <ellipse cx="190" cy="408" rx="70" ry="6" fill="#FFFFFF" opacity="0.06"/>

      {/* ── FIGURE ── */}
      {/* Legs — bodysuit/trousers, all black */}
      <path d="M158 252 L150 400 L172 400 L180 272 L200 272 L208 272 L210 400 L230 400 L222 252 Z" fill="#151515"/>
      {/* Subtle crease on trousers */}
      <line x1="180" y1="272" x2="176" y2="400" stroke="#2A2A2A" strokeWidth="0.8" opacity="0.7"/>
      <line x1="200" y1="272" x2="204" y2="400" stroke="#2A2A2A" strokeWidth="0.8" opacity="0.7"/>

      {/* Bodysuit — fitted black */}
      <path d="M158 145 C152 158, 150 210, 152 252 L228 252 C230 210, 228 158, 222 145 C212 138, 202 135, 190 135 C178 135, 168 138, 158 145Z" fill="#1A1A1A"/>

      {/* Oversized blazer */}
      {/* Left lapel/body */}
      <path d="M118 148 C114 165, 112 210, 116 260 L156 255 C152 215, 152 168, 155 150 C140 148, 128 148, 118 148Z" fill="url(#p2blazer)" stroke="#303030" strokeWidth="0.5"/>
      {/* Right lapel/body */}
      <path d="M262 148 C266 165, 268 210, 264 260 L224 255 C228 215, 228 168, 225 150 C240 148, 252 148, 262 148Z" fill="url(#p2blazer)" stroke="#303030" strokeWidth="0.5"/>
      {/* Blazer back panel */}
      <path d="M155 150 L225 150 L228 255 L152 255Z" fill="#202020"/>
      {/* Lapels */}
      <path d="M155 150 C160 155, 168 162, 175 175 C180 162, 185 155, 190 150 Z" fill="#252525" stroke="#353535" strokeWidth="0.5"/>
      <path d="M225 150 C220 155, 212 162, 205 175 C200 162, 195 155, 190 150 Z" fill="#252525" stroke="#353535" strokeWidth="0.5"/>
      {/* Blazer pocket */}
      <rect x="128" y="210" width="20" height="3" rx="1" fill="#353535"/>

      {/* Left arm hanging */}
      <path d="M118 148 C105 162, 98 200, 100 240 L116 238 C116 205, 120 172, 130 158Z" fill="#202020" stroke="#2A2A2A" strokeWidth="0.5"/>
      <path d="M100 238 C97 250, 96 258, 100 265 L114 260 C112 253, 112 246, 114 238Z" fill="url(#p2skin2)"/>
      {/* Right arm — hand on hip */}
      <path d="M262 148 C275 162, 282 200, 280 240 L264 238 C264 205, 260 172, 250 158Z" fill="#202020" stroke="#2A2A2A" strokeWidth="0.5"/>
      <path d="M280 238 C283 250, 283 258, 279 265 L265 260 C267 253, 267 246, 265 238Z" fill="url(#p2skin2)"/>

      {/* Heeled mules */}
      {/* Left shoe */}
      <path d="M148 396 L172 396 L170 404 L146 404Z" fill="#1A1A1A" stroke="#333" strokeWidth="0.5"/>
      <line x1="160" y1="396" x2="158" y2="368" stroke="#1A1A1A" strokeWidth="6" strokeLinecap="round"/>
      {/* Heel */}
      <rect x="146" y="400" width="6" height="14" rx="1" fill="#333"/>
      {/* Right shoe */}
      <path d="M208 396 L232 396 L234 404 L210 404Z" fill="#1A1A1A" stroke="#333" strokeWidth="0.5"/>
      <line x1="220" y1="396" x2="222" y2="368" stroke="#1A1A1A" strokeWidth="6" strokeLinecap="round"/>
      <rect x="228" y="400" width="6" height="14" rx="1" fill="#333"/>

      {/* Neck */}
      <path d="M181 105 L181 138 L199 138 L199 105 Z" fill="url(#p2skin2)"/>
      {/* Head */}
      <ellipse cx="190" cy="78" rx="33" ry="36" fill="url(#p2skin2)"/>
      {/* Hair — sleek pulled back */}
      <path d="M158 68 C155 38, 170 16, 190 14 C210 16, 225 38, 222 68 C218 55, 208 48, 200 52 L190 46 L180 52 C172 48, 162 55, 158 68Z" fill="#0A0808"/>
      {/* Chignon/bun at back */}
      <ellipse cx="190" cy="30" rx="20" ry="14" fill="#110E0E"/>
      {/* Face */}
      <circle cx="178" cy="76" r="4" fill="#181818" opacity="0.8"/>
      <circle cx="202" cy="76" r="4" fill="#181818" opacity="0.8"/>
      <circle cx="179" cy="75" r="1.5" fill="#E8DDD0" opacity="0.8"/>
      <circle cx="203" cy="75" r="1.5" fill="#E8DDD0" opacity="0.8"/>
      {/* Brows */}
      <path d="M172 68 L186 66" stroke="#0A0808" strokeWidth="1.5" strokeLinecap="round"/>
      <path d="M194 66 L208 68" stroke="#0A0808" strokeWidth="1.5" strokeLinecap="round"/>
      {/* Lips — bold red */}
      <path d="M183 92 Q190 98, 197 92 Q193 88, 190 89 Q187 88, 183 92Z" fill="#8A2020"/>
      {/* Earrings — small gold hoops */}
      <circle cx="158" cy="82" r="5" fill="none" stroke="#C4A860" strokeWidth="1.5"/>
      <circle cx="222" cy="82" r="5" fill="none" stroke="#C4A860" strokeWidth="1.5"/>

      {/* Rim lighting */}
      <rect width="380" height="420" fill="none" stroke="#FFFFFF" strokeWidth="0" opacity="0.03"/>
    </svg>
  );
}

function Portrait3() {
  // @the.closet.co — "Linen and Light": linen wrap dress, gold necklace, strappy sandals
  return (
    <svg viewBox="0 0 380 420" fill="none" xmlns="http://www.w3.org/2000/svg" style={{width:"100%",height:"100%"}}>
      <defs>
        <linearGradient id="p3bg" x1="0" y1="0" x2="0.5" y2="1">
          <stop offset="0%" stopColor="#F2EDE4"/>
          <stop offset="100%" stopColor="#E4D8C4"/>
        </linearGradient>
        <linearGradient id="p3dress" x1="0" y1="0" x2="0.2" y2="1">
          <stop offset="0%" stopColor="#E8DCC8"/>
          <stop offset="100%" stopColor="#D4C4A0"/>
        </linearGradient>
        <linearGradient id="p3skin3" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#E0BFA0"/>
          <stop offset="100%" stopColor="#C8A080"/>
        </linearGradient>
        <radialGradient id="p3sun" cx="80%" cy="10%" r="50%">
          <stop offset="0%" stopColor="#FFF5E0" stopOpacity="0.7"/>
          <stop offset="100%" stopColor="transparent"/>
        </radialGradient>
      </defs>

      <rect width="380" height="420" fill="url(#p3bg)"/>
      <rect width="380" height="420" fill="url(#p3sun)"/>
      {/* Floor shadow */}
      <ellipse cx="190" cy="408" rx="75" ry="10" fill="#C8B898" opacity="0.25"/>
      {/* Light texture lines */}
      {[80,160,240,320].map((y,i) => (
        <line key={i} x1="0" y1={y} x2="380" y2={y} stroke="#D8CCBA" strokeWidth="0.4" opacity="0.3"/>
      ))}

      {/* ── FIGURE ── */}
      {/* Wrap dress — flowing, midi length */}
      {/* Main body */}
      <path d="M155 148 C148 165, 144 210, 142 270 C148 310, 155 355, 152 400 L180 400 L186 310 L190 290 L194 310 L200 400 L228 400 C225 355, 232 310, 238 270 C236 210, 232 165, 225 148 C215 142, 205 138, 190 138 C175 138, 165 142, 155 148Z" fill="url(#p3dress)"/>
      {/* Wrap front overlap */}
      <path d="M190 148 C184 160, 175 185, 168 220 C175 215, 185 208, 195 205 C200 185, 196 162, 190 148Z" fill="#D4C4A0" opacity="0.6"/>
      {/* Dress linen texture */}
      {[165,180,195,210,225,240,260,280,300,320,340,360,380].map((y,i) => (
        <line key={`dt${i}`} x1="142" y1={y} x2="238" y2={y} stroke="#C8B890" strokeWidth="0.5" strokeDasharray="8,12" opacity="0.4"/>
      ))}
      {/* Dress wrap tie at waist */}
      <path d="M172 218 C182 215, 192 216, 200 218 C204 215, 214 210, 220 205 C215 212, 205 220, 200 225 C195 228, 185 228, 180 225Z" fill="#C8B48A" opacity="0.8"/>

      {/* Arms */}
      {/* Left — relaxed down */}
      <path d="M155 150 C143 165, 133 200, 134 238 L148 236 C149 205, 154 174, 162 158Z" fill="url(#p3dress)" opacity="0.8"/>
      <path d="M134 236 C130 248, 128 258, 131 265 L145 260 C144 252, 144 244, 146 236Z" fill="url(#p3skin3)"/>
      {/* Right — raised, tucking hair */}
      <path d="M225 150 C234 140, 248 130, 255 118 L244 112 C238 122, 230 134, 222 144Z" fill="url(#p3dress)" opacity="0.8"/>
      <path d="M255 118 C260 110, 262 100, 258 93 L246 98 C249 104, 250 112, 248 118Z" fill="url(#p3skin3)"/>

      {/* Gold necklace */}
      <path d="M174 138 C178 150, 184 158, 190 162 C196 158, 202 150, 206 138" stroke="#C4A840" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
      <circle cx="190" cy="162" r="3" fill="#C4A840"/>
      <circle cx="190" cy="162" r="1.5" fill="#E8CC70"/>

      {/* Strappy sandals */}
      {/* Left */}
      <line x1="152" y1="398" x2="170" y2="398" stroke="#B09060" strokeWidth="2" strokeLinecap="round"/>
      <line x1="154" y1="394" x2="168" y2="394" stroke="#B09060" strokeWidth="1.5" strokeLinecap="round"/>
      <line x1="156" y1="390" x2="166" y2="390" stroke="#B09060" strokeWidth="1.5" strokeLinecap="round"/>
      <line x1="161" y1="388" x2="161" y2="400" stroke="#B09060" strokeWidth="1.5"/>
      {/* Right */}
      <line x1="210" y1="398" x2="228" y2="398" stroke="#B09060" strokeWidth="2" strokeLinecap="round"/>
      <line x1="212" y1="394" x2="226" y2="394" stroke="#B09060" strokeWidth="1.5" strokeLinecap="round"/>
      <line x1="214" y1="390" x2="224" y2="390" stroke="#B09060" strokeWidth="1.5" strokeLinecap="round"/>
      <line x1="219" y1="388" x2="219" y2="400" stroke="#B09060" strokeWidth="1.5"/>

      {/* Neck */}
      <path d="M181 106 L181 140 L199 140 L199 106 Z" fill="url(#p3skin3)"/>
      {/* Head */}
      <ellipse cx="190" cy="78" rx="34" ry="38" fill="url(#p3skin3)"/>
      {/* Hair — long wavy, half up */}
      <path d="M157 72 C154 40, 168 16, 190 14 C212 16, 226 40, 223 72 C215 55, 204 46, 195 50 L190 44 L185 50 C176 46, 165 55, 157 72Z" fill="#5A3A22"/>
      {/* Long hair flowing */}
      <path d="M157 72 C150 90, 145 115, 148 145 C155 138, 160 130, 162 120 C164 105, 162 90, 157 72Z" fill="#5A3A22"/>
      <path d="M223 72 C230 90, 235 120, 230 148 C224 140, 220 130, 218 118 C216 100, 218 86, 223 72Z" fill="#5A3A22"/>
      {/* Face */}
      <circle cx="178" cy="76" r="3.5" fill="#5A3A22" opacity="0.9"/>
      <circle cx="202" cy="76" r="3.5" fill="#5A3A22" opacity="0.9"/>
      <circle cx="179" cy="75" r="1.5" fill="#F8F0E8"/>
      <circle cx="203" cy="75" r="1.5" fill="#F8F0E8"/>
      {/* Brows — natural arched */}
      <path d="M172 67 C176 64, 182 64, 186 66" stroke="#5A3A22" strokeWidth="1.5" strokeLinecap="round" fill="none"/>
      <path d="M194 66 C198 64, 204 64, 208 67" stroke="#5A3A22" strokeWidth="1.5" strokeLinecap="round" fill="none"/>
      {/* Smile */}
      <path d="M184 92 Q190 99, 196 92" stroke="#A06050" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
      {/* Cheek flush */}
      <ellipse cx="174" cy="87" rx="7" ry="4" fill="#E09080" opacity="0.2"/>
      <ellipse cx="206" cy="87" rx="7" ry="4" fill="#E09080" opacity="0.2"/>
      {/* Small flower in hair */}
      <circle cx="215" cy="62" r="6" fill="#E8C8A0" opacity="0.7"/>
      <circle cx="215" cy="62" r="3" fill="#F0E0C0"/>
    </svg>
  );
}

function Portrait4() {
  // @curated.claire — "Board Room Energy": camel trench coat, tailored trousers, structured tote
  return (
    <svg viewBox="0 0 380 420" fill="none" xmlns="http://www.w3.org/2000/svg" style={{width:"100%",height:"100%"}}>
      <defs>
        <linearGradient id="p4bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#E8E0D4"/>
          <stop offset="100%" stopColor="#D4CAB8"/>
        </linearGradient>
        <linearGradient id="p4coat" x1="0.1" y1="0" x2="0.9" y2="1">
          <stop offset="0%" stopColor="#C8A870"/>
          <stop offset="100%" stopColor="#A08040"/>
        </linearGradient>
        <linearGradient id="p4trousers" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#484038"/>
          <stop offset="100%" stopColor="#302820"/>
        </linearGradient>
        <linearGradient id="p4skin4" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#D4A880"/>
          <stop offset="100%" stopColor="#B88860"/>
        </linearGradient>
      </defs>

      <rect width="380" height="420" fill="url(#p4bg)"/>
      {/* Architectural background — vertical lines suggesting an office */}
      <line x1="80" y1="0" x2="80" y2="420" stroke="#C8C0B0" strokeWidth="0.5" opacity="0.5"/>
      <line x1="300" y1="0" x2="300" y2="420" stroke="#C8C0B0" strokeWidth="0.5" opacity="0.5"/>
      <rect x="0" y="380" width="380" height="40" fill="#C4BAA8" opacity="0.4"/>
      <ellipse cx="190" cy="408" rx="78" ry="9" fill="#B0A898" opacity="0.3"/>

      {/* ── FIGURE ── */}
      {/* Tailored trousers */}
      <path d="M160 256 L152 400 L174 400 L182 278 L198 278 L206 278 L208 400 L228 400 L220 256 Z" fill="url(#p4trousers)"/>
      {/* Trouser crease */}
      <line x1="182" y1="280" x2="178" y2="400" stroke="#484040" strokeWidth="0.8" opacity="0.6"/>
      <line x1="198" y1="280" x2="202" y2="400" stroke="#484040" strokeWidth="0.8" opacity="0.6"/>

      {/* Blouse — white silk underneath */}
      <path d="M166 148 C162 162, 160 210, 162 256 L218 256 C220 210, 218 162, 214 148 C206 142, 198 138, 190 138 C182 138, 174 142, 166 148Z" fill="#F5F0EA"/>

      {/* Trench coat — main body */}
      <path d="M122 145 C116 162, 112 215, 116 268 L160 262 C158 215, 158 168, 162 150 C148 146, 134 144, 122 145Z" fill="url(#p4coat)" stroke="#A09060" strokeWidth="0.5"/>
      <path d="M258 145 C264 162, 268 215, 264 268 L220 262 C222 215, 222 168, 218 150 C232 146, 246 144, 258 145Z" fill="url(#p4coat)" stroke="#A09060" strokeWidth="0.5"/>
      <path d="M162 150 L218 150 L220 262 L160 262Z" fill="#C09A5A"/>
      {/* Coat lapels */}
      <path d="M162 152 C168 160, 176 172, 182 188 C184 172, 186 160, 190 152Z" fill="#B88A48" stroke="#A07A38" strokeWidth="0.5"/>
      <path d="M218 152 C212 160, 204 172, 198 188 C196 172, 194 160, 190 152Z" fill="#B88A48" stroke="#A07A38" strokeWidth="0.5"/>
      {/* Belt */}
      <path d="M150 220 L230 220 L232 228 L148 228Z" fill="#8A6828" opacity="0.9"/>
      <rect x="185" y="220" width="10" height="8" rx="1" fill="#C4A840"/>
      {/* Coat flap pockets */}
      <rect x="128" y="238" width="26" height="16" rx="3" fill="#B88A48" stroke="#A07A38" strokeWidth="0.5"/>
      <rect x="226" y="238" width="26" height="16" rx="3" fill="#B88A48" stroke="#A07A38" strokeWidth="0.5"/>
      {/* Coat buttons */}
      {[175,195].map((y,i) => (
        <circle key={i} cx="190" cy={y} r="3" fill="#A07838" stroke="#C4A850" strokeWidth="0.5"/>
      ))}

      {/* Left arm — straight down */}
      <path d="M122 145 C108 160, 100 200, 102 244 L118 242 C118 206, 122 170, 132 156Z" fill="url(#p4coat)" stroke="#A09060" strokeWidth="0.4"/>
      <path d="M102 242 C99 255, 98 264, 102 270 L116 265 C114 258, 114 250, 116 242Z" fill="url(#p4skin4)"/>

      {/* Right arm — carrying tote */}
      <path d="M258 145 C272 160, 280 200, 278 244 L262 242 C262 206, 258 170, 248 156Z" fill="url(#p4coat)" stroke="#A09060" strokeWidth="0.4"/>
      <path d="M278 242 C281 255, 282 264, 278 270 L264 265 C266 258, 266 250, 264 242Z" fill="url(#p4skin4)"/>

      {/* Structured tote bag */}
      <rect x="270" y="265" width="54" height="46" rx="5" fill="#1A1A1A" stroke="#2A2A2A" strokeWidth="0.5"/>
      {/* Tote hardware */}
      <rect x="282" y="258" width="6" height="10" rx="1" fill="#C4A840"/>
      <rect x="306" y="258" width="6" height="10" rx="1" fill="#C4A840"/>
      <path d="M282 260 Q290 252, 298 252 Q306 252, 312 260" stroke="#C4A840" strokeWidth="1.5" fill="none"/>
      {/* Tote pocket */}
      <rect x="278" y="278" width="38" height="24" rx="3" fill="#252525"/>
      <line x1="297" y1="278" x2="297" y2="302" stroke="#1A1A1A" strokeWidth="1"/>

      {/* Classic pumps */}
      <path d="M150 396 L174 396 L172 404 L148 404Z" fill="#1E1A14" stroke="#2A2420" strokeWidth="0.5"/>
      <line x1="162" y1="396" x2="160" y2="365" stroke="#1E1A14" strokeWidth="5" strokeLinecap="round"/>
      <rect x="148" y="402" width="5" height="12" rx="1" fill="#2A2420"/>
      <path d="M208 396 L232 396 L234 404 L210 404Z" fill="#1E1A14" stroke="#2A2420" strokeWidth="0.5"/>
      <line x1="220" y1="396" x2="222" y2="365" stroke="#1E1A14" strokeWidth="5" strokeLinecap="round"/>
      <rect x="227" y="402" width="5" height="12" rx="1" fill="#2A2420"/>

      {/* Neck */}
      <path d="M181 106 L181 140 L199 140 L199 106 Z" fill="url(#p4skin4)"/>
      {/* Head */}
      <ellipse cx="190" cy="78" rx="33" ry="37" fill="url(#p4skin4)"/>
      {/* Hair — sleek bob */}
      <path d="M158 72 C155 40, 168 16, 190 14 C212 16, 225 40, 222 72 C220 60, 212 52, 202 54 C196 44, 184 44, 178 54 C168 52, 160 60, 158 72Z" fill="#1A1210"/>
      {/* Bob shape */}
      <path d="M158 72 C154 88, 154 100, 158 110 C162 116, 168 118, 175 116 C170 106, 165 95, 165 82Z" fill="#1A1210"/>
      <path d="M222 72 C226 88, 226 100, 222 110 C218 116, 212 118, 205 116 C210 106, 215 95, 215 82Z" fill="#1A1210"/>
      {/* Face */}
      <circle cx="178" cy="75" r="4" fill="#12100E" opacity="0.85"/>
      <circle cx="202" cy="75" r="4" fill="#12100E" opacity="0.85"/>
      <circle cx="179" cy="74" r="1.5" fill="#EEE8E0"/>
      <circle cx="203" cy="74" r="1.5" fill="#EEE8E0"/>
      {/* Brows — structured */}
      <path d="M171 65 L186 63" stroke="#1A1210" strokeWidth="2" strokeLinecap="round"/>
      <path d="M194 63 L209 65" stroke="#1A1210" strokeWidth="2" strokeLinecap="round"/>
      {/* Lips — nude */}
      <path d="M184 91 Q190 97, 196 91 Q193 88, 190 89 Q187 88, 184 91Z" fill="#B07060"/>
      {/* Pearl earrings */}
      <circle cx="157" cy="82" r="4" fill="#F0EBE3" stroke="#E0D8CC" strokeWidth="0.5"/>
      <circle cx="223" cy="82" r="4" fill="#F0EBE3" stroke="#E0D8CC" strokeWidth="0.5"/>
    </svg>
  );
}

const outfitPortraits = [Portrait1, Portrait2, Portrait3, Portrait4];

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

  const reset=()=>{setMode(null);setUrl("");setDesc("");setDescResults([]);setPhotoPreview(null);setDetected([]);setAdded({});setScanPct(0);setScanStage("upload");setWName("");setWBrand("");setWPrice("");setWColor("#C4A882");setWGap("");};

  const handlePhotoFile=async(file)=>{
    if(!file||!file.type.startsWith("image/")) return;
    const reader=new FileReader();
    reader.onload=async(e)=>{
      const dataUrl=e.target.result;
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
        const raw=await callClaudeVision(base64,file.type,
          `Identify all visible clothing items and accessories in this fashion image. For each item provide a name, brand/style, estimated price range, confidence 70-99, emoji, and a short note. Respond ONLY with JSON: {"items":[{"id":1,"name":"...","brand":"...","price":"$X-Y","confidence":95,"emoji":"👗","note":"...","color":"#hexcode"}]}. Max 5 items.`
        );
        clearInterval(tick); setScanPct(100); setScanMsg("Done!");
        const json=JSON.parse(raw.replace(/```json|```/g,"").trim());
        setTimeout(()=>{ setDetected(json.items||[]); setScanStage("results"); },400);
      }catch(err){ clearInterval(tick); setScanStage("error"); }
    };
    reader.readAsDataURL(file);
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
            <>
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
                <>
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
                </>
              )}
              {scanStage==="error"&&(
                <div style={{textAlign:"center",padding:"32px 0"}}>
                  <div style={{fontSize:32,marginBottom:12}}>⚠️</div>
                  <div style={sr(16,300,G,{marginBottom:8})}>Scan failed</div>
                  <button onClick={()=>{setScanStage("upload");setPhotoPreview(null);}} style={{padding:"10px 24px",borderRadius:20,background:G,border:"none",...ss(9,700,BK,{letterSpacing:1}),cursor:_p}}>TRY AGAIN</button>
                </div>
              )}
            </>
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
      // Silently fall back to static suggestions — no error shown on mobile
      setAiAnalysis("Your wardrobe leans minimal-elegant. Neutral tones dominate with quiet luxury brands. Adding a statement coat and bold accessories could expand outfit combinations by 40%.");
      setAiPairings(suggestions.map(s=>({...s})));
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
    if(view==="gaps" && prevView.current!=="gaps" && !aiGaps && !gapsLoading) loadGaps();
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
        {[["pairings","Pairings"],["gaps","The Missing Pieces"]].map(([k,l])=>(
          <button key={k} className="pb" onClick={()=>setView(k)} style={{flex:1,padding:"8px 4px",borderRadius:12,background:view===k?G:"#1A1A1A",border:view===k?"none":"1px solid #222",...ss(9,view===k?600:400,view===k?BK:DM,{letterSpacing:1})}}>{l}</button>
        ))}
      </div>

      {view==="pairings" && (
        <>
          {pairingsLoading && (
            <div style={{textAlign:"center",padding:"40px 0"}}>
              <div style={{fontSize:32,marginBottom:12,animation:"spin 1.5s linear infinite",display:"inline-block"}}>✦</div>
              <div style={ss(11,400,MD,{letterSpacing:1})}>Analyzing your wardrobe…</div>
            </div>
          )}
          {!pairingsLoading && (aiAnalysis || aiPairings.length>0) && (
            <>
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
            </>
          )}
          {!pairingsLoading && !aiAnalysis && aiPairings.length===0 && !pairingsError && (
            <>
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
            </>
          )}
          <Btn onClick={loadPairings} full disabled={pairingsLoading}>
            {pairingsLoading ? "GENERATING…" : "GENERATE NEW PAIRINGS"}
          </Btn>
        </>
      )}

      {view==="gaps" && (
        <>
          {gapsLoading && (
            <div style={{textAlign:"center",padding:"40px 0"}}>
              <div style={{fontSize:32,marginBottom:12,animation:"spin 1.5s linear infinite",display:"inline-block"}}>✦</div>
              <div style={ss(11,400,MD,{letterSpacing:1})}>Analyzing your wardrobe gaps…</div>
            </div>
          )}
          {!gapsLoading && (
            <>
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
            </>
          )}
        </>
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
                {[1,2].includes(hair)&&<>
                  <path d="M157 79 C151 97,150 115,154 131 C158 137,166 139,172 136 C167 123,162 107,165 91Z" fill={hc}/>
                  <path d="M223 79 C229 97,230 115,226 131 C222 137,214 139,208 136 C213 123,218 107,215 91Z" fill={hc}/>
                </>}
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

// Use Claude API to estimate weather
async function fetchTripWeather(destination, startDate, endDate){
  const prompt = `Give a day-by-day weather forecast for ${destination} from ${startDate} to ${endDate}. Use your knowledge of typical seasonal climate for this location and time of year. Use Fahrenheit for temperatures. Respond ONLY with a JSON object, no markdown, no explanation:
{"city":"${destination.split(",")[0].trim()}","days":[{"date":"YYYY-MM-DD","condition":"Partly Cloudy","tempMax":72,"tempMin":57},...]}`;
  const raw = await callClaude(prompt, "You are a weather assistant. Always respond with valid JSON only, no markdown, no explanation.");
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
  return { daily, city: parsed.city||destination.split(",")[0], climate: deriveClimate(daily) };
}

const sampleVacation = {
  id:1,
  name:"Amalfi Coast",
  destination:"Positano, Italy",
  startDate:"Mar 18, 2026",
  endDate:"Mar 25, 2026",
  days:8,
  climate:"Warm & Sunny",
  emoji:"🌊",
  activities:["Beach","Sightseeing","Fine Dining","Boat Trip","Hiking"],
  days_plan:[
    {day:1, date:"Mar 18, 2026", label:"Arrival & Check-in",    activity:"Travel",      emoji:"✈️", outfitIds:[9,8],     packed:false},
    {day:2, date:"Mar 19, 2026", label:"Beach Day",             activity:"Beach",       emoji:"🏖️", outfitIds:[9,8],     packed:false},
    {day:3, date:"Mar 20, 2026", label:"Positano Old Town",     activity:"Sightseeing", emoji:"🏛️", outfitIds:[1,6,8],   packed:false},
    {day:4, date:"Mar 21, 2026", label:"Boat Trip to Capri",    activity:"Boat Trip",   emoji:"⛵", outfitIds:[9,8],     packed:false},
    {day:5, date:"Mar 22, 2026", label:"Path of the Gods Hike", activity:"Hiking",      emoji:"🥾", outfitIds:[3,2,6],   packed:false},
    {day:6, date:"Mar 23, 2026", label:"Ravello Day Trip",      activity:"Sightseeing", emoji:"🎭", outfitIds:[1,2,7,8], packed:false},
    {day:7, date:"Mar 24, 2026", label:"Fine Dining Night",     activity:"Fine Dining", emoji:"🍷", outfitIds:[9,8],     packed:false},
    {day:8, date:"Mar 25, 2026", label:"Departure Day",         activity:"Travel",      emoji:"✈️", outfitIds:[3,6],     packed:false},
  ],
};

function VacationPlanner({items,outfits,showToast,onBack,session}){
  const [trips,setTrips]=useState([]);
  const [vacation,setVacation]=useState(null);
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
      return (json.days||[]).map(d=>({...d,outfitIds:[],packed:false}));
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
        return{day:i+1,date:dateStr,label:i===0?"Arrival":`Day ${i+1}`,activity:i===0?"Travel":"Explore",emoji:i===0?"✈️":"🗺️",outfitIds:[],packed:false};
      });
    } finally { setAiItineraryLoading(false); }
  };

  // ── Packing list ──
  const allOutfitItemIds=[...new Set((vacation?.days_plan||[]).flatMap(d=>d.outfitIds||[]))];
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
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            <FullDatePicker label="Start Date" value={form.startDate} onChange={v=>setForm(p=>({...p,startDate:v}))}/>
            <FullDatePicker label="End Date" value={form.endDate} onChange={v=>setForm(p=>({...p,endDate:v}))}/>
          </div>
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
              {formWxLoading?<>✦ DETECTING…</>:<>☁️ AUTO-DETECT WEATHER</>}
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
                  days.push({day:i+1,date:dateStr,label:i===0?"Arrival":`Day ${i+1}`,activity:i===0?"Travel":"",emoji:i===0?"✈️":"📅",outfitIds:[],packed:false});
                }
              }
              const newTripData={id:null,name:form.name,destination:form.destination,startDate:form.startDate,endDate:form.endDate,climate:form.climate,days_plan:days};
              const saved=await saveTripToDB(newTripData);
              setTrips(prev=>[saved,...prev]);
              setVacation(saved);
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
  return(
    <div className="fu" style={{padding:"16px 24px"}}>
      {/* Header */}
      <div style={{display:"flex",gap:12,alignItems:"center",marginBottom:16}}>
        <button className="tb" onClick={onBack} style={{fontSize:18,color:MD}}>←</button>
        <div style={{flex:1}}>
          <div style={sr(22,300)}>Vacation Planner</div>
          <div style={ss(10,400,DM,{letterSpacing:1,marginTop:2})}>ITINERARY · OUTFITS · PACKING</div>
        </div>
        <button className="sb" onClick={()=>setNewTrip(true)} style={{padding:"6px 14px",borderRadius:20,background:_1a,border:_2a,...ss(9,400,MD,{letterSpacing:1}),cursor:_p}}>+ NEW</button>
      </div>

      {/* Trip selector if multiple trips */}
      {trips.length>1&&(
        <div style={{display:"flex",gap:8,overflowX:"auto",paddingBottom:8,marginBottom:12}}>
          {trips.map(t=>(
            <button key={t.id} onClick={()=>setVacation(t)} style={{flexShrink:0,padding:"6px 14px",borderRadius:20,background:vacation?.id===t.id?G:_1a,border:vacation?.id===t.id?"none":_2a,...ss(9,vacation?.id===t.id?600:400,vacation?.id===t.id?BK:DM,{letterSpacing:0.5}),cursor:_p}}>{t.name}</button>
          ))}
        </div>
      )}

      {/* Trip hero */}
      <div style={{background:"linear-gradient(135deg,#0F1A2E,#162236)",borderRadius:20,padding:"20px",border:"1px solid #2A3A5A",marginBottom:16,position:"relative",overflow:"hidden"}}>
        <div style={{position:"absolute",top:-20,right:-20,fontSize:80,opacity:0.1}}>✈️</div>
        <div style={ss(9,400,"#6A90B8",{letterSpacing:3,textTransform:"uppercase",marginBottom:6})}>Current Trip</div>
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
            <div style={ss(8,400,"#5A7090",{letterSpacing:2,textTransform:"uppercase",marginBottom:8})}>Forecast · {weather.city}</div>
            <div style={{display:"flex",gap:6,overflowX:"auto",paddingBottom:4}}>
              {weather.daily.map(d=>(
                <div key={d.date} style={{flexShrink:0,textAlign:"center",background:"#0D1928",borderRadius:12,padding:"8px 10px",border:"1px solid #1A2A40",minWidth:48}}>
                  <div style={{fontSize:18,marginBottom:4}}>{condEmoji(d.condition)}</div>
                  <div style={ss(8,600,"#A0C0E0")}>{d.tempMax}°</div>
                  <div style={ss(7,400,"#4A6080")}>{d.tempMin}°</div>
                  <div style={ss(7,400,"#3A5070",{marginTop:3})}>
                    {["Su","Mo","Tu","We","Th","Fr","Sa"][new Date(d.date).getDay()]}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

    </div>
  );
}

// ── WORN HISTORY CALENDAR ─────────────────────────────────────────────────────
function WornHistoryCalendar({outfits,items,showToast,logWear}){
  const today=new Date();
  const [curMonth,setCurMonth]=useState(new Date(2026,2,1));
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

  const occasionEmojis={"Work":"💼","Casual":"☀️","Date Night":"🕯️","Social Event":"🥂","Formal":"🎩","Active":"🏃","Travel":"✈️","Creative":"🎨"};
  const emojiOptions=["📅","💼","🥂","☀️","🌿","✈️","🎉","💫","🎂","🍽️","🎭","🛍️"];

  const addEvent=()=>{
    if(!newLabel.trim()||!newDate){showToast("Please fill in event name and date \u2746");return;}
    const newEv={id:Date.now(),date:newDate,label:newLabel.trim(),occasion:newOccasion,suggestedOutfit:null,emoji:newEmoji};
    setEvents(prev=>[newEv,...prev]);
    setNewLabel(""); setNewDate(""); setNewOccasion("Casual"); setNewEmoji("📅");
    setShowAddEvent(false);
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
    setEvents(prev=>prev.map(ev=>ev.id===planningEvent.id?{...ev,suggestedOutfit:outfitId,outfitItems:outfitObj.items,outfitName:outfitObj.name}:ev));
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

      {/* Top-level toggle */}
      <div style={{display:"flex",gap:6,marginBottom:18}}>
        {[["events","Events","📅"],["vacation","Vacation","🌍"]].map(([k,l,ic])=>(
          <button key={k} className="pb" onClick={()=>setView(k)} style={{flex:1,padding:"10px 6px",borderRadius:14,background:view===k?G:"#1A1A1A",border:view===k?"none":"1px solid #222",display:"flex",alignItems:"center",justifyContent:"center",gap:5,...ss(9,view===k?600:400,view===k?BK:DM,{letterSpacing:0.8})}}>
            <span style={{fontSize:13}}>{ic}</span>{l}
          </button>
        ))}
      </div>

      {/* EVENTS VIEW */}
      {view==="events"&&(
        <>
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
                    <button onClick={e=>{e.stopPropagation();setEvents(prev=>prev.filter(x=>x.id!==ev.id));showToast("Event removed \u2746");}} style={{background:"none",border:"none",cursor:_p,...ss(12,400,DM)}}>×</button>
                  </div>
                </div>
                {open&&(
                  <div style={{borderTop:`1px solid ${BR}`,paddingTop:12}}>
                    {hasOutfit?(
                      <>
                        <div style={ss(9,400,DM,{letterSpacing:1,marginBottom:8})}>OUTFIT: {(ev.outfitName||"").toUpperCase()}</div>
                        <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap"}}>
                          {outfitItems.map(it=><ItemThumb key={it.id} item={it} size={46} r={10}/>)}
                        </div>
                        <div style={{display:"flex",gap:8}}>
                          <Btn onClick={e=>{e.stopPropagation();openPlanner(ev);}} outline small>CHANGE</Btn>
                          <Btn onClick={e=>{e.stopPropagation();showToast("Outfit confirmed for "+ev.label+" \u2746");}} full small>CONFIRM ✓</Btn>
                        </div>
                      </>
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
        </>
      )}

      {/* VACATION VIEW */}
      {view==="vacation"&&(
        <VacationPlanner items={items} outfits={outfits} showToast={showToast} onBack={()=>setView("events")} session={session}/>
      )}

      {/* ── ADD EVENT MODAL ── */}
      {showAddEvent&&(
        <div onClick={()=>setShowAddEvent(false)} style={{..._fix,background:"#000000BB",zIndex:80,display:"flex",alignItems:"flex-end"}}>
          <div onClick={e=>e.stopPropagation()} style={{background:"#0D0D0D",borderRadius:"24px 24px 0 0",width:"100%",maxWidth:430,margin:"0 auto",border:_2a,padding:"24px 24px 40px",maxHeight:"85vh",overflowY:"auto"}} className="sc">
            <div style={{width:36,height:4,borderRadius:2,background:"#333",margin:"0 auto 18px"}}/>
            <div style={sr(20,400,undefined,{marginBottom:4})}>Add Event</div>
            <div style={ss(9,400,DM,{letterSpacing:1,marginBottom:20})}>PLAN YOUR UPCOMING OCCASION</div>
            <div style={ss(8,600,DM,{letterSpacing:1.5,marginBottom:8})}>EMOJI</div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:16}}>
              {emojiOptions.map(em=>(
                <button key={em} onClick={()=>setNewEmoji(em)} style={{width:40,height:40,borderRadius:10,background:newEmoji===em?`${G}22`:_1a,border:newEmoji===em?`1.5px solid ${G}`:_2a,fontSize:20,cursor:_p,display:"flex",alignItems:"center",justifyContent:"center"}}>{em}</button>
              ))}
            </div>
            <div style={ss(8,600,DM,{letterSpacing:1.5,marginBottom:8})}>EVENT NAME</div>
            <input value={newLabel} onChange={e=>setNewLabel(e.target.value)} placeholder="e.g. Birthday Dinner, Work Presentation…"
              style={{width:"100%",boxSizing:"border-box",background:_1a,border:_2a,borderRadius:12,padding:"11px 14px",...ss(12,400,MD),color:"inherit",marginBottom:14,outline:"none"}}/>
            <div style={{marginBottom:14}}>
              <FullDatePicker label="DATE" value={newDate} onChange={setNewDate}/>
            </div>
            <div style={ss(8,600,DM,{letterSpacing:1.5,marginBottom:8})}>OCCASION</div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:20}}>
              {Object.keys(occasionEmojis).map(occ=>(
                <button key={occ} onClick={()=>{setNewOccasion(occ);setNewEmoji(occasionEmojis[occ]);}}
                  style={{padding:"6px 14px",borderRadius:20,background:newOccasion===occ?G:_1a,border:newOccasion===occ?"none":_2a,...ss(9,newOccasion===occ?600:400,newOccasion===occ?BK:DM,{letterSpacing:0.8}),cursor:_p}}>
                  {occasionEmojis[occ]} {occ}
                </button>
              ))}
            </div>
            <div style={{display:"flex",gap:10}}>
              <Btn onClick={()=>setShowAddEvent(false)} outline>CANCEL</Btn>
              <Btn onClick={addEvent} full>SAVE & PLAN OUTFIT →</Btn>
            </div>
          </div>
        </div>
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
function CreateListingPage({item, onClose, showToast}){
  const suggested=Math.round(item.price * (item.condition==="Like New"?0.75:item.condition==="Excellent"?0.65:item.condition==="Good"?0.55:0.4));
  const [condition,setCondition]=useState(item.condition||"Good");
  const [shippingBy,setShippingBy]=useState("seller");
  const [submitted,setSubmitted]=useState(false);
  const [price,setPrice]=useState(suggested+"");
  const [desc,setDesc]=useState(`${item.condition} condition ${item.name} from ${item.brand}. Worn ${item.wearCount} time${item.wearCount!==1?"s":""}.`);
  const conditions=["Like New","Excellent","Good","Fair"];
  const condColor={"Like New":"#60A870","Excellent":"#A8C060","Good":"#C4A060","Fair":"#C08060"};
  const outfixFee=Math.round(parseInt(price||0)*0.1);
  const youEarn=parseInt(price||0)-outfixFee;

  if(submitted) return(
    <div style={{..._fix,zIndex:95,background:BK,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",maxWidth:430,margin:"0 auto",padding:"40px 32px",textAlign:"center"}}>
      <div style={{fontSize:52,marginBottom:20,animation:"pulse 2s infinite"}}>🏷️</div>
      <div style={sr(26,300,G,{marginBottom:8})}>Listed!</div>
      <div style={ss(10,400,DM,{letterSpacing:1,marginBottom:24})}>YOUR ITEM IS NOW LIVE IN THE MARKET</div>
      <div style={{background:"#111",borderRadius:18,padding:"20px",width:"100%",marginBottom:24,textAlign:"left"}}>
        <div style={{display:"flex",gap:14,alignItems:"center",marginBottom:14}}>
          <ItemThumb item={item} size={56} r={14}/>
          <div>
            <div style={sr(16,500)}>{item.name}</div>
            <div style={ss(8,400,DM,{letterSpacing:1,marginTop:2})}>{item.brand}</div>
          </div>
        </div>
        {[["Listed price",`$${price}`],["Condition",condition],["Outfix fee (10%)",`-$${outfixFee}`],["You earn",`$${youEarn}`]].map(([l,v])=>(
          <div key={l} style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
            <div style={ss(9,400,DM)}>{l}</div>
            <div style={l==="You earn"?sr(13,600,G):ss(9,400,MD)}>{v}</div>
          </div>
        ))}
      </div>
      <div style={{...ss(9,400,DM,{lineHeight:1.7,marginBottom:28})}}>Buyers can now make offers or buy outright.<br/>You'll be notified the moment someone bites.</div>
      <Btn onClick={onClose} full>BACK TO STATS</Btn>
    </div>
  );

  return(
    <div style={{..._fix,zIndex:95,background:BK,display:"flex",flexDirection:"column",maxWidth:430,margin:"0 auto"}}>

      {/* Header */}
      <div style={{padding:"20px 20px 16px",borderBottom:"1px solid #1E1E1E",flexShrink:0,display:"flex",alignItems:"center",gap:14}}>
        <IconBtn onClick={onClose} sz={14}>←</IconBtn>
        <div>
          <div style={sr(20,400)}>Create Listing</div>
          <div style={ss(9,400,DM,{letterSpacing:1,marginTop:1})}>LIST FOR SALE IN THE MARKET</div>
        </div>
      </div>

      {/* Body */}
      <div className="sc" style={{flex:1,overflowY:"auto",padding:"20px 20px 100px"}}>

        {/* Item preview */}
        <div style={{display:"flex",gap:14,alignItems:"center",background:"#111",borderRadius:16,padding:"14px 16px",marginBottom:20}}>
          <ItemThumb item={item} size={64} r={14}/>
          <div>
            <div style={sr(17,500)}>{item.name}</div>
            <div style={ss(9,400,DM,{letterSpacing:1,marginTop:3})}>{item.brand} · {item.category}</div>
            <div style={ss(8,400,DM,{marginTop:3})}>Worn {item.wearCount}x · Purchased ${item.price}</div>
          </div>
        </div>

        {/* Pricing */}
        <div style={ss(8,600,DM,{letterSpacing:1.5,marginBottom:8})}>YOUR ASKING PRICE</div>
        <div style={{display:"flex",alignItems:"center",background:_1a,border:`1.5px solid ${price?G+"66":"#2A2A2A"}`,borderRadius:14,padding:"4px 16px",marginBottom:10}}>
          <div style={sr(28,300,G,{marginRight:4})}>$</div>
          <input value={price} onChange={e=>setPrice(e.target.value.replace(/[^0-9]/g,""))}
            style={{flex:1,background:"none",border:"none",...sr(28,300,G),color:G,width:"100%"}} placeholder="0"/>
        </div>

        {/* Quick price suggestions */}
        <div style={{display:"flex",gap:8,marginBottom:6}}>
          {[0.5,0.6,0.75].map(pct=>{
            const v=Math.round(item.price*pct);
            return(
              <button key={pct} onClick={()=>setPrice(v+"")} style={{flex:1,padding:"8px 4px",borderRadius:12,background:price===v+""?G:"#1A1A1A",border:`1px solid ${price===v+""?"transparent":"#2A2A2A"}`,cursor:_p}}>
                <div style={ss(9,600,price===v+""?BK:MD)}>${v}</div>
                <div style={ss(7,400,price===v+""?"#00000066":DM,{marginTop:2})}>{Math.round(pct*100)}% of retail</div>
              </button>
            );
          })}
        </div>
        <div style={ss(8,400,DM,{marginBottom:20,textAlign:"center"})}>Suggested: ${suggested} based on condition &amp; wear</div>

        {/* Earnings breakdown */}
        {parseInt(price||0)>0&&(
          <div style={{background:"linear-gradient(135deg,#1A1A10,#141008)",border:`1px solid ${G}33`,borderRadius:14,padding:"14px 16px",marginBottom:20}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
              <div style={ss(9,400,DM)}>Listing price</div><div style={ss(9,400,MD)}>${price}</div>
            </div>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
              <div style={ss(9,400,DM)}>Outfix fee (10%)</div><div style={ss(9,400,"#C4A0A0")}>−${outfixFee}</div>
            </div>
            <div style={{display:"flex",justifyContent:"space-between",paddingTop:8,borderTop:`1px solid ${G}22`}}>
              <div style={sr(13,500)}>You earn</div><div style={sr(16,500,G)}>${youEarn}</div>
            </div>
          </div>
        )}

        {/* Condition */}
        <div style={ss(8,600,DM,{letterSpacing:1.5,marginBottom:8})}>CONDITION</div>
        <div style={{display:"flex",gap:8,marginBottom:20}}>
          {conditions.map(c=>(
            <button key={c} onClick={()=>setCondition(c)} style={{flex:1,padding:"8px 4px",borderRadius:12,background:condition===c?`${condColor[c]}22`:"#1A1A1A",border:`1px solid ${condition===c?condColor[c]+"66":"#2A2A2A"}`,cursor:_p}}>
              <div style={ss(8,condition===c?700:400,condition===c?condColor[c]:DM,{letterSpacing:0.5,whiteSpace:"nowrap"})}>{c}</div>
            </button>
          ))}
        </div>

        {/* Description */}
        <div style={ss(8,600,DM,{letterSpacing:1.5,marginBottom:8})}>DESCRIPTION</div>
        <textarea value={desc} onChange={e=>setDesc(e.target.value)} rows={4}
          style={{width:"100%",background:_1a,border:_2a,borderRadius:14,padding:"12px 14px",...ss(11,400,MD),color:"#C0B8B0",resize:"none",lineHeight:1.7,boxSizing:"border-box",marginBottom:20}}/>

        {/* Shipping */}
        <div style={ss(8,600,DM,{letterSpacing:1.5,marginBottom:8})}>SHIPPING</div>
        <div style={{display:"flex",gap:8,marginBottom:20}}>
          {[["seller","Seller pays"],["buyer","Buyer pays"]].map(([k,l])=>(
            <button key={k} onClick={()=>setShippingBy(k)} style={{flex:1,padding:"10px",borderRadius:12,background:shippingBy===k?G:"#1A1A1A",border:shippingBy===k?"none":"1px solid #2A2A2A",cursor:_p,...ss(9,shippingBy===k?600:400,shippingBy===k?BK:DM,{letterSpacing:0.8})}}>{l}</button>
          ))}
        </div>

        {/* Tips */}
        <div style={{background:"#0A100A",border:"1px solid #1A2A1A",borderRadius:12,padding:"12px 14px"}}>
          <div style={ss(8,600,"#6A9A6A",{letterSpacing:1,marginBottom:8})}>💡 LISTING TIPS</div>
          {["Items with photos sell 3× faster — add up to 8 images","Honest condition notes build buyer trust and avoid returns","Accepting offers increases your chance of a sale by 60%"].map((t,i)=>(
            <div key={i} style={{...ss(9,400,"#7A9A7A",{lineHeight:1.6}),marginBottom:i<2?6:0}}>· {t}</div>
          ))}
        </div>
      </div>

      {/* Sticky CTA */}
      <div style={{padding:"12px 20px 28px",borderTop:"1px solid #1E1E1E",flexShrink:0,background:BK}}>
        <button onClick={()=>{if(!price||parseInt(price)===0){showToast("Set a price first \u2746");return;}setSubmitted(true);showToast("Listing created \u2746");}}
          style={{width:"100%",padding:"15px",borderRadius:16,background:`linear-gradient(135deg,${G},#8A6E54)`,border:"none",...ss(10,700,BK,{letterSpacing:1.5}),cursor:_p}}>
          LIST FOR ${price||"0"}
        </button>
      </div>
    </div>
  );
}

// ── WARDROBE HEALTH (gaps + duplicates combined) ─────────────────────────────
function DuplicatesSection({items,showToast}){
  const [dismissed,setDismissed]=useState(new Set());

  const duplicateGroups=[
    { id:"d1", label:"Similar navy/dark bottoms", items:[items.find(i=>i.id===2),items.find(i=>i.id===4)].filter(Boolean), similarity:82,
      reason:"Both dark-toned bottoms with a minimal aesthetic. One is likely sufficient for most occasions." },
    { id:"d2", label:"Neutral tops with similar fit", items:[items.find(i=>i.id===1),items.find(i=>i.id===3)].filter(Boolean), similarity:74,
      reason:"A blouse and a crewneck cover similar styling territory. Consider which works harder for your lifestyle." },
    { id:"d3", label:"Casual shoe overlap", items:[items.find(i=>i.id===6)].filter(Boolean), similarity:0,
      note:"Your White Sneakers (Common Projects) are irreplaceable — no true duplicates found here." },
  ].filter(g=>!dismissed.has(g.id));

  return(
    <div>
      {duplicateGroups.map(group=>(
        <div key={group.id} style={{background:CD,borderRadius:16,padding:"16px",marginBottom:12,border:`1px solid ${BR}`}}>
          <div style={{..._btwnS,marginBottom:12}}>
            <div style={{flex:1}}>
              <div style={ss(8,700,"#C4A060",{letterSpacing:1,marginBottom:4})}>{group.similarity>0?`${group.similarity}% SIMILAR`:"UNIQUE ✓"}</div>
              <div style={sr(15,500)}>{group.label}</div>
            </div>
            {group.similarity>0&&(
              <button onClick={()=>setDismissed(d=>new Set([...d,group.id]))} style={{width:28,height:28,borderRadius:"50%",background:_1a,border:_2a,...ss(11,400,DM),display:"flex",alignItems:"center",justifyContent:"center",cursor:_p,flexShrink:0}}>✕</button>
            )}
          </div>
          <div style={{display:"flex",gap:10,marginBottom:12}}>
            {group.items.map(item=>(
              <div key={item.id} style={{flex:1,background:"#111",borderRadius:12,padding:"10px",textAlign:"center"}}>
                <div style={{width:52,height:52,borderRadius:10,background:`${item.color}22`,margin:"0 auto 8px",display:"flex",alignItems:"center",justifyContent:"center",border:_2a}}>
                  <ItemIllustration item={item} size={40}/>
                </div>
                <div style={sr(11,500,undefined,{lineHeight:1.3})}>{item.name}</div>
                <div style={ss(8,400,DM,{marginTop:2})}>{item.wearCount}x worn</div>
              </div>
            ))}
          </div>
          <div style={{...ss(10,400,"#A09880",{lineHeight:1.6,marginBottom:group.similarity>0?12:0})}}>{group.reason||group.note}</div>
          {group.similarity>0&&(
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>showToast("Listing for sale \u2746")} style={{flex:1,padding:"8px",borderRadius:11,background:_1a,border:_2a,...ss(8,500,DM,{letterSpacing:0.8}),cursor:_p}}>LIST THE WEAKER ONE</button>
              <button onClick={()=>setDismissed(d=>new Set([...d,group.id]))} style={{flex:1,padding:"8px",borderRadius:11,background:G,border:"none",...ss(8,600,BK,{letterSpacing:0.8}),cursor:_p}}>KEEP BOTH</button>
            </div>
          )}
        </div>
      ))}
      {duplicateGroups.length===0&&(
        <div style={{textAlign:"center",padding:"32px 0"}}>
          <div style={{fontSize:40,marginBottom:12}}>✨</div>
          <div style={sr(18,300,G)}>Your closet is efficient</div>
          <div style={ss(10,400,DM,{marginTop:8})}>No significant duplicates detected</div>
        </div>
      )}
    </div>
  );
}

function StatsTab({items, outfits, showToast, logWear}){
  const [listing,setListing]=useState(null);
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
        <>
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
                <button onClick={()=>setListing(item)} style={{padding:"5px 12px",borderRadius:20,background:"#2A1A1A",border:"1px solid #4A2A2A",cursor:_p,...ss(9,600,"#C4A0A0",{letterSpacing:1})}}>SELL</button>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── WARDROBE HEALTH ── */}
      {section==="dupes"&&(
        <DuplicatesSection items={items} showToast={showToast} />
      )}

      {/* ── WORN HISTORY ── */}
      {section==="history"&&<WornHistoryCalendar outfits={outfits} items={items} showToast={showToast} logWear={logWear}/>}

      {listing&&<CreateListingPage item={listing} onClose={()=>setListing(null)} showToast={showToast}/>}
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
                      <>
                        <div style={sr(22,400,plan.accent)}>${billing==="annual"&&perMonth?perMonth:price}</div>
                        <div style={ss(7,400,DM,{letterSpacing:0.8})}>{billing==="annual"&&perMonth?"/mo billed annually":"/month"}</div>
                        {billing==="annual"&&<div style={ss(7,600,"#4A6A3A",{marginTop:1})}>${price}/yr · save {saving(plan)}%</div>}
                      </>
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
    <div onClick={onClose} style={{..._fix,background:"#000000BB",zIndex:110,display:"flex",alignItems:"flex-start",paddingTop:60}}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#0D0D0D",borderRadius:"28px 28px 0 0",width:"100%",maxWidth:430,margin:"0 auto",border:_2a,animation:"fadeDown 0.3s ease forwards",maxHeight:"92vh",overflowY:"auto",padding:"24px"}} className="sc">

        {/* Shopper header */}
        <div style={{display:"flex",gap:14,alignItems:"center",marginBottom:20}}>
          <div style={{fontSize:36}}>{stylist.avatar}</div>
          <div>
            <div style={sr(18,500)}>{stylist.name}</div>
            <div style={ss(9,400,DM,{letterSpacing:1})}>{stylist.specialty}</div>
            <div style={ss(9,400,MD,{marginTop:2})}>★ {stylist.rating} · {stylist.clients} sessions completed</div>
          </div>
        </div>

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
        {sel&&(<>
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
        </>)}

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
function PushNotifPreview({onClose,showToast}){
  const [notifs,setNotifs]=useState(initPushNotifs);
  const [filter,setFilter]=useState("All");
  const markRead=(id)=>setNotifs(p=>p.map(n=>n.id===id?{...n,read:true}:n));
  const markAll=()=>setNotifs(p=>p.map(n=>({...n,read:true})));
  const unread=notifs.filter(n=>!n.read).length;

  const typeFilters=["All","Urgent","Price","Offers","Trends","Social"];
  const typeMap={"Urgent":"urgent","Price":"price_drop","Offers":"new_offer","Trends":"trend_match","Social":"ootd_like"};

  const typeColor={price_drop:"#6090C4",new_offer:"#C4A060",trend_match:"#B090C4",ootd_like:"#C46080",dupe_alert:"#C08040",booking:"#60A870",market:"#6090C4"};
  const typeBg={price_drop:"#0A0F1A",new_offer:"#1A1308",trend_match:"#140F1A",ootd_like:"#1A0810",dupe_alert:"#1A100A",booking:"#0A1A0A",market:"#0A0F1A"};

  const visible=filter==="All"?notifs:filter==="Urgent"?notifs.filter(n=>n.urgent)
    :notifs.filter(n=>n.type===typeMap[filter]);

  return(
    <div onClick={onClose} style={{..._fix,background:"#000000BB",zIndex:90,display:"flex",alignItems:"flex-start"}}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#0D0D0D",borderRadius:"0 0 24px 24px",width:"100%",maxWidth:430,margin:"0 auto",border:_2a,animation:"fadeDown 0.3s ease",maxHeight:"88vh",display:"flex",flexDirection:"column"}}>

        <div style={{padding:"16px 20px 10px",flexShrink:0}}>
          <div style={{..._btwn,marginBottom:12}}>
            <div>
              <div style={sr(18,400)}>Notifications</div>
              {unread>0&&<div style={ss(9,400,DM,{marginTop:2})}>{unread} unread</div>}
            </div>
            <div style={{..._row,gap:10}}>
              {unread>0&&<button onClick={markAll} style={{...ss(8,600,G,{letterSpacing:0.8}),background:"none",border:"none",cursor:_p}}>MARK ALL READ</button>}
              <button onClick={onClose} style={{width:28,height:28,borderRadius:"50%",background:_1a,border:_2a,...ss(12,400,MD),cursor:_p,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
            </div>
          </div>
          <div style={{display:"flex",gap:6,overflowX:"auto",paddingBottom:2}}>
            {typeFilters.map(f=>(
              <button key={f} onClick={()=>setFilter(f)} className="pb" style={{flexShrink:0,padding:"5px 12px",borderRadius:20,background:filter===f?G:"#1A1A1A",border:filter===f?"none":"1px solid #222",...ss(8,filter===f?600:400,filter===f?BK:DM,{letterSpacing:0.8,whiteSpace:"nowrap"}),cursor:_p}}>{f}</button>
            ))}
          </div>
        </div>

        <div className="sc" style={{flex:1,overflowY:"auto",padding:"4px 20px 20px"}}>
          {visible.length===0&&<div style={{textAlign:"center",padding:"32px 0",...sr(14,300,DM,{fontStyle:"italic",opacity:0.5})}}>No notifications here</div>}
          {visible.map(n=>{
            const col=typeColor[n.type]||G;
            const bg=typeBg[n.type]||"#141414";
            return(
              <div key={n.id} onClick={()=>markRead(n.id)}
                style={{background:n.read?"#111":bg,border:`1px solid ${n.read?"#1E1E1E":col+"44"}`,borderRadius:14,padding:"12px 14px",marginBottom:8,cursor:_p,position:"relative",opacity:n.read?0.7:1}}>
                {!n.read&&<div style={{position:"absolute",top:12,right:12,width:7,height:7,borderRadius:"50%",background:col}}/>}
                {n.urgent&&!n.read&&<div style={{position:"absolute",top:0,left:0,right:0,height:2,background:col,borderRadius:"14px 14px 0 0",opacity:0.6}}/>}
                <div style={{display:"flex",gap:10,alignItems:"flex-start"}}>
                  <div style={{width:34,height:34,borderRadius:10,background:`${col}22`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>{n.icon}</div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{..._btwnS,marginBottom:4}}>
                      <div style={ss(10,n.read?400:600,n.read?MD:"#E0D8D0",{flex:1,paddingRight:8,lineHeight:1.4})}>{n.title}</div>
                      <div style={ss(8,400,DM,{flexShrink:0})}>{n.time}</div>
                    </div>
                    <div style={ss(10,400,"#8A8078",{lineHeight:1.5,marginBottom:8})}>{n.body}</div>
                    <button onClick={(e)=>{e.stopPropagation();showToast(`${n.action} \u2746`);}} style={{padding:"5px 12px",borderRadius:10,background:`${col}22`,border:`1px solid ${col}44`,...ss(8,600,col,{letterSpacing:0.8}),cursor:_p}}>{n.action}</button>
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
    <>
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
    </>
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

function computeStats(items){ return { items:items.length, outfits:3, listed:items.filter(i=>i.forSale).length, sold:1, followers:842, usedMirror:true, usedAI:true, usedPlanner:true }; }

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

function SettingsTab({currentPlan,setShowPricing,showToast,items,userName="",userEmail="",onSignOut,userProfile={},saveProfile}){
  const [section,setSection]=useState("profile");
  const [editField,setEditField]=useState(null); // which field is open
  const [editVal,setEditVal]=useState("");
  const totalValue=items.reduce((s,i)=>s+i.price,0);
  const totalResale=items.reduce((s,i)=>s+Math.round(i.price*0.45),0);
  const stats=computeStats(items);
  const earnedBadges=ALL_BADGES.filter(b=>b.check(stats));

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
        <div style={{width:72,height:72,borderRadius:"50%",background:`linear-gradient(135deg,${G},#8A6E54)`,margin:"0 auto 12px",display:"flex",alignItems:"center",justifyContent:"center",fontSize:32}}>✦</div>
        <div style={sr(22,400,G)}>{userProfile.username ? `@${userProfile.username}` : userName||"Your Wardrobe"}</div>
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
          {/* Notification toggles — use a state object at component level */}
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
    </div>
  );
}


// ── CAPSULE COLLECTIONS ────────────────────────────────────────────────────────

// ── VAULT ────────────────────────────────────────────────────────────────────
function VaultTab({items,outfits,showToast,wishlist,setWishlist,addToWishlist,removeFromWishlist,currentPlan,setShowPricing,logWear,events,setEvents}){
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
    try{ localStorage.setItem("outfix_onboarded","1"); }catch(e){}
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
    // Show onboarding for first-time users
    try {
      if(!localStorage.getItem("outfix_onboarded")) setShowOnboarding(true);
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
  const [items,setItems]           = useState(initItems);
  const [outfits,setOutfits]       = useState(initOutfits);
  const [selectedItem,setSelectedItem] = useState(null);
  const [wishlist,setWishlist]     = useState(initWishlist);
  const [toast,setToast]           = useState(null);
  const [showPricing,setShowPricing]     = useState(false);
  const [currentPlan,setCurrentPlan]     = useState("free");
  const [notifications,setNotifications] = useState(initNotifications);
  const [closetLoading,setClosetLoading] = useState(false);
  const [showOnboarding,setShowOnboarding] = useState(false);
  const [userProfile,setUserProfile] = useState({username:"",bio:"",location:"",styleIdentity:""});

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
    const [itemData, outfitData, wishlistData] = await Promise.all([
      sb.select("items", session.access_token, `&user_id=eq.${userId}`).catch(e=>{ console.error("items load failed:", e); return []; }),
      sb.select("outfits", session.access_token, `&user_id=eq.${userId}`).catch(e=>{ console.error("outfits load failed:", e); return []; }),
      sb.select("wishlist", session.access_token, `&user_id=eq.${userId}`).catch(e=>{ console.error("wishlist load failed:", e); return []; }),
    ]);

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
      console.log("No items in Supabase — seeding demo items");
      if(userId) {
        Promise.all(initItems.map(item =>
          sb.insert("items", session.access_token, {
            user_id: userId,
            name: item.name, brand: item.brand, category: item.category,
            color: item.color, price: item.price, wear_count: item.wearCount || 0,
            last_worn: item.lastWorn || "Never", purchase_date: item.purchaseDate || "",
            condition: item.condition || "Good", for_sale: item.forSale || false,
            emoji: item.emoji || "👚", tags: item.tags || [], source_image: null,
          })
        )).then(results => {
          const seeded = results.map((r,i) => {
            const row = Array.isArray(r) ? r[0] : r;
            return row?.id ? { ...initItems[i], id: row.id } : initItems[i];
          });
          setItems(seeded);
        }).catch(() => {});
      }
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
          });
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
    let outfitItemIds = [];
    setOutfits(prev => prev.map(o => {
      if(o.id !== outfitId) return o;
      const already = (o.wornHistory||[]).includes(key);
      if(!already) {
        const newHistory = [key, ...(o.wornHistory||[])];
        outfitItemIds = o.items || [];
        if(session?.access_token) {
          sb.update("outfits", session.access_token, outfitId, { worn_history: newHistory }).catch(()=>{});
        }
        return { ...o, wornHistory: newHistory };
      }
      outfitItemIds = o.items || [];
      return o;
    }));
    setItems(prev => prev.map(i => {
      if(!outfitItemIds.includes(i.id)) return i;
      const newCount = i.wearCount + 1;
      updateWearInDB(i.id, newCount);
      return { ...i, wearCount: newCount, lastWorn: displayDate };
    }));
  };
  const handleSubscribe = (planId) => {
    setCurrentPlan(planId);
    setShowPricing(false);
    if(planId!=="free") showToast(`Welcome to ${planId==="plus"?"Outfix+":"Outfix Pro"} \u2746`);
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
  const unreadPush = initPushNotifs.filter(n=>!n.read).length;
  const unreadLegacy = notifications.filter(n=>!n.read).length;
  const totalUnread = unreadPush + unreadLegacy;

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
    <div style={{fontFamily:"'Cormorant Garamond','Georgia',serif",background:wrapBg,minHeight:"100vh",color:wrapColor,maxWidth:430,margin:"0 auto",position:"relative",overflow:"hidden",transition:"background 0.3s,color 0.3s"}}>
      <style>{GCSS}</style>

      {/* ── HEADER ── */}
      <div style={{padding:"20px 24px 14px",background:`linear-gradient(180deg,${hdrBg} 80%,transparent)`,position:"sticky",top:0,zIndex:10,transition:"background 0.3s"}}>
        <div style={{..._btwn}}>
          <div style={{display:"flex",alignItems:"baseline",gap:10}}>
            <div style={sr(34,400,"#F0EBE3",{letterSpacing:3,lineHeight:1})}>Outfix</div>
            {badge&&(
              <div style={{background:`${badge.color}22`,border:`1px solid ${badge.color}55`,borderRadius:20,padding:"3px 10px",...ss(8,700,badge.color,{letterSpacing:2})}}>
                {badge.label}
              </div>
            )}
          </div>
          <div style={{..._row,gap:8}}>
            <button className="tb" onClick={()=>setShowPricing(true)} style={{height:30,borderRadius:20,background:`linear-gradient(135deg,${G},#8A6E54)`,padding:"0 12px",border:"none",...ss(8,600,BK,{letterSpacing:1}),cursor:_p}}>
              {currentPlan==="free"?"UPGRADE":"MY PLAN"}
            </button>
            <button className="tb" onClick={()=>setShowPushNotifs(true)} style={{width:30,height:30,borderRadius:"50%",border:`1px solid ${divLine}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,background:"none",cursor:_p,position:"relative"}}>
              🔔
              {totalUnread>0&&<div style={{position:"absolute",top:-1,right:-1,width:14,height:14,borderRadius:"50%",background:"#C4A882",border:`2px solid ${wrapBg}`,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"Montserrat,sans-serif",fontSize:7,fontWeight:700,color:"#0D0D0D"}}>{totalUnread}</div>}
            </button>
            <button className="tb" onClick={()=>setTab("__settings")} style={{width:30,height:30,borderRadius:"50%",border:`1px solid ${divLine}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,background:"none",cursor:_p}}>⚙</button>
          </div>
        </div>
      </div>

      {/* ── CONTENT ── */}
      <div className="sc" style={{height:"calc(100vh - 130px)",paddingBottom:80}}>
        {tab==="home"     && <HomeTab items={items} outfits={outfits} showToast={showToast} setTab={setTab} setWishlist={setWishlist} addToWishlist={addToWishlist} removeFromWishlist={removeFromWishlist} setItems={setItems} session={session} onAddToCloset={async(item)=>{
          const newItem={...item,id:Date.now()};
          setItems(prev=>[...prev,newItem]);
          await saveItemToDB(newItem);
        }}/>}
        {tab==="closet"    && <ClosetTab items={items} setItems={setItems} setSelectedItem={setSelectedItem} showToast={showToast} wishlist={wishlist} setWishlist={setWishlist} addToWishlist={addToWishlist} removeFromWishlist={removeFromWishlist} onSaveItem={saveItemToDB}/>}
        {tab==="outfits"   && <OutfitsTab items={items} outfits={outfits} setOutfits={setOutfits} setItems={setItems} showToast={showToast} logWear={logWear} onSaveOutfit={saveOutfitToDB} onDeleteOutfit={deleteOutfitFromDB}/>}
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
        {tab==="vault"     && <VaultTab items={items} outfits={outfits} showToast={showToast} wishlist={wishlist} setWishlist={setWishlist} addToWishlist={addToWishlist} removeFromWishlist={removeFromWishlist} currentPlan={currentPlan} setShowPricing={setShowPricing} logWear={logWear} events={appEvents} setEvents={setAppEvents}/>}
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
              <SettingsTab currentPlan={currentPlan} setShowPricing={setShowPricing} showToast={showToast} items={items} userName={userName} userEmail={userEmail} onSignOut={handleSignOut} userProfile={userProfile} saveProfile={saveProfile}/>
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
        <PushNotifPreview onClose={()=>setShowPushNotifs(false)} showToast={showToast} />
      )}


      {/* ── CAPSULE COLLECTIONS OVERLAY ── */}

      {/* ── ONBOARDING ── */}
      {showOnboarding && <Onboarding onDone={()=>setShowOnboarding(false)}/>}

      <Toast msg={toast} />
    </div>
  );
}
