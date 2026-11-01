/**
 * ChatMT frontend — chat-style (Create Your Flyer).
 *
 * The page holds no data: it asks the backend for the palette, the answer, the profile, the
 * memory and the background suggestions, and it renders what it receives. There is no
 * localStorage path, so what the page shows and what the server stored cannot diverge.
 *
 * Chat layer: every colour pick and every reason also appends a bubble to #chat-thread.
 * All detail panels (#answer, #suggestions, #profile, ...) stay as the source of truth
 * for the automated checks; the thread is a short conversational mirror of the same data.
 *
 * Deliberate choices, recorded so they can be reviewed:
 * - no innerHTML anywhere. The SVG of a suggestion is a string produced by the backend, so it is
 *   never parsed into the document: the preview is the equivalent CSS gradient, which is
 *   inserted as a style value, and the markup itself is only quoted as text;
 * - the app never chooses a background. A suggestion becomes the chosen one only when the user
 *   presses its button, and only then is the preview painted;
 * - the delay of the lesser effort is measured in the browser: the declared value comes from
 *   standards/colour-meanings.json, the measured one is shown next to it.
 */

const USER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

// ---------------------------------------------------------------------------------------
// Tiny DOM helper (no innerHTML, no template literals with data)
// ---------------------------------------------------------------------------------------

function h(tag, options = {}, ...children) {
  const node = document.createElement(tag);
  if (options.class) node.className = options.class;
  if (options.text !== undefined) node.textContent = String(options.text);
  for (const [name, value] of Object.entries(options.attrs ?? {})) {
    if (value === false || value === null || value === undefined) continue;
    node.setAttribute(name, value === true ? '' : String(value));
  }
  for (const [event, handler] of Object.entries(options.on ?? {})) {
    node.addEventListener(event, handler);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child);
  }
  return node;
}

