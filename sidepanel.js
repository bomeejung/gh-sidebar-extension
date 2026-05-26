const $ = (id) => document.getElementById(id);
const list = $('list');
const status = $('status');

const VIEWS = {
  assigned:  'is:issue is:open assignee:@me',
  created:   'is:issue is:open author:@me',
  mentioned: 'is:issue is:open mentions:@me',
  review:    'is:pull-request is:open review-requested:@me',
};

async function getCfg() {
  return await chrome.storage.local.get(['token', 'favorites', 'lastView', 'cache', 'searchScope']);
}

let searchResults = null;

async function setCache(cache) {
  await chrome.storage.local.set({ cache });
}

async function setFavorites(favs) {
  await chrome.storage.local.set({ favorites: favs });
}

function key(issue) {
  return `${issue.repo}#${issue.number}`;
}

const LABEL_FRAG = `labels(first: 20) { nodes { name color } }`;
const PR_LINK_FRAG = `
  timelineItems(first: 10, itemTypes: [CROSS_REFERENCED_EVENT]) {
    nodes {
      ... on CrossReferencedEvent {
        source {
          __typename
          ... on PullRequest { state }
        }
      }
    }
  }
`;

const ISSUE_FIELDS = `
  nodes {
    __typename
    ... on Issue {
      number title url state
      repository { nameWithOwner }
      ${LABEL_FRAG}
      ${PR_LINK_FRAG}
    }
    ... on PullRequest {
      number title url state
      repository { nameWithOwner }
      ${LABEL_FRAG}
    }
  }
`;

function buildRefreshQuery(favorites) {
  const favEntries = Object.keys(favorites || {}).map((k, i) => {
    const [repo, num] = k.split('#');
    const [owner, name] = repo.split('/');
    return { alias: `f${i}`, owner, name, number: Number(num) };
  });

  const variables = {};
  const varDecls = [];
  for (const f of favEntries) {
    variables[`${f.alias}_owner`] = f.owner;
    variables[`${f.alias}_name`] = f.name;
    variables[`${f.alias}_number`] = f.number;
    varDecls.push(
      `$${f.alias}_owner: String!, $${f.alias}_name: String!, $${f.alias}_number: Int!`
    );
  }
  const queryHeader = varDecls.length ? `query(${varDecls.join(', ')})` : 'query';

  const searchBlocks = Object.keys(VIEWS).map(view => `
    ${view}: search(query: "${VIEWS[view]}", type: ISSUE, first: 50) { ${ISSUE_FIELDS} }
  `).join('\n');

  const favBlocks = favEntries.map(f => `
    ${f.alias}: repository(owner: $${f.alias}_owner, name: $${f.alias}_name) {
      issueOrPullRequest(number: $${f.alias}_number) {
        __typename
        ... on Issue { number title url state repository { nameWithOwner } ${LABEL_FRAG} }
        ... on PullRequest { number title url state repository { nameWithOwner } ${LABEL_FRAG} }
      }
    }
  `).join('\n');

  return { query: `${queryHeader} { ${searchBlocks} ${favBlocks} }`, variables, favEntries };
}

function normalizeNode(n) {
  if (!n) return null;
  const linkedPRs = (n.timelineItems?.nodes || [])
    .map(e => e.source)
    .filter(s => s && s.__typename === 'PullRequest');
  return {
    number: n.number,
    title: n.title,
    html_url: n.url,
    state: (n.state || '').toLowerCase(),
    isPR: n.__typename === 'PullRequest',
    repo: n.repository?.nameWithOwner || '',
    labels: (n.labels?.nodes || []).map(l => ({ name: l.name, color: l.color })),
    hasOpenPR: linkedPRs.some(pr => pr.state === 'OPEN'),
  };
}

async function ghGraphQL(token, query, variables) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/vnd.github+json',
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  if (data.errors) throw new Error(data.errors.map(e => e.message).join('; '));
  return data.data;
}

