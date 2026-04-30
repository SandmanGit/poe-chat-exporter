/**
 * popup.js
 * Controls the UI and interacts with the content script and background worker.
 */

let currentContext = null;

document.addEventListener('DOMContentLoaded', async () => {
  // UI Elements
  const statusEl = document.getElementById('status-container');
  const actionEl = document.getElementById('action-container');
  const errorEl = document.getElementById('error-container');
  
  const titleEl = document.getElementById('chat-title');
  const botEl = document.getElementById('bot-name');
  const countEl = document.getElementById('message-count');
  const statusText = document.getElementById('status-text');

  const btnJson = document.getElementById('btn-export-json');
  const btnMd = document.getElementById('btn-export-md');
  const btnRetry = document.getElementById('btn-retry');

  function showUI(state, errMsg = '') {
    statusEl.classList.add('hidden');
    actionEl.classList.add('hidden');
    errorEl.classList.add('hidden');

    if (state === 'loading') statusEl.classList.remove('hidden');
    else if (state === 'action') actionEl.classList.remove('hidden');
    else if (state === 'error') {
      errorEl.classList.remove('hidden');
      document.getElementById('error-text').innerText = errMsg;
    }
  }

  // 1. Check current tab
  async function init() {
    showUI('loading');
    statusText.innerText = '正在检测页面...';

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      if (!tab.url.startsWith('https://poe.com/chat/')) {
        showUI('error', '请在 Poe 的具体对话页面使用此扩展。');
        return;
      }

      // Inject / Extract — wait 500ms for SPA to settle
      statusText.innerText = '正在提取对话...';
      
      setTimeout(() => {
        chrome.tabs.sendMessage(tab.id, { action: 'extract' }, (response) => {
          if (chrome.runtime.lastError) {
            showUI('error', '无法连接到页面 (content script 未就绪)。请刷新 Poe 页面再重试。\n错误: ' + chrome.runtime.lastError.message);
            return;
          }

          if (!response || !response.success) {
            showUI('error', '提取失败: ' + (response?.error || '未知错误'));
            return;
          }

          const data = response.data;
          if (!data || data.messages.length === 0) {
            // Not a hard error — page may still be loading
            showUI('error', '未找到消息。请确保：\n1. 你在 poe.com/chat/xxx 页面\n2. 消息内容已加载完毕\n\n打开 [控制台 > Console] 查看 [PoeExporter] 日志可协助排查。');
            return;
          }

          // Setup UI
          currentContext = data;
          titleEl.innerText = data.title || 'Poe Chat';
          botEl.innerText = data.botName || 'AI';
          countEl.innerText = data.messageCount;
          
          // Update badge
          chrome.runtime.sendMessage({ action: 'setBadge', tabId: tab.id, count: data.messageCount });

          showUI('action');
        });
      }, 500);
    } catch (err) {
      showUI('error', err.message);
    }
  }

  // Setup listeners
  btnRetry.addEventListener('click', init);

  async function requestAutoExport(format) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tab.id, { action: 'auto_export', format }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!response || !response.success || !response.data) {
          reject(new Error(response?.error || '自动滚动导出失败'));
          return;
        }
        resolve(response.data);
      });
    });
  }

  function buildFilename(context, extension) {
    const safeTitle = context.title.replace(/[\\/:*?"<>|\s]/g, '-');
    const safeBot = (context.botName || 'AI').replace(/[\\/:*?"<>|\s]/g, '-');
    return `poe-${safeTitle}-${safeBot}.${extension}`;
  }

  async function exportCurrent(format) {
    if (!currentContext) return;

    const button = format === 'json' ? btnJson : btnMd;
    const originalLabel = button.innerHTML;
    try {
      button.disabled = true;
      button.innerHTML = '正在自动加载并导出...';
      const fullContext = await requestAutoExport(format);
      currentContext = fullContext;
      countEl.innerText = fullContext.messageCount;

      if (format === 'json') {
        const jsonStr = window.PoeFormatter.toJsonString(fullContext);
        await window.PoeDownloader.downloadBlob(jsonStr, buildFilename(fullContext, 'json'), 'application/json');
      } else {
        const mdStr = window.PoeFormatter.toMarkdown(fullContext);
        await window.PoeDownloader.downloadBlob(mdStr, buildFilename(fullContext, 'md'), 'text/markdown');
      }

      button.innerHTML = '✅ 下载成功 (请查看下载页)';
    } catch (e) {
      button.innerHTML = originalLabel;
      showUI('error', `导出 ${format.toUpperCase()} 失败: ${e.message}`);
    } finally {
      button.disabled = false;
    }
  }

  btnJson.addEventListener('click', () => exportCurrent('json'));
  btnMd.addEventListener('click', () => exportCurrent('md'));

  // Batch Export Logic
  const btnBatch = document.getElementById('btn-batch-export');
  const progressEl = document.getElementById('batch-progress');
  const progressFill = document.getElementById('progress-fill');
  const progressText = document.getElementById('progress-text');

  chrome.runtime.onMessage.addListener((request) => {
    if (request.action === 'batch_progress') {
       progressEl.classList.remove('hidden');
       btnBatch.disabled = true;
       btnBatch.innerHTML = '<span class="icon">⏳</span> 正在跑批提取...';
       
       const percent = (request.current / request.total) * 100;
       progressFill.style.width = `${percent}%`;
       progressText.innerText = `进度: ${request.current} / ${request.total}`;
    }
  });

  btnBatch.addEventListener('click', async () => {
    try {
      btnBatch.disabled = true;
      progressEl.classList.remove('hidden');
      progressText.innerText = '正在提取侧边栏...';

      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      chrome.tabs.sendMessage(tab.id, { action: 'extract_links' }, (res) => {
        if (chrome.runtime.lastError || !res || !res.success || !res.links || res.links.length === 0) {
          showUI('error', '未能找到侧边栏历史链接！或 content.js 无响应。');
          return;
        }
        
        progressText.innerText = `准备抓取 ${res.links.length} 个对话...`;
        
        chrome.runtime.sendMessage({ action: 'batch_extract', links: res.links }, async (bgRes) => {
           if (!bgRes || !bgRes.success || !bgRes.data) {
              showUI('error', '批量抓取遇到错误。');
              return;
           }
           
           try {
             // 过滤出有内容的会话
             const validSessions = bgRes.data.filter(s => s && s.messages && s.messages.length > 0);
             
             if (validSessions.length === 0) {
               showUI('error', '抓取完成，但所有会话都是空的。页面可能在后台未成功加载。');
               return;
             }

             const batchMd = window.PoeFormatter.toBatchMarkdown(validSessions);
             const jsonStr = JSON.stringify({ meta: { batch: true, time: new Date().toISOString() }, sessions: validSessions }, null, 2);
             
             // 阶段二：保存文件
             // 由于前面的抓取消耗了长时间，原有的 User Gesture 已过期。这里必须要求用户交互来激活真正的下载。
             progressText.innerText = `成功提取 ${validSessions.length} 个非空会话！请点击下方按钮保存。`;
             btnBatch.innerHTML = '<span class="icon">💾</span> 点击保存 Markdown 与 JSON';
             btnBatch.disabled = false;
             
             // 覆盖点击事件
             btnBatch.onclick = async () => {
                btnBatch.disabled = true;
                btnBatch.innerHTML = '正在写入磁盘...';
                try {
                  const stamp = new Date().getTime();
                  await window.PoeDownloader.downloadBlob(batchMd, `poe_batch_${stamp}.md`, 'text/markdown');
                  await window.PoeDownloader.downloadBlob(jsonStr, `poe_batch_${stamp}.json`, 'application/json');
                  btnBatch.innerHTML = '<span class="icon">✅</span> 下载完毕 (请查看下载页)';
                } catch(downloadErr) {
                  showUI('error', '打包下载时失败: ' + downloadErr.message);
                }
             };

           } catch (err) {
             showUI('error', '处理数据时失败: ' + err.message);
           }
        });
      });
    } catch (e) {
      showUI('error', '执行操作失败: ' + e.message);
    }
  });

  // Start
  init();
});
