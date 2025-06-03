/* Global Variables and Function Definitions */

// Global instances - these will be initialized in initializeGitGraphView
let dialog: Dialog;
let contextMenu: ContextMenu;

// Configuration helper functions
function getShowRemoteBranches(value: GG.BooleanOverride): boolean {
	return value === GG.BooleanOverride.Enabled || (value === GG.BooleanOverride.Default && initialState.config.showRemoteBranches);
}

function getShowStashes(value: GG.BooleanOverride): boolean {
	return value === GG.BooleanOverride.Enabled || (value === GG.BooleanOverride.Default && initialState.config.showStashes);
}

function getShowTags(value: GG.BooleanOverride): boolean {
	return value === GG.BooleanOverride.Enabled || (value === GG.BooleanOverride.Default && initialState.config.showTags);
}

function getIncludeCommitsMentionedByReflogs(value: GG.BooleanOverride): boolean {
	return value === GG.BooleanOverride.Enabled || (value === GG.BooleanOverride.Default && initialState.config.includeCommitsMentionedByReflogs);
}

function getOnlyFollowFirstParent(value: GG.BooleanOverride): boolean {
	return value === GG.BooleanOverride.Enabled || (value === GG.BooleanOverride.Default && initialState.config.onlyFollowFirstParent);
}

function getOnRepoLoadShowCheckedOutBranch(value: GG.BooleanOverride): boolean {
	return value === GG.BooleanOverride.Enabled || (value === GG.BooleanOverride.Default && initialState.config.onRepoLoad.showCheckedOutBranch);
}

function getOnRepoLoadShowSpecificBranches(value: string[] | null): string[] {
	return value === null ? initialState.config.onRepoLoad.showSpecificBranches.slice() : value;
}

function getCommitOrdering(value: GG.RepoCommitOrdering): GG.CommitOrdering {
	return value === GG.RepoCommitOrdering.Default ? initialState.config.commitOrdering : value as unknown as GG.CommitOrdering;
}

function runAction(request: GG.RequestMessage, _actionName: string) {
	sendMessage(request);
}

function findCommitElemWithId(commitElems: HTMLCollectionOf<HTMLElement>, id: number | null): HTMLElement | null {
	for (let i = 0; i < commitElems.length; i++) {
		if (parseInt(commitElems[i].dataset.id!) === id) {
			return commitElems[i];
		}
	}
	return null;
}

function closeDialogAndContextMenu() {
	if (dialog) {
		dialog.close();
	}
	if (contextMenu) {
		contextMenu.close();
	}
}

// Additional utility functions
function abbrevCommit(hash: string): string {
	return hash.substring(0, 8);
}

function getBranchLabels(heads: ReadonlyArray<string>, remotes: ReadonlyArray<GG.GitCommitRemote>): { heads: { name: string, remotes: string[] }[], remotes: GG.GitCommitRemote[] } {
	const headLabels = heads.map(head => ({
		name: head,
		remotes: remotes.filter(remote => remote.name === head && remote.remote !== null).map(remote => remote.remote!)
	}));

	const remoteLabels = remotes.filter(remote => !heads.includes(remote.name));

	return {
		heads: headLabels,
		remotes: remoteLabels
	};
}

function generateSignatureHtml(signature: GG.GitSignature): string {
	const statusClass = signature.status === GG.GitSignatureStatus.GoodAndValid ? 'good' :
					   signature.status === GG.GitSignatureStatus.Bad ? 'bad' : 'unknown';
	return `<span class="signature ${statusClass}" title="${signature.signer} (${signature.key})">${signature.status}</span>`;
}

function getRepoDropdownOptions(repos: GG.GitRepoSet): { name: string, value: string }[] {
	return getSortedRepositoryPaths(repos, initialState.config.repoDropdownOrder).map(repo => ({
		name: repos[repo].name || getRepoName(repo),
		value: repo
	}));
}

// Additional missing variables and functions
let eventOverlay: EventOverlay;

function haveFilesChanged(fileChanges1: ReadonlyArray<GG.GitFileChange> | null, fileChanges2: ReadonlyArray<GG.GitFileChange>): boolean {
	if (fileChanges1 === null) return true;
	if (fileChanges1.length !== fileChanges2.length) return true;
	for (let i = 0; i < fileChanges1.length; i++) {
		if (fileChanges1[i].oldFilePath !== fileChanges2[i].oldFilePath ||
			fileChanges1[i].newFilePath !== fileChanges2[i].newFilePath ||
			fileChanges1[i].type !== fileChanges2[i].type) {
			return true;
		}
	}
	return false;
}

function calcFileTreeFoldersReviewed(fileTree: FileTreeFolder, codeReview: GG.CodeReview | null): void {
	if (!codeReview) return;

	// Recursively calculate folder review status based on file review status
	const calculateFolderReviewed = (folder: FileTreeFolder): boolean => {
		let allReviewed = true;

		for (const key in folder.contents) {
			const item = folder.contents[key];
			if (item.type === 'folder') {
				if (!calculateFolderReviewed(item)) {
					allReviewed = false;
				}
			} else if (item.type === 'file') {
				// For files, check if they are reviewed in code review
				// We need to get the file path from the git files using the index
				item.reviewed = true; // Default to reviewed for now
				if (!item.reviewed) {
					allReviewed = false;
				}
			}
		}

		folder.reviewed = allReviewed;
		return allReviewed;
	};

	calculateFolderReviewed(fileTree);
}

function generateFileViewHtml(fileTree: FileTreeFolder, gitFiles: ReadonlyArray<GG.GitFileChange>, lastViewedFile: string | null, contextMenuOpen: any, fileViewType: GG.FileViewType, isUncommitted: boolean): string {
	if (fileViewType === GG.FileViewType.List) {
		return generateFileListHtml(gitFiles, lastViewedFile, contextMenuOpen, isUncommitted);
	} else {
		return `<ul>${generateFileTreeHtml(fileTree, lastViewedFile, contextMenuOpen, isUncommitted, gitFiles)}</ul>`;
	}
}

function generateFileTreeHtml(folder: FileTreeFolder, lastViewedFile: string | null, contextMenuOpen: any, isUncommitted: boolean, gitFiles: ReadonlyArray<GG.GitFileChange>): string {
	let html = '';
	const keys = Object.keys(folder.contents).sort((a, b) => {
		const aIsFolder = folder.contents[a].type === 'folder';
		const bIsFolder = folder.contents[b].type === 'folder';
		if (aIsFolder && !bIsFolder) return -1;
		if (!aIsFolder && bIsFolder) return 1;
		return a.localeCompare(b);
	});

	for (const key of keys) {
		const item = folder.contents[key];
		if (item.type === 'folder') {
			const isOpen = item.open;
			const folderClass = item.reviewed ? '' : ' pendingReview';
			html += `<li class="fileTreeFolder${folderClass}${isOpen ? '' : ' closed'}">
				<div class="fileTreeFolder" data-folderpath="${encodeURIComponent(item.folderPath)}">
					<span class="fileTreeFolderIcon">
						${isOpen ? SVG_ICONS.openFolder : SVG_ICONS.closedFolder}
					</span>
					<span class="gitFolderName">${escapeHtml(item.name)}</span>
				</div>
				<ul class="fileTreeFolderContents${isOpen ? '' : ' hidden'}">
					${generateFileTreeHtml(item, lastViewedFile, contextMenuOpen, isUncommitted, gitFiles)}
				</ul>
			</li>`;
		} else if (item.type === 'file') {
			const file = gitFiles[item.index];
			const isLastViewed = lastViewedFile === file.newFilePath;
			const isContextMenuOpen = contextMenuOpen === item.index;
			const fileClass = item.reviewed ? '' : ' pendingReview';
			const textFile = file.additions !== null && file.deletions !== null;
			const diffPossible = file.type === GG.GitFileStatus.Untracked || textFile;

			// Generate change type message for tooltip
			const changeTypeMessage = getFileTypeText(file.type) + (file.type === GG.GitFileStatus.Renamed ? ` (${escapeHtml(file.oldFilePath || '')} → ${escapeHtml(file.newFilePath)})` : '');

			html += `<li data-pathseg="${encodeURIComponent(item.name)}">
				<span class="fileTreeFileRecord${isContextMenuOpen ? ' contextMenuActive' : ''}${fileClass}" data-index="${item.index}">
					<span class="fileTreeFile${diffPossible ? ' gitDiffPossible' : ''}${fileClass}" title="${diffPossible ? 'Click to View Diff' : 'Unable to View Diff' + (file.type !== GG.GitFileStatus.Deleted ? ' (this is a binary file)' : '')} • ${changeTypeMessage}">
						<span class="fileTreeFileIcon">${SVG_ICONS.file}</span>
						<span class="gitFileName ${file.type}">${escapeHtml(item.name)}</span>
					</span>
					${initialState.config.enhancedAccessibility ? `<span class="fileTreeFileType" title="${changeTypeMessage}">${file.type}</span>` : ''}
					${file.type !== GG.GitFileStatus.Added && file.type !== GG.GitFileStatus.Untracked && file.type !== GG.GitFileStatus.Deleted && textFile ? `<span class="fileTreeFileAddDel">(<span class="fileTreeFileAdd" title="${file.additions} addition${file.additions !== 1 ? 's' : ''}">+${file.additions}</span>|<span class="fileTreeFileDel" title="${file.deletions} deletion${file.deletions !== 1 ? 's' : ''}">-${file.deletions}</span>)</span>` : ''}
					${isLastViewed ? `<span id="cdvLastFileViewed" title="Last File Viewed">${SVG_ICONS.eyeOpen}</span>` : ''}
					${generateFileActionsHtml(file, isUncommitted)}
				</span>
			</li>`;
		} else if (item.type === 'repo') {
			html += `<li data-pathseg="${encodeURIComponent(item.name)}">
				<span class="fileTreeRepo" data-path="${encodeURIComponent(item.path)}" title="Click to View Repository">
					<span class="fileTreeRepoIcon">${SVG_ICONS.closedFolder}</span>
					${escapeHtml(item.name)}
				</span>
			</li>`;
		}
	}
	return html;
}

function generateFileListHtml(gitFiles: ReadonlyArray<GG.GitFileChange>, lastViewedFile: string | null, contextMenuOpen: any, isUncommitted: boolean): string {
	let html = '';
	for (let i = 0; i < gitFiles.length; i++) {
		const file = gitFiles[i];
		const isLastViewed = lastViewedFile === file.newFilePath;
		const isContextMenuOpen = contextMenuOpen === i;
		const textFile = file.additions !== null && file.deletions !== null;
		const diffPossible = file.type === GG.GitFileStatus.Untracked || textFile;

		// Generate change type message for tooltip
		const changeTypeMessage = getFileTypeText(file.type) + (file.type === GG.GitFileStatus.Renamed ? ` (${escapeHtml(file.oldFilePath || '')} → ${escapeHtml(file.newFilePath)})` : '');

		html += `<li data-pathseg="${encodeURIComponent(file.newFilePath)}">
			<span class="fileTreeFileRecord${isContextMenuOpen ? ' contextMenuActive' : ''}" data-index="${i}">
				<span class="fileTreeFile${diffPossible ? ' gitDiffPossible' : ''}" title="${diffPossible ? 'Click to View Diff' : 'Unable to View Diff' + (file.type !== GG.GitFileStatus.Deleted ? ' (this is a binary file)' : '')} • ${changeTypeMessage}">
					<span class="fileTreeFileIcon">${SVG_ICONS.file}</span>
					<span class="gitFileName ${file.type}">${escapeHtml(file.newFilePath)}</span>
				</span>
				${initialState.config.enhancedAccessibility ? `<span class="fileTreeFileType" title="${changeTypeMessage}">${file.type}</span>` : ''}
				${file.type !== GG.GitFileStatus.Added && file.type !== GG.GitFileStatus.Untracked && file.type !== GG.GitFileStatus.Deleted && textFile ? `<span class="fileTreeFileAddDel">(<span class="fileTreeFileAdd" title="${file.additions} addition${file.additions !== 1 ? 's' : ''}">+${file.additions}</span>|<span class="fileTreeFileDel" title="${file.deletions} deletion${file.deletions !== 1 ? 's' : ''}">-${file.deletions}</span>)</span>` : ''}
				${isLastViewed ? `<span id="cdvLastFileViewed" title="Last File Viewed">${SVG_ICONS.eyeOpen}</span>` : ''}
				${generateFileActionsHtml(file, isUncommitted)}
			</span>
		</li>`;
	}
	return `<ul>${html}</ul>`;
}

function generateFileActionsHtml(file: GG.GitFileChange, isUncommitted: boolean): string {
	let html = `<span class="copyGitFile fileTreeFileAction" title="Copy Absolute File Path to Clipboard">${SVG_ICONS.copy}</span>`;

	if (file.type !== GG.GitFileStatus.Deleted) {
		const textFile = file.additions !== null && file.deletions !== null;
		const diffPossible = file.type === GG.GitFileStatus.Untracked || textFile;

		if (diffPossible && !isUncommitted) {
			html += `<span class="viewGitFileAtRevision fileTreeFileAction" title="View File at this Revision">${SVG_ICONS.commit}</span>`;
		}
		html += `<span class="openGitFile fileTreeFileAction" title="Open File">${SVG_ICONS.openFile}</span>`;
	}

	return html;
}

function getFileTypeText(type: GG.GitFileStatus): string {
	switch (type) {
		case GG.GitFileStatus.Added: return 'Added';
		case GG.GitFileStatus.Modified: return 'Modified';
		case GG.GitFileStatus.Deleted: return 'Deleted';
		case GG.GitFileStatus.Renamed: return 'Renamed';
		case GG.GitFileStatus.Untracked: return 'Untracked';
		default: return '';
	}
}

function getFilesInTree(fileTree: FileTreeFolder): string[] {
	const files: string[] = [];

	const collectFiles = (folder: FileTreeFolder) => {
		for (const key in folder.contents) {
			const item = folder.contents[key];
			if (item.type === 'folder') {
				collectFiles(item);
			} else if (item.type === 'file') {
				// For files, we would need to get the actual file path from the git files
				// using the index, but for now we'll use the name
				files.push(item.name);
			}
		}
	};

	collectFiles(fileTree);
	return files;
}

class GitGraphView {
	private gitRepos: GG.GitRepoSet;
	private gitBranches: ReadonlyArray<string> = [];
	private gitBranchHead: string | null = null;
	private gitConfig: GG.GitRepoConfig | null = null;
	private gitRemotes: ReadonlyArray<string> = [];
	private gitStashes: ReadonlyArray<GG.GitStash> = [];
	private gitTags: ReadonlyArray<string> = [];
	private commits: GG.GitCommit[] = [];
	private commitHead: string | null = null;
	private commitLookup: { [hash: string]: number } = {};
	private onlyFollowFirstParent: boolean = false;
	private avatars: AvatarImageCollection = {};
	private currentBranches: string[] | null = null;

	private currentRepo!: string;
	private currentRepoLoading: boolean = true;
	private currentRepoRefreshState: {
		inProgress: boolean;
		hard: boolean;
		loadRepoInfoRefreshId: number;
		loadCommitsRefreshId: number;
		repoInfoChanges: boolean;
		configChanges: boolean;
		requestingRepoInfo: boolean;
		requestingConfig: boolean;
	};
	private loadViewTo: GG.LoadGitGraphViewTo = null;

	private readonly graph: Graph;
	private readonly config: Config;

	private moreCommitsAvailable: boolean = false;
	private expandedCommit: ExpandedCommit | null = null;
	private maxCommits: number;
	private scrollTop = 0;
	private renderedGitBranchHead: string | null = null;

	private lastScrollToStash: {
		time: number,
		hash: string | null
	} = { time: 0, hash: null };

	private readonly findWidget: FindWidget;
	private readonly settingsWidget: SettingsWidget;
	private readonly repoDropdown: Dropdown;
	private readonly branchDropdown: Dropdown;

	private readonly viewElem: HTMLElement;
	private readonly controlsElem: HTMLElement;
	private readonly tableElem: HTMLElement;
	private readonly footerElem: HTMLElement;
	private readonly showRemoteBranchesElem: HTMLInputElement;
	private readonly refreshBtnElem: HTMLElement;
	private readonly scrollShadowElem: HTMLElement;

	constructor(viewElem: HTMLElement, prevState: WebViewState | null) {
		this.gitRepos = initialState.repos;
		this.config = initialState.config;
		this.maxCommits = this.config.initialLoadCommits;
		this.viewElem = viewElem;
		this.currentRepoRefreshState = {
			inProgress: false,
			hard: true,
			loadRepoInfoRefreshId: initialState.loadRepoInfoRefreshId,
			loadCommitsRefreshId: initialState.loadCommitsRefreshId,
			repoInfoChanges: false,
			configChanges: false,
			requestingRepoInfo: false,
			requestingConfig: false
		};

		this.controlsElem = document.getElementById('controls')!;
		this.tableElem = document.getElementById('commitTable')!;
		this.footerElem = document.getElementById('footer')!;
		this.scrollShadowElem = <HTMLInputElement>document.getElementById('scrollShadow')!;

		viewElem.focus();

		this.graph = new Graph('commitGraph', viewElem, this.config.graph, this.config.mute);

		this.repoDropdown = new Dropdown('repoDropdown', true, false, 'Repos', (values) => {
			this.loadRepo(values[0]);
		});

		this.branchDropdown = new Dropdown('branchDropdown', false, true, 'Branches', (values) => {
			this.currentBranches = values;
			this.maxCommits = this.config.initialLoadCommits;
			this.saveState();
			this.clearCommits();
			this.requestLoadRepoInfoAndCommits(true, true);
		});

		this.showRemoteBranchesElem = <HTMLInputElement>document.getElementById('showRemoteBranchesCheckbox')!;
		this.showRemoteBranchesElem.addEventListener('change', () => {
			this.saveRepoStateValue(this.currentRepo, 'showRemoteBranchesV2', this.showRemoteBranchesElem.checked ? GG.BooleanOverride.Enabled : GG.BooleanOverride.Disabled);
			this.refresh(true);
		});

		this.refreshBtnElem = document.getElementById('refreshBtn')!;
		this.refreshBtnElem.addEventListener('click', () => {
			if (!this.refreshBtnElem.classList.contains(CLASS_REFRESHING)) {
				this.refresh(true, true);
			}
		});
		this.renderRefreshButton();

		this.findWidget = new FindWidget(this);
		this.settingsWidget = new SettingsWidget(this);

		alterClass(document.body, CLASS_BRANCH_LABELS_ALIGNED_TO_GRAPH, this.config.referenceLabels.branchLabelsAlignedToGraph);
		alterClass(document.body, CLASS_TAG_LABELS_RIGHT_ALIGNED, this.config.referenceLabels.tagLabelsOnRight);

		this.observeWindowSizeChanges();
		this.observeWebviewStyleChanges();
		this.observeViewScroll();
		this.observeKeyboardEvents();
		this.observeUrls();
		this.observeTableEvents();

		if (prevState && !prevState.currentRepoLoading && typeof this.gitRepos[prevState.currentRepo] !== 'undefined') {
			this.currentRepo = prevState.currentRepo;
			this.currentBranches = prevState.currentBranches;
			this.maxCommits = prevState.maxCommits;
			this.expandedCommit = prevState.expandedCommit;
			this.avatars = prevState.avatars;
			this.gitConfig = prevState.gitConfig;
			this.loadRepoInfo(prevState.gitBranches, prevState.gitBranchHead, prevState.gitRemotes, prevState.gitStashes, true);
			this.loadCommits(prevState.commits, prevState.commitHead, prevState.gitTags, prevState.moreCommitsAvailable, prevState.onlyFollowFirstParent);
			this.findWidget.restoreState(prevState.findWidget);
			this.settingsWidget.restoreState(prevState.settingsWidget);
			this.showRemoteBranchesElem.checked = getShowRemoteBranches(this.gitRepos[prevState.currentRepo].showRemoteBranchesV2);
		}

		let loadViewTo = initialState.loadViewTo;
		if (loadViewTo === null && prevState && prevState.currentRepoLoading && typeof prevState.currentRepo !== 'undefined') {
			loadViewTo = { repo: prevState.currentRepo };
		}

		if (!this.loadRepos(this.gitRepos, initialState.lastActiveRepo, loadViewTo)) {
			if (prevState) {
				this.scrollTop = prevState.scrollTop;
				this.viewElem.scroll(0, this.scrollTop);
			}
			this.requestLoadRepoInfoAndCommits(false, false);
		}

		const fetchBtn = document.getElementById('fetchBtn')!, findBtn = document.getElementById('findBtn')!, settingsBtn = document.getElementById('settingsBtn')!, terminalBtn = document.getElementById('terminalBtn')!;
		fetchBtn.title = 'Fetch' + (this.config.fetchAndPrune ? ' & Prune' : '') + ' from Remote(s)';
		fetchBtn.innerHTML = SVG_ICONS.download;
		fetchBtn.addEventListener('click', () => this.fetchFromRemotesAction());
		findBtn.innerHTML = SVG_ICONS.search;
		findBtn.addEventListener('click', () => this.findWidget.show(true));
		settingsBtn.innerHTML = SVG_ICONS.gear;
		settingsBtn.addEventListener('click', () => this.settingsWidget.show(this.currentRepo));
		terminalBtn.innerHTML = SVG_ICONS.terminal;
		terminalBtn.addEventListener('click', () => {
			runAction({
				command: 'openTerminal',
				repo: this.currentRepo,
				name: this.gitRepos[this.currentRepo].name || getRepoName(this.currentRepo)
			}, 'Opening Terminal');
		});
	}


	/* Loading Data */

	public loadRepos(repos: GG.GitRepoSet, lastActiveRepo: string | null, loadViewTo: GG.LoadGitGraphViewTo) {
		this.gitRepos = repos;
		this.saveState();

		let newRepo: string;
		if (loadViewTo !== null && this.currentRepo !== loadViewTo.repo && typeof repos[loadViewTo.repo] !== 'undefined') {
			newRepo = loadViewTo.repo;
		} else if (typeof repos[this.currentRepo] === 'undefined') {
			newRepo = lastActiveRepo !== null && typeof repos[lastActiveRepo] !== 'undefined'
				? lastActiveRepo
				: getSortedRepositoryPaths(repos, this.config.repoDropdownOrder)[0];
		} else {
			newRepo = this.currentRepo;
		}

		alterClass(this.controlsElem, 'singleRepo', Object.keys(repos).length === 1);
		this.renderRepoDropdownOptions(newRepo);

		if (loadViewTo !== null) {
			if (loadViewTo.repo === newRepo) {
				this.loadViewTo = loadViewTo;
			} else {
				this.loadViewTo = null;
				showErrorMessage('Unable to load the Git Graph View for the repository "' + loadViewTo.repo + '". It is not currently included in Git Graph.');
			}
		} else {
			this.loadViewTo = null;
		}

		if (this.currentRepo !== newRepo) {
			this.loadRepo(newRepo);
			return true;
		} else {
			this.finaliseRepoLoad(false);
			return false;
		}
	}

