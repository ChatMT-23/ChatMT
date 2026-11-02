/**
 * OpenRouter image generation.
 *
 * The flyer backgrounds are produced by an image model, not by a static gradient. The client
 * speaks the small HTTP surface documented by OpenRouter:
 *
 *   POST {apiBase}/images
 *   Authorization: Bearer <OPENROUTER_API_KEY>
 *   { "model": "krea/k3-edit", "prompt": "..." }
 *   -> { "data": [{ "b64_json": "..." }] }   (or { "data": [{ "url": "..." }] })
 *
 * The API key stays on the server. The prompt is built by the background service from the
 * colour and a motif only: the user's flyer text is never sent to the image provider.
 */

const DEFAULT_MODEL = 'krea/k3-edit';

export class ImageGenerationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ImageGenerationError';
    this.code = code;
  }
}

function normaliseBase(value) {
  return String(value ?? '').replace(/\/+$/, '');
}

function imageFromPayload(payload) {
  const entries = Array.isArray(payload?.data) ? payload.data : [];
  const first = entries.find((entry) => entry && typeof entry === 'object');
  if (!first) return null;
  if (typeof first.b64_json === 'string' && first.b64_json.trim() !== '') {
    return `data:image/png;base64,${first.b64_json.trim()}`;
  }
  if (typeof first.url === 'string' && first.url.trim() !== '') {
    return first.url.trim();
  }
  return null;
}

/**
 * @param {object} options
 * @param {string} options.apiBase
 * @param {string|null} options.apiKey
 * @param {string} [options.model]
 * @param {number} [options.timeoutMs]
 * @param {typeof fetch} [options.fetchImpl]
 */
export function createOpenRouterImageClient({
  apiBase,
  apiKey,
  model = DEFAULT_MODEL,
  timeoutMs = 90_000,
  fetchImpl = fetch
} = {}) {
  const base = normaliseBase(apiBase);
  const configured = typeof apiKey === 'string' && apiKey.trim() !== '';
  const chosenModel = String(model ?? DEFAULT_MODEL).trim() || DEFAULT_MODEL;

  async function fetchAsDataUrl(url, signal) {
    const response = await fetchImpl(url, { signal });
    if (!response.ok) {
      throw new ImageGenerationError(
        'image_provider_error',
        `The image provider returned HTTP ${response.status} while downloading the generated image.`
      );
    }
    const mime = response.headers.get('content-type')?.split(';')[0]?.trim() || 'image/png';
    if (!mime.startsWith('image/')) {
      throw new ImageGenerationError(
        'image_invalid_response',
        `The image provider returned ${JSON.stringify(mime)} instead of an image.`
      );
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length === 0) {
      throw new ImageGenerationError('image_invalid_response', 'The image provider returned an empty image.');
    }
    return `data:${mime};base64,${bytes.toString('base64')}`;
  }

  /**
   * @param {{prompt: string, references?: Array<object>}} input
   * @returns {Promise<{image: string, model: string, prompt: string}>}
   */
  async function generate({ prompt, references = [] } = {}) {
    if (!configured) {
      throw new ImageGenerationError(
        'image_not_configured',
        'Image generation is not configured. Add OPENROUTER_API_KEY to the server environment.'
      );
    }
    if (typeof prompt !== 'string' || prompt.trim() === '') {
      throw new ImageGenerationError('image_prompt_required', 'A prompt is required to generate an image.');
    }
    if (!Array.isArray(references)) {
      throw new ImageGenerationError('image_invalid_request', 'references must be an array when present.');
    }
    if (base === '') {
      throw new ImageGenerationError('image_provider_error', 'The image provider base URL is empty.');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${base}/images`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: chosenModel,
          prompt: prompt.trim(),
          ...(references.length === 0 ? {} : { input_references: references })
        }),
        signal: controller.signal
      });

      const raw = await response.text();
      let payload = null;
      try {
        payload = raw === '' ? null : JSON.parse(raw);
      } catch {
        throw new ImageGenerationError(
          'image_invalid_response',
          'The image provider returned a response that is not JSON.'
        );
      }

      if (!response.ok) {
        const detail =
          typeof payload?.error?.message === 'string'
            ? payload.error.message
            : typeof payload?.message === 'string'
              ? payload.message
              : `HTTP ${response.status}`;
        throw new ImageGenerationError('image_provider_error', `The image provider refused the request: ${detail}`);
      }

      const candidate = imageFromPayload(payload);
      if (candidate === null) {
        throw new ImageGenerationError(
          'image_invalid_response',
          'The image provider returned no image in data[0].b64_json or data[0].url.'
        );
      }
      const image = candidate.startsWith('data:')
        ? candidate
        : await fetchAsDataUrl(candidate, controller.signal);

      return { image, model: chosenModel, prompt: prompt.trim() };
    } catch (error) {
      if (error instanceof ImageGenerationError) throw error;
      if (error?.name === 'AbortError') {
        throw new ImageGenerationError(
          'image_timeout',
          `The image provider did not answer within ${timeoutMs} ms.`
        );
      }
      throw new ImageGenerationError(
        'image_provider_error',
        `The image provider could not be reached: ${error?.message ?? String(error)}`
      );
    } finally {
      clearTimeout(timer);
    }
  }

  return Object.freeze({
    configured,
    model: chosenModel,
    provider: 'openrouter',
    generate
  });
}
