# ChatMT — Backend (API, regole e limiti)

- **Stato:** aggiornato e verificato il 31 ottobre 2026 (composer “Create your flyer”, sfondi
  generati OpenRouter, entry point Vercel).
- **Ambito:** backend e interfaccia. La pagina pubblica è un composer semplice; la pagina
  dettagliata resta in `frontend/studio.html`. Il frontend non usa `localStorage`: legge la
  risposta, il profilo, la memoria e gli sfondi da queste API, che servono anche la pagina sulla
  stessa origine. I font sono locali (`frontend/fonts/`) e gli sfondi possono essere generati da
  OpenRouter.
- **Test:** 114 test automatici superati, 62 controlli nel browser superati.
- **Linguaggio:** codice e identificativi in inglese, documentazione in italiano, come nel resto
  del progetto.

---

## 1. Cosa aggiunge il backend

Il prototipo della fase 2 calcolava distanze di colore e memorizzava preferenze nel browser.
Il backend aggiunge ciò che il browser non poteva fare da solo:

| Funzione | Dove |
|---|---|
| Memoria condivisa su disco, separata per utente | `backend/storage/file-adapter.js` |
| Giudizio della ragione per rosso e giallo (regole + modello linguistico) | `modules/reflection/reason-assessment.js`, `backend/llm-classifier.js` |
| Profilo *friendly / not_friendly*, displeasure e spiegazione differita | `modules/policy/standing-engine.js` |
| Suggerimenti di sfondi tendenti ai cinque colori, ridotti per il profilo non friendly | `modules/policy/design-suggestions.js` |
| Ritaglio, ridimensionamento, rotazione e conversione formato | `backend/services/image-service.js` |
| API HTTP senza framework, con validazione ed errori espliciti | `backend/server.js` |
| Interfaccia servita dalla stessa origine dell'API | `backend/static-files.js` |

Le regole nuove non sono state inventate dal codice: vengono dai messaggi del creatore del
28 ottobre e del 29 ottobre 2026 ed è stata scritta una versione leggibile da una macchina in
`standards/colour-meanings.json`.

---

## 2. Avvio

```bash
cd ChatMT
npm install          # una sola dipendenza: jimp, per le immagini
npm start            # node backend/server.js
# http://127.0.0.1:3080/api/health
```

In sviluppo, con dati in una cartella temporanea e porta diversa:

```bash
PORT=3099 CHATMT_DATA_DIR=./data-dev npm start
```

La pagina è servita dallo stesso server:

- `GET /` → `302` verso `/frontend/`;
- `GET /frontend/...` → i file dell'interfaccia.

`backend/static-files.js` risolve il percorso dentro la cartella `frontend/` e rifiuta ogni
percorso che tenti di uscirne (`/frontend/../package.json` è un `404`, verificato dai test).
Solo l'interfaccia è esposta: moduli, standard e dati non sono serviti come file.

I tipi MIME sono espliciti: HTML, JavaScript, CSS, JSON, SVG, immagini e font. In particolare
`.ttf`, `.otf` e `.woff` sono serviti come `font/ttf`, `font/otf` e `font/woff`, con
`X-Content-Type-Options: nosniff`. I font dell'interfaccia sono locali e non esistono richieste a
CDN o webfont remoti.

L'immagine Docker avvia questo server (`node backend/server.js`) e scrive la memoria nel volume
`/data`, quindi API e interfaccia arrivano insieme.

---

## 3. Configurazione

Nessuna variabile è obbligatoria. Un valore non valido ferma il server all'avvio invece di
essere sostituito in silenzio.

| Variabile | Default | Uso |
|---|---|---|
| `PORT` o `CHATMT_PORT` | `3080` | porta HTTP (`0` = porta scelta dal sistema) |
| `CHATMT_HOST` | `127.0.0.1` | interfaccia di ascolto |
| `CHATMT_DATA_DIR` | `./data` (`/tmp/chatmt-data` su Vercel) | cartella dei profili JSON |
| `CHATMT_IMAGE_CACHE_DIR` | `./data/background-cache` (`/tmp/chatmt-background-cache` su Vercel) | cache delle immagini generate |
| `CHATMT_ALLOWED_ORIGINS` | `http://localhost:8000`, `http://127.0.0.1:8000`, `http://localhost:8080`, `http://127.0.0.1:8080` | origini CORS ammesse; `*` ammette tutte |
| `CHATMT_MAX_BODY_BYTES` | `12582912` (12 MiB) | limite del corpo JSON |
| `CHATMT_MAX_IMAGE_BYTES` | `8388608` (8 MiB) | limite dell'immagine decodificata |
| `CHATMT_MAX_IMAGE_DIMENSION` | `8000` | limite per lato dell'immagine |
| `CHATMT_MAX_IMAGE_PIXELS` | `40000000` | limite dei pixel totali |
| `OPENROUTER_API_BASE` | `https://openrouter.ai/api/v1` | endpoint Image API di OpenRouter |
| `OPENROUTER_API_KEY` o `CHATMT_IMAGE_API_KEY` | assente | chiave OpenRouter, solo sul server; senza chiave si usano i gradienti di fallback |
| `OPENROUTER_IMAGE_MODEL` o `CHATMT_IMAGE_MODEL` | `krea/k3-edit` | modello image-to-image; richiede 1–4 immagini di riferimento |
| `CHATMT_IMAGE_TIMEOUT_MS` | `90000` | timeout di una generazione immagine |
| `CHATMT_LLM_API_BASE`, `DEEPSEEK_API_BASE` o `ZAI_API_BASE` | `https://api.deepseek.com` | endpoint OpenAI-compatible, senza `/chat/completions` finale |
| `CHATMT_LLM_API_KEY`, `DEEPSEEK_API_KEY` o `ZAI_API_KEY` | assente | chiave del modello, solo sul server |
| `CHATMT_LLM_MODEL`, `DEEPSEEK_MODEL` o `ZAI_MODEL` | `deepseek-flash` | nome del modello |
| `CHATMT_LLM_THINKING` | `enabled` | modalità di ragionamento DeepSeek: `enabled` o `disabled` |
| `CHATMT_LLM_REASONING_EFFORT` | `high` | sforzo di ragionamento: `minimal`, `low`, `medium`, `high` |
| `CHATMT_LLM_TIMEOUT_MS` | `20000` | timeout della chiamata al modello (un modello che ragiona risponde in secondi) |