function formatTimestamp(isoString) {
  if (!isoString) return '—';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return isoString;
  return date.toLocaleString();
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------

const params = new URLSearchParams(window.location.search);
const requestedUser = params.get('user');

const dom = {
  status: document.getElementById('app-status'),
  userId: document.getElementById('user-id'),
  apiBase: document.getElementById('api-base'),
  llmState: document.getElementById('llm-state'),
  themeToggle: document.getElementById('theme-toggle'),
  themeValue: document.getElementById('theme-value'),
  spectralRegister: document.getElementById('spectral-register'),
  heroSpecimenField: document.getElementById('hero-specimen-field'),
  heroSpecimenName: document.getElementById('hero-specimen-name'),
  heroSpecimenHex: document.getElementById('hero-specimen-hex'),
  paletteCovered: document.getElementById('palette-covered'),
  paletteUncovered: document.getElementById('palette-uncovered'),
  paletteRainbow: document.getElementById('palette-rainbow'),
  chatThread: document.getElementById('chat-thread'),
  chatForm: document.getElementById('chat-form'),
  chatInput: document.getElementById('chat-input'),
  correctionHint: document.getElementById('correction-empty-hint'),
  imageFile: document.getElementById('image-file'),
  imagePreview: document.getElementById('image-preview'),
  imageEmpty: document.getElementById('image-empty'),
  imageBrighten: document.getElementById('image-brighten'),
  imageBrightenValue: document.getElementById('image-brighten-value'),
  imageReset: document.getElementById('image-reset'),
  imageCropX: document.getElementById('image-crop-x'),
  imageCropY: document.getElementById('image-crop-y'),
  imageCropW: document.getElementById('image-crop-w'),
  imageCropH: document.getElementById('image-crop-h'),
  imageApplyCrop: document.getElementById('image-apply-crop'),
  imageStatus: document.getElementById('image-status'),
  selection: document.getElementById('selection'),
  consent: document.getElementById('consent'),
  consentNote: document.getElementById('consent-note'),
  clearMemory: document.getElementById('clear-memory'),
  reasonBlock: document.getElementById('reason-block'),
  reasonLabel: document.getElementById('reason-label'),
  reasonInput: document.getElementById('reason-input'),
  reasonSend: document.getElementById('reason-send'),
  delayNotice: document.getElementById('delay-notice'),
  answer: document.getElementById('answer'),
  profile: document.getElementById('profile'),
  standingMessages: document.getElementById('standing-messages'),
  designType: document.getElementById('design-type'),
  designSubject: document.getElementById('design-subject'),
  designAudience: document.getElementById('design-audience'),
  designUpdate: document.getElementById('design-update'),
  suggestions: document.getElementById('suggestions'),
  chosenBackground: document.getElementById('chosen-background'),
  backgroundPreview: document.getElementById('background-preview'),
  backgroundColour: document.getElementById('background-colour'),
  backgroundAsk: document.getElementById('background-ask'),
  backgroundQuestion: document.getElementById('background-question'),
  backgroundQuestionLabel: document.getElementById('background-question-label'),
  backgroundReason: document.getElementById('background-reason'),
  backgroundSend: document.getElementById('background-send'),
  backgroundResult: document.getElementById('background-result'),
  composeRun: document.getElementById('compose-run'),
  composeStatus: document.getElementById('compose-status'),
  composePreview: document.getElementById('compose-preview'),
  composeEmpty: document.getElementById('compose-empty'),
  composeCaption: document.getElementById('compose-caption'),
  composeDownload: document.getElementById('compose-download'),
  composeNotes: document.getElementById('compose-notes'),
  matches: document.getElementById('matches'),
  memoryStatus: document.getElementById('memory-status'),
  memoryList: document.getElementById('memory-list'),
  correction: document.getElementById('correction'),
  correctionOutcome: document.getElementById('correction-outcome'),
  correctionNote: document.getElementById('correction-note'),
  correctionRecord: document.getElementById('correction-record'),
  why: document.getElementById('why')
};

const state = {
  userId: requestedUser !== null && USER_ID_PATTERN.test(requestedUser) ? requestedUser : 'local-user',
  api: null,
  palette: [],
  designTypes: [],
  selection: null,
  response: null,
  profile: null,
  delayMeasuredMs: null,
  chosenBackground: null,
  backgroundQuestionColour: null,
  requestToken: 0,
  imageOriginal: null,
  brighten: 100,
  composeUrl: null
};

const RAINBOW_ORDER = ['red', 'orange', 'yellow', 'green', 'blue', 'indigo', 'violet'];

// ---------------------------------------------------------------------------------------
// Chat thread (conversational mirror; detail panels stay authoritative for tests)
// ---------------------------------------------------------------------------------------

function scrollChat() {
  const thread = dom.chatThread;
  if (!thread) return;
  const last = thread.lastElementChild;
  if (!last) return;

  // The thread sits above the palette. Scrolling it into view on every bubble would pull the
  // page away while the user is choosing a colour, so only follow the conversation when part of
  // it is already on screen.
  const bounds = thread.getBoundingClientRect();
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
  if (bounds.bottom <= 0 || bounds.top >= viewportHeight) return;

  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
  try {
    last.scrollIntoView({ block: 'nearest', behavior: reducedMotion ? 'auto' : 'smooth' });
  } catch { /* never break the flow for scrolling */ }
}

function addUserBubble(text) {
  if (!dom.chatThread) return;
  dom.chatThread.append(
    h('div', { class: 'msg msg-user' },
      h('div', { class: 'msg-avatar', attrs: { 'aria-hidden': 'true' }, text: 'You' }),
      h('div', { class: 'msg-body' }, h('p', { text: text })))
  );
  scrollChat();
}

function addAssistantBubble({ tone, title, lines }) {
  if (!dom.chatThread) return null;
  const body = h('div', { class: 'msg-body' });
  const meta = h('div', { class: 'msg-meta' });
  if (tone === 'friendly') meta.append(h('span', { class: 'msg-tone-friendly', text: 'friendly' }));
  else if (tone === 'grumpy') meta.append(h('span', { class: 'msg-tone-grumpy', text: 'less enthusiastic' }));
  if (meta.childElementCount > 0) body.append(meta);
  if (title) body.append(h('p', { text: title }));
  for (const line of lines ?? []) body.append(h('p', { class: 'hint', text: line }));
  const wrap = h('div', { class: 'msg msg-assistant' },
    h('div', { class: 'msg-avatar', attrs: { 'aria-hidden': 'true' }, text: 'MT' }), body);
  dom.chatThread.append(wrap);
  scrollChat();
  return wrap;
}

function showTyping() {
  if (!dom.chatThread || document.getElementById('chat-typing')) return;
  const body = h('div', { class: 'msg-body', attrs: { id: 'chat-typing-body' } },
    h('span', { class: 'typing', attrs: { 'aria-hidden': 'true' } }, h('i'), h('i'), h('i')));
  const wrap = h('div', { class: 'msg msg-assistant', attrs: { id: 'chat-typing' } },
    h('div', { class: 'msg-avatar', attrs: { 'aria-hidden': 'true' }, text: 'MT' }), body);
  dom.chatThread.append(wrap);
  scrollChat();
}

function hideTyping() {
  document.getElementById('chat-typing')?.remove();
}

// ---------------------------------------------------------------------------------------
// Theme: white (the ink register) and blue (the blueprint)
// ---------------------------------------------------------------------------------------

const THEMES = ['white', 'blue'];

/**
 * The theme lives in the page, not in storage: `?theme=blue` reopens the blueprint, and the
 * switch rewrites the address so a reload keeps the choice. Nothing is written to localStorage,
 * like every other piece of state in this page: the server and the URL are the only memory.
 */
function applyTheme(theme) {
  const next = THEMES.includes(theme) ? theme : 'white';
  document.documentElement.dataset.theme = next;
  dom.themeToggle?.setAttribute('aria-pressed', String(next === 'blue'));
  if (dom.themeValue) dom.themeValue.textContent = next;
  const url = new URL(window.location.href);
  if (url.searchParams.get('theme') === next) return;
  url.searchParams.set('theme', next);
  window.history.replaceState(null, '', url);
}

dom.themeToggle?.addEventListener('click', () => {
  applyTheme(document.documentElement.dataset.theme === 'blue' ? 'white' : 'blue');
});

applyTheme(params.get('theme') ?? 'white');

dom.userId.textContent = state.userId;
dom.apiBase.textContent = '/api';
state.api = new URL('/api/', window.location.origin);

// ---------------------------------------------------------------------------------------
// API client
// ---------------------------------------------------------------------------------------

async function api(pathname, { method = 'GET', body } = {}) {
  const url = new URL(pathname.replace(/^\//, ''), state.api);
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } catch (error) {
    throw new Error(
      `The backend is not reachable at ${url.origin} (${error.message}). Start it with "npm start" in the project folder.`
    );
  }
  const text = await response.text();
  const payload = text === '' ? null : JSON.parse(text);
  if (!response.ok) {
    const error = new Error(payload?.error?.message ?? `HTTP ${response.status} from ${url.pathname}`);
    // The code travels with the error so a panel can explain the refusal instead of only
    // repeating the server sentence.
    error.code = payload?.error?.code ?? null;
    error.status = response.status;
    throw error;
  }
  return payload;
}

function showStatus(message) {
  dom.status.hidden = false;
  dom.status.textContent = message;
}

function clearStatus() {
  dom.status.hidden = true;
  dom.status.textContent = '';
}

function designContext() {
  const type = dom.designType.value === '' ? 'flyer' : dom.designType.value;
  const subject = dom.designSubject.value.trim();
  const audience = dom.designAudience.value.trim();
  return {
    type,
    ...(subject === '' ? {} : { subject }),
    ...(audience === '' ? {} : { audience })
  };
}

// ---------------------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------------------

async function init() {
  try {
    const [palette, types, health] = await Promise.all([api('/palette'), api('/design/types'), api('/health')]);
    state.palette = palette.colours;
    state.designTypes = types.types;
    renderLlmState(health?.llm ?? null);
  } catch (error) {
    showStatus(error.message);
    return;
  }

  renderPalette();
  renderSpectralRegister();
  renderDesignTypes();
  renderPlaceholders();
  syncComposeButton();

  await Promise.all([refreshProfile(), refreshMemory()]);
}

/**
 * The model line in the press bar. It states what the server reported, and it never shows the
 * key: /api/health returns whether a model is configured, its name and how it thinks.
 */
function renderLlmState(llm) {
  if (!dom.llmState) return;
  if (llm?.configured) {
    const mode = llm.thinking === 'disabled' ? 'thinking off' : `thinking ${llm.reasoning_effort ?? 'high'}`;
    dom.llmState.textContent = `${llm.model} · ${mode}`;
    dom.llmState.title =
      'The reason of a red or yellow choice is sent to this model only when the declared rules cannot decide. The key stays on the server.';
    return;
  }
  dom.llmState.textContent = 'not configured';
  dom.llmState.title =
    'No key in .env: an ambiguous reason stays undecided, and nothing is stored. Set DEEPSEEK_API_KEY and restart the server.';
}

function renderDesignTypes() {
  dom.designType.replaceChildren(
    ...state.designTypes.map((type) =>
      h('option', { text: `${type.label} (${type.width}×${type.height})`, attrs: { value: type.id } })
    )
  );
  dom.designType.value = 'flyer';
}

function renderPlaceholders() {
  dom.selection.replaceChildren(h('p', { class: 'hint', text: 'No colour selected yet.' }));
  dom.matches.replaceChildren(h('p', { class: 'hint', text: 'Nothing to show yet.' }));
  dom.why.replaceChildren(
    h('p', { class: 'hint', text: 'The data used, the rules applied and the uncertainty are listed here, in short form.' })
  );
  dom.profile.replaceChildren(h('p', { class: 'hint', text: 'No answer yet, so the profile has not been read.' }));
  dom.standingMessages.replaceChildren(h('p', { class: 'hint', text: 'Nothing is due.' }));
  dom.correction.hidden = true;
  renderHeroSpecimen(null);
}

// ---------------------------------------------------------------------------------------
// The two visual registers: the ink strip in the header and the current specimen plate
// ---------------------------------------------------------------------------------------

function renderSpectralRegister() {
  if (!dom.spectralRegister) return;
  dom.spectralRegister.replaceChildren(
    ...state.palette
      .filter((colour) => colour.covered)
      .map((colour) =>
        h('span', {
          class: 'spectral-chip',
          attrs: {
            style: `background:${colour.hex}`,
            'data-hex': colour.hex,
            title: `${colour.name} ${colour.hex}`
          }
        })
      )
  );
}

function renderHeroSpecimen(colour) {
  if (!dom.heroSpecimenField) return;
  if (!colour) {
    dom.heroSpecimenField.removeAttribute('style');
    dom.heroSpecimenField.classList.add('is-empty');
    if (dom.heroSpecimenName) dom.heroSpecimenName.textContent = 'No specimen';
    if (dom.heroSpecimenHex) dom.heroSpecimenHex.textContent = '—';
    for (const chip of dom.spectralRegister?.children ?? []) chip.classList.remove('is-active');
    return;
  }
  dom.heroSpecimenField.style.background = colour.hex;
  dom.heroSpecimenField.classList.remove('is-empty');
  if (dom.heroSpecimenName) dom.heroSpecimenName.textContent = colour.name;
  if (dom.heroSpecimenHex) dom.heroSpecimenHex.textContent = colour.hex;
  for (const chip of dom.spectralRegister?.children ?? []) {
    chip.classList.toggle('is-active', chip.getAttribute('data-hex') === colour.hex);
  }
}

// ---------------------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------------------

function paletteButton(colour) {
  const badge = colour.questioned
    ? h('span', { class: 'badge badge-warn', text: 'questioned' })
    : colour.equivalent
      ? h('span', { class: 'badge badge-ok', text: `same as ${colour.same_as}` })
      : colour.encouraged
        ? h('span', { class: 'badge badge-ok', text: 'encouraged' })
        : null;

  return h(
    'button',
    {
      class: 'swatch-button',
      attrs: {
        type: 'button',
        'aria-pressed': state.selection?.hex === colour.hex ? 'true' : 'false',
        'aria-label': `${colour.name} ${colour.hex}`
      },
      on: { click: () => selectColour(colour) }
    },
    h('span', { class: 'swatch', attrs: { style: `background:${colour.hex}`, 'aria-hidden': 'true' } }),
    h('span', { class: 'swatch-name', text: colour.name }),
    h('span', { class: 'swatch-hex', text: colour.hex }),
    badge
  );
}

function renderPalette() {
  const covered = state.palette.filter((colour) => colour.covered);
  const uncovered = state.palette.filter((colour) => !colour.covered);
  dom.paletteCovered.replaceChildren(...covered.map(paletteButton));
  dom.paletteUncovered.replaceChildren(...uncovered.map(paletteButton));
  if (dom.paletteRainbow) {
    const byName = new Map(state.palette.map((c) => [String(c.name).toLowerCase(), c]));
    const rainbow = RAINBOW_ORDER.map((name) => byName.get(name)).filter(Boolean);
    dom.paletteRainbow.replaceChildren(...rainbow.map(paletteButton));
  }
}

async function selectColour(colour) {
  state.selection = colour;
  state.response = null;
  state.delayMeasuredMs = null;
  state.chosenBackground = null;
  state.backgroundQuestionColour = null;
  dom.reasonInput.value = '';
  dom.reasonBlock.hidden = true;
  dom.delayNotice.hidden = true;
  dom.correction.hidden = true;
  if (dom.correctionHint) dom.correctionHint.hidden = false;
  dom.backgroundQuestion.hidden = true;
  dom.chosenBackground.replaceChildren(h('p', { class: 'hint', text: 'No background chosen by you yet.' }));
  dom.backgroundPreview.hidden = true;
  dom.backgroundPreview.removeAttribute('style');
  addUserBubble(`I choose ${colour.name} (${colour.hex})`);
  dom.answer.replaceChildren(h('p', { class: 'hint', text: 'Waiting for the backend…' }));
  renderSelection();
  renderPalette();
  syncComposeButton();
  await interact({ reason: null });
}

// ---------------------------------------------------------------------------------------
// Interaction
// ---------------------------------------------------------------------------------------

async function interact({ reason }) {
  if (state.selection === null) return;
  const token = ++state.requestToken;
  const body = {
    userId: state.userId,
    colour: { name: state.selection.name, hex: state.selection.hex },
    consent: dom.consent.checked,
    design: designContext()
  };
  if (typeof reason === 'string' && reason.trim() !== '') body.reason = reason.trim();

  showTyping();
  try {
    const response = await api('/interactions', { method: 'POST', body });
    if (token !== state.requestToken) return;
    clearStatus();
    await applyDelay(
      response,
      () => {
        if (token === state.requestToken) renderResponse(response);
      },
      () => token === state.requestToken
    );
    if (token !== state.requestToken) return;
    await refreshMemory();
  } catch (error) {
    if (token !== state.requestToken) return;
    hideTyping();
    showStatus(error.message);
    dom.answer.replaceChildren(h('p', { class: 'hint', text: 'The backend did not answer. Nothing was stored.' }));
    dom.delayNotice.hidden = true;
  }
}

/**
 * The lesser effort delays the outputs. The value is declared by the backend; the time actually
 * waited is measured here, so the page can show both instead of claiming the declared value.
 * `isCurrent` lets a superseded request stop before it touches the shared panels or the typing
 * indicator that a newer request now owns.
 */
async function applyDelay(response, render, isCurrent = () => true) {
  const delay = response?.display?.delay_ms ?? response?.profile?.display_delay_ms ?? 0;
  if (!isCurrent()) return;
  dom.delayNotice.hidden = true;
  state.delayMeasuredMs = 0;

  if (typeof delay === 'number' && delay > 0) {
    dom.delayNotice.hidden = false;
    dom.delayNotice.textContent = `Lesser effort: this profile is not friendly, so the answer waits ${delay} ms before it is displayed.`;
    const startedAt = performance.now();
    await sleep(delay);
    if (!isCurrent()) return;
    state.delayMeasuredMs = Math.round(performance.now() - startedAt);
    dom.delayNotice.textContent = `Lesser effort: declared delay ${delay} ms, measured ${state.delayMeasuredMs} ms.`;
  }
  if (!isCurrent()) return;
  hideTyping();
  render();
}

function renderResponse(response) {
  state.response = response;
  state.profile = response.profile;

  renderPalette();
  renderSelection();
  renderAnswer(response);
  renderProfile(response.profile);
  renderStandingMessages(response.standingMessages);
  renderMatches(response);
  renderWhy(response);
  renderSuggestions(dom.suggestions, response.designSuggestions);
  dom.correction.hidden = false;
  if (dom.correctionHint) dom.correctionHint.hidden = true;
  renderReasonBlock();
  const friendly = response.profile?.level === 'friendly';
  const count = response.designSuggestions?.suggestions?.length ?? 0;
  const lines = [];
  if (response.answer?.question) lines.push(response.answer.question);
  lines.push(count > 0 ? `I suggested ${count} background${count === 1 ? '' : 's'} below — you choose.` : 'No background suggestions this time.');
  if (response.profile?.level === 'not_friendly') lines.push('Small delay + fewer suggestions: that is the lesser effort for a not friendly profile.');
  addAssistantBubble({ tone: friendly ? 'friendly' : 'grumpy', title: response.answer?.headline ?? 'ChatMT answered.', lines });
}

// ---------------------------------------------------------------------------------------
// Selection and reason
// ---------------------------------------------------------------------------------------

function renderSelection() {
  const colour = state.selection;
  if (colour === null) {
    dom.selection.replaceChildren(h('p', { class: 'hint', text: 'No colour selected yet.' }));
    renderHeroSpecimen(null);
    return;
  }

  renderHeroSpecimen(colour);

  const meanings = colour.meanings === null ? 'no meaning is recorded for this colour' : colour.meanings.join(' or ');
  dom.selection.replaceChildren(
    h(
      'div',
      { class: 'lab-row' },
      h('span', {
        class: 'big-swatch',
        attrs: { style: `background:${colour.hex}`, role: 'img', 'aria-label': `Selected colour ${colour.name} ${colour.hex}` }
      }),
      h(
        'div',
        {},
        h('h3', { text: colour.name }),
        h('p', {
          class: 'hint',
          text: colour.covered ? 'This colour has a standard code.' : 'This colour has no standard code.'
        }),
        h('p', { class: 'hint', text: `Meaning recorded: ${meanings}.` })
      )
    )
  );
}

function renderReasonBlock() {
  const questioned = state.selection?.questioned === true;
  dom.reasonBlock.hidden = !questioned;
  if (!questioned) return;
  const question = state.response?.answer?.question;
  dom.reasonLabel.textContent = question ?? `Why did you choose ${state.selection.name}?`;
}

async function sendReason() {
  const value = dom.reasonInput.value.trim();
  if (value === '') {
    dom.reasonInput.focus();
    showStatus('The standard asks a question: write an answer before sending it.');
    return;
  }
  addUserBubble(value);
  await interact({ reason: value });
}

// ---------------------------------------------------------------------------------------
// Answer
// ---------------------------------------------------------------------------------------

function renderAnswer(response) {
  const answer = response.answer;
  const nodes = [h('p', { class: 'answer-headline', text: answer.headline })];

  for (const paragraph of answer.paragraphs) {
    nodes.push(h('p', { class: 'answer-paragraph', text: paragraph }));
  }

  if (answer.measurement !== null) {
    nodes.push(
      h(
        'div',
        { class: 'answer-block' },
        h('h4', { text: 'Measurement' }),
        h('p', { text: answer.measurement.sentence }),
        h('p', {
          class: 'hint',
          text: `Compared with: ${answer.measurement.comparedWith.name ?? ''} ${answer.measurement.comparedWith.hex}`
        })
      )
    );
  }

  nodes.push(
    h('div', { class: 'answer-block judgement' }, h('h4', { text: 'Not a judgement about you' }), h('p', { text: answer.judgement }))
  );

  if (answer.question !== null) {
    nodes.push(h('p', { class: 'question', text: answer.question }));
  }

  if (answer.reasonAssessment !== null && answer.reasonAssessment !== undefined) {
    const assessment = answer.reasonAssessment;
    nodes.push(
      h(
        'div',
        { class: 'answer-block' },
        h('h4', { text: 'How the reason was read' }),
        h('p', {
          text:
            `Verdict: ${assessment.verdict}${assessment.reason_present === false ? ' (no reason was given)' : ''} · ` +
            `method: ${assessment.method} · confidence: ${assessment.confidence}.`
        }),
        ...(assessment.explanation ?? []).map((line) => h('p', { class: 'hint', text: line }))
      )
    );
  }

  nodes.push(
    h(
      'div',
      { class: 'answer-block' },
      h('h4', { text: 'Storing this interaction' }),
      h('p', { text: answer.storage.explanation })
    )
  );

  if (answer.policyNotice !== null) {
    nodes.push(h('p', { class: 'answer-paragraph', text: answer.policyNotice }));
  }

  dom.answer.replaceChildren(...nodes);
}

function renderStandingMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    dom.standingMessages.replaceChildren(h('p', { class: 'hint', text: 'Nothing is due at this interaction.' }));
    return;
  }
  dom.standingMessages.replaceChildren(
    ...messages.map((message) =>
      h('div', { class: 'message' }, h('span', { class: 'badge badge-warn', text: message.code }), h('p', { text: message.text }))
    )
  );
}

