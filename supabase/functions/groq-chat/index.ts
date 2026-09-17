import { withSupabase } from "npm:@supabase/server";

const GROQ_MODEL = "openai/gpt-oss-120b";

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    if (req.method !== "POST") {
      return Response.json({ error: "Method not allowed." }, { status: 405 });
    }

    const { messages } = await req.json();

    if (!Array.isArray(messages) || messages.length === 0) {
      return Response.json({ error: "Messages are required." }, { status: 400 });
    }

    const safeMessages = messages.slice(-20).map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: String(m.content ?? "").slice(0, 12000)
    }));

    const apiKey = Deno.env.get("GROQ_API_KEY");
    if (!apiKey) {
      return Response.json({ error: "GROQ_API_KEY is not configured in Supabase." }, { status: 500 });
    }

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: safeMessages,
        temperature: 0.7
      })
    });

    const body = await response.json();

    if (!response.ok) {
      console.error("Groq error:", body);
      return Response.json(
        { error: body?.error?.message || "Groq request failed." },
        { status: 502 }
      );
    }

    const answer = body?.choices?.[0]?.message?.content;
    if (!answer) {
      return Response.json({ error: "Groq returned no text." }, { status: 502 });
    }

    return Response.json({ answer });
  })
};
