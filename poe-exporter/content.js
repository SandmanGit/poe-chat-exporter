/**
 * content.js — Content Script
 * Poe Chat Exporter
 *
 * Multi-strategy extractor that works even when class names are obfuscated.
 */

console.log('[PoeExporter] Content script loaded on:', window.location.href);

let trustedScrollDeltaY = null;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function tryQuery(root, selectorList, all = false) {
  for (const s of selectorList) {
    try {
      if (all) {
        const els = root.querySelectorAll(s);
        if (els.length) return Array.from(els);
      } else {
        const el = root.querySelector(s);
        if (el) return el;
      }
    } catch (_) {}
  }
  return all ? [] : null;
}

function domOrder(a, b) {
  return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
}

function normalizeMessageText(value) {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function createMessageKey(message) {
  const role = message.role || '';
  const botName = message.botName || '';
  const date = message.date || '';
  const timestamp = message.timestamp || '';
  const text = normalizeMessageText(message.contentText || message.contentHtml || '');
  return [role, botName, date, timestamp, text.length, text].join('|');
}

function waitForMessagesReady(timeoutMs = 15000, intervalMs = 500) {
  const startedAt = Date.now();

  return new Promise((resolve) => {
    const check = () => {
      const messages = extractMessages();
      if (messages.length > 0) {
        resolve({ ready: true, messageCount: messages.length });
        return;
      }

      if (Date.now() - startedAt >= timeoutMs) {
        resolve({ ready: false, messageCount: 0 });
        return;
      }

      setTimeout(check, intervalMs);
    };

    check();
  });
}

function buildConversationData(messages) {
  const title = extractTitle();
  const bots = [...new Set(messages.filter(m => m.role === 'assistant').map(m => m.botName))];

  return {
    id:           window.location.pathname.replace('/chat/', ''),
    title,
    botName:      bots[0] || 'Unknown',
    messageCount: messages.length,
    messages,
    url:          window.location.href,
  };
}

function getVisibleMessageElements() {
  return Array.from(document.querySelectorAll([
    '[class*="ChatMessage"]',
    '[class*="Message_row"]',
    '[class*="messageBubbleWrapper"]',
    '[class*="Markdown_markdown" i]',
    '[class*="Markdown_markdownContainer" i]',
    '[class*="Prose_prose" i]',
    '[class*="humanMessage"]',
    '[class*="botMessage"]',
  ].join(',')))
    .filter(el => {
      const text = el.innerText ? el.innerText.trim() : '';
      const rect = el.getBoundingClientRect();
      return text.length > 0 && rect.width > 0 && rect.height > 0;
    })
    .sort(domOrder);
}

function isScrollableElement(el) {
  if (!el || el === document.body || el === document.documentElement) return false;
  return el.scrollHeight > el.clientHeight + 8;
}

function describeScrollTarget(target) {
  if (target === document.scrollingElement || target === document.documentElement) {
    return `document scrollY=${Math.round(window.scrollY)} height=${document.documentElement.scrollHeight}`;
  }

  const className = typeof target.className === 'string' ? target.className : '';
  const id = target.id ? `#${target.id}` : '';
  const cls = className ? `.${className.trim().split(/\s+/).slice(0, 3).join('.')}` : '';
  return `${target.tagName.toLowerCase()}${id}${cls} top=${Math.round(target.scrollTop)} h=${target.clientHeight}/${target.scrollHeight}`;
}

function canMoveScrollTarget(target) {
  if (!target) return false;

  if (target === document.scrollingElement || target === document.documentElement) {
    const originalY = window.scrollY;
    window.scrollBy(0, originalY > 0 ? -24 : 24);
    const moved = window.scrollY !== originalY;
    window.scrollTo(0, originalY);
    return moved || document.documentElement.scrollHeight > window.innerHeight + 8;
  }

  const originalTop = target.scrollTop;
  const testDelta = originalTop > 0 ? -24 : 24;
  target.scrollTop = originalTop + testDelta;
  const moved = target.scrollTop !== originalTop;
  target.scrollTop = originalTop;
  return moved;
}

function containsVisibleMessage(target) {
  return getVisibleMessageElements().some(messageEl => target.contains && target.contains(messageEl));
}

function findScrollTargets() {
  const targets = [];
  const addTarget = (target) => {
    if (target && !targets.includes(target)) targets.push(target);
  };

  for (const messageEl of getVisibleMessageElements().slice(0, 4)) {
    let parent = messageEl.parentElement;
    while (parent && parent !== document.body) {
      if (isScrollableElement(parent)) addTarget(parent);
      parent = parent.parentElement;
    }
  }

  const mainEl = document.querySelector('main');
  if (mainEl) {
    for (const el of mainEl.querySelectorAll('div, section, article')) {
      if (isScrollableElement(el)) addTarget(el);
    }
  }

  for (const el of document.querySelectorAll('div, section, article, main')) {
    if (isScrollableElement(el)) addTarget(el);
  }

  addTarget(document.scrollingElement || document.documentElement);
  return targets;
}

function probeScrollableTargets(targets) {
  const movingTargets = targets.filter(canMoveScrollTarget);
  const messageTargets = movingTargets.filter(containsVisibleMessage);
  const chosenTargets = messageTargets.length > 0 ? messageTargets : movingTargets;

  console.log(
    '[PoeExporter] Scroll targets:',
    chosenTargets.length > 0
      ? chosenTargets.map(describeScrollTarget).join(' | ')
      : 'none movable'
  );

  return chosenTargets;
}

function findHistoryEventTargets() {
  const targets = [];
  const addTarget = (target) => {
    if (target && !targets.includes(target)) targets.push(target);
  };

  const firstMessage = getVisibleMessageElements()[0];
  if (firstMessage) {
    let current = firstMessage;
    for (let i = 0; i < 8 && current; i++) {
      addTarget(current);
      current = current.parentElement;
    }
  }

  addTarget(document.querySelector('main'));
  addTarget(document.scrollingElement || document.documentElement);
  addTarget(document.body);
  addTarget(document);
  addTarget(window);

  console.log(
    '[PoeExporter] Wheel event targets:',
    targets.map(target => {
      if (target === window) return 'window';
      if (target === document) return 'document';
      return describeScrollTarget(target);
    }).join(' | ')
  );

  return targets;
}

function getScrollSignature(targets) {
  return targets.map(target => {
    if (target === document.scrollingElement || target === document.documentElement) {
      return `document:${window.scrollY}:${document.documentElement.scrollHeight}`;
    }
    return `${target.scrollTop}:${target.scrollHeight}:${target.clientHeight}`;
  }).join(';');
}

function getHistoryLoadState(targets) {
  const messages = extractMessages();
  const earliestKey = messages[0] ? createMessageKey(messages[0]) : '';
  const latestKey = messages[messages.length - 1] ? createMessageKey(messages[messages.length - 1]) : '';
  return {
    messageCount: messages.length,
    earliestKey,
    latestKey,
    signature: getScrollSignature(targets),
  };
}

function isHistoryLoadProgress(before, after) {
  return (
    after.messageCount > before.messageCount ||
    (before.earliestKey && after.earliestKey && before.earliestKey !== after.earliestKey) ||
    before.signature !== after.signature
  );
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function dispatchHistoryWheel(target) {
  const wheelEvent = new WheelEvent('wheel', {
    bubbles: true,
    cancelable: true,
    deltaY: -900,
    deltaX: 0,
    deltaMode: WheelEvent.DOM_DELTA_PIXEL,
    clientX: Math.round(window.innerWidth / 2),
    clientY: Math.max(80, Math.round(window.innerHeight * 0.25)),
  });
  target.dispatchEvent(wheelEvent);
}

function getTrustedScrollPoint(targets) {
  const target = targets.find(el => el && el !== window && el !== document) || getVisibleMessageElements()[0];
  if (!target || typeof target.getBoundingClientRect !== 'function') {
    return {
      x: Math.round(window.innerWidth / 2),
      y: Math.max(80, Math.round(window.innerHeight * 0.25)),
    };
  }

  const rect = target.getBoundingClientRect();
  const x = Math.round(Math.min(Math.max(rect.left + rect.width / 2, 8), window.innerWidth - 8));
  const y = Math.round(Math.min(Math.max(rect.top + Math.min(rect.height * 0.25, 180), 8), window.innerHeight - 8));
  return { x, y };
}

function requestTrustedHistoryScroll(targets, deltaY) {
  const point = getTrustedScrollPoint(targets);
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({
      action: 'trusted_scroll',
      x: point.x,
      y: point.y,
      deltaY,
    }, (response) => {
      if (chrome.runtime.lastError || !response || !response.success) {
        const errorMessage = chrome.runtime.lastError ? chrome.runtime.lastError.message : response?.error;
        console.warn('[PoeExporter] trusted_scroll fallback:', errorMessage || 'unknown error');
        resolve(false);
        return;
      }
      resolve(true);
    });
  });
}

