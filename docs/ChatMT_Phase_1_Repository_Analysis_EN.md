# ChatMT --- PHASE 1: Repository Analysis

-   **Analysis date:** October 26, 2026
-   **Repository analyzed:** `https://github.com/ChatMT-23/ChatMT`
    (remote `origin`, branch `main`)
-   **Existing commits:** `aad5575` --- "Add initial description of the
    app's functionality"; `ddba7c3` --- "Add color acceptance criteria"
-   **Project creator:** Francesco Bulla

------------------------------------------------------------------------

## 0. How the analysis was conducted

Methods used (all reproducible):

1.  Read all existing files (`git ls-files`, followed by reading their
    contents).
2.  Reviewed repository history (`git log --oneline --all`,
    `git branch -a`, `git remote -v`).
3.  Compared the results with the public GitHub page to rule out the
    possibility that the local clone was incomplete.

Throughout this document, the following labels are explicitly
distinguished:

-   **\[FACT\]** --- directly verified from files or Git commands.
-   **\[HYPOTHESIS\]** --- an unverified inference that must be
    confirmed with the creator.
-   **\[PROPOSAL\]** --- a suggested technical decision that has not yet
    been approved.

------------------------------------------------------------------------

## 1. Functionality the repository already has

**\[FACT\]** The repository contains **2 tracked files** and **2
commits**. It contains no source code.

  -----------------------------------------------------------------------
  File                                Actual contents
  ----------------------------------- -----------------------------------
  `README.md`                         A single paragraph (183 bytes)
                                      describing the app's operating
                                      principle.

  `Usage Of Colours`                  9 lines: 7 acceptance rules and 2
                                      rules requiring a question to be
                                      asked of the user.
  -----------------------------------------------------------------------

Contents of `README.md` (verbatim):

> This apps uses a regenerative ( Reflective) A.I system which compares
> inputs received from users with some already standard written codes
> which the App mimicks as his real identity

Contents of `Usage Of Colours` (verbatim):

    Every input of green color is accepted

    Every input of blue color is accepted

    Every input of orange color is accepted

    Every input of majesta color is accepted

    Every input of indigo is accepted

    Every input of purple is accepted

    Every input of violet is accepted

    Every input of Red should be questioned with # Why did you choose Red#

    Every input of yellow should be questioned with # Why did you choose Yellow #

### Summary: what exists and what does not

**Exists \[FACT\]:**

-   A prose description of the system's objective.
-   An initial **Standard Code Layer**: the 9 color rules, written in
    English.

**Does not exist \[FACT, verified with `git ls-files`\]:**

-   HTML, CSS, or JavaScript code.
-   Python or code in any other programming language.
-   A data format definition for the standards (JSON, YAML, database).
-   Any form of memory or persistence.
-   A Reflection Engine, Regenerative Response Engine, Memory Engine, or
    Color Preference Engine.
-   Tests of any kind; no CI configuration file.
-   Dependencies, build files, `requirements.txt`, or `package.json`.
-   `LICENSE`, `.gitignore`, `docs/`, or a folder structure.
-   Any files relating to users, consent, or privacy.

**\[FACT\] Central conclusion of this phase:** the project is currently
**a prose specification, not a program**. Any claim that "the app
works," "it is superior to ChatGPT," or "learning has been implemented"
is not currently supported by any executable artifact.

------------------------------------------------------------------------

