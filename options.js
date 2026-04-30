(async () => {
  const { token, searchScope } = await chrome.storage.local.get(['token', 'searchScope']);
  if (token) document.getElementById('token').value = token;
  if (searchScope) document.getElementById('searchScope').value = searchScope;
})();

document.getElementById('save').addEventListener('click', async () => {
  const token = document.getElementById('token').value.trim();
  const searchScope = document.getElementById('searchScope').value.trim();
  await chrome.storage.local.set({ token, searchScope });
  const s = document.getElementById('status');
  s.textContent = ' Saved ✓';
  s.className = 'ok';
});