function endTrustedHistoryScroll() {
  chrome.runtime.sendMessage({ action: 'trusted_scroll_end' }, () => {});
}

async function detectTrustedScrollDeltaY(targets) {
  if (trustedScrollDeltaY !== null) return trustedScrollDeltaY;

  const primaryTarget = targets.find(target => target && target !== window && target !== document);
  const primaryScrollTop = primaryTarget && typeof primaryTarget.scrollTop === 'number' ? primaryTarget.scrollTop : 0;
  const candidates = primaryScrollTop < 0 ? [900, -900] : [-900, 900];

  for (const deltaY of candidates) {
    const before = getHistoryLoadState(targets);
    const sent = await requestTrustedHistoryScroll(targets, deltaY);
    if (!sent) continue;

    await delay(1200);
    const after = getHistoryLoadState(probeScrollableTargets(findScrollTargets()));
    console.log(
      `[PoeExporter] Trusted wheel probe deltaY=${deltaY}: messages ${before.messageCount}->${after.messageCount}, signatureChanged=${before.signature !== after.signature}`
    );

    if (isHistoryLoadProgress(before, after)) {
      trustedScrollDeltaY = deltaY;
      console.log('[PoeExporter] Trusted wheel direction selected:', trustedScrollDeltaY);
      return trustedScrollDeltaY;
    }
  }

  trustedScrollDeltaY = candidates[0];
  console.warn('[PoeExporter] Trusted wheel direction probe inconclusive, using:', trustedScrollDeltaY);
  return trustedScrollDeltaY;
}

