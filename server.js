const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");

const app = express();
app.use(cors());
app.use(express.json({ limit: "64kb" }));

const PORT = process.env.PORT || 3000;
const MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ====== PROTEZIONI NON DISTRUTTIVE ======
// Nessun blocco per argomento: solo limiti anti-abuso.
const MAX_MESSAGE_CHARS = Number(process.env.MAX_MESSAGE_CHARS || 1500);
const MAX_MESSAGES_PER_WINDOW = Number(process.env.MAX_MESSAGES_PER_WINDOW || 12);
const WINDOW_MINUTES = Number(process.env.WINDOW_MINUTES || 30);
const DAILY_AI_LIMIT = Number(process.env.DAILY_AI_LIMIT || 120);
const MAX_OUTPUT_TOKENS = Number(process.env.MAX_OUTPUT_TOKENS || 330);

// Memoria in RAM: su Render free/basic si resetta se il servizio si riavvia.
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

function tooLongReply() {
  return `Il messaggio è troppo lungo. Scrivilo in modo più breve, massimo ${MAX_MESSAGE_CHARS} caratteri. Se riguarda un problema informatico, indica dispositivo, errore, urgenza e cosa hai già provato.`;
}

function rateLimitReply() {
  return "Hai inviato molte richieste in poco tempo. Per proteggere il servizio, riprova tra un po’. Se è urgente, contatta direttamente Maurizio tramite WhatsApp.";
}

function dailyLimitReply() {
  return "Il servizio AI ha raggiunto il limite giornaliero di sicurezza. Per assistenza urgente, contatta direttamente Maurizio tramite WhatsApp.";
}

// ====== ROUTES ======
app.get("/", (req, res) => {
  resetDailyIfNeeded();
  res.json({
    ok: true,
    service: "ML Informatica AI Assistant",
    model: MODEL,
    style: "mauri-ai-v4-no-topic-blocks-rate-limit-only",
    protections: {
      topicBlocks: false,
      maxMessageChars: MAX_MESSAGE_CHARS,
      maxMessagesPerWindow: MAX_MESSAGES_PER_WINDOW,
      windowMinutes: WINDOW_MINUTES,
      dailyAiLimit: DAILY_AI_LIMIT,
      maxOutputTokens: MAX_OUTPUT_TOKENS
    }
  });
});

app.get("/health", (req, res) => {
  resetDailyIfNeeded();
  res.json({
    ok: true,
    service: "ML Informatica AI Assistant",
    model: MODEL,
    style: "mauri-ai-v4-no-topic-blocks-rate-limit-only",
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
        reply: "Ciao, sono Mauri AI Assistant. Posso aiutarti soprattutto su informatica, PC, reti, email, stampanti, siti web e supporto remoto. Scrivimi pure la tua richiesta."
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

    daily.aiCalls += 1;

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
- Per acquisto PC/notebook/workstation chiedi: uso principale, budget, fisso o portatile, programmi usati, gaming/grafica/lavoro, RAM, SSD, scheda video e urgenza.
- Per problemi tecnici chiedi: dispositivo, sistema operativo, errore, urgenza e cosa è già stato provato.
- Se il caso è concreto, invita a inviare la richiesta a Maurizio tramite WhatsApp.
- Risposte compatte: massimo circa 160 parole, salvo richiesta esplicita di dettaglio.
`;

    const safeHistory = history
      .filter(m => m && typeof m.content === "string" && ["user", "assistant"].includes(m.role))
      .map(m => ({ role: m.role, content: String(m.content).slice(0, 1200) }));

    const completion = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        ...safeHistory,
        { role: "user", content: message }
      ],
      temperature: 0.35,
      max_tokens: MAX_OUTPUT_TOKENS
    });

    const reply = completion.choices?.[0]?.message?.content?.trim()
      || "Ho capito. Dimmi meglio la richiesta e, se riguarda informatica o tecnologia, ti aiuto a prepararla per Maurizio.";

    res.json({
      reply,
      blocked: false,
      usage: completion.usage || null
    });

  } catch (err) {
    console.error("ML Assistant error:", err);
    res.status(500).json({
      reply: "In questo momento il servizio AI non è disponibile. Puoi contattare direttamente Maurizio tramite WhatsApp.",
      error: "ai_backend_error"
    });
  }
});

app.listen(PORT, () => {
  console.log(`ML Informatica AI Assistant v4 senza blocchi argomento attivo sulla porta ${PORT}`);
});