La chiave non viene mai restituita dall'API, non viene scritta nei dati e non compare nei log.
La chiave OpenRouter serve solo a generare gli sfondi: senza di essa le risposte continuano a
funzionare con i gradienti di fallback. Il prompt inviato al modello contiene colore e motivo,
non il testo del flyer.

Su Vercel le stesse variabili vanno impostate nel progetto; `VERCEL=1` fa puntare
`CHATMT_DATA_DIR` e `CHATMT_IMAGE_CACHE_DIR` a `/tmp`, quindi memoria e cache sono per istanza e
volatili. Il frontend è servito staticamente e `api/index.js` gestisce `/api/*` tramite il
rewrite `/api/(.*) → /api/index`; il catch-all `api/[...path].js` non copre le rotte annidate su
Vercel. Per una memoria duratura serve un adattatore esterno (Vercel KV, Postgres o Blob).

All'avvio `npm start` legge `ChatMT/.env` (`backend/env-file.js`, nessuna dipendenza): un file
`KEY=VALUE` con commenti, `export` opzionale e virgolette. Il file è ignorato da git; il template
con tutte le variabili è `.env.example`, che invece è versionato e non contiene chiavi. Una
variabile esportata nella shell **vince** sempre sul file, e un file assente non è un errore: il
server parte con i valori dichiarati e senza modello. Il caricamento avviene solo quando
`backend/server.js` è avviato come programma, non quando i test lo importano.

---

## 4. Regole implementate

### 4.1 Significati dei colori

| Colore | Significato registrato | Trattamento |
|---|---|---|
| green | prosperity and peace | incoraggiato |
| blue | abundance | incoraggiato |
| orange | joy and happiness | incoraggiato |
| indigo | victory | incoraggiato |
| violet | safety | incoraggiato |
| red | danger or royalty | interrogato |
| yellow | anger or determination | interrogato |
| magenta | victory (stesso di indigo) | incoraggiato, equivalente |
| purple | safety (stesso di violet) | incoraggiato, equivalente |

Il 29 ottobre il creatore ha stabilito che magenta "falls into the same meaning" di indigo e
purple di violet: il file standard li registra nella sezione `equivalent`, prendono il
significato del colore di riferimento e ricevono l'assistenza estesa. I colori senza significato
restano quelli non elencati dal creatore (lime, crimson, gold, navy, orchid, grey): il sistema lo
dichiara (`noMeaningRecorded`) e **non ne inventa uno**.

### 4.2 Ragione personale o cogente

Per rosso e giallo la domanda del codice standard resta. La risposta viene classificata:

| Esito | Come viene deciso | Effetto |
|---|---|---|
| `personal` | regole dichiarate: gusto, "mi piace e basta", colore preferito, nessun motivo | profilo `not_friendly`; 2 suggerimenti brevi; ritardo di 900 ms; nessuno sfondo rosso/giallo; displeasure e spiegazione alla interazione successiva |
| `personal` con `reason_present: false` | nessuna ragione scritta: il 29 ottobre il creatore ha stabilito che una ragione **assente è personale** | come sopra; la preferenza però **non** viene salvata finché la domanda resta senza risposta |
| `cogent` | regole dichiarate: significato, scopo, pubblico, marca, contrasto, contesto di design | profilo `friendly`; 5 suggerimenti completi; sfondi rosso/giallo sbloccati, ma solo su richiesta |
| `needs_review` | le regole non decidono e il modello linguistico non è configurato, fallisce, resta incerto o ha confidenza sotto 0.5 | nessun profilo e nessuna preferenza salvati; si chiede una ragione più concreta |

Le regole sono in `modules/reflection/reason-assessment.js`, con pesi e soglie dichiarati
(`DECISION_THRESHOLDS`). Non sono una misura linguistica: sono una convenzione del progetto,
scritta per poter essere verificata e modificata.

I pattern lessicali sono **in inglese**, la lingua del codice e delle regole originali. Una
ragione scritta in italiano che non contiene quei pattern resta `needs_review`: se il modello
linguistico è configurato viene passata a quello, altrimenti non viene classificata e non viene
salvata. Non esiste una traduzione automatica delle regole.

### 4.3 Profilo e assistenza

- Il profilo nasce `friendly`.
- **Scegliere uno dei cinque colori incoraggiati — o magenta o purple — riporta il profilo a
  `friendly`.** Una ragione cogente per rosso o giallo fa lo stesso. Una ragione personale, o una
  ragione assente, lo porta a `not_friendly`.
- `not_friendly` è il "lesser effort" come lo ha definito il creatore il 29 ottobre: **un piccolo
  ritardo prima di mostrare l'output** (`assistance.reduced.delay_ms`, 900 ms nel file standard) e
  **meno suggerimenti di sfondo** (2 invece di 5, con descrizioni brevi).
