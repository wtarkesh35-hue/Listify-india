export default async (req) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json"
  };

  if (req.method === "OPTIONS") return new Response(null, { headers });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Method Not Allowed" }), { status: 405, headers });

  try {
    const { prompt } = await req.json();
    if (!prompt) return new Response(JSON.stringify({ error: "No prompt provided" }), { status: 400, headers });

    // ============================================
    // RATE LIMITING — Check IP usage via Supabase
    // ============================================
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
    const FREE_DAILY_LIMIT = 3;

    // Get today's date in IST (UTC+5:30)
    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000;
    const istDate = new Date(now.getTime() + istOffset);
    const today = istDate.toISOString().split("T")[0];

    // Check current usage for this IP
    const checkRes = await fetch(
      `${SUPABASE_URL}/rest/v1/usage_tracking?ip_address=eq.${encodeURIComponent(ip)}&date=eq.${today}`,
      {
        headers: {
          "apikey": SUPABASE_ANON_KEY,
          "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    const usageData = await checkRes.json();
    const currentCount = usageData?.[0]?.count || 0;

    // Block if limit exceeded
    if (currentCount >= FREE_DAILY_LIMIT) {
      return new Response(JSON.stringify({
        error: "LIMIT_EXCEEDED",
        message: `You've used all ${FREE_DAILY_LIMIT} free listings for today. Resets at midnight IST.`,
        upgradeMessage: "Upgrade to Pro for unlimited listings!",
        count: currentCount,
        limit: FREE_DAILY_LIMIT
      }), { status: 429, headers });
    }

    // ============================================
    // GENERATE LISTING — Call Gemini API
    // ============================================
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return new Response(JSON.stringify({ error: "API key not configured" }), { status: 500, headers });

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: `You are an expert Indian Real Estate Copywriter specializing in BHK properties, Indian localities, vastu compliance, and platforms like MagicBricks, 99acres and Housing.com.\n\n${prompt}\n\nGenerate exactly 3 variations. Format EXACTLY like this with no extra text:\n\n[VARIATION 1]\n(write 130-160 word compelling listing here)\n\n[VARIATION 2]\n(write 130-160 word compelling listing here)\n\n[VARIATION 3]\n(write 130-160 word compelling listing here)\n\nEach variation must have a different angle: family-focused, investment-focused, and lifestyle-focused. Use Indian terms naturally: BHK, vastu, society, gated community, EMI-friendly, RERA approved. Use ₹ for prices. Make each listing compelling and buyer-focused.`
            }]
          }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 2048 }
        })
      }
    );

    const data = await response.json();

    if (data.error) return new Response(JSON.stringify({ error: data.error.message }), { status: 400, headers });
    if (!data.candidates?.[0]) return new Response(JSON.stringify({ error: "No response from Gemini" }), { status: 500, headers });

    const text = data.candidates[0].content.parts[0].text;

    // ============================================
    // UPDATE USAGE — Increment count in Supabase
    // ============================================
    if (currentCount === 0) {
      // First use today — insert new record
      await fetch(`${SUPABASE_URL}/rest/v1/usage_tracking`, {
        method: "POST",
        headers: {
          "apikey": SUPABASE_ANON_KEY,
          "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
          "Content-Type": "application/json",
          "Prefer": "return=minimal"
        },
        body: JSON.stringify({ ip_address: ip, date: today, count: 1 })
      });
    } else {
      // Already used today — increment count
      await fetch(
        `${SUPABASE_URL}/rest/v1/usage_tracking?ip_address=eq.${encodeURIComponent(ip)}&date=eq.${today}`,
        {
          method: "PATCH",
          headers: {
            "apikey": SUPABASE_ANON_KEY,
            "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
            "Content-Type": "application/json",
            "Prefer": "return=minimal"
          },
          body: JSON.stringify({ count: currentCount + 1 })
        }
      );
    }

    // Return listing + remaining count
    return new Response(JSON.stringify({
      text,
      remaining: FREE_DAILY_LIMIT - (currentCount + 1),
      limit: FREE_DAILY_LIMIT
    }), { status: 200, headers });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
  }
};
