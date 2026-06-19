BACKEND V4 — SENZA BLOCCHI ARGOMENTO, SOLO RATE LIMIT

Questa versione NON blocca più le domande in base all'argomento.

Cosa fa:
- risponde a tutto
- se la domanda è fuori informatica, risponde breve e ricorda che il suo contesto principale è ML Informatica
- se la domanda è informatica/tecnologia, risponde bene e in modo utile
- mantiene limite messaggi per IP
- mantiene limite caratteri
- mantiene limite giornaliero
- mantiene max token risposta

Variabili Render consigliate:

OPENAI_API_KEY = la tua chiave OpenAI
OPENAI_MODEL = gpt-4.1-mini

Opzionali:

MAX_MESSAGE_CHARS = 1500
MAX_MESSAGES_PER_WINDOW = 12
WINDOW_MINUTES = 30
DAILY_AI_LIMIT = 120
MAX_OUTPUT_TOKENS = 330

Dopo deploy, /health deve mostrare:

style: mauri-ai-v4-no-topic-blocks-rate-limit-only
topicBlocks: false

Nota:
Questa versione consuma token anche su domande fuori tema, ma evita falsi blocchi e protegge comunque da abuso tramite rate limit.
