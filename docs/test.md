# ChatMT — Test e risultati misurati (Fase 2 e backend)

Ogni numero in questo documento è stato prodotto eseguendo il comando indicato su questa macchina.
Nessun risultato è stimato. Dove una metrica non è stata misurata, è scritto che non è stata misurata.

- **Data delle esecuzioni:** 26 ottobre 2026 (frontend), 28 ottobre 2026 (backend),
  29 ottobre 2026 (regole nuove, interfaccia sulle API, “Ink Register”) e 31 ottobre 2026
  (composer “Create your flyer”, sfondi generati OpenRouter, Vercel)
- **Ultima esecuzione completa:** 31 ottobre 2026 — **114/114** test automatici, **62/62**
  controlli nel browser (che avviano da sé il backend su una cartella temporanea)
- **Ambiente:** Windows, Node.js v26.5.0, Chrome 156

---

## 1. Come si eseguono

| Comando | Cosa serve | Cosa verifica |
|---|---|---|
| `node tests/run-tests.mjs` (o `npm test`) | Node.js e `jimp` (unica dipendenza) | la logica e il backend: spazio colore, CIEDE2000, bande, memoria, riflessione, risposte, regole della ragione, profilo, suggerimenti, immagini, API HTTP |
| `npm start` + richieste HTTP | Node.js e `jimp` | il server reale avviato con lo script di produzione: health, interazioni, memoria su disco, trasformazioni |
| `node tests/browser-checks.mjs` | Chrome installato (il server se lo avvia lo script) | l'interfaccia reale: 62 controlli sul DOM di un browser vero, 51 su `studio.html` e 11 sul composer pubblico |
| `node tests/browser-checks.mjs http://127.0.0.1:3080/frontend/studio.html?user=prova` | un server già avviato | gli stessi controlli su un'istanza scelta da te |
| `docker build -t chatmt .` + `docker run --rm -p 8080:3080 chatmt` | Docker | che il container avvii il server Node e serva API e interfaccia insieme |

I livelli sono complementari: i test automatici non vedono l'interfaccia, e i controlli nel browser non verificano i dati di riferimento della formula CIEDE2000 né il backend.

---

## 2. Test automatici (`tests/run-tests.mjs`)

### 2.1 `tests/color-engine.test.mjs`

| Test | Cosa dimostra |
|---|---|
| riproduzione delle 34 coppie pubblicate | la formula CIEDE2000 implementata coincide con i dati supplementari pubblicati con la formula stessa, entro 1e-4 |
| simmetria e distanza zero | la formula dà lo stesso valore scambiando i due colori, e 0 per colori uguali |
| bianco contro nero | la distanza è esattamente 100, cioè l'intera scala di luminosità |
| sRGB → CIELAB | bianco ≈ (100, 0, 0), nero esatto, rosso `#FF0000` ≈ (53.24, 80.09, 67.20) entro 0.05; l'asse b* separa il blu (negativo) dal giallo (positivo) |
| analisi del codice HEX | `#RGB` e `#RRGGBB` accettati; `#GGGGGG`, `#12345`, `rgb(0,0,0)`, `blue`, stringa vuota, `null`, numeri e oggetti rifiutati con errore esplicito |
| rappresentazione strutturata | HEX, RGB e CIELAB coerenti tra loro |
| colori identici e diversi | distanza 0 e banda "identical"; distanza positiva e simmetrica tra verde e porpora |
| bande di distanza | ordinate, coprono ogni valore, i confini sono verificati uno per uno, i valori negativi e `NaN` sollevano un errore |

**Fonte dei dati di riferimento:** G. Sharma, W. Wu, E. N. Dalal, *The CIEDE2000 Color-Difference
Formula: Implementation Notes, Supplementary Test Data, and Mathematical Observations*, Color
Research and Application, vol. 30, no. 1, pp. 21-30, febbraio 2005. I 34 valori usati nei test
sono copiati dal file ufficiale in formato testo pubblicato dagli autori
(`ciede2000testdata.txt`), non scelti da noi.