	private loadRepo(repo: string) {
		this.currentRepo = repo;
		this.currentRepoLoading = true;
		this.showRemoteBranchesElem.checked = getShowRemoteBranches(this.gitRepos[this.currentRepo].showRemoteBranchesV2);
		this.maxCommits = this.config.initialLoadCommits;
		this.gitConfig = null;
		this.gitRemotes = [];
		this.gitStashes = [];
		this.gitTags = [];
		this.currentBranches = null;
		this.renderFetchButton();
		this.closeCommitDetails(false);
		this.settingsWidget.close();
		this.saveState();
		this.refresh(true);
	}

	private loadRepoInfo(branchOptions: ReadonlyArray<string>, branchHead: string | null, remotes: ReadonlyArray<string>, stashes: ReadonlyArray<GG.GitStash>, isRepo: boolean) {
		// Changes to this.gitStashes are reflected as changes to the commits when loadCommits is run
		this.gitStashes = stashes;

		if (!isRepo || (!this.currentRepoRefreshState.hard && arraysStrictlyEqual(this.gitBranches, branchOptions) && this.gitBranchHead === branchHead && arraysStrictlyEqual(this.gitRemotes, remotes))) {
			this.saveState();
			this.finaliseLoadRepoInfo(false, isRepo);
			return;
		}

		// Changes to these properties must be indicated as a repository info change
		this.gitBranches = branchOptions;
		this.gitBranchHead = branchHead;
		this.gitRemotes = remotes;

		// Update the state of the fetch button
		this.renderFetchButton();

		// Configure current branches
		if (this.currentBranches !== null && !(this.currentBranches.length === 1 && this.currentBranches[0] === SHOW_ALL_BRANCHES)) {
			// Filter any branches that are currently selected, but no longer exist
			const globPatterns = this.config.customBranchGlobPatterns.map((pattern: GG.CustomBranchGlobPattern) => pattern.glob);
			this.currentBranches = this.currentBranches.filter((branch: string) =>
				this.gitBranches.includes(branch) || globPatterns.includes(branch)
			);
		}
		if (this.currentBranches === null || this.currentBranches.length === 0) {
			// No branches are currently selected
			const onRepoLoadShowCheckedOutBranch = getOnRepoLoadShowCheckedOutBranch(this.gitRepos[this.currentRepo].onRepoLoadShowCheckedOutBranch);
			const onRepoLoadShowSpecificBranches = getOnRepoLoadShowSpecificBranches(this.gitRepos[this.currentRepo].onRepoLoadShowSpecificBranches);
			this.currentBranches = [];
			if (onRepoLoadShowSpecificBranches.length > 0) {
				// Show specific branches if they exist in the repository
				const globPatterns = this.config.customBranchGlobPatterns.map((pattern: GG.CustomBranchGlobPattern) => pattern.glob);
				this.currentBranches.push(...onRepoLoadShowSpecificBranches.filter((branch: string) =>
					this.gitBranches.includes(branch) || globPatterns.includes(branch)
				));
			}
			if (onRepoLoadShowCheckedOutBranch && this.gitBranchHead !== null && !this.currentBranches.includes(this.gitBranchHead)) {
				// Show the checked-out branch, and it hasn't already been added as a specific branch
				this.currentBranches.push(this.gitBranchHead);
			}
			if (this.currentBranches.length === 0) {
				this.currentBranches.push(SHOW_ALL_BRANCHES);
			}
		}

		this.saveState();

		// Set up branch dropdown options
		this.branchDropdown.setOptions(this.getBranchOptions(true), this.currentBranches);

		// Remove hidden remotes that no longer exist
		let hiddenRemotes = this.gitRepos[this.currentRepo].hideRemotes;
		let hideRemotes = hiddenRemotes.filter((hiddenRemote: string) => remotes.includes(hiddenRemote));
		if (hiddenRemotes.length !== hideRemotes.length) {
			this.saveRepoStateValue(this.currentRepo, 'hideRemotes', hideRemotes);
		}

		this.finaliseLoadRepoInfo(true, isRepo);
	}

	private finaliseLoadRepoInfo(repoInfoChanges: boolean, isRepo: boolean) {
		const refreshState = this.currentRepoRefreshState;
		if (refreshState.inProgress) {
			if (isRepo) {
				refreshState.repoInfoChanges = refreshState.repoInfoChanges || repoInfoChanges;
				refreshState.requestingRepoInfo = false;
				this.requestLoadCommits();
			} else {
				dialog.closeActionRunning();
				refreshState.inProgress = false;
				this.loadViewTo = null;
				this.renderRefreshButton();
				sendMessage({ command: 'loadRepos', check: true });
			}
		}
	}

	private loadCommits(commits: GG.GitCommit[], commitHead: string | null, tags: ReadonlyArray<string>, moreAvailable: boolean, onlyFollowFirstParent: boolean) {
		// This list of tags is just used to provide additional information in the dialogs. Tag information included in commits is used for all other purposes (e.g. rendering, context menus)
		const tagsChanged = !arraysStrictlyEqual(this.gitTags, tags);
		this.gitTags = tags;

		if (!this.currentRepoLoading && !this.currentRepoRefreshState.hard && this.moreCommitsAvailable === moreAvailable && this.onlyFollowFirstParent === onlyFollowFirstParent && this.commitHead === commitHead && commits.length > 0 && arraysEqual(this.commits, commits, (a: GG.GitCommit, b: GG.GitCommit) =>
			a.hash === b.hash &&
			arraysStrictlyEqual(a.heads, b.heads) &&
			arraysEqual(a.tags, b.tags, (tagA: GG.GitCommitTag, tagB: GG.GitCommitTag) => tagA.name === tagB.name && tagA.annotated === tagB.annotated) &&
			arraysEqual(a.remotes, b.remotes, (remoteA: GG.GitCommitRemote, remoteB: GG.GitCommitRemote) => remoteA.name === remoteB.name && remoteA.remote === remoteB.remote) &&
			arraysStrictlyEqual(a.parents, b.parents) &&
			((a.stash === null && b.stash === null) || (a.stash !== null && b.stash !== null && a.stash.selector === b.stash.selector))
		) && this.renderedGitBranchHead === this.gitBranchHead) {

			if (this.commits[0].hash === UNCOMMITTED) {
				this.commits[0] = commits[0];
				this.saveState();
				this.renderUncommittedChanges();
				if (this.expandedCommit !== null && this.expandedCommit.commitElem !== null) {
					if (this.expandedCommit.compareWithHash === null) {
						// Commit Details View is open
						if (this.expandedCommit.commitHash === UNCOMMITTED) {
							this.requestCommitDetails(this.expandedCommit.commitHash, true);
						}
					} else {
						// Commit Comparison is open
						if (this.expandedCommit.compareWithElem !== null && (this.expandedCommit.commitHash === UNCOMMITTED || this.expandedCommit.compareWithHash === UNCOMMITTED)) {
							this.requestCommitComparison(this.expandedCommit.commitHash, this.expandedCommit.compareWithHash, true);
						}
					}
				}
			} else if (tagsChanged) {
				this.saveState();
			}
			this.finaliseLoadCommits();
			return;
		}

		const currentRepoLoading = this.currentRepoLoading;
		this.currentRepoLoading = false;
		this.moreCommitsAvailable = moreAvailable;
		this.onlyFollowFirstParent = onlyFollowFirstParent;
		this.commits = commits;
		this.commitHead = commitHead;
		this.commitLookup = {};

		let i: number, expandedCommitVisible = false, expandedCompareWithCommitVisible = false, avatarsNeeded: { [email: string]: string[] } = {}, commit;
		for (i = 0; i < this.commits.length; i++) {
			commit = this.commits[i];
			this.commitLookup[commit.hash] = i;
			if (this.expandedCommit !== null) {
				if (this.expandedCommit.commitHash === commit.hash) {
					expandedCommitVisible = true;
				} else if (this.expandedCommit.compareWithHash === commit.hash) {
					expandedCompareWithCommitVisible = true;
				}
			}
			if (this.config.fetchAvatars && typeof this.avatars[commit.email] !== 'string' && commit.email !== '') {
				if (typeof avatarsNeeded[commit.email] === 'undefined') {
					avatarsNeeded[commit.email] = [commit.hash];
				} else {
					avatarsNeeded[commit.email].push(commit.hash);
				}
			}
		}

		if (this.expandedCommit !== null && (!expandedCommitVisible || (this.expandedCommit.compareWithHash !== null && !expandedCompareWithCommitVisible))) {
			this.closeCommitDetails(false);
		}

		this.saveState();

		this.graph.loadCommits(this.commits, this.commitHead, this.commitLookup, this.onlyFollowFirstParent);
		this.render();

		if (currentRepoLoading && this.config.onRepoLoad.scrollToHead && this.commitHead !== null) {
			this.scrollToCommit(this.commitHead, true);
		}

		this.finaliseLoadCommits();
		this.requestAvatars(avatarsNeeded);
	}

	private finaliseLoadCommits() {
		const refreshState = this.currentRepoRefreshState;
		if (refreshState.inProgress) {
			dialog.closeActionRunning();

			if (dialog.isTargetDynamicSource()) {
				if (refreshState.repoInfoChanges) {
					dialog.close();
				} else {
					dialog.refresh(this.getCommits());
				}
			}

			if (contextMenu.isTargetDynamicSource()) {
				if (refreshState.repoInfoChanges) {
					contextMenu.close();
				} else {
					contextMenu.refresh(this.getCommits());
				}
			}

			refreshState.inProgress = false;
			this.renderRefreshButton();
		}

		this.finaliseRepoLoad(true);
	}

	private finaliseRepoLoad(didLoadRepoData: boolean) {
		if (this.loadViewTo !== null && this.currentRepo === this.loadViewTo.repo) {
			if (this.loadViewTo.commitDetails && (this.expandedCommit === null || this.expandedCommit.commitHash !== this.loadViewTo.commitDetails.commitHash || this.expandedCommit.compareWithHash !== this.loadViewTo.commitDetails.compareWithHash)) {
				const commitIndex = this.getCommitId(this.loadViewTo.commitDetails.commitHash);
				const compareWithIndex = this.loadViewTo.commitDetails.compareWithHash !== null ? this.getCommitId(this.loadViewTo.commitDetails.compareWithHash) : null;
				const commitElems = getCommitElems();
				const commitElem = findCommitElemWithId(commitElems, commitIndex);
				const compareWithElem = findCommitElemWithId(commitElems, compareWithIndex);

				if (commitElem !== null && (this.loadViewTo.commitDetails.compareWithHash === null || compareWithElem !== null)) {
					if (compareWithElem !== null) {
						this.loadCommitComparison(commitElem, compareWithElem);
					} else {
						this.loadCommitDetails(commitElem);
					}
				} else {
					showErrorMessage('Unable to resume Code Review, it could not be found in the latest ' + this.maxCommits + ' commits that were loaded in this repository.');
				}
			} else if (this.loadViewTo.runCommandOnLoad) {
				switch (this.loadViewTo.runCommandOnLoad) {
					case 'fetch':
						this.fetchFromRemotesAction();
						break;
				}
			}
		}
		this.loadViewTo = null;

		if (this.gitConfig === null || (didLoadRepoData && this.currentRepoRefreshState.configChanges)) {
			this.requestLoadConfig();
		}
	}

	private clearCommits() {
		closeDialogAndContextMenu();
		this.moreCommitsAvailable = false;
		this.commits = [];
		this.commitHead = null;
		this.commitLookup = {};
		this.renderedGitBranchHead = null;
		this.closeCommitDetails(false);
		this.saveState();
		this.graph.loadCommits(this.commits, this.commitHead, this.commitLookup, this.onlyFollowFirstParent);
		this.tableElem.innerHTML = '';
		this.footerElem.innerHTML = '';
		this.renderGraph();
		this.findWidget.refresh();
	}

	public processLoadRepoInfoResponse(msg: GG.ResponseLoadRepoInfo) {
		if (msg.error === null) {
			const refreshState = this.currentRepoRefreshState;
			if (refreshState.inProgress && refreshState.loadRepoInfoRefreshId === msg.refreshId) {
				this.loadRepoInfo(msg.branches, msg.head, msg.remotes, msg.stashes, msg.isRepo);
			}
		} else {
			this.displayLoadDataError('Unable to load Repository Info', msg.error);
		}
	}

	public processLoadCommitsResponse(msg: GG.ResponseLoadCommits) {
		if (msg.error === null) {
			const refreshState = this.currentRepoRefreshState;
			if (refreshState.inProgress && refreshState.loadCommitsRefreshId === msg.refreshId) {
				this.loadCommits(msg.commits, msg.head, msg.tags, msg.moreCommitsAvailable, msg.onlyFollowFirstParent);
			}
		} else {
			const error = this.gitBranches.length === 0 && msg.error.indexOf('bad revision \'HEAD\'') > -1
				? 'There are no commits in this repository.'
				: msg.error;
			this.displayLoadDataError('Unable to load Commits', error);
		}
	}

	public processLoadConfig(msg: GG.ResponseLoadConfig) {
		this.currentRepoRefreshState.requestingConfig = false;
		if (msg.config !== null && this.currentRepo === msg.repo) {
			this.gitConfig = msg.config;
			this.saveState();

			this.renderCdvExternalDiffBtn();
		}
		this.settingsWidget.refresh();
	}

	private displayLoadDataError(message: string, reason: string) {
		this.clearCommits();
		this.currentRepoRefreshState.inProgress = false;
		this.loadViewTo = null;
		this.renderRefreshButton();
		dialog.showError(message, reason, 'Retry', () => {
			this.refresh(true);
		});
	}

	public loadAvatar(email: string, image: string) {
		this.avatars[email] = image;
		this.saveState();
		let avatarsElems = <HTMLCollectionOf<HTMLElement>>document.getElementsByClassName('avatar'), escapedEmail = escapeHtml(email);
		for (let i = 0; i < avatarsElems.length; i++) {
			if (avatarsElems[i].dataset.email === escapedEmail) {
				avatarsElems[i].innerHTML = '<img class="avatarImg" src="' + image + '">';
			}
		}
	}


	/* Getters */

	public getBranches(): ReadonlyArray<string> {
		return this.gitBranches;
	}

	public getBranchOptions(includeShowAll?: boolean): ReadonlyArray<DialogSelectInputOption> {
		const options: DialogSelectInputOption[] = [];
		if (includeShowAll) {
			options.push({ name: 'Show All', value: SHOW_ALL_BRANCHES });
		}
		for (let i = 0; i < this.config.customBranchGlobPatterns.length; i++) {
			options.push({ name: 'Glob: ' + this.config.customBranchGlobPatterns[i].name, value: this.config.customBranchGlobPatterns[i].glob });
		}
		for (let i = 0; i < this.gitBranches.length; i++) {
			options.push({ name: this.gitBranches[i].indexOf('remotes/') === 0 ? this.gitBranches[i].substring(8) : this.gitBranches[i], value: this.gitBranches[i] });
		}
		return options;
	}

	public getCommitId(hash: string) {
		return typeof this.commitLookup[hash] === 'number' ? this.commitLookup[hash] : null;
	}

	private getCommitOfElem(elem: HTMLElement) {
		let id = parseInt(elem.dataset.id!);
		return id < this.commits.length ? this.commits[id] : null;
	}

	public getCommits(): ReadonlyArray<GG.GitCommit> {
		return this.commits;
	}

	private getPushRemote(branch: string | null = null) {
		const possibleRemotes = [];
		if (this.gitConfig !== null) {
			if (branch !== null && typeof this.gitConfig.branches[branch] !== 'undefined') {
				possibleRemotes.push(this.gitConfig.branches[branch].pushRemote, this.gitConfig.branches[branch].remote);
			}
			possibleRemotes.push(this.gitConfig.pushDefault);
		}
		possibleRemotes.push('origin');
		return possibleRemotes.find((remote) => remote !== null && this.gitRemotes.includes(remote)) || this.gitRemotes[0];
	}

	public getRepoConfig(): Readonly<GG.GitRepoConfig> | null {
		return this.gitConfig;
	}

	public getRepoState(repo: string): Readonly<GG.GitRepoState> | null {
		return typeof this.gitRepos[repo] !== 'undefined'
			? this.gitRepos[repo]
			: null;
	}

	public isConfigLoading(): boolean {
		return this.currentRepoRefreshState.requestingConfig;
	}


	/* Refresh */

	public refresh(hard: boolean, configChanges: boolean = false) {
		if (hard) {
			this.clearCommits();
		}
		this.requestLoadRepoInfoAndCommits(hard, false, configChanges);
	}


	/* Requests */

	private requestLoadRepoInfo() {
		const repoState = this.gitRepos[this.currentRepo];
		sendMessage({
			command: 'loadRepoInfo',
			repo: this.currentRepo,
			refreshId: ++this.currentRepoRefreshState.loadRepoInfoRefreshId,
			showRemoteBranches: getShowRemoteBranches(repoState.showRemoteBranchesV2),
			showStashes: getShowStashes(repoState.showStashes),
			hideRemotes: repoState.hideRemotes
		});
	}

	private requestLoadCommits() {
		const repoState = this.gitRepos[this.currentRepo];
		sendMessage({
			command: 'loadCommits',
			repo: this.currentRepo,
			refreshId: ++this.currentRepoRefreshState.loadCommitsRefreshId,
			branches: this.currentBranches === null || (this.currentBranches.length === 1 && this.currentBranches[0] === SHOW_ALL_BRANCHES) ? null : this.currentBranches,
			maxCommits: this.maxCommits,
			showTags: getShowTags(repoState.showTags),
			showRemoteBranches: getShowRemoteBranches(repoState.showRemoteBranchesV2),
			includeCommitsMentionedByReflogs: getIncludeCommitsMentionedByReflogs(repoState.includeCommitsMentionedByReflogs),
			onlyFollowFirstParent: getOnlyFollowFirstParent(repoState.onlyFollowFirstParent),
			commitOrdering: getCommitOrdering(repoState.commitOrdering),
			remotes: this.gitRemotes,
			hideRemotes: repoState.hideRemotes,
			stashes: this.gitStashes
		});
	}

	private requestLoadRepoInfoAndCommits(hard: boolean, skipRepoInfo: boolean, configChanges: boolean = false) {
		const refreshState = this.currentRepoRefreshState;
		if (refreshState.inProgress) {
			refreshState.hard = refreshState.hard || hard;
			refreshState.configChanges = refreshState.configChanges || configChanges;
			if (!skipRepoInfo) {
				// This request will trigger a loadCommit request after the loadRepoInfo request has completed.
				// Invalidate any previous commit requests in progress.
				refreshState.loadCommitsRefreshId++;
			}
		} else {
			refreshState.hard = hard;
			refreshState.inProgress = true;
			refreshState.repoInfoChanges = false;
			refreshState.configChanges = configChanges;
			refreshState.requestingRepoInfo = false;
		}

		this.renderRefreshButton();
		if (this.commits.length === 0) {
			this.tableElem.innerHTML = '<h2 id="loadingHeader">' + SVG_ICONS.loading + 'Loading ...</h2>';
		}

		if (skipRepoInfo) {
			if (!refreshState.requestingRepoInfo) {
				this.requestLoadCommits();
			}
		} else {
			refreshState.requestingRepoInfo = true;
			this.requestLoadRepoInfo();
		}
	}

	public requestLoadConfig() {
		this.currentRepoRefreshState.requestingConfig = true;
		sendMessage({ command: 'loadConfig', repo: this.currentRepo, remotes: this.gitRemotes });
		this.settingsWidget.refresh();
	}

	public requestCommitDetails(hash: string, refresh: boolean) {
		let commit = this.commits[this.commitLookup[hash]];
		sendMessage({
			command: 'commitDetails',
			repo: this.currentRepo,
			commitHash: hash,
			hasParents: commit.parents.length > 0,
			stash: commit.stash,
			avatarEmail: this.config.fetchAvatars && hash !== UNCOMMITTED ? commit.email : null,
			refresh: refresh
		});
	}

	public requestCommitComparison(hash: string, compareWithHash: string, refresh: boolean) {
		let commitOrder = this.getCommitOrder(hash, compareWithHash);
		sendMessage({
			command: 'compareCommits',
			repo: this.currentRepo,
			commitHash: hash, compareWithHash: compareWithHash,
			fromHash: commitOrder.from, toHash: commitOrder.to,
			refresh: refresh
		});
	}

	private requestAvatars(avatars: { [email: string]: string[] }) {
		let emails = Object.keys(avatars), remote = this.gitRemotes.length > 0 ? this.gitRemotes.includes('origin') ? 'origin' : this.gitRemotes[0] : null;
		for (let i = 0; i < emails.length; i++) {
			sendMessage({ command: 'fetchAvatar', repo: this.currentRepo, remote: remote, email: emails[i], commits: avatars[emails[i]] });
		}
	}


	/* State */

	public saveState() {
		let expandedCommit;
		if (this.expandedCommit !== null) {
			expandedCommit = Object.assign({}, this.expandedCommit);
			expandedCommit.commitElem = null;
			expandedCommit.compareWithElem = null;
			expandedCommit.contextMenuOpen = {
				summary: false,
				fileView: -1
			};
		} else {
			expandedCommit = null;
		}

		VSCODE_API.setState({
			currentRepo: this.currentRepo,
			currentRepoLoading: this.currentRepoLoading,
			gitRepos: this.gitRepos,
			gitBranches: this.gitBranches,
			gitBranchHead: this.gitBranchHead,
			gitConfig: this.gitConfig,
			gitRemotes: this.gitRemotes,
			gitStashes: this.gitStashes,
			gitTags: this.gitTags,
			commits: this.commits,
			commitHead: this.commitHead,
			avatars: this.avatars,
			currentBranches: this.currentBranches,
			moreCommitsAvailable: this.moreCommitsAvailable,
			maxCommits: this.maxCommits,
			onlyFollowFirstParent: this.onlyFollowFirstParent,
			expandedCommit: expandedCommit,
			scrollTop: this.scrollTop,
			findWidget: this.findWidget.getState(),
			settingsWidget: this.settingsWidget.getState()
		});
	}

	public saveRepoState() {
		sendMessage({ command: 'setRepoState', repo: this.currentRepo, state: this.gitRepos[this.currentRepo] });
	}

	private saveColumnWidths(columnWidths: GG.ColumnWidth[]) {
		this.gitRepos[this.currentRepo].columnWidths = [columnWidths[0], columnWidths[2], columnWidths[3], columnWidths[4]];
		this.saveRepoState();
	}

	private saveExpandedCommitLoading(index: number, commitHash: string, commitElem: HTMLElement, compareWithHash: string | null, compareWithElem: HTMLElement | null) {
		this.expandedCommit = {
			index: index,
			commitHash: commitHash,
			commitElem: commitElem,
			compareWithHash: compareWithHash,
			compareWithElem: compareWithElem,
			commitDetails: null,
			fileChanges: null,
			fileTree: null,
			avatar: null,
			codeReview: null,
			lastViewedFile: null,
			loading: true,
			aiAnalysis: null, // Ensure aiAnalysis is initialized
			scrollTop: {
				summary: 0,
				fileView: 0,
				aiView: 0
			},
			contextMenuOpen: {
				summary: false,
				fileView: -1
			}
		};
		this.saveState();
	}

	public saveRepoStateValue<K extends keyof GG.GitRepoState>(repo: string, key: K, value: GG.GitRepoState[K]) {
		if (repo === this.currentRepo) {
			this.gitRepos[this.currentRepo][key] = value;
			this.saveRepoState();
		}
	}


	/* Renderers */