async function triggerHistoryLoad(targets) {
  const eventTargets = targets.length > 0 ? targets : findHistoryEventTargets();
  const deltaY = await detectTrustedScrollDeltaY(eventTargets);
  const trusted = await requestTrustedHistoryScroll(eventTargets, deltaY);
  console.log('[PoeExporter] Trusted wheel event:', trusted ? 'sent' : 'fallback only');
  if (trusted) return;

  for (const target of targets) {
    const eventTarget = target === document.scrollingElement ? window : target;
    if (target === document.scrollingElement || target === document.documentElement) {
      window.scrollBy(0, -Math.max(window.innerHeight * 0.85, 500));
      window.scrollTo(0, 0);
    } else {
      const step = Math.max(target.clientHeight * 0.85, 500);
      target.scrollTop = Math.max(0, target.scrollTop - step);
      if (target.scrollTop <= 5) target.scrollTop = 0;
    }
    dispatchHistoryWheel(eventTarget);
  }

  if (targets.length === 0) {
    for (const target of eventTargets) {
      dispatchHistoryWheel(target);
    }
  }
}

// ─── Title ──────────────────────────────────────────────────────────────────

function extractTitle() {
  const h1 = document.querySelector('h1');
  if (h1 && h1.innerText.trim()) return h1.innerText.trim();
  return document.title.replace(/ - Poe$/i, '').trim() || 'Poe Chat';
}

// ─── Message Extraction ───────────────────────────────────────────────────────