### 2.2 `tests/memory.test.mjs`

| Test | Cosa dimostra |
|---|---|
| consenso obbligatorio | senza `consent: true` la scrittura è rifiutata con `ConsentRequiredError` e la memoria resta vuota |
| campi del record | il record contiene tutti i campi richiesti dal §3 del brief, con i valori attesi |
| risposta alla domanda | la risposta dell'utente alla domanda di una regola viene conservata con la preferenza |
| persistenza | un secondo `MemoryStore` sullo stesso archivio ritrova il record |
| recupero | per identificativo, per categoria e per correzioni di uno specifico colore |
| separazione tra utenti | i dati di un utente non compaiono per un altro; cancellare un utente non tocca l'altro |
| aggiornamento | l'identificativo e `created_at` restano, `updated_at` cambia, il valore è persistito |
| sostituzione di una preferenza | cambiano colore, nome, risposta e stato di conferma |
| eliminazione | `delete` restituisce `true`/`false` e il record non è più recuperabile |
| cancellazione totale | `clear()` restituisce il numero di record rimossi e la voce sparisce dall'archivio |
| scadenza | un record con `expires_at` nel passato non viene più usato come contesto, ma è ancora presente con `includeExpired` |
| input non valido | colore non valido, esito di correzione vuoto, archivio illeggibile → errori espliciti |
| record generici | `addRecord` richiede consenso, una categoria dichiarata e un contenuto oggetto; `latestRecord` filtra per categoria e tipo |
| aggiornamento del contenuto | `updateContent` unisce i campi, conserva id e `created_at` e aggiorna `updated_at` |

Nota: nei test il tempo e gli identificativi sono iniettati (`now`, `idFactory`), quindi nessun test dipende dalla data reale né da un UUID generato.

### 2.3 `tests/reflection.test.mjs`

| Test | Cosa dimostra |
|---|---|
| le 9 regole della fonte | il file standard mantiene 7 regole `accepted` e 2 `question`; "majesta" è magenta `#FF00FF` |
| input corrispondente | la regola viene individuata con il suo identificativo, il testo originale e la distanza |
| regole che pongono una domanda | rosso e giallo portano con sé la domanda del file originale |
| input senza standard | viene dichiarato "non coperto" con incertezza alta e una motivazione scritta; il colore standard più vicino viene riportato come misura |
| tipi non implementati | testo, immagine, audio e tipi mancanti sollevano `UnsupportedInputError` invece di essere interpretati |
| colore non valido | `InvalidColourError` prima di qualsiasi altro effetto |
| etichetta contro valore | `green` con valore `#2ECC71` produce una contraddizione `label-value-mismatch` e incertezza media |
| confronto con la preferenza | il confronto con la preferenza memorizzata è calcolato e **la preferenza non viene sovrascritta** |
| selezione identica | distanza esattamente 0 e banda "identical" |
| contesto di un altro utente | non viene mai usato come contesto |
| correzione contro standard | la contraddizione è segnalata senza modificare lo standard |
| record non confermato | non viene trattato come preferenza stabile |
| memoria non conforme | un oggetto memoria senza l'interfaccia attesa viene rifiutato |
| risposta per colore accettato | regola, misura, giudizio, dati usati, possibilità di memorizzare |
| risposta per colore da interrogare | la domanda del file originale viene posta e la memorizzazione è bloccata |
| risposta per colore non coperto | l'incertezza è dichiarata e la memorizzazione è ammessa solo come osservazione non confermata |
| risposta senza preferenza | il sistema dichiara di non avere nulla con cui confrontare, invece di inventare un confronto |
| assenza di segnaposto | nessun `undefined` o `NaN` finisce nel testo della risposta |
| tutti i colori della tavolozza | 15 colori producono tutti una risposta completa senza errori |

### 2.4 `tests/reason-policy.test.mjs` (17 test)