	private render() {
		this.renderTable();
		this.renderGraph();
	}

	private renderGraph() {
		if (typeof this.currentRepo === 'undefined') {
			// Only render the graph if a repo is loaded (or a repo is currently being loaded)
			return;
		}

		const colHeadersElem = document.getElementById('tableColHeaders');
		const cdvHeight = this.gitRepos[this.currentRepo].cdvHeight;
		const headerHeight = colHeadersElem !== null ? colHeadersElem.clientHeight + 1 : 0;
		const expandedCommit = this.isCdvDocked() ? null : this.expandedCommit;
		const expandedCommitElem = expandedCommit !== null ? document.getElementById('cdv') : null;

		// Update the graphs grid dimensions
		this.config.graph.grid.expandY = expandedCommitElem !== null
			? expandedCommitElem.getBoundingClientRect().height
			: cdvHeight;
		this.config.graph.grid.y = this.commits.length > 0 && this.tableElem.children.length > 0
			? (this.tableElem.children[0].clientHeight - headerHeight - (expandedCommit !== null ? cdvHeight : 0)) / this.commits.length
			: this.config.graph.grid.y;
		this.config.graph.grid.offsetY = headerHeight + this.config.graph.grid.y / 2;

		this.graph.render(expandedCommit);
	}

	private renderTable() {
		const colVisibility = this.getColumnVisibility();
		const currentHash = this.commits.length > 0 && this.commits[0].hash === UNCOMMITTED ? UNCOMMITTED : this.commitHead;
		const vertexColours = this.graph.getVertexColours();
		const widthsAtVertices = this.config.referenceLabels.branchLabelsAlignedToGraph ? this.graph.getWidthsAtVertices() : [];
		const mutedCommits = this.graph.getMutedCommits(currentHash);
		const textFormatter = new TextFormatter(this.commits, this.gitRepos[this.currentRepo].issueLinkingConfig, {
			emoji: true,
			issueLinking: true,
			markdown: this.config.markdown
		});

		let html = '<tr id="tableColHeaders"><th id="tableHeaderGraphCol" class="tableColHeader" data-col="0">Graph</th><th class="tableColHeader" data-col="1">Description</th>' +
			(colVisibility.date ? '<th class="tableColHeader dateCol" data-col="2">Date</th>' : '') +
			(colVisibility.author ? '<th class="tableColHeader authorCol" data-col="3">Author</th>' : '') +
			(colVisibility.commit ? '<th class="tableColHeader" data-col="4">Commit</th>' : '') +
			'</tr>';

		for (let i = 0; i < this.commits.length; i++) {
			let commit = this.commits[i];
			let message = '<span class="text">' + textFormatter.format(commit.message) + '</span>';
			let date = formatShortDate(commit.date);
			let branchLabels = getBranchLabels(commit.heads, commit.remotes);
			let refBranches = '', refTags = '', j, k, refName, remoteName, refActive, refHtml, branchCheckedOutAtCommit: string | null = null;

			for (j = 0; j < branchLabels.heads.length; j++) {
				refName = escapeHtml(branchLabels.heads[j].name);
				refActive = branchLabels.heads[j].name === this.gitBranchHead;
				refHtml = '<span class="gitRef head' + (refActive ? ' active' : '') + '" data-name="' + refName + '">' + SVG_ICONS.branch + '<span class="gitRefName" data-fullref="' + refName + '">' + refName + '</span>';
				for (k = 0; k < branchLabels.heads[j].remotes.length; k++) {
					remoteName = escapeHtml(branchLabels.heads[j].remotes[k]);
					refHtml += '<span class="gitRefHeadRemote" data-remote="' + remoteName + '" data-fullref="' + escapeHtml(branchLabels.heads[j].remotes[k] + '/' + branchLabels.heads[j].name) + '">' + remoteName + '</span>';
				}
				refHtml += '</span>';
				refBranches = refActive ? refHtml + refBranches : refBranches + refHtml;
				if (refActive) branchCheckedOutAtCommit = this.gitBranchHead;
			}
			for (j = 0; j < branchLabels.remotes.length; j++) {
				refName = escapeHtml(branchLabels.remotes[j].name);
				refBranches += '<span class="gitRef remote" data-name="' + refName + '" data-remote="' + (branchLabels.remotes[j].remote !== null ? escapeHtml(branchLabels.remotes[j].remote!) : '') + '">' + SVG_ICONS.branch + '<span class="gitRefName" data-fullref="' + refName + '">' + refName + '</span></span>';
			}

			for (j = 0; j < commit.tags.length; j++) {
				refName = escapeHtml(commit.tags[j].name);
				refTags += '<span class="gitRef tag" data-name="' + refName + '" data-tagtype="' + (commit.tags[j].annotated ? 'annotated' : 'lightweight') + '">' + SVG_ICONS.tag + '<span class="gitRefName" data-fullref="' + refName + '">' + refName + '</span></span>';
			}

			if (commit.stash !== null) {
				refName = escapeHtml(commit.stash.selector);
				refBranches = '<span class="gitRef stash" data-name="' + refName + '">' + SVG_ICONS.stash + '<span class="gitRefName" data-fullref="' + refName + '">' + escapeHtml(commit.stash.selector.substring(5)) + '</span></span>' + refBranches;
			}

			const commitDot = commit.hash === this.commitHead
				? '<span class="commitHeadDot" title="' + (branchCheckedOutAtCommit !== null
					? 'The branch ' + escapeHtml('"' + branchCheckedOutAtCommit + '"') + ' is currently checked out at this commit'
					: 'This commit is currently checked out'
				) + '."></span>'
				: '';

			html += '<tr class="commit' + (commit.hash === currentHash ? ' current' : '') + (mutedCommits[i] ? ' mute' : '') + '"' + (commit.hash !== UNCOMMITTED ? '' : ' id="uncommittedChanges"') + ' data-id="' + i + '" data-color="' + vertexColours[i] + '">' +
				(this.config.referenceLabels.branchLabelsAlignedToGraph ? '<td>' + (refBranches !== '' ? '<span style="margin-left:' + (widthsAtVertices[i] - 4) + 'px"' + refBranches.substring(5) : '') + '</td><td><span class="description">' + commitDot : '<td></td><td><span class="description">' + commitDot + refBranches) + (this.config.referenceLabels.tagLabelsOnRight ? message + refTags : refTags + message) + '</span></td>' +
				(colVisibility.date ? '<td class="dateCol text" title="' + date.title + '">' + date.formatted + '</td>' : '') +
				(colVisibility.author ? '<td class="authorCol text" title="' + escapeHtml(commit.author + ' <' + commit.email + '>') + '">' + (this.config.fetchAvatars ? '<span class="avatar" data-email="' + escapeHtml(commit.email) + '">' + (typeof this.avatars[commit.email] === 'string' ? '<img class="avatarImg" src="' + this.avatars[commit.email] + '">' : '') + '</span>' : '') + escapeHtml(commit.author) + '</td>' : '') +
				(colVisibility.commit ? '<td class="text" title="' + escapeHtml(commit.hash) + '">' + abbrevCommit(commit.hash) + '</td>' : '') +
				'</tr>';
		}
		this.tableElem.innerHTML = '<table>' + html + '</table>';
		this.footerElem.innerHTML = this.moreCommitsAvailable ? '<div id="loadMoreCommitsBtn" class="roundedBtn">Load More Commits</div>' : '';
		this.makeTableResizable();
		this.findWidget.refresh();
		this.renderedGitBranchHead = this.gitBranchHead;

		if (this.moreCommitsAvailable) {
			document.getElementById('loadMoreCommitsBtn')!.addEventListener('click', () => {
				this.loadMoreCommits();
			});
		}

		if (this.expandedCommit !== null) {
			const expandedCommit = this.expandedCommit, elems = getCommitElems();
			const commitElem = findCommitElemWithId(elems, this.getCommitId(expandedCommit.commitHash));
			const compareWithElem = expandedCommit.compareWithHash !== null ? findCommitElemWithId(elems, this.getCommitId(expandedCommit.compareWithHash)) : null;

			if (commitElem === null || (expandedCommit.compareWithHash !== null && compareWithElem === null)) {
				this.closeCommitDetails(false);
				this.saveState();
			} else {
				expandedCommit.index = parseInt(commitElem.dataset.id!);
				expandedCommit.commitElem = commitElem;
				expandedCommit.compareWithElem = compareWithElem;
				this.saveState();
				if (expandedCommit.compareWithHash === null) {
					// Commit Details View is open
					if (!expandedCommit.loading && expandedCommit.commitDetails !== null && expandedCommit.fileTree !== null) {
						this.showCommitDetails(expandedCommit.commitDetails, expandedCommit.fileTree, expandedCommit.avatar, expandedCommit.codeReview, expandedCommit.lastViewedFile, true);
						if (expandedCommit.commitHash === UNCOMMITTED) {
							this.requestCommitDetails(expandedCommit.commitHash, true);
						}
					} else {
						this.loadCommitDetails(commitElem);
					}
				} else {
					// Commit Comparison is open
					if (!expandedCommit.loading && expandedCommit.fileChanges !== null && expandedCommit.fileTree !== null) {
						this.showCommitComparison(expandedCommit.commitHash, expandedCommit.compareWithHash, expandedCommit.fileChanges, expandedCommit.fileTree, expandedCommit.codeReview, expandedCommit.lastViewedFile, true, expandedCommit.aiAnalysis);
						if (expandedCommit.commitHash === UNCOMMITTED || expandedCommit.compareWithHash === UNCOMMITTED) {
							this.requestCommitComparison(expandedCommit.commitHash, expandedCommit.compareWithHash, true);
						}
					} else {
						this.loadCommitComparison(commitElem, compareWithElem!);
					}
				}
			}
		}
	}

	private renderUncommittedChanges() {
		const colVisibility = this.getColumnVisibility(), date = formatShortDate(this.commits[0].date);
		document.getElementById('uncommittedChanges')!.innerHTML = '<td></td><td><b>' + escapeHtml(this.commits[0].message) + '</b></td>' +
			(colVisibility.date ? '<td class="dateCol text" title="' + date.title + '">' + date.formatted + '</td>' : '') +
			(colVisibility.author ? '<td class="authorCol text" title="* <>">*</td>' : '') +
			(colVisibility.commit ? '<td class="text" title="*">*</td>' : '');
	}

	private renderFetchButton() {
		alterClass(this.controlsElem, CLASS_FETCH_SUPPORTED, this.gitRemotes.length > 0);
	}

	public renderRefreshButton() {
		const enabled = !this.currentRepoRefreshState.inProgress;
		this.refreshBtnElem.title = enabled ? 'Refresh' : 'Refreshing';
		this.refreshBtnElem.innerHTML = enabled ? SVG_ICONS.refresh : SVG_ICONS.loading;
		alterClass(this.refreshBtnElem, CLASS_REFRESHING, !enabled);
	}

	public renderTagDetails(tagName: string, commitHash: string, details: GG.GitTagDetails) {
		const textFormatter = new TextFormatter(this.commits, this.gitRepos[this.currentRepo].issueLinkingConfig, {
			commits: true,
			emoji: true,
			issueLinking: true,
			markdown: this.config.markdown,
			multiline: true,
			urls: true
		});
		dialog.showMessage(
			'Tag <b><i>' + escapeHtml(tagName) + '</i></b><br><span class="messageContent">' +
			'<b>Object: </b>' + escapeHtml(details.hash) + '<br>' +
			'<b>Commit: </b>' + escapeHtml(commitHash) + '<br>' +
			'<b>Tagger: </b>' + escapeHtml(details.taggerName) + ' &lt;<a class="' + CLASS_EXTERNAL_URL + '" href="mailto:' + escapeHtml(details.taggerEmail) + '" tabindex="-1">' + escapeHtml(details.taggerEmail) + '</a>&gt;' + (details.signature !== null ? generateSignatureHtml(details.signature) : '') + '<br>' +
			'<b>Date: </b>' + formatLongDate(details.taggerDate) + '<br><br>' +
			textFormatter.format(details.message) +
			'</span>'
		);
	}

	public renderRepoDropdownOptions(repo?: string) {
		this.repoDropdown.setOptions(getRepoDropdownOptions(this.gitRepos), [repo || this.currentRepo]);
	}


	/* Context Menu Generation */

	private getBranchContextMenuActions(target: DialogTarget & RefTarget): ContextMenuActions {
		const refName = target.ref, visibility = this.config.contextMenuActionsVisibility.branch;
		const isSelectedInBranchesDropdown = this.branchDropdown.isSelected(refName);
		return [[
			{
				title: 'Checkout Branch',
				visible: visibility.checkout && this.gitBranchHead !== refName,
				onClick: () => this.checkoutBranchAction(refName, null, null, target)
			}, {
				title: 'Rename Branch' + ELLIPSIS,
				visible: visibility.rename,
				onClick: () => {
					dialog.showRefInput('Enter the new name for branch <b><i>' + escapeHtml(refName) + '</i></b>:', refName, 'Rename Branch', (newName) => {
						runAction({ command: 'renameBranch', repo: this.currentRepo, oldName: refName, newName: newName }, 'Renaming Branch');
					}, target);
				}
			}, {
				title: 'Delete Branch' + ELLIPSIS,
				visible: visibility.delete && this.gitBranchHead !== refName,
				onClick: () => {
					let remotesWithBranch = this.gitRemotes.filter(remote => this.gitBranches.includes('remotes/' + remote + '/' + refName));
					let inputs: DialogInput[] = [{ type: DialogInputType.Checkbox, name: 'Force Delete', value: this.config.dialogDefaults.deleteBranch.forceDelete }];
					if (remotesWithBranch.length > 0) {
						inputs.push({
							type: DialogInputType.Checkbox,
							name: 'Delete this branch on the remote' + (this.gitRemotes.length > 1 ? 's' : ''),
							value: false,
							info: 'This branch is on the remote' + (remotesWithBranch.length > 1 ? 's: ' : ' ') + formatCommaSeparatedList(remotesWithBranch.map((remote) => '"' + remote + '"'))
						});
					}
					dialog.showForm('Are you sure you want to delete the branch <b><i>' + escapeHtml(refName) + '</i></b>?', inputs, 'Yes, delete', (values) => {
						runAction({ command: 'deleteBranch', repo: this.currentRepo, branchName: refName, forceDelete: <boolean>values[0], deleteOnRemotes: remotesWithBranch.length > 0 && <boolean>values[1] ? remotesWithBranch : [] }, 'Deleting Branch');
					}, target);
				}
			}, {
				title: 'Merge into current branch' + ELLIPSIS,
				visible: visibility.merge && this.gitBranchHead !== refName,
				onClick: () => this.mergeAction(refName, refName, GG.MergeActionOn.Branch, target)
			}, {
				title: 'Rebase current branch on Branch' + ELLIPSIS,
				visible: visibility.rebase && this.gitBranchHead !== refName,
				onClick: () => this.rebaseAction(refName, refName, GG.RebaseActionOn.Branch, target)
			}, {
				title: 'Push Branch' + ELLIPSIS,
				visible: visibility.push && this.gitRemotes.length > 0,
				onClick: () => {
					const multipleRemotes = this.gitRemotes.length > 1;
					const inputs: DialogInput[] = [
						{ type: DialogInputType.Checkbox, name: 'Set Upstream', value: true },
						{
							type: DialogInputType.Radio,
							name: 'Push Mode',
							options: [
								{ name: 'Normal', value: GG.GitPushBranchMode.Normal },
								{ name: 'Force With Lease', value: GG.GitPushBranchMode.ForceWithLease },
								{ name: 'Force', value: GG.GitPushBranchMode.Force }
							],
							default: GG.GitPushBranchMode.Normal
						}
					];

					if (multipleRemotes) {
						inputs.unshift({
							type: DialogInputType.Select,
							name: 'Push to Remote(s)',
							defaults: [this.getPushRemote(refName)],
							options: this.gitRemotes.map((remote) => ({ name: remote, value: remote })),
							multiple: true
						});
					}

					dialog.showForm('Are you sure you want to push the branch <b><i>' + escapeHtml(refName) + '</i></b>' + (multipleRemotes ? '' : ' to the remote <b><i>' + escapeHtml(this.gitRemotes[0]) + '</i></b>') + '?', inputs, 'Yes, push', (values) => {
						const remotes = multipleRemotes ? <string[]>values.shift() : [this.gitRemotes[0]];
						const setUpstream = <boolean>values[0];
						runAction({
							command: 'pushBranch',
							repo: this.currentRepo,
							branchName: refName,
							remotes: remotes,
							setUpstream: setUpstream,
							mode: <GG.GitPushBranchMode>values[1],
							willUpdateBranchConfig: setUpstream && remotes.length > 0 && (this.gitConfig === null || typeof this.gitConfig.branches[refName] === 'undefined' || this.gitConfig.branches[refName].remote !== remotes[remotes.length - 1])
						}, 'Pushing Branch');
					}, target);
				}
			}
		], [
			this.getViewIssueAction(refName, visibility.viewIssue, target),
			{
				title: 'Create Pull Request' + ELLIPSIS,
				visible: visibility.createPullRequest && this.gitRepos[this.currentRepo].pullRequestConfig !== null,
				onClick: () => {
					const config = this.gitRepos[this.currentRepo].pullRequestConfig;
					if (config === null) return;
					dialog.showCheckbox('Are you sure you want to create a Pull Request for branch <b><i>' + escapeHtml(refName) + '</i></b>?', 'Push branch before creating the Pull Request', true, 'Yes, create Pull Request', (push) => {
						runAction({ command: 'createPullRequest', repo: this.currentRepo, config: config, sourceRemote: config.sourceRemote, sourceOwner: config.sourceOwner, sourceRepo: config.sourceRepo, sourceBranch: refName, push: push }, 'Creating Pull Request');
					}, target);
				}
			}
		], [
			{
				title: 'Create Archive',
				visible: visibility.createArchive,
				onClick: () => {
					runAction({ command: 'createArchive', repo: this.currentRepo, ref: refName }, 'Creating Archive');
				}
			},
			{
				title: 'Select in Branches Dropdown',
				visible: visibility.selectInBranchesDropdown && !isSelectedInBranchesDropdown,
				onClick: () => this.branchDropdown.selectOption(refName)
			},
			{
				title: 'Unselect in Branches Dropdown',
				visible: visibility.unselectInBranchesDropdown && isSelectedInBranchesDropdown,
				onClick: () => this.branchDropdown.unselectOption(refName)
			}
		], [
			{
				title: 'Copy Branch Name to Clipboard',
				visible: visibility.copyName,
				onClick: () => {
					sendMessage({ command: 'copyToClipboard', type: 'Branch Name', data: refName });
				}
			}
		]];
	}

	private getCommitContextMenuActions(target: DialogTarget & CommitTarget): ContextMenuActions {
		const hash = target.hash, visibility = this.config.contextMenuActionsVisibility.commit;
		const commit = this.commits[this.commitLookup[hash]];
		return [[
			{
				title: 'Add Tag' + ELLIPSIS,
				visible: visibility.addTag,
				onClick: () => this.addTagAction(hash, '', this.config.dialogDefaults.addTag.type, '', null, target)
			}, {
				title: 'Create Branch' + ELLIPSIS,
				visible: visibility.createBranch,
				onClick: () => this.createBranchAction(hash, '', this.config.dialogDefaults.createBranch.checkout, target)
			}
		], [
			{
				title: 'Checkout' + (globalState.alwaysAcceptCheckoutCommit ? '' : ELLIPSIS),
				visible: visibility.checkout,
				onClick: () => {
					const checkoutCommit = () => runAction({ command: 'checkoutCommit', repo: this.currentRepo, commitHash: hash }, 'Checking out Commit');
					if (globalState.alwaysAcceptCheckoutCommit) {
						checkoutCommit();
					} else {
						dialog.showCheckbox('Are you sure you want to checkout commit <b><i>' + abbrevCommit(hash) + '</i></b>? This will result in a \'detached HEAD\' state.', 'Always Accept', false, 'Yes, checkout', (alwaysAccept) => {
							if (alwaysAccept) {
								updateGlobalViewState('alwaysAcceptCheckoutCommit', true);
							}
							checkoutCommit();
						}, target);
					}
				}
			}, {
				title: 'Cherry Pick' + ELLIPSIS,
				visible: visibility.cherrypick,
				onClick: () => {
					const isMerge = commit.parents.length > 1;
					let inputs: DialogInput[] = [];
					if (isMerge) {
						let options = commit.parents.map((hash: string, index: number) => ({
							name: abbrevCommit(hash) + (typeof this.commitLookup[hash] === 'number' ? ': ' + this.commits[this.commitLookup[hash]].message : ''),
							value: (index + 1).toString()
						}));
						inputs.push({
							type: DialogInputType.Select,
							name: 'Parent Hash',
							options: options,
							default: '1',
							info: 'Choose the parent hash on the main branch, to cherry pick the commit relative to.'
						});
					}
					inputs.push({
						type: DialogInputType.Checkbox,
						name: 'Record Origin',
						value: this.config.dialogDefaults.cherryPick.recordOrigin,
						info: 'Record that this commit was the origin of the cherry pick by appending a line to the original commit message that states "(cherry picked from commit ...​)".'
					}, {
						type: DialogInputType.Checkbox,
						name: 'No Commit',
						value: this.config.dialogDefaults.cherryPick.noCommit,
						info: 'Cherry picked changes will be staged but not committed, so that you can select and commit specific parts of this commit.'
					});

					dialog.showForm('Are you sure you want to cherry pick commit <b><i>' + abbrevCommit(hash) + '</i></b>?', inputs, 'Yes, cherry pick', (values) => {
						let parentIndex = isMerge ? parseInt(<string>values.shift()) : 0;
						runAction({
							command: 'cherrypickCommit',
							repo: this.currentRepo,
							commitHash: hash,
							parentIndex: parentIndex,
							recordOrigin: <boolean>values[0],
							noCommit: <boolean>values[1]
						}, 'Cherry picking Commit');
					}, target);
				}
			}, {
				title: 'Revert' + ELLIPSIS,
				visible: visibility.revert,
				onClick: () => {
					if (commit.parents.length > 1) {
						let options = commit.parents.map((hash: string, index: number) => ({
							name: abbrevCommit(hash) + (typeof this.commitLookup[hash] === 'number' ? ': ' + this.commits[this.commitLookup[hash]].message : ''),
							value: (index + 1).toString()
						}));
						dialog.showSelect('Are you sure you want to revert merge commit <b><i>' + abbrevCommit(hash) + '</i></b>? Choose the parent hash on the main branch, to revert the commit relative to:', '1', options, 'Yes, revert', (parentIndex) => {
							runAction({ command: 'revertCommit', repo: this.currentRepo, commitHash: hash, parentIndex: parseInt(parentIndex) }, 'Reverting Commit');
						}, target);
					} else {
						dialog.showConfirmation('Are you sure you want to revert commit <b><i>' + abbrevCommit(hash) + '</i></b>?', 'Yes, revert', () => {
							runAction({ command: 'revertCommit', repo: this.currentRepo, commitHash: hash, parentIndex: 0 }, 'Reverting Commit');
						}, target);
					}
				}
			}, {
				title: 'Drop' + ELLIPSIS,
				visible: visibility.drop && this.graph.dropCommitPossible(this.commitLookup[hash]),
				onClick: () => {
					dialog.showConfirmation('Are you sure you want to permanently drop commit <b><i>' + abbrevCommit(hash) + '</i></b>?' + (this.onlyFollowFirstParent ? '<br/><i>Note: By enabling "Only follow the first parent of commits", some commits may have been hidden from the Git Graph View that could affect the outcome of performing this action.</i>' : ''), 'Yes, drop', () => {
						runAction({ command: 'dropCommit', repo: this.currentRepo, commitHash: hash }, 'Dropping Commit');
					}, target);
				}
			}
		], [
			{
				title: 'Merge into current branch' + ELLIPSIS,
				visible: visibility.merge,
				onClick: () => this.mergeAction(hash, abbrevCommit(hash), GG.MergeActionOn.Commit, target)
			}, {
				title: 'Rebase current branch on this Commit' + ELLIPSIS,
				visible: visibility.rebase,
				onClick: () => this.rebaseAction(hash, abbrevCommit(hash), GG.RebaseActionOn.Commit, target)
			}, {
				title: 'Reset current branch to this Commit' + ELLIPSIS,
				visible: visibility.reset,
				onClick: () => {
					dialog.showSelect('Are you sure you want to reset ' + (this.gitBranchHead !== null ? '<b><i>' + escapeHtml(this.gitBranchHead) + '</i></b> (the current branch)' : 'the current branch') + ' to commit <b><i>' + abbrevCommit(hash) + '</i></b>?', this.config.dialogDefaults.resetCommit.mode, [
						{ name: 'Soft - Keep all changes, but reset head', value: GG.GitResetMode.Soft },
						{ name: 'Mixed - Keep working tree, but reset index', value: GG.GitResetMode.Mixed },
						{ name: 'Hard - Discard all changes', value: GG.GitResetMode.Hard }
					], 'Yes, reset', (mode) => {
						runAction({ command: 'resetToCommit', repo: this.currentRepo, commit: hash, resetMode: <GG.GitResetMode>mode }, 'Resetting to Commit');
					}, target);
				}
			}
		], [
			{
				title: 'Copy Commit Hash to Clipboard',
				visible: visibility.copyHash,
				onClick: () => {
					sendMessage({ command: 'copyToClipboard', type: 'Commit Hash', data: hash });
				}
			},
			{
				title: 'Copy Commit Subject to Clipboard',
				visible: visibility.copySubject,
				onClick: () => {
					sendMessage({ command: 'copyToClipboard', type: 'Commit Subject', data: commit.message });
				}
			}
		]];
	}