function extractMessages() {
  const messages = [];

  // ── Strategy 1: Poe CSS Module class-name substring matching ──────────────
  const humanBubbles = tryQuery(document, [
    // 1. 最新版结构优先
    '[class*="ChatMessage_rightSide"]', 
    // 2. 老版本结构降级
    '[class*="humanMessageBubble"]',
    '[class*="HumanMessage"]:not([class*="Header"])',
    '[class*="human_message_bubble"]',
  ], true);

  const botBubbles = tryQuery(document, [
    // 1. 最新版结构优先
    '[class*="ChatMessage_messageWrapper"]:not([class*="rightSide"])',
    '[class*="ChatMessage_wrapper"]:not([class*="rightSide"])',
    // 2. 老版本结构降级
    '[class*="botMessageBubble"]',
    '[class*="BotMessage"]:not([class*="Header"])',
    '[class*="bot_message_bubble"]',
  ], true);

  console.log(`[PoeExporter] Strategy 1 — humanBubbles: ${humanBubbles.length}, botBubbles: ${botBubbles.length}`);

  // ── Strategy 2: Positional/structural heuristics ───────────────────────────
  // Poe renders messages inside a scrollable 'main' area.
  // Human messages are right-aligned; bot messages are left-aligned.
  // We can detect this via computed style justifyContent / flexDirection on row containers.
  if (humanBubbles.length === 0 && botBubbles.length === 0) {
    console.log('[PoeExporter] Strategy 1 failed. Trying Strategy 2: positional heuristics...');

    // Find all paragraph/text containers that are inside 'main'
    const mainEl = document.querySelector('main') || document.body;

    // Look for message row wrappers — Poe wraps each turn in a row div
    // We look for divs/sections that contain blocks of text and are siblings of each other
    const rowCandidates = Array.from(mainEl.querySelectorAll('div, section, article'))
      .filter(el => {
        // Must have some text content
        const text = el.innerText ? el.innerText.trim() : '';
        if (text.length < 5) return false;
        
        // Must not be a deeply nested inline element — look for mid-level containers
        const depth = el.querySelectorAll('div').length;
        if (depth > 30) return false; // Too complex (layout container)
        if (depth === 0) return false; // Too simple (leaf text)
        
        // Filter out nav, sidebar, header elements
        const tag = el.tagName.toLowerCase();
        if (['nav', 'header', 'footer', 'aside'].includes(tag)) return false;

        const cls = el.className.toLowerCase();
        if (cls.includes('sidebar') || cls.includes('history') || cls.includes('nav') || 
            cls.includes('header') || cls.includes('toolbar') || cls.includes('modal')) return false;
        
        return true;
      });

    // Among candidates, find those that look like message bubbles by alignment
    for (const el of rowCandidates) {
      const style = window.getComputedStyle(el);
      const parent = el.parentElement;
      const parentStyle = parent ? window.getComputedStyle(parent) : null;

      // Human messages: right-aligned, smaller, often have distinct background
      const bg = style.backgroundColor;
      // Poe's human message background is a blue/violet hue (rgb values roughly 80-130, 70-120, 200-255)
      const isBlueish = (() => {
        const m = bg.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
        if (!m) return false;
        const [, r, g, b] = m.map(Number);
        return b > 150 && b > r && b > g; // Blue dominant
      })();

      if (isBlueish) {
        humanBubbles.push(el);
      }
    }

    console.log(`[PoeExporter] Strategy 2 — humanBubbles: ${humanBubbles.length}`);
  }

  // ── Strategy 3: innerText scanning (last resort) ─────────────────────────
  // Walk the main area's DOM tree linearly, collect all text blocks,
  // and alternate user/bot based on their position relative to each other.
  if (humanBubbles.length === 0 && botBubbles.length === 0) {
    console.log('[PoeExporter] Strategy 3: full innerText scan...');

    const mainEl = document.querySelector('main') || document.body;

    // Grab all "leaf" paragraph-like elements in DOM order
    const textNodes = Array.from(mainEl.querySelectorAll('p, [class*="message" i], [class*="bubble" i], [class*="text" i]'))
      .filter(el => {
        const t = el.innerText ? el.innerText.trim() : '';
        return t.length > 10 && !el.querySelector('p'); // Leaf-ish paragraphs with actual content
      });

    console.log(`[PoeExporter] Strategy 3 found ${textNodes.length} text nodes`);

    // Group consecutive siblings into "turns"
    let prev = null;
    for (const node of textNodes) {
      if (!prev) {
        messages.push({
          index: messages.length + 1,
          role: 'assistant', // assume first is bot
          botName: 'Assistant',
          contentHtml: node.innerHTML,
          contentText: node.innerText.trim(),
          timestamp: '',
          date: '',
        });
      } else {
        messages.push({
          index: messages.length + 1,
          role: messages.length % 2 === 0 ? 'user' : 'assistant', // alternate
          botName: messages.length % 2 === 0 ? null : 'Assistant',
          contentHtml: node.innerHTML,
          contentText: node.innerText.trim(),
          timestamp: '',
          date: '',
        });
      }
      prev = node;
    }

    return messages;
  }

  // ── Build final messages from Strategy 1/2 results ──────────────────────
  const tagged = [
    ...humanBubbles.map(el => ({ el, role: 'user' })),
    ...botBubbles.map(el => ({ el, role: 'assistant' })),
  ].sort((a, b) => domOrder(a.el, b.el));

  // Collect date separators
  const dateSeps = tryQuery(document, [
    '[class*="DateSeparator" i]',
    '[class*="dateSeparator" i]',
  ], true).map(el => ({ el, role: '__date__', text: el.innerText.trim() }));

  const allItems = [...tagged, ...dateSeps].sort((a, b) => domOrder(a.el, b.el));

  let currentDate = '';
  let index = 1;

  for (const item of allItems) {
    if (item.role === '__date__') {
      currentDate = item.text;
      continue;
    }

    const { el, role } = item;

    const contentEl = tryQuery(el, [
      '[class*="Markdown_markdown" i]',
      '[class*="markup" i]',
      '[class*="messageContent" i]',
      '[class*="chatMessage" i]', // Updated Poe inner text layer
      '.break-words',
    ]) || el;

    const plainText = contentEl.innerText ? contentEl.innerText.trim() : '';
    if (!plainText) continue;

    let nameEl = null;
    let timeEl = null;
    let currentRow = el;
    for (let i = 0; i < 4 && currentRow; i++) {
       nameEl = nameEl || tryQuery(currentRow, ['[class*="BotMessageHeader" i]', '[class*="botHeader" i]']);
       timeEl = timeEl || tryQuery(currentRow, ['time', '[class*="Timestamp" i]']);
       if (nameEl && timeEl) break;
       currentRow = currentRow.parentElement;
    }

    messages.push({
      index: index++,
      role,
      botName: role === 'assistant' ? (nameEl ? nameEl.innerText.trim() : 'Assistant') : null,
      contentHtml: contentEl.innerHTML,
      contentText: plainText,
      timestamp: timeEl ? timeEl.innerText.trim() : '',
      date: currentDate,
    });
  }

  return messages;
}

