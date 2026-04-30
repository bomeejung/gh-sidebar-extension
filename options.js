(async () => {
  const { token } = await chrome.storage.local.get('token');
  if (token) document.getElementById('token').value = token;
})();

document.getElementById('save').addEventListener('click', async () => {
  const token = document.getElementById('token').value.trim();
  await chrome.storage.local.set({ token });
  const s = document.getElementById('status');
  s.textContent = ' Saved ✓';
  s.className = 'ok';
});
