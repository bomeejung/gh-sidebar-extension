const SCOPES = 'repo';
const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';
const USER_URL = 'https://api.github.com/user';

const $ = (id) => document.getElementById(id);

let clientId = '';
let pollAbort = null;

function isConfigured() {
  return clientId.length > 0;
}

async function loadState() {
  const cfg = await chrome.storage.local.get([
    'token', 'tokenSource', 'tokenLogin', 'searchScope', 'clientId',
  ]);
  clientId = cfg.clientId || '';
  $('clientId').value = clientId;
  $('searchScope').value = cfg.searchScope || '';
  $('app-section').open = !isConfigured();
  if (cfg.token) {
    showSignedIn(cfg.tokenSource, cfg.tokenLogin);
  } else {
    showSignedOut();
  }
}

function showSignedIn(source, login) {
  $('signin').hidden = true;
  $('device-prompt').hidden = true;
  $('signout').hidden = false;
  const sourceLabel = source === 'pat' ? 'PAT' : 'OAuth';
  const who = login ? ` as ${login}` : '';
  $('auth-status').textContent = `Signed in${who} (${sourceLabel}).`;
  $('auth-status').className = 'ok';
}

function showSignedOut() {
  $('signin').hidden = false;
  $('signin').disabled = !isConfigured();
  $('device-prompt').hidden = true;
  $('signout').hidden = true;
  $('auth-status').textContent = isConfigured()
    ? 'Not signed in.'
    : 'Not signed in. Add an OAuth App Client ID above to enable sign-in.';
  $('auth-status').className = 'muted';
}

async function fetchLogin(token) {
  try {
    const r = await fetch(USER_URL, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
    });
    if (!r.ok) return null;
    const j = await r.json();
    return j.login || null;
  } catch {
    return null;
  }
}

async function saveClientId() {
  const id = $('clientId').value.trim();
  await chrome.storage.local.set({ clientId: id });
  clientId = id;
  const s = $('clientid-status');
  s.textContent = ' Saved ✓';
  s.className = 'ok';
  setTimeout(() => { s.textContent = ''; }, 2000);
  if ($('signout').hidden) showSignedOut();
}

async function startDeviceFlow() {
  if (!isConfigured()) return;
  $('signin').disabled = true;
  setPollStatus('Requesting code…', 'muted');
  try {
    const res = await fetch(DEVICE_CODE_URL, {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, scope: SCOPES }),
    });
    if (!res.ok) throw new Error(`device/code returned ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error_description || data.error);

    $('signin').hidden = true;
    $('device-prompt').hidden = false;
    $('user-code').textContent = data.user_code || '';
    const verifyUri = data.verification_uri || 'https://github.com/login/device';
    $('verify-link').href = verifyUri;
    $('verify-link').textContent = verifyUri.replace(/^https?:\/\//, '');
    setPollStatus('Waiting for authorization…', 'muted');

    pollAbort = { aborted: false };
    const token = await pollForToken(
      data.device_code,
      data.interval || 5,
      data.expires_in || 900,
      pollAbort
    );
    if (!token) return;

    const login = await fetchLogin(token);
    await chrome.storage.local.set({ token, tokenSource: 'oauth', tokenLogin: login });
    showSignedIn('oauth', login);
  } catch (e) {
    setPollStatus(`Sign-in failed: ${e.message}`, 'err');
    $('signin').hidden = false;
    $('signin').disabled = !isConfigured();
    $('device-prompt').hidden = true;
  }
}

async function pollForToken(deviceCode, interval, expiresIn, abort) {
  const deadline = Date.now() + expiresIn * 1000;
  let delayMs = interval * 1000;
  while (!abort.aborted && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, delayMs));
    if (abort.aborted) return null;

    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    });
    const data = await res.json();
    if (data.access_token) return data.access_token;

    switch (data.error) {
      case 'authorization_pending':
        continue;
      case 'slow_down':
        delayMs += 5000;
        continue;
      case 'expired_token':
        throw new Error('Code expired. Try again.');
      case 'access_denied':
        throw new Error('Authorization denied.');
      default:
        throw new Error(data.error_description || data.error || 'Unknown error');
    }
  }
  if (!abort.aborted) throw new Error('Code expired. Try again.');
  return null;
}

function setPollStatus(text, cls) {
  const el = $('poll-status');
  el.textContent = text;
  el.className = cls || '';
}

async function signOut() {
  await chrome.storage.local.remove(['token', 'tokenSource', 'tokenLogin']);
  showSignedOut();
}

async function savePat() {
  const token = $('token').value.trim();
  if (!token) return;
  $('save-token').disabled = true;
  const status = $('pat-status');
  status.textContent = ' Saving…';
  status.className = 'muted';
  const login = await fetchLogin(token);
  await chrome.storage.local.set({ token, tokenSource: 'pat', tokenLogin: login });
  $('token').value = '';
  status.textContent = ' Saved ✓';
  status.className = 'ok';
  setTimeout(() => { status.textContent = ''; }, 2000);
  $('save-token').disabled = false;
  $('pat-section').open = false;
  showSignedIn('pat', login);
}

async function saveScope() {
  const searchScope = $('searchScope').value.trim();
  await chrome.storage.local.set({ searchScope });
  const s = $('scope-status');
  s.textContent = ' Saved ✓';
  s.className = 'ok';
  setTimeout(() => { s.textContent = ''; }, 2000);
}

$('save-clientid').addEventListener('click', saveClientId);
$('signin').addEventListener('click', startDeviceFlow);
$('signout').addEventListener('click', signOut);
$('cancel-signin').addEventListener('click', () => {
  if (pollAbort) pollAbort.aborted = true;
  showSignedOut();
});
$('save-token').addEventListener('click', savePat);
$('save-scope').addEventListener('click', saveScope);

loadState();
