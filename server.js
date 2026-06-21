const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || "10mb" }));

const PORT = process.env.PORT || 3000;
const MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// ====== MAURI AI VOICE V1 TEST ======
const REALTIME_MODEL = process.env.REALTIME_MODEL || "gpt-realtime-2";
const REALTIME_VOICE = process.env.REALTIME_VOICE || "cedar";
const VOICE_MAX_SESSIONS_PER_WINDOW = Number(process.env.VOICE_MAX_SESSIONS_PER_WINDOW || 6);
const VOICE_WINDOW_MINUTES = Number(process.env.VOICE_WINDOW_MINUTES || 30);
const DAILY_VOICE_LIMIT = Number(process.env.DAILY_VOICE_LIMIT || 40);
const OPENAI_REALTIME_TIMEOUT_MS = Number(process.env.OPENAI_REALTIME_TIMEOUT_MS || 30000);

const voiceBuckets = new Map();
let dailyVoice = {
  day: new Date().toISOString().slice(0, 10),
  sessions: 0
};

// ====== PROTEZIONI NON DISTRUTTIVE ======
const MAX_MESSAGE_CHARS = Number(process.env.MAX_MESSAGE_CHARS || 1500);
const MAX_MESSAGES_PER_WINDOW = Number(process.env.MAX_MESSAGES_PER_WINDOW || 12);
const WINDOW_MINUTES = Number(process.env.WINDOW_MINUTES || 30);
const DAILY_AI_LIMIT = Number(process.env.DAILY_AI_LIMIT || 120);
const MAX_OUTPUT_TOKENS = Number(process.env.MAX_OUTPUT_TOKENS || 360);
const OPENAI_TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS || 45000);
const VISION_TIMEOUT_MS = Number(process.env.VISION_TIMEOUT_MS || 65000);

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

function resetDailyVoiceIfNeeded() {
  const today = new Date().toISOString().slice(0, 10);
  if (dailyVoice.day !== today) {
    dailyVoice.day = today;
    dailyVoice.sessions = 0;
  }
}

function voiceRateLimitOk(ip) {
  const now = Date.now();
  const windowMs = VOICE_WINDOW_MINUTES * 60 * 1000;
  const bucket = voiceBuckets.get(ip) || [];
  const fresh = bucket.filter(ts => now - ts < windowMs);

  if (fresh.length >= VOICE_MAX_SESSIONS_PER_WINDOW) {
    voiceBuckets.set(ip, fresh);
    return false;
  }

  fresh.push(now);
  voiceBuckets.set(ip, fresh);
  return true;
}

