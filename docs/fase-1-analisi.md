# ChatMT — FASE 1: Analisi del repository

- **Data dell'analisi:** 26 ottobre 2026
- **Repository analizzato:** `https://github.com/ChatMT-23/ChatMT` (remoto `origin`, branch `main`)
- **Commit presenti:** `aad5575` — "Add initial description of the app's functionality"; `ddba7c3` — "Add color acceptance criteria"
- **Creatore del progetto:** Francesco Bulla

---

## 0. Come è stata condotta l'analisi

Metodi usati (tutti riproducibili):

1. Lettura integrale dei file presenti (`git ls-files`, poi lettura del contenuto).
2. Storia del repository (`git log --oneline --all`, `git branch -a`, `git remote -v`).
3. Confronto con la pagina pubblica GitHub per escludere che il clone locale fosse incompleto.

In tutto il documento sono distinti esplicitamente:

- **[FATTO]** — verificato direttamente su file o comandi git.
- **[IPOTESI]** — deduzione non verificata, da confermare con il creatore.
- **[PROPOSTA]** — decisione tecnica suggerita, non ancora approvata.

---

## 1. Funzionalità che il repository possiede già

**[FATTO]** Il repository contiene **2 file tracciati** e **2 commit**. Non contiene codice sorgente.

| File | Contenuto reale |
|---|---|
| `README.md` | Un unico paragrafo (183 byte) che descrive il principio di funzionamento dell'app. |
| `Usage Of Colours` | 9 righe: 7 regole di accettazione e 2 regole che richiedono una domanda all'utente. |

Contenuto di `README.md` (verbatim):

> This apps uses a regenerative ( Reflective) A.I system which compares inputs received from users with some already standard written codes which the App mimicks as his real identity

Contenuto di `Usage Of Colours` (verbatim):

```
Every input of green color is accepted
Every input of blue color is accepted
Every input of orange color is accepted
Every input of majesta color is accepted
Every input of indigo is accepted
Every input of purple is accepted
Every input of violet is accepted
Every input of Red should be questioned with # Why did you choose Red#
Every input of yellow should be questioned with # Why did you choose Yellow #
```

### Elenco sintetico: cosa esiste e cosa no

**Esiste [FATTO]:**

- Una descrizione in prosa dell'obiettivo del sistema.
- Un embrione di **Standard Code Layer**: le 9 regole cromatiche, scritte in inglese.

**Non esiste [FATTO, verificato con `git ls-files`]:**

- Codice HTML, CSS o JavaScript.
- Codice Python o di altro linguaggio.
- Definizione di un formato dati per gli standard (JSON, YAML, database).
- Qualsiasi forma di memoria o persistenza.
- Reflection Engine, Regenerative Response Engine, Memory Engine, Color Preference Engine.
- Test di qualsiasi tipo; nessun file di configurazione CI.
- Dipendenze, file di build, `requirements.txt`, `package.json`.
- `LICENSE`, `.gitignore`, `docs/`, struttura di cartelle.
- Qualsiasi file relativo a utenti, consenso, privacy.

**[FATTO] Conclusione centrale di questa fase:** il progetto è attualmente **una specifica in prosa, non un programma**. Qualsiasi affermazione del tipo "l'app funziona", "è superiore a ChatGPT" o "l'apprendimento è implementato" non è oggi supportata da alcun artefatto eseguibile.

---

## 2. Tabella: componente, stato attuale, intervento necessario

| Componente | Stato attuale | Intervento necessario |
|---|---|---|
| `README.md` | 1 paragrafo, in inglese, con affermazione di superiorità non dimostrata | Riscrivere: descrizione onesta, installazione, avvio, limiti dichiarati, distinzione tra regole / memoria / modelli |
| `Usage Of Colours` | 9 regole in prosa inglese, non leggibili da una macchina, senza ID né versione | Conservare il file originale e affiancare una versione strutturata (`standards/`), con ID, esito operativo, versione |
| Standard Code Layer | Non esiste come codice | Creare: caricamento degli standard, validazione, versionamento, regole per l'aggiornamento controllato |
| Reflection Engine | Non esiste | Creare: estrazione caratteristiche → standard pertinenti → corrispondenze → contraddizioni → incertezza |
| Regenerative Response Engine | Non esiste | Creare: costruzione del feedback a partire dai risultati della riflessione, con spiegazione sintetica del "perché" |
| Memory Engine | Non esiste | Creare: schema di memoria a 5 categorie con i campi richiesti dal brief, consenso, separazione utenti, cancellazione |
| Color Preference Engine | Non esiste | Creare: tavolozza, registrazione, confronto percettivo, feedback, modifica, eliminazione |
| Interfaccia utente | Non esiste | Creare: area conversazione, selettore cromatico, preferenze memorizzate, corrispondenze, stato memoria, controlli |
| Test | Non esistono | Creare: test unitari sulle parti deterministiche + test di interfaccia |
| Struttura di cartelle / documentazione | Non esiste (tutto nella radice) | Creare struttura minima per frontend, moduli, standard, test, docs |
| Dipendenze | Nessuna | Nessuna per il prototipo (vedi §5) |
| `LICENSE` | Assente | **Da decidere con il creatore**: senza licenza il repository pubblico resta "tutti i diritti riservati" per default; nessuno può legalmente riutilizzarlo |