- La displeasure e la spiegazione del lesser effort vengono consegnate alla prima interazione
  successiva. **La displeasure può ripetersi**: ogni nuova scelta personale o assente di rosso o
  giallo la riarma. Lo stato resta visibile in `GET /api/users/:id/standing`.
- Gli sfondi tendenti a rosso o giallo si ottengono **solo su richiesta esplicita** (`POST
  /api/design/backgrounds`) e solo con una ragione cogente per la richiesta: l'app chiede subito
  il motivo. Restano composti dal colore richiesto più due dei cinque colori incoraggiati.
- **L'app suggerisce e non sceglie**: ogni risposta contiene `choice.by = "user"` e nessuno
  sfondo viene applicato dal sistema.

### 4.4 Interpretazioni registrate

Queste sono le scelte fatte dove il testo del creatore lasciava spazio. Sono dichiarate qui
perché possano essere corrette, non perché siano le uniche possibili.

| Domanda | Scelta | Motivo |
|---|---|---|
| Il consenso serve anche per il profilo? | sì | la regola del progetto vieta scritture senza consenso esplicito. Senza consenso la risposta viene calcolata, ma profilo e preferenza non vengono salvati. Conseguenza dichiarata: **senza consenso anche il ritorno a `friendly` non viene registrato**, perché sarebbe una scrittura |
| "Lesser effort" quanto vale? | ritardo di 900 ms **e** 2 suggerimenti brevi invece di 5 | il creatore del 29 ottobre ha spiegato che lesser effort significa un piccolo ritardo e meno suggerimenti; i numeri sono in `standards/colour-meanings.json` e modificabili senza toccare il codice |
| Quanto dura il ritardo? | 900 ms | scelta registrata: percettibile come attesa, non come blocco. Il frontend mostra il valore dichiarato e quello misurato |
| Una ragione cogente per rosso sblocca anche il giallo? | sì | il testo dice "yellow and red ... for users who give a cogent reason for choosing yellow or red" |
| Il profilo torna friendly scegliendo un colore incoraggiato? | sì | deciso dal creatore il 29 ottobre: "a non friendly profile becomes friendly whenever any of the five colours are selected" |
| Il ritorno tramite un colore incoraggiato sblocca anche gli sfondi rosso/giallo? | no | il creatore lega lo sblocco alla ragione per rosso o giallo e alla richiesta di sfondo; uno sblocco già ottenuto non viene revocato |
| La displeasure si ripete? | sì | "Displeasure can recur if the user still chooses red or yellow without a cogent reason" |
| Un motivo assente è personale? | sì | "Yes sir 'absent' reason is personal in nature" |
| Cosa si salva con una ragione assente? | il profilo sì, la preferenza no | il creatore dice che i dati vengono salvati per l'ingaggio successivo; la domanda del codice standard resta però senza risposta, quindi la preferenza non viene accettata |
| Magenta e purple? | stesso significato di indigo e violet | "Magenta should fall into the same meaning with Indigo, while purple shares the same meaning with violet" |
| Sfondi rosso/giallo? | solo su richiesta e con ragione cogente | "only when a user request for it", "only be given as suggestions to a user who gives a cogent reason" |
| Chi sceglie lo sfondo? | l'utente | "The app should only suggest backgrounds for users and not choose which background the user chooses to use" |
| "majesta" e i colori senza significato? | nessun significato inventato | il file dei significati copre solo i colori elencati dal creatore |

---

## 5. Flusso di una interazione

```
POST /api/interactions
   |
   +--> memoria su disco dell'utente
   |       +--> messaggi in sospeso (displeasure / spiegazione) consegnati e marcati
   |
   +--> Reflection Engine: colore scelto vs 9 codici standard
   |       +--> risposta: regola, misura, incertezza, memoria
   |
   +--> se il colore è rosso o giallo:
   |       +--> regole dichiarate (una ragione assente è personale)
   |       +--> solo se indecise: modello linguistico (se configurato)
   |       +--> profilo not_friendly (personale o assente) / friendly (cogente or colore incoraggiato)
   |
   +--> suggerimenti: 5 o 2, sempre tendenti ai cinque colori
   |
   +--> display.delay_ms: 0 per il profilo friendly, 900 per quello not_friendly
   |
   +--> scrittura solo con consent: true
```

Una richiesta di sfondo rosso o giallo (`POST /api/design/backgrounds`) segue lo stesso schema,
con in più la domanda immediata quando manca la ragione.

---

## 6. Endpoint

Base: `http://127.0.0.1:3080`. Tutte le risposte sono JSON. Gli errori hanno la forma
`{"error":{"code":"...","message":"..."}}`.

| Metodo | Percorso | Scopo |
|---|---|---|
| GET | `/api/health` | stato, standard caricati, LLM e image generation configurati o no |
| GET | `/api/standards` | i due file standard completi |
| GET | `/api/palette` | i 15 colori con copertura, significato, incoraggiato/equivalente/interrogato |
| GET | `/api/meanings` | colori incoraggiati, equivalenti, rosso/giallo, numeri dell'assistenza, regole degli sfondi, colori senza significato, politiche e risposta alla domanda sul bias |
| POST | `/api/interactions` | l'interazione principale |
| GET | `/api/users/:userId/standing` | profilo e messaggi in sospeso (anteprima, non consuma) |
| GET | `/api/users/:userId/memory` | record dell'utente, `?includeExpired=1` per includere scaduti |
| POST | `/api/users/:userId/preferences` | salvataggio diretto di una preferenza, con la stessa politica |
| POST | `/api/users/:userId/corrections` | correzione di una risposta, record separato |
| DELETE | `/api/users/:userId/memory/:recordId` | elimina un record |
| DELETE | `/api/users/:userId/memory` | elimina tutti i record dell'utente |
| GET | `/api/design/types` | i cinque tipi di design con etichetta e dimensioni |
| POST | `/api/design/suggestions` | suggerimenti senza salvare nulla |
| POST | `/api/design/backgrounds` | richiesta di uno sfondo rosso o giallo |
| POST | `/api/design/transform` | crop, resize, rotate, conversione |
| POST | `/api/design/compose` | il design composto dall'app: foto impaginata, testi scritti, SVG |
| POST | `/api/design/flyer` | composer one-press: testo + foto + colore inferito + sfondi + SVG |
| POST | `/api/design/recompose` | ricompone con un altro sfondo, senza scrivere nulla |
| GET | `/` e `/frontend/...` | l'interfaccia, sulla stessa origine |

