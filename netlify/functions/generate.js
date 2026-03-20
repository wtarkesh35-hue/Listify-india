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
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) return new Response(JSON.stringify({ error: "GEMINI_API_KEY not set in Netlify environment variables" }), { status: 500, headers });
    if (!prompt) return new Response(JSON.stringify({ error: "No prompt provided" }), { status: 400, headers });

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: `You are an expert Indian Real Estate Copywriter specializing in BHK properties, Indian localities, vastu compliance, and platforms like MagicBricks, 99acres and Housing.com.\n\n${prompt}`
            }]
          }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 1024 }
        })
      }
    );

    const data = await response.json();

    if (data.error) {
      return new Response(JSON.stringify({ error: data.error.message }), { status: 400, headers });
    }

    if (!data.candidates?.[0]) {
      return new Response(JSON.stringify({ error: "No response from Gemini. Check your API key." }), { status: 500, headers });
    }

    const text = data.candidates[0].content.parts[0].text;
    return new Response(JSON.stringify({ text }), { status: 200, headers });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
  }
};
      