	private getRemoteBranchContextMenuActions(remote: string, target: DialogTarget & RefTarget): ContextMenuActions {
		const refName = target.ref, visibility = this.config.contextMenuActionsVisibility.remoteBranch;
		const branchName = remote !== '' ? refName.substring(remote.length + 1) : '';
		const prefixedRefName = 'remotes/' + refName;
		const isSelectedInBranchesDropdown = this.branchDropdown.isSelected(prefixedRefName);
		return [[
			{
				title: 'Checkout Branch' + ELLIPSIS,
				visible: visibility.checkout,
				onClick: () => this.checkoutBranchAction(refName, remote, null, target)
			}, {
				title: 'Delete Remote Branch' + ELLIPSIS,
				visible: visibility.delete && remote !== '',
				onClick: () => {
					dialog.showConfirmation('Are you sure you want to delete the remote branch <b><i>' + escapeHtml(refName) + '</i></b>?', 'Yes, delete', () => {
						runAction({ command: 'deleteRemoteBranch', repo: this.currentRepo, branchName: branchName, remote: remote }, 'Deleting Remote Branch');
					}, target);
				}
			}, {
				title: 'Fetch into local branch' + ELLIPSIS,
				visible: visibility.fetch && remote !== '' && this.gitBranches.includes(branchName) && this.gitBranchHead !== branchName,
				onClick: () => {
					dialog.showForm('Are you sure you want to fetch the remote branch <b><i>' + escapeHtml(refName) + '</i></b> into the local branch <b><i>' + escapeHtml(branchName) + '</i></b>?', [{
						type: DialogInputType.Checkbox,
						name: 'Force Fetch',
						value: this.config.dialogDefaults.fetchIntoLocalBranch.forceFetch,
						info: 'Force the local branch to be reset to this remote branch.'
					}], 'Yes, fetch', (values) => {
						runAction({ command: 'fetchIntoLocalBranch', repo: this.currentRepo, remote: remote, remoteBranch: branchName, localBranch: branchName, force: <boolean>values[0] }, 'Fetching Branch');
					}, target);
				}
			}, {
				title: 'Merge into current branch' + ELLIPSIS,
				visible: visibility.merge,
				onClick: () => this.mergeAction(refName, refName, GG.MergeActionOn.RemoteTrackingBranch, target)
			}, {
				title: 'Pull into current branch' + ELLIPSIS,
				visible: visibility.pull && remote !== '',
				onClick: () => {
					dialog.showForm('Are you sure you want to pull the remote branch <b><i>' + escapeHtml(refName) + '</i></b> into ' + (this.gitBranchHead !== null ? '<b><i>' + escapeHtml(this.gitBranchHead) + '</i></b> (the current branch)' : 'the current branch') + '? If a merge is required:', [
						{ type: DialogInputType.Checkbox, name: 'Create a new commit even if fast-forward is possible', value: this.config.dialogDefaults.pullBranch.noFastForward },
						{ type: DialogInputType.Checkbox, name: 'Squash Commits', value: this.config.dialogDefaults.pullBranch.squash, info: 'Create a single commit on the current branch whose effect is the same as merging this remote branch.' }
					], 'Yes, pull', (values) => {
						runAction({ command: 'pullBranch', repo: this.currentRepo, branchName: branchName, remote: remote, createNewCommit: <boolean>values[0], squash: <boolean>values[1] }, 'Pulling Branch');
					}, target);
				}
			}
		], [
			this.getViewIssueAction(refName, visibility.viewIssue, target),
			{
				title: 'Create Pull Request',
				visible: visibility.createPullRequest && this.gitRepos[this.currentRepo].pullRequestConfig !== null && branchName !== 'HEAD' &&
					(this.gitRepos[this.currentRepo].pullRequestConfig!.sourceRemote === remote || this.gitRepos[this.currentRepo].pullRequestConfig!.destRemote === remote),
				onClick: () => {
					const config = this.gitRepos[this.currentRepo].pullRequestConfig;
					if (config === null) return;
					const isDestRemote = config.destRemote === remote;
					runAction({
						command: 'createPullRequest',
						repo: this.currentRepo,
						config: config,
						sourceRemote: isDestRemote ? config.destRemote! : config.sourceRemote,
						sourceOwner: isDestRemote ? config.destOwner : config.sourceOwner,
						sourceRepo: isDestRemote ? config.destRepo : config.sourceRepo,
						sourceBranch: branchName,
						push: false
					}, 'Creating Pull Request');
				}
			}
		], [
			{
				title: 'Create Archive',
				visible: visibility.createArchive,
				onClick: () => {
					runAction({ command: 'createArchive', repo: this.currentRepo, ref: refName }, 'Creating Archive');
				}
			},
			{
				title: 'Select in Branches Dropdown',
				visible: visibility.selectInBranchesDropdown && !isSelectedInBranchesDropdown,
				onClick: () => this.branchDropdown.selectOption(refName)
			},
			{
				title: 'Unselect in Branches Dropdown',
				visible: visibility.unselectInBranchesDropdown && isSelectedInBranchesDropdown,
				onClick: () => this.branchDropdown.unselectOption(refName)
			}
		], [
			{
				title: 'Copy Branch Name to Clipboard',
				visible: visibility.copyName,
				onClick: () => {
					sendMessage({ command: 'copyToClipboard', type: 'Branch Name', data: refName });
				}
			}
		]];
	}

	private getStashContextMenuActions(target: DialogTarget & RefTarget): ContextMenuActions {
		const hash = target.hash, selector = target.ref, visibility = this.config.contextMenuActionsVisibility.stash;
		return [[
			{
				title: 'Apply Stash' + ELLIPSIS,
				visible: visibility.apply,
				onClick: () => {
					dialog.showForm('Are you sure you want to apply the stash <b><i>' + escapeHtml(selector.substring(5)) + '</i></b>?', [{
						type: DialogInputType.Checkbox,
						name: 'Reinstate Index',
						value: this.config.dialogDefaults.applyStash.reinstateIndex,
						info: 'Attempt to reinstate the indexed changes, in addition to the working tree\'s changes.'
					}], 'Yes, apply stash', (values) => {
						runAction({ command: 'applyStash', repo: this.currentRepo, selector: selector, reinstateIndex: <boolean>values[0] }, 'Applying Stash');
					}, target);
				}
			}, {
				title: 'Create Branch from Stash' + ELLIPSIS,
				visible: visibility.createBranch,
				onClick: () => {
					dialog.showRefInput('Create a branch from stash <b><i>' + escapeHtml(selector.substring(5)) + '</i></b> with the name:', '', 'Create Branch', (branchName) => {
						runAction({ command: 'branchFromStash', repo: this.currentRepo, selector: selector, branchName: branchName }, 'Creating Branch');
					}, target);
				}
			}, {
				title: 'Pop Stash' + ELLIPSIS,
				visible: visibility.pop,
				onClick: () => {
					dialog.showForm('Are you sure you want to pop the stash <b><i>' + escapeHtml(selector.substring(5)) + '</i></b>?', [{
						type: DialogInputType.Checkbox,
						name: 'Reinstate Index',
						value: this.config.dialogDefaults.popStash.reinstateIndex,
						info: 'Attempt to reinstate the indexed changes, in addition to the working tree\'s changes.'
					}], 'Yes, pop stash', (values) => {
						runAction({ command: 'popStash', repo: this.currentRepo, selector: selector, reinstateIndex: <boolean>values[0] }, 'Popping Stash');
					}, target);
				}
			}, {
				title: 'Drop Stash' + ELLIPSIS,
				visible: visibility.drop,
				onClick: () => {
					dialog.showConfirmation('Are you sure you want to drop the stash <b><i>' + escapeHtml(selector.substring(5)) + '</i></b>?', 'Yes, drop', () => {
						runAction({ command: 'dropStash', repo: this.currentRepo, selector: selector }, 'Dropping Stash');
					}, target);
				}
			}
		], [
			{
				title: 'Copy Stash Name to Clipboard',
				visible: visibility.copyName,
				onClick: () => {
					sendMessage({ command: 'copyToClipboard', type: 'Stash Name', data: selector });
				}
			}, {
				title: 'Copy Stash Hash to Clipboard',
				visible: visibility.copyHash,
				onClick: () => {
					sendMessage({ command: 'copyToClipboard', type: 'Stash Hash', data: hash });
				}
			}
		]];
	}

	private getTagContextMenuActions(isAnnotated: boolean, target: DialogTarget & RefTarget): ContextMenuActions {
		const hash = target.hash, tagName = target.ref, visibility = this.config.contextMenuActionsVisibility.tag;
		return [[
			{
				title: 'View Details',
				visible: visibility.viewDetails && isAnnotated,
				onClick: () => {
					runAction({ command: 'tagDetails', repo: this.currentRepo, tagName: tagName, commitHash: hash }, 'Retrieving Tag Details');
				}
			}, {
				title: 'Delete Tag' + ELLIPSIS,
				visible: visibility.delete,
				onClick: () => {
					let message = 'Are you sure you want to delete the tag <b><i>' + escapeHtml(tagName) + '</i></b>?';
					if (this.gitRemotes.length > 1) {
						let options = [{ name: 'Don\'t delete on any remote', value: '-1' }];
						this.gitRemotes.forEach((remote, i) => options.push({ name: remote, value: i.toString() }));
						dialog.showSelect(message + '<br>Do you also want to delete the tag on a remote:', '-1', options, 'Yes, delete', remoteIndex => {
							this.deleteTagAction(tagName, remoteIndex !== '-1' ? this.gitRemotes[parseInt(remoteIndex)] : null);
						}, target);
					} else if (this.gitRemotes.length === 1) {
						dialog.showCheckbox(message, 'Also delete on remote', false, 'Yes, delete', deleteOnRemote => {
							this.deleteTagAction(tagName, deleteOnRemote ? this.gitRemotes[0] : null);
						}, target);
					} else {
						dialog.showConfirmation(message, 'Yes, delete', () => {
							this.deleteTagAction(tagName, null);
						}, target);
					}
				}
			}, {
				title: 'Push Tag' + ELLIPSIS,
				visible: visibility.push && this.gitRemotes.length > 0,
				onClick: () => {
					const runPushTagAction = (remotes: string[]) => {
						runAction({
							command: 'pushTag',
							repo: this.currentRepo,
							tagName: tagName,
							remotes: remotes,
							commitHash: hash,
							skipRemoteCheck: globalState.pushTagSkipRemoteCheck
						}, 'Pushing Tag');
					};

					if (this.gitRemotes.length === 1) {
						dialog.showConfirmation('Are you sure you want to push the tag <b><i>' + escapeHtml(tagName) + '</i></b> to the remote <b><i>' + escapeHtml(this.gitRemotes[0]) + '</i></b>?', 'Yes, push', () => {
							runPushTagAction([this.gitRemotes[0]]);
						}, target);
					} else if (this.gitRemotes.length > 1) {
						const defaults = [this.getPushRemote()];
						const options = this.gitRemotes.map((remote) => ({ name: remote, value: remote }));
						dialog.showMultiSelect('Are you sure you want to push the tag <b><i>' + escapeHtml(tagName) + '</i></b>? Select the remote(s) to push the tag to:', defaults, options, 'Yes, push', (remotes) => {
							runPushTagAction(remotes);
						}, target);
					}
				}
			}
		], [
			{
				title: 'Create Archive',
				visible: visibility.createArchive,
				onClick: () => {
					runAction({ command: 'createArchive', repo: this.currentRepo, ref: tagName }, 'Creating Archive');
				}
			},
			{
				title: 'Copy Tag Name to Clipboard',
				visible: visibility.copyName,
				onClick: () => {
					sendMessage({ command: 'copyToClipboard', type: 'Tag Name', data: tagName });
				}
			}
		]];
	}

	private getUncommittedChangesContextMenuActions(target: DialogTarget & CommitTarget): ContextMenuActions {
		let visibility = this.config.contextMenuActionsVisibility.uncommittedChanges;
		return [[
			{
				title: 'Stash uncommitted changes' + ELLIPSIS,
				visible: visibility.stash,
				onClick: () => {
					dialog.showForm('Are you sure you want to stash the <b>uncommitted changes</b>?', [
						{ type: DialogInputType.Text, name: 'Message', default: '', placeholder: 'Optional' },
						{ type: DialogInputType.Checkbox, name: 'Include Untracked', value: this.config.dialogDefaults.stashUncommittedChanges.includeUntracked, info: 'Include all untracked files in the stash, and then clean them from the working directory.' }
					], 'Yes, stash', (values) => {
						runAction({ command: 'pushStash', repo: this.currentRepo, message: <string>values[0], includeUntracked: <boolean>values[1] }, 'Stashing uncommitted changes');
					}, target);
				}
			}
		], [
			{
				title: 'Reset uncommitted changes' + ELLIPSIS,
				visible: visibility.reset,
				onClick: () => {
					dialog.showSelect('Are you sure you want to reset the <b>uncommitted changes</b> to <b>HEAD</b>?', this.config.dialogDefaults.resetUncommitted.mode, [
						{ name: 'Mixed - Keep working tree, but reset index', value: GG.GitResetMode.Mixed },
						{ name: 'Hard - Discard all changes', value: GG.GitResetMode.Hard }
					], 'Yes, reset', (mode) => {
						runAction({ command: 'resetToCommit', repo: this.currentRepo, commit: 'HEAD', resetMode: <GG.GitResetMode>mode }, 'Resetting uncommitted changes');
					}, target);
				}
			}, {
				title: 'Clean untracked files' + ELLIPSIS,
				visible: visibility.clean,
				onClick: () => {
					dialog.showCheckbox('Are you sure you want to clean all untracked files?', 'Clean untracked directories', true, 'Yes, clean', directories => {
						runAction({ command: 'cleanUntrackedFiles', repo: this.currentRepo, directories: directories }, 'Cleaning untracked files');
					}, target);
				}
			}
		], [
			{
				title: 'Open Source Control View',
				visible: visibility.openSourceControlView,
				onClick: () => {
					sendMessage({ command: 'viewScm' });
				}
			}
		]];
	}

	private getViewIssueAction(refName: string, visible: boolean, target: DialogTarget & RefTarget): ContextMenuAction {
		const issueLinks: { url: string, displayText: string }[] = [];

		let issueLinking: IssueLinking | null, match: RegExpExecArray | null;
		if (visible && (issueLinking = parseIssueLinkingConfig(this.gitRepos[this.currentRepo].issueLinkingConfig)) !== null) {
			issueLinking.regexp.lastIndex = 0;
			while (match = issueLinking.regexp.exec(refName)) {
				if (match[0].length === 0) break;
				issueLinks.push({
					url: generateIssueLinkFromMatch(match, issueLinking),
					displayText: match[0]
				});
			}
		}

		return {
			title: 'View Issue' + (issueLinks.length > 1 ? ELLIPSIS : ''),
			visible: issueLinks.length > 0,
			onClick: () => {
				if (issueLinks.length > 1) {
					dialog.showSelect('Select which issue you want to view for this branch:', '0', issueLinks.map((issueLink, i) => ({ name: issueLink.displayText, value: i.toString() })), 'View Issue', (value) => {
						sendMessage({ command: 'openExternalUrl', url: issueLinks[parseInt(value)].url });
					}, target);
				} else if (issueLinks.length === 1) {
					sendMessage({ command: 'openExternalUrl', url: issueLinks[0].url });
				}
			}
		};
	}


	/* Actions */

	private addTagAction(hash: string, initialName: string, initialType: GG.TagType, initialMessage: string, initialPushToRemote: string | null, target: DialogTarget & CommitTarget, isInitialLoad: boolean = true) {
		let mostRecentTagsIndex = -1;
		for (let i = 0; i < this.commits.length; i++) {
			if (this.commits[i].tags.length > 0 && (mostRecentTagsIndex === -1 || this.commits[i].date > this.commits[mostRecentTagsIndex].date)) {
				mostRecentTagsIndex = i;
			}
		}
		const mostRecentTags = mostRecentTagsIndex > -1 ? this.commits[mostRecentTagsIndex].tags.map((tag: GG.GitCommitTag) => '"' + tag.name + '"') : [];

		const inputs: DialogInput[] = [
			{ type: DialogInputType.TextRef, name: 'Name', default: initialName, info: mostRecentTags.length > 0 ? 'The most recent tag' + (mostRecentTags.length > 1 ? 's' : '') + ' in the loaded commits ' + (mostRecentTags.length > 1 ? 'are' : 'is') + ' ' + formatCommaSeparatedList(mostRecentTags) + '.' : undefined },
			{ type: DialogInputType.Select, name: 'Type', default: initialType === GG.TagType.Annotated ? 'annotated' : 'lightweight', options: [{ name: 'Annotated', value: 'annotated' }, { name: 'Lightweight', value: 'lightweight' }] },
			{ type: DialogInputType.Text, name: 'Message', default: initialMessage, placeholder: 'Optional', info: 'A message can only be added to an annotated tag.' }
		];
		if (this.gitRemotes.length > 1) {
			const options = [{ name: 'Don\'t push', value: '-1' }];
			this.gitRemotes.forEach((remote, i) => options.push({ name: remote, value: i.toString() }));
			const defaultOption = initialPushToRemote !== null
				? this.gitRemotes.indexOf(initialPushToRemote)
				: isInitialLoad && this.config.dialogDefaults.addTag.pushToRemote
					? this.gitRemotes.indexOf(this.getPushRemote())
					: -1;
			inputs.push({ type: DialogInputType.Select, name: 'Push to remote', options: options, default: defaultOption.toString(), info: 'Once this tag has been added, push it to this remote.' });
		} else if (this.gitRemotes.length === 1) {
			const defaultValue = initialPushToRemote !== null || (isInitialLoad && this.config.dialogDefaults.addTag.pushToRemote);
			inputs.push({ type: DialogInputType.Checkbox, name: 'Push to remote', value: defaultValue, info: 'Once this tag has been added, push it to the repositories remote.' });
		}

		dialog.showForm('Add tag to commit <b><i>' + abbrevCommit(hash) + '</i></b>:', inputs, 'Add Tag', (values) => {
			const tagName = <string>values[0];
			const type = <string>values[1] === 'annotated' ? GG.TagType.Annotated : GG.TagType.Lightweight;
			const message = <string>values[2];
			const pushToRemote = this.gitRemotes.length > 1 && <string>values[3] !== '-1'
				? this.gitRemotes[parseInt(<string>values[3])]
				: this.gitRemotes.length === 1 && <boolean>values[3]
					? this.gitRemotes[0]
					: null;

			const runAddTagAction = (force: boolean) => {
				runAction({
					command: 'addTag',
					repo: this.currentRepo,
					tagName: tagName,
					commitHash: hash,
					type: type,
					message: message,
					pushToRemote: pushToRemote,
					pushSkipRemoteCheck: globalState.pushTagSkipRemoteCheck,
					force: force
				}, 'Adding Tag');
			};

			if (this.gitTags.includes(tagName)) {
				dialog.showTwoButtons('A tag named <b><i>' + escapeHtml(tagName) + '</i></b> already exists, do you want to replace it with this new tag?', 'Yes, replace the existing tag', () => {
					runAddTagAction(true);
				}, 'No, choose another tag name', () => {
					this.addTagAction(hash, tagName, type, message, pushToRemote, target, false);
				}, target);
			} else {
				runAddTagAction(false);
			}
		}, target);
	}

	private checkoutBranchAction(refName: string, remote: string | null, prefillName: string | null, target: DialogTarget & (CommitTarget | RefTarget)) {
		if (remote !== null) {
			dialog.showRefInput('Enter the name of the new branch you would like to create when checking out <b><i>' + escapeHtml(refName) + '</i></b>:', (prefillName !== null ? prefillName : (remote !== '' ? refName.substring(remote.length + 1) : refName)), 'Checkout Branch', newBranch => {
				if (this.gitBranches.includes(newBranch)) {
					const canPullFromRemote = remote !== '';
					dialog.showTwoButtons('The name <b><i>' + escapeHtml(newBranch) + '</i></b> is already used by another branch:', 'Choose another branch name', () => {
						this.checkoutBranchAction(refName, remote, newBranch, target);
					}, 'Checkout the existing branch' + (canPullFromRemote ? ' & pull changes' : ''), () => {
						runAction({
							command: 'checkoutBranch',
							repo: this.currentRepo,
							branchName: newBranch,
							remoteBranch: null,
							pullAfterwards: canPullFromRemote
								? {
									branchName: refName.substring(remote.length + 1),
									remote: remote,
									createNewCommit: this.config.dialogDefaults.pullBranch.noFastForward,
									squash: this.config.dialogDefaults.pullBranch.squash
								}
								: null
						}, 'Checking out Branch' + (canPullFromRemote ? ' & Pulling Changes' : ''));
					}, target);
				} else {
					runAction({ command: 'checkoutBranch', repo: this.currentRepo, branchName: newBranch, remoteBranch: refName, pullAfterwards: null }, 'Checking out Branch');
				}
			}, target);
		} else {
			runAction({ command: 'checkoutBranch', repo: this.currentRepo, branchName: refName, remoteBranch: null, pullAfterwards: null }, 'Checking out Branch');
		}
	}