---

## 3. Architettura esistente

**[FATTO]** Non esiste un'architettura software. Non c'è nulla da preservare come codice: esistono solo due documenti di testo. Pertanto non vi è alcun rischio di "cancellare lavoro svolto" e nessuna architettura preesistente da rispettare; la struttura proposta dal brief (§6) può essere adottata liberamente.

**[FATTO]** L'architettura **descritta a parole** dai due file è la seguente:

```
input utente (testo | immagine | suono | preferenza)
        |
        v
confronto con "standard written codes"   <-- le 9 regole cromatiche
        |
        v
esito del confronto
        |
        v
feedback all'utente
```

**[IPOTESI]** Il README descrive un sistema puramente **basato su regole e confronto**: "compares inputs ... with some already standard written codes". Non menziona reti neurali, addestramento o aggiornamento di pesi. L'unico meccanismo di adattamento descritto è la scrittura di nuovi "standard codes", cioè memoria esterna + aggiornamento di regole. Questo va tenuto fermo, perché è esattamente la distinzione richiesta dal §9 del brief tra regole, memoria e addestramento.

**[PROPOSTA]** Le tre fasi della pipeline del brief (Input Layer → Standard Code Layer → Reflection Engine → Regenerative Response Engine → Memory Engine) sono compatibili con questa descrizione; il Color Preference Engine diventa il primo modulo eseguibile che le attraversa tutte.

---

## 4. Principali problemi tecnici da risolvere

1. **Assenza totale di codice.** È il problema dominante: non c'è nulla di eseguibile. Tutto il resto è secondario finché non esiste un primo modulo funzionante.
2. **Le regole non sono eseguibili.** Sono frasi in inglese naturale, senza identificativo, senza priorità, senza versione, senza data e senza definizione dell'esito. Un programma non può leggerle in modo affidabile.
3. **"Accepted" non ha una definizione operativa.** Cosa deve fare il sistema quando una regola dice *accepted*? Rispondere in modo affermativo? Memorizzare? Cercare una corrispondenza? Il brief vieta di inventare: serve una decisione del creatore.
4. **"majesta color" non è un nome di colore standard.** In HTML/CSS esistono 148 nomi di colore validi; `majesta` non è tra questi. **[IPOTESI]** probabile refuso per "magenta", ma non va assunto: il brief vieta esplicitamente di inventare informazioni mancanti.
5. **Sovrapposizione percettiva tra i colori accettati.** `indigo`, `purple` e `violet` sono molto vicini, così come `green`/`blue`/`orange` al confine. Senza uno spazio colore definito il sistema non può distinguerli in modo misurabile. Serve una rappresentazione numerica (**[PROPOSTA]** HEX + RGB per la compatibilità, CIELAB per la percezione) e una metrica di distanza (**[PROPOSTA]** CIEDE2000, come suggerito al §4 del brief).
6. **Campo di applicazione delle regole non definito.** "Every input of green color" non dice se si applica a (a) un colore scelto dalla tavolozza, (b) un testo che nomina un colore, (c) il colore dominante di un'immagine. Sono tre comportamenti diversi; il sistema deve dichiarare quale sta usando.
7. **Set di standard incompleto e asimmetrico.** 7 colori sono accettati, 2 richiedono una domanda, tutti gli altri (nero, bianco, rosa, marrone, ciano… e qualsiasi colore intermedio) non sono coperti. Il sistema deve dichiarare "informazione non coperta" invece di estrapolare.
8. **Nessuna nozione di utente, consenso, cancellazione, separazione dei dati**, richiesta dal §3 e dal §5 del brief, ed essenziale appena si memorizzano preferenze.
9. **Nessuno schema di memoria.** I campi richiesti dal brief (identificativo, categoria, contenuto, origine, date, attendibilità, scadenza, stato di conferma) non sono modellati da nessuna parte.
10. **Nessun test e nessuna metrica.** Il brief chiede di non dichiarare completato un progetto solo perché l'interfaccia funziona; oggi non c'è alcuno strumento per misurare nulla.
11. **Affermazioni non supportate nella documentazione.** Il README originale promette un sistema "superior" a ChatGPT. Il §9 del brief richiede benchmark riproducibili prima di qualsiasi affermazione di superiorità: la documentazione va corretta per restare coerente con i propri principi.
12. **Scelta della lingua.** Il codice del progetto è in inglese, il creatore e il brief sono in italiano, l'interfaccia sarà usata da persone italiane. Va deciso (e documentato) cosa è in inglese (codice, chiavi, ID) e cosa in italiano (interfaccia, feedback).
13. **Nessuna licenza.** Un repository pubblico senza `LICENSE` non concede diritti di riuso.
14. **Deriva di aspettative da evitare.** Il confine tra "sistema a regole", "recupero da memoria" e "modello neurale riaddestrato" deve restare esplicito nel codice e nei documenti, altrimenti il progetto si attribuirà capacità che non possiede.