// ---------------------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------------------

async function refreshProfile() {
  try {
    const standing = await api(`/users/${encodeURIComponent(state.userId)}/standing`);
    state.profile = standing.profile;
    renderProfile(standing.profile);
  } catch (error) {
    dom.profile.replaceChildren(h('p', { class: 'hint', text: `The profile could not be read: ${error.message}` }));
  }
}

/**
 * One fact of the profile, as a label and a value. The label keeps its trailing colon and space
 * so that the text of the panel still reads "background suggestions: 5" as a single string.
 */
function profileFact(key, value) {
  return h(
    'div',
    { class: 'fact' },
    h('span', { class: 'fact-k', text: `${key}: ` }),
    h('span', { class: 'fact-v', text: String(value) })
  );
}

function renderProfile(profile) {
  if (!profile) {
    dom.profile.replaceChildren(h('p', { class: 'hint', text: 'No profile available.' }));
    return;
  }
  const level = profile.level === 'friendly' ? 'badge-ok' : 'badge-conflict';

  dom.profile.replaceChildren(
    h('div', { class: 'profile-head' }, h('span', { class: `badge ${level}`, text: profile.level })),
    h(
      'div',
      { class: 'profile-facts' },
      profileFact('effort', profile.effort),
      profileFact('background suggestions', profile.suggestion_limit),
      profileFact('delay before the outputs', `${profile.display_delay_ms} ms`),
      profileFact('detail', profile.detail),
      profileFact('red or yellow backgrounds', profile.allow_questioned_colours ? 'unlocked' : 'locked')
    ),
    h('p', { class: 'hint', text: profile.why }),
    h('p', {
      class: 'hint',
      text:
        profile.last_decision === null
          ? 'No decision about red or yellow is recorded for this user.'
          : `Last decision: ${profile.last_decision.verdict} on ${profile.last_decision.colour_name} ` +
            `(${profile.last_decision.method}, confidence ${profile.last_decision.confidence}).`
    })
  );
}

