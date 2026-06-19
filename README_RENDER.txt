ML Informatica AI Backend per Render

File da caricare su GitHub:
- server.js
- package.json
- public/

NON caricare mai .env o chiavi API su GitHub.

Render:
Build Command: npm install
Start Command: npm start

Environment Variables su Render:
OPENAI_API_KEY = tua nuova chiave OpenAI
OPENAI_MODEL = gpt-4.1-mini

Test dopo deploy:
https://TUO-SERVIZIO.onrender.com/api/health

Se /api/health risponde {"ok":true}, il backend è online.
