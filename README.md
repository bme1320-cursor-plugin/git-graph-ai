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
        * **File History Analysis**: View detailed evolution patterns and AI-powered insights for individual files across their version history
        * **File Version Comparison**: Compare any two versions of a single file with AI analysis highlighting key differences, change types, impact analysis, and recommendations
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

基于原版Git Graph VSCode扩展的AI增强版本，为Git提交和差异比较添加智能分析功能。

## 🚀 新功能特性

### ⚡ 异步AI分析 (最新更新)
- **即时响应**: commit details和比较视图立即显示基本信息（<100ms）
- **后台分析**: AI分析在后台异步执行，不阻塞用户界面
- **动态更新**: AI分析完成后自动更新显示结果
- **智能缓存**: 相同内容的重复分析享受毫秒级响应时间

### 🧠 AI智能分析
- **提交分析**: 自动分析代码变更的目的、影响和质量
- **差异比较**: 智能总结版本间的主要变化和影响
- **代码审查**: 提供专业的代码质量评估和改进建议
- **多语言支持**: 支持主流编程语言的智能分析

### 💾 高效缓存系统
- **两级缓存**: 内存缓存(L1) + 磁盘缓存(L2)
- **智能键值**: 基于文件差异内容的SHA256哈希
- **LRU淘汰**: 自动清理最近最少使用的缓存项
- **TTL过期**: 默认7天生命周期，支持配置

## 📊 性能提升

| 场景 | 优化前 | 优化后 | 提升幅度 |
|------|--------|--------|----------|
| 首次查看commit | 2-10秒 | <100ms | **20-100倍** |
| 缓存命中 | 2-10秒 | <10ms | **200-1000倍** |
| 用户体验 | 界面卡顿 | 流畅响应 | **显著改善** |

## 🛠️ 安装和配置

### 安装步骤
1. 克隆项目到本地
2. 安装依赖：`npm install`
3. 编译代码：`npm run compile`
4. 在VSCode中按F5启动调试

### AI服务配置
```json
{
  "git-graph.aiAnalysis.enabled": true,
  "git-graph.aiAnalysis.apiUrl": "http://localhost:5000",
  "git-graph.aiAnalysis.maxFilesPerAnalysis": 10,
  "git-graph.aiAnalysis.supportedFileExtensions": [".js", ".ts", ".py", ".java", ".cpp", ".c", ".cs", ".go", ".rs", ".php", ".rb", ".swift", ".kt", ".scala", ".sh", ".sql", ".html", ".css", ".scss", ".less", ".vue", ".jsx", ".tsx", ".json", ".xml", ".yaml", ".yml", ".md", ".txt"]
}
```

### 缓存配置
```json
{
  "git-graph.aiAnalysis.cache.enabled": true,
  "git-graph.aiAnalysis.cache.maxMemoryItems": 100,
  "git-graph.aiAnalysis.cache.maxDiskItems": 500,
  "git-graph.aiAnalysis.cache.ttlHours": 168
}
```

## 🎯 使用方法

### 查看Commit分析
1. 在Git Graph中点击任意commit
2. 基本信息立即显示
3. AI分析结果几秒后自动更新
4. 查看详细的代码变更分析

### 比较版本差异
1. 选择两个commit进行比较
2. 文件变更列表立即显示
3. 等待AI生成版本比较报告
4. 获得智能的差异分析总结

### 管理缓存
- 查看缓存统计：`Ctrl+Shift+P` → "Git Graph: Show AI Cache Stats"
- 清除缓存：`Ctrl+Shift+P` → "Git Graph: Clear AI Cache"

## 🏗️ 技术架构

### 异步处理流程
```
用户请求 → 立即返回基本数据 → 后台AI分析 → 动态更新结果
```

### 缓存架构
```
请求 → 内存缓存检查 → 磁盘缓存检查 → AI服务调用 → 结果缓存
```

### 组件结构
- **DataSource**: 数据获取和AI分析调度
- **AiCacheManager**: 智能缓存管理
- **GitGraphView**: 前后端通信和UI更新
- **AI Service**: 外部AI分析服务集成

## 📈 开发进展

- [x] 基础AI分析功能
- [x] 智能缓存系统
- [x] **异步分析处理** (最新完成)
- [x] 用户配置界面
- [x] 错误处理和日志
- [x] 性能优化
- [ ] 更多AI模型支持
- [ ] 自定义分析模板
- [ ] 团队协作功能

## 🤝 贡献指南

欢迎提交Issue和Pull Request来改进这个项目！

### 开发环境设置
1. Fork项目
2. 创建功能分支
3. 提交更改
4. 创建Pull Request

### 代码规范
- 使用TypeScript进行类型安全开发
- 遵循ESLint配置的代码风格
- 添加适当的注释和文档

## 📄 许可证

本项目基于MIT许可证开源。

## 🙏 致谢

感谢原版Git Graph扩展的开发者们提供的优秀基础。

---

**享受更智能的Git可视化体验！** 🎉