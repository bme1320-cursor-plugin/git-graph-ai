// Shared File History HTML Template Generator
// This module provides a unified HTML template for file history views in both web and VS Code environments.
// UI is in English, but AI analysis content can be in Chinese.

export interface FileHistoryTemplateOptions {
  fileName: string;
  filePath: string;
  stats: {
    totalCommits: number;
    totalAdditions: number;
    totalDeletions: number;
    totalAuthors: number;
  };
  commits: Array<{
    hash: string;
    message: string;
    author: string;
    authorDate: number; // unix timestamp
    additions?: number;
    deletions?: number;
    fileChangeType?: string;
  }>;
  aiAnalysis?: {
    summary: string;
    evolutionPattern: string;
    keyChanges: string[];
    recommendations: string[];
  };
  isWebView?: boolean; // true for VS Code webview, false for web
  nonce?: string; // for VS Code webview CSP
}

export function generateFileHistoryHTML(options: FileHistoryTemplateOptions): string {
  // Helper for HTML escaping
  function escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Inline style for both web and webview
  const style = `
    :root {
      --font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      --editor-font-family: "SF Mono", Monaco, "Cascadia Code", "Roboto Mono", Consolas, "Courier New", monospace;
      --background: #1e1e1e;
      --foreground: #d4d4d4;
      --border: #454545;
      --sidebar-bg: #2d2d30;
      --link: #3794ff;
      --desc: #999;
      --hover-bg: #2a2d2e;
      --active-bg: #264f78;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 20px;
      font-family: var(--font-family);
      background-color: var(--background);
      color: var(--foreground);
      line-height: 1.5;
    }
    .container {
      max-width: 1200px;
      margin: 0 auto;
    }
    .file-history-header {
      margin-bottom: 20px;
      border-bottom: 1px solid var(--border);
      padding-bottom: 15px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .file-history-title {
      display: flex;
      flex-direction: column;
    }
    .file-history-title h2 {
      font-size: 24px;
      font-weight: 600;
      margin: 0 0 8px 0;
    }
    .file-history-path {
      font-size: 14px;
      color: var(--desc);
      font-family: var(--editor-font-family);
      margin: 0;
    }
    .file-history-close {
      background: none;
      border: none;
      cursor: pointer;
      padding: 4px;
      border-radius: 4px;
      transition: background 0.2s;
    }
    .file-history-close:hover {
      background: var(--hover-bg);
    }
    .file-history-content {
      display: flex;
      gap: 25px;
      margin-top: 20px;
    }
    .file-history-main {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    .file-history-stats {
      padding: 16px 20px;
      border-bottom: 1px solid var(--border);
    }
    .file-history-stats h3 {
      margin: 0 0 12px 0;
      font-size: 14px;
      font-weight: 600;
      color: var(--foreground);
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 12px;
    }
    .stat-item {
      text-align: center;
      padding: 8px;
      background-color: var(--background);
      border-radius: 6px;
      border: 1px solid var(--border);
    }
    .stat-value {
      display: block;
      font-size: 18px;
      font-weight: 600;
      color: var(--link);
      margin-bottom: 2px;
    }
    .stat-label {
      font-size: 11px;
      color: var(--desc);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .file-history-commits {
      flex: 1;
      overflow-y: auto;
      padding: 8px 0;
    }
    .file-history-commit {
      padding: 12px 20px;
      border-bottom: 1px solid var(--border);
      cursor: pointer;
      transition: background-color 0.2s;
    }
    .file-history-commit:hover {
      background-color: var(--hover-bg);
    }
    .file-history-commit.selected {
      background-color: var(--active-bg);
      color: #fff;
    }
    .commit-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 8px;
    }
    .commit-info {
      flex: 1;
      min-width: 0;
    }
    .commit-hash {
      font-family: var(--editor-font-family);
      font-size: 11px;
      color: var(--link);
      margin-bottom: 4px;
    }
    .commit-message {
      font-size: 14px;
      font-weight: 500;
      margin-bottom: 6px;
      line-height: 1.3;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .commit-author {
      font-size: 12px;
      color: var(--desc);
    }
    .commit-date {
      font-size: 12px;
      color: var(--desc);
      margin-left: 12px;
      white-space: nowrap;
    }
    .commit-changes {
      font-size: 12px;
      color: var(--desc);
      margin-top: 4px;
    }
    .additions { color: #4caf50; margin-right: 6px; }
    .deletions { color: #e53935; }
    .file-history-sidebar {
      width: 350px;
      border-left: 1px solid var(--border);
      background-color: var(--sidebar-bg);
      overflow-y: auto;
      border-radius: 6px;
      min-width: 220px;
      max-width: 400px;
    }
    .file-history-ai-analysis {
      padding: 20px;
    }
    .ai-analysis-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 16px;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--border);
    }
    .ai-analysis-icon {
      width: 16px;
      height: 16px;
      fill: var(--link);
    }
    .ai-analysis-section {
      margin-bottom: 16px;
    }
    .ai-analysis-section h4 {
      margin: 0 0 8px 0;
      font-size: 12px;
      font-weight: 600;
    }
    .ai-analysis-content {
      font-size: 12px;
      line-height: 1.4;
      background-color: var(--background);
      padding: 10px;
      border-radius: 4px;
      border: 1px solid var(--border);
    }
    .ai-analysis-list {
      margin: 0;
      padding-left: 16px;
      font-size: 12px;
      line-height: 1.4;
    }
    .ai-analysis-list li {
      margin-bottom: 4px;
    }
    .ai-analysis-loading {
      text-align: center;
      color: var(--desc);
      font-style: italic;
      padding: 30px 16px;
      font-size: 13px;
    }
    .empty {
      text-align: center;
      color: var(--desc);
      padding: 30px 16px;
      font-size: 13px;
    }
    @media (max-width: 900px) {
      .file-history-content { flex-direction: column; }
      .file-history-sidebar { width: 100%; max-width: none; border-left: none; border-top: 1px solid var(--border); }
    }
  `;

  // AI analysis panel (content in Chinese)
  const aiPanel = options.aiAnalysis
    ? `
      <div class="ai-analysis-header">
        <svg class="ai-analysis-icon" viewBox="0 0 16 16">
          <path d="M8 0C3.58 0 0 3.58 0 8c0 4.42 3.58 8 8 8 4.42 0 8-3.58 8-8 0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-3.31 2.69-6 6-6 3.31 0 6 2.69 6 6 0 3.31-2.69 6-6 6z"/>
          <path d="M8 4c-.55 0-1 .45-1 1v2c0 .55.45 1 1 1s1-.45 1-1V5c0-.55-.45-1-1-1zm0 6c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1z"/>
        </svg>
        <h3>AI 分析</h3>
      </div>
      <div class="ai-analysis-section">
        <h4>📋 演进总结</h4>
        <div class="ai-analysis-content">${escapeHtml(options.aiAnalysis.summary)}</div>
      </div>
      <div class="ai-analysis-section">
        <h4>📈 演进模式</h4>
        <div class="ai-analysis-content">${escapeHtml(options.aiAnalysis.evolutionPattern)}</div>
      </div>
      <div class="ai-analysis-section">
        <h4>🔑 关键变更</h4>
        <ul class="ai-analysis-list">
          ${options.aiAnalysis.keyChanges.map(change => `<li>${escapeHtml(change)}</li>`).join('')}
        </ul>
      </div>
      <div class="ai-analysis-section">
        <h4>💡 优化建议</h4>
        <ul class="ai-analysis-list">
          ${options.aiAnalysis.recommendations.map(rec => `<li>${escapeHtml(rec)}</li>`).join('')}
        </ul>
      </div>
    `
    : '<div class="ai-analysis-loading">AI analysis loading...</div>';

  // Commits list
  const commitsHTML = options.commits.length > 0
    ? options.commits.map((commit, index) => {
        const date = new Date(commit.authorDate * 1000);
        const dateStr = date.toLocaleDateString('en-US') + ' ' + date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        const shortHash = commit.hash.substring(0, 8);
        const message = commit.message.split('\n')[0];
        return `
          <div class="file-history-commit" data-index="${index}">
            <div class="commit-header">
              <div class="commit-info">
                <div class="commit-hash">${shortHash}</div>
                <div class="commit-message" title="${escapeHtml(commit.message)}">${escapeHtml(message)}</div>
                <div class="commit-author"><span>${escapeHtml(commit.author)}</span></div>
              </div>
              <div class="commit-date">${dateStr}</div>
            </div>
            <div class="commit-changes">
              <span class="additions">${commit.additions !== undefined ? `+${commit.additions}` : ''}</span>
              <span class="deletions">${commit.deletions !== undefined ? `-${commit.deletions}` : ''}</span>
            </div>
          </div>
        `;
      }).join('')
    : '<div class="ai-analysis-loading">No commits found for this file.</div>';

  // Main HTML structure
  const html = [
    options.isWebView ? '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">' : '',
    options.isWebView && options.nonce ? `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${options.nonce}'; img-src data:;">` : '',
    options.isWebView ? '<meta name="viewport" content="width=device-width, initial-scale=1.0">' : '',
    options.isWebView ? `<title>File History - ${escapeHtml(options.fileName)}</title>` : '',
    options.isWebView ? `<style>${style}</style></head><body>` : '',
    '<div class="container">',
    '  <div class="file-history-header">',
    '    <div class="file-history-title">',
    '      <h2>📁 File History</h2>',
    `      <div class="file-history-path" title="${escapeHtml(options.filePath)}">${escapeHtml(options.fileName)}</div>`,
    '    </div>',
    '    <button class="file-history-close" title="Close">',
    '      <svg viewBox="0 0 16 16"><path d="M8 8.707l3.646 3.647.708-.707L8.707 8l3.647-3.646-.707-.708L8 7.293 4.354 3.646l-.707.708L7.293 8l-3.646 3.646.707.708L8 8.707z"/></svg>',
    '    </button>',
    '  </div>',
    '  <div class="file-history-content">',
    '    <div class="file-history-main">',
    '      <div class="file-history-stats">',
    '        <h3>📊 Statistics</h3>',
    '        <div class="stats-grid">',
    `          <div class="stat-item"><span class="stat-value">${options.stats.totalCommits}</span><span class="stat-label">Commits</span></div>`,
    `          <div class="stat-item"><span class="stat-value">${options.stats.totalAdditions}</span><span class="stat-label">Additions</span></div>`,
    `          <div class="stat-item"><span class="stat-value">${options.stats.totalDeletions}</span><span class="stat-label">Deletions</span></div>`,
    `          <div class="stat-item"><span class="stat-value">${options.stats.totalAuthors}</span><span class="stat-label">Contributors</span></div>`,
    '        </div>',
    '      </div>',
    `      <div class="file-history-commits">${commitsHTML}</div>`,
    '    </div>',
    '    <div class="file-history-sidebar">',
    `      <div id="ai-analysis-container" class="file-history-ai-analysis">${aiPanel}</div>`,
    '    </div>',
    '  </div>',
    '</div>',
    // Add JavaScript for webview message handling
    options.isWebView && options.nonce ? `
      <script nonce="${options.nonce}">
        (function() {
          // Escape HTML helper function
          function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
          }

          // Handle messages from the extension
          window.addEventListener('message', function(event) {
            const message = event.data;
            
            if (message.command === 'updateAIAnalysis' && message.analysis) {
              console.log('[File History] Received AI analysis update:', message.analysis);
              updateAIAnalysis(message.analysis);
            }
          });

          // Function to update AI analysis content
          function updateAIAnalysis(analysis) {
            const container = document.getElementById('ai-analysis-container');
            if (!container) {
              console.error('[File History] AI analysis container not found');
              return;
            }

            // Generate new AI analysis HTML
            const aiHTML = \`
              <div class="ai-analysis-header">
                <svg class="ai-analysis-icon" viewBox="0 0 16 16">
                  <path d="M8 0C3.58 0 0 3.58 0 8c0 4.42 3.58 8 8 8 4.42 0 8-3.58 8-8 0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-3.31 2.69-6 6-6 3.31 0 6 2.69 6 6 0 3.31-2.69 6-6 6z"/>
                  <path d="M8 4c-.55 0-1 .45-1 1v2c0 .55.45 1 1 1s1-.45 1-1V5c0-.55-.45-1-1-1zm0 6c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1z"/>
                </svg>
                <h3>AI 分析</h3>
              </div>
              <div class="ai-analysis-section">
                <h4>📋 演进总结</h4>
                <div class="ai-analysis-content">\${escapeHtml(analysis.summary || '暂无总结')}</div>
              </div>
              <div class="ai-analysis-section">
                <h4>📈 演进模式</h4>
                <div class="ai-analysis-content">\${escapeHtml(analysis.evolutionPattern || '暂无演进模式')}</div>
              </div>
              <div class="ai-analysis-section">
                <h4>🔑 关键变更</h4>
                <ul class="ai-analysis-list">
                  \${(analysis.keyChanges || []).map(change => \`<li>\${escapeHtml(change)}</li>\`).join('')}
                </ul>
              </div>
              <div class="ai-analysis-section">
                <h4>💡 优化建议</h4>
                <ul class="ai-analysis-list">
                  \${(analysis.recommendations || []).map(rec => \`<li>\${escapeHtml(rec)}</li>\`).join('')}
                </ul>
              </div>
            \`;

            container.innerHTML = aiHTML;
            console.log('[File History] Successfully updated AI analysis');
          }

          // VS Code API for webview communication
          const vscode = acquireVsCodeApi();
          console.log('[File History] File history webview initialized');
        })();
      </script>
    ` : '',
    options.isWebView ? '</body></html>' : ''
  ].join('\n');

  return html;
} 