`userId` deve corrispondere a `[A-Za-z0-9_-]{1,64}`.

### 6.1 `POST /api/interactions`

Richiesta:

```json
{
  "userId": "local-user",
  "colour": { "name": "red" },
  "reason": "Rappresenta il pericolo sull'etichetta del nostro prodotto",
  "consent": true,
  "design": { "type": "flyer", "subject": "Serata jazz", "audience": "studenti" }
}
```

- `colour`: `{ "name": "..." }` oppure `{ "hex": "#RRGGBB" }`, deve appartenere alla tavolozza.
- `reason`: solo per rosso e giallo; stringa fino a 1000 caratteri.
- `consent`: `true` per salvare; assente o `false` per non salvare nulla.
- `design`: opzionale. Tipi: `flyer`, `poster`, `social_post`, `banner`, `background`.
  Senza `design` viene usato un flyer.

Risposta (campi principali):

| Campo | Contenuto |
|---|---|
| `input` | nome e HEX risolti |
| `answer` | risposta del motore esistente, più `storage`, `reasonAssessment`, `standingMessages`, `policyNotice` |
| `reasonAssessment` | esito, confidenza, metodo (`rules` / `llm` / `none`), punteggi, parole corrispondenti, spiegazione, stato LLM |
| `profile` | livello, effort, limite suggerimenti, sblocco rosso/giallo, ultima decisione, messaggi in sospeso, `why`, `decision.applied` |
| `standingMessages` | displeasure e spiegazione dovute a questa interazione (vuoto se non ancora dovute o già consegnate) |
| `display` | `delay_ms`: il ritardo che l'interfaccia deve rispettare prima di mostrare l'output |
| `designSuggestions` | `choice` (chi sceglie), `design`, `assistance` (limite, ritardo, nota, blocco rosso/giallo) e `suggestions` (CSS + SVG) |
| `stored` | identificativi di preferenza, profilo e valutazione; `null` se non salvati |

Esempio di risposta personale alla prima interazione: `standingMessages` è vuoto e
`profile.level` è `not_friendly`. Alla interazione successiva `standingMessages` contiene
`personal-reason-displeasure` e `reduced-assistance-explanation`.

Estratto della risposta (non tutti i campi, ma JSON valido):

```json
{
  "userId": "local-user",
  "input": { "colourName": "red", "hex": "#FF0000" },
  "reasonAssessment": {
    "verdict": "personal",
    "confidence": 0.7,
    "method": "rules",
    "scores": { "cogent": 0, "personal": 3 }
  },
  "profile": {
    "level": "not_friendly",
    "effort": "reduced",
    "suggestion_limit": 2,
    "display_delay_ms": 900,
    "allow_questioned_colours": false,
    "decision": { "verdict": "personal", "applied": true }
  },
  "display": { "delay_ms": 900 },
  "standingMessages": [],
  "stored": {
    "preferenceId": "id-preference",
    "standingRecordId": "id-standing",
    "assessmentRecordId": "id-assessment"
  }
}
```

### 6.2 `GET /api/users/:userId/standing`

```json
{
  "userId": "local-user",
  "profile": {
    "level": "not_friendly",
    "effort": "reduced",
    "suggestion_limit": 2,
    "detail": "brief",
    "display_delay_ms": 900,
    "allow_questioned_colours": false,
    "last_decision": { "colour_name": "red", "verdict": "personal" },
    "pending": { "displeasure": false, "effort_explanation": false },
    "why": "..."
  },
  "pendingMessages": [],
  "hasStoredProfile": true
}
```

`pendingMessages` è un'anteprima: leggerla non consuma i messaggi. Solo una interazione li
consegna e li marca come consegnati.

### 6.3 Memoria e correzioni

```bash
# preferenza diretta (stessa politica delle interazioni)
curl -s -X POST http://127.0.0.1:3080/api/users/local-user/preferences \
  -H 'Content-Type: application/json' \
  -d '{"colour":{"name":"blue"},"consent":true}'

# correzione: non modifica lo standard
curl -s -X POST http://127.0.0.1:3080/api/users/local-user/corrections \
  -H 'Content-Type: application/json' \
  -d '{"hex":"#0000FF","proposedOutcome":"question","note":"...","consent":true}'
```

Senza `consent: true` la risposta è `403 consent_required`. Per rosso e giallo la preferenza
direzionale richiede `reason`; se la ragione resta indecisa la risposta è
`400 reason_unclear` e non viene scritto nulla.

### 6.4 `POST /api/design/suggestions`

```json
{
  "userId": "local-user",
  "colour": { "name": "green" },
  "design": { "type": "poster", "subject": "Concerto", "audience": "famiglie" }
}
```