---

## 5. Proposta di primo prototipo funzionante

**Obiettivo del prototipo:** far funzionare la pipeline completa su un caso d'uso semplice e verificabile:

```
Input → Standard → Confronto → Feedback → Memoria → Recupero futuro
```

### 5.1 Scelte tecnologiche proposte

| Scelta | Motivo |
|---|---|
| **HTML + CSS + JavaScript (vanilla, ES Modules)**, nessun framework | Il creatore conosce HTML e CSS; il calcolo cromatico è aritmetica deterministica; nessuna dipendenza da installare o aggiornare. Il §6 del brief chiede componenti semplici e verificabili e il §7 chiede di evitare dipendenze inutili. |
| **Nessun backend in questa fase** | Un server non è necessario per il primo modulo. La memoria vive in `localStorage` nel browser dell'utente: nessun dato esce dal dispositivo, il che rende la privacy predefinita e facilita il consenso. |
| **Test con `node:test`** (integrato in Node.js) | Node.js 26 è già disponibile sulla macchina; `node:test` non richiede di installare nulla e permette di testare i moduli puri (spazio colore, riflessione, memoria con storage iniettato). |
| **Moduli puri separati dalla UI** | Gli stessi file in `modules/` sono usati dal browser e dai test Node: la logica è verificabile senza interfaccia grafica. |
| **Nessuna chiave API, nessun servizio esterno** | Richiesto dal §11 del brief. |

**[PROPOSTA] Quando servirà un backend (non ora):** memoria condivisa tra dispositivi, integrazione di un modello linguistico via API, elaborazione di immagini/audio con modelli reali. Fino a quel momento un backend sarebbe complessità non necessaria.

### 5.2 Struttura proposta (derivata da §6 del brief, adattata al prototipo)

```
ChatMT/
├── README.md                     # riscritto: stato reale, avvio, limiti
├── LICENSE                       # da decidere con il creatore
├── docs/
│   ├── fase-1-analisi.md         # questo documento
│   ├── architettura.md           # pipeline, moduli, interfacce
│   └── test.md                   # come eseguire i test e cosa verificano
├── standards/
│   └── usage-of-colours.json     # le 9 regole rese leggibili da una macchina
├── modules/
│   ├── color_engine/             # spazio colore, preferenze, confronto, feedback
│   ├── reflection/               # confronto input ↔ standard, incertezza
│   ├── response/                 # costruzione del feedback
│   └── memory/                   # record di memoria, storage, consenso
├── frontend/
│   ├── index.html
│   ├── css/styles.css
│   └── js/app.js                 # collega UI e moduli
└── tests/
    ├── color-engine.test.mjs
    ├── reflection.test.mjs
    ├── memory.test.mjs
    └── run-tests.mjs             # `node tests/run-tests.mjs`
```

