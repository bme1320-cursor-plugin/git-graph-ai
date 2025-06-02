# AI EnhancedGit Graph extension for Visual Studio Code

View a Git Graph of your repository, and easily perform Git actions from the graph. Configurable to look the way you want!

![Recording of Git Graph](https://github.com/mhutchie/vscode-git-graph/raw/master/resources/demo.gif)

## Features

* Git Graph View:
    * Display:
        * Local & Remote Branches
        * Local Refs: Heads, Tags & Remotes
        * Uncommitted Changes
    * **AI-Enhanced Analysis** (NEW):
        * **Comprehensive Commit Analysis**: Get intelligent summaries of commit changes that focus on overall purpose, technical impact, and business value rather than individual file details
        * **Smart Version Comparison**: Receive integrated analysis of changes between any two commits, highlighting evolution patterns and architectural improvements
        * **Configurable File Type Support**: Customize which file types are analyzed by AI (supports common programming languages and text files)
        * **Performance Optimized**: Intelligent batching and concurrent processing to minimize analysis time
    * Perform Git Actions (available by right clicking on a commit / branch / tag):
        * Create, Checkout, Delete, Fetch, Merge, Pull, Push, Rebase, Rename & Reset Branches
        * Add, Delete & Push Tags
        * Checkout, Cherry Pick, Drop, Merge & Revert Commits
        * Clean, Reset & Stash Uncommitted Changes
        * Apply, Create Branch From, Drop & Pop Stashes
        * View annotated tag details (name, email, date and message)
        * Copy commit hashes, and branch, stash & tag names to the clipboard
    * View commit details and file changes by clicking on a commit. On the Commit Details View you can:
        * View the Visual Studio Code Diff of any file change by clicking on it.
        * Open the current version of any file that was affected in the commit.
        * Copy the path of any file that was affected in the commit to the clipboard.
        * Click on any HTTP/HTTPS url in the commit body to open it in your default web browser.
    * Compare any two commits by clicking on a commit, and then CTRL/CMD clicking on another commit. On the Commit Comparison View you can:
        * View the Visual Studio Code Diff of any file change between the selected commits by clicking on it.
        * Open the current version of any file that was affected between the selected commits.
        * Copy the path of any file that was affected between the selected commits to the clipboard.
    * Code Review - Keep track of which files you have reviewed in the Commit Details & Comparison Views.
        * Code Review's can be performed on any commit, or between any two commits (not on Uncommitted Changes).
        * When a Code Review is started, all files needing to be reviewed are bolded. When you view the diff / open a file, it will then be un-bolded.
        * Code Reviews persist across Visual Studio Code sessions. They are automatically closed after 90 days of inactivity.
    * View uncommitted changes, and compare the uncommitted changes with any commit.
    * Hover over any commit vertex on the graph to see a tooltip indicating:
        * Whether the commit is included in the HEAD.
        * Which branches, tags and stashes include the commit. 
    * Filter the branches shown in Git Graph using the 'Branches' dropdown menu. The options for filtering the branches are:
        * Show All branches
        * Select one or more branches to be viewed
        * Select from a user predefined array of custom glob patterns (by setting `git-graph.customBranchGlobPatterns`)
    * Fetch from Remote(s) _(available on the top control bar)_
    * Find Widget allows you to quickly find one or more commits containing a specific phrase (in the commit message / date / author / hash, branch or tag names).
    * Repository Settings Widget:
        * Allows you to view, add, edit, delete, fetch & prune remotes of the repository.
        * Configure "Issue Linking" - Converts issue numbers in commit messages into hyperlinks, that open the issue in your issue tracking system.
        * Configure "Pull Request Creation" - Automates the opening and pre-filling of a Pull Request form, directly from a branches context menu.
            * Support for the publicly hosted Bitbucket, GitHub and GitLab Pull Request providers is built-in.
            * Custom Pull Request providers can be configured using the Extension Setting `git-graph.customPullRequestProviders` (e.g. for use with privately hosted Pull Request providers). Information on how to configure custom providers is available [here](https://github.com/mhutchie/vscode-git-graph/wiki/Configuring-a-custom-Pull-Request-Provider).
        * Export your Git Graph Repository Configuration to a file that can be committed in the repository. It allows others working in the same repository to automatically use the same Git Graph configuration.
    * Keyboard Shortcuts (available in the Git Graph View):
        * `CTRL/CMD + F`: Open the Find Widget.
        * `CTRL/CMD + H`: Scrolls the Git Graph View to be centered on the commit referenced by HEAD.
        * `CTRL/CMD + R`: Refresh the Git Graph View.
        * `CTRL/CMD + S`: Scrolls the Git Graph View to the first (or next) stash in the loaded commits.
        * `CTRL/CMD + SHIFT + S`: Scrolls the Git Graph View to the last (or previous) stash in the loaded commits.
        * When the Commit Details View is open on a commit:
            * `Up` / `Down`: The Commit Details View will be opened on the commit directly above or below it on the Git Graph View.
            * `CTRL/CMD + Up` / `CTRL/CMD + Down`: The Commit Details View will be opened on its child or parent commit on the same branch.
                * If the Shift Key is also pressed (i.e. `CTRL/CMD + SHIFT + Up` / `CTRL/CMD + SHIFT + Down`), when branches or merges are encountered the alternative branch is followed.
        * `Enter`: If a dialog is open, pressing enter submits the dialog, taking the primary (left) action.
        * `Escape`: Closes the active dialog, context menu or the Commit Details View.
    * Resize the width of each column, and show/hide the Date, Author & Commit columns.
    * Common Emoji Shortcodes are automatically replaced with the corresponding emoji in commit messages (including all [gitmoji](https://gitmoji.carloscuesta.me/)). Custom Emoji Shortcode mappings can be defined in `git-graph.customEmojiShortcodeMappings`.
* A broad range of configurable settings (e.g. graph style, branch colours, and more...). See the 'Extension Settings' section below for more information.
* "Git Graph" launch button in the Status Bar
* "Git Graph: View Git Graph" launch command in the Command Palette

## Extension Settings

Detailed information of all Git Graph settings is available [here](https://github.com/mhutchie/vscode-git-graph/wiki/Extension-Settings), including: descriptions, screenshots, default values and types.

A summary of the Git Graph extension settings are:
* **AI Analysis** (NEW):
    * **Enabled**: Enable or disable AI-powered analysis of commits and file changes (default: `true`)
    * **Max Files Per Analysis**: Maximum number of files to analyze in a single request to prevent performance issues (default: `10`)
    * **Supported File Extensions**: Array of file extensions that should be analyzed by AI (default: `[".js", ".ts", ".jsx", ".tsx", ".py", ".java", ".c", ".cpp", ".cs", ".php", ".rb", ".go", ".rs", ".swift", ".kt", ".scala", ".md", ".txt", ".json", ".xml", ".yaml", ".yml", ".html", ".css", ".scss", ".less", ".sql", ".sh", ".bat", ".ps1"]`)
    * **Excluded File Extensions**: Array of file extensions to exclude from AI analysis (default: `[".min.js", ".min.css", ".bundle.js", ".chunk.js", ".map", ".lock", ".log"]`)
    * **Timeout**: Request timeout for AI analysis in seconds (default: `10`)
    * **Batch Size**: Number of files to process concurrently (default: `3`)
* **Commit Details View**:
    * **Auto Center**: Automatically center the Commit Details View when it is opened.
    * **File View**:
        * **File Tree**:
            * **Compact Folders**: Render the File Tree in the Commit Details View in a compacted form, such that folders with a single child folder are compressed into a single combined folder element.
        * **Type**: Sets the default type of File View used in the Commit Details View.
    * **Location**: Specifies where the Commit Details View is rendered in the Git Graph View.
* **Context Menu Actions Visibility**: Customise which context menu actions are visible. For more information, see the documentation [here](https://github.com/mhutchie/vscode-git-graph/wiki/Extension-Settings#context-menu-actions-visibility).
* **Custom Branch Glob Patterns**: An array of Custom Glob Patterns to be shown in the "Branches" dropdown. Example: `[{"name":"Feature Requests", "glob":"heads/feature/*"}]`
* **Custom Emoji Shortcode Mappings**: An array of custom Emoji Shortcode mappings. Example: `[{"shortcode": ":sparkles:", "emoji":"✨"}]`
* **Custom Pull Request Providers**: An array of custom Pull Request providers that can be used in the "Pull Request Creation" Integration. For information on how to configure this setting, see the documentation [here](https://github.com/mhutchie/vscode-git-graph/wiki/Configuring-a-custom-Pull-Request-Provider).
* **Date**:
    * **Format**: Specifies the date format to be used in the "Date" column on the Git Graph View.
    * **Type**: Specifies the date type to be displayed in the "Date" column on the Git Graph View, either the author or commit date.
* **Default Column Visibility**: An object specifying the default visibility of the Date, Author & Commit columns. Example: `{"Date": true, "Author": true, "Commit": true}`
* **Dialog > \***: Set the default options on the following dialogs: Add Tag, Apply Stash, Cherry Pick, Create Branch, Delete Branch, Fetch into Local Branch, Fetch Remote, Merge, Pop Stash, Pull Branch, Rebase, Reset, and Stash Uncommitted Changes
* **Enhanced Accessibility**: Visual file change A|M|D|R|U indicators in the Commit Details View for users with colour blindness. In the future, this setting will enable any additional accessibility related features of Git Graph that aren't enabled by default.
* **File Encoding**: The character set encoding used when retrieving a specific version of repository files (e.g. in the Diff View). A list of all supported encodings can be found [here](https://github.com/ashtuchkin/iconv-lite/wiki/Supported-Encodings).
* **Graph**:
    * **Colours**: Specifies the colours used on the graph.
    * **Style**: Specifies the style of the graph.
    * **Uncommitted Changes**: Specifies how the Uncommitted Changes are displayed on the graph.
* **Integrated Terminal Shell**: Specifies the path and filename of the Shell executable to be used by the Visual Studio Code Integrated Terminal, when it is opened by Git Graph.
* **Keyboard Shortcut > \***: Configures the keybindings used for all keyboard shortcuts in the Git Graph View.
* **Markdown**: Parse and render a frequently used subset of inline Markdown formatting rules in commit messages and tag details (bold, italics, bold & italics, and inline code blocks).
* **Max Depth Of Repo Search**: Specifies the maximum depth of subfolders to search when discovering repositories in the workspace.
* **Open New Tab Editor Group**: Specifies the Editor Group where Git Graph should open new tabs, when performing the following actions from the Git Graph View: Viewing the Visual Studio Code Diff View, Opening a File, Viewing a File at a Specific Revision.
* **Open to the Repo of the Active Text Editor Document**: Open the Git Graph View to the repository containing the active Text Editor document.
* **Reference Labels**:
    * **Alignment**: Specifies how branch and tag reference labels are aligned for each commit.
    * **Combine Local and Remote Branch Labels**: Combine local and remote branch labels if they refer to the same branch, and are on the same commit.
* **Repository**:
    * **Commits**:
        * **Fetch Avatars**: Fetch avatars of commit authors and committers.
        * **Initial Load**: Specifies the number of commits to initially load.
        * **Load More**: Specifies the number of additional commits to load when the "Load More Commits" button is pressed, or more commits are automatically loaded.
        * **Load More Automatically**: When the view has been scrolled to the bottom, automatically load more commits if they exist (instead of having to press the "Load More Commits" button).
        * **Mute**:
            * **Commits that are not ancestors of HEAD**: Display commits that aren't ancestors of the checked-out branch / commit with a muted text color.
            * **Merge Commits**: Display merge commits with a muted text color.
        * **Order**: Specifies the order of commits on the Git Graph View. See [git log](https://git-scm.com/docs/git-log#_commit_ordering) for more information on each order option.
        * **Show Signature Status**: Show the commit's signature status to the right of the Committer in the Commit Details View (only for signed commits). Hovering over the signature icon displays a tooltip with the signature details.
    * **Fetch and Prune**: Before fetching from remote(s) using the Fetch button on the Git Graph View Control Bar, remove any remote-tracking references that no longer exist on the remote(s).
    * **Fetch And Prune Tags**: Before fetching from remote(s) using the Fetch button on the Git Graph View Control Bar, remove any local tags that no longer exist on the remote(s).
    * **Include Commits Mentioned By Reflogs**: Include commits only mentioned by reflogs in the Git Graph View (only applies when showing all branches).
    * **On Load**:
        * **Scroll To Head**: Automatically scroll the Git Graph View to be centered on the commit referenced by HEAD.
        * **Show Checked Out Branch**: Show the checked out branch when a repository is loaded in the Git Graph View.
        * **Show Specific Branches**: Show specific branches when a repository is loaded in the Git Graph View.
    * **Only Follow First Parent**: Only follow the first parent of commits when discovering the commits to load in the Git Graph View. See [--first-parent](https://git-scm.com/docs/git-log#Documentation/git-log.txt---first-parent) to find out more about this setting.
    * **Show Commits Only Referenced By Tags**: Show Commits that are only referenced by tags in Git Graph.
    * **Show Remote Branches**: Show Remote Branches in Git Graph by default.
    * **Show Remote Heads**: Show Remote HEAD Symbolic References in Git Graph.
    * **Show Stashes**: Show Stashes in Git Graph by default.
    * **Show Tags**: Show Tags in Git Graph by default.
    * **Show Uncommitted Changes**: Show uncommitted changes. If you work on large repositories, disabling this setting can reduce the load time of the Git Graph View.
    * **Show Untracked Files**: Show untracked files when viewing the uncommitted changes. If you work on large repositories, disabling this setting can reduce the load time of the Git Graph View.
    * **Sign**:
        * **Commits**: Enables commit signing with GPG or X.509.
        * **Tags**: Enables tag signing with GPG or X.509.
    * **Use Mailmap**: Respect [.mailmap](https://git-scm.com/docs/git-check-mailmap#_mapping_authors) files when displaying author & committer names and email addresses.
* **Repository Dropdown Order**: Specifies the order that repositories are sorted in the repository dropdown on the Git Graph View (only visible when more than one repository exists in the current Visual Studio Code Workspace).
* **Retain Context When Hidden**: Specifies if the Git Graph view Visual Studio Code context is kept when the panel is no longer visible (e.g. moved to background tab). Enabling this setting will make Git Graph load significantly faster when switching back to the Git Graph tab, however has a higher memory overhead.
* **Show Status Bar Item**: Show a Status Bar Item that opens the Git Graph View when clicked.
* **Source Code Provider Integration Location**: Specifies where the "View Git Graph" action appears on the title of SCM Providers.
* **Tab Icon Colour Theme**: Specifies the colour theme of the icon displayed on the Git Graph tab.

This extension consumes the following settings:

* `git.path`: Specifies the path and filename of a portable Git installation.

## Extension Commands

This extension contributes the following commands:

* `git-graph.view`: Git Graph: View Git Graph
* `git-graph.addGitRepository`: Git Graph: Add Git Repository... _(used to add sub-repos to Git Graph)_
* `git-graph.clearAvatarCache`: Git Graph: Clear Avatar Cache
* `git-graph.endAllWorkspaceCodeReviews`: Git Graph: End All Code Reviews in Workspace
* `git-graph.endSpecificWorkspaceCodeReview`: Git Graph: End a specific Code Review in Workspace... _(used to end a specific Code Review without having to first open it in the Git Graph View)_
* `git-graph.fetch`: Git Graph: Fetch from Remote(s) _(used to open the Git Graph View and immediately run "Fetch from Remote(s)")_
* `git-graph.removeGitRepository`: Git Graph: Remove Git Repository... _(used to remove repositories from Git Graph)_
* `git-graph.resumeWorkspaceCodeReview`: Git Graph: Resume a specific Code Review in Workspace... _(used to open the Git Graph View to a Code Review that is already in progress)_
* `git-graph.version`: Git Graph: Get Version Information

## Release Notes

Detailed Release Notes are available [here](CHANGELOG.md).

## Development

To work on features involving the AI service, you need to run the local Python server:

1.  **Navigate to the AI service directory:**
    ```bash
    cd ai_service
    ```
2.  **Set up the AI Service Environment:**
    *   **(Recommended)** Create and activate a Python virtual environment:
        ```bash
        python -m venv venv
        source venv/bin/activate  # On Linux/macOS
        # venv\Scripts\activate  # On Windows
        ```
    *   Install dependencies:
        ```bash
        pip install -r requirements.txt
        ```
3.  **Configure OpenAI API Key:**
    *   Obtain an API Key from the [OpenAI Platform](https://platform.openai.com/api-keys).
    *   Set the `OPENAI_API_KEY` environment variable. **Do not hardcode your key in the code.**
        *   Linux/macOS (temporary):
            ```bash
            export OPENAI_API_KEY='YOUR_API_KEY'
            ```
        *   Windows CMD (temporary):
            ```bash
            set OPENAI_API_KEY=YOUR_API_KEY
            ```
        *   Windows PowerShell (temporary):
            ```powershell
            $env:OPENAI_API_KEY = 'YOUR_API_KEY'
            ```
        *   For a more permanent solution, add it to your system's environment variables or use a `.env` file management library if preferred.
    *   Replace `YOUR_API_KEY` with your actual OpenAI API key.
4.  **Run the server:**
    ```bash
    python server.py
    ```
    The server will run on `http://localhost:5111` (or `http://127.0.0.1:5111`). The extension backend will communicate with this local server when performing AI analysis.

## Visual Studio Marketplace

This extension is available on the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=mhutchie.git-graph) for Visual Studio Code.

## Acknowledgements

Thank you to all of the contributors that help with the development of Git Graph!

Some of the icons used in Git Graph are from the following sources, please support them for their excellent work!
- [GitHub Octicons](https://octicons.github.com/) ([License](https://github.com/primer/octicons/blob/master/LICENSE))
- [Icons8](https://icons8.com/icon/pack/free-icons/ios11) ([License](https://icons8.com/license))

# Git Graph AI Enhanced

基于原版 Git Graph VSCode 扩展的 AI 增强版本，为 Git 提交和差异比较添加智能分析功能。

## ✨ 新增功能

### 🤖 AI 智能分析
- **提交分析**: 自动分析单个提交的变更内容，提供智能摘要
- **版本比较**: 对比不同提交之间的差异，生成详细的变更分析
- **多文件支持**: 同时分析多个文件的变更，提供综合性分析报告
- **智能过滤**: 自动识别文本文件，跳过二进制文件和不相关文件
- **可配置**: 支持自定义分析参数和文件类型过滤

### 📊 增强的用户界面
- **结构化显示**: 美观的AI分析结果展示界面
- **统计信息**: 详细的文件变更统计
- **响应式设计**: 适配不同屏幕尺寸

## 🚀 快速开始

### 1. 安装扩展
从 VSCode 扩展市场安装 "Git Graph AI Enhanced"

### 2. 启动 AI 服务
```bash
# 进入 AI 服务目录
cd ai_service

# 安装依赖
pip install -r requirements.txt

# 设置 OpenAI API 密钥
export OPENAI_API_KEY="your-api-key-here"

# 启动服务
python start_ai_service.py
```

### 3. 配置代理（如需要）
如果在中国大陆使用，可能需要配置代理：
```bash
export http_proxy="http://127.0.0.1:7890"
export https_proxy="http://127.0.0.1:7890"
```

### 4. 开始使用
1. 在 VSCode 中打开 Git 仓库
2. 使用命令面板 (`Ctrl+Shift+P`) 搜索 "Git Graph"
3. 点击任意提交查看详情，AI 分析将自动显示
4. 选择两个提交进行比较，查看智能差异分析

## ⚙️ 配置选项

在 VSCode 设置中可以配置以下选项：

### AI 分析设置
- `git-graph.aiAnalysis.enabled`: 启用/禁用 AI 分析功能
- `git-graph.aiAnalysis.maxFilesPerAnalysis`: 单次分析的最大文件数量
- `git-graph.aiAnalysis.supportedFileExtensions`: 支持分析的文件扩展名
- `git-graph.aiAnalysis.excludedFileExtensions`: 排除分析的文件扩展名
- `git-graph.aiAnalysis.timeout`: AI 分析请求超时时间
- `git-graph.aiAnalysis.batchSize`: 批量分析的并发数量

### 默认配置
```json
{
  "git-graph.aiAnalysis.enabled": true,
  "git-graph.aiAnalysis.maxFilesPerAnalysis": 50,
  "git-graph.aiAnalysis.supportedFileExtensions": [
    ".js", ".ts", ".jsx", ".tsx", ".py", ".java", ".c", ".cpp",
    ".cs", ".php", ".rb", ".go", ".rs", ".swift", ".kt",
    ".html", ".css", ".scss", ".md", ".txt", ".json", ".xml"
  ],
  "git-graph.aiAnalysis.excludedFileExtensions": [
    ".png", ".jpg", ".jpeg", ".gif", ".pdf", ".zip", ".exe", ".dll"
  ],
  "git-graph.aiAnalysis.timeout": 10000,
  "git-graph.aiAnalysis.batchSize": 10
}
```

## 🔧 技术架构

### 前端 (VSCode 扩展)
- **TypeScript**: 主要开发语言
- **Web Components**: 用户界面组件
- **CSS**: 样式和主题适配

### 后端 (AI 服务)
- **Python Flask**: Web 服务框架
- **OpenAI API**: AI 分析引擎
- **HTTP API**: 前后端通信接口

### 数据流
1. 用户在 Git Graph 中选择提交或进行比较
2. 扩展提取文件差异和内容
3. 通过 HTTP API 发送到 AI 服务
4. AI 服务调用 OpenAI API 进行分析
5. 返回分析结果并在界面中展示

## 📝 API 接口

### 健康检查
```
GET /health
```

### 分析单个文件差异
```
POST /analyze_diff
Content-Type: application/json

{
  "file_path": "src/example.js",
  "file_diff": "diff content...",
  "content_before": "...",
  "content_after": "..."
}
```

### 批量分析
```
POST /analyze_batch
Content-Type: application/json

{
  "files": [
    {
      "file_path": "src/file1.js",
      "file_diff": "...",
      "content_before": "...",
      "content_after": "..."
    }
  ]
}
```

## 🛠️ 开发指南

### 环境要求
- Node.js 14+
- Python 3.7+
- VSCode 1.38.0+

### 本地开发
```bash
# 克隆仓库
git clone <repository-url>
cd git-graph-ai

# 安装前端依赖
npm install

# 编译扩展
npm run compile

# 启动 AI 服务
cd ai_service
pip install -r requirements.txt
python start_ai_service.py
```

### 构建和打包
```bash
# 编译所有代码
npm run compile

# 打包扩展
npm run package
```

## 🤝 贡献指南

欢迎提交 Issue 和 Pull Request！

### 开发流程
1. Fork 本仓库
2. 创建功能分支
3. 提交更改
4. 创建 Pull Request

### 代码规范
- 使用 TypeScript 进行类型检查
- 遵循 ESLint 规则
- 添加适当的注释和文档

## 📄 许可证

本项目基于原版 Git Graph 扩展，遵循相同的许可证条款。

## 🙏 致谢

- 感谢 [mhutchie](https://github.com/mhutchie) 开发的原版 Git Graph 扩展
- 感谢 OpenAI 提供的 AI 分析能力
- 感谢所有贡献者和用户的支持

## 📞 支持

如果遇到问题或有建议，请：
1. 查看 [常见问题](docs/FAQ.md)
2. 提交 [Issue](https://github.com/your-repo/issues)
3. 参与 [讨论](https://github.com/your-repo/discussions)