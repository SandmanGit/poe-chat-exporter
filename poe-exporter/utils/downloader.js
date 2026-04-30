/**
 * downloader.js
 * Sends download requests to the background service worker.
 * 
 * The background worker uses an offscreen document to create
 * persistent blob URLs, then chrome.downloads.download() to
 * save the file with the correct filename.
 * 
 * This avoids the popup lifecycle problem: blob URLs created
 * in the popup are destroyed when the popup closes, causing
 * Chrome to fall back to UUID filenames.
 */

window.PoeDownloader = {
  async downloadBlob(contentString, filename, mimeType) {
    const safeFilename = filename
      .replace(/[\\/:*?"<>|\s]+/g, '-')
      .replace(/^-+|-+$/g, '');

    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        action: 'download_file',
        content: contentString,
        filename: safeFilename,
        mimeType: mimeType
      }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (response && response.success) {
          resolve(true);
        } else {
          reject(new Error(response?.error || 'Download failed'));
        }
      });
    });
  }
};