// ---------------------------------------------------------------------------------------
// Matches, contradictions, uncertainty
// ---------------------------------------------------------------------------------------

function renderMatches(response) {
  const answer = response.answer;
  const nodes = [];

  nodes.push(h('h3', { text: 'Standards that matched' }));
  if (answer.appliedRules.length === 0) {
    nodes.push(h('p', { class: 'hint', text: 'No standard code matched this colour.' }));
  } else {
    nodes.push(
      h(
        'ul',
        {},
        answer.appliedRules.map((rule) =>
          h(
            'li',
            {},
            h('span', { class: `badge ${rule.outcome === 'accepted' ? 'badge-ok' : 'badge-warn'}`, text: rule.outcome }),
            `${rule.id} (${rule.colour_name}) — "${rule.source_text}"`
          )
        )
      )
    );
  }

  nodes.push(
    h('p', {
      class: 'hint',
      text: `Nearest standard colour: ${answer.nearestStandard.colour_name} (${answer.nearestStandard.hex}) at a distance of ${answer.nearestStandard.deltaE.toFixed(4)}.`
    })
  );

  nodes.push(h('h3', { text: 'Contradictions' }));
  if (answer.contradictions.length === 0) {
    nodes.push(h('p', { class: 'hint', text: 'None found.' }));
  } else {
    nodes.push(
      h(
        'ul',
        {},
        answer.contradictions.map((item) =>
          h(
            'li',
            {},
            h('span', { class: `badge badge-${item.severity === 'conflict' ? 'conflict' : 'warn'}`, text: item.severity }),
            h('code', { text: item.code }),
            ' ',
            item.message
          )
        )
      )
    );
  }

  nodes.push(h('h3', { text: 'Uncertainty' }));
  const list = [
    h('li', {}, h('span', { class: `badge badge-${answer.uncertainty.level === 'low' ? 'ok' : 'warn'}`, text: answer.uncertainty.level }), 'declared level')
  ];
  for (const reason of answer.uncertainty.reasons) list.push(h('li', {}, reason));
  nodes.push(h('ul', {}, list));

  dom.matches.replaceChildren(...nodes);
}

