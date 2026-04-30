/**
 * background.js — Service Worker
 * Poe Chat Exporter
 */

chrome.runtime.onInstalled.addListener(() => {
  console.log('[PoeExporter] Extension installed.');
});

const attachedDebuggerTabs = new Set();

async function ensureDebuggerAttached(target) {
  if (attachedDebuggerTabs.has(target.tabId)) return;
  await chrome.debugger.attach(target, '1.3');
  attachedDebuggerTabs.add(target.tabId);
}

async function detachDebugger(tabId) {
  if (!attachedDebuggerTabs.has(tabId)) return;
  await chrome.debugger.detach({ tabId });
  attachedDebuggerTabs.delete(tabId);
}

async function dispatchTrustedWheel(tabId, options = {}) {
  const target = { tabId };
  const x = Math.round(options.x || 400);
  const y = Math.round(options.y || 160);
  const deltaY = Number.isFinite(options.deltaY) ? options.deltaY : -900;

  await ensureDebuggerAttached(target);
  await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
    type: 'mouseWheel',
    x,
    y,
    deltaX: 0,
    deltaY,
    modifiers: 0,
    pointerType: 'mouse'
  });
}

/**
 * Handle async tab loading and execution
 */
async function extractFromTab(url) {
  return new Promise((resolve, reject) => {
    // 1. Create tab. Must be active: true because Poe relies on visibility to execute queries and render.
    chrome.tabs.create({ url, active: true }, (tab) => {
      const tabId = tab.id;
      let settled = false;

      const finish = (data) => {
        if (settled) return;
        settled = true;
        chrome.tabs.onUpdated.removeListener(listener);
        chrome.tabs.remove(tabId);
        resolve(data);
      };
      
      // 2. Listen for load
      const listener = (tid, changeInfo) => {
        if (tid === tabId && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          
          // 3. Inject script (in case it's not automatically injected by manifest matching)
          chrome.scripting.executeScript({
            target: { tabId: tabId },
            files: ['content.js']
          }).then(() => {
            chrome.tabs.sendMessage(tabId, { action: 'wait_for_messages', timeoutMs: 20000, intervalMs: 500 }, () => {
              if (chrome.runtime.lastError) {
                finish(null);
                return;
              }
              chrome.tabs.sendMessage(tabId, { action: 'auto_export', format: 'json' }, (res) => {
                if (chrome.runtime.lastError) {
                  finish(null);
                  return;
                }
                if (res && res.success) finish(res.data);
                else finish(null);
              });
            });
          }).catch(e => {
            finish(null);
          });
        }
      };
      
      chrome.tabs.onUpdated.addListener(listener);
    });
  });
}

/**
 * Listen for messages from popup.js, content.js, or offscreen.js
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  if (message.action === 'setBadge') {
    const tabId = message.tabId;
    if (tabId) {
      chrome.action.setBadgeBackgroundColor({ color: '#6c63ff', tabId });
      chrome.action.setBadgeText({ text: message.count > 0 ? String(message.count) : '', tabId });
    }
    sendResponse({ success: true });
    return true;
  }

  if (message.action === 'trusted_scroll') {
    const tabId = sender.tab && sender.tab.id;
    if (!tabId) {
      sendResponse({ success: false, error: 'No sender tab for trusted scroll' });
      return true;
    }

    (async () => {
      try {
        await dispatchTrustedWheel(tabId, message);
        sendResponse({ success: true });
      } catch (err) {
        console.error('[PoeExporter:BG] trusted_scroll failed:', err);
        sendResponse({ success: false, error: err.message });
      }
    })();

    return true;
  }

  if (message.action === 'trusted_scroll_end') {
    const tabId = sender.tab && sender.tab.id;
    if (!tabId) {
      sendResponse({ success: false, error: 'No sender tab for trusted scroll end' });
      return true;
    }

    (async () => {
      try {
        await detachDebugger(tabId);
        sendResponse({ success: true });
      } catch (err) {
        console.error('[PoeExporter:BG] trusted_scroll_end failed:', err);
        sendResponse({ success: false, error: err.message });
      }
    })();

    return true;
  }
  
  if (message.action === 'batch_extract') {
    const links = message.links;
    let results = [];
    
    (async () => {
      for (let i = 0; i < links.length; i++) {
        chrome.runtime.sendMessage({ action: 'batch_progress', current: i + 1, total: links.length });
        const data = await extractFromTab(links[i].href);
        if (data) results.push(data);
      }
      sendResponse({ success: true, data: results });
    })();
    
    return true;
  }

  if (message.action === 'download_file') {
    const { content, filename, mimeType } = message;
    
    (async () => {
      try {
        // 1. Ensure offscreen document exists
        const existingContexts = await chrome.runtime.getContexts({
          contextTypes: ['OFFSCREEN_DOCUMENT']
        });
        
        if (existingContexts.length === 0) {
          await chrome.offscreen.createDocument({
            url: 'offscreen.html',
            reasons: ['BLOBS'],
            justification: 'Create blob URL for file download'
          });
        }
        
        // 2. Send content to offscreen document to create blob URL
        const blobResponse = await chrome.runtime.sendMessage({
          action: 'create_blob_url',
          content: content,
          mimeType: mimeType
        });
        
        if (!blobResponse || !blobResponse.success) {
          sendResponse({ success: false, error: 'Failed to create blob URL: ' + (blobResponse?.error || 'unknown') });
          return;
        }
        
        // 3. Download using chrome.downloads with the persistent blob URL
        chrome.downloads.download({
          url: blobResponse.blobUrl,
          filename: filename,
          conflictAction: 'uniquify',
          saveAs: false
        }, (downloadId) => {
          if (chrome.runtime.lastError) {
            console.error('[PoeExporter:BG] Download failed:', chrome.runtime.lastError.message);
            sendResponse({ success: false, error: chrome.runtime.lastError.message });
          } else {
            console.log('[PoeExporter:BG] Download started, ID:', downloadId, 'File:', filename);
            sendResponse({ success: true, downloadId });
          }
        });
        
      } catch (err) {
        console.error('[PoeExporter:BG] download_file error:', err);
        sendResponse({ success: false, error: err.message });
      }
    })();
    
    return true;
  }
});