Nota: `backend/` e `modules/image_engine` / `modules/audio_engine` **non** vengono creati ora, perché sarebbero cartelle vuote o simulate: il brief vieta di dichiarare implementato ciò che è solo simulato (§11). Verranno aggiunti nelle fasi 4 e 5, con le loro interfacce già definite in `docs/architettura.md`.

### 5.3 Cosa farà concretamente il prototipo

1. Mostra una tavolozza di colori (con valori HEX e RGB visibili).
2. L'utente seleziona un colore; **prima di memorizzare compare una richiesta di consenso esplicita**.
3. Il colore viene salvato come *preferenza* con tutti i campi del §3 del brief.
4. L'utente seleziona un secondo colore: il sistema calcola la distanza in CIELAB con CIEDE2000.
5. Il feedback distingue in modo netto:
   - la **misura** ("la distanza percettiva è X"),
   - la **regola** applicata dallo standard code layer,
   - il **giudizio**: due colori vicini *non* dimostrano che piacciano entrambi all'utente.
6. Se la regola pertinente non esiste o l'input non è valido, il sistema dichiara l'incertezza e chiede chiarimenti, invece di inventare.
7. Il pannello memoria mostra le preferenze salvate, con possibilità di **modificare** ed **eliminare**, e con l'indicazione dello stato (confermata / da confermare / scaduta).
8. Ogni risposta include una spiegazione sintetica: dati usati, regola applicata, livello di incertezza. Nessuna catena di ragionamento interna.

---

## 6. File da creare o modificare nella prima fase di sviluppo (Fase 2 — prototipo cromatico)

| # | File | Azione | Scopo |
|---|---|---|---|
| 1 | `standards/usage-of-colours.json` | creare | Le 9 regole in formato leggibile da una macchina: `id`, `colore`, `nome_originale`, `esito` (`accepted` / `question`), `domanda`, `versione`, `origine`. Il file originale `Usage Of Colours` resta invariato come fonte. |
| 2 | `modules/color_engine/color-space.js` | creare | Conversioni sRGB ↔ lineare ↔ XYZ ↔ CIELAB e formula CIEDE2000. |
| 3 | `modules/color_engine/color-engine.js` | creare | Parsing/validazione HEX e RGB, registro delle preferenze, confronto tra colori, generazione della parte di feedback relativa alla misura. |
| 4 | `modules/memory/memory-store.js` | creare | Record di memoria con i campi richiesti dal brief, categorie A–E, consenso, stato di conferma, separazione per utente, cancellazione; storage iniettato (browser o memoria volatile nei test). |
| 5 | `modules/reflection/reflection-engine.js` | creare | Confronto input ↔ standard, individuazione delle contraddizioni, stima dell'incertezza, output strutturato. |
| 6 | `modules/response/response-engine.js` | creare | Costruzione del feedback a partire dall'output della riflessione; separazione tra misura, giudizio e dichiarazione di incertezza. |
| 7 | `frontend/index.html` | creare | Struttura della schermata principale (§7 del brief). |
| 8 | `frontend/css/styles.css` | creare | Stile moderno, accessibile, senza dipendenze esterne. |
| 9 | `frontend/js/app.js` | creare | Collegamento tra interfaccia e moduli; gestione degli eventi. |
| 10 | `tests/color-engine.test.mjs` | creare | Test deterministici dello spazio colore e delle preferenze. |
| 11 | `tests/reflection.test.mjs` | creare | Test della riflessione. |
| 12 | `tests/memory.test.mjs` | creare | Test della memoria. |
| 13 | `tests/run-tests.mjs` | creare | Esecuzione dei test con `node:test`, senza dipendenze. |
| 14 | `docs/architettura.md`, `docs/test.md` | creare | Documentazione dell'architettura e dei test. |
| 15 | `README.md` | modificare | Riscrittura onesta: cosa c'è, cosa non c'è, come si avvia, come si eseguono i test, limiti scientifici. |
| 16 | `LICENSE` | creare (se il creatore lo decide) | Chiarire i diritti di riuso del repository pubblico. |

**Non verranno modificati**: `README.md` originale (contenuto conservato e citato) e `Usage Of Colours` originale (conservato come fonte delle regole, citato verbatim nello standard strutturato).

---

## 7. Piano di test per verificare il prototipo

### 7.1 Color Preference Engine

