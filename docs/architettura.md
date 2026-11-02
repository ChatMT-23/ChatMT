# ChatMT — Architettura (Fase 2 e backend)

- **Stato:** implementata e verificata (114 test automatici + 62 controlli nel browser)
- **Data:** 26 ottobre 2026 (fase 2), 28 ottobre 2026 (backend), 29 ottobre 2026 (regole nuove, interfaccia sulle API, redesign “Ink Register” e passata di correzione), 31 ottobre 2026 (composer semplice, sfondi generati, ritaglio del soggetto, Vercel), 1 novembre 2026 (testo in tracciati, impaginazione misurata, export JPG)
- **Ambito:** confronto di un colore scelto dalla tavolozza con i codici standard, memoria delle preferenze e delle correzioni, giudizio della ragione per rosso/giallo, profilo friendly/not_friendly con ritardo e displeasure ricorrente, suggerimenti grafici e sfondi generati, operazioni immagine, composer “Create your flyer” con rimozione dello sfondo della foto e compositing del soggetto, testo convertito in tracciati per un'impaginazione identica su telefono e server, export JPEG, interfaccia servita dallo stesso server delle API e deploy Vercel static + serverless

> Il §1 descrive la fase 2, che resta valida per i moduli e non è stata riscritta. Il backend
> aggiunge i pezzi del §8 e sostituisce la decisione "nessun backend" del §4, che valeva per
> quella fase. Da questa versione **l'interfaccia non usa più `localStorage`**: legge e scrive
> solo attraverso le API, quindi il §1 va letto con il §8.6 come sorgente dei dati.

---

## 1. Vista d'insieme

```
input utente (colore scelto dalla tavolozza)
   |
   v
[frontend/js/app.js]  interfaccia: nessuna logica di colore, nessuna regola
   |
   v
[modules/reflection/reflection-engine.js]
   |  caratteristiche misurabili  ->  standard pertinenti  ->  distanze  ->  contraddizioni  ->  incertezza  ->  contesto dalla memoria
   v
[modules/response/response-engine.js]
   |  risposta: misura, regola applicata, giudizio, dati usati, incertezza, domanda
   v
[frontend]  mostra la risposta e chiede il consenso per memorizzare
   |
   v
[modules/memory/memory-store.js]  record di preferenza o di correzione
```

Regola di separazione applicata ovunque: **il calcolo vive nei moduli, l'interfaccia non calcola nulla**. Se una funzione matematica fosse scritta dentro `app.js`, non sarebbe verificabile senza un browser.

---

## 2. Moduli e interfacce

| Modulo | Responsabilità | Interfaccia pubblica |
|---|---|---|
| `modules/color_engine/color-space.js` | conversioni e distanza percettiva | `isValidHex(hex)`, `normaliseHex(hex)`, `hexToRgb(hex)`, `rgbToHex(rgb)`, `srgbToLinear(c)`, `rgbToXyz(rgb)`, `xyzToLab(xyz)`, `rgbToLab(rgb)`, `hexToLab(hex)`, `deltaE2000(lab1, lab2)`, `deltaE2000Hex(hex1, hex2)`, `InvalidColourError`, `D65` |
| `modules/color_engine/color-engine.js` | rappresentazione strutturata e descrizione della misura | `createColour(hex, name)`, `compareColours(a, b)`, `describeDistance(deltaE)`, `describeMeasurement(deltaE)`, `rgbToCss(rgb)`, `DISTANCE_BANDS` |
| `modules/color_engine/palette.js` | la tavolozza mostrata, con l'indicazione di ciò che è coperto da uno standard | `PALETTE`, `coveredColours()`, `uncoveredColours()` |
| `modules/reflection/reflection-engine.js` | confronto input ↔ standard ↔ memoria | `createReflectionEngine({ standards })` → `{ reflect(input, { memory }) }`, `INPUT_TYPES`, `UNCERTAINTY`, `LABEL_VALUE_TOLERANCE`, `UnsupportedInputError` |
| `modules/response/response-engine.js` | costruzione della risposta | `buildResponse(reflection)` |
| `modules/memory/memory-store.js` | memoria persistente con consenso | `new MemoryStore({ adapter, userId, now, idFactory })`, `addPreference`, `addCorrection`, `updatePreference`, `get`, `list`, `listPreferences`, `currentPreference`, `correctionsFor`, `delete`, `clear`, `count`, `isExpired`, `CATEGORIES`, `CONFIRMATION`, `ConsentRequiredError`, `RecordNotFoundError`, `createVolatileAdapter()` |

### Forma del risultato della riflessione