// ---------------------------------------------------------------------------------------
// Why this answer
// ---------------------------------------------------------------------------------------

function renderWhy(response) {
  const answer = response.answer;
  const rulesApplied =
    answer.appliedRules.length === 0
      ? ['No rule applied: the colour is not covered by the standard set.']
      : answer.appliedRules.map((rule) => `${rule.id} (${rule.outcome}): "${rule.source_text}"`);

  dom.why.replaceChildren(
    h('h3', { text: 'Data used' }),
    h('ul', {}, answer.dataUsed.map((entry) => h('li', { text: entry }))),
    h('h3', { text: 'Rules applied' }),
    h('ul', {}, rulesApplied.map((entry) => h('li', { text: entry }))),
    h('h3', { text: 'Profile' }),
    h('ul', {}, [
      h('li', { text: `level: ${response.profile.level}` }),
      h('li', { text: `effort: ${response.profile.effort}` }),
      h('li', { text: `declared delay: ${response.profile.display_delay_ms} ms` }),
      h('li', {
        text:
          state.delayMeasuredMs === null
            ? 'measured delay: not applied at this interaction'
            : `measured delay: ${state.delayMeasuredMs} ms`
      })
    ]),
    h('h3', { text: 'Uncertainty' }),
    h('p', { text: `Declared level: ${answer.uncertainty.level}.` }),
    h('ul', {}, answer.uncertainty.reasons.map((entry) => h('li', { text: entry }))),
    h('p', {
      class: 'hint',
      text:
        'No private reasoning chain is shown: only the data used, the rules applied and the declared uncertainty, ' +
        'which is what can be checked against the code and the standard files.'
    })
  );
}

// ---------------------------------------------------------------------------------------
// Background suggestions
// ---------------------------------------------------------------------------------------

function renderSuggestions(container, designSuggestions) {
  if (!designSuggestions || !Array.isArray(designSuggestions.suggestions) || designSuggestions.suggestions.length === 0) {
    container.replaceChildren(h('p', { class: 'hint', text: 'No suggestions for this selection.' }));
    return;
  }

  const nodes = [
    h('p', { class: 'hint', text: designSuggestions.assistance.note }),
    ...designSuggestions.suggestions.map((suggestion) =>
      h(
        'div',
        { class: 'suggestion' },
        h('div', { class: 'suggestion-preview', attrs: { style: `background:${suggestion.background.css}` } }),
        h('h4', { text: suggestion.title }),
        h(
          'p',
          { class: 'hint' },
          suggestion.palette.map((entry) => `${entry.role}: ${entry.colour_name} (${entry.hex})`).join(' · ')
        ),
        h('p', { text: suggestion.layout }),
        h('p', { class: 'hint', text: suggestion.why }),
        h('code', { class: 'css-line', text: suggestion.background.css }),
        h(
          'div',
          { class: 'row' },
          h('button', {
            class: 'secondary',
            text: 'Use this background',
            attrs: { type: 'button' },
            on: { click: () => chooseBackground(suggestion) }
          })
        )
      )
    )
  ];

  if (designSuggestions.assistance.withheld.length > 0) {
    nodes.push(
      h(
        'p',
        { class: 'hint' },
        designSuggestions.assistance.withheld.map((entry) => entry.reason).join(' ')
      )
    );
  }

  container.replaceChildren(...nodes);
}

