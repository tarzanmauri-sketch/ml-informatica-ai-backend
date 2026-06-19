# ML Informatica AI Backend Protetto

Questa versione protegge Mauri AI Assistant da uso improprio e consumo inutile di token.

## Protezioni incluse

- Blocco domande fuori tema prima della chiamata OpenAI
- Risposta educata: "so molte cose, ma qui rispondo solo a richieste inerenti ML Informatica"
- Rate limit per IP
- Limite caratteri per messaggio
- Limite giornaliero chiamate AI
- Risposte brevi con max token controllato
- Nessuna chiave API nel sito Altervista

## Variabili Render consigliate

OPENAI_API_KEY = la tua chiave OpenAI
OPENAI_MODEL = gpt-4.1-mini

Opzionali:

MAX_MESSAGE_CHARS = 700
MAX_MESSAGES_PER_WINDOW = 8
WINDOW_MINUTES = 30
DAILY_AI_LIMIT = 80
MAX_OUTPUT_TOKENS = 230

## Endpoint

GET /
GET /health
POST /api/ml-assistant

Il frontend Altervista può continuare a chiamare:

https://ml-informatica-ai-backend.onrender.com/api/ml-assistant

## Test fuori tema

Messaggio:
Qual è la capitale del Congo?

Risposta prevista:
Posso aiutarti su molte cose, ma qui rispondo solo a richieste inerenti ai servizi di ML Informatica...

In quel caso NON viene fatta chiamata OpenAI.