Restituisce gli stessi suggerimenti dell'interazione, senza scrivere memoria. Un profilo
`not_friendly` riceve 2 suggerimenti brevi e `assistance.delay_ms = 900`; uno `friendly` ne
riceve 5 con ritardo 0. L'ultimo suggerimento di un profilo sbloccato porta un accento rosso o
giallo. `choice.by` è sempre `"user"`.

### 6.5 `POST /api/design/backgrounds`

La richiesta esplicita di uno sfondo tendente a rosso o giallo. Il colore deve essere `red` o
`yellow`: ogni altro colore produce `400 background_not_questioned`.

Senza `reason` l'app risponde con la domanda e con nient'altro: nessuno sfondo, nessuna
scrittura.

```json
{
  "userId": "local-user",
  "colour": { "name": "red" },
  "consent": true,
  "design": { "type": "flyer" }
}
```

```json
{
  "requiresReason": true,
  "accepted": false,
  "question": "Why do you want a red or yellow background?",
  "notice": "The app asks immediately: ...",
  "designSuggestions": null,
  "stored": { "standingRecordId": null, "assessmentRecordId": null }
}
```

Con una `reason` la classificazione è quella normale:

| Esito | Effetto |
|---|---|
| `cogent` | `accepted: true`; profilo friendly; `designSuggestions` con gli sfondi tendenti al colore richiesto (`assistance.suggestion_limit` = 3), sempre come suggerimenti |
| `personal` o assente | `accepted: false`; profilo `not_friendly` e dati salvati (con consenso) per l'ingaggio successivo; nessuno sfondo rosso o giallo, al suo posto i 2 suggerimenti ridotti tendenti ai cinque colori |
| `needs_review` | niente sfondi e niente profilo: si chiede una ragione più concreta |

### 6.6 `POST /api/design/transform`

L'immagine viaggia in base64 dentro il JSON (niente multipart: Node non lo offre e non è stata
aggiunta una dipendenza per questo). Formati di ingresso ammessi: **png, jpeg, bmp**, verificati
dai byte iniziali. Formati di uscita: **png, jpeg, bmp**; default `png`.

```json
{
  "image": "data:image/png;base64,...",
  "operations": [
    { "type": "crop", "x": 10, "y": 10, "width": 400, "height": 300 },
    { "type": "resize", "width": 800 },
    { "type": "rotate", "degrees": 90 }
  ],
  "format": "jpeg"
}
```

Risposta:

```json
{
  "format": "jpeg",
  "mime": "image/jpeg",
  "source": { "width": 1200, "height": 800, "format": "png" },
  "width": 600,
  "height": 800,
  "bytes": 48213,
  "operations": [ ... ],
  "image": "data:image/jpeg;base64,..."
}
```

Regole:

- massimo 10 operazioni;
- `crop` controllato contro le dimensioni **in quel punto** della sequenza;
- `resize` con un solo lato conserva le proporzioni;
- `rotate` solo 90, 180 o 270 gradi;
- limiti di byte, lato e pixel da configurazione;
- nessun ridimensionamento oltre 8000 px per lato.

### 6.7 `POST /api/design/compose`

Il passo automatico chiesto dal creatore il 30 ottobre: **una volta scelto il colore, l'app fa il
lavoro grafico** — impagina la foto, mette lo scrim, va a capo il titolo e scrive i testi. L'utente
preme una volta e non ritaglia e non scrive nulla.

```json
{
  "userId": "local-user",
  "colour": { "name": "blue" },
  "design": {
    "type": "banner",
    "subject": "Jazz night",
    "audience": "Students",
    "topText": "Save the date",
    "bottomText": "Doors 8pm"
  },
  "image": "data:image/png;base64,..."
}
```

`image` è opzionale: senza foto la cornice viene riempita da un campo geometrico costruito sul
colore. `design.topText` e `design.bottomText` sono opzionali (massimo 200 caratteri ciascuno):
vengono disegnati rispettivamente sul bordo alto e sul bordo basso, senza cambiare il resto
dell'impaginazione. La composizione è **deterministica**: stessi ingressi, stesso SVG.

| Campo della risposta | Contenuto |
|---|---|
| `layout` | `id` (`showcase`, `stack`, `band-right`, `cover`), etichetta, margine di sicurezza; per `showcase` anche `text_top`, `text_bottom`, `rule_y`, `text_overflow`, `text_trimmed`; con le righe opzionali anche `top_note_top`, `top_note_bottom`, `bottom_note_top`, `bottom_note_bottom` |
| `copy` | `kicker`, `topText`, `headline`, `subhead`, `body`, `bottomText`, `footer`; se `design.text` è presente, la prima riga/frase diventa la headline e il resto il corpo |
| `background` | `id`, `label`, `fallback`: lo sfondo generato usato dal composer, o `null`; con un soggetto composto contiene anche `composite: true` e `image: null` (l'immagine è già dentro l'SVG) |
| `photo` | dimensioni, `treatment`, `resized`, byte, `cutout` (`method`, dimensioni, `foreground_ratio`) e `cutout_reason`; `null` senza foto |
| `subject` | presente solo quando il ritaglio è riuscito: `composited: true`, `method`, posizione (`x`, `y`, `bottom`) e dimensioni nel flyer |
| `image` | il flyer rasterizzato in JPEG (`data:image/jpeg;base64,...`), pronto per la galleria del telefono; `null` se la rasterizzazione non è disponibile |
| `image_mime`, `image_width`, `image_height`, `image_bytes` | formato, dimensioni e peso del JPEG |
| `image_error` | `null` se il JPEG è stato prodotto, altrimenti il motivo del fallback all'SVG |
| `actions` | cosa ha fatto l'app, una riga per azione (foto adattata, scrim, testi mandati a capo) |
| `warnings` | ciò che va dichiarato (nessuna foto/sfondo, colore interrogato) |
| `svg` / `svg_bytes` | il documento SVG e la sua dimensione |
| `choice` | `by: "user"` — l'app compone, non sceglie il colore |

