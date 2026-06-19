BACKEND V6 — HARDWARE ATTUALE

Problema corretto:
Il bot diceva falsamente che RTX 5090 e Ryzen 9 9950X non esistono.

Cosa cambia:
- mantiene il fix v5 con fetch diretto verso OpenAI
- mantiene retry automatico
- nessun blocco argomento
- aggiunge regole forti nel prompt:
  * RTX 5090 è reale, non dire che non esiste
  * Ryzen 9 9950X è reale, non dire che non esiste
  * se l'utente scrive Ryzen 9 9950, probabilmente intende 9950X
  * per prezzi e disponibilità non inventare: verificare Maurizio/fornitore
  * per hardware recente evitare frasi assolute basate su conoscenza vecchia

File da sostituire su GitHub:
- server.js
- package.json

Dopo deploy /health deve mostrare:
style: mauri-ai-v6-hardware-attuale-no-false-non-esiste
