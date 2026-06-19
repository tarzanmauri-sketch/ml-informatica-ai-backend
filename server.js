const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json({ limit: "64kb" }));

const PORT = process.env.PORT || 3000;
const MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// ====== PROTEZIONI NON DISTRUTTIVE ======
// Nessun blocco per argomento: solo limiti anti-abuso.
const MAX_MESSAGE_CHARS = Number(process.env.MAX_MESSAGE_CHARS || 1500);
const MAX_MESSAGES_PER_WINDOW = Number(process.env.MAX_MESSAGES_PER_WINDOW || 12);
const WINDOW_MINUTES = Number(process.env.WINDOW_MINUTES || 30);
const DAILY_AI_LIMIT = Number(process.env.DAILY_AI_LIMIT || 120);
const MAX_OUTPUT_TOKENS = Number(process.env.MAX_OUTPUT_TOKENS || 330);
const OPENAI_TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS || 45000);

const ipBuckets = new Map();
let daily = {
  day: new Date().toISOString().slice(0, 10),
  aiCalls: 0
};

function getIp(req) {
  return (
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.socket.remoteAddress ||
    "unknown"
  );
}

function resetDailyIfNeeded() {
  const today = new Date().toISOString().slice(0, 10);
  if (daily.day !== today) {
    daily.day = today;
    daily.aiCalls = 0;
  }
}

function rateLimitOk(ip) {
  const now = Date.now();
  const windowMs = WINDOW_MINUTES * 60 * 1000;
  const bucket = ipBuckets.get(ip) || [];
  const fresh = bucket.filter(ts => now - ts < windowMs);

  if (fresh.length >= MAX_MESSAGES_PER_WINDOW) {
    ipBuckets.set(ip, fresh);
    return false;
  }

  fresh.push(now);
  ipBuckets.set(ip, fresh);
  return true;
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function tooLongReply() {
  return `Il messaggio è troppo lungo. Scrivilo in modo più breve, massimo ${MAX_MESSAGE_CHARS} caratteri.`;
}

function rateLimitReply() {
  return "Hai inviato molte richieste in poco tempo. Per proteggere il servizio, riprova tra un po’. Se è urgente, contatta direttamente Maurizio tramite WhatsApp.";
}

function dailyLimitReply() {
  return "Il servizio AI ha raggiunto il limite giornaliero di sicurezza. Per assistenza urgente, contatta direttamente Maurizio tramite WhatsApp.";
}

const systemPrompt = `
Sei Mauri AI Assistant, l'agente virtuale del sito ML Informatica di Maurizio Lanini.

Identità:
- Sei un assistente AI con conoscenze ampie.
- Il tuo contesto principale è ML Informatica: assistenza informatica, consulenza IT, PC, Mac, Windows, Linux, reti, email, Outlook, stampanti, backup, sicurezza, siti web, SEO, Google Business Profile, supporto remoto, acquisto PC e componenti.
- Non devi bloccare le domande per argomento.
- Se una domanda è fuori dal mondo informatico, puoi rispondere in modo breve e poi ricordare con naturalezza che sul sito sei pensato soprattutto per richieste informatiche e servizi ML Informatica.
- Se la domanda riguarda informatica/tecnologia anche indirettamente, rispondi bene e in modo utile.

Regole operative:
- Rispondi sempre in italiano.
- Stile: pratico, professionale, chiaro, umano.
- Non inventare disponibilità, appuntamenti, prezzi definitivi o diagnosi certe.
- Per disponibilità prodotti/componenti, spiega che la disponibilità reale va confermata da Maurizio o dal fornitore.
- Per acquisto PC/notebook/workstation chiedi: uso principale, budget, fisso o portatile, programmi usati, gaming/grafica/lavoro, RAM, SSD, scheda video e urgenza.
- Per problemi tecnici chiedi: dispositivo, sistema operativo, errore, urgenza e cosa è già stato provato.
- Se il caso è concreto, invita a inviare la richiesta a Maurizio tramite WhatsApp.
- Risposte compatte: massimo circa 160 parole, salvo richiesta esplicita di dettaglio.
`;

async function callOpenAI(messages) {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY mancante nelle variabili ambiente Render.");
  }

  const payload = {
    model: MODEL,
    messages,
    temperature: 0.35,
    max_tokens: MAX_OUTPUT_TOKENS
  };

  let lastError;

  for (let attempt = 1; attempt <= 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);

    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
          "Accept": "application/json",
          // Evita problemi di decompressione tipo ERR_STREAM_PREMATURE_CLOSE su alcuni ambienti Node/Render.
          "Accept-Encoding": "identity"
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      clearTimeout(timer);

      const raw = await res.text();

      if (!res.ok) {
        throw new Error(`OpenAI HTTP ${res.status}: ${raw.slice(0, 700)}`);
      }

      let data;
      try {
        data = JSON.parse(raw);
      } catch (jsonErr) {
        throw new Error(`Risposta OpenAI non JSON: ${raw.slice(0, 500)}`);
      }

      const reply = data?.choices?.[0]?.message?.content?.trim();
      if (!reply) {
        throw new Error("OpenAI non ha restituito contenuto utile.");
      }

      return {
        reply,
        usage: data.usage || null
      };

    } catch (err) {
      clearTimeout(timer);
      lastError = err;
      console.error(`OpenAI attempt ${attempt} failed:`, err?.message || err);

      if (attempt < 3) {
        await wait(900 * attempt);
      }
    }
  }

  throw lastError;
}