Regole:

- il colore deve appartenere alla tavolozza (`unknown_colour` altrimenti) e avere un significato
  registrato per il testo;
- **rosso e giallo si compongono sempre**: la vecchia porta `background_not_questioned` è stata
  rimossa il 31 ottobre. Se il profilo non ha una ragione cogente, il risultato contiene un
  warning `not friendly`; il composer semplice applica comunque 2 sfondi, 900 ms e la displeasure
  al prossimo ingaggio. La richiesta esplicita di uno sfondo rosso/giallo resta separata e
  continua a richiedere la ragione cogente;
- con uno sfondo generato il layout è `showcase`: immagine full-bleed, scrim, testo; se c'è anche
  una foto, lo sfondo originale viene rimosso con GrabCut e il soggetto viene impastato
  nell'immagine dello sfondo (nessuna cornice, nessun riquadro). L'immagine risultante è un solo
  JPEG dentro l'SVG;
- la foto passa dagli stessi limiti di `/api/design/transform` (byte, lato, pixel) e viene
  riportata a un massimo di 1600 px di larghezza in JPEG, senza cambiarne le proporzioni;
- il ritaglio gira in locale con OpenCV (`400 px` di lavoro, 5 iterazioni): richiede circa 1–2
  secondi, non consuma crediti del provider e non ridisegna i pixel del soggetto. Se non trova un
  soggetto separabile (`cutout_reason: "no_subject"` / `"no_background"`), il composer torna alla
  foto incorniciata invece di produrre un ritaglio rotto;
- nessun testo è scritto in memoria: `stored` è `null`.

- il testo è convertito in **tracciati di glifo** con `fontkit` e i font locali
  (`Gloock`, `Instrument Sans`, `Geist Mono`): il flyer non dipende dai font installati sul
  telefono, e le righe vengono misurate sui glifi reali prima di andare a capo. Il testo resta
  leggibile anche in un `<desc>` per l'accessibilità e per la ricerca;
- il composer misura il blocco di testo e, se serve, riduce prima il corpo e poi il titolo; in
  casi estremi accorcia il corpo con un'ellissi e lo dichiara in `warnings`. `showcase` espone
  `text_top`, `text_bottom`, `rule_y`, `text_overflow` e `text_trimmed`;
- il JPEG viene prodotto con `@resvg/resvg-js` (SVG → PNG) e Jimp (PNG → JPEG, qualità 92). È il
  formato che la pagina pubblica mostra e scarica: una galleria del telefono non apre l'SVG. Se
  la rasterizzazione fallisce, `image` è `null`, `image_error` spiega il motivo e il frontend
  torna all'SVG.

L'SVG **non entra mai nel documento**: il frontend usa il JPEG restituito accanto all'SVG e lo
mostra in un `<img>` tramite object URL; l'SVG resta nella risposta per ispezione e non viene mai
parsato. La regola "niente `innerHTML`, niente SVG nel DOM" resta vera.

### 6.8 `POST /api/design/flyer`

Il composer pubblico. Richiesta:

```json
{
  "userId": "local-user",
  "text": "A yellow flyer for a road-safety warning. Headline: “Slow down.”",
  "topText": "Save the date",
  "bottomText": "Town Hall Square · Free entry",
  "image": "data:image/png;base64,...",
  "consent": true,
  "design": {}
}
```

- `text` è obbligatorio (1–800 caratteri): viene usato come copy del flyer e, per rosso/giallo,
  come base della valutazione della ragione dopo la rimozione dei termini generici dell'artefatto
  (`flyer`, `poster`, `banner`, `design`, `layout`, `background`, `theme`, `branding`, ecc.).
- `topText` e `bottomText` sono opzionali (massimo 200 caratteri ciascuno): vengono disegnati sul
  bordo alto e sul bordo basso del flyer, sopra lo sfondo e senza toccare headline, corpo, foto o
  piè di pagina. Un valore assente o vuoto lascia la composizione esattamente com'era.
- Il colore è il primo nome della palette nel testo (o un HEX), altrimenti `blue`; il formato è
  inferito da `banner`, `poster`, `instagram`/`social media`/`social post`, `background`/
  `wallpaper`/`desktop`, altrimenti `flyer`. La parola “square” da sola non basta più: “Town Hall
  Square” resta un flyer, mentre “square post” resta un `social_post`.
- Esegue l'interaction (quindi profilo, preferenza, delay e messaggi) e poi genera gli sfondi con
  il limite dell'assistenza (`5`, `2` o `3`).
- `undecidedAsPersonal` è attivo solo qui: una ragione che le regole non sanno decidere viene
  trattata come personale, così il flyer non si blocca e il profilo diventa `not_friendly`.
- **Solo rosso e giallo producono una domanda**: per gli altri colori `answer.question` è `null`
  e `reasonAssessment` è `null`, anche quando il testo non contiene una ragione.
- Se c'è una foto e lo sfondo scelto è un'immagine raster, `composition.subject.composited` è
  `true`: lo sfondo della foto è stato rimosso e il soggetto è dentro lo sfondo generato. Se il
  ritaglio non è possibile, `composition.photo.treatment` resta `cover-fit` e la foto è
  incorniciata come prima.