function hashSafetyId(value) {
  let hash = 2166136261;
  const str = String(value || "unknown");
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `mlinf-${(hash >>> 0).toString(16)}`;
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



FUNZIONE FOTO / SCREENSHOT DISPONIBILE SUL SITO
Sul sito ML Informatica esiste una funzione chiamata "Foto o schermata" dentro "Scrivi a Mauri AI".
Il cliente può scattare o caricare foto di:
- etichetta notebook, PC, monitor, SSD, stampante, router, alimentatore, componenti;
- schermate Windows Update, errori Windows, schermate blu, BIOS, Gestione dispositivi;
- errori Outlook, Office, stampanti, Wi-Fi, antivirus, licenze o messaggi a video.

Quando il cliente non sa modello, sigla, errore preciso, oppure dice "non so che PC è", "che modello è", "è buono?", "ho una schermata", "Windows Update è bloccato", "ho un errore", devi suggerire in modo naturale:
"Apri Scrivi a Mauri AI e usa Foto o schermata: puoi farmi vedere l'etichetta o la schermata."

Se il cliente ha appena fatto analizzare una foto, considera che le domande successive come "è buono?", "va bene?", "conviene?", "cosa faccio?" si riferiscono probabilmente a quell'oggetto/schermata.

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
- Lingua: rispondi nella stessa lingua usata dal cliente.
- Se il cliente scrive o parla in italiano, rispondi in italiano naturale.
- Se il cliente scrive o parla in inglese, rispondi in inglese semplice e professionale.
- Se il cliente scrive o parla in giapponese, rispondi in giapponese naturale e rispettoso.
- Se il cliente usa un'altra lingua, cerca di rispondere nella stessa lingua.
- Non tradurre nomi aziendali: "ML Informatica", "Maurizio", "Mauri AI", "WhatsApp" restano invariati.
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
    const timer = setTimeout(() => controller.abort(), VISION_TIMEOUT_MS);

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

app.get("/voice-health", (req, res) => {
  resetDailyVoiceIfNeeded();
  res.json({ ok: true, voice: true, realtimeModel: REALTIME_MODEL, realtimeVoice: REALTIME_VOICE, dailyVoiceSessions: dailyVoice.sessions, dailyVoiceLimit: DAILY_VOICE_LIMIT });
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


app.post("/api/realtime-session", async (req, res) => {
  try {
    resetDailyIfNeeded();
    resetDailyVoiceIfNeeded();

    const ip = getIp(req);

    if (!OPENAI_API_KEY) {
      return res.status(500).json({
        ok: false,
        error: "OPENAI_API_KEY_missing",
        message: "OPENAI_API_KEY mancante nelle variabili ambiente Render."
      });
    }

    if (!voiceRateLimitOk(ip)) {
      return res.status(429).json({
        ok: false,
        error: "voice_rate_limited",
        message: "Hai aperto molte sessioni voce in poco tempo. Riprova tra qualche minuto o usa la chat scritta."
      });
    }

    if (dailyVoice.sessions >= DAILY_VOICE_LIMIT) {
      return res.status(429).json({
        ok: false,
        error: "daily_voice_limit",
        message: "Il limite giornaliero delle sessioni voce è stato raggiunto. Usa la chat scritta o WhatsApp."
      });
    }

    dailyVoice.sessions += 1;

    const voiceInstructions = `${systemPrompt}

MODALITÀ VOCE MAURI AI
- Stai parlando a voce con un visitatore del sito ML Informatica.
- Rispondi nella stessa lingua usata dal cliente.
- Se il cliente parla italiano, parla in italiano naturale, con ritmo italiano, pronuncia italiana e senza cadenza americana.
- In italiano usa frasi brevi, scorrevoli e colloquiali-professionali. Evita intonazioni da traduzione inglese.
- Pronuncia bene parole tecniche: PC, Windows, Mac, Outlook, backup, router, Wi-Fi, stampante.
- Pronuncia "ML Informatica" in modo naturale.
- Se il cliente parla inglese, rispondi in inglese semplice e professionale.
- Se il cliente parla giapponese, rispondi in giapponese naturale e rispettoso.
- Non fare monologhi lunghi: massimo 45-70 parole salvo richiesta di dettaglio.
- Se il cliente descrive un problema, fai una domanda mirata alla volta.
- Per PC lento chiedi soprattutto: fisso/portatile, Windows/Mac, SSD o hard disk, RAM se nota.
- Non dire "ti metto in contatto" se non puoi farlo automaticamente.
- Se il cliente vuole assistenza, proponi nella sua lingua: "Premi il pulsante WhatsApp nella schermata voce: ti preparo il messaggio per Maurizio con il problema spiegato".
- Se il cliente non sa marca/modello del PC, notebook, monitor, stampante o router, suggerisci: "Apri Scrivi a Mauri AI e usa Foto o schermata per farmi vedere l'etichetta o la schermata".
- Se il cliente descrive una schermata bloccata, errore Windows, Windows Update fermo, Outlook, stampante o schermata blu, suggerisci di usare la funzione foto nella chat scritta per far vedere la schermata.
- Non inventare prezzi, disponibilità, appuntamenti o diagnosi certe.
- Tono: tecnico, umano, rassicurante, professionale. Niente battute da gelataio.`;

    const sessionConfig = {
      session: {
        type: "realtime",
        model: REALTIME_MODEL,
        instructions: `
ISTRUZIONE VOCE IMPORTANTE
Se stai parlando a voce e ti serve vedere un'etichetta, un modello o una schermata, non dire che puoi vedere direttamente nella voce. Di':
"Per farmela vedere, apri Scrivi a Mauri AI e usa Foto o schermata."
\n` +  voiceInstructions,
        audio: {
          input: {
            transcription: {
              model: process.env.REALTIME_TRANSCRIPTION_MODEL || "gpt-4o-mini-transcribe"
            }
          },
          output: {
            voice: REALTIME_VOICE
          }
        }
      }
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OPENAI_REALTIME_TIMEOUT_MS);

    const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
        "OpenAI-Safety-Identifier": hashSafetyId(ip)
      },
      body: JSON.stringify(sessionConfig),
      signal: controller.signal
    });

    clearTimeout(timer);

    const raw = await response.text();

    if (!response.ok) {
      console.error("Realtime client secret error:", response.status, raw.slice(0, 700));
      return res.status(500).json({
        ok: false,
        error: "realtime_session_error",
        detail: raw.slice(0, 500)
      });
    }

    let data;
    try {
      data = JSON.parse(raw);
    } catch (err) {
      return res.status(500).json({
        ok: false,
        error: "realtime_response_not_json",
        detail: raw.slice(0, 500)
      });
    }

    const clientSecret =
      data?.value ||
      data?.client_secret?.value ||
      data?.client_secret ||
      data?.secret ||
      null;

    if (!clientSecret) {
      return res.status(500).json({
        ok: false,
        error: "realtime_client_secret_missing",
        detail: JSON.stringify(data).slice(0, 500)
      });
    }

    res.json({
      ok: true,
      client_secret: clientSecret,
      expires_at: data?.expires_at || data?.client_secret?.expires_at || null,
      model: REALTIME_MODEL,
      voice: REALTIME_VOICE,
      dailyVoiceSessions: dailyVoice.sessions,
      dailyVoiceLimit: DAILY_VOICE_LIMIT
    });

  } catch (err) {
    console.error("Realtime session error:", err?.message || err);
    res.status(500).json({
      ok: false,
      error: "voice_backend_error",
      message: "Errore tecnico nella creazione della sessione voce. Usa la chat scritta o riprova tra poco.",
      detail: String(err?.message || err).slice(0, 280)
    });
  }
});





