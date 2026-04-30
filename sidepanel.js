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
  return await chrome.storage.local.get(['token', 'favorites', 'lastView', 'cache']);
}

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
const ISSUE_FIELDS = `
  nodes {
    __typename
    ... on Issue {
      number title url state
      repository { nameWithOwner }
      ${LABEL_FRAG}
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

  const searchBlocks = Object.keys(VIEWS).map(view => `
    ${view}: search(query: "${VIEWS[view]}", type: ISSUE, first: 50) { ${ISSUE_FIELDS} }
  `).join('\n');

  const favBlocks = favEntries.map(f => `
    ${f.alias}: repository(owner: "${f.owner}", name: "${f.name}") {
      issueOrPullRequest(number: ${f.number}) {
        __typename
        ... on Issue { number title url state repository { nameWithOwner } ${LABEL_FRAG} }
        ... on PullRequest { number title url state repository { nameWithOwner } ${LABEL_FRAG} }
      }
    }
  `).join('\n');

  return { query: `query { ${searchBlocks} ${favBlocks} }`, favEntries };
}

function normalizeNode(n) {
  if (!n) return null;
  return {
    number: n.number,
    title: n.title,
    html_url: n.url,
    state: (n.state || '').toLowerCase(),
    isPR: n.__typename === 'PullRequest',
    repo: n.repository?.nameWithOwner || '',
    labels: (n.labels?.nodes || []).map(l => ({ name: l.name, color: l.color })),
  };
}

async function ghGraphQL(token, query) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/vnd.github+json',
    },
    body: JSON.stringify({ query }),
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
    const { query, favEntries } = buildRefreshQuery(cfg.favorites || {});
    const data = await ghGraphQL(cfg.token, query);

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

async function render() {
  const cfg = await getCfg();
  const cache = cfg.cache;
  const view = $('view').value;
  const filter = $('filter').value.trim().toLowerCase();
  const favorites = cfg.favorites || {};
  const favSet = new Set(Object.keys(favorites));

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

  list.innerHTML = '';
  for (const issue of issues) {
    const k = key(issue);
    const isFav = favSet.has(k);
    const div = document.createElement('div');
    div.className = 'issue';
    const labelHtml = (issue.labels || []).map(l => {
      const c = (l.color || '888').replace('#', '');
      return `<span class="label" style="--lc:#${escapeHtml(c)}">${escapeHtml(l.name)}</span>`;
    }).join('');
    const showState = view === 'favorites' && issue.state && issue.state !== 'open';
    const stateBadge = showState
      ? `<span class="badge ${issue.state}">${issue.isPR ? 'PR' : 'Issue'} · ${issue.state}</span>`
      : (issue.isPR ? '<span class="badge pr">PR</span>' : '');
    div.innerHTML = `
      <button class="star ${isFav ? 'on' : ''}" data-key="${k}" title="${isFav ? 'Unfavorite' : 'Favorite'}" aria-label="${isFav ? 'Unfavorite' : 'Favorite'}">★</button>
      <div class="body">
        <a href="${issue.html_url}" target="_blank" rel="noopener" class="title">${escapeHtml(issue.title)}</a>
        <div class="meta">
          <span class="repo-tag">${escapeHtml(issue.repo || '')}</span>
          <span class="num">#${issue.number}</span>
          ${stateBadge}
          ${labelHtml}
        </div>
      </div>
    `;
    list.appendChild(div);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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
    favs[k] = { title: a.textContent, url: a.href };
  }
  await setFavorites(favs);
  render();
});

$('view').addEventListener('change', async () => {
  await chrome.storage.local.set({ lastView: $('view').value });
  render();
});
$('filter').addEventListener('input', render);
$('refresh').addEventListener('click', refresh);
$('opts').addEventListener('click', () => chrome.runtime.openOptionsPage());

(async () => {
  const cfg = await getCfg();
  if (cfg.lastView) $('view').value = cfg.lastView;
  render();
})();