/**
 * The only place where a background becomes "the chosen one": a user press. The system never
 * calls this function by itself.
 */
function chooseBackground(suggestion) {
  state.chosenBackground = suggestion;
  dom.chosenBackground.replaceChildren(
    h('p', {
      text:
        `You chose: ${suggestion.title}. The app did not choose it, and the CSS below is what it suggested. ` +
        'Nothing has been applied to your design.'
    }),
    h('code', { class: 'css-line', text: suggestion.background.css })
  );
  dom.backgroundPreview.hidden = false;
  dom.backgroundPreview.setAttribute('style', `background:${suggestion.background.css}`);
}

async function updateSuggestions() {
  if (state.selection === null) {
    dom.suggestions.replaceChildren(h('p', { class: 'hint', text: 'Pick a colour first.' }));
    return;
  }
  try {
    const response = await api('/design/suggestions', {
      method: 'POST',
      body: { userId: state.userId, colour: { name: state.selection.name, hex: state.selection.hex }, design: designContext() }
    });
    clearStatus();
    if (response.profile) renderProfile(response.profile);
    renderSuggestions(dom.suggestions, response.designSuggestions);
  } catch (error) {
    showStatus(error.message);
  }
}

// ---------------------------------------------------------------------------------------
// A red or yellow background
// ---------------------------------------------------------------------------------------

async function askForBackground() {
  const colour = dom.backgroundColour.value;
  state.backgroundQuestionColour = colour;
  dom.reasonBlock.hidden = true;
  dom.delayNotice.hidden = true;
  dom.backgroundQuestion.hidden = false;
  dom.backgroundReason.value = '';
  dom.backgroundResult.replaceChildren(
    h('p', { class: 'hint', text: 'The app asks immediately why before suggesting anything.' })
  );
  try {
    const response = await api('/design/backgrounds', {
      method: 'POST',
      body: {
        userId: state.userId,
        colour: { name: colour },
        consent: dom.consent.checked,
        design: designContext()
      }
    });
    dom.backgroundQuestionLabel.textContent = response.question;
    dom.backgroundResult.replaceChildren(h('p', { class: 'answer-paragraph', text: response.notice }));
    if (response.profile) renderProfile(response.profile);
  } catch (error) {
    showStatus(error.message);
  }
}

async function sendBackgroundReason() {
  const reason = dom.backgroundReason.value.trim();
  if (reason === '') {
    dom.backgroundReason.focus();
    showStatus('The app asks why: write a reason for the red or yellow background before sending it.');
    return;
  }
  // The question is about the colour that was asked about, not about whatever the select shows
  // now: changing the select while the question is open must not make the answer refer to another
  // colour.
  const colour = state.backgroundQuestionColour ?? dom.backgroundColour.value;
  const token = ++state.requestToken;
  addUserBubble(reason);
  showTyping();
  try {
    const response = await api('/design/backgrounds', {
      method: 'POST',
      body: {
        userId: state.userId,
        colour: { name: colour },
        reason,
        consent: dom.consent.checked,
        design: designContext()
      }
    });
    if (token !== state.requestToken) return;
    clearStatus();

    const nodes = [h('p', { class: 'answer-paragraph', text: response.notice })];
    if (response.reasonAssessment) {
      nodes.push(
        h('p', {
          class: 'hint',
          text:
            `Verdict: ${response.reasonAssessment.verdict} · method: ${response.reasonAssessment.method} · ` +
            `confidence: ${response.reasonAssessment.confidence}.`
        })
      );
    }
    const container = h('div', {});
    nodes.push(container);
    dom.backgroundResult.replaceChildren(...nodes);

    await applyDelay(
      response,
      () => {
        if (token !== state.requestToken) return;
        renderProfile(response.profile);
        renderStandingMessages(response.standingMessages);
        renderSuggestions(container, response.designSuggestions);
      },
      () => token === state.requestToken
    );
    if (token !== state.requestToken) return;
    await refreshMemory();
  } catch (error) {
    if (token !== state.requestToken) return;
    hideTyping();
    showStatus(error.message);
  }
}

// ---------------------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------------------

function memoryRecordNode(record) {
  const content = record.content ?? {};
  const head = h('div', { class: 'record-head' });

  if (record.category === 'preference') {
    head.append(
      h('span', { class: 'mini-swatch', attrs: { style: `background:${content.hex}`, 'aria-hidden': 'true' } }),
      h('strong', { text: `Preference: ${content.name ?? content.hex} (${content.hex})` })
    );
  } else if (record.category === 'correction') {
    head.append(
      h('span', { class: 'mini-swatch', attrs: { style: `background:${content.hex}`, 'aria-hidden': 'true' } }),
      h('strong', { text: `Correction: ${content.hex} should be "${content.proposed_outcome}"` })
    );
  } else if (record.category === 'interaction') {
    head.append(h('strong', { text: `Profile: ${content.level ?? 'unknown'}` }));
  } else {
    head.append(
      h('strong', {
        text:
          `Assessment: ${content.colour_name ?? '?'} → ${content.verdict ?? '?'} ` +
          `(${content.method ?? '?'}, confidence ${content.confidence ?? '?'})`
      })
    );
  }

  const meta = h('div', { class: 'meta' });
  meta.append(
    h('div', {}, `category: ${record.category} · confirmation: ${record.confirmation} · origin: ${record.origin}`),
    h('div', {}, `created: ${formatTimestamp(record.created_at)} · updated: ${formatTimestamp(record.updated_at)}`),
    h('div', {}, `confidence: ${record.confidence} · expires: ${record.expires_at === null ? 'never' : formatTimestamp(record.expires_at)}`)
  );
  if (content.reason) meta.append(h('div', {}, `your answer: "${content.reason}"`));
  if (content.note) meta.append(h('div', {}, `note: "${content.note}"`));
  if (content.why) meta.append(h('div', {}, `why: ${content.why}`));

  return h(
    'li',
    {},
    head,
    meta,
    h(
      'div',
      { class: 'actions' },
      h('button', {
        class: 'danger',
        text: 'Delete',
        attrs: { type: 'button' },
        on: { click: () => deleteRecord(record.id) }
      })
    )
  );
}