async function refresh() {
  const cfg = await getCfg();
  if (!cfg.token) {
    setStatus('No token. Click ⚙ to configure.', 'err');
    return;
  }
  setStatus('Refreshing…', 'muted');
  $('refresh').disabled = true;
  try {
    const { query, variables, favEntries } = buildRefreshQuery(cfg.favorites || {});
    const data = await ghGraphQL(cfg.token, query, variables);

    const cache = {
      fetchedAt: Date.now(),
      views: {},
      favorites: {},
    };
    for (const view of Object.keys(VIEWS)) {
      cache.views[view] = (data[view]?.nodes || []).map(normalizeNode).filter(Boolean);
    }
    for (const f of favEntries) {
      const node = data[f.alias]?.issueOrPullRequest;
      const k = `${f.owner}/${f.name}#${f.number}`;
      cache.favorites[k] = node ? normalizeNode(node) : null;
    }
    await setCache(cache);
    render();
  } catch (e) {
    setStatus(e.message, 'err');
  } finally {
    $('refresh').disabled = false;
  }
}

function setStatus(text, cls) {
  status.textContent = text;
  status.className = `status ${cls || ''}`;
}

function timeAgo(ts) {
  if (!ts) return 'never';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

async function runSearch() {
  const cfg = await getCfg();
  if (!cfg.token) { setStatus('No token. Click ⚙ to configure.', 'err'); return; }
  const scope = (cfg.searchScope || '').trim();
  const text = $('filter').value.trim();
  if (!text) {
    searchResults = null;
    render();
    return;
  }
  const hasType = /\bis:(issue|pull-request|pr)\b/.test(text);
  const q = `is:open ${hasType ? '' : 'is:issue'} ${scope} ${text}`.replace(/\s+/g, ' ').trim();
  setStatus(`Searching "${text}"…`, 'muted');
  try {
    const url = `https://api.github.com/search/issues?q=${encodeURIComponent(q)}&per_page=50&sort=updated`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${cfg.token}`, Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) throw new Error(`GitHub ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    searchResults = (data.items || []).map(i => ({
      number: i.number,
      title: i.title,
      html_url: i.html_url,
      state: (i.state || '').toLowerCase(),
      isPR: !!i.pull_request,
      repo: (i.repository_url || '').replace('https://api.github.com/repos/', ''),
      labels: (i.labels || []).map(l => ({ name: l.name, color: l.color })),
    }));
    setStatus(`${searchResults.length} match${searchResults.length === 1 ? '' : 'es'}`, 'muted');
    render();
  } catch (e) {
    setStatus(e.message, 'err');
  }
}

async function render() {
  const cfg = await getCfg();
  const cache = cfg.cache;
  const view = $('view').value;
  const filter = $('filter').value.trim().toLowerCase();
  const favorites = cfg.favorites || {};
  const favSet = new Set(Object.keys(favorites));

  if (view === 'search') {
    $('refresh').disabled = true;
    $('filter').placeholder = 'Search open issues — press Enter';
    if (searchResults === null) {
      list.innerHTML = '<div class="empty">Type a query and press Enter.</div>';
      if (status.textContent === '—' || !status.textContent) setStatus('Search mode', 'muted');
      return;
    }
    let issues = searchResults;
    if (!issues.length) {
      list.innerHTML = '<div class="empty">No matches.</div>';
      return;
    }
    renderIssues(issues, favSet, view);
    return;
  }

  $('refresh').disabled = false;
  $('filter').placeholder = 'Filter…';

  if (!cache) {
    list.innerHTML = '<div class="empty">No data yet. Hit ↻ to fetch.</div>';
    setStatus('Last refresh: never', 'muted');
    return;
  }

  setStatus(`Updated ${timeAgo(cache.fetchedAt)}`, 'muted');

  let issues = [];
  if (view === 'favorites') {
    issues = Object.keys(favorites).map(k => {
      return cache.favorites?.[k] || {
        number: Number(k.split('#')[1]),
        title: favorites[k].title || k,
        html_url: favorites[k].url || '#',
        state: 'unknown',
        repo: k.split('#')[0],
        isPR: false,
      };
    });
  } else if (view === 'assignedNoPR') {
    issues = (cache.views?.assigned || []).filter(i => !i.hasOpenPR);
  } else if (view === 'assignedWithPR') {
    issues = (cache.views?.assigned || []).filter(i => i.hasOpenPR);
  } else {
    issues = cache.views?.[view] || [];
  }

  if (filter) {
    const tokens = filter.split(/\s+/).filter(Boolean);
    issues = issues.filter(i => {
      const labelText = (i.labels || []).map(l => l.name).join(' ');
      const hay = `${i.title} ${i.repo || ''} #${i.number} ${i.isPR ? 'pr' : 'issue'} ${i.state} ${labelText}`.toLowerCase();
      return tokens.every(t => hay.includes(t));
    });
  }

  if (!issues.length) {
    list.innerHTML = '<div class="empty">No issues.</div>';
    return;
  }
  renderIssues(issues, favSet, view);
}

function isSafeGitHubUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname === 'github.com';
  } catch {
    return false;
  }
}

