// server.js
// -----------------------------------------------------------------------------
// Backend proxy for the embeddable chat widget.
//
// This is the ONLY place your real Gemini API key ever lives. It reads it from
// an environment variable (never hardcode it, never commit it to git) and
// makes the actual call to Google's Gemini API server-side. The browser
// widget only ever talks to THIS server — it never sees your key.
// -----------------------------------------------------------------------------

const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
app.use(express.json({ limit: "32kb" }));

// ---------------------------------------------------------------------------
// CONFIG — all from environment variables, see .env.example
// ---------------------------------------------------------------------------
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*"; // lock this to your domain before going live
const PORT = process.env.PORT || 3000;

const SYSTEM_PROMPT =
  process.env.SYSTEM_PROMPT ||
  "You are a friendly, concise assistant embedded on a SaaS landing page. " +
  "Answer visitor questions about the product helpfully and briefly (2-4 sentences). " +
  "If someone shows real interest, invite them to share their email or book a demo. " +
  "Never invent pricing, features, or facts you were not given.";

if (!GEMINI_API_KEY) {
  console.error(
    "\nMissing GEMINI_API_KEY environment variable.\n" +
    "Set it (e.g. in a .env file or your hosting provider's dashboard) before starting the server.\n"
  );
  process.exit(1);
}

app.use(cors({ origin: ALLOWED_ORIGIN }));

// ---------------------------------------------------------------------------
// Serve the widget's client-side JS as a public static file.
// This is safe to be public — it contains no secrets.
// ---------------------------------------------------------------------------
app.get("/widget.js", (req, res) => {
  res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=300");
  res.sendFile(path.join(__dirname, "widget.js"));
});

// ---------------------------------------------------------------------------
// Very small in-memory rate limiter (per IP). Good enough for a prototype.
// For real production traffic, put this behind a proper rate limiter / WAF.
// ---------------------------------------------------------------------------
const requestLog = new Map();
function isRateLimited(ip) {
  const now = Date.now();
  const windowMs = 60_000;
  const maxPerWindow = 20;
  const recent = (requestLog.get(ip) || []).filter((t) => now - t < windowMs);
  recent.push(now);
  requestLog.set(ip, recent);
  return recent.length > maxPerWindow;
}

// ---------------------------------------------------------------------------
// The actual chat endpoint the widget calls.
// ---------------------------------------------------------------------------
app.post("/api/chat", async (req, res) => {
  try {
    const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown";
    if (isRateLimited(ip)) {
      return res.status(429).json({ error: "Too many messages — please slow down a little." });
    }

    const { message, history } = req.body || {};
    if (!message || typeof message !== "string" || message.length > 2000) {
      return res.status(400).json({ error: "Invalid message." });
    }

    // Cap history so a long-running chat can't blow up token usage / cost.
    const safeHistory = Array.isArray(history) ? history.slice(-12) : [];

    const contents = [
      ...safeHistory.map((turn) => ({
        role: turn && turn.role === "assistant" ? "model" : "user",
        parts: [{ text: String((turn && turn.text) || "").slice(0, 2000) }],
      })),
      { role: "user", parts: [{ text: message }] },
    ];

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

    const geminiResponse = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": GEMINI_API_KEY,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents,
        generationConfig: { temperature: 0.6, maxOutputTokens: 300 },
      }),
    });

    if (!geminiResponse.ok) {
      const errText = await geminiResponse.text();
      console.error("Gemini API error:", geminiResponse.status, errText);
      return res.status(502).json({ error: "The assistant is temporarily unavailable. Please try again shortly." });
    }

    const data = await geminiResponse.json();
    const reply =
      (data &&
        data.candidates &&
        data.candidates[0] &&
        data.candidates[0].content &&
        data.candidates[0].content.parts &&
        data.candidates[0].content.parts.map((p) => p.text || "").join("")) ||
      "Sorry, I couldn't come up with a reply just then — could you try rephrasing?";

    res.json({ reply });
  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({ error: "Something went wrong on our end." });
  }
});

app.get("/health", (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Chat widget backend running on port ${PORT}`);
  console.log(`Widget file:  http://localhost:${PORT}/widget.js`);
  console.log(`Chat API:     http://localhost:${PORT}/api/chat`);
});