async function deleteRecord(recordId) {
  try {
    await api(`/users/${encodeURIComponent(state.userId)}/memory/${encodeURIComponent(recordId)}`, { method: 'DELETE' });
    clearStatus();
    await Promise.all([refreshMemory(), refreshProfile()]);
  } catch (error) {
    showStatus(error.message);
  }
}

async function refreshMemory() {
  try {
    const memory = await api(`/users/${encodeURIComponent(state.userId)}/memory`);
    dom.memoryStatus.replaceChildren(
      h('div', {}, `User: ${memory.userId} · records: ${memory.count} · storage: JSON file on the server`),
      h('div', {
        class: 'hint',
        text:
          'Categories used by this version: preference, correction, interaction (the profile) and knowledge ' +
          '(the assessment of a reason). Nothing is written without consent.'
      })
    );

    if (memory.records.length === 0) {
      dom.memoryList.replaceChildren(h('li', { class: 'hint', text: 'Empty. No record is stored for this user.' }));
      return;
    }
    dom.memoryList.replaceChildren(...memory.records.map(memoryRecordNode));
  } catch (error) {
    dom.memoryStatus.textContent = `The stored memory could not be read: ${error.message}`;
    dom.memoryList.replaceChildren();
  }
}

async function clearMemory() {
  try {
    const result = await api(`/users/${encodeURIComponent(state.userId)}/memory`, { method: 'DELETE' });
    dom.consentNote.textContent = `${result.deletedCount} record(s) deleted from the server.`;
    clearStatus();
    await Promise.all([refreshMemory(), refreshProfile()]);
  } catch (error) {
    showStatus(error.message);
  }
}

// ---------------------------------------------------------------------------------------
// Corrections
// ---------------------------------------------------------------------------------------

async function recordCorrection() {
  if (state.selection === null) return;
  if (!dom.consent.checked) {
    showStatus('A correction is stored as a record: tick the consent box first.');
    return;
  }
  const proposedOutcome = dom.correctionOutcome.value;
  try {
    await api(`/users/${encodeURIComponent(state.userId)}/corrections`, {
      method: 'POST',
      body: {
        hex: state.selection.hex,
        name: state.selection.name,
        targetStandardId: state.response?.answer?.appliedRules?.[0]?.id ?? null,
        proposedOutcome,
        note: dom.correctionNote.value.trim(),
        consent: true
      }
    });
    clearStatus();
    await refreshMemory();
    await interact({ reason: null });
  } catch (error) {
    showStatus(error.message);
  }
}

// ---------------------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------------------

function findColourByText(text) {
  const wanted = String(text ?? '').trim().toLowerCase();
  if (wanted === '') return null;
  return state.palette.find((c) => String(c.name).toLowerCase() === wanted) ?? null;
}

async function sendChatMessage(raw) {
  const value = String(raw ?? '').trim();
  if (value === '') return;
  const bgOpen = dom.backgroundQuestion && dom.backgroundQuestion.hidden === false;
  if (bgOpen && dom.backgroundReason.value.trim() === '') {
    dom.backgroundReason.value = value;
    await sendBackgroundReason();
    return;
  }
  const reasonOpen = dom.reasonBlock && dom.reasonBlock.hidden === false;
  if (reasonOpen) {
    dom.reasonInput.value = value;
    await sendReason();
    return;
  }
  const bgAsk = value.toLowerCase().match(/\b(red|yellow)\b.*background|background.*\b(red|yellow)\b/);
  if (bgAsk) {
    const colour = (bgAsk[1] ?? bgAsk[2] ?? 'red').toLowerCase();
    addUserBubble(value);
    dom.backgroundColour.value = colour;
    await askForBackground();
    return;
  }
  const colour = findColourByText(value);
  if (colour) {
    await selectColour(colour);
    return;
  }
  addUserBubble(value);
  addAssistantBubble({ tone: null, title: 'Pick a colour above, or type one (e.g. “blue”).', lines: ['If I asked you “why”, just type your reason here and I will read it as your answer.'] });
}

// ---------------------------------------------------------------------------------------
// Automatic composition: the app does the layout, the crop and the copy
// ---------------------------------------------------------------------------------------

/**
 * One press, no manual work: the server places the photo, writes the text and returns a JPG
 * (with the SVG kept in the response for reference). The SVG is never parsed into the document:
 * it becomes an object URL and travels into an <img>, which is how the rule "no SVG markup in
 * the page, no innerHTML" survives this feature.
 */
async function composeAutomatically() {
  if (state.selection === null) {
    showComposeMessage('Pick a colour from the palette first: the composition uses the colour you chose.', []);
    return;
  }
  if (dom.composeRun) dom.composeRun.disabled = true;
  if (dom.composeStatus) dom.composeStatus.textContent = 'Composing on the server…';
  try {
    const response = await api('/design/compose', {
      method: 'POST',
      body: {
        userId: state.userId,
        colour: { name: state.selection.name, hex: state.selection.hex },
        design: designContext(),
        ...(state.imageOriginal === null ? {} : { image: state.imageOriginal })
      }
    });
    clearStatus();
    await renderComposition(response);
  } catch (error) {
    showStatus(error.message);
    const hints =
      error.code === 'background_not_questioned'
        ? [
            `${state.selection.name} is a questioned colour: ask for that background in the “A red or yellow background” panel, give a cogent reason, then compose again.`
          ]
        : error.code === 'invalid_image' || error.code === 'image_too_large'
          ? ['The photo could not be used: png, jpeg or bmp up to 8 MB and 8000 px per side.']
          : [];
    showComposeMessage(`The composition failed: ${error.message}`, hints);
  } finally {
    syncComposeButton();
  }
}

/** The failure is explained where the button is, not only in the banner at the top. */
function showComposeMessage(title, hints = []) {
  if (dom.composeStatus) dom.composeStatus.textContent = '';
  if (dom.composeNotes) {
    dom.composeNotes.replaceChildren(
      h('p', { text: title }),
      ...hints.map((line) => h('p', { class: 'hint', text: line }))
    );
  }
}

function syncComposeButton() {
  if (!dom.composeRun) return;
  const ready = state.selection !== null;
  dom.composeRun.disabled = !ready;
  dom.composeRun.title = ready ? 'The app places the photo, writes the text and returns a JPG.' : 'Choose a colour first';
}