// ─── Message Listener ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'extract') {
    try {
      const messages = extractMessages();

      console.log(`[PoeExporter] Returning ${messages.length} messages.`);

      sendResponse({
        success: true,
        data: buildConversationData(messages),
      });
    } catch (err) {
      console.error('[PoeExporter] extract error:', err);
      sendResponse({ success: false, error: err.message });
    }
    return true;
  }

  if (request.action === 'auto_export') {
    console.log('[PoeExporter] auto_export triggered, format:', request.format);

    // ── Step 2: Scroll-and-Collect loop ──
    // Poe virtualizes messages: off-screen messages are removed from DOM.
    // So we must collect messages at EACH scroll position into a dedup Map.
    const collectedMessages = new Map(); // key = contentText hash, value = message object
    let scrollTargets = probeScrollableTargets(findScrollTargets());
    let noChangeCount = 0;
    let lastSignature = getScrollSignature(scrollTargets);
    let lastEarliestKey = '';
    let lastCollectedSize = 0;
    let scrollAttempts = 0;
    const MAX_ATTEMPTS = 150; // Safety valve: ~2.5 minutes max

    const collectCurrentMessages = () => {
      const msgs = extractMessages();
      for (const msg of msgs) {
        const key = createMessageKey(msg);
        if (!collectedMessages.has(key)) {
          collectedMessages.set(key, msg);
        }
      }
      console.log(`[PoeExporter] Collected so far: ${collectedMessages.size} unique messages (this page: ${msgs.length})`);
    };

    const performScroll = () => {
      scrollAttempts++;
      if (scrollAttempts > MAX_ATTEMPTS) {
        console.log('[PoeExporter] Max scroll attempts reached, exporting what we have...');
        finalizeExport(request.format);
        return;
      }

      // Collect messages currently visible in DOM before scrolling up
      collectCurrentMessages();

      if (scrollTargets.length === 0) {
        scrollTargets = probeScrollableTargets(findScrollTargets());
      }

      triggerHistoryLoad(scrollTargets).then(() => {

        setTimeout(() => {
          scrollTargets = probeScrollableTargets(findScrollTargets());
          const currentSignature = getScrollSignature(scrollTargets);

          const visibleMessages = extractMessages();
          const earliestKey = visibleMessages[0] ? createMessageKey(visibleMessages[0]) : '';
          const collectedSizeBefore = collectedMessages.size;

          collectCurrentMessages();

          const changed =
            currentSignature !== lastSignature ||
            earliestKey !== lastEarliestKey ||
            collectedMessages.size !== lastCollectedSize ||
            collectedMessages.size !== collectedSizeBefore;

          if (!changed) {
            noChangeCount++;
          } else {
            noChangeCount = 0;
            lastSignature = currentSignature;
            lastEarliestKey = earliestKey;
            lastCollectedSize = collectedMessages.size;
          }

          // Several consecutive checks with no message, top-anchor, or scroll-state change means we likely hit the ceiling.
          if (noChangeCount >= 6) {
            console.log(`[PoeExporter] Reached top after ${scrollAttempts} attempts. Total unique: ${collectedMessages.size}`);
            finalizeExport(request.format);
          } else {
            performScroll();
          }
        }, 800);
      });
    };

    const finalizeExport = async () => {
      try {
        // One final collection at the top
        collectCurrentMessages();

        // Sort collected messages by their original index
        const allMessages = Array.from(collectedMessages.values());
        // Re-index them sequentially
        allMessages.forEach((msg, i) => { msg.index = i + 1; });

        const data = buildConversationData(allMessages);

        console.log(`[PoeExporter] Finalized scroll export: ${data.messageCount} messages pulled.`);
        endTrustedHistoryScroll();
        try { sendResponse({ success: true, data: data }); } catch(err){}
      } catch (e) {
        console.error("[PoeExporter] AutoExport Error:", e);
        endTrustedHistoryScroll();
        try { sendResponse({ success: false, error: e.message }); } catch(err){}
      }
    };

    performScroll();
    return true; // Keep message channel open for async
  }

  if (request.action === 'wait_for_messages') {
    waitForMessagesReady(request.timeoutMs, request.intervalMs)
      .then(result => sendResponse({ success: result.ready, ...result }))
      .catch(err => sendResponse({ success: false, error: err.message, ready: false, messageCount: 0 }));
    return true;
  }

  if (request.action === 'extract_links') {
    try {
      const seen  = new Set();
      const links = Array.from(document.querySelectorAll('a[href^="/chat/"]'))
        .filter(a => { if (seen.has(a.href)) return false; seen.add(a.href); return true; })
        .map(a => ({ href: a.href, title: a.innerText.trim() || 'Untitled Chat' }));

      console.log(`[PoeExporter] Found ${links.length} sidebar links.`);
      sendResponse({ success: true, links });
    } catch (err) {
      console.error('[PoeExporter] extract_links error:', err);
      sendResponse({ success: false, error: err.message });
    }
    return true;
  }

  // ── Trigger Download in Page Context ──
  // Bypasses Chrome Extension MV3 strict generic restrictions on DataURIs and Blob URIs
  if (request.action === 'trigger_download') {
    try {
      const { filename, content, mimeType } = request;
      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        console.log('[PoeExporter] trigger_download completed for:', filename);
      }, 5000);
      
      sendResponse({ success: true });
    } catch (err) {
      console.error('[PoeExporter] trigger_download error:', err);
      sendResponse({ success: false, error: err.message });
    }
    return true;
  }
});