function safeHexColor(c) {
  return /^[0-9a-fA-F]{3,8}$/.test(c) ? c : '888';
}

function renderIssues(issues, favSet, view) {
  list.replaceChildren();
  for (const issue of issues) {
    const k = key(issue);
    const isFav = favSet.has(k);

    const div = document.createElement('div');
    div.className = 'issue';

    const star = document.createElement('button');
    star.className = isFav ? 'star on' : 'star';
    star.dataset.key = k;
    const favLabel = isFav ? 'Unfavorite' : 'Favorite';
    star.title = favLabel;
    star.setAttribute('aria-label', favLabel);
    star.textContent = '★';
    div.appendChild(star);

    const body = document.createElement('div');
    body.className = 'body';

    const a = document.createElement('a');
    a.className = 'title';
    a.target = '_blank';
    a.rel = 'noopener';
    if (isSafeGitHubUrl(issue.html_url)) a.href = issue.html_url;
    a.textContent = issue.title || '';
    body.appendChild(a);

    const meta = document.createElement('div');
    meta.className = 'meta';

    const repoTag = document.createElement('span');
    repoTag.className = 'repo-tag';
    repoTag.textContent = issue.repo || '';
    meta.appendChild(repoTag);

    const num = document.createElement('span');
    num.className = 'num';
    num.textContent = `#${issue.number}`;
    meta.appendChild(num);

    const showState = (view === 'favorites' || view === 'search') && issue.state && issue.state !== 'open';
    if (showState) {
      const badge = document.createElement('span');
      badge.className = `badge ${issue.state}`;
      badge.textContent = `${issue.isPR ? 'PR' : 'Issue'} · ${issue.state}`;
      meta.appendChild(badge);
    } else if (issue.isPR) {
      const badge = document.createElement('span');
      badge.className = 'badge pr';
      badge.textContent = 'PR';
      meta.appendChild(badge);
    }

    for (const l of (issue.labels || [])) {
      const span = document.createElement('span');
      span.className = 'label';
      span.style.setProperty('--lc', `#${safeHexColor((l.color || '888').replace(/#/g, ''))}`);
      span.textContent = l.name || '';
      meta.appendChild(span);
    }

    body.appendChild(meta);
    div.appendChild(body);
    list.appendChild(div);
  }
}

list.addEventListener('click', async (e) => {
  const star = e.target.closest('.star');
  if (!star) return;
  e.preventDefault();
  const k = star.dataset.key;
  const cfg = await getCfg();
  const favs = cfg.favorites || {};
  if (favs[k]) {
    delete favs[k];
  } else {
    const issueEl = star.closest('.issue');
    const a = issueEl.querySelector('a.title');
    const url = isSafeGitHubUrl(a.href) ? a.href : '';
    favs[k] = { title: a.textContent, url };
  }
  await setFavorites(favs);
  render();
});

$('view').addEventListener('change', async () => {
  await chrome.storage.local.set({ lastView: $('view').value });
  if ($('view').value !== 'search') searchResults = null;
  render();
});
$('filter').addEventListener('input', () => {
  if ($('view').value !== 'search') render();
});
$('filter').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && $('view').value === 'search') {
    e.preventDefault();
    runSearch();
  }
});
$('refresh').addEventListener('click', refresh);
$('opts').addEventListener('click', () => chrome.runtime.openOptionsPage());

(async () => {
  const cfg = await getCfg();
  if (cfg.lastView) $('view').value = cfg.lastView;
  render();
})();