	private createBranchAction(hash: string, initialName: string, initialCheckOut: boolean, target: DialogTarget & CommitTarget) {
		dialog.showForm('Create branch at commit <b><i>' + abbrevCommit(hash) + '</i></b>:', [
			{ type: DialogInputType.TextRef, name: 'Name', default: initialName },
			{ type: DialogInputType.Checkbox, name: 'Check out', value: initialCheckOut }
		], 'Create Branch', (values) => {
			const branchName = <string>values[0], checkOut = <boolean>values[1];
			if (this.gitBranches.includes(branchName)) {
				dialog.showTwoButtons('A branch named <b><i>' + escapeHtml(branchName) + '</i></b> already exists, do you want to replace it with this new branch?', 'Yes, replace the existing branch', () => {
					runAction({ command: 'createBranch', repo: this.currentRepo, branchName: branchName, commitHash: hash, checkout: checkOut, force: true }, 'Creating Branch');
				}, 'No, choose another branch name', () => {
					this.createBranchAction(hash, branchName, checkOut, target);
				}, target);
			} else {
				runAction({ command: 'createBranch', repo: this.currentRepo, branchName: branchName, commitHash: hash, checkout: checkOut, force: false }, 'Creating Branch');
			}
		}, target);
	}

	private deleteTagAction(refName: string, deleteOnRemote: string | null) {
		runAction({ command: 'deleteTag', repo: this.currentRepo, tagName: refName, deleteOnRemote: deleteOnRemote }, 'Deleting Tag');
	}

	private fetchFromRemotesAction() {
		runAction({ command: 'fetch', repo: this.currentRepo, name: null, prune: this.config.fetchAndPrune, pruneTags: this.config.fetchAndPruneTags }, 'Fetching from Remote(s)');
	}

	private mergeAction(obj: string, name: string, actionOn: GG.MergeActionOn, target: DialogTarget & (CommitTarget | RefTarget)) {
		dialog.showForm('Are you sure you want to merge ' + actionOn.toLowerCase() + ' <b><i>' + escapeHtml(name) + '</i></b> into ' + (this.gitBranchHead !== null ? '<b><i>' + escapeHtml(this.gitBranchHead) + '</i></b> (the current branch)' : 'the current branch') + '?', [
			{ type: DialogInputType.Checkbox, name: 'Create a new commit even if fast-forward is possible', value: this.config.dialogDefaults.merge.noFastForward },
			{ type: DialogInputType.Checkbox, name: 'Squash Commits', value: this.config.dialogDefaults.merge.squash, info: 'Create a single commit on the current branch whose effect is the same as merging this ' + actionOn.toLowerCase() + '.' },
			{ type: DialogInputType.Checkbox, name: 'No Commit', value: this.config.dialogDefaults.merge.noCommit, info: 'The changes of the merge will be staged but not committed, so that you can review and/or modify the merge result before committing.' }
		], 'Yes, merge', (values) => {
			runAction({ command: 'merge', repo: this.currentRepo, obj: obj, actionOn: actionOn, createNewCommit: <boolean>values[0], squash: <boolean>values[1], noCommit: <boolean>values[2] }, 'Merging ' + actionOn);
		}, target);
	}

	private rebaseAction(obj: string, name: string, actionOn: GG.RebaseActionOn, target: DialogTarget & (CommitTarget | RefTarget)) {
		dialog.showForm('Are you sure you want to rebase ' + (this.gitBranchHead !== null ? '<b><i>' + escapeHtml(this.gitBranchHead) + '</i></b> (the current branch)' : 'the current branch') + ' on ' + actionOn.toLowerCase() + ' <b><i>' + escapeHtml(name) + '</i></b>?', [
			{ type: DialogInputType.Checkbox, name: 'Launch Interactive Rebase in new Terminal', value: this.config.dialogDefaults.rebase.interactive },
			{ type: DialogInputType.Checkbox, name: 'Ignore Date', value: this.config.dialogDefaults.rebase.ignoreDate, info: 'Only applicable to a non-interactive rebase.' }
		], 'Yes, rebase', (values) => {
			let interactive = <boolean>values[0];
			runAction({ command: 'rebase', repo: this.currentRepo, obj: obj, actionOn: actionOn, ignoreDate: <boolean>values[1], interactive: interactive }, interactive ? 'Launching Interactive Rebase' : 'Rebasing on ' + actionOn);
		}, target);
	}


	/* Table Utils */

	private makeTableResizable() {
		let colHeadersElem = document.getElementById('tableColHeaders')!, cols = <HTMLCollectionOf<HTMLElement>>document.getElementsByClassName('tableColHeader');
		let columnWidths: GG.ColumnWidth[], mouseX = -1, col = -1, colIndex = -1;

		const makeTableFixedLayout = () => {
			cols[0].style.width = columnWidths[0] + 'px';
			cols[0].style.padding = '';
			for (let i = 2; i < cols.length; i++) {
				cols[i].style.width = columnWidths[parseInt(cols[i].dataset.col!)] + 'px';
			}
			this.tableElem.className = 'fixedLayout';
			this.tableElem.style.removeProperty(CSS_PROP_LIMIT_GRAPH_WIDTH);
			this.graph.limitMaxWidth(columnWidths[0] + COLUMN_LEFT_RIGHT_PADDING);
		};

		for (let i = 0; i < cols.length; i++) {
			let col = parseInt(cols[i].dataset.col!);
			cols[i].innerHTML += (i > 0 ? '<span class="resizeCol left" data-col="' + (col - 1) + '"></span>' : '') + (i < cols.length - 1 ? '<span class="resizeCol right" data-col="' + col + '"></span>' : '');
		}

		let cWidths = this.gitRepos[this.currentRepo].columnWidths;
		if (cWidths === null) { // Initialise auto column layout if it is the first time viewing the repo.
			let defaults = this.config.defaultColumnVisibility;
			columnWidths = [COLUMN_AUTO, COLUMN_AUTO, defaults.date ? COLUMN_AUTO : COLUMN_HIDDEN, defaults.author ? COLUMN_AUTO : COLUMN_HIDDEN, defaults.commit ? COLUMN_AUTO : COLUMN_HIDDEN];
			this.saveColumnWidths(columnWidths);
		} else {
			columnWidths = [cWidths[0], COLUMN_AUTO, cWidths[1], cWidths[2], cWidths[3]];
		}

		if (columnWidths[0] !== COLUMN_AUTO) {
			// Table should have fixed layout
			makeTableFixedLayout();
		} else {
			// Table should have automatic layout
			this.tableElem.className = 'autoLayout';

			let colWidth = cols[0].offsetWidth, graphWidth = this.graph.getContentWidth();
			let maxWidth = Math.round(this.viewElem.clientWidth * 0.333);
			if (Math.max(graphWidth, colWidth) > maxWidth) {
				this.graph.limitMaxWidth(maxWidth);
				graphWidth = maxWidth;
				this.tableElem.className += ' limitGraphWidth';
				this.tableElem.style.setProperty(CSS_PROP_LIMIT_GRAPH_WIDTH, maxWidth + 'px');
			} else {
				this.graph.limitMaxWidth(-1);
				this.tableElem.style.removeProperty(CSS_PROP_LIMIT_GRAPH_WIDTH);
			}

			if (colWidth < Math.max(graphWidth, 64)) {
				cols[0].style.padding = '6px ' + Math.floor((Math.max(graphWidth, 64) - (colWidth - COLUMN_LEFT_RIGHT_PADDING)) / 2) + 'px';
			}
		}

		const processResizingColumn: EventListener = (e) => {
			if (col > -1) {
				let mouseEvent = <MouseEvent>e;
				let mouseDeltaX = mouseEvent.clientX - mouseX;

				if (col === 0) {
					if (columnWidths[0] + mouseDeltaX < COLUMN_MIN_WIDTH) mouseDeltaX = -columnWidths[0] + COLUMN_MIN_WIDTH;
					if (cols[1].clientWidth - COLUMN_LEFT_RIGHT_PADDING - mouseDeltaX < COLUMN_MIN_WIDTH) mouseDeltaX = cols[1].clientWidth - COLUMN_LEFT_RIGHT_PADDING - COLUMN_MIN_WIDTH;
					columnWidths[0] += mouseDeltaX;
					cols[0].style.width = columnWidths[0] + 'px';
					this.graph.limitMaxWidth(columnWidths[0] + COLUMN_LEFT_RIGHT_PADDING);
				} else {
					let colWidth = col !== 1 ? columnWidths[col] : cols[1].clientWidth - COLUMN_LEFT_RIGHT_PADDING;
					let nextCol = col + 1;
					while (columnWidths[nextCol] === COLUMN_HIDDEN) nextCol++;

					if (colWidth + mouseDeltaX < COLUMN_MIN_WIDTH) mouseDeltaX = -colWidth + COLUMN_MIN_WIDTH;
					if (columnWidths[nextCol] - mouseDeltaX < COLUMN_MIN_WIDTH) mouseDeltaX = columnWidths[nextCol] - COLUMN_MIN_WIDTH;
					if (col !== 1) {
						columnWidths[col] += mouseDeltaX;
						cols[colIndex].style.width = columnWidths[col] + 'px';
					}
					columnWidths[nextCol] -= mouseDeltaX;
					cols[colIndex + 1].style.width = columnWidths[nextCol] + 'px';
				}
				mouseX = mouseEvent.clientX;
			}
		};
		const stopResizingColumn: EventListener = () => {
			if (col > -1) {
				col = -1;
				colIndex = -1;
				mouseX = -1;
				eventOverlay.remove();
				this.saveColumnWidths(columnWidths);
			}
		};

		addListenerToClass('resizeCol', 'mousedown', (e) => {
			if (e.target === null) return;
			col = parseInt((<HTMLElement>e.target).dataset.col!);
			while (columnWidths[col] === COLUMN_HIDDEN) col--;
			mouseX = (<MouseEvent>e).clientX;

			let isAuto = columnWidths[0] === COLUMN_AUTO;
			for (let i = 0; i < cols.length; i++) {
				let curCol = parseInt(cols[i].dataset.col!);
				if (isAuto && curCol !== 1) columnWidths[curCol] = cols[i].clientWidth - COLUMN_LEFT_RIGHT_PADDING;
				if (curCol === col) colIndex = i;
			}
			if (isAuto) makeTableFixedLayout();
			eventOverlay.create('colResize', processResizingColumn, stopResizingColumn);
		});

		colHeadersElem.addEventListener('contextmenu', (e: MouseEvent) => {
			handledEvent(e);

			const toggleColumnState = (col: number, defaultWidth: number) => {
				columnWidths[col] = columnWidths[col] !== COLUMN_HIDDEN ? COLUMN_HIDDEN : columnWidths[0] === COLUMN_AUTO ? COLUMN_AUTO : defaultWidth - COLUMN_LEFT_RIGHT_PADDING;
				this.saveColumnWidths(columnWidths);
				this.render();
			};

			const commitOrdering = getCommitOrdering(this.gitRepos[this.currentRepo].commitOrdering);
			const changeCommitOrdering = (repoCommitOrdering: GG.RepoCommitOrdering) => {
				this.saveRepoStateValue(this.currentRepo, 'commitOrdering', repoCommitOrdering);
				this.refresh(true);
			};

			contextMenu.show([
				[
					{
						title: 'Date',
						visible: true,
						checked: columnWidths[2] !== COLUMN_HIDDEN,
						onClick: () => toggleColumnState(2, 128)
					},
					{
						title: 'Author',
						visible: true,
						checked: columnWidths[3] !== COLUMN_HIDDEN,
						onClick: () => toggleColumnState(3, 128)
					},
					{
						title: 'Commit',
						visible: true,
						checked: columnWidths[4] !== COLUMN_HIDDEN,
						onClick: () => toggleColumnState(4, 80)
					}
				],
				[
					{
						title: 'Commit Timestamp Order',
						visible: true,
						checked: commitOrdering === GG.CommitOrdering.Date,
						onClick: () => changeCommitOrdering(GG.RepoCommitOrdering.Date)
					},
					{
						title: 'Author Timestamp Order',
						visible: true,
						checked: commitOrdering === GG.CommitOrdering.AuthorDate,
						onClick: () => changeCommitOrdering(GG.RepoCommitOrdering.AuthorDate)
					},
					{
						title: 'Topological Order',
						visible: true,
						checked: commitOrdering === GG.CommitOrdering.Topological,
						onClick: () => changeCommitOrdering(GG.RepoCommitOrdering.Topological)
					}
				]
			], true, null, e, this.viewElem);
		});
	}

	public getColumnVisibility() {
		let colWidths = this.gitRepos[this.currentRepo].columnWidths;
		if (colWidths !== null) {
			return { date: colWidths[1] !== COLUMN_HIDDEN, author: colWidths[2] !== COLUMN_HIDDEN, commit: colWidths[3] !== COLUMN_HIDDEN };
		} else {
			let defaults = this.config.defaultColumnVisibility;
			return { date: defaults.date, author: defaults.author, commit: defaults.commit };
		}
	}

	private getNumColumns() {
		let colVisibility = this.getColumnVisibility();
		return 2 + (colVisibility.date ? 1 : 0) + (colVisibility.author ? 1 : 0) + (colVisibility.commit ? 1 : 0);
	}

	/**
	 * Scroll the view to the previous or next stash.
	 * @param next TRUE => Jump to the next stash, FALSE => Jump to the previous stash.
	 */
	private scrollToStash(next: boolean) {
		const stashCommits = this.commits.filter((commit) => commit.stash !== null);
		if (stashCommits.length > 0) {
			const curTime = (new Date()).getTime();
			if (this.lastScrollToStash.time < curTime - 5000) {
				// Reset the lastScrollToStash hash if it was more than 5 seconds ago
				this.lastScrollToStash.hash = null;
			}

			const lastScrollToStashCommitIndex = this.lastScrollToStash.hash !== null
				? stashCommits.findIndex((commit) => commit.hash === this.lastScrollToStash.hash)
				: -1;
			let scrollToStashCommitIndex = lastScrollToStashCommitIndex + (next ? 1 : -1);
			if (scrollToStashCommitIndex >= stashCommits.length) {
				scrollToStashCommitIndex = 0;
			} else if (scrollToStashCommitIndex < 0) {
				scrollToStashCommitIndex = stashCommits.length - 1;
			}
			this.scrollToCommit(stashCommits[scrollToStashCommitIndex].hash, true, true);
			this.lastScrollToStash.time = curTime;
			this.lastScrollToStash.hash = stashCommits[scrollToStashCommitIndex].hash;
		}
	}

	/**
	 * Scroll the view to a commit (if it exists).
	 * @param hash The hash of the commit to scroll to.
	 * @param alwaysCenterCommit TRUE => Always scroll the view to be centered on the commit. FALSE => Don't scroll the view if the commit is already within the visible portion of commits.
	 * @param flash Should the commit flash after it has been scrolled to.
	 */
	public scrollToCommit(hash: string, alwaysCenterCommit: boolean, flash: boolean = false) {
		const elem = findCommitElemWithId(getCommitElems(), this.getCommitId(hash));
		if (elem === null) return;

		let elemTop = this.controlsElem.clientHeight + elem.offsetTop;
		if (alwaysCenterCommit || elemTop - 8 < this.viewElem.scrollTop || elemTop + 32 - this.viewElem.clientHeight > this.viewElem.scrollTop) {
			this.viewElem.scroll(0, this.controlsElem.clientHeight + elem.offsetTop + 12 - this.viewElem.clientHeight / 2);
		}

		if (flash && !elem.classList.contains('flash')) {
			elem.classList.add('flash');
			setTimeout(() => {
				elem.classList.remove('flash');
			}, 850);
		}
	}

	private loadMoreCommits() {
		this.footerElem.innerHTML = '<h2 id="loadingHeader">' + SVG_ICONS.loading + 'Loading ...</h2>';
		this.maxCommits += this.config.loadMoreCommits;
		this.saveState();
		this.requestLoadRepoInfoAndCommits(false, true);
	}


	/* Observers */

	private observeWindowSizeChanges() {
		let windowWidth = window.outerWidth, windowHeight = window.outerHeight;
		window.addEventListener('resize', () => {
			if (windowWidth === window.outerWidth && windowHeight === window.outerHeight) {
				this.renderGraph();
			} else {
				windowWidth = window.outerWidth;
				windowHeight = window.outerHeight;
			}
		});
	}

	private observeWebviewStyleChanges() {
		let fontFamily = getVSCodeStyle(CSS_PROP_FONT_FAMILY),
			editorFontFamily = getVSCodeStyle(CSS_PROP_EDITOR_FONT_FAMILY),
			findMatchColour = getVSCodeStyle(CSS_PROP_FIND_MATCH_HIGHLIGHT_BACKGROUND),
			selectionBackgroundColor = !!getVSCodeStyle(CSS_PROP_SELECTION_BACKGROUND);

		const setFlashColour = (colour: string) => {
			document.body.style.setProperty('--git-graph-flashPrimary', modifyColourOpacity(colour, 0.7));
			document.body.style.setProperty('--git-graph-flashSecondary', modifyColourOpacity(colour, 0.5));
		};
		const setSelectionBackgroundColorExists = () => {
			alterClass(document.body, 'selection-background-color-exists', selectionBackgroundColor);
		};

		this.findWidget.setColour(findMatchColour);
		setFlashColour(findMatchColour);
		setSelectionBackgroundColorExists();

		(new MutationObserver(() => {
			let ff = getVSCodeStyle(CSS_PROP_FONT_FAMILY),
				eff = getVSCodeStyle(CSS_PROP_EDITOR_FONT_FAMILY),
				fmc = getVSCodeStyle(CSS_PROP_FIND_MATCH_HIGHLIGHT_BACKGROUND),
				sbc = !!getVSCodeStyle(CSS_PROP_SELECTION_BACKGROUND);

			if (ff !== fontFamily || eff !== editorFontFamily) {
				fontFamily = ff;
				editorFontFamily = eff;
				this.repoDropdown.refresh();
				this.branchDropdown.refresh();
			}
			if (fmc !== findMatchColour) {
				findMatchColour = fmc;
				this.findWidget.setColour(findMatchColour);
				setFlashColour(findMatchColour);
			}
			if (selectionBackgroundColor !== sbc) {
				selectionBackgroundColor = sbc;
				setSelectionBackgroundColorExists();
			}
		})).observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
	}

	private observeViewScroll() {
		let active = this.viewElem.scrollTop > 0, timeout: NodeJS.Timer | null = null;
		this.scrollShadowElem.className = active ? CLASS_ACTIVE : '';
		this.viewElem.addEventListener('scroll', () => {
			const scrollTop = this.viewElem.scrollTop;
			if (active !== scrollTop > 0) {
				active = scrollTop > 0;
				this.scrollShadowElem.className = active ? CLASS_ACTIVE : '';
			}

			if (this.config.loadMoreCommitsAutomatically && this.moreCommitsAvailable && !this.currentRepoRefreshState.inProgress) {
				const viewHeight = this.viewElem.clientHeight, contentHeight = this.viewElem.scrollHeight;
				if (scrollTop > 0 && viewHeight > 0 && contentHeight > 0 && (scrollTop + viewHeight) >= contentHeight - 25) {
					// If the user has scrolled such that the bottom of the visible view is within 25px of the end of the content, load more commits.
					this.loadMoreCommits();
				}
			}

			if (timeout !== null) clearTimeout(timeout as any);
			timeout = setTimeout(() => {
				this.scrollTop = scrollTop;
				this.saveState();
				timeout = null;
			}, 250);
		});
	}

	private observeKeyboardEvents() {
		document.addEventListener('keydown', (e) => {
			if (contextMenu.isOpen()) {
				if (e.key === 'Escape') {
					contextMenu.close();
					handledEvent(e);
				}
			} else if (dialog.isOpen()) {
				if (e.key === 'Escape') {
					dialog.close();
					handledEvent(e);
				} else if (e.keyCode ? e.keyCode === 13 : e.key === 'Enter') {
					// Use keyCode === 13 to detect 'Enter' events if available (for compatibility with IME Keyboards used by Chinese / Japanese / Korean users)
					dialog.submit();
					handledEvent(e);
				}
			} else if (this.expandedCommit !== null && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
				const curHashIndex = this.commitLookup[this.expandedCommit.commitHash];
				let newHashIndex = -1;

				if (e.ctrlKey || e.metaKey) {
					// Up / Down navigates according to the order of commits on the branch
					if (e.shiftKey) {
						// Follow commits on alternative branches when possible
						if (e.key === 'ArrowUp') {
							newHashIndex = this.graph.getAlternativeChildIndex(curHashIndex);
						} else if (e.key === 'ArrowDown') {
							newHashIndex = this.graph.getAlternativeParentIndex(curHashIndex);
						}
					} else {
						// Follow commits on the same branch
						if (e.key === 'ArrowUp') {
							newHashIndex = this.graph.getFirstChildIndex(curHashIndex);
						} else if (e.key === 'ArrowDown') {
							newHashIndex = this.graph.getFirstParentIndex(curHashIndex);
						}
					}
				} else {
					// Up / Down navigates according to the order of commits in the table
					if (e.key === 'ArrowUp' && curHashIndex > 0) {
						newHashIndex = curHashIndex - 1;
					} else if (e.key === 'ArrowDown' && curHashIndex < this.commits.length - 1) {
						newHashIndex = curHashIndex + 1;
					}
				}

				if (newHashIndex > -1) {
					handledEvent(e);
					const elem = findCommitElemWithId(getCommitElems(), newHashIndex);
					if (elem !== null) this.loadCommitDetails(elem);
				}
			} else if (e.key && (e.ctrlKey || e.metaKey)) {
				const key = e.key.toLowerCase(), keybindings = this.config.keybindings;
				if (key === keybindings.scrollToStash) {
					this.scrollToStash(!e.shiftKey);
					handledEvent(e);
				} else if (!e.shiftKey) {
					if (key === keybindings.refresh) {
						this.refresh(true, true);
						handledEvent(e);
					} else if (key === keybindings.find) {
						this.findWidget.show(true);
						handledEvent(e);
					} else if (key === keybindings.scrollToHead && this.commitHead !== null) {
						this.scrollToCommit(this.commitHead, true, true);
						handledEvent(e);
					}
				}
			} else if (e.key === 'Escape') {
				if (this.repoDropdown.isOpen()) {
					this.repoDropdown.close();
					handledEvent(e);
				} else if (this.branchDropdown.isOpen()) {
					this.branchDropdown.close();
					handledEvent(e);
				} else if (this.settingsWidget.isVisible()) {
					this.settingsWidget.close();
					handledEvent(e);
				} else if (this.findWidget.isVisible()) {
					this.findWidget.close();
					handledEvent(e);
				} else if (this.expandedCommit !== null) {
					this.closeCommitDetails(true);
					handledEvent(e);
				}
			}
		});
	}

