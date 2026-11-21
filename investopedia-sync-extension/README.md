# Investopedia Sync extension

This unpacked browser extension copies visible portfolio information from the Investopedia Simulator into Stock Strategy Lab. It never requests, reads, or stores your password.

## Chrome or Edge

1. Download the repository ZIP and unzip it.
2. Open `chrome://extensions` or `edge://extensions`.
3. Turn on **Developer mode**.
4. Choose **Load unpacked** and select the `investopedia-sync-extension` folder.
5. Sign in to Investopedia and open the Simulator **Portfolio** page.
6. Press **Capture for Stock Strategy Lab**.
7. Open Stock Strategy Lab and press **Sync from Investopedia**.

## Firefox

1. Download the repository ZIP and unzip it.
2. Open `about:debugging#/runtime/this-firefox`.
3. Choose **Load Temporary Add-on**.
4. Select `investopedia-sync-extension/manifest.json`.
5. Capture on Investopedia, then sync on Stock Strategy Lab.

Firefox removes temporary add-ons when the browser restarts. Permanent Firefox installation requires Mozilla signing.

## Privacy and limitations

- Data stays in the extension's browser-local storage.
- The extension reads tables only on Investopedia Simulator pages.
- Investopedia credentials and cookies are never copied.
- Investopedia has no supported public API; UI changes may require selector updates.
- The sync runs only when you press the capture and sync buttons. It is not background monitoring.