async function renderComposition(result) {
  let raster = typeof result.image === 'string' && result.image.startsWith('data:image/') ? result.image : null;
  let blob = null;
  if (raster !== null) {
    try {
      blob = await (await fetch(raster)).blob();
    } catch {
      raster = null;
    }
  }
  if (blob === null) blob = new Blob([result.svg], { type: 'image/svg+xml' });

  if (state.composeUrl !== null) URL.revokeObjectURL(state.composeUrl);
  state.composeUrl = URL.createObjectURL(blob);

  dom.composePreview.src = state.composeUrl;
  dom.composePreview.alt = `Composed ${result.design.label}: ${result.copy.headline}`;
  dom.composePreview.hidden = false;
  if (dom.composeEmpty) dom.composeEmpty.hidden = true;
  if (dom.composeDownload) {
    dom.composeDownload.href = state.composeUrl;
    dom.composeDownload.download = `chatmt-${result.design.type}-${result.colour.colour_name}.${raster === null ? 'svg' : 'jpg'}`;
    dom.composeDownload.textContent = raster === null ? 'Download SVG' : 'Download JPG';
    dom.composeDownload.hidden = false;
  }
  if (dom.composeStatus) {
    dom.composeStatus.textContent = raster === null
      ? `Composed ${result.design.width}×${result.design.height} · ${result.svg_bytes} bytes · SVG.`
      : `Composed ${result.design.width}×${result.design.height} · ${Math.round(result.image_bytes / 1024)} KB · JPG.`;
  }
  if (dom.composeCaption) {
    dom.composeCaption.textContent =
      `${result.layout.label} · ${result.colour.colour_name} ${result.colour.hex} · ` +
      (result.photo === null ? 'no photo: colour field' : 'photo placed automatically');
  }

  dom.composeNotes.replaceChildren(
    h('h3', { class: 'group-title', text: 'What the app did' }),
    ...result.actions.map((line) => h('p', { class: 'hint', text: `— ${line}` })),
    h('h3', { class: 'group-title', text: 'Text written by the app' }),
    h('p', { class: 'hint', text: `kicker: ${result.copy.kicker}` }),
    h('p', { class: 'hint', text: `headline: ${result.copy.headline}` }),
    ...(result.copy.subhead === null ? [] : [h('p', { class: 'hint', text: `subhead: ${result.copy.subhead}` })]),
    h('p', { class: 'hint', text: `body: ${result.copy.body}` }),
    h('p', { class: 'hint', text: `footer: ${result.copy.footer}` }),
    ...result.warnings.map((line) => h('p', { class: 'hint', text: line })),
    h('p', { class: 'hint', text: result.choice.note })
  );
}

// ---------------------------------------------------------------------------------------
// Photo studio: upload + brighten (local canvas filter) + crop (server API)
// ---------------------------------------------------------------------------------------

function applyBrighten() {
  if (!dom.imagePreview || !state.imageOriginal) return;
  dom.imagePreview.style.filter = state.brighten === 100 ? '' : `brightness(${state.brighten}%)`;
  if (dom.imageBrightenValue) dom.imageBrightenValue.textContent = `${state.brighten}%`;
}

function setStudioImage(dataUrl, status) {
  state.imageOriginal = dataUrl;
  if (dataUrl) {
    dom.imagePreview.src = dataUrl;
    dom.imagePreview.hidden = false;
    if (dom.imageEmpty) dom.imageEmpty.hidden = true;
    applyBrighten();
  } else {
    dom.imagePreview.removeAttribute('src');
    dom.imagePreview.hidden = true;
    dom.imagePreview.style.filter = '';
    if (dom.imageEmpty) dom.imageEmpty.hidden = false;
  }
  if (status !== undefined && dom.imageStatus) dom.imageStatus.textContent = status;
}

async function cropWithServer() {
  if (!state.imageOriginal) {
    if (dom.imageStatus) dom.imageStatus.textContent = 'Upload an image first.';
    return;
  }
  const x = Number(dom.imageCropX.value);
  const y = Number(dom.imageCropY.value);
  const width = Number(dom.imageCropW.value);
  const height = Number(dom.imageCropH.value);
  try {
    if (dom.imageStatus) dom.imageStatus.textContent = 'Cropping on the server…';
    const response = await api('/design/transform', {
      method: 'POST',
      body: { image: state.imageOriginal, operations: [{ type: 'crop', x, y, width, height }] }
    });
    setStudioImage(response.image, `Cropped on the server: ${response.width}×${response.height} ${response.format}. Brighten stays local.`);
  } catch (error) {
    if (dom.imageStatus) dom.imageStatus.textContent = error.message;
    else showStatus(error.message);
  }
}

dom.consent.addEventListener('change', () => {
  dom.consentNote.textContent = dom.consent.checked
    ? 'Consent given: a preference and the profile can now be stored, when the backend records an interaction.'
    : 'Consent withdrawn: nothing new will be stored. Data already stored stays until you delete it.';
});

dom.clearMemory.addEventListener('click', clearMemory);
dom.reasonSend.addEventListener('click', sendReason);
dom.designUpdate.addEventListener('click', updateSuggestions);
dom.composeRun?.addEventListener('click', composeAutomatically);
dom.backgroundAsk.addEventListener('click', askForBackground);
dom.backgroundSend.addEventListener('click', sendBackgroundReason);
dom.correctionRecord.addEventListener('click', recordCorrection);

dom.chatForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const value = dom.chatInput.value;
  dom.chatInput.value = '';
  await sendChatMessage(value);
});

dom.imageFile?.addEventListener('change', () => {
  const file = dom.imageFile.files?.[0];
  if (!file) return;
  if (!/^image\/(png|jpeg|bmp)$/.test(file.type) && !/\.(png|jpe?g|bmp)$/i.test(file.name)) {
    if (dom.imageStatus) dom.imageStatus.textContent = 'Supported input formats are png, jpeg and bmp.';
    return;
  }
  const reader = new FileReader();
  reader.onload = () => setStudioImage(String(reader.result), `Loaded ${file.name}. Brighten with the slider, crop with the server.`);
  reader.onerror = () => { if (dom.imageStatus) dom.imageStatus.textContent = 'The image could not be read.'; };
  reader.readAsDataURL(file);
});

dom.imageBrighten?.addEventListener('input', () => {
  state.brighten = Number(dom.imageBrighten.value);
  applyBrighten();
});

dom.imageReset?.addEventListener('click', () => {
  state.brighten = 100;
  if (dom.imageBrighten) dom.imageBrighten.value = '100';
  setStudioImage(null, 'Photo cleared.');
  if (dom.imageFile) dom.imageFile.value = '';
});

dom.imageApplyCrop?.addEventListener('click', cropWithServer);

init();