## 2. Table: component, current status, required action

  -----------------------------------------------------------------------
  Component               Current status          Required action
  ----------------------- ----------------------- -----------------------
  `README.md`             One paragraph in        Rewrite it with an
                          English, including an   honest description,
                          unsubstantiated claim   installation and
                          of superiority          startup instructions,
                                                  stated limitations, and
                                                  a distinction between
                                                  rules, memory, and
                                                  models

  `Usage Of Colours`      9 rules in English      Preserve the original
                          prose, not              file and add a
                          machine-readable, with  structured version
                          no IDs or version       (`standards/`) with
                                                  IDs, operational
                                                  outcomes, and
                                                  versioning

  Standard Code Layer     Does not exist as code  Create standard
                                                  loading, validation,
                                                  versioning, and rules
                                                  for controlled updates

  Reflection Engine       Does not exist          Create feature
                                                  extraction → relevant
                                                  standards → matches →
                                                  contradictions →
                                                  uncertainty

  Regenerative Response   Does not exist          Generate feedback from
  Engine                                          reflection results,
                                                  with a concise
                                                  explanation of "why"

  Memory Engine           Does not exist          Create a five-category
                                                  memory schema with the
                                                  fields required by the
                                                  brief, consent, user
                                                  separation, and
                                                  deletion

  Color Preference Engine Does not exist          Create a palette,
                                                  recording, perceptual
                                                  comparison, feedback,
                                                  editing, and deletion

  User interface          Does not exist          Create a conversation
                                                  area, color selector,
                                                  saved preferences,
                                                  matches, memory status,
                                                  and controls

  Tests                   None exist              Create unit tests for
                                                  deterministic
                                                  components and
                                                  interface tests

  Folder structure /      Does not exist          Create a minimal
  documentation           (everything is in the   structure for the
                          root directory)         frontend, modules,
                                                  standards, tests, and
                                                  documentation

  Dependencies            None                    None for the prototype
                                                  (see §5)

  `LICENSE`               Missing                 **To be decided with
                                                  the creator**: without
                                                  a license, a public
                                                  repository remains "all
                                                  rights reserved" by
                                                  default; others cannot
                                                  legally reuse it
  -----------------------------------------------------------------------

------------------------------------------------------------------------

## 3. Existing architecture

**\[FACT\]** No software architecture exists. There is no code that
needs to be preserved: only two text documents exist. Therefore, there
is no risk of "deleting work already done" and no pre-existing
architecture that must be respected; the structure proposed in the brief
(§6) can be adopted freely.

**\[FACT\]** The architecture **described in words** by the two files is
as follows:

    user input (text | image | sound | preference)
            |
            v
    comparison with "standard written codes"  <-- the 9 color rules
            |
            v
    comparison result
            |
            v
    feedback to the user

**\[HYPOTHESIS\]** The README describes a system based purely on **rules
and comparison**: "compares inputs ... with some already standard
written codes". It does not mention neural networks, training, or weight
updates. The only adaptation mechanism described is writing new
"standard codes," i.e. external memory plus rule updates. This
distinction must be preserved because it is exactly the distinction
required by §9 of the brief between rules, memory, and training.

**\[PROPOSAL\]** The three pipeline stages in the brief (Input Layer →
Standard Code Layer → Reflection Engine → Regenerative Response Engine →
Memory Engine) are compatible with this description; the Color
Preference Engine becomes the first executable module to pass through
all of them.

------------------------------------------------------------------------

## 4. Main technical problems to solve

1.  **Complete absence of code.** This is the dominant problem: nothing
    is executable. Everything else is secondary until a first working
    module exists.
2.  **The rules are not executable.** They are natural-language English
    sentences with no identifier, priority, version, date, or defined
    outcome. A program cannot read them reliably.
3.  **"Accepted" has no operational definition.** What should the system
    do when a rule says *accepted*? Respond affirmatively? Store
    something? Look for a match? The brief forbids inventing details:
    the creator must decide.
4.  **"majesta color" is not a standard color name.** HTML/CSS supports
    148 valid color names; `majesta` is not one of them.
    **\[HYPOTHESIS\]** It is probably a typo for "magenta," but this
    must not be assumed: the brief explicitly forbids inventing missing
    information.
5.  **Perceptual overlap among accepted colors.** `indigo`, `purple`,
    and `violet` are very close, as are `green`/`blue`/`orange` in
    boundary cases. Without a defined color space, the system cannot
    distinguish them measurably. A numerical representation is needed
    (**\[PROPOSAL\]** HEX + RGB for compatibility, CIELAB for
    perception) as well as a distance metric (**\[PROPOSAL\]**
    CIEDE2000, as suggested in §4 of the brief).
6.  **The scope of the rules is undefined.** "Every input of green
    color" does not specify whether it applies to (a) a color selected
    from a palette, (b) text that names a color, or (c) the dominant
    color in an image. These are three different behaviors; the system
    must state which one it uses.
7.  **The set of standards is incomplete and asymmetric.** Seven colors
    are accepted, two require a question, and all others (black, white,
    pink, brown, cyan, and any intermediate color) are not covered. The
    system must state "information not covered" rather than
    extrapolating.
8.  **No concept of users, consent, deletion, or data separation**, as
    required by §§3 and 5 of the brief and essential as soon as
    preferences are stored.
9.  **No memory schema.** The fields required by the brief (identifier,
    category, content, source, dates, reliability, expiration,
    confirmation status) are not modeled anywhere.
10. **No tests or metrics.** The brief says not to declare a project
    complete merely because the interface works; currently, there is no
    tool for measuring anything.