// ====== ROUTES ======
app.get("/", (req, res) => {
  resetDailyIfNeeded();
  res.json({
    ok: true,
    service: "ML Informatica AI Assistant",
    model: MODEL,
    style: "mauri-ai-v5-fetch-direct-retry-no-sdk",
    protections: {
      topicBlocks: false,
      maxMessageChars: MAX_MESSAGE_CHARS,
      maxMessagesPerWindow: MAX_MESSAGES_PER_WINDOW,
      windowMinutes: WINDOW_MINUTES,
      dailyAiLimit: DAILY_AI_LIMIT,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      openaiTimeoutMs: OPENAI_TIMEOUT_MS
    }
  });
});

app.get("/health", (req, res) => {
  resetDailyIfNeeded();
  res.json({
    ok: true,
    service: "ML Informatica AI Assistant",
    model: MODEL,
    style: "mauri-ai-v5-fetch-direct-retry-no-sdk",
    dailyAiCalls: daily.aiCalls,
    dailyAiLimit: DAILY_AI_LIMIT,
    topicBlocks: false
  });
});

app.post("/api/ml-assistant", async (req, res) => {
  try {
    resetDailyIfNeeded();

    const ip = getIp(req);
    const message = String(req.body?.message || "").trim();
    const history = Array.isArray(req.body?.history) ? req.body.history.slice(-8) : [];

    if (!message) {
      return res.json({
        reply: "Ciao, sono Mauri AI Assistant. Posso aiutarti soprattutto su informatica, PC, componenti, reti, email, stampanti, siti web e supporto remoto. Scrivimi pure la tua richiesta."
      });
    }

    if (message.length > MAX_MESSAGE_CHARS) {
      return res.json({ reply: tooLongReply(), blocked: true, reason: "message_too_long" });
    }

    if (!rateLimitOk(ip)) {
      return res.json({ reply: rateLimitReply(), blocked: true, reason: "rate_limited" });
    }

    if (daily.aiCalls >= DAILY_AI_LIMIT) {
      return res.json({ reply: dailyLimitReply(), blocked: true, reason: "daily_ai_limit" });
    }

    const safeHistory = history
      .filter(m => m && typeof m.content === "string" && ["user", "assistant"].includes(m.role))
      .map(m => ({ role: m.role, content: String(m.content).slice(0, 1200) }));

    daily.aiCalls += 1;

    const result = await callOpenAI([
      { role: "system", content: systemPrompt },
      ...safeHistory,
      { role: "user", content: message }
    ]);

    res.json({
      reply: result.reply,
      blocked: false,
      usage: result.usage
    });

  } catch (err) {
    console.error("ML Assistant error:", err?.message || err);
    res.status(500).json({
      reply: "In questo momento il collegamento AI ha avuto un errore tecnico. Riprova tra qualche secondo. Se è urgente, contatta direttamente Maurizio tramite WhatsApp.",
      error: "ai_backend_error",
      detail: String(err?.message || err).slice(0, 280)
    });
  }
});

app.listen(PORT, () => {
  console.log(`ML Informatica AI Assistant v5 fetch direct retry attivo sulla porta ${PORT}`);
});