```js
{
  input:      { type, hex, name },
  features:   { hex, rgb, lab, name },          // rappresentazione strutturata
  standards:  { id, version, ruleCount },
  coverage:   'covered' | 'uncovered',
  rule:       { id, colour_name, hex, outcome, question, source_text } | null,
  distanceToRule: number | null,
  nearest:    { rule, deltaE },                 // lo standard più vicino, anche quando non è pertinente
  contradictions: [{ code, severity, message }],
  uncertainty:    { level: 'low'|'medium'|'high', reasons: [string] },
  memory:     { used, preference, comparison, corrections, correction }
}
```

### Forma della risposta

```js
{
  headline, paragraphs[], judgement,
  measurement: { deltaE, band, sentence, comparedWith } | null,
  appliedRules[], nearestStandard, dataUsed[],
  contradictions[], uncertainty,
  question, needsClarification,
  storage: { permitted, confirmation, requiresQuestionAnswer, explanation },
  coverage
}
```

La risposta **non contiene una catena di ragionamento**: contiene i dati usati, le regole applicate, il livello di incertezza e le sue motivazioni. È ciò che il §7 del brief chiede di mostrare.

---

## 3. Modello dei dati di memoria

Ogni record, con i campi richiesti dal §3 del brief:

```js
{
  id,                              // identificativo
  category,                        // categoria (vedi sotto)
  user_id,                         // separazione tra utenti
  content,                         // contenuto
  origin,                          // origine
  created_at, updated_at,          // date
  confidence,                      // attendibilità (0..1)
  expires_at,                      // scadenza, null = nessuna
  confirmation,                    // 'confirmed' | 'unconfirmed'
  consent: true                    // consenso esplicito senza il quale il record non esiste
}
```

Contenuto di una preferenza: `{ kind: 'colour', hex, name, reason }`, dove `reason` è la risposta dell'utente alla domanda richiesta da una regola (per esempio "Why did you choose Red?").

Contenuto di una correzione: `{ kind: 'colour_outcome_correction', hex, name, target_standard_id, proposed_outcome, note }`.

### Categorie

