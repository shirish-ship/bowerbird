// Bowerbird's background worker. It only opens Bowerbird's own page (from the toolbar button, or from
// "Open saved posts" in the menu on x.com). It makes no network requests.

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg?.type !== 'openLibrary' || sender.id !== chrome.runtime.id) return;
  chrome.runtime.openOptionsPage().then(
    () => reply({ ok: true }),
    (e) => reply({ ok: false, error: String(e?.message || e) })
  );
  return true; // the reply comes later
});