| Test | Cosa dimostra |
|---|---|
| standard dei significati | cinque colori incoraggiati, rosso e giallo interrogati, limiti 5/2 |
| equivalenze | magenta porta il significato di indigo e purple quello di violet; entrambi contano come incoraggiati |
| colori senza significato | lime e grey sono dichiarati senza significato; magenta non più |
| spiegazione del bias | contiene "danger or royalty", "anger or determination", i colori equivalenti, la ragione assente e il ritardo |
| ragione personale | "mi piace e basta", colore preferito, nessun motivo, gusto personale → `personal` |
| ragione cogente | significato, marca, pubblico, contrasto, contesto di design → `cogent` |
| negazione | "non mi piace solo perché..." non viene contata come ragione personale |
| ragione ambigua | resta `needs_review` |
| ragione assente | **è personale**: `personal` con `method: none`, `absent_reason: true`, confidenza 0.6 |
| transizioni del profilo | personale → `not_friendly`, 2 suggerimenti, ritardo 900 ms; cogente → `friendly`, 5 suggerimenti, sfondi sbloccati |
| ragione assente nel profilo | il profilo diventa `not_friendly` con una formulazione propria ("without giving a reason") |
| displeasure ricorrente | dopo una consegna, una nuova scelta personale la riarma e viene consegnata di nuovo |
| ritorno con colore incoraggiato | green, blue, orange, indigo, violet, magenta e purple riportano il profilo a `friendly` con ritardo 0 e 5 suggerimenti |
| sblocco degli sfondi | un colore incoraggiato non sblocca rosso/giallo da solo e non revoca uno sblocco già ottenuto |
| consegna una sola volta | la displeasure e la spiegazione compaiono alla prima interazione successiva e non si ripetono senza una nuova decisione |
| profilo danneggiato | un `not_friendly` con `allow_questioned_colours` forzato non sblocca gli sfondi |

### 2.5 `tests/design-suggestions.test.mjs` (22 test)

| Test | Cosa dimostra |
|---|---|
| profilo friendly | 5 suggerimenti, tutti composti solo dai cinque colori, con CSS e SVG |
| determinismo | lo stesso input produce esattamente lo stesso output |
| profilo not friendly | 2 suggerimenti, dettaglio breve, nota di assistenza ridotta, nessun accento |
| ritardo e scelta | `delay_ms` 0 per il profilo esteso, 900 per quello ridotto; `choice.by = "user"` e `applied: false` |
| ragione cogente | il quinto suggerimento porta un accento rosso/giallo e almeno due colori incoraggiati |
| accento coerente | l'accento segue il colore della ragione cogente, non quello del design |
| sfondo richiesto | senza sblocco o con un colore non interrogato viene rifiutato (`RangeError`); con ragione cogente produce 3 sfondi tendenti al colore richiesto, deterministi |
| tipi di design | flyer, poster, social post, banner e background mantengono le proprie dimensioni |
| validazione | tipo sconosciuto, oggetto troppo lungo e campi non testuali sono rifiutati |
| operazioni immagine | crop, resize con proporzioni, rotazione a quarti di giro, formati png/jpeg/bmp e limiti |
| testo utente | la prima riga/frase diventa la headline, il resto il corpo; il testo è XML-escapato |
| sfondo generato | il layout `showcase` usa l'immagine full-bleed e mantiene il testo leggibile |
| rosso/giallo | la composizione avviene anche senza ragione registrata, con il warning di assistenza ridotta; con ragione cogente il warning cambia |

### 2.6 `tests/backend.test.mjs` (27 test)