| Categoria | Uso in questa fase |
|---|---|
| `preference` | **usata** — il colore preferito |
| `correction` | **usata** — la correzione di una risposta |
| `conversational` | dichiarata, **non scritta** (non c'è ancora conversazione) |
| `knowledge` | dichiarata, **non scritta** (non c'è ancora estrazione di conoscenza) |
| `interaction` | dichiarata, **non scritta** (non c'è ancora valutazione degli esiti) |

Le tre categorie non usate sono dichiarate nel codice e mostrate nell'interfaccia come non usate: nessuna funzione finta è stata scritta per loro.

### Adattatore di archiviazione

Il magazzino non conosce il browser: riceve un `adapter` con `getItem`, `setItem`, `removeItem`. Nei test è un `Map` in memoria (`createVolatileAdapter()`); il backend usa l'adattatore su file. In fase 2 l'interfaccia usava `window.localStorage`; da questa versione non lo usa più, ma il modulo resta lo stesso e lo stesso contratto vale per il file su disco.

---

## 4. Decisioni tecniche e motivi

| Decisione | Motivo | Alternativa scartata |
|---|---|---|
| HTML + CSS + JavaScript vanilla **per il frontend**, nessuna dipendenza, nessun passo di build | il creatore conosce HTML e CSS; il primo modulo è aritmetica deterministica; il §6 del brief chiede componenti semplici e verificabili | framework frontend, che avrebbe aggiunto dipendenze e un passo di build senza risolvere alcun problema di questa fase |
| Nessun backend **in fase 2** | non serviva a quella fase: la memoria locale bastava. Un backend diventa necessario per la memoria condivisa, un modello linguistico via API, immagini e audio | server Python fin dall'inizio, che avrebbe aggiunto codice non verificabile in quella fase. **Superata dalla fase backend: vedi §8** |
| Gli standard stanno in un file JSON letto con `fetch` | il file resta modificabile a mano senza toccare il codice, e potrà essere letto anche da un backend futuro | incorporare gli standard nel JavaScript dell'interfaccia, che avrebbe imposto di duplicare i dati |
| L'applicazione va servita via HTTP | i moduli ES e `fetch` non funzionano da `file://`; è un vincolo del browser, non una scelta | aprire `index.html` con doppio clic, che mostra un messaggio di errore con l'istruzione da eseguire |
| Ogni nome di colore è ancorato al valore CSS omonimo | è un valore pubblico e verificabile; evita di scegliere a caso, per esempio, cosa sia "green" (`#008000`, non `#00FF00`) | valori inventati dal progetto |
| Le bande di distanza (`DISTANCE_BANDS`) sono una convenzione del progetto | servono a tradurre un numero in una frase; l'unico appiglio preso dalla letteratura è che ΔE00 ≈ 1 è la differenza appena percepibile | presentare le bande come se fossero misure scientifiche |
| Tolleranza di 1.0 tra etichetta e valore misurato | sotto la differenza appena percepibile, etichetta e valore si considerano lo stesso colore | tolleranza inventata senza riferimento |
| Memorizzare richiede un consenso **e** un clic esplicito | il §3 del brief vieta di usare automaticamente ogni correzione o selezione come modifica permanente; il confronto con la preferenza precedente deve restare visibile | memorizzare automaticamente alla selezione, che avrebbe reso invisibile il confronto |
| Il consenso si richiede di nuovo a ogni ricaricamento | il consenso non è un dato da conservare di nascosto; la casella compare non selezionata | consenso pre-selezionato o memorizzato |
| Un colore non coperto può essere memorizzato solo come osservazione **non confermata** | il sistema non deve dichiarare "accettato" ciò che nessun codice copre; il campo `confirmation` esiste proprio per questo | rifiutare del tutto la memorizzazione, che avrebbe perso l'informazione che l'utente ha scelto quel colore |
| Una correzione non cambia lo standard | il §3 del brief lo vieta esplicitamente; la contraddizione viene mostrata e resta visibile | applicare la correzione allo standard automaticamente |
| Un solo profilo locale (`local-user`) nell'interfaccia | il §7 del brief non richiede la gestione di più profili in questa fase | un selettore di profili, funzione non richiesta |
| Nessun altro input accettato oltre al colore | il campo di applicazione è stato deciso dal creatore: solo la tavolozza. Altri tipi sollevano `UnsupportedInputError` invece di essere interpretati in modo approssimativo | interpretare il testo che nomina un colore, che avrebbe richiesto un modello linguistico assente |

---

## 5. Estensioni previste (Fasi 3, 4, 5)

I punti di innesto sono già definiti, così le fasi successive non dovranno riscrivere questa:

- **Testo** — un Text Engine dovrà produrre lo stesso input accettato da `reflect()` (un tipo nuovo in `INPUT_TYPES` con le sue caratteristiche misurate) e nuovi standard nel formato di `standards/`. Richiede un modello linguistico: API o modello locale.
- **Immagini** — un Image Engine dovrà estrarre un colore dominante o caratteristiche confrontabili con gli standard, e dichiarare l'incertezza del modello usato.
- **Audio** — un Audio Engine dovrà trascrivere e collegare il testo al contesto; il tono della voce non dovrà essere presentato come prova certa dello stato emotivo.
- **Memoria** — `knowledge` e `interaction` sono ora usate dal backend per la valutazione della ragione e per il profilo; `conversational` resta dichiarata e non usata.
- **Backend** — **implementato** (vedi §8): memoria su file, API HTTP, classificatore LLM opzionale, suggerimenti e operazioni immagine.

---

## 6. Limiti noti (dichiarati, non nascosti)

1. **Un solo insieme di standard**, di 9 regole: qualunque colore fuori da quei 9 è "non coperto", e il sistema non può dire altro che questo.
2. **Le correzioni sono confrontate per valore HEX esatto.** Una correzione su `#00FF00` non si applica a `#00FE01`, che dista 0.4: la corrispondenza per prossimità non è implementata.
3. **I livelli di incertezza sono regole, non probabilità.** "high" significa "esiste una condizione dichiarata nel codice", non un valore statistico.
4. **Le bande di distanza sono una convenzione**, non una misura di quanto piaccia un colore.
5. **La memoria non conserva la conversazione**, solo preferenze e correzioni.
6. **Nessuna ricerca o indicizzazione**: i record sono pochi e vengono filtrati linearmente.
7. **La latenza mostrata nell'interfaccia vale per questa sessione e questo dispositivo**, non è un benchmark.
8. **Nessuna verifica di accessibilità automatica** è stata eseguita: sono state usate etichette `aria`, testo alternativo per i colori e contrasto, ma non è stata misurata con strumenti dedicati né provata con uno screen reader.
9. **Il confronto è su un monitor sRGB.** Su schermi diversi o con colori fuori gamut i valori sono gli stessi, la percezione no.

---

## 7. Privacy e consenso

- Nessuna scrittura senza `consent === true`: il controllo è nel Memory Engine, non solo nell'interfaccia, quindi vale anche per un uso futuro da script.
- I record sono separati per `user_id` e la chiave di archiviazione contiene l'identificativo dell'utente.
- `clear()` elimina tutti i record dell'utente corrente e rimuove la voce dall'archivio.
- **Frontend:** nessun dato è tenuto dal browser: la pagina non ha più un archivio proprio, non
esiste alcuna chiave API nel browser e non c'è alcun percorso `localStorage`. L'utente viene
scelto con `?user=`, quindi cambiarlo cambia la memoria consultata.
- **Backend:** i dati restano in `data/chatmt.memory.<userId>.json`. Se viene configurata una chiave, solo la ragione ambigua viene inviata al provider LLM; senza chiave nessun testo esce dalla macchina. Il backend non ha autenticazione e va usato su localhost (vedi §8.5).
- Se l'archivio è illeggibile, il sistema **solleva un errore** invece di mostrare una memoria vuota: un dato danneggiato non deve sembrare un dato assente.

---

## 8. Backend (fase 2.5)

### 8.1 Vista d'insieme

```
POST /api/interactions
   |
   v
[backend/server.js]  routing, validazione, CORS, mappatura degli errori
   |
   v
[backend/services/interaction-service.js]
   |  messaggi in sospeso -> reflect() -> buildResponse()
   |  -> reason-assessment (regole) -> llm-classifier solo se indeciso
   |  -> standing-engine (decisione) -> design-suggestions
   v
[modules/memory/memory-store.js] + [backend/storage/file-adapter.js]
   |  preferenza, correzione, profilo (interaction), valutazione (knowledge)
   v
data/chatmt.memory.<userId>.json
```

La regola di separazione resta la stessa: il calcolo e le decisioni vivono nei moduli, il server
fa routing e validazione, l'interfaccia non calcola nulla. Anche il **ritardo** del lesser effort
viene dichiarato dal server (`display.delay_ms`) e solo applicato dal browser.

### 8.2 Moduli aggiunti

| Modulo | Responsabilità | Interfaccia pubblica |
|---|---|---|
| `modules/meaning/colour-meanings.js` | indicizza e valida i significati, dichiara i colori senza significato | `createMeaningIndex(standard, {palette})` → `encouraged`, `questioned`, `assistance`, `representationFor`, `isEncouraged`, `isQuestioned`, `coloursWithoutMeaning`, `buildBiasExplanation` |
| `modules/reflection/reason-assessment.js` | regole dichiarate per la ragione | `assessReasonWithRules({colourName, reason})`, `VERDICTS`, `METHODS`, `PERSONAL_MARKERS`, `COGENT_MARKERS`, `DECISION_THRESHOLDS` |
| `modules/policy/standing-engine.js` | transizioni del profilo e messaggi differiti | `createDefaultStanding`, `normaliseStanding`, `applyDecision`, `applyAssessment`, `DECISION_VERDICTS`, `collectEngagementMessages`, `assistanceFor`, `summaryOf` |
| `modules/policy/design-suggestions.js` | sfondi deterministici tendenti ai cinque colori, e sfondi richiesti | `buildDesignSuggestions`, `buildRequestedBackgroundSuggestions`, `normaliseDesignContext`, `DESIGN_TYPES`, `BACKGROUND_STYLES` |
| `modules/design/image-operations.js` | validazione delle operazioni | `parseOperations`, `assertCropFits`, `resolveResize`, `normaliseFormat`, `OUTPUT_FORMATS`, `IMAGE_LIMITS` |
| `modules/design/subject-placement.js` | costanti e matematica della posizione del soggetto nello sfondo | `SUBJECT_BOX`, `subjectPlacement({width, height, subject})` |
| `modules/design/raster-composer.js` | impasta il soggetto ritagliato nello sfondo e restituisce un solo JPEG | `compositeSubject({backgroundImage, subjectImage, width, height, subjectWidth, subjectHeight})`, `isRasterImageDataUrl` |
| `backend/services/cutout-service.js` | rimuove lo sfondo della foto con GrabCut locale, cache e ripiego | `createCutoutService({cacheDir, workWidth})` → `removeBackground({image})`, `algorithm` |
| `backend/services/raster-service.js` | converte l'SVG in JPEG con resvg e Jimp, senza dipendere dai font del server | `createRasterService({quality})` → `render(svg)` |
| `backend/services/compose-service.js` | prepara la foto, richiede il ritaglio, orchestra compositing e rasterizzazione | `createComposeService({meaningStandard, palette, standingFor, images, cutouts, raster})` → `compose`, `prepareImage`, `prepareCutout`, `meanings` |
| `backend/llm-classifier.js` | seconda fase per le ragioni ambigue | `createLlmClassifier({apiBase, apiKey, model, timeoutMs})` → `configured`, `classify` |
| `backend/openrouter-images.js` | client image-to-image OpenRouter (`krea/k3-edit`) | `createOpenRouterImageClient({apiBase, apiKey, model, timeoutMs})` → `configured`, `generate({prompt, references})` |
| `backend/services/background-image-service.js` | genera, prepara e cacha gli sfondi; fallback a gradienti | `createBackgroundImageService({generator, images, meanings, cacheDir})` → `generate`, `get`, `motifs` |
| `backend/services/flyer-service.js` | inferisce colore e formato, orchestra interaction + sfondi + composizione | `createFlyerService(...)` → `create`, `recompose`; `inferColour`, `inferDesignType` |
| `backend/services/interaction-service.js` | orchestra riflessione, politica, memoria, suggerimenti | `interact` (anche `undecidedAsPersonal`), `requestBackground`, `suggestionsFor`, `savePreference`, `addCorrection`, `standingFor`, `memoryFor`, `deleteRecord`, `clearMemory` |
| `backend/services/image-service.js` | crop, resize, rotate, conversione | `createImageService(limits)` → `transform`, `prepare` |
| `backend/storage/file-adapter.js` | adattatore sincrono su file con scritture atomiche | `createFileAdapter({directory})`, `fileNameForKey`, `StorageError` |
| `backend/static-files.js` | serve l'interfaccia sulla stessa origine | `readStaticFile({root, urlPath})`, `resolveWithin(root, pathname)`, `contentTypeFor(file)`; MIME espliciti anche per `.ttf`, `.otf` e `.woff` |
| `frontend/js/create.js` | composer pubblico: testo, foto, creazione, sfondi | fetch verso `/api/design/flyer` e `/api/design/recompose`, rendering con `textContent` |
| `api/index.js` | handler serverless Vercel, riusa `createRequestHandler`; il rewrite manda `/api/*` qui | handler `(req, res)` |
| `frontend/js/app.js` | interfaccia dettagliata `studio.html`, mantenuta come reference | client HTTP verso `/api`, rendering del DOM con `textContent`, token di richiesta e specchio conversazionale |

### 8.3 Dati e categorie

Il profilo è un record della categoria `interaction` con contenuto `friendliness_standing`:
livello, effort, sblocco degli accenti, ultima decisione, messaggi in sospeso, data. La
valutazione della ragione è un record `knowledge` con esito, confidenza, metodo e parole
corrispondenti; **la ragione grezza resta solo nella preferenza**, dove era già prevista.

Le scritture sono atomiche (file temporaneo + rename). Ogni utente ha un file separato. Un file
illeggibile produce `503 storage_unavailable`.

### 8.4 Decisioni nuove

| Decisione | Motivo | Alternativa scartata |
|---|---|---|
| Regole dichiarate prima, LLM solo per gli ambigui | il percorso comune resta offline, deterministica e verificabile; il modello non viene chiamato senza motivo | chiamare sempre il modello, che avrebbe reso ogni interazione dipendente da una chiave e da un servizio esterno |
| Una decisione LLM sotto confidenza 0.5 resta indecisa | un giudizio incerto non deve punire l'utente con un profilo not friendly | accettare qualunque verdetto del modello, anche con confidenza quasi nulla |
| I pattern lessicali restano in inglese | sono la lingua delle regole originali e del codice; tradurli avrebbe introdotto una seconda fonte di verità | fingere che le regole capiscano l'italiano: senza il modello, una ragione italiana resta `needs_review` |
| Nessuna scrittura senza `consent: true`, anche per il profilo | è la regola non negoziabile del progetto | salvare il profilo automaticamente perché il creatore ha detto "store the data", che avrebbe violato la regola sul consenso |
| Una ragione indecisa non cambia il profilo | un caso dubbio non deve essere trattato come personale | classificare per esclusione, che avrebbe punito una ragione solo perché ambigua |
| 5 suggerimenti friendly, 2 not friendly | traduce "lesser graphic suggestions" in un numero verificabile, modificabile nello standard | un numero scelto nel codice, non revisionabile senza toccare il programma |
| Gli sfondi rosso/giallo restano un accento nei suggerimenti ordinari | il testo chiede che i suggerimenti tendano ai cinque colori; l'accento soddisfa anche il caso cogente | sfondi interamente rossi o gialli, che avrebbero contraddetto la richiesta dei cinque colori |
| Il lesser effort aggiunge un ritardo di 900 ms | il creatore del 29 ottobre ha spiegato che significa "a little time delay before outputs are displayed" **e** meno suggerimenti: il ritardo è nel file standard, non nel codice, e viene mostrato dichiarato e misurato | rallentare senza dichiararlo, che avrebbe reso impossibile distinguere una decisione da un difetto |
| Il ritardo è dichiarato dal server e applicato dal browser | l'API resta corretta per qualunque client e l'attesa è visibile nel punto in cui serve; i test la misurano realmente | mettere `sleep` nel server, che avrebbe occupato una connessione e reso i test lenti |
| Scegliere un colore incoraggiato riporta il profilo a friendly | deciso dal creatore il 29 ottobre; un colore incoraggiato non revoca però uno sblocco già ottenuto con una ragione cogente | riportare a friendly solo via ragione, che era la regola precedente |
| Una ragione assente è personale | deciso dal creatore il 29 ottobre; la preferenza resta però non salvata finché la domanda non riceve risposta | trattare l'assenza come caso non deciso, che era la regola precedente |
| La displeasure si riarma a ogni decisione personale o assente | "Displeasure can recur"; dopo la consegna i due flag tornano falsi e solo una nuova decisione li riaccende | consegnarla una volta sola, che era la regola precedente |
| Gli sfondi rosso/giallo hanno un ingresso separato (`POST /api/design/backgrounds`) | il creatore ha chiesto che siano suggeriti **solo su richiesta** e con una ragione cogente per la richiesta stessa: un flag non basta, serve un percorso che non possa essere saltato | lasciare che sia un parametro dell'interazione ordinaria, che avrebbe permesso di ottenerli senza la domanda |
| `choice.by = "user"` in ogni risposta di suggerimenti | "The app should only suggest backgrounds ... and not choose": la scelta non può essere implicita | applicare automaticamente il primo sfondo, che avrebbe contraddetto la richiesta |
| L'interfaccia è servita dal backend sulla stessa origine | una sola origine rimuove il CORS dal percorso normale e rende `npm start` l'unico comando necessario | due processi da avviare e CORS da configurare, con la pagina che non può funzionare da sola perché non ha più dati propri |
| Suggerimenti come CSS + SVG, non immagini generate | sono ispezionabili, deterministici e testabili; non esiste un modello di image generation in questo progetto | simulare immagini generate, che sarebbe stato dichiarare una capacità inesistente |
| Immagini in base64 nel JSON | Node non offre multipart; una dipendenza in più non risolveva un problema di questa fase | parsing multipart scritto a mano, più codice non necessario |
| Solo png, jpeg e bmp | sono i formati verificati dai test; l'ingresso è controllato dai byte iniziali | dichiarare gif, tiff o webp senza test che li coprano |

### 8.5 Limiti del backend

1. **Nessuna autenticazione:** chi raggiunge il server può usare qualsiasi `userId`. Ascolto su
   `127.0.0.1` per default; non esporre senza autenticazione, autorizzazione, rate limiting e HTTPS.
2. **L'interfaccia non funziona senza il backend:** non ha dati propri, quindi se il server non
   risponde mostra un errore esplicito e non finge di aver salvato qualcosa.
3. **Qualità del giudizio non misurata:** non esiste un insieme etichettato di ragioni; le soglie
   sono una convenzione. Il modello LLM è testato con un endpoint simulato, non con una chiave reale.
4. **Nessun modello di image generation:** i suggerimenti sono specifiche CSS/SVG.
5. **Nessuna transazione tra processi:** due server che scrivono lo stesso utente possono
   sovrascriversi. Un solo processo per cartella dati è il caso supportato.
6. **Nessuna latenza misurata sotto carico** per le API, e nessun limite di frequenza.
7. **Le regole lessicali sono in inglese.** Una ragione scritta in italiano che non contiene i
   pattern dichiarati resta `needs_review`; senza una chiave LLM non viene classificata e non
   viene salvata.

### 8.6 L'interfaccia sulle API (29 ottobre 2026)

```
browser
   |  GET  /frontend/...            <- backend/static-files.js (solo la cartella frontend)
   |  GET  /api/palette, /api/design/types
   |  POST /api/interactions        -> risposta + profilo + suggerimenti + display.delay_ms
   |  POST /api/design/backgrounds  -> domanda, poi esito
   |  POST /api/design/suggestions  -> suggerimenti senza scritture
   |  GET  /api/users/:id/standing|memory, DELETE memory[/:recordId]
   |  POST /api/users/:id/corrections
   v
[frontend/js/app.js]  nessun calcolo, nessun archivio: solo fetch e DOM con textContent
```

Scelte registrate:

- **Nessun `localStorage`.** La pagina non tiene una copia dei dati: due copie che possono
divergere erano un difetto, non una comodità. L'unica cosa che ricorda è l'utente nell'URL.
- **Nessun `innerHTML`.** L'SVG di un suggerimento è una stringa prodotta dal server, quindi non
viene mai inserito nel documento: l'anteprima usa il gradiente CSS equivalente (un valore di
stile) e il markup viene citato solo come testo.
- **Il ritardo è applicato dal client**, leggendo `display.delay_ms`, e il tempo realmente atteso
viene misurato con `performance.now()` e mostrato accanto al valore dichiarato. Il pannello
"Why this answer" riporta entrambi.
- **L'app non sceglie.** Ogni suggerimento ha un pulsante "Use this background"; la preview viene
dipinta solo dopo quel gesto, e il pannello dice esplicitamente che la scelta è dell'utente.
- **Errori visibili.** Se il backend non risponde, la pagina mostra il messaggio e dichiara che
niente è stato salvato; non esiste un percorso che simula il successo.

### 8.7 L'interfaccia “Ink Register” e la passata di correzione (29 ottobre 2026)

Il redesign ha sostituito la griglia di pannelli con una metafora di stampa: un **job ticket**
sticky a sinistra (profilo, memoria, setup del flyer; quattro blocchi numerati), un **proof
sheet** a destra con otto piatti numerati, una striscia spettrale nell'intestazione e uno specimen
che prende il colore selezionato. I font sono locali (`Gloock`, `Instrument Sans`, `Geist Mono`,
licenze OFL in `frontend/fonts/`); la pagina non carica webfont remoti.

Il vincolo era conservare ogni contratto osservabile: id, classi e testi usati da `app.js` e dai
51 controlli del browser. Il thread della chat è uno specchio; i pannelli di dettaglio restano la
fonte autorevole. Il DOM mette `<main>` prima di `<aside class="ticket">`; su desktop il grid
assegna al ticket la colonna 1 e al main la colonna 2, mentre sotto 960 px l'ordine naturale del
DOM è anche l'ordine visivo.

La passata di correzione ha riguardato sei classi di difetti:

1. **Static serving.** `.ttf`, `.otf` e `.woff` non erano nella tabella MIME: i font venivano
   serviti come `application/octet-stream` con `nosniff`. Ora hanno `font/ttf`, `font/otf` e
   `font/woff`; il test backend verifica status, MIME e `nosniff`.
2. **Stato della conversazione.** `showTyping()` parte all'inizio della richiesta e
   `hideTyping()` è chiamato anche nel ramo di errore; ogni ragione aggiunge una sola bolla.
3. **Fuori ordine.** Un token monotono per richiesta impedisce a una risposta vecchia di
   sovrascrivere la selezione nuova, anche durante il ritardo del lesser effort.
4. **Pannelli obsoleti.** Una nuova selezione azzera reason, delay, correction, background
   question, chosen background e preview.
5. **Contesto dello sfondo.** La domanda memorizza il colore richiesto: cambiare il select dopo
   non cambia il colore della richiesta.
6. **Accessibilità e layout.** Ripristinato `:focus-visible` sui campi, corretti i bordi della
   palette a due e una colonna, rispettato `prefers-reduced-motion` nello scroll della chat.

Lo scroll della chat segue la conversazione solo quando il thread è già visibile, per non
strappare la pagina via mentre si sceglie un colore.

### 8.8 Il composer “Create your flyer” e gli sfondi generati (31 ottobre 2026)

La pagina pubblica è stata ridotta a un solo composer: testo, foto opzionale, un pulsante. La
pagina dettagliata resta in `frontend/studio.html` come reference e per i 51 controlli originali;
la pagina pubblica è `frontend/index.html`. Le regole non sono più ripetute nell'interfaccia: il
link in testata porta al repository GitHub.

```
POST /api/design/flyer
  -> inferColour(testo)          primo nome di colore della palette, o blu
  -> inferDesignType(testo)      flyer | poster | social_post | banner | background
  -> interaction-service         stessa politica della palette, con undecidedAsPersonal
  -> background-image-service    OpenRouter krea/k3-edit, cache, fallback
  -> compose-service             ritaglio GrabCut + compositing raster + SVG deterministico
  -> risposta                    composizione + profilo + sfondi + messaggi

POST /api/design/recompose
  -> stessi input + backgroundIndex/backgroundId
  -> ricompone senza eseguire di nuovo l'interaction e senza scrivere nulla
```

Scelte registrate:

- **Rosso e giallo non bloccano più la composizione.** Il composer produce comunque il flyer nel
  colore scelto. Se la ragione non è cogente, l'interaction registra `not_friendly`: 2 sfondi
  invece di 5, 900 ms di attesa e displeasure + spiegazione al prossimo ingaggio. La vecchia
  porta `compose` che rifiutava rosso/giallo è stata rimossa; la richiesta esplicita di uno
  sfondo rosso/giallo (`/api/design/backgrounds`) mantiene la sua domanda e la sua ragione
  cogente.
- **La ragione non è tutto il testo del flyer.** `flyer-service` rimuove i termini generici
  dell'artefatto (`flyer`, `poster`, `banner`, `design`, `layout`, `background`, `theme`,
  `branding`, `instagram`, `social post`) prima di classificare la ragione: altrimenti la parola
  “flyer” renderebbe automaticamente cogente qualunque testo. Se dopo la rimozione non resta
  nulla, la ragione è assente e quindi personale. `undecidedAsPersonal` trasforma un verdetto
  `needs_review` in personale solo per questo flusso, così il flyer non si ferma.
- **`krea/k3-edit` è image-to-image.** Richiede almeno un'immagine di riferimento. Il servizio
  costruisce un canvas astratto con il colore scelto, due colori di supporto, una luce e un
  orizzonte; il prompt chiede di trasformarlo in un giardino botanico, un villaggio, una cappella,
  un prato o delle arcate. Il testo del flyer non viene mai inviato al provider.
- **Cache.** La chiave è SHA-256 di modello + prompt + palette; l'immagine preparata (JPEG,
  larghezza massima 1400 px) viene salvata in `data/background-cache/`. Scegliere un altro
  sfondo ricompone senza una nuova generazione. Senza chiave o in caso di errore il servizio
  restituisce gradienti deterministici con `fallback: true`.
