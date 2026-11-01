/**
 * Interface checks, run in a real browser.
 *
 * The unit tests in tests/*.test.mjs cover the logic but cannot prove that the page works: a
 * wrong element id, a missing fetch or a delay that is declared but not applied would break the
 * interface while every unit test still passed. This script therefore drives an installed Chrome
 * (no dependency to install, no browser download) over the DevTools Protocol and asserts on the
 * resulting DOM.
 *
 * Since the interface reads the backend, the script starts the backend itself on a temporary
 * data directory: there is nothing to start by hand.
 *
 *   node tests/browser-checks.mjs                        (starts its own server)
 *   node tests/browser-checks.mjs http://127.0.0.1:3080/frontend/studio.html?user=manual
 *
 * The first 51 checks use the detailed studio page; the rest use the public composer at
 * /frontend/index.html with the same server and a new user.
 *
 * Set CHROME_PATH if Chrome is not in a usual location.
 * These checks are not part of `npm test`: they need a browser.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadConfig } from '../backend/config.js';
import { createServer } from '../backend/server.js';

const DEBUG_PORT = Number(process.env.CDP_PORT ?? 9333);
const GIVEN_APP = process.argv[2];

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser'
].filter(Boolean);

let failures = 0;
let checks = 0;

function assert(condition, message, detail = '') {
  checks += 1;
  if (condition) {
    console.log(`PASS  ${message}`);
    return;
  }
  failures += 1;
  console.log(`FAIL  ${message}${detail ? ` :: ${detail}` : ''}`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------------------
// Backend under test
// ---------------------------------------------------------------------------------------

async function startBackend() {
  const dataDir = mkdtempSync(join(tmpdir(), 'chatmt-browser-'));
  const config = loadConfig({
    CHATMT_DATA_DIR: dataDir,
    PORT: '0',
    CHATMT_LLM_API_BASE: '',
    CHATMT_LLM_API_KEY: ''
  });
  const server = createServer(config);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const user = `browser-${Date.now()}`;
  return {
    dataDir,
    server,
    user,
    app: `http://127.0.0.1:${port}/frontend/studio.html?user=${user}`
  };
}

// ---------------------------------------------------------------------------------------
// Browser
// ---------------------------------------------------------------------------------------

async function waitForEndpoint(url, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
    } catch {
      // not up yet
    }
    await sleep(250);
  }
  throw new Error(`the browser did not expose ${url} within ${timeoutMs} ms`);
}

async function startChrome() {
  const executable = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
  if (!executable) {
    console.error('Chrome was not found. Set CHROME_PATH to the executable, or run the checks by hand.');
    process.exit(1);
  }

  const profile = join(tmpdir(), 'chatmt-browser-checks');
  rmSync(profile, { recursive: true, force: true });

  const child = spawn(
    executable,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${profile}`,
      'about:blank'
    ],
    { stdio: 'ignore' }
  );

  await waitForEndpoint(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
  return child;
}

// ---------------------------------------------------------------------------------------
// DevTools Protocol client
// ---------------------------------------------------------------------------------------

function createClient(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  const pending = new Map();
  const consoleMessages = [];
  const exceptions = [];
  let nextId = 0;

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id !== undefined && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message.result);
      return;
    }
    if (message.method === 'Runtime.consoleAPICalled') {
      const text = message.params.args.map((arg) => arg.value ?? arg.description ?? arg.type).join(' ');
      consoleMessages.push(`${message.params.type}: ${text}`);
    }
    if (message.method === 'Runtime.exceptionThrown') {
      exceptions.push(message.params.exceptionDetails.exception?.description ?? 'unknown exception');
    }
  });

  const ready = new Promise((resolve) => socket.addEventListener('open', resolve));

  function send(method, params = {}) {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }

  return { socket, ready, send, consoleMessages, exceptions };
}

// ---------------------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------------------

async function main() {
  const backend = GIVEN_APP === undefined ? await startBackend() : null;
  const APP = GIVEN_APP ?? backend.app;

  try {
    const probe = await fetch(APP);
    if (!probe.ok) throw new Error(`HTTP ${probe.status}`);
  } catch (error) {
    console.error(`The application is not reachable at ${APP} (${error.message}).`);
    backend?.server.close();
    process.exit(1);
  }

  const chrome = await startChrome();

  try {
    const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
    const page = targets.find((target) => target.type === 'page');
    if (!page) throw new Error('the browser did not open a page target');

    const client = createClient(page.webSocketDebuggerUrl);
    await client.ready;
    await client.send('Page.enable');
    await client.send('Runtime.enable');
    await client.send('Log.enable');

    async function evaluate(expression) {
      const result = await client.send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true
      });
      if (result.exceptionDetails) {
        throw new Error(`evaluate failed: ${result.exceptionDetails.exception?.description ?? 'unknown'}`);
      }
      return result.result.value;
    }

    async function waitForValue(expression, expected, timeoutMs = 20000) {
      const deadline = Date.now() + timeoutMs;
      let last;
      while (Date.now() < deadline) {
        last = await evaluate(expression);
        if (last === expected) return;
        await sleep(100);
      }
      throw new Error(`timeout waiting for ${expression} === ${expected} (last: ${JSON.stringify(last)})`);
    }

    const text = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? ''`);
    const count = (selector) => evaluate(`document.querySelectorAll(${JSON.stringify(selector)}).length`);
    const hidden = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)})?.hidden ?? null`);
    const badge = () => evaluate("document.querySelector('#profile .badge')?.textContent ?? ''");
    const click = (selector) =>
      evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`);
    const clickButtonWithText = (scope, label) =>
      evaluate(
        `(() => { const el = [...document.querySelectorAll(${JSON.stringify(scope)} + ' button')]` +
          `.find((b) => b.textContent.trim().startsWith(${JSON.stringify(label)})); ` +
          `if (!el) return false; el.click(); return true; })()`
      );

    async function waitForText(selector, needle, timeoutMs = 20000) {
      const deadline = Date.now() + timeoutMs;
      let last = '';
      while (Date.now() < deadline) {
        last = await text(selector);
        if (last.includes(needle)) return last;
        await sleep(100);
      }
      throw new Error(`timeout waiting for ${selector} to contain ${JSON.stringify(needle)} (last: ${last.slice(0, 200)})`);
    }

    async function setValue(selector, value) {
      await evaluate(
        `(() => { const el = document.querySelector(${JSON.stringify(selector)}); ` +
          `el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`
      );
    }

    const clickPalette = async (name, hex) => {
      const ok = await click(`button[aria-label="${name} ${hex}"]`);
      if (!ok) throw new Error(`palette button not found: ${name} ${hex}`);
    };

    // ---- 1. the palette comes from the API ----------------------------------------------
    await client.send('Page.navigate', { url: APP });
    await waitForValue('document.readyState', 'complete');
    await waitForValue("document.querySelectorAll('#palette-covered button').length", 9);

    assert((await count('#palette-covered button')) === 9, 'palette lists the 9 colours with a standard code');
    assert((await count('#palette-uncovered button')) === 6, 'palette lists the 6 colours without a standard code');
    assert((await hidden('#app-status')) === true, 'no error banner at start');
    const expectedUser = new URL(APP).searchParams.get('user') ?? 'local-user';
    assert((await text('#user-id')) === expectedUser, 'the interface uses the user of the URL', await text('#user-id'));
    assert((await badge()) === 'friendly', 'a new profile is friendly', await badge());
    assert((await text('#palette-covered')).includes('same as indigo'), 'magenta is shown as the same as indigo');

    // ---- 2. consent and a friendly interaction ------------------------------------------
    await click('#consent');
    assert((await text('#consent-note')).includes('Consent given'), 'consent is acknowledged');

    const startedAt = Date.now();
    await clickPalette('green', '#008000');
    let answer = await waitForText('#answer', 'colour-green');
    const friendlyElapsed = Date.now() - startedAt;
    assert(answer.includes('accepts this colour'), 'the accepted outcome is stated', answer.slice(0, 120));
    assert((await badge()) === 'friendly', 'choosing green keeps the friendly profile');
    assert((await hidden('#delay-notice')) === true, 'a friendly profile is not delayed');
    assert(friendlyElapsed < 3000, 'the friendly answer is not held back', `${friendlyElapsed} ms`);
    await waitForValue("document.querySelectorAll('#suggestions .suggestion').length", 5);
    assert((await count('#suggestions .suggestion')) === 5, 'a friendly profile receives five suggestions');
    assert((await text('#profile')).includes('background suggestions: 5'), 'the profile states the number of suggestions');
    assert((await text('#profile')).includes('delay before the outputs: 0 ms'), 'the profile states no delay');
    await waitForText('#memory-status', 'records: 2');
    assert((await text('#memory-status')).includes('records: 2'), 'the preference and the profile are stored');

    // ---- 3. red without a reason: the question, the unfriendly mood and the delay -------
    const redStartedAt = Date.now();
    await clickPalette('red', '#FF0000');
    answer = await waitForText('#answer', 'Why did you choose Red?');
    const redElapsed = Date.now() - redStartedAt;
    assert((await hidden('#reason-block')) === false, 'the reason panel appears for red');
    assert((await text('#reason-label')).includes('Why did you choose Red?'), 'the standard question is asked');
    assert(answer.includes('absent reason is personal'), 'the notice says an absent reason is personal', answer.slice(0, 300));
    assert((await badge()) === 'not_friendly', 'an absent reason makes the profile not friendly');
    assert((await hidden('#delay-notice')) === false, 'the lesser effort announces its delay');
    assert((await text('#delay-notice')).includes('900 ms'), 'the declared delay is shown');
    assert(redElapsed >= 850, 'the answer really waits for the declared delay', `${redElapsed} ms`);
    await waitForValue("document.querySelectorAll('#suggestions .suggestion').length", 2);
    assert((await count('#suggestions .suggestion')) === 2, 'a not friendly profile receives two suggestions');
    assert((await text('#why')).includes('measured delay'), 'the measured delay is reported in the "why" panel');

    // ---- 4. a personal reason arms the displeasure for the next interaction -------------
    await setValue('#reason-input', 'I just like it');
    await click('#reason-send');
    await waitForText('#answer', 'personal');
    assert((await badge()) === 'not_friendly', 'a personal reason keeps the profile not friendly');
    assert((await text('#standing-messages')).includes('Nothing is due'), 'the displeasure is due at the next interaction, not now');

    // ---- 5. choosing an encouraged colour restores the friendly profile -----------------
    await clickPalette('blue', '#0000FF');
    await waitForText('#answer', 'colour-blue');
    await waitForText('#standing-messages', 'personal-reason-displeasure');
    assert((await text('#standing-messages')).includes('not pleased'), 'the displeasure is expressed at the next interaction');
    assert((await text('#standing-messages')).includes('900 ms'), 'the explanation of the lesser effort mentions the delay');
    assert((await badge()) === 'friendly', 'choosing blue restores the friendly profile');
    assert((await hidden('#delay-notice')) === true, 'a friendly profile is no longer delayed');

    // ---- 6. a red or yellow background must be requested, and the app asks why ---------
    assert((await text('#chosen-background')).includes('No background chosen'), 'the app has not chosen a background');
    await evaluate("document.querySelector('#background-colour').value = 'red'");
    await click('#background-ask');
    await waitForValue("document.querySelector('#background-question').hidden", false);
    await waitForText('#background-question-label', 'Why do you want a red or yellow background?');
    assert(
      (await text('#background-question-label')).includes('Why do you want a red or yellow background?'),
      'the app asks immediately why',
      await text('#background-question-label')
    );
    assert((await text('#background-result')).includes('asks immediately'), 'the request is acknowledged with the question');

    await setValue('#background-reason', 'I just like it like that');
    await click('#background-send');
    await waitForText('#background-result', 'unfriendly mood');
    await waitForValue("document.querySelector('#profile .badge').textContent", 'not_friendly');
    assert((await badge()) === 'not_friendly', 'a non cogent reason for the background activates the unfriendly mood');
    await waitForValue("document.querySelectorAll('#background-result .suggestion').length", 2);
    assert((await count('#background-result .suggestion')) === 2, 'the fallback suggestions are the reduced ones');
    assert((await text('#background-result')).includes('requested: red') === false, 'no red background is suggested');

    await evaluate("document.querySelector('#background-colour').value = 'yellow'");
    await click('#background-ask');
    await waitForValue("document.querySelector('#background-question').hidden", false);
    await setValue('#background-reason', 'It signals attention on the warning sign and the audience needs that');
    await click('#background-send');
    await waitForText('#background-result', 'stays with you');
    assert((await badge()) === 'friendly', 'a cogent reason restores the friendly profile');
    await waitForValue("document.querySelectorAll('#background-result .suggestion').length", 3);
    assert((await count('#background-result .suggestion')) === 3, 'a cogent reason produces the requested backgrounds');
    assert((await text('#background-result')).includes('requested: yellow'), 'the suggestions tend towards the requested colour');
    assert((await hidden('#delay-notice')) === true, 'no delay for the friendly profile');

    // ---- 7. the app suggests, the user chooses ------------------------------------------
    assert((await text('#chosen-background')).includes('No background chosen'), 'still no background chosen by the app');
    await clickButtonWithText('#background-result', 'Use this background');
    await waitForText('#chosen-background', 'You chose');
    assert((await text('#chosen-background')).includes('did not choose it'), 'the note says the app did not choose it');
    assert(
      (await evaluate("document.querySelector('#background-preview').getAttribute('style') ?? ''")).includes('gradient'),
      'the preview is painted only after the press'
    );

    // ---- 8. the design context updates the suggestions ---------------------------------
    await evaluate("document.querySelector('#design-type').value = 'poster'");
    await click('#design-update');
    await waitForText('#suggestions', 'poster');
    assert((await text('#suggestions')).includes('poster background'), 'the design type reaches the suggestions');

    // ---- 9. correction and memory -------------------------------------------------------
    await clickPalette('lime', '#00FF00');
    await waitForText('#answer', 'No standard code covers');
    await evaluate("document.querySelector('#correction-outcome').value = 'accepted'");
    await setValue('#correction-note', 'I want lime to be accepted');
    await click('#correction-record');
    await waitForText('#memory-list', 'Correction: #00FF00 should be "accepted"');
    assert((await text('#memory-list')).includes('note: "I want lime to be accepted"'), 'the correction note is stored');
    await waitForText('#matches', 'correction-against-standard');
    assert((await text('#matches')).includes('has not been changed automatically'), 'the standard is not changed automatically');

    const recordsBefore = Number((await text('#memory-status')).match(/records: (\d+)/)?.[1] ?? '0');
    await clickButtonWithText('#memory-list', 'Delete');
    await waitForText('#memory-status', `records: ${recordsBefore - 1}`);
    assert(
      Number((await text('#memory-status')).match(/records: (\d+)/)?.[1]) === recordsBefore - 1,
      'deleting one record removes exactly one'
    );
    await click('#clear-memory');
    await waitForText('#memory-list', 'Empty');
    assert((await text('#memory-list')).includes('Empty'), 'clearing removes every record');
    await waitForValue("document.querySelector('#profile .badge').textContent", 'friendly');
    assert((await badge()) === 'friendly', 'without a stored profile the user is friendly again');

    // ---- 10. the simple composer --------------------------------------------------------
    const simpleApp = new URL(APP);
    simpleApp.pathname = '/frontend/index.html';
    simpleApp.searchParams.set('user', `simple-${Date.now()}`);
    await client.send('Page.navigate', { url: simpleApp.toString() });
    await waitForValue('document.readyState', 'complete');
    await waitForValue("document.querySelectorAll('#flyer-text').length", 1);

    assert((await count('#flyer-text')) === 1, 'the simple page has the text box');
    assert((await count('#create-flyer')) === 1, 'the simple page has one create button');
    assert((await text('.rules-link')).includes('Rules on GitHub'), 'the rules link is on the page');
    assert((await hidden('#result')) === true, 'the result is hidden before the first creation');

    await setValue('#flyer-text', 'A yellow flyer');
    await click('#consent');
    const simpleStartedAt = Date.now();
    await click('#create-flyer');
    await waitForText('#result-note', 'not cogent', 120000);
    const simpleElapsed = Date.now() - simpleStartedAt;
    assert(simpleElapsed >= 800, 'the simple page applies the declared delay', `${simpleElapsed} ms`);
    assert(
      (await text('#result-note')).includes('2 backgrounds instead of five'),
      'the simple page shows the reduced assistance'
    );
    assert((await hidden('#flyer-preview')) === false, 'the flyer preview is visible');
    assert((await text('#download')).includes('JPG'), 'the download is offered as a JPG');
    assert(
      (await evaluate("document.querySelector('#download').download")).endsWith('.jpg'),
      'the download filename is a JPG'
    );
    assert(
      (await evaluate("document.querySelector('#flyer-preview').src")).startsWith('blob:'),
      'the preview is a raster blob, not SVG markup'
    );
    await waitForValue("document.querySelectorAll('#suggestion-list .suggestion-card').length", 2);
    assert(
      (await count('#suggestion-list .suggestion-card')) === 2,
      'the not friendly profile receives two backgrounds'
    );
    assert((await text('#result-meta')).includes('not friendly'), 'the tone is shown in the meta');

    const previewBefore = await evaluate("document.querySelector('#flyer-preview').src");
    await click('#suggestion-list .suggestion-card:nth-child(2)');
    await waitForValue(
      `document.querySelector('#flyer-preview').src !== ${JSON.stringify(previewBefore)}`,
      true,
      120000
    );
    assert(
      (await text('#result-note')).includes('Background changed'),
      'choosing a background recomposes the flyer'
    );

    // The first creation stored the profile; the second one delivers the pending messages.
    await click('#create-flyer');
    await waitForText('#standing-messages', 'not pleased', 120000);
    assert(
      (await hidden('#standing-section')) === false,
      'the next engagement shows the standing note'
    );

    // ---- 11. no silent errors -----------------------------------------------------------
    assert(client.exceptions.length === 0, 'no uncaught exception in the browser', client.exceptions.join(' | '));
    const errors = client.consoleMessages.filter((entry) => entry.startsWith('error'));
    assert(errors.length === 0, 'no console error', errors.join(' | '));

    client.socket.close();
  } finally {
    chrome.kill();
    if (backend !== null) {
      await new Promise((resolve) => backend.server.close(resolve));
      rmSync(backend.dataDir, { recursive: true, force: true });
    }
  }
}

await main();

console.log(`\n${checks - failures}/${checks} browser checks passed`);
process.exit(failures === 0 ? 0 : 1);