| Test | Cosa dimostra |
|---|---|
| health e standard | standard caricati, LLM non configurato, image generation non configurata, palette, significati con equivalenze e numeri dell'assistenza, tipi di design |
| interazione verde | profilo friendly, decisione `encouraged`, 5 suggerimenti, preferenza e profilo scritti su disco |
| rosso senza ragione | domanda posta, **profilo salvato come `not_friendly`**, preferenza non salvata, ritardo 900 ms |
| ragione personale | profilo `not_friendly`, 2 suggerimenti, tre record (preferenza, profilo, valutazione) |
| consegna differita | alla interazione successiva arrivano displeasure e spiegazione |
| displeasure ricorrente | una seconda scelta personale la riarma e la consegna avviene di nuovo |
| ripristino del profilo | dopo una ragione personale, magenta riporta a `friendly`, ritardo 0, 5 suggerimenti |
| persistenza | una seconda istanza del server sullo stesso archivio ritrova il profilo |
| ragione cogente | tono friendly, sfondi rosso/giallo sbloccati |
| ragione ambigua | nessuna scrittura e nessun profilo inventato |
| sfondo rosso/giallo | la richiesta senza ragione produce solo la domanda; la ragione personale attiva il mood ostile con 2 suggerimenti senza rosso; quella cogente produce 3 sfondi tendenti al colore richiesto; un colore diverso → 400 |
| composer one-press | `/api/design/flyer` inferisce il colore, compone un flyer giallo senza bloccarlo, restituisce 2 sfondi e 900 ms, e al prossimo ingaggio consegna la displeasure |
| interfaccia servita | `GET /` → 302, `/frontend/` e `/frontend/js/create.js` → 200, `studio.html` → 200, font `.ttf` → 200 `font/ttf` + `nosniff`, percorsi che escono da `frontend/` → 404 |
| LLM simulato | viene usato solo per la ragione ambigua; il fallimento e una confidenza sotto 0.5 lasciano `needs_review` |
| suggerimenti HTTP | 2 per il profilo ridotto, 5 per quello esteso, tipo non valido → 400 |
| immagini | crop, resize, rotate, PNG/JPEG/BMP in uscita e JPEG in ingresso |
| errori immagine | crop fuori dai limiti, immagine non decodificabile, GIF rifiutata, formato e operazione non validi |
| memoria | consenso obbligatorio, preferenza, correzione, eliminazione, cancellazione totale |
| routing e validazione | 404, 405, userId non valido, colore fuori tavolozza, JSON non valido, ragione troppo lunga |
| separazione utenti | il profilo di un utente non compare per un altro |
| LLM (unità) | richiesta OpenAI-compatible, JSON stretta, risposte malformate, errori e assenza di chiave |
| `.env` (unità) | commenti, `export`, virgolette, valore con commento in coda, file assente, variabile esportata che vince sul file |
| DeepSeek (unità) | endpoint e modello dichiarati, `thinking: {"type":"enabled"}` e `reasoning_effort` nel corpo, assenza dei due parametri con `CHATMT_LLM_THINKING=disabled`, valore non valido rifiutato all'avvio |
| Composizione (unità) | layout per formato (`showcase`, `stack`, `band-right`, `cover`), testi scritti dall'app, foto adattata con `slice`, scrim, testo XML-escapato, determinismo |
| Composizione (HTTP) | `POST /api/design/compose` con e senza foto, rosso composto con warning ridotto, colore fuori tavolozza e immagine non decodificabile |

### 2.7 `tests/background-images.test.mjs` (3 test)

| Test | Cosa dimostra |
|---|---|
| generazione e cache | una richiesta per motivo, immagine preparata in JPEG, cache per modello+prompt+palette; la seconda chiamata non rigenera |
| fallback senza chiave | senza `OPENROUTER_API_KEY` il servizio restituisce gradienti deterministici con `fallback: true` e una nota esplicita |
| errore isolato | se il provider fallisce su un motivo, solo quella tessera usa il fallback; le altre restano generate |

### Risultato dell'esecuzione

```
node tests/run-tests.mjs
tests 114   pass 114   fail 0
```

114 test superati, 0 falliti. Sono inclusi i 34 confronti CIEDE2000 di riferimento, ciascuno
verificato con tolleranza 1e-4. I test di `reason-policy` (19), `design-suggestions` (22),
`backend` (27) e `background-images` (3) coprono le regole del 29 ottobre, la configurazione
DeepSeek, la composizione automatica, il composer one-press e gli sfondi generati.

