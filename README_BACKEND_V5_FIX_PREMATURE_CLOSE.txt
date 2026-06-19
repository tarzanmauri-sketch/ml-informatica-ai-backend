BACKEND V5 — FIX ERR_STREAM_PREMATURE_CLOSE

Problema risolto:
FetchError: Invalid response body while trying to fetch https://api.openai.com/v1/chat/completions: Premature close
code: ERR_STREAM_PREMATURE_CLOSE

Cosa cambia:
- rimossa dipendenza openai SDK
- rimossa dipendenza node-fetch indiretta
- chiamata diretta a OpenAI con fetch nativo Node
- header Accept-Encoding: identity per evitare problemi di decompressione gzip
- retry automatico 3 tentativi verso OpenAI
- nessun blocco argomento
- rate limit per IP mantenuto
- limite giornaliero mantenuto

File da sostituire su GitHub:
- server.js
- package.json

Variabili Render:
OPENAI_API_KEY = la tua chiave OpenAI
OPENAI_MODEL = gpt-4.1-mini

Dopo deploy controllare:
https://ml-informatica-ai-backend.onrender.com/health

Deve mostrare:
style: mauri-ai-v5-fetch-direct-retry-no-sdk
