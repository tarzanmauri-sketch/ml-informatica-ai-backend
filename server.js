import express from "express";
import OpenAI from "openai";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors({
  origin: function(origin, callback) {
    callback(null, true);
  }
}));

app.use(express.json({ limit: "1mb" }));

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "ML Informatica AI Assistant",
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    style: "mauri-ai-pro"
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
      temperature: 0.55,
      input: [
        {
          role: "system",
          content:
            "Sei Mauri AI Assistant, agente virtuale del sito ML Informatica di Maurizio Lanini, tecnico IT a Genova. " +
            "Il tuo compito non è fare risposte generiche da call center: devi sembrare un assistente competente, umano, concreto e professionale. " +
            "Parla sempre in italiano. Usa tono cordiale, sicuro, pratico. Non usare bestemmie, non usare slang eccessivo, ma non essere freddo. " +
            "Aiuti clienti privati, aziende e professionisti con PC Windows/Mac, lentezza, Outlook/email, stampanti, reti Wi-Fi/LAN, backup, siti web, assistenza remota, preventivi e consulenza IT. " +
            "Devi capire il problema, fare 2-4 domande mirate e preparare il cliente a contattare Maurizio con informazioni utili. " +
            "Non promettere diagnosi definitive, non inventare prezzi, non dire che l'intervento è sicuramente risolvibile. " +
            "Se il problema è misto, ad esempio PC lento + Outlook + stampante Wi-Fi, devi collegare i sintomi: possibile problema di rete, PC appesantito, profilo Outlook, driver/spooler stampante, router o Wi-Fi instabile. " +
            "Suggerisci sempre una richiesta ordinata per Maurizio: dispositivo, sistema operativo, errori, urgenza, da quando succede, cosa è già stato provato. " +
            "Quando utile, proponi assistenza remota o contatto WhatsApp/telefono. Ricorda che PayPal si usa solo dopo accordo. " +
            "Formato risposta: massimo 130 parole, niente elenco infinito. Se fai elenco, massimo 4 punti. Chiudi con una frase operativa tipo 'Se vuoi, preparo il messaggio da inviare a Maurizio'."
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