- **Composizione `showcase`.** Lo sfondo generato è full-bleed, il testo sta su uno scrim scuro.
  Il testo dell'utente diventa la headline (prima riga/frase) e il corpo (il resto), non più solo
  il significato del colore.
- **Rimozione dello sfondo e soggetto composto.** Se c'è una foto e lo sfondo è raster, il
  servizio di ritaglio esegue GrabCut in locale su una copia larga 400 px (5 iterazioni, ~1–2 s),
  riempie i buchi interni, rimuove le macchie isolate e riporta la maschera alla foto prepared,
  sfumandone il bordo. Il bbox viene scalato dalle coordinate di lavoro a quelle della foto: senza
  questa scalatura si tagliava solo una striscia del soggetto. Il soggetto viene poi disegnato
  nello sfondo con un'ombra morbida e una sfumatura in basso; l'SVG contiene un solo JPEG, non un
  ritaglio sovrapposto. Se GrabCut non trova un soggetto separabile, il composer usa la vecchia
  cornice invece di produrre un ritaglio rotto. La cache del ritaglio è SHA-256 dell'immagine
  prepared + versione dell'algoritmo (`grabcut-v2`).
- **Testo in tracciati, impaginazione misurata.** Il composer non scrive più `<text>`: carica i
  TTF locali con `fontkit` e converte ogni riga in `<path>`. Le righe vengono misurate sui glifi
  reali prima di andare a capo, quindi il testo non esce dal margine e non cambia larghezza se il
  telefono non ha Georgia o Helvetica. Il blocco viene ridotto prima nel corpo e poi nel titolo;
  in casi estremi il corpo viene accorciato con un'ellissi e il fatto è dichiarato in `warnings`.
  `showcase` espone `text_top`, `text_bottom`, `rule_y`, `text_overflow` e `text_trimmed`.