app.get("/vision-health", (req, res) => {
  resetDailyIfNeeded();
  res.json({
    ok: true,
    vision: true,
    model: process.env.OPENAI_VISION_MODEL || "gpt-4.1-mini",
    jsonBodyLimit: process.env.JSON_BODY_LIMIT || "10mb",
    maxVisionImageBytes: Number(process.env.MAX_VISION_IMAGE_BYTES || 4500000),
    visionTimeoutMs: VISION_TIMEOUT_MS,
    dailyAiCalls: daily.aiCalls,
    dailyAiLimit: DAILY_AI_LIMIT
  });
});


app.post("/api/ml-vision", async (req, res) => {
  try {
    resetDailyIfNeeded();

    const ip = getIp(req);
    const visionRequestId = `vision-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    console.log(`[${visionRequestId}] Vision request started from ${ip}`);
    const question = String(req.body?.question || "").trim().slice(0, 900);
    let imageData = String(req.body?.imageData || "").trim();

    if (!OPENAI_API_KEY) {
      return res.status(500).json({
        ok: false,
        reply: "Il collegamento AI non è configurato correttamente. Contatta Maurizio su WhatsApp.",
        error: "OPENAI_API_KEY_missing"
      });
    }

    if (!imageData || !imageData.startsWith("data:image/")) {
      return res.status(400).json({
        ok: false,
        reply: "Non ho ricevuto una foto valida. Prova a scattare o caricare di nuovo l’immagine.",
        error: "invalid_image"
      });
    }

    if (imageData.startsWith("data:image/jpg;base64,")) {
      imageData = imageData.replace("data:image/jpg;base64,", "data:image/jpeg;base64,");
    }

    const approxBytes = Math.ceil(imageData.length * 0.75);
    console.log(`[${visionRequestId}] Vision image approx bytes: ${approxBytes}`);
    const maxImageBytes = Number(process.env.MAX_VISION_IMAGE_BYTES || 4500000);

    if (approxBytes > maxImageBytes) {
      return res.status(413).json({
        ok: false,
        reply: "La foto è troppo grande. Prova a inviare uno screenshot o una foto meno pesante.",
        error: "image_too_large"
      });
    }

    if (!rateLimitOk(ip)) {
      return res.json({ ok: false, reply: rateLimitReply(), blocked: true, reason: "rate_limited" });
    }

    if (daily.aiCalls >= DAILY_AI_LIMIT) {
      return res.json({ ok: false, reply: dailyLimitReply(), blocked: true, reason: "daily_ai_limit" });
    }

    daily.aiCalls += 1;

    const visionPrompt = `
Sei Mauri AI Vision, assistente visuale del sito ML Informatica di Maurizio Lanini.

OBIETTIVO
Analizza foto o screenshot inviati dal cliente per assistenza informatica.

Puoi aiutare a riconoscere:
- etichette notebook, PC, monitor, stampanti, router, componenti;
- modello, marca, seriale se leggibile;
- schermate Windows Update, errori Windows, schermate blu, BIOS, Gestione dispositivi;
- errori Outlook, Office, stampanti, Wi‑Fi, rete, antivirus;
- problemi hardware visibili.

REGOLE
- Rispondi nella lingua usata dal cliente, se riconoscibile. Altrimenti italiano.
- Non inventare marca/modello se non è leggibile: di' "sembra" o "non si legge bene".
- Se leggi dati sensibili, non ripeterli tutti: cita solo ciò che serve.
- Non dare istruzioni pericolose tipo spegnere forzatamente durante update senza prima verificare.
- Se è Windows Update fermo, chiedi da quanto tempo è fermo e se il disco/led lavora.
- Se è etichetta dispositivo, estrai marca/modello e spiega come procedere.
- Se serve assistenza, prepara un riepilogo utile per Maurizio.
- Stile: pratico, umano, professionale, massimo 180 parole.
`;

    const userText = question || "Analizza questa foto o schermata: dimmi cosa vedi, che modello/problema sembra, e come procedere in modo sicuro.";

    const headers = {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
      "Accept-Encoding": "identity"
    };

    if (typeof hashSafetyId === "function") {
      headers["OpenAI-Safety-Identifier"] = hashSafetyId(ip);
    }

    const model = process.env.OPENAI_VISION_MODEL || "gpt-4.1-mini";

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), VISION_TIMEOUT_MS);

    const responsesPayload = {
      model,
      instructions: visionPrompt,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: userText },
            { type: "input_image", image_url: imageData }
          ]
        }
      ],
      temperature: 0.2,
      max_output_tokens: Number(process.env.MAX_VISION_OUTPUT_TOKENS || 420)
    };

    let response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers,
      body: JSON.stringify(responsesPayload),
      signal: controller.signal
    });

    let raw = await response.text();

    if (!response.ok) {
      console.error("Vision Responses API error:", response.status, raw.slice(0, 700));

      const chatPayload = {
        model,
        messages: [
          { role: "system", content: visionPrompt },
          {
            role: "user",
            content: [
              { type: "text", text: userText },
              { type: "image_url", image_url: { url: imageData } }
            ]
          }
        ],
        temperature: 0.2,
        max_tokens: Number(process.env.MAX_VISION_OUTPUT_TOKENS || 420)
      };

      response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers,
        body: JSON.stringify(chatPayload),
        signal: controller.signal
      });

      raw = await response.text();
    }

    clearTimeout(timer);

    if (!response.ok) {
      console.error("Vision OpenAI final error:", response.status, raw.slice(0, 900));
      return res.status(500).json({
        ok: false,
        reply: "Non sono riuscito ad analizzare la foto in questo momento. Riprova con una foto più nitida oppure inviala a Maurizio su WhatsApp.",
        error: "vision_openai_error",
        detail: raw.slice(0, 500)
      });
    }

    let data;
    try {
      data = JSON.parse(raw);
    } catch (err) {
      return res.status(500).json({
        ok: false,
        reply: "La risposta AI non era leggibile. Riprova tra poco.",
        error: "vision_response_not_json"
      });
    }

    const outputText =
      typeof data.output_text === "string" ? data.output_text.trim() : "";

    const outputJoined = Array.isArray(data.output)
      ? data.output.flatMap(item => item.content || []).map(c => c.text || c.transcript || "").join("\\n").trim()
      : "";

    const chatText =
      data?.choices?.[0]?.message?.content?.trim?.() || "";

    const reply = outputText || outputJoined || chatText;

    if (!reply) {
      return res.status(500).json({
        ok: false,
        reply: "Non sono riuscito a ricavare informazioni utili dalla foto. Prova con un’immagine più nitida.",
        error: "empty_vision_reply"
      });
    }

    console.log(`[${visionRequestId}] Vision reply OK`);

    res.json({
      ok: true,
      reply,
      usage: data.usage || null,
      model
    });

  } catch (err) {
    console.error("ML Vision error:", err?.message || err);
    res.status(500).json({
      ok: false,
      reply: "Errore tecnico durante l’analisi della foto. Riprova tra qualche secondo o contatta Maurizio su WhatsApp.",
      error: "vision_backend_error",
      detail: String(err?.message || err).slice(0, 280)
    });
  }
});



app.use((err, req, res, next) => {
  if (err && (err.type === "entity.too.large" || err.status === 413)) {
    return res.status(413).json({
      ok: false,
      reply: "La foto è troppo pesante per essere analizzata. Prova a scattare una foto più vicina, meno pesante, oppure uno screenshot.",
      error: "payload_too_large"
    });
  }
  next(err);
});


app.listen(PORT, () => {
  console.log(`ML Informatica AI Assistant v6 hardware attuale attivo sulla porta ${PORT}`);
});