| Test | Cosa verifica |
|---|---|
| Registrazione di una preferenza | La preferenza viene scritta con tutti i campi richiesti |
| Recupero della preferenza | La preferenza viene riletta identica dopo un ricaricamento |
| Modifica della preferenza | Il colore e la data di aggiornamento cambiano, l'identificativo resta |
| Eliminazione della preferenza | Non resta alcun record associato all'utente |
| Confronto tra colori identici | Distanza esattamente 0 |
| Confronto tra colori differenti | Distanza > 0, coerente con il valore atteso |
| Conversioni di spazio colore | Valori noti e pubblicati (HEX → RGB → CIELAB) |
| Formula CIEDE2000 | Confronto con i valori di riferimento pubblicati (Sharma, Wu, Dalal, 2005); i valori saranno copiati dalla pubblicazione, non inventati |
| Input non valido | `#GGGGGG`, stringa vuota, `rgb(-1,0,0)` → errore esplicito, nessun record creato |

### 7.2 Reflection Engine

| Test | Cosa verifica |
|---|---|
| Input corrispondente a uno standard | Viene identificata la regola pertinente, con il suo ID |
| Input non corrispondente | Esito "nessuno standard pertinente", nessuna risposta inventata |
| Informazioni contraddittorie | La contraddizione è segnalata, non risolta arbitrariamente |
| Dati insufficienti | L'incertezza è dichiarata |
| Recupero corretto del contesto | Viene recuperata la preferenza pertinente e non quella di un altro utente |

### 7.3 Memory Engine

| Test | Cosa verifica |
|---|---|
| Persistenza | I dati sopravvivono a un nuovo caricamento dello storage |
| Recupero | Ricerca per categoria e per utente |
| Separazione tra utenti | I dati di un utente non compaiono per un altro |
| Aggiornamento | `updated_at` cambia, `created_at` no |
| Cancellazione | Il record non è più recuperabile |
| Consenso | Senza consenso esplicito non viene memorizzata alcuna preferenza |
| Scadenza | Un record scaduto non viene usato come contesto valido |

### 7.4 Metriche da registrare (solo dopo misurazione reale)

