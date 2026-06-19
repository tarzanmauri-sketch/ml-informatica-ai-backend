import express from "express";
import OpenAI from "openai";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

const allowedOrigins = [
  "http://mauriziolanini.altervista.org",
  "https://mauriziolanini.altervista.org",
  "http://localhost:3000"
];

app.use(cors({
  origin: function(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(null, true); // per il primo test lasciamo aperto; dopo possiamo restringere
    }
  }
}));

app.use(express.json({ limit: "1mb" }));
app.use(express.static("public"));

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "ML Informatica AI Assistant",
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini"
  });
});

app.post("/api/ml-assistant", async (req, res) => {
  try {
    const { message, history = [] } = req.body || {};

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({
        error: "OPENAI_API_KEY mancante nelle environment variables."
      });
    }

    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Messaggio mancante." });
    }

    const conversation = history
      .filter(m => m && typeof m.content === "string")
      .slice(-10)
      .map(m => ({
        role: m.role === "user" ? "user" : "assistant",
        content: m.content
      }));

    const response = await client.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content:
            "Sei Mauri AI Assistant, agente virtuale del sito ML Informatica di Maurizio Lanini a Genova. " +
            "Parla in italiano, tono professionale, cordiale, pratico e naturale. " +
            "Aiuti clienti privati, aziende e professionisti a capire e descrivere problemi IT: PC lento, Windows, Mac, email, Outlook, stampanti, reti, Wi-Fi, siti web, assistenza remota e preventivi. " +
            "Non promettere diagnosi definitive o prezzi certi. Raccogli informazioni utili e invita a contattare Maurizio via WhatsApp o telefono. " +
            "Ricorda che PayPal si usa solo dopo accordo. Risposte brevi, chiare, massimo 120 parole."
        },
        ...conversation,
        { role: "user", content: message }
      ]
    });

    res.json({
      reply: response.output_text || "Ti aiuto volentieri: mi descrivi meglio il problema?"
    });
  } catch (error) {
    console.error("Errore /api/ml-assistant:", error);
    res.status(500).json({
      error: "Errore agente AI.",
      detail: error?.message || "Errore sconosciuto"
    });
  }
});

app.listen(port, () => {
  console.log(`ML Informatica AI server attivo sulla porta ${port}`);
});
