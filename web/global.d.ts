import * as GG from '../out/src/types'; // Import types from back-end (requires `npm run compile-src`)

// 扩展 GitRepoState 类型以包括新的属性
type ExtendedGitRepoState = GG.GitRepoState & {
	cdvDividers?: {
		left: number,
		right: number
	};
};

declare global {

	/* Visual Studio Code API Types */

	function acquireVsCodeApi(): {
		getState: () => WebViewState | null,
		postMessage: (message: GG.RequestMessage) => void,
		setState: (state: WebViewState) => void
	};


	/* State Types */

	type Config = GG.GitGraphViewConfig;

	const initialState: GG.GitGraphViewInitialState;
	const globalState: GG.DeepReadonly<GG.GitGraphViewGlobalState>;
	const workspaceState: GG.DeepReadonly<GG.GitGraphViewWorkspaceState>;

	type AvatarImageCollection = { [email: string]: string };

	interface AIAnalysis {
		summary?: string;
		error?: string;
		errorType?: 'disabled' | 'no_readable_files' | 'diff_extraction_failed' | 'analysis_failed' | 'timeout' | 'service_unavailable' | 'authentication_failed' | 'rate_limited' | 'invalid_response' | 'unknown_error';
		technicalError?: string;
		status?: 'analyzing' | 'completed' | 'error';
		progress?: {
			current: number;
			total: number;
			message: string;
		};
		details?: {
			totalFiles?: number;
			message?: string;
		};
		filesAnalyzed?: number;
		totalFiles?: number;
	}

	interface ExpandedCommit {
		index: number;
		commitHash: string;
		commitElem: HTMLElement | null;
		compareWithHash: string | null;
		compareWithElem: HTMLElement | null;
		commitDetails: GG.GitCommitDetails | null;
		fileChanges: ReadonlyArray<GG.GitFileChange> | null;
		fileTree: FileTreeFolder | null;
		avatar: string | null;
		codeReview: GG.CodeReview | null;
		lastViewedFile: string | null;
		loading: boolean;
		aiAnalysis: AIAnalysis | null;
		scrollTop: {
			summary: number,
			fileView: number,
			aiView: number
		};
		contextMenuOpen: {
			summary: boolean,
			fileView: number
		};
	}

	interface WebViewState {
		readonly currentRepo: string;
		readonly currentRepoLoading: boolean;
		readonly gitRepos: { [repo: string]: ExtendedGitRepoState }; // 使用扩展的 GitRepoState
		readonly gitBranches: ReadonlyArray<string>;
		readonly gitBranchHead: string | null;
		readonly gitConfig: GG.GitRepoConfig | null;
		readonly gitRemotes: ReadonlyArray<string>;
		readonly gitStashes: ReadonlyArray<GG.GitStash>;
		readonly gitTags: ReadonlyArray<string>;
		readonly commits: GG.GitCommit[];
		readonly commitHead: string | null;
		readonly avatars: AvatarImageCollection;
		readonly currentBranches: string[] | null;
		readonly moreCommitsAvailable: boolean;
		readonly maxCommits: number;
		readonly onlyFollowFirstParent: boolean;
		readonly expandedCommit: ExpandedCommit | null;
		readonly scrollTop: number;
		readonly findWidget: FindWidgetState;
		readonly settingsWidget: SettingsWidgetState;
	}


	/* Commit Details / Comparison View File Tree Types */

	interface FileTreeFile {
		readonly type: 'file';
		readonly name: string;
		readonly index: number;
		reviewed: boolean;
	}

	interface FileTreeRepo {
		readonly type: 'repo';
		readonly name: string;
		readonly path: string;
	}

	interface FileTreeFolder {
		readonly type: 'folder';
		readonly name: string;
		readonly folderPath: string;
		readonly contents: FileTreeFolderContents;
		open: boolean;
		reviewed: boolean;
	}

	type FileTreeLeaf = FileTreeFile | FileTreeRepo;
	type FileTreeNode = FileTreeFolder | FileTreeLeaf;
	type FileTreeFolderContents = { [name: string]: FileTreeNode };


	/* Dialog & ContextMenu shared base Target interfaces */

	const enum TargetType {
		Commit = 'commit',
		CommitDetailsView = 'cdv',
		Ref = 'ref',
		Repo = 'repo'
	}

	interface CommitOrRefTarget {
		type: TargetType.Commit | TargetType.Ref | TargetType.CommitDetailsView;
		elem: HTMLElement;
	}

	interface RepoTarget {
		type: TargetType.Repo;
	}

	interface CommitTarget extends CommitOrRefTarget {
		hash: string;
	}

	interface RefTarget extends CommitTarget {
		ref: string;
	}
}

// Add back the namespace exports
export as namespace GG;
export = GG;
