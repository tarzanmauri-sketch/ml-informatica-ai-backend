const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");

const app = express();
app.use(cors());
app.use(express.json({ limit: "32kb" }));

const PORT = process.env.PORT || 3000;
const MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ====== PROTEZIONI ======
const MAX_MESSAGE_CHARS = Number(process.env.MAX_MESSAGE_CHARS || 700);
const MAX_MESSAGES_PER_WINDOW = Number(process.env.MAX_MESSAGES_PER_WINDOW || 8);
const WINDOW_MINUTES = Number(process.env.WINDOW_MINUTES || 30);
const DAILY_AI_LIMIT = Number(process.env.DAILY_AI_LIMIT || 80);
const MAX_OUTPUT_TOKENS = Number(process.env.MAX_OUTPUT_TOKENS || 230);

// Memoria in RAM: va bene per Render free/basic. Si resetta se il servizio si riavvia.
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

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

const IT_KEYWORDS = [
  "pc", "computer", "notebook", "portatile", "desktop", "windows", "mac", "macbook", "apple",
  "linux", "software", "hardware", "driver", "stampante", "scanner", "wifi", "wi-fi",
  "rete", "router", "modem", "lan", "nas", "backup", "virus", "malware", "antivirus",
  "email", "mail", "posta", "outlook", "gmail", "password", "account", "icloud",
  "sito", "web", "dominio", "hosting", "wordpress", "altervista", "render", "seo",
  "google business", "maps", "internet", "browser", "chrome", "edge", "firefox",
  "assistenza", "remoto", "remote", "teamviewer", "anydesk", "preventivo", "configurazione",
  "installazione", "aggiornamento", "lento", "bloccato", "errore", "schermo", "monitor",
  "ram", "ssd", "hard disk", "disco", "scheda video", "stampare", "file", "pdf",
  "recupero dati", "dati", "server", "sincronizzazione", "cloud", "drive", "onedrive",
  "telefono", "smartphone", "android", "iphone", "tablet", "app", "printer"
];

const OFF_TOPIC_PATTERNS = [
  "capitale", "congo", "barzelletta", "poesia", "ricetta", "calcio", "politica",
  "oroscopo", "film", "canzone", "storia romana", "matematica", "compiti",
  "traduci", "scrivimi un tema", "raccontami", "chi e", "quanto dista la luna"
];

function isRelevantToML(text) {
  const t = normalize(text);

  // Se contiene keyword IT, passa.
  if (IT_KEYWORDS.some(k => t.includes(normalize(k)))) return true;

  // Domande generiche chiaramente fuori campo.
  if (OFF_TOPIC_PATTERNS.some(k => t.includes(normalize(k)))) return false;

  // Messaggi tipo "ciao", "buongiorno" passano, perché sono apertura conversazione.
  if (/^(ciao|buongiorno|buonasera|salve|hey|ehi|hello|info|informazioni)[\s!.?]*$/i.test(text.trim())) {
    return true;
  }

  return false;
}

function offTopicReply() {
  return "Posso aiutarti su molte cose, ma qui rispondo solo a richieste inerenti ai servizi di ML Informatica: assistenza PC e Mac, email e Outlook, stampanti, reti Wi‑Fi/LAN, backup, siti web, supporto remoto e consulenza informatica. Se hai un problema informatico, scrivimi pure cosa succede e ti aiuto a preparare la richiesta per Maurizio.";
}

function tooLongReply() {
  return `Per evitare richieste troppo lunghe, scrivi il problema in modo più breve: massimo ${MAX_MESSAGE_CHARS} caratteri. Indica dispositivo, errore e cosa hai già provato.`;
}

function rateLimitReply() {
  return `Hai inviato molte richieste in poco tempo. Per proteggere il servizio, puoi riprovare più tardi. Se è urgente, contatta direttamente Maurizio da WhatsApp.`;
}

function dailyLimitReply() {
  return "Il servizio AI ha raggiunto il limite giornaliero di sicurezza. Per assistenza urgente, contatta direttamente Maurizio da WhatsApp.";
}

