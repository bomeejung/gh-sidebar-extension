const $ = (id) => document.getElementById(id);
const list = $('list');

async function getCfg() {
  return await chrome.storage.local.get(['token', 'favorites', 'lastView']);
}

async function setFavorites(favs) {
  await chrome.storage.local.set({ favorites: favs });
}

function repoFromUrl(url) {
  // https://api.github.com/repos/OWNER/REPO/issues/123
  const m = url.match(/repos\/([^/]+\/[^/]+)\/issues\/(\d+)/);
  return m ? { repo: m[1], number: Number(m[2]) } : null;
}

function htmlUrl(issue) {
  return issue.html_url;
}

function key(issue) {
  const r = repoFromUrl(issue.url);
  return r ? `${r.repo}#${r.number}` : issue.html_url;
}

async function ghSearch(token, q) {
  const url = `https://api.github.com/search/issues?q=${encodeURIComponent(q)}&per_page=50&sort=updated`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.items || [];
}

async function ghFetchOne(token, repo, number) {
  const res = await fetch(`https://api.github.com/repos/${repo}/issues/${number}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) return null;
  return await res.json();
}

function render(issues, favSet) {
  const filter = $('filter').value.toLowerCase();
  list.innerHTML = '';
  const filtered = issues.filter(i => !filter || i.title.toLowerCase().includes(filter) || (i.repo || '').toLowerCase().includes(filter));
  if (!filtered.length) {
    list.innerHTML = '<div class="empty">No issues.</div>';
    return;
  }
  for (const issue of filtered) {
    const k = key(issue);
    const isFav = favSet.has(k);
    const repo = issue.repo || (repoFromUrl(issue.url) || {}).repo || '';
    const div = document.createElement('div');
    div.className = 'issue';
    div.innerHTML = `
      <span class="star ${isFav ? 'on' : ''}" data-key="${k}">★</span>
      <span class="num">#${issue.number}</span>
      <a href="${htmlUrl(issue)}" target="_blank" rel="noopener">
        <div>${escapeHtml(issue.title)}</div>
        <div class="meta"><span class="repo-tag">${escapeHtml(repo)}</span>${issue.state}${issue.pull_request ? ' · PR' : ''}</div>
      </a>
    `;
    list.appendChild(div);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function load() {
  const cfg = await getCfg();
  if (!cfg.token) {
    list.innerHTML = '<div class="err">No GitHub token set. Click ⚙ to configure.</div>';
    return;
  }
  const view = $('view').value;
  await chrome.storage.local.set({ lastView: view });
  list.innerHTML = '<div class="empty">Loading…</div>';
  const favorites = cfg.favorites || {};
  const favSet = new Set(Object.keys(favorites));

  try {
    let issues = [];
    if (view === 'favorites') {
      const entries = Object.entries(favorites);
      const fetched = await Promise.all(entries.map(async ([k, meta]) => {
        const [repo, num] = k.split('#');
        const fresh = await ghFetchOne(cfg.token, repo, Number(num));
        if (fresh) return { ...fresh, repo };
        return { number: Number(num), title: meta.title || k, html_url: meta.url || '#', state: '?', url: `https://api.github.com/repos/${repo}/issues/${num}`, repo };
      }));
      issues = fetched;
    } else {
      const qMap = {
        assigned: 'is:issue is:open assignee:@me',
        created: 'is:issue is:open author:@me',
        mentioned: 'is:issue is:open mentions:@me',
        review: 'is:pull-request is:open review-requested:@me',
      };
      const items = await ghSearch(cfg.token, qMap[view]);
      issues = items.map(i => ({ ...i, repo: (repoFromUrl(i.url) || {}).repo || '' }));
    }
    render(issues, favSet);
  } catch (e) {
    list.innerHTML = `<div class="err">${escapeHtml(e.message)}</div>`;
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
    const a = issueEl.querySelector('a');
    favs[k] = { title: issueEl.querySelector('a > div').textContent, url: a.href };
  }
  await setFavorites(favs);
  star.classList.toggle('on');
  if ($('view').value === 'favorites') load();
});

$('view').addEventListener('change', load);
$('refresh').addEventListener('click', load);
$('filter').addEventListener('input', async () => {
  const cfg = await getCfg();
  // re-render from cache would be nicer; for simplicity reload
  load();
});
$('opts').addEventListener('click', () => chrome.runtime.openOptionsPage());

(async () => {
  const cfg = await getCfg();
  if (cfg.lastView) $('view').value = cfg.lastView;
  load();
})();