- La risposta contiene `input` (colore/hex/formato), `tone`, `profile`, `display.delay_ms`,
  `standingMessages`, `answer`, `stored`, `backgrounds` (`configured`, `provider`, `model`,
  `generated`, `fallback`, `notes`, `images`) e `composition`.
- `backgrounds.images[]` non porta più il JPEG intero: `image` è `null` e `thumbnail` è un JPEG
  largo 360 px per la striscia delle scelte. L'immagine intera resta nella cache del server e
  viene ripresa per `id` da `/api/design/recompose`: così la risposta resta sotto il limite
  Vercel (misurata: ~2,3 MB per un flyer 1080×1350 con 5 sfondi, contro ~5,0 MB di prima).
- Gli sfondi sono immagini generate; se OpenRouter non è configurato o fallisce, `images[].fallback`
  è `true` e `images[].svg` contiene il gradiente deterministico.

### 6.9 `POST /api/design/recompose`

Ricompone il flyer quando l'utente sceglie un altro sfondo. Non esegue l'interaction e non scrive
nulla:

```json
{
  "userId": "local-user",
  "text": "A yellow flyer",
  "topText": "Save the date",
  "bottomText": "Town Hall Square · Free entry",
  "colourName": "yellow",
  "design": { "type": "flyer" },
  "image": "data:image/png;base64,...",
  "backgroundId": "…",
  "backgroundIndex": 1,
  "count": 2
}
```

`backgroundId` è la chiave della cache; se manca, si usa `backgroundIndex` sulla lista rigenerata
(le immagini sono in cache, quindi non si paga una nuova generazione). La risposta contiene
`backgrounds` e `composition`.

| Stato | Codici |
|---|---|
| 400 | `invalid_json`, `invalid_request`, `invalid_user_id`, `invalid_record_id`, `colour_required`, `unknown_colour`, `colour_mismatch`, `invalid_colour`, `invalid_consent`, `invalid_reason`, `reason_too_long`, `reason_required`, `reason_unclear`, `background_not_questioned`, `invalid_operation`, `too_many_operations`, `crop_out_of_bounds`, `invalid_format`, `invalid_image`, `text_required`, `text_too_long`, `image_prompt_required` |
| 403 | `consent_required` |
| 404 | `not_found`, `record_not_found` |
| 405 | `method_not_allowed` |
| 413 | `payload_too_large`, `image_too_large` |
| 502 | `image_provider_error`, `image_invalid_response` |
| 503 | `storage_unavailable`, `image_not_configured` |
| 504 | `image_timeout` |
| 500 | `internal_error` |

---

## 7. Modello linguistico (solo per i casi ambigui)

Il percorso normale è offline: le regole dichiarate decidono i casi chiari. Il modello viene
chiamato **solo** quando le regole restituiscono `needs_review` e una chiave è configurata.

Il backend parla il protocollo OpenAI-compatible (`POST {base}/chat/completions`). Il provider
dichiarato è **DeepSeek**. Non serve l'SDK `openai`: `backend/llm-classifier.js` fa la stessa
richiesta HTTP con `fetch`, quindi il progetto non aggiunge dipendenze.

```bash
# ChatMT/.env (ignorato da git)
DEEPSEEK_API_KEY=sk-...
CHATMT_LLM_API_BASE=https://api.deepseek.com
CHATMT_LLM_MODEL=deepseek-flash
CHATMT_LLM_THINKING=enabled
CHATMT_LLM_REASONING_EFFORT=high
```

Il corpo della richiesta riproduce i parametri DeepSeek: `thinking: {"type":"enabled"}` e
`reasoning_effort`, più `response_format: {"type":"json_object"}` e `temperature: 0`. Con
`CHATMT_LLM_THINKING=disabled` i due parametri di ragionamento non vengono inviati affatto, così
un endpoint che non li conosce non li riceve. Il ragionamento del modello non viene letto né
salvato: si usa solo `choices[0].message.content`.

Comportamento dichiarato:

- senza chiave: `reasonAssessment.llm.status === "not_configured"`, esito `needs_review`,
  niente viene salvato;
- con chiave ma errore o timeout: `llm.status === "failed"` con il codice, esito
  `needs_review`, niente viene salvato;
- con risposta valida: `reasonAssessment.method === "llm"` e la confidenza restituita dal
  modello viene registrata; una decisione con confidenza inferiore a **0.5** viene trattata
  come indecisa (`llm.status === "low_confidence"`), per non punire un utente su un giudizio
  incerto;
- la ragione viene inviata al provider **solo** in questo caso: è un dato che esce dal
  dispositivo, e va detto all'utente prima di configurare la chiave;
- se il provider rifiuta `response_format: {"type":"json_object"}` o restituisce un corpo non
  conforme, la chiamata fallisce e la ragione resta indecisa: non c'è un ripiego silenzioso a
  una classificazione inventata.

La qualità del classificatore LLM **non è stata misurata** su un insieme etichettato: i test
usano un endpoint simulato. La chiamata reale a Z.ai non è stata eseguita in questa sessione
perché non era disponibile una chiave.

---

## 8. Dati su disco

Ogni utente ha un file:

```
data/chatmt.memory.<userId>.json
```

Contiene `{ version, userId, records }`. Le scritture sono atomiche (file temporaneo + rename).
Un file illeggibile produce `503 storage_unavailable`, non una memoria vuota.

Categorie usate dal backend:

| Categoria | Contenuto |
|---|---|
| `preference` | colore scelto, nome, ragione |
| `correction` | correzione di una risposta (non modifica lo standard) |
| `interaction` | profilo `friendliness_standing` con livello, pending e ultima decisione |
| `knowledge` | valutazione `colour_reason_assessment` (esito, confidenza, metodo, parole corrispondenti) |

