/**
 * ChatMT — the simple flyer composer.
 *
 * The page has one job: take the text, an optional photo and one press, then show the flyer the
 * backend composed. There is no palette, no rule panel and no local storage. The rules live in
 * the backend and are linked from GitHub.
 *
 * No innerHTML: every string from the API is inserted with textContent, and the composed flyer is
 * shown as an object URL in an <img>, never parsed into the document. The download is a JPEG:
 * a phone gallery cannot open the SVG, so the backend also rasterises the composition.
 */

const USER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

const params = new URLSearchParams(window.location.search);
const requestedUser = params.get('user');

const state = {
  userId: requestedUser !== null && USER_ID_PATTERN.test(requestedUser) ? requestedUser : 'local-user',
  api: new URL('/api/', window.location.origin),
  image: null,
  last: null,
  objectUrl: null,
  busy: false
};

const dom = {
  status: document.getElementById('status'),
  form: document.getElementById('create-form'),
  text: document.getElementById('flyer-text'),
  imageFile: document.getElementById('flyer-image'),
  imageName: document.getElementById('image-name'),
  imageThumb: document.getElementById('image-thumb'),
  imageRemove: document.getElementById('image-remove'),
  uploadLabel: document.getElementById('upload-label'),
  uploadButton: document.querySelector('.upload-button'),
  consent: document.getElementById('consent'),
  colourHint: document.getElementById('colour-hint'),
  create: document.getElementById('create-flyer'),
  createLabel: document.getElementById('create-label'),
  result: document.getElementById('result'),
  resultTitle: document.getElementById('result-title'),
  preview: document.getElementById('flyer-preview'),
  previewEmpty: document.getElementById('preview-empty'),
  previewEmptyText: document.querySelector('#preview-empty p'),
  download: document.getElementById('download'),
  resultNote: document.getElementById('result-note'),
  resultMeta: document.getElementById('result-meta'),
  standingSection: document.getElementById('standing-section'),
  standingMessages: document.getElementById('standing-messages'),
  suggestionsSection: document.getElementById('suggestions-section'),
  suggestionsNote: document.getElementById('suggestions-note'),
  suggestionList: document.getElementById('suggestion-list')
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;

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
      `The backend is not reachable at ${url.origin} (${error.message}). Start it with "npm start".`
    );
  }
  const text = await response.text();
  let payload = null;
  try {
    payload = text === '' ? null : JSON.parse(text);
  } catch {
    throw new Error(`The backend returned an invalid response (HTTP ${response.status}).`);
  }
  if (!response.ok) {
    throw new Error(payload?.error?.message ?? `HTTP ${response.status} from ${url.pathname}`);
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

function setBusy(busy, label = 'Creating…') {
  state.busy = busy;
  dom.create.disabled = busy;
  dom.text.disabled = busy;
  dom.imageFile.disabled = busy;
  dom.consent.disabled = busy;
  dom.imageRemove.disabled = busy;
  dom.uploadButton.classList.toggle('is-disabled', busy);
  dom.uploadButton.setAttribute('aria-disabled', busy ? 'true' : 'false');
  dom.createLabel.textContent = busy ? label : 'Create your flyer';
  for (const card of dom.suggestionList.querySelectorAll('button')) card.disabled = busy;
}

function scrollToResult() {
  dom.result.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
}

function backgroundSource(background) {
  if (typeof background?.thumbnail === 'string' && background.thumbnail.startsWith('data:image/')) {
    return background.thumbnail;
  }
  if (typeof background?.image === 'string' && background.image.startsWith('data:image/')) {
    return background.image;
  }
  if (typeof background?.svg === 'string') {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(background.svg)}`;
  }
  return null;
}

function chip(label, value) {
  return h(
    'span',
    { class: 'meta-chip' },
    h('strong', { text: `${label}: ` }),
    h('span', { text: value })
  );
}

async function renderComposition(composition) {
  let raster = typeof composition.image === 'string' && composition.image.startsWith('data:image/')
    ? composition.image
    : null;
  let blob = null;
  if (raster !== null) {
    try {
      blob = await (await fetch(raster)).blob();
    } catch {
      raster = null;
    }
  }
  if (blob === null) {
    blob = new Blob([composition.svg], { type: 'image/svg+xml' });
  }

  if (state.objectUrl !== null) URL.revokeObjectURL(state.objectUrl);
  state.objectUrl = URL.createObjectURL(blob);
  dom.preview.src = state.objectUrl;
  dom.preview.alt = `Composed ${composition.design.label}: ${composition.copy.headline}`;
  dom.preview.hidden = false;
  dom.previewEmpty.hidden = true;
  dom.download.href = state.objectUrl;
  dom.download.download =
    raster === null
      ? `chatmt-${composition.design.type}-${composition.colour.colour_name}.svg`
      : `chatmt-${composition.design.type}-${composition.colour.colour_name}.jpg`;
  dom.download.textContent = raster === null ? 'Download SVG' : 'Download JPG';
  dom.download.hidden = false;
}

function renderMeta(response) {
  const composition = response.composition;
  const backgrounds = response.backgrounds;
  const parts = [
    chip('Colour', `${response.input.colourName} ${response.input.hex}`),
    chip('Format', `${composition.design.label} · ${composition.design.width}×${composition.design.height}`),
    chip('Tone', response.tone === 'friendly' ? 'friendly' : 'not friendly'),
    chip('Backgrounds', String(backgrounds.images.length))
  ];
  if (response.display?.delay_ms > 0) parts.push(chip('Delay', `${response.display.delay_ms} ms`));
  parts.push(
    chip(
      'Image model',
      backgrounds.configured ? `${backgrounds.provider} · ${backgrounds.model}` : 'gradient fallback'
    )
  );
  dom.resultMeta.replaceChildren(...parts);
}

function renderNote(response) {
  const backgrounds = response.backgrounds;
  const count = backgrounds.images.length;
  const delay = response.display?.delay_ms ?? 0;
  const parts = [];

  if (response.tone === 'friendly') {
    parts.push(
      `Composed with the extensive assistance: ${count} backgrounds and no delay. Choose another background below if you want.`
    );
  } else {
    parts.push(
      `Composed — but the reason for ${response.input.colourName} was not cogent. I’m less enthusiastic: ${count} backgrounds instead of five, and the answer waited ${delay} ms.`
    );
  }
  if (response.standingMessages?.length > 0) {
    parts.push('I left you a note from last time just below.');
  }
  if (!backgrounds.configured) {
    parts.push(
      'Image generation is not configured: these are gradient fallbacks. Add OPENROUTER_API_KEY to the server environment and restart to generate the backgrounds.'
    );
  }
  if (typeof response.composition?.image === 'string' && response.composition.image.startsWith('data:image/')) {
    parts.push('The download is a JPG image, so it opens in the phone gallery.');
  } else if (response.composition?.image_error) {
    parts.push('The JPG export failed, so the flyer is shown as an SVG instead.');
  }
  const storedAny = Object.values(response.stored ?? {}).some((value) => value !== null && value !== undefined);
  if (!storedAny) {
    parts.push('Nothing was stored, so there will be no next-time reminder.');
  }
  dom.resultNote.textContent = parts.join(' ');
}

function renderStanding(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    dom.standingSection.hidden = true;
    dom.standingMessages.replaceChildren();
    return;
  }
  dom.standingSection.hidden = false;
  dom.standingMessages.replaceChildren(
    ...messages.map((message) =>
      h('p', { attrs: { 'data-code': message.code }, text: message.text })
    )
  );
}

function suggestionCard(background, index) {
  const source = backgroundSource(background);
  const image =
    source === null
      ? h('span', { class: 'suggestion-missing', text: 'No preview' })
      : h('img', {
          attrs: {
            src: source,
            alt: `${background.label} background`,
            loading: 'lazy'
          }
        });
  return h(
    'button',
    {
      class: 'suggestion-card',
      attrs: {
        type: 'button',
        'aria-pressed': index === 0 ? 'true' : 'false',
        'aria-label': `Use the ${background.label} background`
      },
      on: { click: () => chooseBackground(index) }
    },
    image,
    h('span', {
      class: `suggestion-badge${background.fallback ? ' is-fallback' : ''}`,
      text: background.fallback ? 'fallback' : 'model'
    }),
    h('span', { class: 'suggestion-label', text: background.label })
  );
}

function renderSuggestions(response) {
  const images = response.backgrounds?.images ?? [];
  if (images.length === 0) {
    dom.suggestionsSection.hidden = true;
    dom.suggestionList.replaceChildren();
    return;
  }
  dom.suggestionsSection.hidden = false;
  const source = response.backgrounds.configured
    ? `generated by ${response.backgrounds.provider} · ${response.backgrounds.model}`
    : 'gradient fallback';
  dom.suggestionsNote.textContent = `${images.length} backgrounds · ${source} · choosing one does not store anything.`;
  dom.suggestionList.replaceChildren(...images.map((background, index) => suggestionCard(background, index)));
}

async function renderResult(response) {
  state.last = response;
  await renderComposition(response.composition);
  dom.resultTitle.textContent = `Your ${response.composition.design.label}, composed.`;
  renderNote(response);
  renderMeta(response);
  renderStanding(response.standingMessages);
  renderSuggestions(response);
}

function selectSuggestion(index) {
  const cards = [...dom.suggestionList.querySelectorAll('.suggestion-card')];
  cards.forEach((card, cardIndex) => card.setAttribute('aria-pressed', cardIndex === index ? 'true' : 'false'));
}

async function chooseBackground(index) {
  if (state.busy || state.last === null) return;
  const background = state.last.backgrounds.images[index];
  if (!background) return;

  setBusy(true, 'Recomposing…');
  clearStatus();
  dom.resultNote.textContent = `Recomposing with the ${background.label} background…`;
  try {
    const response = await api('/design/recompose', {
      method: 'POST',
      body: {
        userId: state.userId,
        text: state.last.text,
        colourName: state.last.input.colourName,
        image: state.image?.dataUrl ?? null,
        design: state.last.design,
        backgroundId: background.id,
        backgroundIndex: index,
        count: state.last.backgrounds.images.length
      }
    });
    state.last = {
      ...state.last,
      composition: response.composition,
      backgrounds: response.backgrounds
    };
    await renderComposition(response.composition);
    selectSuggestion(index);
    dom.resultNote.textContent = `Background changed to ${background.label}. The flyer was recomposed; nothing was stored.`;
    scrollToResult();
  } catch (error) {
    showStatus(error.message);
    dom.resultNote.textContent = 'The background could not be changed. The previous flyer is still shown.';
  } finally {
    setBusy(false);
  }
}

function showLoading() {
  dom.result.hidden = false;
  dom.preview.hidden = true;
  dom.previewEmpty.hidden = false;
  dom.previewEmptyText.textContent = 'Composing your flyer…';
  dom.resultTitle.textContent = 'Composing…';
  dom.resultNote.textContent = 'Reading the text, choosing the colour and generating the backgrounds.';
  dom.resultMeta.replaceChildren();
  dom.download.hidden = true;
  dom.suggestionsSection.hidden = true;
  dom.standingSection.hidden = true;
}

function showFailure(message) {
  dom.result.hidden = false;
  dom.preview.hidden = true;
  dom.previewEmpty.hidden = false;
  dom.previewEmptyText.textContent = 'The flyer was not created.';
  dom.resultTitle.textContent = 'Something went wrong.';
  dom.resultNote.textContent = message;
  dom.resultMeta.replaceChildren();
  dom.download.hidden = true;
  dom.suggestionsSection.hidden = true;
}

async function createFlyer() {
  if (state.busy) return;
  const text = dom.text.value.trim();
  if (text === '') {
    showStatus('Write what the flyer should say.');
    dom.text.focus();
    return;
  }

  clearStatus();
  setBusy(true, 'Creating…');
  showLoading();
  try {
    const response = await api('/design/flyer', {
      method: 'POST',
      body: {
        userId: state.userId,
        text,
        image: state.image?.dataUrl ?? null,
        consent: dom.consent.checked,
        design: {}
      }
    });

    const delay = Number(response.display?.delay_ms ?? 0);
    if (delay > 0) {
      dom.resultNote.textContent = `Lesser effort: the answer waits ${delay} ms before it is displayed.`;
      await sleep(delay);
    }

    await renderResult(response);
    scrollToResult();
  } catch (error) {
    showStatus(error.message);
    showFailure('Nothing was stored by this failed request. Check that the backend is running and try again.');
  } finally {
    setBusy(false);
  }
}

function clearImage() {
  state.image = null;
  dom.imageFile.value = '';
  dom.imageThumb.hidden = true;
  dom.imageThumb.removeAttribute('src');
  dom.imageName.textContent = 'No photo selected';
  dom.imageRemove.hidden = true;
  dom.uploadLabel.textContent = 'Add a photo';
  dom.colourHint.textContent = 'Name a colour in your text — or I’ll use blue.';
}

function onImageChange() {
  const file = dom.imageFile.files?.[0];
  if (!file) return;
  if (!/^image\/(png|jpeg|bmp)$/.test(file.type) && !/\.(png|jpe?g|bmp)$/i.test(file.name)) {
    showStatus('Supported photo formats are png, jpeg and bmp.');
    dom.imageFile.value = '';
    return;
  }
  if (file.size > MAX_IMAGE_BYTES) {
    showStatus('The photo is larger than 3 MB. Choose a smaller one.');
    dom.imageFile.value = '';
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    state.image = { dataUrl: String(reader.result), name: file.name };
    dom.imageThumb.src = state.image.dataUrl;
    dom.imageThumb.alt = `Selected photo: ${file.name}`;
    dom.imageThumb.hidden = false;
    dom.imageName.textContent = file.name;
    dom.imageRemove.hidden = false;
    dom.uploadLabel.textContent = 'Change photo';
    dom.colourHint.textContent = 'Photo added. Name a colour in your text — or I’ll use blue.';
    clearStatus();
  };
  reader.onerror = () => {
    showStatus('The photo could not be read. Try another file.');
  };
  reader.readAsDataURL(file);
}

dom.form.addEventListener('submit', (event) => {
  event.preventDefault();
  createFlyer();
});
dom.imageFile.addEventListener('change', onImageChange);
dom.imageRemove.addEventListener('click', clearImage);
window.addEventListener('beforeunload', () => {
  if (state.objectUrl !== null) URL.revokeObjectURL(state.objectUrl);
});