- **Export JPEG.** `@resvg/resvg-js` trasforma l'SVG in PNG e Jimp lo scrive in JPEG (qualità 92).
  La pagina pubblica e lo studio mostrano e scaricano il JPEG: una galleria del telefono non apre
  l'SVG. L'SVG resta nella risposta per ispezione e test; se la rasterizzazione fallisce,
  `image_error` lo dichiara e il frontend torna all'SVG. Il costo misurato è ~1,1 s per flyer
  1080×1350, con un JPEG di ~0,6–0,8 MB.
- **Risposta leggera.** Le cinque immagini intere degli sfondi non viaggiano più nel JSON: la
  risposta porta un `thumbnail` JPEG da 360 px per la striscia delle scelte, mentre l'immagine
  intera resta nella cache e viene ripresa per `id` alla ricomposizione. La risposta di un flyer
  1080×1350 con cinque sfondi è scesa da ~5,0 MB a ~2,3 MB, sotto il limite Vercel.
- **Il formato non si deduce da una parola qualsiasi.** `square` da sola faceva diventare
  `social_post` un flyer che citava “Town Hall Square”; ora servono `instagram`, `social media`,
  `social post`, `social network` o `square format/post`. Il test `inferDesignType` copre il caso.
- **Vercel.** `frontend/` è servito staticamente; `api/index.js` è l'handler serverless per ogni
  richiesta `/api/*`, raggiunto con il rewrite `/api/(.*) → /api/index`. Il catch-all
  `api/[...path].js` non è affidabile: su Vercel copre solo un livello e le rotte annidate
  tornano 404. In produzione `CHATMT_DATA_DIR=/tmp/chatmt-data`: memoria e cache sono per istanza
  e volatili. Il Dockerfile resta per l'uso locale/container ed è escluso da `.vercelignore`.
  `@techstark/opencv-js` è una dipendenza npm caricata in modo lazy al primo ritaglio: il primo
  flyer con foto dopo un cold start paga il caricamento, i successivi no; anche la cache del
  ritaglio vive in `/tmp` ed è per istanza. `@resvg/resvg-js` porta un binario nativo per
  linux-x64 che il build Vercel include; `fontkit` e i TTF locali viaggiano nel bundle della
  funzione, quindi il testo in tracciati non richiede font di sistema.