// ====== ROUTES ======
app.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "ML Informatica AI Assistant",
    model: MODEL,
    style: "mauri-ai-protected",
    protections: {
      maxMessageChars: MAX_MESSAGE_CHARS,
      maxMessagesPerWindow: MAX_MESSAGES_PER_WINDOW,
      windowMinutes: WINDOW_MINUTES,
      dailyAiLimit: DAILY_AI_LIMIT,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      offTopicFilter: true
    }
  });
});

app.get("/health", (req, res) => {
  resetDailyIfNeeded();
  res.json({
    ok: true,
    service: "ML Informatica AI Assistant",
    model: MODEL,
    style: "mauri-ai-protected",
    dailyAiCalls: daily.aiCalls,
    dailyAiLimit: DAILY_AI_LIMIT
  });
});

app.post("/api/ml-assistant", async (req, res) => {
  try {
    resetDailyIfNeeded();

    const ip = getIp(req);
    const message = String(req.body?.message || "").trim();
    const history = Array.isArray(req.body?.history) ? req.body.history.slice(-8) : [];

    if (!message) {
      return res.json({ reply: "Scrivimi pure il problema informatico e ti aiuto a preparare la richiesta per Maurizio." });
    }

    if (message.length > MAX_MESSAGE_CHARS) {
      return res.json({ reply: tooLongReply(), blocked: true, reason: "message_too_long" });
    }

    if (!rateLimitOk(ip)) {
      return res.json({ reply: rateLimitReply(), blocked: true, reason: "rate_limited" });
    }

    // Blocco fuori tema PRIMA di OpenAI: costo quasi zero.
    if (!isRelevantToML(message)) {
      return res.json({ reply: offTopicReply(), blocked: true, reason: "off_topic_no_openai_call" });
    }

    if (daily.aiCalls >= DAILY_AI_LIMIT) {
      return res.json({ reply: dailyLimitReply(), blocked: true, reason: "daily_ai_limit" });
    }

    daily.aiCalls += 1;

    const systemPrompt = `
Sei Mauri AI Assistant, l'agente virtuale del sito ML Informatica di Maurizio Lanini.

Regole obbligatorie:
- Rispondi in italiano.
- Sei professionale, pratico, chiaro e cordiale.
- Puoi dire che hai conoscenze ampie, ma in questo sito rispondi solo a richieste inerenti ML Informatica.
- Campo ammesso: assistenza informatica, PC Windows e Mac, email/Outlook, stampanti, reti Wi‑Fi e LAN, backup, siti web, SEO, Google Business Profile, supporto remoto, consulenza IT, preventivi e raccolta informazioni tecniche.
- Se la domanda è fuori tema, non rispondere al contenuto. Spiega che puoi aiutare solo per richieste informatiche e invita a scrivere il problema tecnico.
- Non inventare prezzi definitivi, diagnosi certe o disponibilità.
- Prima raccogli informazioni utili: dispositivo, sistema operativo, errore, urgenza, cosa è già stato provato.
- Risposte brevi: massimo 130 parole.
- Chiudi spesso invitando a inviare la richiesta a Maurizio tramite il pulsante WhatsApp se il caso è concreto.
`;

    const messages = [
      { role: "system", content: systemPrompt },
      ...history
        .filter(m => m && typeof m.content === "string" && ["user", "assistant"].includes(m.role))
        .map(m => ({ role: m.role, content: String(m.content).slice(0, 900) })),
      { role: "user", content: message }
    ];

    const completion = await openai.chat.completions.create({
      model: MODEL,
      messages,
      temperature: 0.35,
      max_tokens: MAX_OUTPUT_TOKENS
    });

    const reply = completion.choices?.[0]?.message?.content?.trim() || "Ho capito. Dimmi dispositivo, errore e cosa hai già provato, così preparo una richiesta chiara per Maurizio.";

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
  console.log(`ML Informatica AI Assistant protetto attivo sulla porta ${PORT}`);
});
