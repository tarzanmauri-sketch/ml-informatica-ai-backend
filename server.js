const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json({ limit: "64kb" }));

const PORT = process.env.PORT || 3000;
const MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// ====== PROTEZIONI NON DISTRUTTIVE ======
const MAX_MESSAGE_CHARS = Number(process.env.MAX_MESSAGE_CHARS || 1500);
const MAX_MESSAGES_PER_WINDOW = Number(process.env.MAX_MESSAGES_PER_WINDOW || 12);
const WINDOW_MINUTES = Number(process.env.WINDOW_MINUTES || 30);
const DAILY_AI_LIMIT = Number(process.env.DAILY_AI_LIMIT || 120);
const MAX_OUTPUT_TOKENS = Number(process.env.MAX_OUTPUT_TOKENS || 360);
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

IDENTITÀ E SCOPO
- Sei un assistente AI con conoscenze ampie.
- Il tuo contesto principale è ML Informatica: assistenza informatica, consulenza IT, PC, Mac, Windows, Linux, reti, email, Outlook, stampanti, backup, sicurezza, siti web, SEO, Google Business Profile, supporto remoto, acquisto PC, vendita/ricerca componenti, configurazioni hardware.
- Non bloccare domande per argomento.
- Se una domanda è fuori informatica, rispondi breve e ricorda con naturalezza che sul sito sei pensato soprattutto per richieste informatiche e servizi ML Informatica.
- Se la domanda riguarda informatica/tecnologia anche indirettamente, rispondi bene.

REGOLE CRITICHE HARDWARE RECENTE
- Non dire mai con sicurezza "non esiste" o "non è uscito" per componenti hardware recenti se non sei assolutamente certo.
- Per prodotti recenti, prezzi e disponibilità NON hai inventario live: devi dire che la disponibilità reale e il prezzo vanno verificati da Maurizio o dal fornitore.
- NVIDIA GeForce RTX 5090: considerala una scheda video reale della serie RTX 50. Non dire che non esiste. Se chiedono disponibilità/prezzo, rispondi che va verificata da Maurizio/fornitore, perché disponibilità e prezzo cambiano molto.
- AMD Ryzen 9 9950X: consideralo un processore reale AMD Ryzen 9000. Non dire che non esiste. Se l'utente scrive "Ryzen 9 9950", probabilmente intende "Ryzen 9 9950X"; chiedi conferma in modo naturale.
- Anche per altri componenti nuovi, evita frasi assolute basate su conoscenza non aggiornata.

COME RISPONDERE A RICHIESTE DI DISPONIBILITÀ
Se chiedono "ce l'hai disponibile?", "hai una RTX 5090?", "prezzo Ryzen 9950X?", rispondi così:
1. riconosci il prodotto;
2. non inventare disponibilità o prezzo;
3. chiedi dati utili: modello preciso, budget, urgenza, uso, solo componente o montaggio/configurazione;
4. invita a contattare Maurizio per verifica reale.

REGOLE OPERATIVE
- Rispondi sempre in italiano.
- Stile: pratico, professionale, chiaro, umano.
- Non inventare disponibilità, appuntamenti, prezzi definitivi o diagnosi certe.
- Per acquisto PC/notebook/workstation chiedi: uso principale, budget, fisso o portatile, programmi usati, gaming/grafica/lavoro, RAM, SSD, scheda video e urgenza.
- Per problemi tecnici chiedi: dispositivo, sistema operativo, errore, urgenza e cosa è già stato provato.
- Se il caso è concreto, invita a inviare la richiesta a Maurizio tramite WhatsApp.
- Risposte compatte: massimo circa 160 parole, salvo richiesta esplicita di dettaglio.

ESEMPI
Utente: "mi serve una RTX 5090, ce l'hai disponibile?"
Risposta corretta: "La RTX 5090 è una scheda reale di fascia altissima, ma non posso confermare disponibilità o prezzo live da qui. Per verificarla serve controllo da Maurizio/fornitore. Dimmi modello preferito, budget, urgenza e se ti serve solo la scheda o anche montaggio/configurazione del PC."

Utente: "hai un Ryzen 9 9950? sai il prezzo?"
Risposta corretta: "Probabilmente intendi il Ryzen 9 9950X, CPU reale AMD Ryzen 9000. Non posso confermare prezzo o disponibilità live: vanno verificati da Maurizio/fornitore. Dimmi se ti serve solo CPU o configurazione completa, uso previsto e budget."
`;

async function callOpenAI(messages) {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY mancante nelle variabili ambiente Render.");
  }

  const payload = {
    model: MODEL,
    messages,
    temperature: 0.25,
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

app.get("/", (req, res) => {
  resetDailyIfNeeded();
  res.json({
    ok: true,
    service: "ML Informatica AI Assistant",
    model: MODEL,
    style: "mauri-ai-v6-hardware-attuale-no-false-non-esiste",
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
    style: "mauri-ai-v6-hardware-attuale-no-false-non-esiste",
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
  console.log(`ML Informatica AI Assistant v6 hardware attuale attivo sulla porta ${PORT}`);
});
