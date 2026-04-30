/**
 * offscreen.js
 * Runs in a persistent offscreen document.
 * Creates blob URLs that persist independently of the popup's lifecycle.
 */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'create_blob_url') {
    try {
      const blob = new Blob([message.content], { type: message.mimeType });
      const blobUrl = URL.createObjectURL(blob);
      console.log('[PoeExporter:Offscreen] Created blob URL:', blobUrl.substring(0, 60));
      sendResponse({ success: true, blobUrl });
    } catch (err) {
      console.error('[PoeExporter:Offscreen] Error:', err);
      sendResponse({ success: false, error: err.message });
    }
    return true;
  }
});