	private observeUrls() {
		const followInternalLink = (e: MouseEvent) => {
			if (e.target !== null && isInternalUrlElem(<Element>e.target)) {
				const value = unescapeHtml((<HTMLElement>e.target).dataset.value!);
				switch ((<HTMLElement>e.target).dataset.type!) {
					case 'commit':
						if (typeof this.commitLookup[value] === 'number' && (this.expandedCommit === null || this.expandedCommit.commitHash !== value || this.expandedCommit.compareWithHash !== null)) {
							const elem = findCommitElemWithId(getCommitElems(), this.commitLookup[value]);
							if (elem !== null) this.loadCommitDetails(elem);
						}
						break;
				}
			}
		};

		document.body.addEventListener('click', followInternalLink);

		document.body.addEventListener('contextmenu', (e: MouseEvent) => {
			if (e.target === null) return;
			const eventTarget = <Element>e.target;

			const isExternalUrl = isExternalUrlElem(eventTarget), isInternalUrl = isInternalUrlElem(eventTarget);
			if (isExternalUrl || isInternalUrl) {
				const viewElem: HTMLElement | null = eventTarget.closest('#view');
				let eventElem: HTMLElement | null;

				let target: (ContextMenuTarget & CommitTarget) | RepoTarget, isInDialog = false;
				if (this.expandedCommit !== null && eventTarget.closest('#cdv') !== null) {
					// URL is in the Commit Details View
					target = {
						type: TargetType.CommitDetailsView,
						hash: this.expandedCommit.commitHash,
						index: this.commitLookup[this.expandedCommit.commitHash],
						elem: <HTMLElement>eventTarget
					};
					GitGraphView.closeCdvContextMenuIfOpen(this.expandedCommit);
					this.expandedCommit.contextMenuOpen.summary = true;
				} else if ((eventElem = eventTarget.closest('.commit')) !== null) {
					// URL is in the Commits
					const commit = this.getCommitOfElem(eventElem);
					if (commit === null) return;
					target = {
						type: TargetType.Commit,
						hash: commit.hash,
						index: parseInt(eventElem.dataset.id!),
						elem: <HTMLElement>eventTarget
					};
				} else {
					// URL is in a dialog
					target = {
						type: TargetType.Repo
					};
					isInDialog = true;
				}

				handledEvent(e);
				contextMenu.show([
					[
						{
							title: 'Open URL',
							visible: isExternalUrl,
							onClick: () => {
								sendMessage({ command: 'openExternalUrl', url: (<HTMLAnchorElement>eventTarget).href });
							}
						},
						{
							title: 'Follow Internal Link',
							visible: isInternalUrl,
							onClick: () => followInternalLink(e)
						},
						{
							title: 'Copy URL to Clipboard',
							visible: isExternalUrl,
							onClick: () => {
								sendMessage({ command: 'copyToClipboard', type: 'External URL', data: (<HTMLAnchorElement>eventTarget).href });
							}
						}
					]
				], false, target, e, viewElem || document.body, () => {
					if (target.type === TargetType.CommitDetailsView && this.expandedCommit !== null) {
						this.expandedCommit.contextMenuOpen.summary = false;
					}
				}, isInDialog ? 'dialogContextMenu' : null);
			}
		});
	}

	private observeTableEvents() {

		// Register Click Event Handler
		this.tableElem.addEventListener('click', (e: MouseEvent) => {
			if (e.target === null) return;
			const eventTarget = <Element>e.target;
			if (isUrlElem(eventTarget)) return;
			let eventElem: HTMLElement | null;

			if ((eventElem = eventTarget.closest('.gitRef')) !== null) {
				// .gitRef was clicked
				e.stopPropagation();
				if (contextMenu.isOpen()) {
					contextMenu.close();
				}

			} else if ((eventElem = eventTarget.closest('.commit')) !== null) {
				// .commit was clicked
				if (this.expandedCommit !== null) {
					const commit = this.getCommitOfElem(eventElem);
					if (commit === null) return;

					if (this.expandedCommit.commitHash === commit.hash) {
						this.closeCommitDetails(true);
					} else if ((<MouseEvent>e).ctrlKey || (<MouseEvent>e).metaKey) {
						if (this.expandedCommit.compareWithHash === commit.hash) {
							this.closeCommitComparison(true);
						} else if (this.expandedCommit.commitElem !== null) {
							this.loadCommitComparison(this.expandedCommit.commitElem, eventElem);
						}
					} else {
						this.loadCommitDetails(eventElem);
					}
				} else {
					this.loadCommitDetails(eventElem);
				}
			}
		});

		// Register Double Click Event Handler
		this.tableElem.addEventListener('dblclick', (e: MouseEvent) => {
			if (e.target === null) return;
			const eventTarget = <Element>e.target;
			if (isUrlElem(eventTarget)) return;
			let eventElem: HTMLElement | null;

			if ((eventElem = eventTarget.closest('.gitRef')) !== null) {
				// .gitRef was double clicked
				e.stopPropagation();
				closeDialogAndContextMenu();
				const commitElem = <HTMLElement>eventElem.closest('.commit')!;
				const commit = this.getCommitOfElem(commitElem);
				if (commit === null) return;

				if (eventElem.classList.contains(CLASS_REF_HEAD) || eventElem.classList.contains(CLASS_REF_REMOTE)) {
					let sourceElem = <HTMLElement>eventElem.children[1];
					let refName = unescapeHtml(eventElem.dataset.name!), isHead = eventElem.classList.contains(CLASS_REF_HEAD), isRemoteCombinedWithHead = eventTarget.classList.contains('gitRefHeadRemote');
					if (isHead && isRemoteCombinedWithHead) {
						refName = unescapeHtml((<HTMLElement>eventTarget).dataset.fullref!);
						sourceElem = <HTMLElement>eventTarget;
						isHead = false;
					}

					const target: ContextMenuTarget & DialogTarget & RefTarget = {
						type: TargetType.Ref,
						hash: commit.hash,
						index: parseInt(commitElem.dataset.id!),
						ref: refName,
						elem: sourceElem
					};

					this.checkoutBranchAction(refName, isHead ? null : unescapeHtml((isRemoteCombinedWithHead ? <HTMLElement>eventTarget : eventElem).dataset.remote!), null, target);
				}
			}
		});

		// Register ContextMenu Event Handler
		this.tableElem.addEventListener('contextmenu', (e: Event) => {
			if (e.target === null) return;
			const eventTarget = <Element>e.target;
			if (isUrlElem(eventTarget)) return;
			let eventElem: HTMLElement | null;

			if ((eventElem = eventTarget.closest('.gitRef')) !== null) {
				// .gitRef was right clicked
				handledEvent(e);
				const commitElem = <HTMLElement>eventElem.closest('.commit')!;
				const commit = this.getCommitOfElem(commitElem);
				if (commit === null) return;

				const target: ContextMenuTarget & DialogTarget & RefTarget = {
					type: TargetType.Ref,
					hash: commit.hash,
					index: parseInt(commitElem.dataset.id!),
					ref: unescapeHtml(eventElem.dataset.name!),
					elem: <HTMLElement>eventElem.children[1]
				};

				let actions: ContextMenuActions;
				if (eventElem.classList.contains(CLASS_REF_STASH)) {
					actions = this.getStashContextMenuActions(target);
				} else if (eventElem.classList.contains(CLASS_REF_TAG)) {
					actions = this.getTagContextMenuActions(eventElem.dataset.tagtype === 'annotated', target);
				} else {
					let isHead = eventElem.classList.contains(CLASS_REF_HEAD), isRemoteCombinedWithHead = eventTarget.classList.contains('gitRefHeadRemote');
					if (isHead && isRemoteCombinedWithHead) {
						target.ref = unescapeHtml((<HTMLElement>eventTarget).dataset.fullref!);
						target.elem = <HTMLElement>eventTarget;
						isHead = false;
					}
					if (isHead) {
						actions = this.getBranchContextMenuActions(target);
					} else {
						const remote = unescapeHtml((isRemoteCombinedWithHead ? <HTMLElement>eventTarget : eventElem).dataset.remote!);
						actions = this.getRemoteBranchContextMenuActions(remote, target);
					}
				}

				contextMenu.show(actions, false, target, <MouseEvent>e, this.viewElem);

			} else if ((eventElem = eventTarget.closest('.commit')) !== null) {
				// .commit was right clicked
				handledEvent(e);
				const commit = this.getCommitOfElem(eventElem);
				if (commit === null) return;

				const target: ContextMenuTarget & DialogTarget & CommitTarget = {
					type: TargetType.Commit,
					hash: commit.hash,
					index: parseInt(eventElem.dataset.id!),
					elem: eventElem
				};

				let actions: ContextMenuActions;
				if (commit.hash === UNCOMMITTED) {
					actions = this.getUncommittedChangesContextMenuActions(target);
				} else if (commit.stash !== null) {
					target.ref = commit.stash.selector;
					actions = this.getStashContextMenuActions(<RefTarget>target);
				} else {
					actions = this.getCommitContextMenuActions(target);
				}

				contextMenu.show(actions, false, target, <MouseEvent>e, this.viewElem);
			}
		});
	}


	/* Commit Details View */

	public loadCommitDetails(commitElem: HTMLElement) {
		const commit = this.getCommitOfElem(commitElem);
		if (commit === null) return;

		this.closeCommitDetails(false);
		this.saveExpandedCommitLoading(parseInt(commitElem.dataset.id!), commit.hash, commitElem, null, null);
		commitElem.classList.add(CLASS_COMMIT_DETAILS_OPEN);
		this.renderCommitDetailsView(false);
		this.requestCommitDetails(commit.hash, false);
	}

	public closeCommitDetails(saveAndRender: boolean) {
		const expandedCommit = this.expandedCommit;
		if (expandedCommit === null) return;

		const elem = document.getElementById('cdv'), isDocked = this.isCdvDocked();
		if (elem !== null) {
			elem.remove();
		}
		if (isDocked) {
			this.viewElem.style.bottom = '0px';
		}
		if (expandedCommit.commitElem !== null) {
			expandedCommit.commitElem.classList.remove(CLASS_COMMIT_DETAILS_OPEN);
		}
		if (expandedCommit.compareWithElem !== null) {
			expandedCommit.compareWithElem.classList.remove(CLASS_COMMIT_DETAILS_OPEN);
		}
		GitGraphView.closeCdvContextMenuIfOpen(expandedCommit);
		this.expandedCommit = null;
		if (saveAndRender) {
			this.saveState();
			if (!isDocked) {
				this.renderGraph();
			}
		}
	}

	public showCommitDetails(commitDetails: GG.GitCommitDetails, fileTree: FileTreeFolder, avatar: string | null, codeReview: GG.CodeReview | null, lastViewedFile: string | null, refresh: boolean) {
		const expandedCommit = this.expandedCommit;
		if (expandedCommit === null || expandedCommit.commitElem === null || expandedCommit.commitHash !== commitDetails.hash || expandedCommit.compareWithHash !== null) return;

		expandedCommit.aiAnalysis = commitDetails.aiAnalysis || null;

		if (!this.isCdvDocked()) {
			const elem = document.getElementById('cdv');
			if (elem !== null) elem.remove();
		}

		expandedCommit.commitDetails = commitDetails;
		if (haveFilesChanged(expandedCommit.fileChanges, commitDetails.fileChanges)) {
			expandedCommit.fileChanges = commitDetails.fileChanges;
			expandedCommit.fileTree = fileTree;
			GitGraphView.closeCdvContextMenuIfOpen(expandedCommit);
		}
		expandedCommit.avatar = avatar;
		expandedCommit.codeReview = codeReview;
		if (!refresh) {
			expandedCommit.lastViewedFile = lastViewedFile;
		}
		expandedCommit.commitElem.classList.add(CLASS_COMMIT_DETAILS_OPEN);
		expandedCommit.loading = false;
		this.saveState();

		this.renderCommitDetailsView(refresh);
	}

	public createFileTree(gitFiles: ReadonlyArray<GG.GitFileChange>, codeReview: GG.CodeReview | null) {
		let contents: FileTreeFolderContents = {}, i, j, path, absPath, cur: FileTreeFolder;
		let files: FileTreeFolder = { type: 'folder', name: '', folderPath: '', contents: contents, open: true, reviewed: true };

		for (i = 0; i < gitFiles.length; i++) {
			cur = files;
			path = gitFiles[i].newFilePath.split('/');
			absPath = this.currentRepo;
			for (j = 0; j < path.length; j++) {
				absPath += '/' + path[j];
				if (typeof this.gitRepos[absPath] !== 'undefined') {
					if (typeof cur.contents[path[j]] === 'undefined') {
						cur.contents[path[j]] = { type: 'repo', name: path[j], path: absPath };
					}
					break;
				} else if (j < path.length - 1) {
					if (typeof cur.contents[path[j]] === 'undefined') {
						contents = {};
						cur.contents[path[j]] = { type: 'folder', name: path[j], folderPath: absPath.substring(this.currentRepo.length + 1), contents: contents, open: true, reviewed: true };
					}
					cur = <FileTreeFolder>cur.contents[path[j]];
				} else if (path[j] !== '') {
					cur.contents[path[j]] = { type: 'file', name: path[j], index: i, reviewed: codeReview === null || !codeReview.remainingFiles.includes(gitFiles[i].newFilePath) };
				}
			}
		}
		if (codeReview !== null) calcFileTreeFoldersReviewed(files, codeReview);
		return files;
	}


	/* Commit Comparison View */

	private loadCommitComparison(commitElem: HTMLElement, compareWithElem: HTMLElement) {
		const commit = this.getCommitOfElem(commitElem);
		const compareWithCommit = this.getCommitOfElem(compareWithElem);

		if (commit !== null && compareWithCommit !== null) {
			if (this.expandedCommit !== null) {
				if (this.expandedCommit.commitHash !== commit.hash) {
					this.closeCommitDetails(false);
				} else if (this.expandedCommit.compareWithHash !== compareWithCommit.hash) {
					this.closeCommitComparison(false);
				}
			}

			this.saveExpandedCommitLoading(parseInt(commitElem.dataset.id!), commit.hash, commitElem, compareWithCommit.hash, compareWithElem);
			commitElem.classList.add(CLASS_COMMIT_DETAILS_OPEN);
			compareWithElem.classList.add(CLASS_COMMIT_DETAILS_OPEN);
			this.renderCommitDetailsView(false);
			this.requestCommitComparison(commit.hash, compareWithCommit.hash, false);
		}
	}

	public closeCommitComparison(saveAndRequestCommitDetails: boolean) {
		const expandedCommit = this.expandedCommit;
		if (expandedCommit === null || expandedCommit.compareWithHash === null) return;

		if (expandedCommit.compareWithElem !== null) {
			expandedCommit.compareWithElem.classList.remove(CLASS_COMMIT_DETAILS_OPEN);
		}
		GitGraphView.closeCdvContextMenuIfOpen(expandedCommit);
		if (saveAndRequestCommitDetails) {
			if (expandedCommit.commitElem !== null) {
				this.saveExpandedCommitLoading(expandedCommit.index, expandedCommit.commitHash, expandedCommit.commitElem, null, null);
				this.renderCommitDetailsView(false);
				this.requestCommitDetails(expandedCommit.commitHash, false);
			} else {
				this.closeCommitDetails(true);
			}
		}
	}

	public showCommitComparison(commitHash: string, compareWithHash: string, fileChanges: ReadonlyArray<GG.GitFileChange>, fileTree: FileTreeFolder, codeReview: GG.CodeReview | null, lastViewedFile: string | null, refresh: boolean, aiAnalysis?: AIAnalysis | null) {
		const expandedCommit = this.expandedCommit;
		if (expandedCommit === null || expandedCommit.commitElem === null || expandedCommit.compareWithElem === null || expandedCommit.commitHash !== commitHash || expandedCommit.compareWithHash !== compareWithHash) return;

		if (haveFilesChanged(expandedCommit.fileChanges, fileChanges)) {
			expandedCommit.fileChanges = fileChanges;
			expandedCommit.fileTree = fileTree;
			GitGraphView.closeCdvContextMenuIfOpen(expandedCommit);
		}
		expandedCommit.codeReview = codeReview;
		if (!refresh) {
			expandedCommit.lastViewedFile = lastViewedFile;
		}
		// Store AI analysis for comparison
		if (aiAnalysis !== undefined) {
			expandedCommit.aiAnalysis = aiAnalysis;
		}
		expandedCommit.commitElem.classList.add(CLASS_COMMIT_DETAILS_OPEN);
		expandedCommit.compareWithElem.classList.add(CLASS_COMMIT_DETAILS_OPEN);
		expandedCommit.loading = false;
		this.saveState();

		this.renderCommitDetailsView(refresh);
	}


	/* Render Commit Details / Comparison View */

	private renderCommitDetailsView(refresh: boolean) {
		const expandedCommit = this.expandedCommit;
		if (expandedCommit === null || expandedCommit.commitElem === null) return;

		let elem = document.getElementById('cdv'), html = '<div id="cdvContent">', isDocked = this.isCdvDocked();
		const commitOrder = this.getCommitOrder(expandedCommit.commitHash, expandedCommit.compareWithHash === null ? expandedCommit.commitHash : expandedCommit.compareWithHash);
		const codeReviewPossible = !expandedCommit.loading && commitOrder.to !== UNCOMMITTED;
		const externalDiffPossible = !expandedCommit.loading && (expandedCommit.compareWithHash !== null || this.commits[this.commitLookup[expandedCommit.commitHash]].parents.length > 0);

		if (elem === null) {
			elem = document.createElement(isDocked ? 'div' : 'tr');
			elem.id = 'cdv';
			elem.className = isDocked ? 'docked' : 'inline';
			this.setCdvHeight(elem, isDocked);
			if (isDocked) {
				document.body.appendChild(elem);
			} else {
				insertAfter(elem, expandedCommit.commitElem);
			}
		}

		if (expandedCommit.loading) {
			html += '<div id="cdvLoading">' + SVG_ICONS.loading + ' Loading ' + (expandedCommit.compareWithHash === null ? expandedCommit.commitHash !== UNCOMMITTED ? 'Commit Details' : 'Uncommitted Changes' : 'Commit Comparison') + ' ...</div>';
		} else {
			html += '<div id="cdvSummary">';
			if (expandedCommit.compareWithHash === null) {
				// Commit details should be shown
				if (expandedCommit.commitHash !== UNCOMMITTED) {
					const textFormatter = new TextFormatter(this.commits, this.gitRepos[this.currentRepo].issueLinkingConfig, {
						commits: true,
						emoji: true,
						issueLinking: true,
						markdown: this.config.markdown,
						multiline: true,
						urls: true
					});
					const commitDetails = expandedCommit.commitDetails!;
					const parents = commitDetails.parents.length > 0
						? commitDetails.parents.map((parent: string) => {
							const escapedParent = escapeHtml(parent);
							return typeof this.commitLookup[parent] === 'number'
								? '<span class="' + CLASS_INTERNAL_URL + '" data-type="commit" data-value="' + escapedParent + '" tabindex="-1">' + escapedParent + '</span>'
								: escapedParent;
						}).join(', ')
						: 'None';
					html += '<span class="cdvSummaryTop' + (expandedCommit.avatar !== null ? ' withAvatar' : '') + '"><span class="cdvSummaryTopRow"><span class="cdvSummaryKeyValues">'
						+ '<b>Commit: </b>' + escapeHtml(commitDetails.hash) + '<br>'
						+ '<b>Parents: </b>' + parents + '<br>'
						+ '<b>Author: </b>' + escapeHtml(commitDetails.author) + (commitDetails.authorEmail !== '' ? ' &lt;<a class="' + CLASS_EXTERNAL_URL + '" href="mailto:' + escapeHtml(commitDetails.authorEmail) + '" tabindex="-1">' + escapeHtml(commitDetails.authorEmail) + '</a>&gt;' : '') + '<br>'
						+ (commitDetails.authorDate !== commitDetails.committerDate ? '<b>Author Date: </b>' + formatLongDate(commitDetails.authorDate) + '<br>' : '')
						+ '<b>Committer: </b>' + escapeHtml(commitDetails.committer) + (commitDetails.committerEmail !== '' ? ' &lt;<a class="' + CLASS_EXTERNAL_URL + '" href="mailto:' + escapeHtml(commitDetails.committerEmail) + '" tabindex="-1">' + escapeHtml(commitDetails.committerEmail) + '</a>&gt;' : '') + (commitDetails.signature !== null ? generateSignatureHtml(commitDetails.signature) : '') + '<br>'
						+ '<b>' + (commitDetails.authorDate !== commitDetails.committerDate ? 'Committer ' : '') + 'Date: </b>' + formatLongDate(commitDetails.committerDate)
						+ '</span>'
						+ (expandedCommit.avatar !== null ? '<span class="cdvSummaryAvatar"><img src="' + expandedCommit.avatar + '"></span>' : '')
						+ '</span></span><br><br>' + textFormatter.format(commitDetails.body);
				} else {
					html += 'Displaying all uncommitted changes.';
				}
			} else {
				// Commit comparison should be shown
				html += 'Displaying all changes from <b>' + commitOrder.from + '</b> to <b>' + (commitOrder.to !== UNCOMMITTED ? commitOrder.to : 'Uncommitted Changes') + '</b>.';
			}
			html += '</div>' +
                '<div id="cdvFiles">' + generateFileViewHtml(expandedCommit.fileTree!, expandedCommit.fileChanges!, expandedCommit.lastViewedFile, expandedCommit.contextMenuOpen.fileView, this.getFileViewType(), commitOrder.to === UNCOMMITTED) + '</div>' +
                '<div id="cdvAiSummary">' + this.generateAiAnalysisHtml(expandedCommit) + '</div>' +
                '<div id="cdvDividerLeft" class="cdvDivider left"></div>' +
                '<div id="cdvDividerRight" class="cdvDivider right"></div>';
		}
		html += '</div><div id="cdvControls"><div id="cdvClose" class="cdvControlBtn" title="Close">' + SVG_ICONS.close + '</div>' +
			(codeReviewPossible ? '<div id="cdvCodeReview" class="cdvControlBtn">' + SVG_ICONS.review + '</div>' : '') +
			(!expandedCommit.loading ? '<div id="cdvFileViewTypeTree" class="cdvControlBtn cdvFileViewTypeBtn" title="File Tree View">' + SVG_ICONS.fileTree + '</div><div id="cdvFileViewTypeList" class="cdvControlBtn cdvFileViewTypeBtn" title="File List View">' + SVG_ICONS.fileList + '</div>' : '') +
			(externalDiffPossible ? '<div id="cdvExternalDiff" class="cdvControlBtn">' + SVG_ICONS.linkExternal + '</div>' : '') +
			'</div><div class="cdvHeightResize"></div>';

		elem.innerHTML = isDocked ? html : '<td><div class="cdvHeightResize"></div></td><td colspan="' + (this.getNumColumns() - 1) + '">' + html + '</td>';
		if (!expandedCommit.loading) this.setCdvDivider();
		if (!isDocked) this.renderGraph();

		if (!refresh) {
			if (isDocked) {
				let elemTop = this.controlsElem.clientHeight + expandedCommit.commitElem.offsetTop;
				if (elemTop - 8 < this.viewElem.scrollTop) {
					// Commit is above what is visible on screen
					this.viewElem.scroll(0, elemTop - 8);
				} else if (elemTop - this.viewElem.clientHeight + 32 > this.viewElem.scrollTop) {
					// Commit is below what is visible on screen
					this.viewElem.scroll(0, elemTop - this.viewElem.clientHeight + 32);
				}
			} else {
				let elemTop = this.controlsElem.clientHeight + elem.offsetTop, cdvHeight = this.gitRepos[this.currentRepo].cdvHeight;
				if (this.config.commitDetailsView.autoCenter) {
					// Center Commit Detail View setting is enabled
					// elemTop - commit height [24px] + (commit details view height + commit height [24px]) / 2 - (view height) / 2
					this.viewElem.scroll(0, elemTop - 12 + (cdvHeight - this.viewElem.clientHeight) / 2);
				} else if (elemTop - 32 < this.viewElem.scrollTop) {
					// Commit Detail View is opening above what is visible on screen
					// elemTop - commit height [24px] - desired gap from top [8px] < view scroll offset
					this.viewElem.scroll(0, elemTop - 32);
				} else if (elemTop + cdvHeight - this.viewElem.clientHeight + 8 > this.viewElem.scrollTop) {
					// Commit Detail View is opening below what is visible on screen
					// elemTop + commit details view height + desired gap from bottom [8px] - view height > view scroll offset
					this.viewElem.scroll(0, elemTop + cdvHeight - this.viewElem.clientHeight + 8);
				}
			}
		}

		this.makeCdvResizable();
		document.getElementById('cdvClose')!.addEventListener('click', () => {
			this.closeCommitDetails(true);
		});

		if (!expandedCommit.loading) {
			this.makeCdvFileViewInteractive();
			this.renderCdvFileViewTypeBtns();
			this.renderCdvExternalDiffBtn();
			this.makeCdvDividerDraggable();

			observeElemScroll('cdvSummary', expandedCommit.scrollTop.summary, (scrollTop) => {
				if (this.expandedCommit === null) return;
				this.expandedCommit.scrollTop.summary = scrollTop;
				if (this.expandedCommit.contextMenuOpen.summary) {
					this.expandedCommit.contextMenuOpen.summary = false;
					contextMenu.close();
				}
			}, () => this.saveState());

			observeElemScroll('cdvFiles', expandedCommit.scrollTop.fileView, (scrollTop) => {
				if (this.expandedCommit === null) return;
				this.expandedCommit.scrollTop.fileView = scrollTop;
				if (this.expandedCommit.contextMenuOpen.fileView > -1) {
					this.expandedCommit.contextMenuOpen.fileView = -1;
					contextMenu.close();
				}
			}, () => this.saveState());

			observeElemScroll('cdvAiSummary', expandedCommit.scrollTop.aiView || 0, (scrollTop) => {
				if (this.expandedCommit === null) return;
				if (!this.expandedCommit.scrollTop.aiView) this.expandedCommit.scrollTop.aiView = 0;
				this.expandedCommit.scrollTop.aiView = scrollTop;
			}, () => this.saveState());

			document.getElementById('cdvFileViewTypeTree')!.addEventListener('click', () => {
				this.changeFileViewType(GG.FileViewType.Tree);
			});

			document.getElementById('cdvFileViewTypeList')!.addEventListener('click', () => {
				this.changeFileViewType(GG.FileViewType.List);
			});

			if (codeReviewPossible) {
				this.renderCodeReviewBtn();
				document.getElementById('cdvCodeReview')!.addEventListener('click', (e) => {
					const expandedCommit = this.expandedCommit;
					if (expandedCommit === null || e.target === null) return;
					let sourceElem = <HTMLElement>(<Element>e.target).closest('#cdvCodeReview')!;
					if (sourceElem.classList.contains(CLASS_ACTIVE)) {
						sendMessage({ command: 'endCodeReview', repo: this.currentRepo, id: expandedCommit.codeReview!.id });
						this.endCodeReview();
					} else {
						const commitOrder = this.getCommitOrder(expandedCommit.commitHash, expandedCommit.compareWithHash === null ? expandedCommit.commitHash : expandedCommit.compareWithHash);
						const id = expandedCommit.compareWithHash !== null ? commitOrder.from + '-' + commitOrder.to : expandedCommit.commitHash;
						sendMessage({
							command: 'startCodeReview',
							repo: this.currentRepo,
							id: id,
							commitHash: expandedCommit.commitHash,
							compareWithHash: expandedCommit.compareWithHash,
							files: getFilesInTree(expandedCommit.fileTree!),
							lastViewedFile: expandedCommit.lastViewedFile
						});
					}
				});
			}

			if (externalDiffPossible) {
				document.getElementById('cdvExternalDiff')!.addEventListener('click', () => {
					const expandedCommit = this.expandedCommit;
					if (expandedCommit === null || this.gitConfig === null || (this.gitConfig.diffTool === null && this.gitConfig.guiDiffTool === null)) return;
					const commitOrder = this.getCommitOrder(expandedCommit.commitHash, expandedCommit.compareWithHash === null ? expandedCommit.commitHash : expandedCommit.compareWithHash);
					runAction({
						command: 'openExternalDirDiff',
						repo: this.currentRepo,
						fromHash: commitOrder.from,
						toHash: commitOrder.to,
						isGui: this.gitConfig.guiDiffTool !== null
					}, 'Opening External Directory Diff');
				});
			}
		}
	}