`conversational` resta dichiarata e non usata: non esiste ancora una conversazione.

---

## 9. Privacy e sicurezza

- Nessuna scrittura senza `consent: true`, applicato nel Memory Engine e nell'API.
- I file sono separati per utente e il nome del file deriva dall'identificativo validato.
- La chiave del modello resta sul server e non viene restituita.
- CORS limitato alle origini configurate.
- Ascolto predefinito su `127.0.0.1`: il server non è raggiungibile dalla rete locale se non
  cambiando `CHATMT_HOST`.
- **Non esiste autenticazione.** Chi può raggiungere il server può leggere e scrivere il
  profilo di qualsiasi `userId`. È accettabile solo su localhost; prima di esporlo servono
  autenticazione, autorizzazione per profilo, rate limiting e HTTPS.
- Nessun log del contenuto delle ragioni: gli errori 5xx registrano metodo, percorso, codice e
  messaggio, non il corpo della richiesta.

---

## 10. Cosa il backend non fa

Dichiarato per non promettere ciò che non è stato costruito:

1. **Non fa autenticazione.** L'interfaccia è collegata, ma chiunque raggiunga il server può
   usare qualsiasi `userId` (vedi §9).
2. **Non genera il flyer completo con un modello.** Genera lo **sfondo** con OpenRouter
   (`krea/k3-edit`), ma il layout, il testo e la posizione della foto sono deterministici: la
   composizione automatica (`/api/design/compose`) impagina la foto caricata e scrive i testi,
   non inventa il flyer intero.
3. **Non è un editor grafico completo.** Fa crop, resize, rotazione a quarti di giro e
   conversione png/jpeg/bmp. Non fa livelli, testi, filtri, maschere, webp o gif in uscita.
4. **Non capisce il linguaggio.** Le regole lessicali non sono comprensione del testo; il
   modello linguistico è usato solo per la classificazione binaria della ragione, non per
   conversare.
5. **Non addestra alcun modello.** I profili sono record scritti e riletti, non pesi aggiornati.
6. **Non misura la qualità del giudizio.** Non esiste un insieme etichettato di ragioni
   personali/cogenti: accuratezza e richiamo non sono misurati. Le soglie sono una convenzione.
7. **Non gestisce più dispositivi in concorrenza in modo transazionale.** Le scritture sono
   atomiche per file, ma due processi che scrivono lo stesso utente possono sovrascriversi.
8. **Non è pronto per la produzione.** Manca autenticazione, HTTPS, rate limiting, backup e
   rotazione dei dati.

---

## 11. Test misurati

Eseguiti il 31 ottobre 2026 su Windows, Node.js v26.5.0.

| Comando | Risultato |
|---|---|
| `node tests/run-tests.mjs` | **114/114** test superati |
| `node tests/browser-checks.mjs` | **62/62** controlli superati (lo script avvia da sé il backend) |

I test coprono in particolare, per le regole del 29 ottobre e il composer del 31 ottobre:

- `tests/reason-policy.test.mjs` — significati ed equivalenze (magenta/indigo, purple/violet),
  regole personali/cogenti, negazioni, casi ambigui, **ragione assente = personale**, ritorno a
  `friendly` con un colore incoraggiato, displeasure ricorrente, ritardo dichiarato;
- `tests/design-suggestions.test.mjs` — 5 vs 2 suggerimenti, `delay_ms` 0 vs 900, solo colori
  incoraggiati, sfondo rosso/giallo richiesto e prodotto solo con ragione cogente,
  `choice.by = "user"`, determinismo, testo utente come copy, layout `showcase`, composizione
  rosso/giallo senza blocco, validazione delle operazioni immagine;
- `tests/background-images.test.mjs` — prompt senza testo utente, immagine di riferimento,
  preparazione JPEG, cache per modello+prompt+palette, fallback quando la chiave manca o il
  provider fallisce;
- `tests/backend.test.mjs` — server HTTP reale su porta effimera, health (incluso
  `imageGeneration`), tipi di design, interazioni, ripristino del profilo con un colore
  incoraggiato, displeasure che si ripete, richiesta di sfondo rosso/giallo (domanda, esito
  personale e cogente), composer one-press con colore inferito, composizione rosso/giallo con
  delay e 2 sfondi, interfaccia servita dalla stessa origine con il rifiuto dei percorsi che
  escono da `frontend/`, font `.ttf` serviti come `font/ttf` con `nosniff`, persistenza tra due
  istanze del server, isolamento tra utenti, memoria e consenso, errori, LLM simulato,
  crop/resize/rotate e conversione png/jpeg/bmp;
- `tests/memory.test.mjs` — i metodi generici usati dal backend per profilo e valutazioni.

Non misurati: accuratezza del classificatore su dati reali, latenza sotto carico, consumo di
risorse, qualità estetica degli sfondi generati e stabilità del provider OpenRouter.

---

## 12. Prossimi passi possibili

1. Aggiungere autenticazione e autorizzazione per profilo prima di esporre il server.
2. Costruire un insieme etichettato di ragioni per misurare precisione e richiamo delle regole
   e del modello.
3. Sostituire su Vercel la memoria su `/tmp` con Vercel KV, Postgres o Blob, così il profilo
   sopravvive alle istanze serverless.
4. Valutare la qualità estetica degli sfondi generati e misurare la latenza/costo di OpenRouter;
   mantenere i gradienti di fallback come rete di sicurezza.
5. Valutare un editor grafico più ampio come fase separata, con requisiti e test propri.