11. **Unsupported claims in the documentation.** The original README
    promises a system "superior" to ChatGPT. §9 of the brief requires
    reproducible benchmarks before any superiority claim; the
    documentation must be corrected to remain consistent with its own
    principles.
12. **Language choice.** The project code is in English, while the
    creator and brief use Italian, and Italian users will use the
    interface. It must be decided and documented which parts are in
    English (code, keys, IDs) and which are in Italian (interface,
    feedback).
13. **No license.** A public repository without a `LICENSE` does not
    grant reuse rights.
14. **Avoiding expectation drift.** The boundary between a "rule-based
    system," "memory retrieval," and a "retrained neural model" must
    remain explicit in the code and documentation; otherwise, the
    project will claim capabilities it does not have.

------------------------------------------------------------------------

## 5. Proposal for the first working prototype

**Prototype objective:** make the complete pipeline work for a simple,
verifiable use case:

    Input → Standard → Comparison → Feedback → Memory → Future retrieval

### 5.1 Proposed technology choices

  -----------------------------------------------------------------------
  Choice                              Reason
  ----------------------------------- -----------------------------------
  **HTML + CSS + JavaScript (vanilla, The creator knows HTML and CSS;
  ES Modules), no framework**         color calculation is deterministic
                                      arithmetic; no dependencies need to
                                      be installed or updated. §6 of the
                                      brief asks for simple, verifiable
                                      components, and §7 asks to avoid
                                      unnecessary dependencies.

  **No backend at this stage**        A server is not necessary for the
                                      first module. Memory is stored in
                                      the user's browser using
                                      `localStorage`: no data leaves the
                                      device, making privacy the default
                                      and consent easier to manage.

  **Tests with `node:test`** (built   Node.js 26 is already available on
  into Node.js)                       the machine; `node:test` requires
                                      no installation and allows pure
                                      modules to be tested (color space,
                                      reflection, and memory with
                                      injected storage).

  **Pure modules separated from the   The same files in `modules/` are
  UI**                                used by the browser and Node tests:
                                      the logic can be verified without a
                                      graphical interface.

  **No API key, no external service** Required by §11 of the brief.
  -----------------------------------------------------------------------

**\[PROPOSAL\] When a backend will be needed (not now):** memory shared
across devices, integration with a language model via API, and
image/audio processing with real models. Until then, a backend would add
unnecessary complexity.

### 5.2 Proposed structure (derived from §6 of the brief and adapted to the prototype)

    ChatMT/
    ├── README.md                     # rewritten: actual status, startup, limitations
    ├── LICENSE                       # to be decided with the creator
    ├── docs/
    │   ├── phase-1-analysis.md       # this document
    │   ├── architecture.md           # pipeline, modules, interfaces
    │   └── tests.md                  # how to run tests and what they verify
    ├── standards/
    │   └── usage-of-colours.json     # the 9 rules in machine-readable format
    ├── modules/
    │   ├── color_engine/             # color space, preferences, comparison, feedback
    │   ├── reflection/               # input ↔ standard comparison, uncertainty
    │   ├── response/                 # feedback generation
    │   └── memory/                   # memory records, storage, consent
    ├── frontend/
    │   ├── index.html
    │   ├── css/styles.css
    │   └── js/app.js                 # connects UI and modules
    └── tests/
        ├── color-engine.test.mjs
        ├── reflection.test.mjs
        ├── memory.test.mjs
        └── run-tests.mjs             # `node tests/run-tests.mjs`

Note: `backend/` and `modules/image_engine` / `modules/audio_engine`
**will not** be created now, because they would be empty or simulated
folders: the brief forbids claiming that something simulated has been
implemented (§11). They will be added in phases 4 and 5, with their
interfaces already defined in `docs/architecture.md`.

### 5.3 What the prototype will actually do

1.  Display a color palette (with HEX and RGB values visible).
2.  The user selects a color; **an explicit consent request appears
    before it is stored**.
3.  The color is saved as a *preference*, with all fields required by §3
    of the brief.
4.  The user selects a second color; the system calculates the distance
    in CIELAB using CIEDE2000.
5.  The feedback clearly distinguishes:
    -   the **measurement** ("the perceptual distance is X"),
    -   the **rule** applied by the Standard Code Layer,
    -   the **judgment**: two colors being close does *not* prove that
        the user likes both.
6.  If the relevant rule does not exist or the input is invalid, the
    system states its uncertainty and asks for clarification instead of
    inventing information.