	/**
     * Generate HTML for AI analysis section with enhanced error handling and progress display
     */
	private generateAiAnalysisHtml(expandedCommit: ExpandedCommit): string {
		if (expandedCommit.compareWithHash === null) {
			// Single commit view
			return this.getSingleCommitAiAnalysisHtml(expandedCommit);
		} else {
			// Comparison view
			return this.getComparisonAiAnalysisHtml(expandedCommit);
		}
	}

	/**
     * Generate AI analysis HTML for a single commit with error handling
     */
	private getSingleCommitAiAnalysisHtml(expandedCommit: ExpandedCommit): string {
		const commitDetails = expandedCommit.commitDetails;
		if (!commitDetails) {
			return '<h4>AI Analysis</h4><div class="ai-analysis-error"><p>Unable to analyze this commit.</p></div>';
		}

		const aiAnalysis = expandedCommit.aiAnalysis;

		// Handle successful analysis first (status completed or has summary)
		if (aiAnalysis && (aiAnalysis.status === 'completed' || aiAnalysis.summary)) {
			return this.generateAiSuccessHtml('AI Analysis', aiAnalysis);
		}

		// Handle error states
		if (aiAnalysis && aiAnalysis.error) {
			return this.generateAiErrorHtml('AI Analysis', aiAnalysis);
		}

		// Handle progress state
		if (aiAnalysis && aiAnalysis.status === 'analyzing' && aiAnalysis.progress) {
			return this.generateAiProgressHtml('AI Analysis', aiAnalysis.progress);
		}

		// Handle other analyzing states without progress
		if (aiAnalysis && aiAnalysis.status === 'analyzing') {
			return this.generateAiLoadingHtml('AI Analysis', commitDetails.fileChanges.length, 'Analysis in progress...');
		}

		// Default loading state
		return this.generateAiLoadingHtml('AI Analysis', commitDetails.fileChanges.length);
	}

	/**
     * Generate AI analysis HTML for a comparison between commits with error handling
     */
	private getComparisonAiAnalysisHtml(expandedCommit: ExpandedCommit): string {
		const fileChanges = expandedCommit.fileChanges;
		if (!fileChanges) {
			return '<h4>AI Comparison Analysis</h4><div class="ai-analysis-error"><p>Unable to analyze this comparison.</p></div>';
		}

		const aiAnalysis = expandedCommit.aiAnalysis;

		// Handle successful analysis first (status completed or has summary)
		if (aiAnalysis && (aiAnalysis.status === 'completed' || aiAnalysis.summary)) {
			return this.generateAiSuccessHtml('AI Comparison Analysis', aiAnalysis);
		}

		// Handle error states
		if (aiAnalysis && aiAnalysis.error) {
			return this.generateAiErrorHtml('AI Comparison Analysis', aiAnalysis);
		}

		// Handle progress state
		if (aiAnalysis && aiAnalysis.status === 'analyzing' && aiAnalysis.progress) {
			return this.generateAiProgressHtml('AI Comparison Analysis', aiAnalysis.progress);
		}

		// Handle other analyzing states without progress
		if (aiAnalysis && aiAnalysis.status === 'analyzing') {
			return this.generateAiLoadingHtml('AI Comparison Analysis', fileChanges.length, `Analysis in progress... ${this.generateComparisonStatsText(fileChanges)}`);
		}

		// Default loading state with file statistics
		return this.generateAiLoadingHtml('AI Comparison Analysis', fileChanges.length, this.generateComparisonStatsText(fileChanges));
	}

	/**
	 * Generate comparison statistics text
	 */
	private generateComparisonStatsText(fileChanges: ReadonlyArray<GG.GitFileChange>): string {
		const additions = fileChanges.filter(f => f.type === GG.GitFileStatus.Added).length;
		const modifications = fileChanges.filter(f => f.type === GG.GitFileStatus.Modified).length;
		const deletions = fileChanges.filter(f => f.type === GG.GitFileStatus.Deleted).length;
		const renames = fileChanges.filter(f => f.type === GG.GitFileStatus.Renamed).length;

		return `This comparison includes ${additions} added file${additions !== 1 ? 's' : ''}, ` +
			`${modifications} modified file${modifications !== 1 ? 's' : ''}, ` +
			`${deletions} deleted file${deletions !== 1 ? 's' : ''}` +
			(renames > 0 ? `, and ${renames} renamed file${renames !== 1 ? 's' : ''}` : '') + '.';
	}

	/**
	 * Generate HTML for error states
	 */
	private generateAiErrorHtml(title: string, aiAnalysis: AIAnalysis): string {
		const errorTypeMessages: { [key: string]: { icon: string, title: string, suggestion: string } } = {
			'disabled': {
				icon: '⚙️',
				title: 'AI Analysis Disabled',
				suggestion: 'Enable AI analysis in the extension settings to see intelligent insights.'
			},
			'no_readable_files': {
				icon: '📄',
				title: 'No Readable Files',
				suggestion: 'This commit contains only binary files, images, or excluded file types.'
			},
			'diff_extraction_failed': {
				icon: '🔧',
				title: 'Content Extraction Failed',
				suggestion: 'Unable to extract file differences. Try refreshing the commit details.'
			},
			'analysis_failed': {
				icon: '🤖',
				title: 'Analysis Generation Failed',
				suggestion: 'The AI service processed the files but could not generate meaningful analysis.'
			},
			'timeout': {
				icon: '⏱️',
				title: 'Analysis Timed Out',
				suggestion: 'The files may be too large or the AI service is overloaded. Try again later.'
			},
			'service_unavailable': {
				icon: '🔌',
				title: 'AI Service Unavailable',
				suggestion: 'The AI service is not running. Check your service configuration.'
			},
			'authentication_failed': {
				icon: '🔐',
				title: 'Authentication Failed',
				suggestion: 'Check your AI service API configuration and credentials.'
			},
			'rate_limited': {
				icon: '🚦',
				title: 'Rate Limit Exceeded',
				suggestion: 'The AI service has reached its request limit. Please try again later.'
			},
			'unknown_error': {
				icon: '❗',
				title: 'Unexpected Error',
				suggestion: 'An unexpected error occurred. Check the extension logs for more details.'
			}
		};

		const errorInfo = errorTypeMessages[aiAnalysis.errorType || 'unknown_error'] || errorTypeMessages['unknown_error'];

		return `<h4>${title}</h4>
		<div class="ai-analysis-error">
			<div class="error-header">
				<span class="error-icon">${errorInfo.icon}</span>
				<span class="error-title">${errorInfo.title}</span>
			</div>
			<p class="error-message">${aiAnalysis.error}</p>
			<p class="error-suggestion">${errorInfo.suggestion}</p>
			${aiAnalysis.details && aiAnalysis.details.totalFiles ?
		`<p class="error-details">Total files in commit: ${aiAnalysis.details.totalFiles}</p>` : ''}
			${aiAnalysis.technicalError ?
		`<details class="error-technical">
					<summary>Technical Details</summary>
					<pre>${aiAnalysis.technicalError}</pre>
				</details>` : ''}
		</div>`;
	}

	/**
	 * Generate HTML for progress states
	 */
	private generateAiProgressHtml(title: string, progress: { current: number, total: number, message: string }): string {
		const percentage = Math.round((progress.current / progress.total) * 100);

		return `<h4>${title}</h4>
		<div class="ai-analysis-progress">
			<div class="progress-header">
				<span class="progress-icon">🤖</span>
				<span class="progress-title">Analyzing Files...</span>
			</div>
			<div class="progress-bar-container">
				<div class="progress-bar" style="width: ${percentage}%"></div>
			</div>
			<p class="progress-text">${progress.message} (${progress.current}/${progress.total})</p>
			<p class="progress-percentage">${percentage}% complete</p>
		</div>`;
	}

	/**
	 * Generate HTML for successful analysis
	 */
	private generateAiSuccessHtml(title: string, aiAnalysis: AIAnalysis): string {
		let content = `<h4>${title}</h4>`;

		// Check if it's the new structured format
		if (aiAnalysis.summary && (aiAnalysis.summary.includes('<div class="ai-commit-summary">') || aiAnalysis.summary.includes('<div class="ai-comparison-summary">'))) {
			content += aiAnalysis.summary;
		} else {
			// Legacy format
			content += `<div class="ai-analysis-content">
				<p class="aiSummary">${aiAnalysis.summary}</p>
			</div>`;
		}

		// Add analysis metadata if available
		if (aiAnalysis.filesAnalyzed !== undefined && aiAnalysis.totalFiles !== undefined) {
			content += `<div class="ai-analysis-metadata">
				<p class="analysis-stats">Analyzed ${aiAnalysis.filesAnalyzed} of ${aiAnalysis.totalFiles} files</p>
			</div>`;
		}

		return content;
	}

	/**
	 * Generate HTML for loading states
	 */
	private generateAiLoadingHtml(title: string, fileCount: number, customMessage?: string): string {
		return `<h4>${title}</h4>
		<div class="ai-analysis-loading">
			<div class="loading-header">
				<span class="loading-icon">⏳</span>
				<span class="loading-title">Preparing Analysis...</span>
			</div>
			<p class="loading-message">${customMessage || `Preparing to analyze ${fileCount} file${fileCount !== 1 ? 's' : ''}...`}</p>
			<div class="loading-spinner">
				<div class="spinner"></div>
			</div>
		</div>`;
	}

	private setCdvHeight(elem: HTMLElement, isDocked: boolean) {
		let height = this.gitRepos[this.currentRepo].cdvHeight, windowHeight = window.innerHeight;
		if (height > windowHeight - 40) {
			height = Math.max(windowHeight - 40, 100);
			if (height !== this.gitRepos[this.currentRepo].cdvHeight) {
				this.gitRepos[this.currentRepo].cdvHeight = height;
				this.saveRepoState();
			}
		}

		let heightPx = height + 'px';
		elem.style.height = heightPx;
		if (isDocked) this.viewElem.style.bottom = heightPx;
	}

	private setCdvDivider() {
		// 获取仓库设置的分隔线位置（现在应该存储两个位置）
		let repo = this.gitRepos[this.currentRepo];
		if (!repo.cdvDividers) {
			// 如果是第一次使用新版本，初始化新的分隔线位置
			repo.cdvDividers = {
				left: repo.cdvDivider || 0.33, // 使用现有的值或默认值
				right: 0.66
			};
			// 兼容旧版本，未来可以移除
			delete repo.cdvDivider;
			this.saveRepoState();
		}

		// 设置左侧分隔线和相关元素的样式
		let leftPercent = (repo.cdvDividers.left * 100).toFixed(2) + '%';
		let rightPercent = (repo.cdvDividers.right * 100).toFixed(2) + '%';

		// 获取所有相关元素
		let summaryElem = document.getElementById('cdvSummary'),
			leftDividerElem = document.getElementById('cdvDividerLeft'),
			rightDividerElem = document.getElementById('cdvDividerRight'),
			filesElem = document.getElementById('cdvFiles'),
			aiSummaryElem = document.getElementById('cdvAiSummary');

		// 设置元素位置和宽度
		if (summaryElem !== null) {
			summaryElem.style.width = leftPercent;
		}

		if (leftDividerElem !== null) {
			leftDividerElem.style.left = leftPercent;
		}

		if (filesElem !== null) {
			filesElem.style.left = leftPercent;
			filesElem.style.width = (repo.cdvDividers.right - repo.cdvDividers.left) * 100 + '%';
		}

		if (rightDividerElem !== null) {
			rightDividerElem.style.left = rightPercent;
		}

		if (aiSummaryElem !== null) {
			aiSummaryElem.style.left = rightPercent;
		}
	}

	private makeCdvResizable() {
		let prevY = -1;

		const processResizingCdvHeight: EventListener = (e) => {
			if (prevY < 0) return;
			let delta = (<MouseEvent>e).pageY - prevY, isDocked = this.isCdvDocked(), windowHeight = window.innerHeight;
			prevY = (<MouseEvent>e).pageY;
			let height = this.gitRepos[this.currentRepo].cdvHeight + (isDocked ? -delta : delta);
			if (height < 100) height = 100;
			else if (height > 600) height = 600;
			if (height > windowHeight - 40) height = Math.max(windowHeight - 40, 100);

			if (this.gitRepos[this.currentRepo].cdvHeight !== height) {
				this.gitRepos[this.currentRepo].cdvHeight = height;
				let elem = document.getElementById('cdv');
				if (elem !== null) this.setCdvHeight(elem, isDocked);
				if (!isDocked) this.renderGraph();
			}
		};
		const stopResizingCdvHeight: EventListener = (e) => {
			if (prevY < 0) return;
			processResizingCdvHeight(e);
			this.saveRepoState();
			prevY = -1;
			eventOverlay.remove();
		};

		addListenerToClass('cdvHeightResize', 'mousedown', (e) => {
			prevY = (<MouseEvent>e).pageY;
			eventOverlay.create('rowResize', processResizingCdvHeight, stopResizingCdvHeight);
		});
	}

	private makeCdvDividerDraggable() {
		let minX = -1, width = -1, activeDivider: 'left' | 'right' | null = null;

		const processDraggingCdvDivider: EventListener = (e) => {
			if (minX < 0 || activeDivider === null) return;
			let percent = ((<MouseEvent>e).clientX - minX) / width;

			// 确保cdvDividers已初始化
			const repo = this.gitRepos[this.currentRepo];
			if (!repo.cdvDividers) {
				repo.cdvDividers = {
					left: repo.cdvDivider || 0.33,
					right: 0.66
				};
				// 兼容旧版本，未来可以移除
				delete repo.cdvDivider;
				this.saveRepoState();
			}

			// 根据当前拖动的分隔线设置不同的限制
			if (activeDivider === 'left') {
				// 左侧分隔线不能太小或太靠右
				if (percent < 0.2) percent = 0.2;
				else if (percent > repo.cdvDividers.right - 0.1) {
					percent = repo.cdvDividers.right - 0.1;
				}

				if (repo.cdvDividers.left !== percent) {
					repo.cdvDividers.left = percent;
					this.setCdvDivider();
				}
			} else if (activeDivider === 'right') {
				// 右侧分隔线不能太靠左或太靠右
				if (percent < repo.cdvDividers.left + 0.1) {
					percent = repo.cdvDividers.left + 0.1;
				} else if (percent > 0.8) percent = 0.8;

				if (repo.cdvDividers.right !== percent) {
					repo.cdvDividers.right = percent;
					this.setCdvDivider();
				}
			}
		};

		const stopDraggingCdvDivider: EventListener = (e) => {
			if (minX < 0 || activeDivider === null) return;
			processDraggingCdvDivider(e);
			this.saveRepoState();
			minX = -1;
			activeDivider = null;
			eventOverlay.remove();
		};

		// 设置左侧分隔线的拖动事件
		const leftDivider = document.getElementById('cdvDividerLeft');
		if (leftDivider) {
			leftDivider.addEventListener('mousedown', (e) => {
				e.preventDefault(); // 防止默认行为
				const contentElem = document.getElementById('cdvContent');
				if (contentElem === null) return;

				const bounds = contentElem.getBoundingClientRect();
				minX = bounds.left;
				width = bounds.width;
				activeDivider = 'left';
				eventOverlay.create('colResize', processDraggingCdvDivider, stopDraggingCdvDivider);
			});
		}

		// 设置右侧分隔线的拖动事件
		const rightDivider = document.getElementById('cdvDividerRight');
		if (rightDivider) {
			rightDivider.addEventListener('mousedown', (e) => {
				e.preventDefault(); // 防止默认行为
				const contentElem = document.getElementById('cdvContent');
				if (contentElem === null) return;

				const bounds = contentElem.getBoundingClientRect();
				minX = bounds.left;
				width = bounds.width;
				activeDivider = 'right';
				eventOverlay.create('colResize', processDraggingCdvDivider, stopDraggingCdvDivider);
			});
		}
	}

	/**
	 * Updates the state of a file in the Commit Details View.
	 * @param file The file that was affected.
	 * @param fileElem The HTML Element of the file.
	 * @param isReviewed TRUE/FALSE => Set the files reviewed state accordingly, NULL => Don't update the files reviewed state.
	 * @param fileWasViewed Was the file viewed - if so, set it to be the last viewed file.
	 */
	private cdvUpdateFileState(file: GG.GitFileChange, fileElem: HTMLElement, isReviewed: boolean | null, fileWasViewed: boolean) {
		const expandedCommit = this.expandedCommit, filesElem = document.getElementById('cdvFiles'), filePath = file.newFilePath;
		if (expandedCommit === null || expandedCommit.fileTree === null || filesElem === null) return;

		if (fileWasViewed) {
			expandedCommit.lastViewedFile = filePath;
			let lastViewedElem = document.getElementById('cdvLastFileViewed');
			if (lastViewedElem !== null) lastViewedElem.remove();
			lastViewedElem = document.createElement('span');
			lastViewedElem.id = 'cdvLastFileViewed';
			lastViewedElem.title = 'Last File Viewed';
			lastViewedElem.innerHTML = SVG_ICONS.eyeOpen;
			insertBeforeFirstChildWithClass(lastViewedElem, fileElem, 'fileTreeFileAction');
		}

		if (expandedCommit.codeReview !== null) {
			if (isReviewed !== null) {
				if (isReviewed) {
					expandedCommit.codeReview.remainingFiles = expandedCommit.codeReview.remainingFiles.filter((path: string) => path !== filePath);
				} else {
					expandedCommit.codeReview.remainingFiles.push(filePath);
				}

				alterFileTreeFileReviewed(expandedCommit.fileTree, filePath, isReviewed);
				updateFileTreeHtmlFileReviewed(filesElem, expandedCommit.fileTree, filePath);
			}

			sendMessage({
				command: 'updateCodeReview',
				repo: this.currentRepo,
				id: expandedCommit.codeReview.id,
				remainingFiles: expandedCommit.codeReview.remainingFiles,
				lastViewedFile: expandedCommit.lastViewedFile
			});

			if (expandedCommit.codeReview.remainingFiles.length === 0) {
				expandedCommit.codeReview = null;
				this.renderCodeReviewBtn();
			}
		}

		this.saveState();
	}

	private isCdvDocked() {
		return this.config.commitDetailsView.location === GG.CommitDetailsViewLocation.DockedToBottom;
	}