**Un risultato non ovvio emerso dai test** e conservato come caso di regressione: il colore
`lime` (`#00FF00`) senza standard risulta più vicino a **yellow** (23.40) che a **green**
(34.51). Non è un errore: il valore CSS di `green` è `#008000`, molto più scuro, mentre la tinta
di `lime` e `green` è quasi identica. Il test verifica entrambi i valori, così il risultato non
va perso.

---

## 3. Controlli dell'interfaccia (`tests/browser-checks.mjs`)

62 controlli eseguiti su un Chrome reale pilotato via DevTools Protocol, con asserzioni sul DOM
dopo ogni azione. Da questa versione lo script **avvia da sé il backend** su una porta effimera e
una cartella dati temporanea, con un utente nuovo per ogni esecuzione: non serve preparare
nulla a mano. I primi 51 controlli usano la pagina dettagliata `studio.html`; gli ultimi 11
usano il composer pubblico `index.html`.

Verificano, nell'ordine:

1. la tavolozza arriva dall'API: 9 colori coperti, 6 non coperti, nessun errore, utente preso dall'URL, profilo `friendly`, magenta mostrato come "same as indigo";
2. dopo il consenso, `green` produce una risposta che cita `colour-green`, il profilo resta friendly, **nessun ritardo**, 5 suggerimenti, e in memoria finiscono 2 record;
3. `red` senza ragione: il pannello della ragione appare con la domanda del file originale, la risposta dichiara **che una ragione assente è personale**, il profilo diventa `not_friendly`, il ritardo viene annunciato e **misurato** (>= 850 ms), i suggerimenti scendono a 2;
4. una ragione personale lascia il profilo `not_friendly` e **non** mostra subito la displeasure;
5. `blue` al passo successivo fa arrivare la displeasure e la spiegazione del lesser effort (che citano i 900 ms) e **riporta il profilo a friendly**, senza ritardo;
6. la richiesta di uno sfondo rosso chiede subito il motivo; una ragione non cogente attiva il mood ostile, riduce i suggerimenti a 2 e **non** propone alcun rosso; una ragione cogente per il giallo produce 3 sfondi tendenti al giallo (`requested: yellow`);
7. nessuno sfondo è scelto dall'app: il pannello dice che non c'è scelta finché l'utente non preme "Use this background", e solo allora la preview viene dipinta;
8. cambiando il tipo di design e premendo "Update suggestions" i suggerimenti seguono il tipo scelto;
9. una correzione viene registrata come record separato, la contraddizione `correction-against-standard` viene mostrata con "the standard has not been changed automatically", l'eliminazione toglie un solo record e la cancellazione totale svuota la memoria e riporta il profilo a `friendly`;
10. il composer pubblico ha il campo di testo, un solo pulsante di creazione e il link alle regole su GitHub; il risultato è nascosto prima della creazione;
11. un flyer giallo senza ragione cogente viene comunque composto, con il delay misurato (>= 800 ms), 2 sfondi, il tono `not friendly` e il messaggio di assistenza ridotta;
12. scegliendo il secondo sfondo il flyer viene ricomposto e la preview cambia;
13. una seconda creazione consegna la nota di displeasure del precedente ingaggio;
14. nessuna eccezione non gestita e nessun errore in console durante tutto il percorso.

### Risultato dell'esecuzione

```
node tests/browser-checks.mjs
62/62 browser checks passed
```

**Difetti trovati da questi controlli** e poi corretti: l'etichetta della domanda sullo sfondo
veniva letta prima che la risposta arrivasse; il badge del profilo veniva controllato prima che
il ritardo fosse terminato (la pagina mostra il testo subito e il profilo dopo, come deve); due
controlli cercavano un testo che la pagina non usa. In tutti e tre i casi il difetto era nel
controllo, non nel codice, ed è stato corretto nel controllo invece di allentare l'asserzione.

### Verifiche manuali della passata di correzione (29 ottobre 2026)

Queste verifiche **non fanno parte dei 62 controlli automatici**: sono state eseguite a mano su
Chrome dopo il redesign, perché misurano stati che i controlli esistenti non coprono. Il test
backend è stato esteso con l'asserzione sul MIME dei font; il 31 ottobre si sono aggiunti i test
su flyer one-press, sfondi generati, cache e fallback, quindi il totale è 114.

