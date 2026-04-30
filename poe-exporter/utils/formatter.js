/**
 * formatter.js
 * Utilities for formatting extracted message data into JSON or Markdown.
 */

window.PoeFormatter = {

  toJsonString(data) {
    const exportData = {
      exportMeta: {
        exportedAt: new Date().toISOString(),
        sourceUrl: data.url,
        platform: "Poe.com"
      },
      conversation: {
        id: data.id,
        title: data.title,
        botName: data.botName,
        messageCount: data.messageCount,
        messages: data.messages.map(m => ({
          index: m.index,
          role: m.role,
          botName: m.role === 'assistant' ? (m.botName || data.botName) : undefined,
          content: m.contentText,
          rawHtml: m.contentHtml,
          timestamp: m.timestamp,
          date: m.date
        }))
      }
    };
    return JSON.stringify(exportData, null, 2);
  },

  getTurndown() {
    if (!this.tdService) {
      this.tdService = new window.TurndownService({
        headingStyle: 'atx',
        codeBlockStyle: 'fenced',
        emDelimiter: '*'
      });
      if (window.turndownPluginGfm) {
         this.tdService.use(window.turndownPluginGfm.gfm);
      }
      
      this.tdService.remove('button'); 

      this.tdService.addRule('poeCodeBlocks', {
        filter: 'pre',
        replacement: function (content, node) {
          const codeEl = node.querySelector('code');
          if (!codeEl) return `\n\n\`\`\`\n${node.textContent || ''}\n\`\`\`\n\n`;
          
          let lang = '';
          const headerBox = Array.from(node.children).find(c => c !== codeEl && c.tagName !== 'CODE');
          if (headerBox) {
             lang = headerBox.textContent.replace(/Copy|复制/gi, '').trim().split(/\s+/)[0] || '';
          } else if (codeEl.className) {
             const match = codeEl.className.match(/language-(\w+)/);
             if (match) lang = match[1];
          }
          const rawCode = codeEl.textContent || '';
          return `\n\n\`\`\`${lang}\n${rawCode}\n\`\`\`\n\n`;
        }
      });

      this.tdService.addRule('demoteHeadings', {
        filter: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
        replacement: function (content, node) {
          const hLevel = Number(node.tagName.charAt(1));
          const adjustedLevel = Math.min(6, hLevel + 1); // shrink headings mathematically
          return '\n\n' + '#'.repeat(adjustedLevel) + ' ' + content + '\n\n';
        }
      });
    }
    return this.tdService;
  },

  toMarkdown(data) {
    let md = `# ${data.title}\n\n`;
    md += `**平台：** Poe.com\n`;
    md += `**AI 助手：** ${data.botName}\n`;
    md += `**对话链接：** ${data.url}\n`;
    md += `**导出时间：** ${new Date().toLocaleString()}\n\n`;
    md += `---\n\n`;

    let lastDate = '';
    const td = this.getTurndown();
    let qCount = 0;
    let aCount = 0;

    data.messages.forEach(msg => {
      if (msg.date && msg.date !== lastDate) {
        md += `### 📅 ${msg.date}\n\n`;
        lastDate = msg.date;
      }
      
      const author = msg.role === 'user' ? '用户' : (msg.botName || data.botName);
      
      if (msg.role === 'user') {
         qCount++;
         const rawStr = (msg.contentHtml || '').replace(/<[^>]+>/g, '').trim();
         const preview = rawStr.length > 15 ? rawStr.substring(0, 15).replace(/\n/g, ' ') + '...' : rawStr.replace(/\n/g, ' ');
         md += `## 💬 Q${qCount}: ${preview}\n\n`;
         
         md += `**👤 用户**`;
         if (msg.timestamp) md += ` · *${msg.timestamp}*`;
         md += `\n\n`;
      } else {
         aCount++;
         md += `## 🤖 A${aCount}: ${author}`;
         if (msg.timestamp) md += ` · *${msg.timestamp}*`;
         md += `\n\n`;
      }

      let content = td.turndown(msg.contentHtml || '');
      md += content.trim() + `\n\n---\n\n`;
    });

    return md;
  },

  toBatchMarkdown(dataArray) {
    let md = `# 批量导出对话记录 (${dataArray.length}篇)\n\n`;
    md += `**导出时间：** ${new Date().toLocaleString()}\n\n---\n\n`;

    const td = this.getTurndown();

    dataArray.forEach((data, index) => {
      md += `## [${index + 1}/${dataArray.length}] ${data.title}\n`;
      md += `**AI 助手：** ${data.botName} | **链接：** ${data.url}\n\n`;
      
      let lastDate = '';
      let qCount = 0;
      let aCount = 0;

      data.messages.forEach(msg => {
        if (msg.date && msg.date !== lastDate) {
          md += `#### 📅 ${msg.date}\n\n`;
          lastDate = msg.date;
        }

        const author = msg.role === 'user' ? '用户' : (msg.botName || data.botName);
        
        if (msg.role === 'user') {
           qCount++;
           const rawStr = (msg.contentHtml || '').replace(/<[^>]+>/g, '').trim();
           const preview = rawStr.length > 15 ? rawStr.substring(0, 15).replace(/\n/g, ' ') + '...' : rawStr.replace(/\n/g, ' ');
           md += `### 💬 Q${qCount}: ${preview}\n\n`;

           md += `**👤 用户**`;
           if (msg.timestamp) md += ` · *${msg.timestamp}*`;
           md += `\n\n`;
        } else {
           aCount++;
           md += `### 🤖 A${aCount}: ${author}`;
           if (msg.timestamp) md += ` · *${msg.timestamp}*`;
           md += `\n\n`;
        }

        let content = td.turndown(msg.contentHtml || '');
        md += content.trim() + `\n\n`;
      });
      md += `---\n\n`;
    });

    return md;
  }
};