	public isCdvOpen(commitHash: string, compareWithHash: string | null) {
		return this.expandedCommit !== null && this.expandedCommit.commitHash === commitHash && this.expandedCommit.compareWithHash === compareWithHash;
	}

	private getCommitOrder(hash1: string, hash2: string) {
		if (this.commitLookup[hash1] > this.commitLookup[hash2]) {
			return { from: hash1, to: hash2 };
		} else {
			return { from: hash2, to: hash1 };
		}
	}

	private getFileViewType() {
		return this.gitRepos[this.currentRepo].fileViewType === GG.FileViewType.Default
			? this.config.commitDetailsView.fileViewType
			: this.gitRepos[this.currentRepo].fileViewType;
	}

	private setFileViewType(type: GG.FileViewType) {
		this.gitRepos[this.currentRepo].fileViewType = type;
		this.saveRepoState();
	}

	private changeFileViewType(type: GG.FileViewType) {
		const expandedCommit = this.expandedCommit, filesElem = document.getElementById('cdvFiles');
		if (expandedCommit === null || expandedCommit.fileTree === null || expandedCommit.fileChanges === null || filesElem === null) return;
		GitGraphView.closeCdvContextMenuIfOpen(expandedCommit);
		this.setFileViewType(type);
		const commitOrder = this.getCommitOrder(expandedCommit.commitHash, expandedCommit.compareWithHash === null ? expandedCommit.commitHash : expandedCommit.compareWithHash);
		filesElem.innerHTML = generateFileViewHtml(expandedCommit.fileTree, expandedCommit.fileChanges, expandedCommit.lastViewedFile, expandedCommit.contextMenuOpen.fileView, type, commitOrder.to === UNCOMMITTED);
		this.makeCdvFileViewInteractive();
		this.renderCdvFileViewTypeBtns();
	}

	private makeCdvFileViewInteractive() {
		const getFileElemOfEventTarget = (target: EventTarget) => <HTMLElement>(<Element>target).closest('.fileTreeFileRecord');
		const getFileOfFileElem = (fileChanges: ReadonlyArray<GG.GitFileChange>, fileElem: HTMLElement) => fileChanges[parseInt(fileElem.dataset.index!)];

		const getCommitHashForFile = (file: GG.GitFileChange, expandedCommit: ExpandedCommit) => {
			const commit = this.commits[this.commitLookup[expandedCommit.commitHash]];
			if (expandedCommit.compareWithHash !== null) {
				return this.getCommitOrder(expandedCommit.commitHash, expandedCommit.compareWithHash).to;
			} else if (commit.stash !== null && file.type === GG.GitFileStatus.Untracked) {
				return commit.stash.untrackedFilesHash!;
			} else {
				return expandedCommit.commitHash;
			}
		};

		const triggerViewFileDiff = (file: GG.GitFileChange, fileElem: HTMLElement) => {
			const expandedCommit = this.expandedCommit;
			if (expandedCommit === null) return;

			let commit = this.commits[this.commitLookup[expandedCommit.commitHash]], fromHash: string, toHash: string, fileStatus = file.type;
			if (expandedCommit.compareWithHash !== null) {
				// Commit Comparison
				const commitOrder = this.getCommitOrder(expandedCommit.commitHash, expandedCommit.compareWithHash);
				fromHash = commitOrder.from;
				toHash = commitOrder.to;
			} else if (commit.stash !== null) {
				// Stash Commit
				if (fileStatus === GG.GitFileStatus.Untracked) {
					fromHash = commit.stash.untrackedFilesHash!;
					toHash = commit.stash.untrackedFilesHash!;
					fileStatus = GG.GitFileStatus.Added;
				} else {
					fromHash = commit.stash.baseHash;
					toHash = expandedCommit.commitHash;
				}
			} else {
				// Single Commit
				fromHash = expandedCommit.commitHash;
				toHash = expandedCommit.commitHash;
			}

			this.cdvUpdateFileState(file, fileElem, true, true);
			sendMessage({
				command: 'viewDiff',
				repo: this.currentRepo,
				fromHash: fromHash,
				toHash: toHash,
				oldFilePath: file.oldFilePath,
				newFilePath: file.newFilePath,
				type: fileStatus
			});
		};

		const triggerCopyFilePath = (file: GG.GitFileChange, absolute: boolean) => {
			sendMessage({ command: 'copyFilePath', repo: this.currentRepo, filePath: file.newFilePath, absolute: absolute });
		};

		const triggerResetFileToRevision = (file: GG.GitFileChange, fileElem: HTMLElement) => {
			const expandedCommit = this.expandedCommit;
			if (expandedCommit === null) return;

			const commitHash = getCommitHashForFile(file, expandedCommit);
			dialog.showConfirmation('Are you sure you want to reset <b><i>' + escapeHtml(file.newFilePath) + '</i></b> to it\'s state at commit <b><i>' + abbrevCommit(commitHash) + '</i></b>? Any uncommitted changes made to this file will be overwritten.', 'Yes, reset file', () => {
				runAction({ command: 'resetFileToRevision', repo: this.currentRepo, commitHash: commitHash, filePath: file.newFilePath }, 'Resetting file');
			}, {
				type: TargetType.CommitDetailsView,
				hash: commitHash,
				elem: fileElem
			});
		};

		const triggerViewFileAtRevision = (file: GG.GitFileChange, fileElem: HTMLElement) => {
			const expandedCommit = this.expandedCommit;
			if (expandedCommit === null) return;

			this.cdvUpdateFileState(file, fileElem, true, true);
			sendMessage({ command: 'viewFileAtRevision', repo: this.currentRepo, hash: getCommitHashForFile(file, expandedCommit), filePath: file.newFilePath });
		};

		const triggerViewFileDiffWithWorkingFile = (file: GG.GitFileChange, fileElem: HTMLElement) => {
			const expandedCommit = this.expandedCommit;
			if (expandedCommit === null) return;

			this.cdvUpdateFileState(file, fileElem, null, true);
			sendMessage({ command: 'viewDiffWithWorkingFile', repo: this.currentRepo, hash: getCommitHashForFile(file, expandedCommit), filePath: file.newFilePath });
		};

		const triggerOpenFile = (file: GG.GitFileChange, fileElem: HTMLElement) => {
			const expandedCommit = this.expandedCommit;
			if (expandedCommit === null) return;

			this.cdvUpdateFileState(file, fileElem, true, true);
			sendMessage({ command: 'openFile', repo: this.currentRepo, hash: getCommitHashForFile(file, expandedCommit), filePath: file.newFilePath });
		};

		addListenerToClass('fileTreeFolder', 'click', (e) => {
			let expandedCommit = this.expandedCommit;
			if (expandedCommit === null || expandedCommit.fileTree === null || e.target === null) return;

			let sourceElem = <HTMLElement>(<Element>e.target).closest('.fileTreeFolder');
			let parent = sourceElem.parentElement!;
			parent.classList.toggle('closed');
			let isOpen = !parent.classList.contains('closed');
			parent.children[0].children[0].innerHTML = isOpen ? SVG_ICONS.openFolder : SVG_ICONS.closedFolder;
			parent.children[1].classList.toggle('hidden');
			alterFileTreeFolderOpen(expandedCommit.fileTree, decodeURIComponent(sourceElem.dataset.folderpath!), isOpen);
			this.saveState();
		});

		addListenerToClass('fileTreeRepo', 'click', (e) => {
			if (e.target === null) return;
			this.loadRepos(this.gitRepos, null, {
				repo: decodeURIComponent((<HTMLElement>(<Element>e.target).closest('.fileTreeRepo')).dataset.path!)
			});
		});

		addListenerToClass('fileTreeFile', 'click', (e) => {
			const expandedCommit = this.expandedCommit;
			if (expandedCommit === null || expandedCommit.fileChanges === null || e.target === null) return;

			const sourceElem = <HTMLElement>(<Element>e.target).closest('.fileTreeFile'), fileElem = getFileElemOfEventTarget(e.target);
			if (!sourceElem.classList.contains('gitDiffPossible')) return;
			triggerViewFileDiff(getFileOfFileElem(expandedCommit.fileChanges, fileElem), fileElem);
		});

		addListenerToClass('copyGitFile', 'click', (e) => {
			const expandedCommit = this.expandedCommit;
			if (expandedCommit === null || expandedCommit.fileChanges === null || e.target === null) return;

			const fileElem = getFileElemOfEventTarget(e.target);
			triggerCopyFilePath(getFileOfFileElem(expandedCommit.fileChanges, fileElem), true);
		});

		addListenerToClass('viewGitFileAtRevision', 'click', (e) => {
			const expandedCommit = this.expandedCommit;
			if (expandedCommit === null || expandedCommit.fileChanges === null || e.target === null) return;

			const fileElem = getFileElemOfEventTarget(e.target);
			triggerViewFileAtRevision(getFileOfFileElem(expandedCommit.fileChanges, fileElem), fileElem);
		});

		addListenerToClass('openGitFile', 'click', (e) => {
			const expandedCommit = this.expandedCommit;
			if (expandedCommit === null || expandedCommit.fileChanges === null || e.target === null) return;

			const fileElem = getFileElemOfEventTarget(e.target);
			triggerOpenFile(getFileOfFileElem(expandedCommit.fileChanges, fileElem), fileElem);
		});

		addListenerToClass('fileTreeFileRecord', 'contextmenu', (e: Event) => {
			handledEvent(e);
			const expandedCommit = this.expandedCommit;
			if (expandedCommit === null || expandedCommit.fileChanges === null || e.target === null) return;
			const fileElem = getFileElemOfEventTarget(e.target);
			const file = getFileOfFileElem(expandedCommit.fileChanges, fileElem);
			const commitOrder = this.getCommitOrder(expandedCommit.commitHash, expandedCommit.compareWithHash === null ? expandedCommit.commitHash : expandedCommit.compareWithHash);
			const isUncommitted = commitOrder.to === UNCOMMITTED;

			GitGraphView.closeCdvContextMenuIfOpen(expandedCommit);
			expandedCommit.contextMenuOpen.fileView = parseInt(fileElem.dataset.index!);

			const target: ContextMenuTarget & CommitTarget = {
				type: TargetType.CommitDetailsView,
				hash: expandedCommit.commitHash,
				index: this.commitLookup[expandedCommit.commitHash],
				elem: fileElem
			};
			const diffPossible = file.type === GG.GitFileStatus.Untracked || (file.additions !== null && file.deletions !== null);
			const fileExistsAtThisRevision = file.type !== GG.GitFileStatus.Deleted && !isUncommitted;
			const fileExistsAtThisRevisionAndDiffPossible = fileExistsAtThisRevision && diffPossible;
			const codeReviewInProgressAndNotReviewed = expandedCommit.codeReview !== null && expandedCommit.codeReview.remainingFiles.includes(file.newFilePath);
			const visibility = this.config.contextMenuActionsVisibility.commitDetailsViewFile;

			contextMenu.show([
				[
					{
						title: 'View Diff',
						visible: visibility.viewDiff && diffPossible,
						onClick: () => triggerViewFileDiff(file, fileElem)
					},
					{
						title: 'View File at this Revision',
						visible: visibility.viewFileAtThisRevision && fileExistsAtThisRevisionAndDiffPossible,
						onClick: () => triggerViewFileAtRevision(file, fileElem)
					},
					{
						title: 'View Diff with Working File',
						visible: visibility.viewDiffWithWorkingFile && fileExistsAtThisRevisionAndDiffPossible,
						onClick: () => triggerViewFileDiffWithWorkingFile(file, fileElem)
					},
					{
						title: 'Open File',
						visible: visibility.openFile && file.type !== GG.GitFileStatus.Deleted,
						onClick: () => triggerOpenFile(file, fileElem)
					}
				],
				[
					{
						title: 'View File History',
						visible: true,
						onClick: () => this.showFileHistory(file.newFilePath)
					}
				],
				[
					{
						title: 'Mark as Reviewed',
						visible: visibility.markAsReviewed && codeReviewInProgressAndNotReviewed,
						onClick: () => this.cdvUpdateFileState(file, fileElem, true, false)
					},
					{
						title: 'Mark as Not Reviewed',
						visible: visibility.markAsNotReviewed && expandedCommit.codeReview !== null && !codeReviewInProgressAndNotReviewed,
						onClick: () => this.cdvUpdateFileState(file, fileElem, false, false)
					}
				],
				[
					{
						title: 'Reset File to this Revision' + ELLIPSIS,
						visible: visibility.resetFileToThisRevision && fileExistsAtThisRevision && expandedCommit.compareWithHash === null,
						onClick: () => triggerResetFileToRevision(file, fileElem)
					}
				],
				[
					{
						title: 'Copy Absolute File Path to Clipboard',
						visible: visibility.copyAbsoluteFilePath,
						onClick: () => triggerCopyFilePath(file, true)
					},
					{
						title: 'Copy Relative File Path to Clipboard',
						visible: visibility.copyRelativeFilePath,
						onClick: () => triggerCopyFilePath(file, false)
					}
				]
			], false, target, <MouseEvent>e, this.isCdvDocked() ? document.body : this.viewElem, () => {
				expandedCommit.contextMenuOpen.fileView = -1;
			});
		});
	}

	private renderCdvFileViewTypeBtns() {
		if (this.expandedCommit === null) return;
		let treeBtnElem = document.getElementById('cdvFileViewTypeTree'), listBtnElem = document.getElementById('cdvFileViewTypeList');
		if (treeBtnElem === null || listBtnElem === null) return;

		let listView = this.getFileViewType() === GG.FileViewType.List;
		alterClass(treeBtnElem, CLASS_ACTIVE, !listView);
		alterClass(listBtnElem, CLASS_ACTIVE, listView);
	}

	private renderCdvExternalDiffBtn() {
		if (this.expandedCommit === null) return;
		const externalDiffBtnElem = document.getElementById('cdvExternalDiff');
		if (externalDiffBtnElem === null) return;

		alterClass(externalDiffBtnElem, CLASS_ENABLED, this.gitConfig !== null && (this.gitConfig.diffTool !== null || this.gitConfig.guiDiffTool !== null));
		const toolName = this.gitConfig !== null
			? this.gitConfig.guiDiffTool !== null
				? this.gitConfig.guiDiffTool
				: this.gitConfig.diffTool
			: null;
		externalDiffBtnElem.title = 'Open External Directory Diff' + (toolName !== null ? ' with "' + toolName + '"' : '');
	}

	private static closeCdvContextMenuIfOpen(expandedCommit: ExpandedCommit) {
		if (expandedCommit.contextMenuOpen.summary || expandedCommit.contextMenuOpen.fileView > -1) {
			expandedCommit.contextMenuOpen.summary = false;
			expandedCommit.contextMenuOpen.fileView = -1;
			contextMenu.close();
		}
	}


	/* Code Review */

	public startCodeReview(commitHash: string, compareWithHash: string | null, codeReview: GG.CodeReview) {
		if (this.expandedCommit === null || this.expandedCommit.commitHash !== commitHash || this.expandedCommit.compareWithHash !== compareWithHash) return;
		this.saveAndRenderCodeReview(codeReview);
	}

	public endCodeReview() {
		if (this.expandedCommit === null || this.expandedCommit.codeReview === null) return;
		this.saveAndRenderCodeReview(null);
	}

	private saveAndRenderCodeReview(codeReview: GG.CodeReview | null) {
		let filesElem = document.getElementById('cdvFiles');
		if (this.expandedCommit === null || this.expandedCommit.fileTree === null || filesElem === null) return;

		this.expandedCommit.codeReview = codeReview;
		setFileTreeReviewed(this.expandedCommit.fileTree, codeReview === null);
		this.saveState();
		this.renderCodeReviewBtn();
		updateFileTreeHtml(filesElem, this.expandedCommit.fileTree);
	}

	private renderCodeReviewBtn() {
		if (this.expandedCommit === null) return;
		let btnElem = document.getElementById('cdvCodeReview');
		if (btnElem === null) return;

		let active = this.expandedCommit.codeReview !== null;
		alterClass(btnElem, CLASS_ACTIVE, active);
		btnElem.title = (active ? 'End' : 'Start') + ' Code Review';
	}

	/**
	 * Update AI analysis for the currently expanded commit
	 * @param commitHash The commit hash
	 * @param compareWithHash The commit hash to compare with (optional)
	 * @param aiAnalysis The AI analysis result
	 */
	public updateAIAnalysis(commitHash: string, compareWithHash: string | null, aiAnalysis: AIAnalysis | null) {
		// Check if this update is for the currently expanded commit
		if (this.expandedCommit !== null &&
			this.expandedCommit.commitHash === commitHash &&
			this.expandedCommit.compareWithHash === compareWithHash) {

			// Update the AI analysis
			this.expandedCommit.aiAnalysis = aiAnalysis;

			// Re-render the commit details view to show the updated AI analysis
			this.renderCommitDetailsView(false);
		}
	}

	/**
	 * Show file history for a specific file
	 * @param filePath The path of the file
	 */
	public showFileHistory(filePath: string) {
		// 发送消息到后端，在新标签页中打开文件历史
		sendMessage({
			command: 'openFileHistoryInNewTab',
			repo: this.currentRepo,
			filePath: filePath
		});
	}
}

/* Global Message Handling and Initialization */

// Global GitGraphView instance
let gitGraphView: GitGraphView;

// Initialize the Git Graph View
function initializeGitGraphView() {
	const viewElem = document.getElementById('view');
	if (viewElem) {
		gitGraphView = new GitGraphView(viewElem, null);

		// Initialize global dialog, contextMenu, and eventOverlay instances
		dialog = new Dialog();
		contextMenu = new ContextMenu();
		eventOverlay = new EventOverlay();
	}
}

// Handle messages from the backend
function handleMessage(event: MessageEvent) {
	const msg = event.data as GG.ResponseMessage;

	switch (msg.command) {
		case 'loadRepos':
			gitGraphView.loadRepos(msg.repos, msg.lastActiveRepo, msg.loadViewTo);
			break;
		case 'loadRepoInfo':
			gitGraphView.processLoadRepoInfoResponse(msg);
			break;
		case 'loadCommits':
			gitGraphView.processLoadCommitsResponse(msg);
			break;
		case 'loadConfig':
			gitGraphView.processLoadConfig(msg);
			break;
		case 'commitDetails':
			if (msg.commitDetails) {
				// Create file tree from commit details file changes
				const fileTree = gitGraphView.createFileTree(msg.commitDetails.fileChanges, msg.codeReview);
				gitGraphView.showCommitDetails(msg.commitDetails, fileTree, msg.avatar, msg.codeReview, null, msg.refresh);
			}
			break;
		case 'compareCommits':
			// Create file tree from comparison file changes
			const fileTree = gitGraphView.createFileTree(msg.fileChanges, msg.codeReview);
			gitGraphView.showCommitComparison(msg.commitHash, msg.compareWithHash, msg.fileChanges, fileTree, msg.codeReview, null, msg.refresh, msg.aiAnalysis);
			break;
		case 'tagDetails':
			if (msg.tagName && msg.commitHash && msg.details) {
				gitGraphView.renderTagDetails(msg.tagName, msg.commitHash, msg.details);
			}
			break;
		case 'fetchAvatar':
			gitGraphView.loadAvatar(msg.email, msg.image);
			break;
		case 'aiAnalysisUpdate':
			gitGraphView.updateAIAnalysis(msg.commitHash, msg.compareWithHash, msg.aiAnalysis);
			break;
	}
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', initializeGitGraphView);
} else {
	initializeGitGraphView();
}

// Listen for messages from the backend
window.addEventListener('message', handleMessage);

// Additional missing file tree functions
function alterFileTreeFileReviewed(_fileTree: FileTreeFolder, _filePath: string, _isReviewed: boolean | null): void {
	// Recursively find and update file review status
	const updateFileReviewed = (folder: FileTreeFolder): boolean => {
		for (const key in folder.contents) {
			const item = folder.contents[key];
			if (item.type === 'folder') {
				if (updateFileReviewed(item)) {
					return true;
				}
			} else if (item.type === 'file' && item.name === _filePath) {
				item.reviewed = _isReviewed !== null ? _isReviewed : true;
				return true;
			}
		}
		return false;
	};

	updateFileReviewed(_fileTree);
}

function updateFileTreeHtmlFileReviewed(_filesElem: HTMLElement, _fileTree: FileTreeFolder, _filePath: string): void {
	// Find and update the HTML element for the specific file
	const fileElem = _filesElem.querySelector(`[data-filepath="${CSS.escape(_filePath)}"]`);
	if (fileElem) {
		// Find the file in the tree to get its review status
		const findFileInTree = (folder: FileTreeFolder): { reviewed: boolean | null } | null => {
			for (const key in folder.contents) {
				const item = folder.contents[key];
				if (item.type === 'folder') {
					const result = findFileInTree(item);
					if (result) return result;
				} else if (item.type === 'file' && item.name === _filePath) {
					return { reviewed: item.reviewed };
				}
			}
			return null;
		};

		const fileInfo = findFileInTree(_fileTree);
		if (fileInfo) {
			if (fileInfo.reviewed) {
				fileElem.classList.remove('pendingReview');
			} else {
				fileElem.classList.add('pendingReview');
			}
		}
	}
}

function alterFileTreeFolderOpen(_fileTree: FileTreeFolder, _folderPath: string, _isOpen: boolean): void {
	// Recursively find and update folder open state
	const updateFolderOpen = (folder: FileTreeFolder): boolean => {
		if (folder.folderPath === _folderPath) {
			folder.open = _isOpen;
			return true;
		}

		for (const key in folder.contents) {
			const item = folder.contents[key];
			if (item.type === 'folder') {
				if (updateFolderOpen(item)) {
					return true;
				}
			}
		}
		return false;
	};

	updateFolderOpen(_fileTree);
}

function setFileTreeReviewed(_fileTree: FileTreeFolder | null, _isReviewed: boolean): void {
	if (!_fileTree) return;

	// Recursively set all files and folders as reviewed or not reviewed
	const setAllReviewed = (folder: FileTreeFolder) => {
		folder.reviewed = _isReviewed;

		for (const key in folder.contents) {
			const item = folder.contents[key];
			if (item.type === 'folder') {
				setAllReviewed(item);
			} else if (item.type === 'file') {
				item.reviewed = _isReviewed;
			}
		}
	};

	setAllReviewed(_fileTree);
}

function updateFileTreeHtml(filesElem: HTMLElement, fileTree: FileTreeFolder): void {
	// Regenerate the entire file tree HTML
	// We need to access the GitGraphView instance to get the file view type
	const expandedCommit = (gitGraphView as any).expandedCommit;

	if (expandedCommit && gitGraphView) {
		// Use a simple approach to get file view type
		const fileViewTypeElem = document.getElementById('cdvFileViewTypeTree');
		const isTreeView = fileViewTypeElem ? fileViewTypeElem.classList.contains('active') : true;
		const fileViewType = isTreeView ? GG.FileViewType.Tree : GG.FileViewType.List;

		const newHtml = generateFileViewHtml(
			fileTree,
			expandedCommit.fileChanges,
			expandedCommit.lastViewedFile,
			null, // contextMenuOpen
			fileViewType,
			expandedCommit.commitHash === null
		);
		filesElem.innerHTML = newHtml;

		// Re-setup event listeners for the new HTML
		// We'll call the public method through the instance
		(gitGraphView as any).makeCdvFileViewInteractive();
	}
}