7.  The memory panel shows saved preferences and allows the user to
    **edit** and **delete** them, indicating their status (confirmed /
    pending confirmation / expired).
8.  Every response includes a concise explanation: data used, rule
    applied, and uncertainty level. No internal chain of thought is
    exposed.

------------------------------------------------------------------------

## 6. Files to create or modify in the first development stage (Phase 2 --- color prototype)

  --------------------------------------------------------------------------------------------------------
                     \# File                                        Action           Purpose
  --------------------- ------------------------------------------- ---------------- ---------------------
                      1 `standards/usage-of-colours.json`           create           The 9 rules in
                                                                                     machine-readable
                                                                                     format: `id`,
                                                                                     `colour`,
                                                                                     `original_name`,
                                                                                     `outcome` (`accepted`
                                                                                     / `question`),
                                                                                     `question`,
                                                                                     `version`, `source`.
                                                                                     The original
                                                                                     `Usage Of Colours`
                                                                                     file remains
                                                                                     unchanged as the
                                                                                     source.

                      2 `modules/color_engine/color-space.js`       create           sRGB ↔ linear ↔ XYZ ↔
                                                                                     CIELAB conversions
                                                                                     and the CIEDE2000
                                                                                     formula.

                      3 `modules/color_engine/color-engine.js`      create           HEX and RGB
                                                                                     parsing/validation,
                                                                                     preference registry,
                                                                                     color comparison, and
                                                                                     generation of the
                                                                                     measurement-related
                                                                                     part of the feedback.

                      4 `modules/memory/memory-store.js`            create           Memory records with
                                                                                     the fields required
                                                                                     by the brief,
                                                                                     categories A--E,
                                                                                     consent, confirmation
                                                                                     status, user
                                                                                     separation, and
                                                                                     deletion; injected
                                                                                     storage (browser or
                                                                                     volatile memory in
                                                                                     tests).

                      5 `modules/reflection/reflection-engine.js`   create           Input ↔ standard
                                                                                     comparison,
                                                                                     contradiction
                                                                                     detection,
                                                                                     uncertainty
                                                                                     estimation, and
                                                                                     structured output.

                      6 `modules/response/response-engine.js`       create           Generate feedback
                                                                                     from reflection
                                                                                     output; distinguish
                                                                                     measurement,
                                                                                     judgment, and
                                                                                     statements of
                                                                                     uncertainty.

                      7 `frontend/index.html`                       create           Main screen structure
                                                                                     (§7 of the brief).

                      8 `frontend/css/styles.css`                   create           Modern, accessible
                                                                                     styling without
                                                                                     external
                                                                                     dependencies.

                      9 `frontend/js/app.js`                        create           Connect the interface
                                                                                     and modules; handle
                                                                                     events.

                     10 `tests/color-engine.test.mjs`               create           Deterministic tests
                                                                                     for color space and
                                                                                     preferences.

                     11 `tests/reflection.test.mjs`                 create           Reflection tests.

                     12 `tests/memory.test.mjs`                     create           Memory tests.

                     13 `tests/run-tests.mjs`                       create           Run tests with
                                                                                     `node:test`, without
                                                                                     dependencies.

                     14 `docs/architecture.md`, `docs/tests.md`     create           Architecture and test
                                                                                     documentation.

                     15 `README.md`                                 modify           Honest rewrite: what
                                                                                     exists, what does
                                                                                     not, how to launch
                                                                                     it, how to run tests,
                                                                                     and scientific
                                                                                     limitations.

                     16 `LICENSE`                                   create (if the   Clarify reuse rights
                                                                    creator decides) for the public
                                                                                     repository.
  --------------------------------------------------------------------------------------------------------

**Will not be modified:** the original `README.md` (its content is
preserved and quoted) and the original `Usage Of Colours` (preserved as
the source of the rules and quoted verbatim in the structured standard).

------------------------------------------------------------------------

## 7. Test plan for verifying the prototype