- Accuratezza delle operazioni deterministiche (conversioni, distanze).
- Qualità del recupero della memoria (casi corretti / casi totali).
- Tasso di risposte non supportate dalle informazioni disponibili (obiettivo: **zero**, ogni risposta non coperta deve dichiarare l'incertezza).
- Latenza misurata del confronto cromatico.
- Percentuale di correzioni dell'utente applicate correttamente.

**Regola fissata ora:** nel repository non verrà scritto alcun numero di prestazione che non derivi da un test eseguito e riproducibile, oppure che non sia etichettato esplicitamente come ipotesi.

---

## 8. Domande aperte per il creatore

Nessuna di queste va risolta inventando; sono bloccanti per la Fase 2.

### Esito (26 ottobre 2026)

Le domande 1, 2, 3, 4 e 7 hanno ricevuto risposta dal creatore e sono registrate in
`standards/usage-of-colours.json` (sezione `decisions`), con la loro conseguenza sul codice:

| Domanda | Risposta ricevuta | Conseguenza |
|---|---|---|
| 1. "majesta" | è **magenta `#FF00FF`** | regola mantenuta con il testo originale intatto e `colour_name: "magenta"` |
| 2. esito di "accepted" | risposta affermativa **e** memorizzazione della preferenza con consenso | nessuna scrittura senza `consent: true`, e nessuna scrittura automatica |
| 3. campo di applicazione | solo il **colore scelto dalla tavolozza** | testo, immagini e audio sollevano `UnsupportedInputError` |
| 4. lingua dell'interfaccia | **inglese** | interfaccia e risposte in inglese; codice e identificativi in inglese; documentazione per il creatore in italiano |
| 7. direzione tecnica | **sì, HTML/CSS/JS senza backend** per il prototipo | nessun server; il container Docker si limita a servire i file |

Restano aperte, e non bloccano la Fase 2:

- **5. Utenti**: il prototipo usa un solo profilo locale. La separazione tra utenti è
  implementata e verificata nei test, ma l'interfaccia non offre un selettore di profili.
- **6. Licenza**: il repository è ancora senza `LICENSE`. Finché non viene scelta, resta
  valido il default di un repository pubblico: tutti i diritti riservati. È l'unico punto del
  §6 che non è stato possibile chiudere senza una decisione del creatore.

1. **"majesta color"**: si intende *magenta*, un colore personalizzato con un valore preciso, o la regola va lasciata non interpretata (con incertezza dichiarata) finché non viene confermata?
2. **"accepted"**: cosa deve fare concretamente il sistema? Rispondere in modo affermativo, memorizzare la preferenza, oppure solo mostrare che la corrispondenza esiste?
3. **Campo di applicazione delle regole**: le regole cromatiche valgono per un colore scelto dalla tavolozza, per un testo che nomina un colore, o per entrambi?
4. **Lingua dell'interfaccia**: italiano, inglese o bilingue? (La proposta è: interfaccia e feedback in italiano, nomi di codice e identificativi in inglese.)
5. **Utenti**: un solo utente locale, oppure più profili separati sullo stesso dispositivo?
6. **Licenza**: il repository è pubblico; quale licenza si vuole adottare (o si vuole restare senza licenza, sapendo che questo impedisce il riuso legale da parte di terzi)?
7. **Conferma della direzione tecnica**: HTML/CSS/JS vanilla senza backend per il prototipo è accettabile, oppure si preferisce un backend Python fin dall'inizio?

---

## 9. Riepilogo: fatti verificati contro ipotesi

| Affermazione | Stato |
|---|---|
| Il repository contiene solo 2 file: `README.md` e `Usage Of Colours` | **[FATTO]** |
| Il repository ha 2 commit e un solo branch `main` | **[FATTO]** |
| Non esiste alcun codice, test, dipendenza o configurazione | **[FATTO]** |
| Le regole cromatiche sono 7 di accettazione + 2 di domanda | **[FATTO]** |
| L'app "funziona come ChatGPT ma è superiore" | **[NON SUPPORTATO]** — nessun artefatto eseguibile, nessun benchmark |
| Il sistema descritto è basato su regole + memoria, senza addestramento di reti neurali | **[IPOTESI]** da confermare |
| `majesta` è un refuso per `magenta` | **[IPOTESI]** da confermare |
| L'architettura a 5 fasi del brief è compatibile con quanto descritto nel README | **[PROPOSTA]** |
| Il prototipo cromatico può funzionare interamente nel browser | **[PROPOSTA]** da approvare |

---

## 10. Stato dopo la Fase 2

**FASE 2 — Prototipo cromatico: realizzata e verificata.** Rispetto al §6 sono stati creati tutti
i file elencati, più due aggiunte richieste dal creatore dopo l'analisi:

- `Dockerfile` e `.dockerignore` — servono l'applicazione con nginx, perché moduli ES e `fetch`
  richiedono HTTP;
- `tests/browser-checks.mjs` — 47 controlli sull'interfaccia in un browser reale, che coprono
  ciò che i test unitari non possono vedere;
- `README.md` riscritto: stato reale, avvio, test, limiti dichiarati, senza affermazioni di
  superiorità non misurate (come richiesto al §9 e al §11 del brief).

Risultati misurati, senza aggiunte non verificate: **41 test unitari superati**, **47 controlli
nel browser superati**, container Docker verificato. Sono in `docs/test.md`. Il difetto trovato
dai controlli nel browser (un pulsante di memorizzazione che non dichiarava lo stato
"non confermato" di un colore non coperto da standard) è stato corretto e il controllo è
rimasto come test di regressione.

L'architettura, le interfacce e le decisioni tecniche sono in `docs/architettura.md`.
Prossima fase possibile: **FASE 3**, allargare gli standard e rivedere le regole di incertezza
(vale a dire dare al sistema più materiale su cui riflettere), oppure **FASE 4**, il sistema
conversazionale, che richiede un modello linguistico.

---

## 11. Stato dopo il backend (28 ottobre 2026)

Il backend richiesto dal creatore è stato aggiunto senza modificare il frontend:

- regole per la ragione personale/cogente su rosso e giallo, con profilo `friendly` /
  `not_friendly`, displeasure e spiegazione differita;
- suggerimenti di sfondi tendenti ai cinque colori, ridotti per il profilo non friendly;
- crop, ridimensionamento, rotazione e conversione png/jpeg/bmp;
- API HTTP, memoria su file per utente, consenso obbligatorio, classificatore LLM opzionale.

Risultati misurati: **87 test automatici superati** (41 esistenti + 2 sulla memoria + 44 nei nuovi file), **47 controlli
nel browser rieseguiti** sul frontend invariato. Dettagli e limiti in `docs/backend-api.md` e
`docs/test.md`. La chiamata reale al provider LLM non è stata eseguita: non era disponibile una
chiave. Il frontend non è ancora collegato alle API.