| Verifica | Risultato |
|---|---|
| focus da tastiera su un campo | `:focus-visible` attivo, outline `2px solid rgb(192,48,27)` |
| palette a 768 px | 2 colonne; gli item 3 e 9 hanno `border-right: 1px` |
| ordine mobile a 390 px | `<main>` prima di `<aside class="ticket">`, nessun overflow orizzontale |
| risposta fuori ordine | una `red` ritardata non sovrascrive la `blue` più recente; nessun delay residuo |
| errore di rete | `#chat-typing` rimosso, stato di errore visibile, nessuna bolla assistant |
| sfondo chiesto per `red`, select cambiato a `yellow` | la richiesta parte ancora con `red` |
| font locali | `Content-Type: font/ttf`, `X-Content-Type-Options: nosniff` |
| 1440 / 1024 / 390 px | 0 px di overflow orizzontale, nessun errore console, risorse tutte `200` |

La passata ha anche corretto difetti che i controlli non coprivano: typing residuo dopo un
errore, bolle utente mancanti o duplicate, pannelli obsoleti dopo una nuova selezione, risposte
fuori ordine, colore dello sfondo letto dal select invece che dalla domanda, outline di focus
annullato, bordi della palette a 768 px e ordine DOM mobile diverso dall'ordine visivo.

---

## 4. Backend HTTP (29 ottobre 2026)

Oltre ai test dentro `node --test`, il server è stato avviato con lo stesso comando di
produzione (`node backend/server.js`) su una porta e una cartella dati temporanee, e interrogato
con `curl`. I 23 test di `tests/backend.test.mjs` fanno la stessa cosa su una porta scelta dal
sistema e con un archivio temporaneo, quindi la verifica è ripetibile senza servizi esterni.

| Verifica eseguita a mano | Risultato |
|---|---|
| `GET /api/health` | `status: ok`, 9 regole di usage-of-colours, significati v1.0.0, LLM non configurato |
| `POST /api/interactions` con rosso e ragione personale | `verdict: personal`, profilo `not_friendly`, limite 2, 2 suggerimenti, tre identificativi salvati |
| seconda `POST /api/interactions` con violet e senza consenso | due messaggi (`personal-reason-displeasure`, `reduced-assistance-explanation`), profilo ancora `not_friendly`, 2 suggerimenti, nessuna nuova scrittura |
| avvio con `CHATMT_DATA_DIR` temporanea | log: server in ascolto, LLM non configurato, cartella dati dichiarata |

La chiamata reale al provider LLM **non è stata eseguita**: non era disponibile una chiave in
questa sessione. Il percorso ibrido è verificato con un classificatore simulato (risposta valida
e fallimento), non contro il servizio esterno.

---

## 5. Verifica del container Docker

Rieseguita il 29 ottobre 2026, perché il Dockerfile è cambiato: l'immagine ora avvia il server
Node invece di servire file statici con nginx.

```
docker build -t chatmt:verify .          -> immagine costruita
docker run -d --name chatmt-verify -p 8180:3080 chatmt:verify
```

| Verifica | Risultato |
|---|---|
| `GET /` | 302 verso `/frontend/` |
| `GET /frontend/` | 200, `text/html; charset=utf-8` |
| `GET /frontend/../package.json` | 404, il percorso non esce dalla cartella dell'interfaccia |
| `GET /api/health` | `status: ok`, usage-of-colours v1.0.0 con 9 regole, colour-meanings **v2.0.0** |
| `POST /api/interactions` (rosso, ragione personale) | risposta completa, con la domanda del codice standard e la misura |
| healthcheck del container | `healthy` |
| 51 controlli nel browser sul container (`http://127.0.0.1:8180/frontend/studio.html?user=docker-browser-2`) | 51/51 superati nella verifica del 29 ottobre |