### 7.1 Color Preference Engine

  -----------------------------------------------------------------------
  Test                                What it verifies
  ----------------------------------- -----------------------------------
  Register a preference               The preference is saved with all
                                      required fields

  Retrieve a preference               The preference is read back
                                      identically after reloading

  Edit a preference                   The color and update date change,
                                      while the identifier remains the
                                      same

  Delete a preference                 No record associated with the user
                                      remains

  Compare identical colors            Distance is exactly 0

  Compare different colors            Distance is \> 0 and consistent
                                      with the expected value

  Color-space conversions             Known, published values (HEX → RGB
                                      → CIELAB)

  CIEDE2000 formula                   Comparison with published reference
                                      values (Sharma, Wu, Dalal, 2005);
                                      values will be copied from the
                                      publication, not invented

  Invalid input                       `#GGGGGG`, an empty string,
                                      `rgb(-1,0,0)` → explicit error, no
                                      record created
  -----------------------------------------------------------------------

### 7.2 Reflection Engine

  -----------------------------------------------------------------------
  Test                                What it verifies
  ----------------------------------- -----------------------------------
  Input matches a standard            The relevant rule is identified,
                                      including its ID

  Input matches no standard           Outcome is "no relevant standard";
                                      no invented response

  Conflicting information             The contradiction is flagged, not
                                      resolved arbitrarily

  Insufficient data                   Uncertainty is stated

  Correct context retrieval           The relevant preference is
                                      retrieved, not another user's
                                      preference
  -----------------------------------------------------------------------

### 7.3 Memory Engine

  Test              What it verifies
  ----------------- --------------------------------------------------
  Persistence       Data survives reloading the storage
  Retrieval         Search by category and user
  User separation   One user's data does not appear for another
  Update            `updated_at` changes; `created_at` does not
  Deletion          The record can no longer be retrieved
  Consent           No preference is stored without explicit consent
  Expiration        An expired record is not used as valid context

### 7.4 Metrics to record (only after actual measurement)

-   Accuracy of deterministic operations (conversions, distances).
-   Memory retrieval quality (correct cases / total cases).
-   Rate of responses unsupported by available information (target:
    **zero**; every response not covered by the standards must state
    uncertainty).
-   Measured latency of color comparison.
-   Percentage of user corrections applied correctly.

**Rule established now:** no performance figure will be added to the
repository unless it comes from an executed, reproducible test or is
explicitly labelled as a hypothesis.

------------------------------------------------------------------------

## 8. Open questions for the creator

None of these questions should be resolved by inventing an answer; they
block Phase 2.

1.  **"majesta color"**: does this mean *magenta*, a custom color with a
    precise value, or should the rule remain uninterpreted (with
    uncertainty stated) until confirmed?
2.  **"accepted"**: what should the system actually do? Respond
    affirmatively, store the preference, or simply show that a match
    exists?
3.  **Scope of the rules**: do the color rules apply to a color selected
    from the palette, to text that names a color, or to both?
4.  **Interface language**: Italian, English, or bilingual? (The
    proposal is: interface and feedback in Italian, code names and
    identifiers in English.)
5.  **Users**: a single local user, or multiple separate profiles on the
    same device?
6.  **License**: the repository is public; which license should be
    adopted (or should it remain unlicensed, knowing that this prevents
    third parties from legally reusing it)?
7.  **Confirmation of technical direction**: is vanilla HTML/CSS/JS with
    no backend acceptable for the prototype, or would you prefer a
    Python backend from the beginning?

------------------------------------------------------------------------

## 9. Summary: verified facts versus hypotheses

  -----------------------------------------------------------------------
  Statement                           Status
  ----------------------------------- -----------------------------------
  The repository contains only 2      **\[FACT\]**
  files: `README.md` and              
  `Usage Of Colours`                  

  The repository has 2 commits and a  **\[FACT\]**
  single `main` branch                

  No code, tests, dependencies, or    **\[FACT\]**
  configuration exist                 

  The color rules consist of 7        **\[FACT\]**
  acceptance rules + 2 question rules 

  The app "works like ChatGPT but is  **\[UNSUPPORTED\]** --- no
  superior"                           executable artifact and no
                                      benchmark

  The described system is based on    **\[HYPOTHESIS\]** to be confirmed
  rules + memory, without             
  neural-network training             

  `majesta` is a typo for `magenta`   **\[HYPOTHESIS\]** to be confirmed

  The brief's five-stage architecture **\[PROPOSAL\]**
  is compatible with the README       
  description                         

  The color prototype can run         **\[PROPOSAL\]** to be approved
  entirely in the browser             
  -----------------------------------------------------------------------

------------------------------------------------------------------------

## 10. Next step

Once the questions in §8 have been answered, it will be possible to
implement **PHASE 2 --- Color Prototype**: the files listed in §6, with
the tests in §7 actually run and their results reported in
`docs/tests.md`, without adding anything that has not been measured.
