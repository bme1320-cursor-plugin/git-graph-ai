// Shared File History HTML Template Generator
// This module provides a unified HTML template for file history views in both web and VS Code environments.
// UI is in English, but AI analysis content can be in Chinese.

export interface FileHistoryTemplateOptions {
  fileName: string;
  filePath: string;
  repo?: string; // Repository name for sending messages back to extension
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
  // New interface for file version comparison analysis
  comparisonAnalysis?: {
    summary: string;
    changeType: string;
    impactAnalysis: string;
    keyModifications: string[];
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
      --compare-bg: #0e639c;
      --compare-hover: #1177bb;
      --success: #4caf50;
      --warning: #ff9800;
      --error: #f44336;
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
      position: relative;
    }
    .file-history-commit:hover {
      background-color: var(--hover-bg);
    }
    .file-history-commit.selected {
      background-color: var(--active-bg);
      color: #fff;
    }
    .file-history-commit.compare-from {
      background-color: var(--compare-bg);
      border-left: 4px solid var(--link);
    }
    .file-history-commit.compare-to {
      background-color: var(--success);
      border-left: 4px solid var(--success);
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
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .commit-compare-badge {
      padding: 2px 6px;
      font-size: 10px;
      border-radius: 4px;
      font-weight: 600;
      text-transform: uppercase;
    }
    .commit-compare-badge.from {
      background-color: var(--link);
      color: white;
    }
    .commit-compare-badge.to {
      background-color: var(--success);
      color: white;
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
    .sidebar-tabs {
      display: flex;
      border-bottom: 1px solid var(--border);
    }
    .sidebar-tab {
      flex: 1;
      padding: 12px 16px;
      background: none;
      border: none;
      color: var(--desc);
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      border-bottom: 2px solid transparent;
    }
    .sidebar-tab:hover {
      background-color: var(--hover-bg);
      color: var(--foreground);
    }
    .sidebar-tab.active {
      color: var(--link);
      border-bottom-color: var(--link);
      background-color: var(--background);
    }
    .sidebar-content {
      padding: 20px;
    }
    .compare-controls {
      margin-bottom: 20px;
      padding: 16px;
      background-color: var(--background);
      border-radius: 6px;
      border: 1px solid var(--border);
    }
    .compare-controls h4 {
      margin: 0 0 12px 0;
      font-size: 14px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .compare-icon {
      width: 16px;
      height: 16px;
      fill: var(--link);
    }
    .compare-info {
      margin-bottom: 12px;
      font-size: 12px;
      color: var(--desc);
      line-height: 1.4;
    }
    .compare-selection {
      margin-bottom: 8px;
      padding: 8px;
      background-color: var(--sidebar-bg);
      border-radius: 4px;
      border: 1px solid var(--border);
      font-size: 12px;
    }
    .compare-selection.empty {
      color: var(--desc);
      font-style: italic;
    }
    .compare-selection.selected {
      color: var(--foreground);
      font-family: var(--editor-font-family);
    }
    .compare-selection-label {
      display: block;
      font-weight: 600;
      margin-bottom: 4px;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .compare-buttons {
      display: flex;
      gap: 8px;
      margin-top: 12px;
    }
    .compare-btn {
      flex: 1;
      padding: 8px 12px;
      background: var(--link);
      color: white;
      border: none;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
    }
    .compare-btn:hover {
      background: var(--compare-hover);
    }
    .compare-btn:disabled {
      background: var(--desc);
      cursor: not-allowed;
    }
    .clear-btn {
      background: var(--border);
      color: var(--foreground);
    }
    .clear-btn:hover {
      background: var(--hover-bg);
    }
    .file-history-ai-analysis {
      padding: 0;
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

  // Version comparison AI analysis panel
  const comparisonAIPanel = `
    <div id="comparison-ai-analysis" class="ai-analysis-loading">
      Select two versions to compare and analyze differences...
    </div>
  `;

  // Commits list
  const commitsHTML = options.commits.length > 0
    ? options.commits.map((commit, index) => {
        const date = new Date(commit.authorDate * 1000);
        const dateStr = date.toLocaleDateString('en-US') + ' ' + date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        const shortHash = commit.hash.substring(0, 8);
        const message = commit.message.split('\n')[0];
        return `
          <div class="file-history-commit" data-index="${index}" data-hash="${commit.hash}">
            <div class="commit-header">
              <div class="commit-info">
                <div class="commit-hash">
                  ${shortHash}
                  <span class="commit-compare-badge from" style="display: none;">FROM</span>
                  <span class="commit-compare-badge to" style="display: none;">TO</span>
                </div>
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
    '      <div class="sidebar-tabs">',
    '        <button class="sidebar-tab active" data-tab="history">History Analysis</button>',
    '        <button class="sidebar-tab" data-tab="compare">Version Compare</button>',
    '      </div>',
    '      <div class="sidebar-content">',
    '        <div id="history-tab" class="tab-content active">',
    `          <div id="ai-analysis-container" class="file-history-ai-analysis">${aiPanel}</div>`,
    '        </div>',
    '        <div id="compare-tab" class="tab-content" style="display: none;">',
    '          <div class="compare-controls">',
    '            <h4>',
    '              <svg class="compare-icon" viewBox="0 0 16 16">',
    '                <path d="M8 0C3.58 0 0 3.58 0 8c0 4.42 3.58 8 8 8 4.42 0 8-3.58 8-8 0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-3.31 2.69-6 6-6 3.31 0 6 2.69 6 6 0 3.31-2.69 6-6 6z"/>',
    '                <path d="M4 8h8M8 4v8"/>',
    '              </svg>',
    '              Version Comparison',
    '            </h4>',
    '            <div class="compare-info">Click on commits to select FROM and TO versions for comparison.</div>',
    '            <div class="compare-selection empty" id="from-selection">',
    '              <span class="compare-selection-label">From (older):</span>',
    '              <span>No version selected</span>',
    '            </div>',
    '            <div class="compare-selection empty" id="to-selection">',
    '              <span class="compare-selection-label">To (newer):</span>',
    '              <span>No version selected</span>',
    '            </div>',
    '            <div class="compare-buttons">',
    '              <button class="compare-btn" id="compare-versions" disabled>Compare Versions</button>',
    '              <button class="compare-btn clear-btn" id="clear-selection">Clear</button>',
    '            </div>',
    '          </div>',
    `          <div id="comparison-analysis-container" class="file-history-ai-analysis">${comparisonAIPanel}</div>`,
    '        </div>',
    '      </div>',
    '    </div>',
    '  </div>',
    '</div>',
    // Add JavaScript for webview message handling and version comparison
    options.isWebView && options.nonce ? `
      <script nonce="${options.nonce}">
        (function() {
          // Version comparison state
          let compareFromHash = null;
          let compareToHash = null;
          let isCompareMode = false;

          // Escape HTML helper function
          function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
          }

          // Handle messages from the extension
          window.addEventListener('message', function(event) {
            const message = event.data;
            console.log('[File History] Received message:', message);
            
            if (message.command === 'updateAIAnalysis' && message.analysis) {
              console.log('[File History] Received AI analysis update:', message.analysis);
              updateAIAnalysis(message.analysis);
            } else if (message.command === 'updateFileVersionComparisonAIAnalysis' && message.analysis) {
              console.log('[File History] Received file version comparison AI analysis update:', message.analysis);
              updateComparisonAIAnalysis(message.analysis);
            } else if (message.command === 'fileHistoryComparison') {
              console.log('[File History] Received file comparison response:', message);
              handleComparisonResponse(message);
            }
          });

          // Handle comparison response
          function handleComparisonResponse(response) {
            if (response.error) {
              const container = document.getElementById('comparison-analysis-container');
              container.innerHTML = \`<div class="ai-analysis-loading">❌ Error: \${escapeHtml(response.error)}</div>\`;
              return;
            }

            // Check AI analysis status
            if (response.aiAnalysisStatus === 'completed' && response.aiAnalysis) {
              // AI analysis is immediately available
              updateComparisonAIAnalysis(response.aiAnalysis);
            } else if (response.aiAnalysisStatus === 'pending' || !response.aiAnalysis) {
              // AI analysis is in progress or not yet available
              const container = document.getElementById('comparison-analysis-container');
              container.innerHTML = \`
                <div class="ai-analysis-loading">
                  🔄 AI is analyzing the version differences...<br>
                  <small style="color: var(--desc); margin-top: 8px; display: block;">
                    This may take a few seconds. Results will appear automatically.
                  </small>
                </div>
              \`;
            } else if (response.aiAnalysisStatus === 'failed') {
              // AI analysis failed
              const container = document.getElementById('comparison-analysis-container');
              container.innerHTML = \`
                <div class="ai-analysis-loading">
                  ⚠️ AI analysis failed for this comparison.<br>
                  <small style="color: var(--desc); margin-top: 8px; display: block;">
                    Basic comparison data is available, but AI insights are not.
                  </small>
                </div>
              \`;
            } else {
              // Fallback for unknown status
              const container = document.getElementById('comparison-analysis-container');
              container.innerHTML = '<div class="ai-analysis-loading">⏳ Comparison completed. Processing AI analysis...</div>';
            }
          }

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

          // Function to update comparison AI analysis content
          function updateComparisonAIAnalysis(analysis) {
            const container = document.getElementById('comparison-analysis-container');
            if (!container) {
              console.error('[File History] Comparison analysis container not found');
              return;
            }

            // Generate new comparison AI analysis HTML
            const comparisonHTML = \`
              <div class="ai-analysis-header">
                <svg class="ai-analysis-icon" viewBox="0 0 16 16">
                  <path d="M8 0C3.58 0 0 3.58 0 8c0 4.42 3.58 8 8 8 4.42 0 8-3.58 8-8 0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-3.31 2.69-6 6-6 3.31 0 6 2.69 6 6 0 3.31-2.69 6-6 6z"/>
                  <path d="M4 8h8M8 4v8"/>
                </svg>
                <h3>版本比较分析</h3>
              </div>
              <div class="ai-analysis-section">
                <h4>📋 变更总结</h4>
                <div class="ai-analysis-content">\${escapeHtml(analysis.summary || '暂无总结')}</div>
              </div>
              <div class="ai-analysis-section">
                <h4>🔄 变更类型</h4>
                <div class="ai-analysis-content">\${escapeHtml(analysis.changeType || '暂无分类')}</div>
              </div>
              <div class="ai-analysis-section">
                <h4>💥 影响分析</h4>
                <div class="ai-analysis-content">\${escapeHtml(analysis.impactAnalysis || '暂无分析')}</div>
              </div>
              <div class="ai-analysis-section">
                <h4>🔑 核心修改</h4>
                <ul class="ai-analysis-list">
                  \${(analysis.keyModifications || []).map(mod => \`<li>\${escapeHtml(mod)}</li>\`).join('')}
                </ul>
              </div>
              <div class="ai-analysis-section">
                <h4>💡 建议</h4>
                <ul class="ai-analysis-list">
                  \${(analysis.recommendations || []).map(rec => \`<li>\${escapeHtml(rec)}</li>\`).join('')}
                </ul>
              </div>
            \`;

            container.innerHTML = comparisonHTML;
            console.log('[File History] Successfully updated comparison AI analysis');
          }

          // Tab switching functionality
          document.addEventListener('click', function(event) {
            if (event.target.classList.contains('sidebar-tab')) {
              const tabName = event.target.getAttribute('data-tab');
              switchTab(tabName);
            }
          });

          function switchTab(tabName) {
            // Update tab buttons
            document.querySelectorAll('.sidebar-tab').forEach(tab => {
              tab.classList.remove('active');
            });
            document.querySelector(\`[data-tab="\${tabName}"]\`).classList.add('active');

            // Update tab content
            document.querySelectorAll('.tab-content').forEach(content => {
              content.style.display = 'none';
              content.classList.remove('active');
            });
            const targetTab = document.getElementById(\`\${tabName}-tab\`);
            if (targetTab) {
              targetTab.style.display = 'block';
              targetTab.classList.add('active');
            }

            // Toggle compare mode
            isCompareMode = (tabName === 'compare');
            updateCommitSelectionMode();
          }

          function updateCommitSelectionMode() {
            const commits = document.querySelectorAll('.file-history-commit');
            commits.forEach(commit => {
              if (isCompareMode) {
                commit.style.cursor = 'pointer';
              } else {
                commit.classList.remove('compare-from', 'compare-to');
                // Hide badges
                const badges = commit.querySelectorAll('.commit-compare-badge');
                badges.forEach(badge => badge.style.display = 'none');
              }
            });

            if (!isCompareMode) {
              clearSelection();
            }
          }

          // Commit selection for comparison
          document.addEventListener('click', function(event) {
            const commitElement = event.target.closest('.file-history-commit');
            if (commitElement && isCompareMode) {
              const hash = commitElement.getAttribute('data-hash');
              selectCommitForComparison(commitElement, hash);
            }
          });

          function selectCommitForComparison(commitElement, hash) {
            if (!compareFromHash) {
              // Select as FROM version
              compareFromHash = hash;
              updateSelectionDisplay();
              highlightCommits();
            } else if (!compareToHash && hash !== compareFromHash) {
              // Select as TO version
              compareToHash = hash;
              updateSelectionDisplay();
              highlightCommits();
            } else if (hash === compareFromHash) {
              // Deselect FROM
              compareFromHash = compareToHash;
              compareToHash = null;
              updateSelectionDisplay();
              highlightCommits();
            } else if (hash === compareToHash) {
              // Deselect TO
              compareToHash = null;
              updateSelectionDisplay();
              highlightCommits();
            } else {
              // Replace TO with new selection
              compareToHash = hash;
              updateSelectionDisplay();
              highlightCommits();
            }
          }

          function updateSelectionDisplay() {
            const fromSelection = document.getElementById('from-selection');
            const toSelection = document.getElementById('to-selection');
            const compareBtn = document.getElementById('compare-versions');

            if (compareFromHash) {
              const fromCommit = document.querySelector(\`[data-hash="\${compareFromHash}"]\`);
              const fromHash = compareFromHash.substring(0, 8);
              const fromMessage = fromCommit ? fromCommit.querySelector('.commit-message').textContent : 'Unknown';
              fromSelection.innerHTML = \`
                <span class="compare-selection-label">From (older):</span>
                <span>\${fromHash} - \${fromMessage}</span>
              \`;
              fromSelection.classList.remove('empty');
              fromSelection.classList.add('selected');
            } else {
              fromSelection.innerHTML = \`
                <span class="compare-selection-label">From (older):</span>
                <span>No version selected</span>
              \`;
              fromSelection.classList.add('empty');
              fromSelection.classList.remove('selected');
            }

            if (compareToHash) {
              const toCommit = document.querySelector(\`[data-hash="\${compareToHash}"]\`);
              const toHash = compareToHash.substring(0, 8);
              const toMessage = toCommit ? toCommit.querySelector('.commit-message').textContent : 'Unknown';
              toSelection.innerHTML = \`
                <span class="compare-selection-label">To (newer):</span>
                <span>\${toHash} - \${toMessage}</span>
              \`;
              toSelection.classList.remove('empty');
              toSelection.classList.add('selected');
            } else {
              toSelection.innerHTML = \`
                <span class="compare-selection-label">To (newer):</span>
                <span>No version selected</span>
              \`;
              toSelection.classList.add('empty');
              toSelection.classList.remove('selected');
            }

            // Enable/disable compare button
            compareBtn.disabled = !(compareFromHash && compareToHash);
          }

          function highlightCommits() {
            const commits = document.querySelectorAll('.file-history-commit');
            commits.forEach(commit => {
              const hash = commit.getAttribute('data-hash');
              const fromBadge = commit.querySelector('.commit-compare-badge.from');
              const toBadge = commit.querySelector('.commit-compare-badge.to');
              
              commit.classList.remove('compare-from', 'compare-to');
              fromBadge.style.display = 'none';
              toBadge.style.display = 'none';

              if (hash === compareFromHash) {
                commit.classList.add('compare-from');
                fromBadge.style.display = 'inline-block';
              }
              if (hash === compareToHash) {
                commit.classList.add('compare-to');
                toBadge.style.display = 'inline-block';
              }
            });
          }

          function clearSelection() {
            compareFromHash = null;
            compareToHash = null;
            updateSelectionDisplay();
            highlightCommits();
            
            // Clear comparison analysis
            const container = document.getElementById('comparison-analysis-container');
            if (container) {
              container.innerHTML = '<div class="ai-analysis-loading">Select two versions to compare and analyze differences...</div>';
            }
          }

          // Compare versions functionality
          document.getElementById('compare-versions').addEventListener('click', function() {
            if (compareFromHash && compareToHash) {
              // Show loading state
              const container = document.getElementById('comparison-analysis-container');
              container.innerHTML = '<div class="ai-analysis-loading">Analyzing version differences...</div>';
              
              // Send comparison request to extension
              vscode.postMessage({
                command: 'fileHistoryComparison',
                repo: '${escapeHtml(options.repo || '')}', // Use repo from options
                filePath: '${escapeHtml(options.filePath)}',
                fromHash: compareFromHash,
                toHash: compareToHash
              });
            }
          });

          // Clear selection functionality
          document.getElementById('clear-selection').addEventListener('click', function() {
            clearSelection();
          });

          // VS Code API for webview communication
          const vscode = acquireVsCodeApi();
          console.log('[File History] File history webview initialized with version comparison support');
        })();
      </script>
    ` : '',
    options.isWebView ? '</body></html>' : ''
  ].join('\n');

  return html;
} 