La suite attuale è di 62 controlli: i nuovi 11 sul composer pubblico non sono stati rieseguiti
nel container in questa passata. Il container è stato verificato con la pagina dettagliata e con
le API. Il deploy Vercel usa invece il frontend statico + `api/index.js`; il rewrite
`/api/(.*) → /api/index` evita il limite del catch-all, che copriva solo un livello.

Il container avvia il backend e serve API e interfaccia insieme, sulla porta 3080 e sulla stessa
origine; la memoria è nel volume `/data`.

Nota: i controlli nel browser usano `?user=` per scegliere un utente nuovo, quindi non
dipendono dai dati già presenti nel volume.

---

## 6. Latenza misurata

Misurata in Node.js v26.5.0, media su molte ripetizioni, con una preferenza già memorizzata:

| Operazione | Valore misurato | Ripetizioni |
|---|---|---|
| `reflect()` (confronto con 9 regole + memoria) | **0.0036 ms** per chiamata | 200.000 |
| `reflect()` + `buildResponse()` | **0.0129 ms** per chiamata | 20.000 |

L'interfaccia mostra inoltre, nel pannello "Why this answer", la latenza della singola
riflessione misurata nel browser dell'utente. Quel valore è una misura di quella sessione, non
un benchmark.

Non è stata misurata l'allocazione di memoria né l'uso di CPU.

---

## 7. Metriche richieste dal brief (§8): stato

| Metrica | Stato |
|---|---|
| Accuratezza delle operazioni deterministiche | misurata: 34/34 coppie CIEDE2000 entro 1e-4; conversioni sRGB→CIELAB entro 0.05; 114/114 test superati |
| Precisione e richiamo su classificazioni con etichette di riferimento | **non misurate**: non esiste un insieme etichettato di ragioni personali/cogenti. Le regole sono verificate su casi scritti a mano, non come percentuale |
| Operazioni immagine | verificate su un'immagine reale: crop, resize con proporzioni, rotazione, conversione png/jpeg/bmp, limiti e rifiuti |
| Qualità dei suggerimenti grafici | **non misurata**: non sono stati valutati da designer né su un insieme di prova |
| Qualità del recupero della memoria | verificata su casi funzionali (recupero, aggiornamento, scadenza, separazione tra utenti), **non** come percentuale su un insieme di prova |
| Tasso di risposte non supportate dalle informazioni disponibili | verificato per costruzione: un colore non coperto produce "non coperto" e incertezza alta, e non può essere memorizzato come accettato. Non è stato misurato su un campione casuale, perché la tavolozza è chiusa e ogni caso è coperto da un test |
| Latenza | misurata (§6) per il motore; **non misurata** per le API sotto carico. Il ritardo di 900 ms del profilo not friendly non è latenza di calcolo: è una decisione dichiarata e viene verificata come tale |
| Consumo di risorse | **non misurato** |
| Percentuale di correzioni risolte correttamente | **non applicabile**: in questa fase nessuna correzione viene risolta automaticamente, quindi non esiste una percentuale da misurare |

---

## 8. Cosa questi risultati non dicono

- Non dicono che ChatMT risponda meglio di altri sistemi: **non è stato eseguito alcun confronto**. Il §9 del brief richiede benchmark riproducibili, confronti equi e documentazione dei limiti prima di qualsiasi affermazione di superiorità.
- Non dicono nulla sulla qualità del giudizio sui colori: il sistema misura distanze, non preferenze.
- Non dicono che l'interfaccia sia accessibile: non è stata verificata con strumenti di accessibilità né con uno screen reader.
- Non dicono che i comportamenti siano corretti su altri browser: i controlli sono stati eseguiti solo su Chrome.
- Non dicono che il giudizio personale/cogente sia accurato su ragioni reali: non esiste un insieme etichettato, e le soglie sono una convenzione dichiarata.
- Non dicono che il provider LLM funzioni: è stato usato un endpoint simulato, non una chiave reale.
- Non dicono che il backend sia sicuro da esporre: non ha autenticazione, HTTPS, rate limiting né autorizzazione per profilo.
