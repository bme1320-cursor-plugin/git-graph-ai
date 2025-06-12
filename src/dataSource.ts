import * as cp from 'child_process';
import * as fs from 'fs';
import { decode, encodingExists } from 'iconv-lite';
import * as path from 'path';
import * as vscode from 'vscode';
import { AskpassEnvironment, AskpassManager } from './askpass/askpassManager';
import { getConfig } from './config';
import { Logger } from './logger';
import { CommitOrdering, DateType, DeepWriteable, ErrorInfo, ErrorInfoExtensionPrefix, FileHistoryAIAnalysis, FileVersionComparisonAIAnalysis, GitCommit, GitCommitDetails, GitCommitStash, GitConfigLocation, GitFileChange, GitFileHistoryCommit, GitFileHistoryData, GitFileStatus, GitFileVersionComparisonData, GitPushBranchMode, GitRepoConfig, GitRepoConfigBranches, GitResetMode, GitSignature, GitSignatureStatus, GitStash, GitTagDetails, MergeActionOn, RebaseActionOn, SquashMessageFormat, TagType, Writeable } from './types';
import { GitExecutable, GitVersionRequirement, UNABLE_TO_FIND_GIT_MSG, UNCOMMITTED, abbrevCommit, constructIncompatibleGitVersionMessage, doesVersionMeetRequirement, getPathFromStr, getPathFromUri, openGitTerminal, pathWithTrailingSlash, realpath, resolveSpawnOutput, showErrorMessage } from './utils';
import { Disposable } from './utils/disposable';
import { Event } from './utils/event';
import { analyzeDiff, analyzeFileHistory, analyzeFileVersionComparison } from './aiService';
import { FileTypeDetector } from './fileTypeDetector';

const DRIVE_LETTER_PATH_REGEX = /^[a-z]:\//;
const EOL_REGEX = /\r\n|\r|\n/g;
const INVALID_BRANCH_REGEXP = /^\(.* .*\)$/;
const REMOTE_HEAD_BRANCH_REGEXP = /^remotes\/.*\/HEAD$/;
const GIT_LOG_SEPARATOR = 'XX7Nal-YARtTpjCikii9nJxER19D6diSyk-AWkPb';

export const enum GitConfigKey {
	DiffGuiTool = 'diff.guitool',
	DiffTool = 'diff.tool',
	RemotePushDefault = 'remote.pushdefault',
	UserEmail = 'user.email',
	UserName = 'user.name'
}

const GPG_STATUS_CODE_PARSING_DETAILS: Readonly<{ [statusCode: string]: GpgStatusCodeParsingDetails }> = {
	'GOODSIG': { status: GitSignatureStatus.GoodAndValid, uid: true },
	'BADSIG': { status: GitSignatureStatus.Bad, uid: true },
	'ERRSIG': { status: GitSignatureStatus.CannotBeChecked, uid: false },
	'EXPSIG': { status: GitSignatureStatus.GoodButExpired, uid: true },
	'EXPKEYSIG': { status: GitSignatureStatus.GoodButMadeByExpiredKey, uid: true },
	'REVKEYSIG': { status: GitSignatureStatus.GoodButMadeByRevokedKey, uid: true }
};

/**
 * Interfaces Git Graph with the Git executable to provide all Git integrations.
 */
export class DataSource extends Disposable {
	private readonly logger: Logger;
	private readonly askpassEnv: AskpassEnvironment;
	private gitExecutable!: GitExecutable | null;
	private gitExecutableSupportsGpgInfo!: boolean;
	private gitFormatCommitDetails!: string;
	private gitFormatLog!: string;
	private gitFormatStash!: string;
	private aiAnalysisUpdateCallback?: (commitHash: string, compareWithHash: string | null, aiAnalysis: any) => void;

	/**
	 * Creates a DataSource instance.
	 * @param gitExecutable The Git executable available to Git Graph at startup.
	 * @param onDidChangeConfiguration The Event emitting when the configuration changes.
	 * @param onDidChangeGitExecutable The Event emitting the Git executable for Git Graph to use.
	 * @param logger The Git Graph Logger instance.
	 */
	constructor(gitExecutable: GitExecutable | null, onDidChangeConfiguration: Event<vscode.ConfigurationChangeEvent>, onDidChangeGitExecutable: Event<GitExecutable>, logger: Logger) {
		super();
		this.logger = logger;
		this.setGitExecutable(gitExecutable);

		const askpassManager = new AskpassManager();
		this.askpassEnv = askpassManager.getEnv();

		this.registerDisposables(
			onDidChangeConfiguration((event) => {
				if (
					event.affectsConfiguration('git-graph.date.type') || event.affectsConfiguration('git-graph.dateType') ||
					event.affectsConfiguration('git-graph.repository.commits.showSignatureStatus') || event.affectsConfiguration('git-graph.showSignatureStatus') ||
					event.affectsConfiguration('git-graph.repository.useMailmap') || event.affectsConfiguration('git-graph.useMailmap')
				) {
					this.generateGitCommandFormats();
				}
			}),
			onDidChangeGitExecutable((gitExecutable) => {
				this.setGitExecutable(gitExecutable);
			}),
			askpassManager
		);
	}

	/**
	 * Check if the Git executable is unknown.
	 * @returns TRUE => Git executable is unknown, FALSE => Git executable is known.
	 */
	public isGitExecutableUnknown() {
		return this.gitExecutable === null;
	}

	/**
	 * Set the Git executable used by the DataSource.
	 * @param gitExecutable The Git executable.
	 */
	private setGitExecutable(gitExecutable: GitExecutable | null) {
		this.gitExecutable = gitExecutable;
		this.gitExecutableSupportsGpgInfo = gitExecutable !== null && doesVersionMeetRequirement(gitExecutable.version, GitVersionRequirement.GpgInfo);
		this.generateGitCommandFormats();
	}

	/**
	 * Generate the format strings used by various Git commands.
	 */
	private generateGitCommandFormats() {
		const config = getConfig();
		const dateType = config.dateType === DateType.Author ? '%at' : '%ct';
		const useMailmap = config.useMailmap;

		this.gitFormatCommitDetails = [
			'%H', '%P', // Hash & Parent Information
			useMailmap ? '%aN' : '%an', useMailmap ? '%aE' : '%ae', '%at', useMailmap ? '%cN' : '%cn', useMailmap ? '%cE' : '%ce', '%ct', // Author / Commit Information
			...(config.showSignatureStatus && this.gitExecutableSupportsGpgInfo ? ['%G?', '%GS', '%GK'] : ['', '', '']), // GPG Key Information
			'%B' // Body
		].join(GIT_LOG_SEPARATOR);

		this.gitFormatLog = [
			'%H', '%P', // Hash & Parent Information
			useMailmap ? '%aN' : '%an', useMailmap ? '%aE' : '%ae', dateType, // Author / Commit Information
			'%s' // Subject
		].join(GIT_LOG_SEPARATOR);

		this.gitFormatStash = [
			'%H', '%P', '%gD', // Hash, Parent & Selector Information
			useMailmap ? '%aN' : '%an', useMailmap ? '%aE' : '%ae', dateType, // Author / Commit Information
			'%s' // Subject
		].join(GIT_LOG_SEPARATOR);
	}


	/* Get Data Methods - Core */

	/**
	 * Get the high-level information of a repository.
	 * @param repo The path of the repository.
	 * @param showRemoteBranches Are remote branches shown.
	 * @param showStashes Are stashes shown.
	 * @param hideRemotes An array of hidden remotes.
	 * @returns The repositories information.
	 */
	public getRepoInfo(repo: string, showRemoteBranches: boolean, showStashes: boolean, hideRemotes: ReadonlyArray<string>): Promise<GitRepoInfo> {
		return Promise.all([
			this.getBranches(repo, showRemoteBranches, hideRemotes),
			this.getRemotes(repo),
			showStashes ? this.getStashes(repo) : Promise.resolve([])
		]).then((results) => {
			return { branches: results[0].branches, head: results[0].head, remotes: results[1], stashes: results[2], error: null };
		}).catch((errorMessage) => {
			return { branches: [], head: null, remotes: [], stashes: [], error: errorMessage };
		});
	}

	/**
	 * Get the commits in a repository.
	 * @param repo The path of the repository.
	 * @param branches The list of branch heads to display, or NULL (show all).
	 * @param maxCommits The maximum number of commits to return.
	 * @param showTags Are tags are shown.
	 * @param showRemoteBranches Are remote branches shown.
	 * @param includeCommitsMentionedByReflogs Should commits mentioned by reflogs being included.
	 * @param onlyFollowFirstParent Only follow the first parent of commits.
	 * @param commitOrdering The order for commits to be returned.
	 * @param remotes An array of known remotes.
	 * @param hideRemotes An array of hidden remotes.
	 * @param stashes An array of all stashes in the repository.
	 * @returns The commits in the repository.
	 */
	public getCommits(repo: string, branches: ReadonlyArray<string> | null, maxCommits: number, showTags: boolean, showRemoteBranches: boolean, includeCommitsMentionedByReflogs: boolean, onlyFollowFirstParent: boolean, commitOrdering: CommitOrdering, remotes: ReadonlyArray<string>, hideRemotes: ReadonlyArray<string>, stashes: ReadonlyArray<GitStash>): Promise<GitCommitData> {
		const config = getConfig();
		return Promise.all([
			this.getLog(repo, branches, maxCommits + 1, showTags && config.showCommitsOnlyReferencedByTags, showRemoteBranches, includeCommitsMentionedByReflogs, onlyFollowFirstParent, commitOrdering, remotes, hideRemotes, stashes),
			this.getRefs(repo, showRemoteBranches, config.showRemoteHeads, hideRemotes).then((refData: GitRefData) => refData, (errorMessage: string) => errorMessage)
		]).then(async (results) => {
			let commits: GitCommitRecord[] = results[0], refData: GitRefData | string = results[1], i;
			let moreCommitsAvailable = commits.length === maxCommits + 1;
			if (moreCommitsAvailable) commits.pop();

			// It doesn't matter if getRefs() was rejected if no commits exist
			if (typeof refData === 'string') {
				// getRefs() returned an error message (string)
				if (commits.length > 0) {
					// Commits exist, throw the error
					throw refData;
				} else {
					// No commits exist, so getRefs() will always return an error. Set refData to the default value
					refData = { head: null, heads: [], tags: [], remotes: [] };
				}
			}

			if (refData.head !== null && config.showUncommittedChanges) {
				for (i = 0; i < commits.length; i++) {
					if (refData.head === commits[i].hash) {
						const numUncommittedChanges = await this.getUncommittedChanges(repo);
						if (numUncommittedChanges > 0) {
							commits.unshift({ hash: UNCOMMITTED, parents: [refData.head], author: '*', email: '', date: Math.round((new Date()).getTime() / 1000), message: 'Uncommitted Changes (' + numUncommittedChanges + ')' });
						}
						break;
					}
				}
			}

			let commitNodes: DeepWriteable<GitCommit>[] = [];
			let commitLookup: { [hash: string]: number } = {};

			for (i = 0; i < commits.length; i++) {
				commitLookup[commits[i].hash] = i;
				commitNodes.push({ ...commits[i], heads: [], tags: [], remotes: [], stash: null });
			}

			/* Insert Stashes */
			let toAdd: { index: number, data: GitStash }[] = [];
			for (i = 0; i < stashes.length; i++) {
				if (typeof commitLookup[stashes[i].hash] === 'number') {
					commitNodes[commitLookup[stashes[i].hash]].stash = {
						selector: stashes[i].selector,
						baseHash: stashes[i].baseHash,
						untrackedFilesHash: stashes[i].untrackedFilesHash
					};
				} else if (typeof commitLookup[stashes[i].baseHash] === 'number') {
					toAdd.push({ index: commitLookup[stashes[i].baseHash], data: stashes[i] });
				}
			}
			toAdd.sort((a, b) => a.index !== b.index ? a.index - b.index : b.data.date - a.data.date);
			for (i = toAdd.length - 1; i >= 0; i--) {
				let stash = toAdd[i].data;
				commitNodes.splice(toAdd[i].index, 0, {
					hash: stash.hash,
					parents: [stash.baseHash],
					author: stash.author,
					email: stash.email,
					date: stash.date,
					message: stash.message,
					heads: [], tags: [], remotes: [],
					stash: {
						selector: stash.selector,
						baseHash: stash.baseHash,
						untrackedFilesHash: stash.untrackedFilesHash
					}
				});
			}
			for (i = 0; i < commitNodes.length; i++) {
				// Correct commit lookup after stashes have been spliced in
				commitLookup[commitNodes[i].hash] = i;
			}

			/* Annotate Heads */
			for (i = 0; i < refData.heads.length; i++) {
				if (typeof commitLookup[refData.heads[i].hash] === 'number') commitNodes[commitLookup[refData.heads[i].hash]].heads.push(refData.heads[i].name);
			}

			/* Annotate Tags */
			if (showTags) {
				for (i = 0; i < refData.tags.length; i++) {
					if (typeof commitLookup[refData.tags[i].hash] === 'number') commitNodes[commitLookup[refData.tags[i].hash]].tags.push({ name: refData.tags[i].name, annotated: refData.tags[i].annotated });
				}
			}

			/* Annotate Remotes */
			for (i = 0; i < refData.remotes.length; i++) {
				if (typeof commitLookup[refData.remotes[i].hash] === 'number') {
					let name = refData.remotes[i].name;
					let remote = remotes.find(remote => name.startsWith(remote + '/'));
					commitNodes[commitLookup[refData.remotes[i].hash]].remotes.push({ name: name, remote: remote ? remote : null });
				}
			}

			return {
				commits: commitNodes,
				head: refData.head,
				tags: unique(refData.tags.map((tag) => tag.name)),
				moreCommitsAvailable: moreCommitsAvailable,
				error: null
			};
		}).catch((errorMessage) => {
			return { commits: [], head: null, tags: [], moreCommitsAvailable: false, error: errorMessage };
		});
	}

	/**
	 * Get various Git config variables for a repository that are consumed by the Git Graph View.
	 * @param repo The path of the repository.
	 * @param remotes An array of known remotes.
	 * @returns The config data.
	 */
	public getConfig(repo: string, remotes: ReadonlyArray<string>): Promise<GitRepoConfigData> {
		return Promise.all([
			this.getConfigList(repo),
			this.getConfigList(repo, GitConfigLocation.Local),
			this.getConfigList(repo, GitConfigLocation.Global)
		]).then((results) => {
			const consolidatedConfigs = results[0], localConfigs = results[1], globalConfigs = results[2];

			const branches: GitRepoConfigBranches = {};
			Object.keys(localConfigs).forEach((key) => {
				if (key.startsWith('branch.')) {
					if (key.endsWith('.remote')) {
						const branchName = key.substring(7, key.length - 7);
						branches[branchName] = {
							pushRemote: typeof branches[branchName] !== 'undefined' ? branches[branchName].pushRemote : null,
							remote: localConfigs[key]
						};
					} else if (key.endsWith('.pushremote')) {
						const branchName = key.substring(7, key.length - 11);
						branches[branchName] = {
							pushRemote: localConfigs[key],
							remote: typeof branches[branchName] !== 'undefined' ? branches[branchName].remote : null
						};
					}
				}
			});

			return {
				config: {
					branches: branches,
					diffTool: getConfigValue(consolidatedConfigs, GitConfigKey.DiffTool),
					guiDiffTool: getConfigValue(consolidatedConfigs, GitConfigKey.DiffGuiTool),
					pushDefault: getConfigValue(consolidatedConfigs, GitConfigKey.RemotePushDefault),
					remotes: remotes.map((remote) => ({
						name: remote,
						url: getConfigValue(localConfigs, 'remote.' + remote + '.url'),
						pushUrl: getConfigValue(localConfigs, 'remote.' + remote + '.pushurl')
					})),
					user: {
						name: {
							local: getConfigValue(localConfigs, GitConfigKey.UserName),
							global: getConfigValue(globalConfigs, GitConfigKey.UserName)
						},
						email: {
							local: getConfigValue(localConfigs, GitConfigKey.UserEmail),
							global: getConfigValue(globalConfigs, GitConfigKey.UserEmail)
						}
					}
				},
				error: null
			};
		}).catch((errorMessage) => {
			return { config: null, error: errorMessage };
		});
	}


	/* Get Data Methods - Commit Details View */

	/**
	 * Get the commit details for the Commit Details View.
	 * @param repo The path of the repository.
	 * @param commitHash The hash of the commit open in the Commit Details View.
	 * @param hasParents Does the commit have parents
	 * @returns The commit details.
	 */
	public getCommitDetails(repo: string, commitHash: string, hasParents: boolean): Promise<GitCommitDetailsData> {
		const fromCommit = commitHash + (hasParents ? '^' : '');
		return Promise.all([
			this.getCommitDetailsBase(repo, commitHash),
			this.getDiffNameStatus(repo, fromCommit, commitHash),
			this.getDiffNumStat(repo, fromCommit, commitHash)
		]).then(async (results) => {
			const commitDetailsBase = results[0];
			commitDetailsBase.fileChanges = generateFileChanges(results[1], results[2], null);

			// 立即返回基本的commit details，不等待AI分析
			const basicResult = { commitDetails: commitDetailsBase, error: null };

			// 获取AI分析配置
			const config = getConfig();
			const aiConfig = config.aiAnalysis;

			// 异步执行AI分析，不阻塞基本信息的返回
			if (aiConfig.enabled) {
				this.performAsyncCommitAnalysis(repo, commitHash, commitDetailsBase, fromCommit, aiConfig)
					.catch(error => {
						this.logger.logError(`Async AI analysis failed for commit ${commitHash}: ${error}`);
					});
			}

			return basicResult;
		}).catch((errorMessage) => {
			return { commitDetails: null, error: errorMessage };
		});
	}

	/**
	 * Enhanced AI analysis with detailed error handling and fallback information
	 */
	private async performAsyncCommitAnalysis(
		repo: string,
		commitHash: string,
		commitDetails: any,
		fromCommit: string,
		aiConfig: any
	): Promise<void> {
		try {
			// 检查 AI 分析是否启用
			if (!aiConfig.enabled) {
				this.sendAIAnalysisUpdate(commitHash, null, {
					error: 'AI analysis is disabled in settings',
					errorType: 'disabled'
				});
				return;
			}

			this.logger.log(`Starting AI analysis for commit: ${commitHash}`);

			// 发送初始进度更新
			this.sendAIAnalysisUpdate(commitHash, null, {
				status: 'analyzing',
				progress: {
					current: 0,
					total: commitDetails.fileChanges.length,
					message: `Scanning ${commitDetails.fileChanges.length} files for analysis eligibility...`
				}
			});

			// 使用智能文件类型检测器来过滤符合条件的文件，添加超时和错误处理
			const eligibleFiles = await this.filterEligibleFilesWithTimeout(
				commitDetails.fileChanges,
				aiConfig,
				repo,
				commitHash,
				10000 // 10秒超时
			);

			// 检查是否有可分析的文件
			if (eligibleFiles.length === 0) {
				this.sendAIAnalysisUpdate(commitHash, null, {
					error: 'No readable files found for AI analysis',
					errorType: 'no_readable_files',
					details: {
						totalFiles: commitDetails.fileChanges.length,
						message: 'This commit contains no files that can be analyzed by AI. This may include binary files, images, or files excluded by your configuration.'
					}
				});
				return;
			}

			// 限制分析的文件数量
			const filesToAnalyze = eligibleFiles.slice(0, aiConfig.maxFilesPerAnalysis);
			this.logger.log(`Found ${eligibleFiles.length} eligible files for AI analysis out of ${commitDetails.fileChanges.length} total files, analyzing ${filesToAnalyze.length}`);

			// 发送进度更新
			this.sendAIAnalysisUpdate(commitHash, null, {
				status: 'analyzing',
				progress: {
					current: 0,
					total: filesToAnalyze.length,
					message: `Analyzing ${filesToAnalyze.length} files...`
				}
			});

			// 获取文件内容和差异
			const fileAnalysisData = [];
			for (let i = 0; i < filesToAnalyze.length; i++) {
				const fileChange = filesToAnalyze[i];
				try {
					const diffContent = await this.getDiffBetweenRevisions(repo, fromCommit, commitHash, fileChange.newFilePath);

					if (diffContent) {
						// 更新进度
						this.sendAIAnalysisUpdate(commitHash, null, {
							status: 'analyzing',
							progress: {
								current: i + 1,
								total: filesToAnalyze.length,
								message: `Processing ${fileChange.newFilePath}...`
							}
						});

						fileAnalysisData.push({
							filePath: fileChange.newFilePath,
							diffContent: diffContent,
							contentBefore: null,
							contentAfter: null,
							type: fileChange.type
						});
					}
				} catch (error) {
					this.logger.log(`Failed to get diff for file ${fileChange.newFilePath}: ${error}`);
				}
			}

			if (fileAnalysisData.length === 0) {
				this.sendAIAnalysisUpdate(commitHash, null, {
					error: 'Failed to extract file differences for analysis',
					errorType: 'diff_extraction_failed',
					details: {
						message: 'Could not generate diffs for the files in this commit.'
					}
				});
				return;
			}

			// 生成 AI 分析
			const analysis = await this.generateComprehensiveCommitAnalysis(commitDetails, fileAnalysisData, this.logger);

			if (analysis) {
				this.sendAIAnalysisUpdate(commitHash, null, {
					...analysis,
					status: 'completed',
					filesAnalyzed: fileAnalysisData.length,
					totalFiles: commitDetails.fileChanges.length
				});
			} else {
				this.sendAIAnalysisUpdate(commitHash, null, {
					error: 'AI analysis failed to generate results',
					errorType: 'analysis_failed',
					details: {
						message: 'The AI service processed the files but could not generate meaningful analysis.'
					}
				});
			}

		} catch (error) {
			this.logger.logError(`AI analysis failed for commit ${commitHash}: ${error}`);

			// 根据错误类型发送相应的错误信息
			if (error instanceof Error) {
				if (error.message.includes('timeout') || error.message.includes('TIMEOUT')) {
					this.sendAIAnalysisUpdate(commitHash, null, {
						error: 'AI analysis timed out',
						errorType: 'timeout',
						details: {
							message: 'The analysis took too long to complete. This may be due to processing a large number of files or temporary service issues.'
						},
						technicalError: error.message
					});
				} else if (error.message.includes('ECONNREFUSED') || error.message.includes('ENOTFOUND')) {
					this.sendAIAnalysisUpdate(commitHash, null, {
						error: 'AI service is unavailable',
						errorType: 'service_unavailable',
						details: {
							message: 'Could not connect to the AI analysis service. Please check your AI service configuration and network connectivity.'
						},
						technicalError: error.message
					});
				} else if (error.message.includes('401') || error.message.includes('403') || error.message.includes('authentication')) {
					this.sendAIAnalysisUpdate(commitHash, null, {
						error: 'Authentication failed',
						errorType: 'authentication_failed',
						details: {
							message: 'AI service authentication failed. Please check your API key or credentials in the settings.'
						},
						technicalError: error.message
					});
				} else if (error.message.includes('429') || error.message.includes('rate limit')) {
					this.sendAIAnalysisUpdate(commitHash, null, {
						error: 'Rate limit exceeded',
						errorType: 'rate_limited',
						details: {
							message: 'Too many requests to the AI service. Please wait a moment before trying again.'
						},
						technicalError: error.message
					});
				} else {
					this.sendAIAnalysisUpdate(commitHash, null, {
						error: 'AI analysis encountered an unexpected error',
						errorType: 'unknown_error',
						details: {
							message: 'An unexpected error occurred during analysis. Please try again or check the logs for more details.'
						},
						technicalError: error.message
					});
				}
			} else {
				this.sendAIAnalysisUpdate(commitHash, null, {
					error: 'AI analysis failed with unknown error',
					errorType: 'unknown_error',
					details: {
						message: 'An unknown error occurred during analysis.'
					}
				});
			}
		}
	}

	/**
	 * Filter eligible files with timeout and progress tracking
	 */
	private async filterEligibleFilesWithTimeout(
		fileChanges: any[],
		aiConfig: any,
		repo: string,
		commitHash: string,
		timeoutMs: number = 10000
	): Promise<any[]> {
		const startTime = Date.now();
		const eligibleFiles: any[] = [];

		// 分析新增、修改和重命名的文件（排除删除的文件，因为没有内容可分析）
		const candidateFiles = fileChanges.filter(fileChange =>
			fileChange.type === GitFileStatus.Added ||
			fileChange.type === GitFileStatus.Modified ||
			fileChange.type === GitFileStatus.Renamed
		);

		this.logger.log(`Filtering ${candidateFiles.length} candidate files for eligibility`);

		for (let i = 0; i < candidateFiles.length; i++) {
			// 检查超时
			if (Date.now() - startTime > timeoutMs) {
				this.logger.log(`File eligibility check timed out after processing ${i}/${candidateFiles.length} files`);
				break;
			}

			// 每处理10个文件更新一次进度
			if (i % 10 === 0) {
				this.sendAIAnalysisUpdate(commitHash, null, {
					status: 'analyzing',
					progress: {
						current: i,
						total: candidateFiles.length,
						message: `Checking file eligibility (${i}/${candidateFiles.length})...`
					}
				});
			}

			const fileChange = candidateFiles[i];

			try {
				// 为每个文件设置更短的超时
				const isEligible = await Promise.race([
					this.isFileEligibleForAIAnalysis(fileChange, aiConfig, repo),
					new Promise<boolean>((_, reject) =>
						setTimeout(() => reject(new Error('File check timeout')), 1000)
					)
				]);

				if (isEligible) {
					eligibleFiles.push(fileChange);
				}
			} catch (error) {
				this.logger.log(`Failed to check eligibility for ${fileChange.newFilePath}: ${error}`);
				// 如果检测失败，使用简单的扩展名检查作为回退
				const ext = fileChange.newFilePath.substring(fileChange.newFilePath.lastIndexOf('.')).toLowerCase();
				if (aiConfig.supportedFileExtensions &&
					aiConfig.supportedFileExtensions.some((supportedExt: string) => ext === supportedExt.toLowerCase())) {
					eligibleFiles.push(fileChange);
				}
			}
		}

		this.logger.log(`File eligibility check completed: ${eligibleFiles.length}/${candidateFiles.length} eligible`);
		return eligibleFiles;
	}

	/**
	 * Get the stash details for the Commit Details View.
	 * @param repo The path of the repository.
	 * @param commitHash The hash of the stash commit open in the Commit Details View.
	 * @param stash The stash.
	 * @returns The stash details.
	 */
	public getStashDetails(repo: string, commitHash: string, stash: GitCommitStash): Promise<GitCommitDetailsData> {
		return Promise.all([
			this.getCommitDetailsBase(repo, commitHash),
			this.getDiffNameStatus(repo, stash.baseHash, commitHash),
			this.getDiffNumStat(repo, stash.baseHash, commitHash),
			stash.untrackedFilesHash !== null ? this.getDiffNameStatus(repo, stash.untrackedFilesHash, stash.untrackedFilesHash) : Promise.resolve([]),
			stash.untrackedFilesHash !== null ? this.getDiffNumStat(repo, stash.untrackedFilesHash, stash.untrackedFilesHash) : Promise.resolve([])
		]).then((results) => {
			results[0].fileChanges = generateFileChanges(results[1], results[2], null);
			if (stash.untrackedFilesHash !== null) {
				generateFileChanges(results[3], results[4], null).forEach((fileChange) => {
					if (fileChange.type === GitFileStatus.Added) {
						fileChange.type = GitFileStatus.Untracked;
						results[0].fileChanges.push(fileChange);
					}
				});
			}
			return { commitDetails: results[0], error: null };
		}).catch((errorMessage) => {
			return { commitDetails: null, error: errorMessage };
		});
	}

	/**
	 * Get the uncommitted details for the Commit Details View.
	 * @param repo The path of the repository.
	 * @returns The uncommitted details.
	 */
	public getUncommittedDetails(repo: string): Promise<GitCommitDetailsData> {
		return Promise.all([
			this.getDiffNameStatus(repo, 'HEAD', ''),
			this.getDiffNumStat(repo, 'HEAD', ''),
			this.getStatus(repo)
		]).then(async (results) => {
			const fileChanges = generateFileChanges(results[0], results[1], results[2]);
			const commitDetails = {
				hash: UNCOMMITTED, parents: [],
				author: '', authorEmail: '', authorDate: 0,
				committer: '', committerEmail: '', committerDate: 0, signature: null,
				body: '', fileChanges: fileChanges
			};

			// 立即返回基本的 uncommitted details，不等待AI分析
			const basicResult = { commitDetails: commitDetails, error: null };

			// 获取AI分析配置
			const config = getConfig();
			const aiConfig = config.aiAnalysis;

			// 异步执行AI分析，不阻塞基本信息的返回
			if (aiConfig.enabled && fileChanges.length > 0) {
				this.performAsyncUncommittedAnalysis(repo, commitDetails, aiConfig)
					.catch(error => {
						this.logger.logError(`Async AI analysis failed for uncommitted changes: ${error}`);
					});
			}

			return basicResult;
		}).catch((errorMessage) => {
			return { commitDetails: null, error: errorMessage };
		});
	}

	/**
	 * Enhanced AI analysis for uncommitted changes with detailed error handling
	 */
	private async performAsyncUncommittedAnalysis(
		repo: string,
		commitDetails: any,
		aiConfig: any
	): Promise<void> {
		try {
			// 检查 AI 分析是否启用
			if (!aiConfig.enabled) {
				this.sendAIAnalysisUpdate(UNCOMMITTED, null, {
					error: 'AI analysis is disabled in settings',
					errorType: 'disabled'
				});
				return;
			}

			this.logger.log('Starting AI analysis for uncommitted changes');

			// 发送初始进度更新
			this.sendAIAnalysisUpdate(UNCOMMITTED, null, {
				status: 'analyzing',
				progress: {
					current: 0,
					total: commitDetails.fileChanges.length,
					message: `Scanning ${commitDetails.fileChanges.length} uncommitted files for analysis eligibility...`
				}
			});

			// 使用智能文件类型检测器来过滤符合条件的文件，添加超时和错误处理
			const eligibleFiles = await this.filterEligibleFilesWithTimeout(
				commitDetails.fileChanges,
				aiConfig,
				repo,
				UNCOMMITTED,
				10000 // 10秒超时
			);

			// 检查是否有可分析的文件
			if (eligibleFiles.length === 0) {
				this.sendAIAnalysisUpdate(UNCOMMITTED, null, {
					error: 'No readable files found for AI analysis',
					errorType: 'no_readable_files',
					details: {
						totalFiles: commitDetails.fileChanges.length,
						message: 'The uncommitted changes contain no files that can be analyzed by AI. This may include binary files, images, or files excluded by your configuration.'
					}
				});
				return;
			}

			// 限制分析的文件数量
			const filesToAnalyze = eligibleFiles.slice(0, aiConfig.maxFilesPerAnalysis);
			this.logger.log(`Found ${eligibleFiles.length} eligible files for AI analysis out of ${commitDetails.fileChanges.length} total uncommitted files, analyzing ${filesToAnalyze.length}`);

			// 发送进度更新
			this.sendAIAnalysisUpdate(UNCOMMITTED, null, {
				status: 'analyzing',
				progress: {
					current: 0,
					total: filesToAnalyze.length,
					message: `Analyzing ${filesToAnalyze.length} uncommitted files...`
				}
			});

			// 获取文件内容和差异
			const fileAnalysisData = [];
			for (let i = 0; i < filesToAnalyze.length; i++) {
				const fileChange = filesToAnalyze[i];
				try {
					// 对于uncommitted changes，使用HEAD作为fromHash，空字符串作为toHash
					const diffContent = await this.getDiffBetweenRevisions(repo, 'HEAD', '', fileChange.newFilePath);

					if (diffContent) {
						// 更新进度
						this.sendAIAnalysisUpdate(UNCOMMITTED, null, {
							status: 'analyzing',
							progress: {
								current: i + 1,
								total: filesToAnalyze.length,
								message: `Processing ${fileChange.newFilePath}...`
							}
						});

						fileAnalysisData.push({
							filePath: fileChange.newFilePath,
							diffContent: diffContent,
							contentBefore: null,
							contentAfter: null,
							type: fileChange.type
						});
					}
				} catch (error) {
					this.logger.log(`Failed to get diff for uncommitted file ${fileChange.newFilePath}: ${error}`);
				}
			}

			if (fileAnalysisData.length === 0) {
				this.sendAIAnalysisUpdate(UNCOMMITTED, null, {
					error: 'Failed to extract file differences for analysis',
					errorType: 'diff_extraction_failed',
					details: {
						message: 'Could not generate diffs for the uncommitted files.'
					}
				});
				return;
			}

			// 生成 AI 分析
			const analysis = await this.generateComprehensiveUncommittedAnalysis(fileAnalysisData, this.logger);

			if (analysis) {
				this.sendAIAnalysisUpdate(UNCOMMITTED, null, {
					...analysis,
					status: 'completed',
					filesAnalyzed: fileAnalysisData.length,
					totalFiles: commitDetails.fileChanges.length
				});
			} else {
				this.sendAIAnalysisUpdate(UNCOMMITTED, null, {
					error: 'AI analysis failed to generate results',
					errorType: 'analysis_failed',
					details: {
						message: 'The AI service processed the uncommitted files but could not generate meaningful analysis.'
					}
				});
			}

		} catch (error) {
			this.logger.logError(`AI analysis failed for uncommitted changes: ${error}`);

			// 根据错误类型发送相应的错误信息
			if (error instanceof Error) {
				if (error.message.includes('timeout') || error.message.includes('TIMEOUT')) {
					this.sendAIAnalysisUpdate(UNCOMMITTED, null, {
						error: 'AI analysis timed out',
						errorType: 'timeout',
						details: {
							message: 'The analysis took too long to complete. This may be due to processing a large number of files or temporary service issues.'
						},
						technicalError: error.message
					});
				} else if (error.message.includes('ECONNREFUSED') || error.message.includes('ENOTFOUND')) {
					this.sendAIAnalysisUpdate(UNCOMMITTED, null, {
						error: 'AI service is unavailable',
						errorType: 'service_unavailable',
						details: {
							message: 'Could not connect to the AI analysis service. Please check your AI service configuration and network connectivity.'
						},
						technicalError: error.message
					});
				} else if (error.message.includes('401') || error.message.includes('403') || error.message.includes('authentication')) {
					this.sendAIAnalysisUpdate(UNCOMMITTED, null, {
						error: 'Authentication failed',
						errorType: 'authentication_failed',
						details: {
							message: 'AI service authentication failed. Please check your API key or credentials in the settings.'
						},
						technicalError: error.message
					});
				} else if (error.message.includes('429') || error.message.includes('rate limit')) {
					this.sendAIAnalysisUpdate(UNCOMMITTED, null, {
						error: 'Rate limit exceeded',
						errorType: 'rate_limited',
						details: {
							message: 'Too many requests to the AI service. Please wait a moment before trying again.'
						},
						technicalError: error.message
					});
				} else {
					this.sendAIAnalysisUpdate(UNCOMMITTED, null, {
						error: 'AI analysis encountered an unexpected error',
						errorType: 'unknown_error',
						details: {
							message: 'An unexpected error occurred during analysis. Please try again or check the logs for more details.'
						},
						technicalError: error.message
					});
				}
			} else {
				this.sendAIAnalysisUpdate(UNCOMMITTED, null, {
					error: 'AI analysis failed with unknown error',
					errorType: 'unknown_error',
					details: {
						message: 'An unknown error occurred during analysis.'
					}
				});
			}
		}
	}

	/**
	 * Generate comprehensive uncommitted changes analysis using AI service
	 * @param fileAnalysisData Array of file analysis data
	 * @param logger Logger instance
	 * @returns AI analysis result
	 */
	private async generateComprehensiveUncommittedAnalysis(
		fileAnalysisData: Array<{
			filePath: string;
			diffContent: string;
			contentBefore: string | null;
			contentAfter: string | null;
			type: GitFileStatus;
		}>,
		logger: Logger
	): Promise<{ summary: string } | null> {
		try {
			// 数据流调试：记录AI服务调用详情
			logger.log('[AI Service Call] 🎯 Starting comprehensive uncommitted changes analysis via AI service');
			logger.log(`[AI Service Call] 📊 Uncommitted data - FileCount: ${fileAnalysisData.length}`);

			// 构建详细的提示词
			const payload = {
				fileAnalysisData: fileAnalysisData.map(f => ({
					filePath: f.filePath,
					type: f.type,
					diffContent: f.diffContent.substring(0, 4000) + (f.diffContent.length > 4000 ? '...' : '')
				}))
			};
			const payloadString = JSON.stringify(payload);

			// 数据流调试：记录提示词信息
			logger.log(`[AI Service Call] 📝 Generated uncommitted payload - Length: ${payloadString.length} chars, Contains files: ${fileAnalysisData.map(f => f.filePath.split('/').pop()).join(', ')}`);

			// 构建结构化缓存键参数 (对于uncommitted changes，我们使用特殊的标识)
			const cacheKeyParams = {
				analysisType: 'comprehensive_uncommitted_analysis',
				commitHash: 'UNCOMMITTED',
				additionalContext: {
					fileCount: fileAnalysisData.length.toString(),
					timestamp: Math.floor(Date.now() / 60000).toString() // 分钟级别的时间戳，避免频繁变化
				}
			};

			// 使用真实的AI分析服务进行综合分析
			const analysis = await analyzeDiff(
				'comprehensive_uncommitted_analysis',
				payloadString,
				null,
				null,
				cacheKeyParams, // 新的结构化缓存键参数
				logger,
				30000, // 30秒超时
				0 // 初始重试计数
			);

			if (analysis) {
				// 数据流调试：记录AI服务响应
				logger.log(`[AI Service Call] ✅ AI service returned uncommitted analysis - Summary length: ${analysis.summary?.length || 0} chars`);
				logger.log(`[AI Service Call] 📋 Uncommitted analysis summary preview: "${analysis.summary?.substring(0, 150)}..."`);

				return {
					summary: `<div class="ai-uncommitted-summary">${analysis.summary}</div>`
				};
			} else {
				logger.log('[AI Service Call] ⚠️ AI service returned null analysis for uncommitted changes');
			}
		} catch (error) {
			logger.logError(`[AI Service Call] ❌ Failed to generate comprehensive uncommitted analysis: ${error}`);
			logger.logError(`[AI Service Call] 🔍 Error stack: ${error instanceof Error ? error.stack : 'No stack trace'}`);
		}
		return null;
	}

	/**
	 * Get the comparison details for the Commit Comparison View.
	 * @param repo The path of the repository.
	 * @param fromHash The commit hash the comparison is from.
	 * @param toHash The commit hash the comparison is to.
	 * @returns The comparison details.
	 */
	public getCommitComparison(repo: string, fromHash: string, toHash: string, originalCommitHash?: string, originalCompareWithHash?: string): Promise<GitCommitComparisonData> {
		return Promise.all([
			this.getDiffNameStatus(repo, fromHash, toHash === UNCOMMITTED ? '' : toHash),
			this.getDiffNumStat(repo, fromHash, toHash === UNCOMMITTED ? '' : toHash),
			toHash === UNCOMMITTED ? this.getStatus(repo) : Promise.resolve(null)
		]).then(async (results: [DiffNameStatusRecord[], DiffNumStatRecord[], GitStatusFiles | null]) => {
			const fileChanges = generateFileChanges(results[0], results[1], results[2]);

			// 立即返回基本的比较数据，不等待AI分析
			const basicResult = {
				fileChanges: fileChanges,
				aiAnalysis: null,
				error: null
			};

			// 获取AI分析配置
			const config = getConfig();
			const aiConfig = config.aiAnalysis;

			// 异步执行AI分析，不阻塞基本信息的返回
			if (aiConfig.enabled) {
				// 使用原始的commitHash和compareWithHash，如果没有提供则使用fromHash和toHash
				const commitHashForUpdate = originalCommitHash || fromHash;
				const compareWithHashForUpdate = originalCompareWithHash || toHash;

				this.performAsyncComparisonAnalysis(repo, fromHash, toHash, fileChanges, aiConfig, commitHashForUpdate, compareWithHashForUpdate)
					.catch(error => {
						this.logger.logError(`Async AI comparison analysis failed for ${fromHash}..${toHash}: ${error}`);
					});
			}

			return basicResult;
		}).catch((error) => {
			return { fileChanges: [], aiAnalysis: null, error: error };
		});
	}

	/**
	 * Enhanced comparison analysis with detailed error handling
	 */
	private async performAsyncComparisonAnalysis(
		repo: string,
		fromHash: string,
		toHash: string,
		fileChanges: GitFileChange[],
		aiConfig: any,
		originalCommitHash: string,
		originalCompareWithHash: string
	): Promise<void> {
		try {
			// 检查 AI 分析是否启用
			if (!aiConfig.enabled) {
				this.sendAIAnalysisUpdate(originalCommitHash, originalCompareWithHash, {
					error: 'AI analysis is disabled in settings',
					errorType: 'disabled'
				});
				return;
			}

			this.logger.log(`Starting comparison analysis between ${fromHash} and ${toHash}`);

			// 发送初始进度更新
			this.sendAIAnalysisUpdate(originalCommitHash, originalCompareWithHash, {
				status: 'analyzing',
				progress: {
					current: 0,
					total: fileChanges.length,
					message: `Scanning ${fileChanges.length} files for analysis eligibility...`
				}
			});

			// 使用智能文件类型检测器来过滤符合条件的文件，添加超时和错误处理
			const eligibleFiles = await this.filterEligibleFilesForComparison(
				fileChanges,
				aiConfig,
				repo,
				originalCommitHash,
				originalCompareWithHash,
				10000 // 10秒超时
			);

			if (eligibleFiles.length === 0) {
				this.sendAIAnalysisUpdate(originalCommitHash, originalCompareWithHash, {
					error: 'No readable files found for comparison analysis',
					errorType: 'no_readable_files',
					details: {
						totalFiles: fileChanges.length,
						message: 'The selected commits contain no files that can be analyzed by AI for comparison.'
					}
				});
				return;
			}

			// 限制分析的文件数量
			const filesToAnalyze = eligibleFiles.slice(0, aiConfig.maxFilesPerAnalysis);
			this.logger.log(`Found ${eligibleFiles.length} eligible files for comparison analysis out of ${fileChanges.length} total files, analyzing ${filesToAnalyze.length}`);

			// 发送进度更新
			this.sendAIAnalysisUpdate(originalCommitHash, originalCompareWithHash, {
				status: 'analyzing',
				progress: {
					current: 0,
					total: filesToAnalyze.length,
					message: `Comparing ${filesToAnalyze.length} files...`
				}
			});

			// 获取文件内容和差异
			const fileAnalysisData = [];
			for (let i = 0; i < filesToAnalyze.length; i++) {
				const file = filesToAnalyze[i];
				try {
					const diffContent = await this.getDiffBetweenRevisions(repo, fromHash, toHash, file.newFilePath);

					if (diffContent) {
						// 更新进度
						this.sendAIAnalysisUpdate(originalCommitHash, originalCompareWithHash, {
							status: 'analyzing',
							progress: {
								current: i + 1,
								total: filesToAnalyze.length,
								message: `Processing ${file.newFilePath}...`
							}
						});

						fileAnalysisData.push({
							filePath: file.newFilePath,
							diffContent: diffContent,
							contentBefore: null,
							contentAfter: null,
							type: file.type
						});
					}
				} catch (error) {
					this.logger.log(`Failed to get diff for file ${file.newFilePath}: ${error}`);
				}
			}

			if (fileAnalysisData.length === 0) {
				this.sendAIAnalysisUpdate(originalCommitHash, originalCompareWithHash, {
					error: 'Failed to extract file differences for comparison',
					errorType: 'diff_extraction_failed',
					details: {
						message: 'Could not generate diffs for the files between these commits.'
					}
				});
				return;
			}

			// 生成 AI 分析
			const analysis = await this.generateComprehensiveComparisonAnalysis(fileChanges, fileAnalysisData, this.logger, fromHash, toHash);

			if (analysis) {
				this.sendAIAnalysisUpdate(originalCommitHash, originalCompareWithHash, {
					...analysis,
					status: 'completed',
					filesAnalyzed: fileAnalysisData.length,
					totalFiles: fileChanges.length
				});
			} else {
				this.sendAIAnalysisUpdate(originalCommitHash, originalCompareWithHash, {
					error: 'AI comparison analysis failed to generate results',
					errorType: 'analysis_failed',
					details: {
						message: 'The AI service processed the file differences but could not generate meaningful comparison analysis.'
					}
				});
			}

		} catch (error) {
			this.logger.logError(`Comparison analysis failed between ${fromHash} and ${toHash}: ${error}`);

			// 根据错误类型发送相应的错误信息
			if (error instanceof Error) {
				if (error.message.includes('timeout') || error.message.includes('TIMEOUT')) {
					this.sendAIAnalysisUpdate(originalCommitHash, originalCompareWithHash, {
						error: 'AI comparison analysis timed out',
						errorType: 'timeout',
						details: {
							message: 'The comparison analysis took too long to complete. This may be due to processing a large number of files or temporary service issues.'
						},
						technicalError: error.message
					});
				} else if (error.message.includes('ECONNREFUSED') || error.message.includes('ENOTFOUND')) {
					this.sendAIAnalysisUpdate(originalCommitHash, originalCompareWithHash, {
						error: 'AI service is unavailable',
						errorType: 'service_unavailable',
						details: {
							message: 'Could not connect to the AI analysis service. Please check your AI service configuration and network connectivity.'
						},
						technicalError: error.message
					});
				} else if (error.message.includes('401') || error.message.includes('403') || error.message.includes('authentication')) {
					this.sendAIAnalysisUpdate(originalCommitHash, originalCompareWithHash, {
						error: 'Authentication failed',
						errorType: 'authentication_failed',
						details: {
							message: 'AI service authentication failed. Please check your API key or credentials in the settings.'
						},
						technicalError: error.message
					});
				} else if (error.message.includes('429') || error.message.includes('rate limit')) {
					this.sendAIAnalysisUpdate(originalCommitHash, originalCompareWithHash, {
						error: 'Rate limit exceeded',
						errorType: 'rate_limited',
						details: {
							message: 'Too many requests to the AI service. Please wait a moment before trying again.'
						},
						technicalError: error.message
					});
				} else {
					this.sendAIAnalysisUpdate(originalCommitHash, originalCompareWithHash, {
						error: 'AI comparison analysis encountered an unexpected error',
						errorType: 'unknown_error',
						details: {
							message: 'An unexpected error occurred during comparison analysis. Please try again or check the logs for more details.'
						},
						technicalError: error.message
					});
				}
			} else {
				this.sendAIAnalysisUpdate(originalCommitHash, originalCompareWithHash, {
					error: 'AI comparison analysis failed with unknown error',
					errorType: 'unknown_error',
					details: {
						message: 'An unknown error occurred during comparison analysis.'
					}
				});
			}
		}
	}

	/**
	 * Filter eligible files for comparison with timeout and progress tracking
	 */
	private async filterEligibleFilesForComparison(
		fileChanges: GitFileChange[],
		aiConfig: any,
		repo: string,
		commitHash: string,
		compareWithHash: string,
		timeoutMs: number = 10000
	): Promise<GitFileChange[]> {
		const startTime = Date.now();
		const eligibleFiles: GitFileChange[] = [];

		this.logger.log(`Filtering ${fileChanges.length} files for comparison eligibility`);

		for (let i = 0; i < fileChanges.length; i++) {
			// 检查超时
			if (Date.now() - startTime > timeoutMs) {
				this.logger.log(`File eligibility check timed out after processing ${i}/${fileChanges.length} files`);
				break;
			}

			// 每处理10个文件更新一次进度
			if (i % 10 === 0) {
				this.sendAIAnalysisUpdate(commitHash, compareWithHash, {
					status: 'analyzing',
					progress: {
						current: i,
						total: fileChanges.length,
						message: `Checking file eligibility (${i}/${fileChanges.length})...`
					}
				});
			}

			const file = fileChanges[i];

			try {
				// 为每个文件设置更短的超时
				const isEligible = await Promise.race([
					this.isFileEligibleForAIAnalysis(file, aiConfig, repo),
					new Promise<boolean>((_, reject) =>
						setTimeout(() => reject(new Error('File check timeout')), 1000)
					)
				]);

				if (isEligible) {
					eligibleFiles.push(file);
				}
			} catch (error) {
				this.logger.log(`Failed to check eligibility for ${file.newFilePath}: ${error}`);
				// 如果检测失败，使用简单的扩展名检查作为回退
				const ext = file.newFilePath.substring(file.newFilePath.lastIndexOf('.')).toLowerCase();
				if (aiConfig.supportedFileExtensions &&
					aiConfig.supportedFileExtensions.some((supportedExt: string) => ext === supportedExt.toLowerCase())) {
					eligibleFiles.push(file);
				}
			}
		}

		this.logger.log(`File eligibility check completed: ${eligibleFiles.length}/${fileChanges.length} eligible`);
		return eligibleFiles;
	}

	/**
	 * Generate comprehensive commit analysis using AI service
	 * @param commitDetails The commit details
	 * @param fileAnalysisData Array of file analysis data
	 * @param logger Logger instance
	 * @returns AI analysis result
	 */
	private async generateComprehensiveCommitAnalysis(
		commitDetails: any,
		fileAnalysisData: Array<{
				filePath: string;
				diffContent: string;
				contentBefore: string | null;
				contentAfter: string | null;
				type: GitFileStatus;
			}>,
		logger: Logger
	): Promise<{ summary: string } | null> {
		try {
			// 数据流调试：记录AI服务调用详情
			logger.log('[AI Service Call] 🎯 Starting comprehensive commit analysis via AI service');
			logger.log(`[AI Service Call] 📊 Commit data - Hash: ${commitDetails.hash?.substring(0, 8)}, Author: ${commitDetails.author}, FileCount: ${fileAnalysisData.length}`);

			// 构建详细的提示词
			const payload = {
				commitDetails: {
					hash: commitDetails.hash,
					author: commitDetails.author,
					body: commitDetails.body
				},
				fileAnalysisData: fileAnalysisData.map(f => ({
					filePath: f.filePath,
					type: f.type,
					diffContent: f.diffContent.substring(0, 4000) + (f.diffContent.length > 4000 ? '...' : '')
				}))
			};
			const payloadString = JSON.stringify(payload);

			// 数据流调试：记录提示词信息
			logger.log(`[AI Service Call] 📝 Generated prompt - Length: ${payloadString.length} chars, Contains files: ${fileAnalysisData.map(f => f.filePath.split('/').pop()).join(', ')}`);

			// 构建结构化缓存键参数
			const cacheKeyParams = {
				analysisType: 'comprehensive_commit_analysis',
				commitHash: commitDetails.hash,
				additionalContext: {
					fileCount: fileAnalysisData.length.toString(),
					author: commitDetails.author || 'unknown'
				}
			};

			// 使用真实的AI分析服务进行综合分析
			const analysis = await analyzeDiff(
				'comprehensive_commit_analysis',
				payloadString,
				null,
				null,
				cacheKeyParams, // 新的结构化缓存键参数
				logger,
				30000, // 30秒超时
				0 // 初始重试计数
			);

			if (analysis) {
				// 数据流调试：记录AI服务响应
				logger.log(`[AI Service Call] ✅ AI service returned analysis - Summary length: ${analysis.summary?.length || 0} chars`);
				logger.log(`[AI Service Call] 📋 Analysis summary preview: "${analysis.summary?.substring(0, 150)}..."`);

				return {
					summary: `<div class="ai-commit-summary">${analysis.summary}</div>`
				};
			} else {
				logger.log('[AI Service Call] ⚠️ AI service returned null analysis for commit');
			}
		} catch (error) {
			logger.logError(`[AI Service Call] ❌ Failed to generate comprehensive commit analysis: ${error}`);
			logger.logError(`[AI Service Call] 🔍 Error stack: ${error instanceof Error ? error.stack : 'No stack trace'}`);
		}
		return null;
	}

	/**
	 * Generate comprehensive comparison analysis using AI service
	 * @param fileChanges Array of file changes
	 * @param fileAnalysisData Array of file analysis data
	 * @param logger Logger instance
	 * @returns AI analysis result
	 */
	private async generateComprehensiveComparisonAnalysis(
		fileChanges: ReadonlyArray<GitFileChange>,
		fileAnalysisData: Array<{
			filePath: string;
			diffContent: string;
			contentBefore: string | null;
			contentAfter: string | null;
			type: GitFileStatus;
		}>,
		logger: Logger,
		fromHash: string,
		toHash: string
	): Promise<{ summary: string } | null> {
		try {
			// 数据流调试：记录AI比较服务调用详情
			logger.log('[AI Service Call] 🎯 Starting comprehensive comparison analysis via AI service');
			logger.log(`[AI Service Call] 📊 Comparison data - Total changes: ${fileChanges.length}, Analyzed files: ${fileAnalysisData.length}`);

			// 构建详细的比较提示词
			const payload = {
				fileAnalysisData: fileAnalysisData.map(f => ({
					filePath: f.filePath,
					type: f.type,
					diffContent: f.diffContent.substring(0, 4000) + (f.diffContent.length > 4000 ? '...' : '')
				}))
			};
			const payloadString = JSON.stringify(payload);

			// 数据流调试：记录比较提示词信息
			logger.log(`[AI Service Call] 📝 Generated comparison payload - Length: ${payloadString.length} chars, Contains files: ${fileAnalysisData.map(f => f.filePath.split('/').pop()).join(', ')}`);

			// 构建结构化缓存键参数 (比较分析需要包含两个commit hash)
			const cacheKeyParams = {
				analysisType: 'comprehensive_comparison_analysis',
				commitHash: fromHash,
				compareWithHash: toHash === '' ? 'WORKING_TREE' : toHash, // 空字符串表示工作树
				additionalContext: {
					fileCount: fileAnalysisData.length.toString(),
					totalChanges: fileChanges.length.toString()
				}
			};

			// 使用真实的AI分析服务进行综合分析
			const analysis = await analyzeDiff(
				'comprehensive_comparison_analysis',
				payloadString,
				null,
				null,
				cacheKeyParams, // 新的结构化缓存键参数
				logger,
				30000, // 30秒超时
				0 // 初始重试计数
			);

			if (analysis) {
				// 数据流调试：记录AI比较服务响应
				logger.log(`[AI Service Call] ✅ AI comparison service returned analysis - Summary length: ${analysis.summary?.length || 0} chars`);
				logger.log(`[AI Service Call] 📋 Comparison analysis summary preview: "${analysis.summary?.substring(0, 150)}..."`);

				return {
					summary: `<div class="ai-comparison-summary">${analysis.summary}</div>`
				};
			} else {
				logger.log('[AI Service Call] ⚠️ AI comparison service returned null analysis');
			}
		} catch (error) {
			logger.logError(`[AI Service Call] ❌ Failed to generate comprehensive comparison analysis: ${error}`);
			logger.logError(`[AI Service Call] 🔍 Error stack: ${error instanceof Error ? error.stack : 'No stack trace'}`);
		}
		return null;
	}

	// Helper function to get raw diff (needed for AI service)
	private async getDiffBetweenRevisions(repo: string, fromHash: string, toHash: string, filePath: string): Promise<string | null> {
		try {
			// 处理第一个commit的特殊情况：当fromHash和toHash相同时，表示这是第一个提交
			if (fromHash === toHash) {
				// 对于第一个提交，显示文件的完整内容作为"新增"
				try {
					const fileContent = await this.spawnGit(['show', `${toHash}:${filePath}`], repo, (stdout) => stdout.toString());
					// 将文件内容格式化为diff格式
					const lines = fileContent.split('\n');
					let diffContent = `--- /dev/null\n+++ b/${filePath}\n@@ -0,0 +1,${lines.length} @@\n`;
					diffContent += lines.map(line => '+' + line).join('\n');
					this.logger.log(`Generated diff for first commit file ${filePath}`);
					return diffContent;
				} catch (error) {
					this.logger.log(`Failed to get file content for first commit ${toHash}:${filePath}: ${error}`);
					return null;
				}
			}

			// 处理fromHash以^结尾的情况（有父提交的提交）
			if (fromHash.endsWith('^')) {
				const commitHash = fromHash.slice(0, -1);
				// 检查这个commit是否有父提交
				const parentResult = await this.spawnGit(['rev-list', '--parents', '-n', '1', commitHash], repo, (stdout) => {
					const parts = stdout.trim().split(' ');
					return parts.length > 1; // 如果有多个部分，说明有父提交
				}).catch(() => false);

				if (!parentResult) {
					// 这是第一个commit，没有父提交，显示文件的完整内容作为"新增"
					try {
						const fileContent = await this.spawnGit(['show', `${toHash}:${filePath}`], repo, (stdout) => stdout.toString());
						// 将文件内容格式化为diff格式
						const lines = fileContent.split('\n');
						let diffContent = `--- /dev/null\n+++ b/${filePath}\n@@ -0,0 +1,${lines.length} @@\n`;
						diffContent += lines.map(line => '+' + line).join('\n');
						return diffContent;
					} catch (error) {
						this.logger.log(`Failed to get file content for first commit ${toHash}:${filePath}: ${error}`);
						return null;
					}
				}
			}

			// 标准的diff命令
			const args = ['diff', fromHash, toHash, '--', filePath];
			return await this.spawnGit(args, repo, (stdout) => stdout.toString());
		} catch (error) {
			this.logger.logError(`Failed to get raw diff for ${filePath} between ${fromHash} and ${toHash}: ${error}`);

			// 如果标准diff失败，尝试检测是否是因为浅克隆导致的父提交不存在
			// 这主要处理浅克隆场景下，fromHash 包含 ^ 但父提交在浅克隆中不存在的情况
			if (fromHash.endsWith('^')) {
				this.logger.log(`Attempting to handle shallow clone scenario for ${filePath} (fromHash ends with ^)`);
				try {
					const fileContent = await this.spawnGit(['show', `${toHash}:${filePath}`], repo, (stdout) => stdout.toString());
					// 将文件内容格式化为diff格式
					const lines = fileContent.split('\n');
					let diffContent = `--- /dev/null\n+++ b/${filePath}\n@@ -0,0 +1,${lines.length} @@\n`;
					diffContent += lines.map(line => '+' + line).join('\n');
					this.logger.log(`Successfully generated diff for ${filePath} using file content fallback for shallow clone`);
					return diffContent;
				} catch (fallbackError) {
					this.logger.logError(`Shallow clone fallback also failed for ${filePath}: ${fallbackError}`);
					return null;
				}
			}

			// 对于其他类型的diff失败，也尝试使用文件内容作为fallback
			this.logger.log(`Attempting general fallback for ${filePath}`);
			try {
				const fileContent = await this.spawnGit(['show', `${toHash}:${filePath}`], repo, (stdout) => stdout.toString());
				// 将文件内容格式化为diff格式
				const lines = fileContent.split('\n');
				let diffContent = `--- /dev/null\n+++ b/${filePath}\n@@ -0,0 +1,${lines.length} @@\n`;
				diffContent += lines.map(line => '+' + line).join('\n');
				this.logger.log(`Successfully generated diff for ${filePath} using general fallback`);
				return diffContent;
			} catch (fallbackError) {
				this.logger.logError(`General fallback also failed for ${filePath}: ${fallbackError}`);
				return null;
			}
		}
	}

	/**
	 * Get the contents of a file at a specific revision.
	 * @param repo The path of the repository.
	 * @param commitHash The commit hash specifying the revision of the file.
	 * @param filePath The path of the file relative to the repositories root.
	 * @returns The file contents.
	 */
	public getCommitFile(repo: string, commitHash: string, filePath: string) {
		return this._spawnGit(['show', commitHash + ':' + filePath], repo, stdout => {
			const encoding = getConfig(repo).fileEncoding;
			return decode(stdout, encodingExists(encoding) ? encoding : 'utf8');
		});
	}


	/* Get Data Methods - General */

	/**
	 * Get the subject of a commit.
	 * @param repo The path of the repository.
	 * @param commitHash The commit hash.
	 * @returns The subject string, or NULL if an error occurred.
	 */
	public getCommitSubject(repo: string, commitHash: string): Promise<string | null> {
		return this.spawnGit(['-c', 'log.showSignature=false', 'log', '--format=%s', '-n', '1', commitHash, '--'], repo, (stdout) => {
			return stdout.trim().replace(/\s+/g, ' ');
		}).then((subject) => subject, () => null);
	}

	/**
	 * Get the URL of a repositories remote.
	 * @param repo The path of the repository.
	 * @param remote The name of the remote.
	 * @returns The URL, or NULL if an error occurred.
	 */
	public getRemoteUrl(repo: string, remote: string): Promise<string | null> {
		return this.spawnGit(['config', '--get', 'remote.' + remote + '.url'], repo, (stdout) => {
			return stdout.split(EOL_REGEX)[0];
		}).then((url) => url, () => null);
	}

	/**
	 * Check to see if a file has been renamed between a commit and the working tree, and return the new file path.
	 * @param repo The path of the repository.
	 * @param commitHash The commit hash where `oldFilePath` is known to have existed.
	 * @param oldFilePath The file path that may have been renamed.
	 * @returns The new renamed file path, or NULL if either: the file wasn't renamed or the Git command failed to execute.
	 */
	public getNewPathOfRenamedFile(repo: string, commitHash: string, oldFilePath: string) {
		return this.getDiffNameStatus(repo, commitHash, '', 'R').then((renamed) => {
			const renamedRecordForFile = renamed.find((record) => record.oldFilePath === oldFilePath);
			return renamedRecordForFile ? renamedRecordForFile.newFilePath : null;
		}).catch(() => null);
	}

	/**
	 * Get the details of a tag.
	 * @param repo The path of the repository.
	 * @param tagName The name of the tag.
	 * @returns The tag details.
	 */
	public getTagDetails(repo: string, tagName: string): Promise<GitTagDetailsData> {
		if (this.gitExecutable !== null && !doesVersionMeetRequirement(this.gitExecutable.version, GitVersionRequirement.TagDetails)) {
			return Promise.resolve({ details: null, error: constructIncompatibleGitVersionMessage(this.gitExecutable, GitVersionRequirement.TagDetails, 'retrieving Tag Details') });
		}

		const ref = 'refs/tags/' + tagName;
		return this.spawnGit(['for-each-ref', ref, '--format=' + ['%(objectname)', '%(taggername)', '%(taggeremail)', '%(taggerdate:unix)', '%(contents:signature)', '%(contents)'].join(GIT_LOG_SEPARATOR)], repo, (stdout) => {
			const data = stdout.split(GIT_LOG_SEPARATOR);
			return {
				hash: data[0],
				taggerName: data[1],
				taggerEmail: data[2].substring(data[2].startsWith('<') ? 1 : 0, data[2].length - (data[2].endsWith('>') ? 1 : 0)),
				taggerDate: parseInt(data[3]),
				message: removeTrailingBlankLines(data.slice(5).join(GIT_LOG_SEPARATOR).replace(data[4], '').split(EOL_REGEX)).join('\n'),
				signed: data[4] !== ''
			};
		}).then(async (tag) => ({
			details: {
				hash: tag.hash,
				taggerName: tag.taggerName,
				taggerEmail: tag.taggerEmail,
				taggerDate: tag.taggerDate,
				message: tag.message,
				signature: tag.signed
					? await this.getTagSignature(repo, ref)
					: null
			},
			error: null
		})).catch((errorMessage) => ({
			details: null,
			error: errorMessage
		}));
	}

	/**
	 * Get the submodules of a repository.
	 * @param repo The path of the repository.
	 * @returns An array of the paths of the submodules.
	 */
	public getSubmodules(repo: string) {
		return new Promise<string[]>(resolve => {
			fs.readFile(path.join(repo, '.gitmodules'), { encoding: 'utf8' }, async (err, data) => {
				let submodules: string[] = [];
				if (!err) {
					let lines = data.split(EOL_REGEX), inSubmoduleSection = false, match;
					const section = /^\s*\[.*\]\s*$/, submodule = /^\s*\[submodule "([^"]+)"\]\s*$/, pathProp = /^\s*path\s+=\s+(.*)$/;

					for (let i = 0; i < lines.length; i++) {
						if (lines[i].match(section) !== null) {
							inSubmoduleSection = lines[i].match(submodule) !== null;
							continue;
						}

						if (inSubmoduleSection && (match = lines[i].match(pathProp)) !== null) {
							let root = await this.repoRoot(getPathFromUri(vscode.Uri.file(path.join(repo, getPathFromStr(match[1])))));
							if (root !== null && !submodules.includes(root)) {
								submodules.push(root);
							}
						}
					}
				}
				resolve(submodules);
			});
		});
	}


	/* Repository Info Methods */

	/**
	 * Check if there are any staged changes in the repository.
	 * @param repo The path of the repository.
	 * @returns TRUE => Staged Changes, FALSE => No Staged Changes.
	 */
	private areStagedChanges(repo: string) {
		return this.spawnGit(['diff-index', 'HEAD'], repo, (stdout) => stdout !== '').then(changes => changes, () => false);
	}

	/**
	 * Get the root of the repository containing the specified path.
	 * @param pathOfPotentialRepo The path that is potentially a repository (or is contained within a repository).
	 * @returns STRING => The root of the repository, NULL => `pathOfPotentialRepo` is not in a repository.
	 */
	public repoRoot(pathOfPotentialRepo: string) {
		return this.spawnGit(['rev-parse', '--show-toplevel'], pathOfPotentialRepo, (stdout) => getPathFromUri(vscode.Uri.file(path.normalize(stdout.trim())))).then(async (pathReturnedByGit) => {
			if (process.platform === 'win32') {
				// On Windows Mapped Network Drives with Git >= 2.25.0, `git rev-parse --show-toplevel` returns the UNC Path for the Mapped Network Drive, instead of the Drive Letter.
				// Attempt to replace the UNC Path with the Drive Letter.
				let driveLetterPathMatch: RegExpMatchArray | null;
				if ((driveLetterPathMatch = pathOfPotentialRepo.match(DRIVE_LETTER_PATH_REGEX)) && !pathReturnedByGit.match(DRIVE_LETTER_PATH_REGEX)) {
					const realPathForDriveLetter = pathWithTrailingSlash(await realpath(driveLetterPathMatch[0], true));
					if (realPathForDriveLetter !== driveLetterPathMatch[0] && pathReturnedByGit.startsWith(realPathForDriveLetter)) {
						pathReturnedByGit = driveLetterPathMatch[0] + pathReturnedByGit.substring(realPathForDriveLetter.length);
					}
				}
			}
			let path = pathOfPotentialRepo;
			let first = path.indexOf('/');
			while (true) {
				if (pathReturnedByGit === path || pathReturnedByGit === await realpath(path)) return path;
				let next = path.lastIndexOf('/');
				if (first !== next && next > -1) {
					path = path.substring(0, next);
				} else {
					return pathReturnedByGit;
				}
			}
		}).catch(() => null); // null => path is not in a repo
	}


	/* Git Action Methods - Remotes */

	/**
	 * Add a new remote to a repository.
	 * @param repo The path of the repository.
	 * @param name The name of the remote.
	 * @param url The URL of the remote.
	 * @param pushUrl The Push URL of the remote.
	 * @param fetch Fetch the remote after it is added.
	 * @returns The ErrorInfo from the executed command.
	 */
	public async addRemote(repo: string, name: string, url: string, pushUrl: string | null, fetch: boolean) {
		let status = await this.runGitCommand(['remote', 'add', name, url], repo);
		if (status !== null) return status;

		if (pushUrl !== null) {
			status = await this.runGitCommand(['remote', 'set-url', name, '--push', pushUrl], repo);
			if (status !== null) return status;
		}

		return fetch ? this.fetch(repo, name, false, false) : null;
	}

	/**
	 * Delete an existing remote from a repository.
	 * @param repo The path of the repository.
	 * @param name The name of the remote.
	 * @returns The ErrorInfo from the executed command.
	 */
	public deleteRemote(repo: string, name: string) {
		return this.runGitCommand(['remote', 'remove', name], repo);
	}

	/**
	 * Edit an existing remote of a repository.
	 * @param repo The path of the repository.
	 * @param nameOld The old name of the remote.
	 * @param nameNew The new name of the remote.
	 * @param urlOld The old URL of the remote.
	 * @param urlNew The new URL of the remote.
	 * @param pushUrlOld The old Push URL of the remote.
	 * @param pushUrlNew The new Push URL of the remote.
	 * @returns The ErrorInfo from the executed command.
	 */
	public async editRemote(repo: string, nameOld: string, nameNew: string, urlOld: string | null, urlNew: string | null, pushUrlOld: string | null, pushUrlNew: string | null) {
		if (nameOld !== nameNew) {
			let status = await this.runGitCommand(['remote', 'rename', nameOld, nameNew], repo);
			if (status !== null) return status;
		}

		if (urlOld !== urlNew) {
			let args = ['remote', 'set-url', nameNew];
			if (urlNew === null) args.push('--delete', urlOld!);
			else if (urlOld === null) args.push('--add', urlNew);
			else args.push(urlNew, urlOld);

			let status = await this.runGitCommand(args, repo);
			if (status !== null) return status;
		}

		if (pushUrlOld !== pushUrlNew) {
			let args = ['remote', 'set-url', '--push', nameNew];
			if (pushUrlNew === null) args.push('--delete', pushUrlOld!);
			else if (pushUrlOld === null) args.push('--add', pushUrlNew);
			else args.push(pushUrlNew, pushUrlOld);

			let status = await this.runGitCommand(args, repo);
			if (status !== null) return status;
		}

		return null;
	}

	/**
	 * Prune an existing remote of a repository.
	 * @param repo The path of the repository.
	 * @param name The name of the remote.
	 * @returns The ErrorInfo from the executed command.
	 */
	public pruneRemote(repo: string, name: string) {
		return this.runGitCommand(['remote', 'prune', name], repo);
	}


	/* Git Action Methods - Tags */

	/**
	 * Add a new tag to a commit.
	 * @param repo The path of the repository.
	 * @param tagName The name of the tag.
	 * @param commitHash The hash of the commit the tag should be added to.
	 * @param type Is the tag annotated or lightweight.
	 * @param message The message of the tag (if it is an annotated tag).
	 * @param force Force add the tag, replacing an existing tag with the same name (if it exists).
	 * @returns The ErrorInfo from the executed command.
	 */
	public addTag(repo: string, tagName: string, commitHash: string, type: TagType, message: string, force: boolean) {
		const args = ['tag'];
		if (force) {
			args.push('-f');
		}
		if (type === TagType.Lightweight) {
			args.push(tagName);
		} else {
			args.push(getConfig().signTags ? '-s' : '-a', tagName, '-m', message);
		}
		args.push(commitHash);
		return this.runGitCommand(args, repo);
	}

	/**
	 * Delete an existing tag from a repository.
	 * @param repo The path of the repository.
	 * @param tagName The name of the tag.
	 * @param deleteOnRemote The name of the remote to delete the tag on, or NULL.
	 * @returns The ErrorInfo from the executed command.
	 */
	public async deleteTag(repo: string, tagName: string, deleteOnRemote: string | null) {
		if (deleteOnRemote !== null) {
			let status = await this.runGitCommand(['push', deleteOnRemote, '--delete', tagName], repo);
			if (status !== null) return status;
		}
		return this.runGitCommand(['tag', '-d', tagName], repo);
	}


	/* Git Action Methods - Remote Sync */

	/**
	 * Fetch from the repositories remote(s).
	 * @param repo The path of the repository.
	 * @param remote The remote to fetch, or NULL (fetch all remotes).
	 * @param prune Is pruning enabled.
	 * @param pruneTags Should tags be pruned.
	 * @returns The ErrorInfo from the executed command.
	 */
	public fetch(repo: string, remote: string | null, prune: boolean, pruneTags: boolean) {
		let args = ['fetch', remote === null ? '--all' : remote];

		if (prune) {
			args.push('--prune');
		}
		if (pruneTags) {
			if (!prune) {
				return Promise.resolve('In order to Prune Tags, pruning must also be enabled when fetching from ' + (remote !== null ? 'a remote' : 'remote(s)') + '.');
			} else if (this.gitExecutable !== null && !doesVersionMeetRequirement(this.gitExecutable.version, GitVersionRequirement.FetchAndPruneTags)) {
				return Promise.resolve(constructIncompatibleGitVersionMessage(this.gitExecutable, GitVersionRequirement.FetchAndPruneTags, 'pruning tags when fetching'));
			}
			args.push('--prune-tags');
		}

		return this.runGitCommand(args, repo);
	}

	/**
	 * Push a branch to a remote.
	 * @param repo The path of the repository.
	 * @param branchName The name of the branch to push.
	 * @param remote The remote to push the branch to.
	 * @param setUpstream Set the branches upstream.
	 * @param mode The mode of the push.
	 * @returns The ErrorInfo from the executed command.
	 */
	public pushBranch(repo: string, branchName: string, remote: string, setUpstream: boolean, mode: GitPushBranchMode) {
		let args = ['push'];
		args.push(remote, branchName);
		if (setUpstream) args.push('--set-upstream');
		if (mode !== GitPushBranchMode.Normal) args.push('--' + mode);

		return this.runGitCommand(args, repo);
	}

	/**
	 * Push a branch to multiple remotes.
	 * @param repo The path of the repository.
	 * @param branchName The name of the branch to push.
	 * @param remotes The remotes to push the branch to.
	 * @param setUpstream Set the branches upstream.
	 * @param mode The mode of the push.
	 * @returns The ErrorInfo's from the executed commands.
	 */
	public async pushBranchToMultipleRemotes(repo: string, branchName: string, remotes: string[], setUpstream: boolean, mode: GitPushBranchMode): Promise<ErrorInfo[]> {
		if (remotes.length === 0) {
			return ['No remote(s) were specified to push the branch ' + branchName + ' to.'];
		}

		const results: ErrorInfo[] = [];
		for (let i = 0; i < remotes.length; i++) {
			const result = await this.pushBranch(repo, branchName, remotes[i], setUpstream, mode);
			results.push(result);
			if (result !== null) break;
		}
		return results;
	}

	/**
	 * Push a tag to remote(s).
	 * @param repo The path of the repository.
	 * @param tagName The name of the tag to push.
	 * @param remotes The remote(s) to push the tag to.
	 * @param commitHash The commit hash the tag is on.
	 * @param skipRemoteCheck Skip checking that the tag is on each of the `remotes`.
	 * @returns The ErrorInfo's from the executed commands.
	 */
	public async pushTag(repo: string, tagName: string, remotes: string[], commitHash: string, skipRemoteCheck: boolean): Promise<ErrorInfo[]> {
		if (remotes.length === 0) {
			return ['No remote(s) were specified to push the tag ' + tagName + ' to.'];
		}

		if (!skipRemoteCheck) {
			const remotesContainingCommit = await this.getRemotesContainingCommit(repo, commitHash, remotes).catch(() => remotes);
			const remotesNotContainingCommit = remotes.filter((remote) => !remotesContainingCommit.includes(remote));
			if (remotesNotContainingCommit.length > 0) {
				return [ErrorInfoExtensionPrefix.PushTagCommitNotOnRemote + JSON.stringify(remotesNotContainingCommit)];
			}
		}

		const results: ErrorInfo[] = [];
		for (let i = 0; i < remotes.length; i++) {
			const result = await this.runGitCommand(['push', remotes[i], tagName], repo);
			results.push(result);
			if (result !== null) break;
		}
		return results;
	}


	/* Git Action Methods - Branches */

	/**
	 * Checkout a branch in a repository.
	 * @param repo The path of the repository.
	 * @param branchName The name of the branch to checkout.
	 * @param remoteBranch The name of the remote branch to check out (if not NULL).
	 * @returns The ErrorInfo from the executed command.
	 */
	public checkoutBranch(repo: string, branchName: string, remoteBranch: string | null) {
		let args = ['checkout'];
		if (remoteBranch === null) args.push(branchName);
		else args.push('-b', branchName, remoteBranch);

		return this.runGitCommand(args, repo);
	}

	/**
	 * Create a branch at a commit.
	 * @param repo The path of the repository.
	 * @param branchName The name of the branch.
	 * @param commitHash The hash of the commit the branch should be created at.
	 * @param checkout Check out the branch after it is created.
	 * @param force Force create the branch, replacing an existing branch with the same name (if it exists).
	 * @returns The ErrorInfo's from the executed command(s).
	 */
	public async createBranch(repo: string, branchName: string, commitHash: string, checkout: boolean, force: boolean) {
		const args = [];
		if (checkout && !force) {
			args.push('checkout', '-b');
		} else {
			args.push('branch');
			if (force) {
				args.push('-f');
			}
		}
		args.push(branchName, commitHash);

		const statuses = [await this.runGitCommand(args, repo)];
		if (statuses[0] === null && checkout && force) {
			statuses.push(await this.checkoutBranch(repo, branchName, null));
		}
		return statuses;
	}

	/**
	 * Delete a branch in a repository.
	 * @param repo The path of the repository.
	 * @param branchName The name of the branch.
	 * @param force Should force the branch to be deleted (even if not merged).
	 * @returns The ErrorInfo from the executed command.
	 */
	public deleteBranch(repo: string, branchName: string, force: boolean) {
		return this.runGitCommand(['branch', force ? '-D' : '-d', branchName], repo);
	}

	/**
	 * Delete a remote branch in a repository.
	 * @param repo The path of the repository.
	 * @param branchName The name of the branch.
	 * @param remote The name of the remote to delete the branch on.
	 * @returns The ErrorInfo from the executed command.
	 */
	public async deleteRemoteBranch(repo: string, branchName: string, remote: string) {
		let remoteStatus = await this.runGitCommand(['push', remote, '--delete', branchName], repo);
		if (remoteStatus !== null && (new RegExp('remote ref does not exist', 'i')).test(remoteStatus)) {
			let trackingBranchStatus = await this.runGitCommand(['branch', '-d', '-r', remote + '/' + branchName], repo);
			return trackingBranchStatus === null ? null : 'Branch does not exist on the remote, deleting the remote tracking branch ' + remote + '/' + branchName + '.\n' + trackingBranchStatus;
		}
		return remoteStatus;
	}

	/**
	 * Fetch a remote branch into a local branch.
	 * @param repo The path of the repository.
	 * @param remote The name of the remote containing the remote branch.
	 * @param remoteBranch The name of the remote branch.
	 * @param localBranch The name of the local branch.
	 * @param force Force fetch the remote branch.
	 * @returns The ErrorInfo from the executed command.
	 */
	public fetchIntoLocalBranch(repo: string, remote: string, remoteBranch: string, localBranch: string, force: boolean) {
		const args = ['fetch'];
		if (force) {
			args.push('-f');
		}
		args.push(remote, remoteBranch + ':' + localBranch);
		return this.runGitCommand(args, repo);
	}

	/**
	 * Pull a remote branch into the current branch.
	 * @param repo The path of the repository.
	 * @param branchName The name of the remote branch.
	 * @param remote The name of the remote containing the remote branch.
	 * @param createNewCommit Is `--no-ff` enabled if a merge is required.
	 * @param squash Is `--squash` enabled if a merge is required.
	 * @returns The ErrorInfo from the executed command.
	 */
	public pullBranch(repo: string, branchName: string, remote: string, createNewCommit: boolean, squash: boolean) {
		const args = ['pull', remote, branchName], config = getConfig();
		if (squash) {
			args.push('--squash');
		} else if (createNewCommit) {
			args.push('--no-ff');
		}
		if (config.signCommits) {
			args.push('-S');
		}
		return this.runGitCommand(args, repo).then((pullStatus) => {
			return pullStatus === null && squash
				? this.commitSquashIfStagedChangesExist(repo, remote + '/' + branchName, MergeActionOn.Branch, config.squashPullMessageFormat, config.signCommits)
				: pullStatus;
		});
	}

	/**
	 * Rename a branch in a repository.
	 * @param repo The path of the repository.
	 * @param oldName The old name of the branch.
	 * @param newName The new name of the branch.
	 * @returns The ErrorInfo from the executed command.
	 */
	public renameBranch(repo: string, oldName: string, newName: string) {
		return this.runGitCommand(['branch', '-m', oldName, newName], repo);
	}


	/* Git Action Methods - Branches & Commits */

	/**
	 * Merge a branch or commit into the current branch.
	 * @param repo The path of the repository.
	 * @param obj The object to be merged into the current branch.
	 * @param actionOn Is the merge on a branch, remote-tracking branch or commit.
	 * @param createNewCommit Is `--no-ff` enabled.
	 * @param squash Is `--squash` enabled.
	 * @param noCommit Is `--no-commit` enabled.
	 * @returns The ErrorInfo from the executed command.
	 */
	public merge(repo: string, obj: string, actionOn: MergeActionOn, createNewCommit: boolean, squash: boolean, noCommit: boolean) {
		const args = ['merge', obj], config = getConfig();
		if (squash) {
			args.push('--squash');
		} else if (createNewCommit) {
			args.push('--no-ff');
		}
		if (noCommit) {
			args.push('--no-commit');
		}
		if (config.signCommits) {
			args.push('-S');
		}
		return this.runGitCommand(args, repo).then((mergeStatus) => {
			return mergeStatus === null && squash && !noCommit
				? this.commitSquashIfStagedChangesExist(repo, obj, actionOn, config.squashMergeMessageFormat, config.signCommits)
				: mergeStatus;
		});
	}

	/**
	 * Rebase the current branch on a branch or commit.
	 * @param repo The path of the repository.
	 * @param obj The object the current branch will be rebased onto.
	 * @param actionOn Is the rebase on a branch or commit.
	 * @param ignoreDate Is `--ignore-date` enabled.
	 * @param interactive Should the rebase be performed interactively.
	 * @returns The ErrorInfo from the executed command.
	 */
	public rebase(repo: string, obj: string, actionOn: RebaseActionOn, ignoreDate: boolean, interactive: boolean) {
		if (interactive) {
			return this.openGitTerminal(
				repo,
				'rebase --interactive ' + (getConfig().signCommits ? '-S ' : '') + (actionOn === RebaseActionOn.Branch ? obj.replace(/'/g, '"\'"') : obj),
				'Rebase on "' + (actionOn === RebaseActionOn.Branch ? obj : abbrevCommit(obj)) + '"'
			);
		} else {
			const args = ['rebase', obj];
			if (ignoreDate) {
				args.push('--ignore-date');
			}
			if (getConfig().signCommits) {
				args.push('-S');
			}
			return this.runGitCommand(args, repo);
		}
	}


	/* Git Action Methods - Branches & Tags */

	/**
	 * Create an archive of a repository at a specific reference, and save to disk.
	 * @param repo The path of the repository.
	 * @param ref The reference of the revision to archive.
	 * @param outputFilePath The file path that the archive should be saved to.
	 * @param type The type of archive.
	 * @returns The ErrorInfo from the executed command.
	 */
	public archive(repo: string, ref: string, outputFilePath: string, type: 'tar' | 'zip') {
		return this.runGitCommand(['archive', '--format=' + type, '-o', outputFilePath, ref], repo);
	}


	/* Git Action Methods - Commits */

	/**
	 * Checkout a commit in a repository.
	 * @param repo The path of the repository.
	 * @param commitHash The hash of the commit to check out.
	 * @returns The ErrorInfo from the executed command.
	 */
	public checkoutCommit(repo: string, commitHash: string) {
		return this.runGitCommand(['checkout', commitHash], repo);
	}

	/**
	 * Cherrypick a commit in a repository.
	 * @param repo The path of the repository.
	 * @param commitHash The hash of the commit to be cherry picked.
	 * @param parentIndex The parent index if the commit is a merge.
	 * @param recordOrigin Is `-x` enabled.
	 * @param noCommit Is `--no-commit` enabled.
	 * @returns The ErrorInfo from the executed command.
	 */
	public cherrypickCommit(repo: string, commitHash: string, parentIndex: number, recordOrigin: boolean, noCommit: boolean) {
		const args = ['cherry-pick'];
		if (noCommit) {
			args.push('--no-commit');
		}
		if (recordOrigin) {
			args.push('-x');
		}
		if (getConfig().signCommits) {
			args.push('-S');
		}
		if (parentIndex > 0) {
			args.push('-m', parentIndex.toString());
		}
		args.push(commitHash);
		return this.runGitCommand(args, repo);
	}

	/**
	 * Drop a commit in a repository.
	 * @param repo The path of the repository.
	 * @param commitHash The hash of the commit to drop.
	 * @returns The ErrorInfo from the executed command.
	 */
	public dropCommit(repo: string, commitHash: string) {
		const args = ['rebase'];
		if (getConfig().signCommits) {
			args.push('-S');
		}
		args.push('--onto', commitHash + '^', commitHash);
		return this.runGitCommand(args, repo);
	}

	/**
	 * Reset the current branch to a specified commit.
	 * @param repo The path of the repository.
	 * @param commit The hash of the commit that the current branch should be reset to.
	 * @param resetMode The mode of the reset.
	 * @returns The ErrorInfo from the executed command.
	 */
	public resetToCommit(repo: string, commit: string, resetMode: GitResetMode) {
		return this.runGitCommand(['reset', '--' + resetMode, commit], repo);
	}

	/**
	 * Revert a commit in a repository.
	 * @param repo The path of the repository.
	 * @param commitHash The hash of the commit to revert.
	 * @param parentIndex The parent index if the commit is a merge.
	 * @returns The ErrorInfo from the executed command.
	 */
	public revertCommit(repo: string, commitHash: string, parentIndex: number) {
		const args = ['revert', '--no-edit'];
		if (getConfig().signCommits) {
			args.push('-S');
		}
		if (parentIndex > 0) {
			args.push('-m', parentIndex.toString());
		}
		args.push(commitHash);
		return this.runGitCommand(args, repo);
	}


	/* Git Action Methods - Config */

	/**
	 * Set a configuration value for a repository.
	 * @param repo The path of the repository.
	 * @param key The Git Config Key to be set.
	 * @param value The value to be set.
	 * @param location The location where the configuration value should be set.
	 * @returns The ErrorInfo from the executed command.
	 */
	public setConfigValue(repo: string, key: GitConfigKey, value: string, location: GitConfigLocation) {
		return this.runGitCommand(['config', '--' + location, key, value], repo);
	}

	/**
	 * Unset a configuration value for a repository.
	 * @param repo The path of the repository.
	 * @param key The Git Config Key to be unset.
	 * @param location The location where the configuration value should be unset.
	 * @returns The ErrorInfo from the executed command.
	 */
	public unsetConfigValue(repo: string, key: GitConfigKey, location: GitConfigLocation) {
		return this.runGitCommand(['config', '--' + location, '--unset-all', key], repo);
	}


	/* Git Action Methods - Uncommitted */

	/**
	 * Clean the untracked files in a repository.
	 * @param repo The path of the repository.
	 * @param directories Is `-d` enabled.
	 * @returns The ErrorInfo from the executed command.
	 */
	public cleanUntrackedFiles(repo: string, directories: boolean) {
		return this.runGitCommand(['clean', '-f' + (directories ? 'd' : '')], repo);
	}


	/* Git Action Methods - File */

	/**
	 * Reset a file to the specified revision.
	 * @param repo The path of the repository.
	 * @param commitHash The commit to reset the file to.
	 * @param filePath The file to reset.
	 * @returns The ErrorInfo from the executed command.
	 */
	public resetFileToRevision(repo: string, commitHash: string, filePath: string) {
		return this.runGitCommand(['checkout', commitHash, '--', filePath], repo);
	}


	/* Git Action Methods - Stash */

	/**
	 * Apply a stash in a repository.
	 * @param repo The path of the repository.
	 * @param selector The selector of the stash.
	 * @param reinstateIndex Is `--index` enabled.
	 * @returns The ErrorInfo from the executed command.
	 */
	public applyStash(repo: string, selector: string, reinstateIndex: boolean) {
		let args = ['stash', 'apply'];
		if (reinstateIndex) args.push('--index');
		args.push(selector);

		return this.runGitCommand(args, repo);
	}

	/**
	 * Create a branch from a stash.
	 * @param repo The path of the repository.
	 * @param selector The selector of the stash.
	 * @param branchName The name of the branch to be created.
	 * @returns The ErrorInfo from the executed command.
	 */
	public branchFromStash(repo: string, selector: string, branchName: string) {
		return this.runGitCommand(['stash', 'branch', branchName, selector], repo);
	}

	/**
	 * Drop a stash in a repository.
	 * @param repo The path of the repository.
	 * @param selector The selector of the stash.
	 * @returns The ErrorInfo from the executed command.
	 */
	public dropStash(repo: string, selector: string) {
		return this.runGitCommand(['stash', 'drop', selector], repo);
	}

	/**
	 * Pop a stash in a repository.
	 * @param repo The path of the repository.
	 * @param selector The selector of the stash.
	 * @param reinstateIndex Is `--index` enabled.
	 * @returns The ErrorInfo from the executed command.
	 */
	public popStash(repo: string, selector: string, reinstateIndex: boolean) {
		let args = ['stash', 'pop'];
		if (reinstateIndex) args.push('--index');
		args.push(selector);

		return this.runGitCommand(args, repo);
	}

	/**
	 * Push the uncommitted changes to a stash.
	 * @param repo The path of the repository.
	 * @param message The message of the stash.
	 * @param includeUntracked Is `--include-untracked` enabled.
	 * @returns The ErrorInfo from the executed command.
	 */
	public pushStash(repo: string, message: string, includeUntracked: boolean): Promise<ErrorInfo> {
		if (this.gitExecutable === null) {
			return Promise.resolve(UNABLE_TO_FIND_GIT_MSG);
		} else if (!doesVersionMeetRequirement(this.gitExecutable.version, GitVersionRequirement.PushStash)) {
			return Promise.resolve(constructIncompatibleGitVersionMessage(this.gitExecutable, GitVersionRequirement.PushStash));
		}

		let args = ['stash', 'push'];
		if (includeUntracked) args.push('--include-untracked');
		if (message !== '') args.push('--message', message);
		return this.runGitCommand(args, repo);
	}


	/* Public Utils */

	/**
	 * Opens an external directory diff for the specified commits.
	 * @param repo The path of the repository.
	 * @param fromHash The commit hash the diff is from.
	 * @param toHash The commit hash the diff is to.
	 * @param isGui Is the external diff tool GUI based.
	 * @returns The ErrorInfo from the executed command.
	 */
	public openExternalDirDiff(repo: string, fromHash: string, toHash: string, isGui: boolean) {
		return new Promise<ErrorInfo>((resolve) => {
			if (this.gitExecutable === null) {
				resolve(UNABLE_TO_FIND_GIT_MSG);
			} else {
				const args = ['difftool', '--dir-diff'];
				if (isGui) {
					args.push('-g');
				}
				if (fromHash === toHash) {
					if (toHash === UNCOMMITTED) {
						args.push('HEAD');
					} else {
						args.push(toHash + '^..' + toHash);
					}
				} else {
					if (toHash === UNCOMMITTED) {
						args.push(fromHash);
					} else {
						args.push(fromHash + '..' + toHash);
					}
				}
				if (isGui) {
					this.logger.log('External diff tool is being opened (' + args[args.length - 1] + ')');
					this.runGitCommand(args, repo).then((errorInfo) => {
						this.logger.log('External diff tool has exited (' + args[args.length - 1] + ')');
						if (errorInfo !== null) {
							const errorMessage = errorInfo.replace(EOL_REGEX, ' ');
							this.logger.logError(errorMessage);
							showErrorMessage(errorMessage);
						}
					});
				} else {
					openGitTerminal(repo, this.gitExecutable.path, args.join(' '), 'Open External Directory Diff');
				}
				setTimeout(() => resolve(null), 1500);
			}
		});
	}

	/**
	 * Open a new terminal, set up the Git executable, and optionally run a command.
	 * @param repo The path of the repository.
	 * @param command The command to run.
	 * @param name The name for the terminal.
	 * @returns The ErrorInfo from opening the terminal.
	 */
	public openGitTerminal(repo: string, command: string | null, name: string) {
		return new Promise<ErrorInfo>((resolve) => {
			if (this.gitExecutable === null) {
				resolve(UNABLE_TO_FIND_GIT_MSG);
			} else {
				openGitTerminal(repo, this.gitExecutable.path, command, name);
				setTimeout(() => resolve(null), 1000);
			}
		});
	}


	/* Private Data Providers */

	/**
	 * Get the branches in a repository.
	 * @param repo The path of the repository.
	 * @param showRemoteBranches Are remote branches shown.
	 * @param hideRemotes An array of hidden remotes.
	 * @returns The branch data.
	 */
	private getBranches(repo: string, showRemoteBranches: boolean, hideRemotes: ReadonlyArray<string>) {
		let args = ['branch'];
		if (showRemoteBranches) args.push('-a');
		args.push('--no-color');

		const hideRemotePatterns = hideRemotes.map((remote) => 'remotes/' + remote + '/');
		const showRemoteHeads = getConfig().showRemoteHeads;

		return this.spawnGit(args, repo, (stdout) => {
			let branchData: GitBranchData = { branches: [], head: null, error: null };
			let lines = stdout.split(EOL_REGEX);
			for (let i = 0; i < lines.length - 1; i++) {
				let name = lines[i].substring(2).split(' -> ')[0];
				if (INVALID_BRANCH_REGEXP.test(name) || hideRemotePatterns.some((pattern) => name.startsWith(pattern)) || (!showRemoteHeads && REMOTE_HEAD_BRANCH_REGEXP.test(name))) {
					continue;
				}

				if (lines[i][0] === '*') {
					branchData.head = name;
					branchData.branches.unshift(name);
				} else {
					branchData.branches.push(name);
				}
			}
			return branchData;
		});
	}

	/**
	 * Get the base commit details for the Commit Details View.
	 * @param repo The path of the repository.
	 * @param commitHash The hash of the commit open in the Commit Details View.
	 * @returns The base commit details.
	 */
	private getCommitDetailsBase(repo: string, commitHash: string) {
		return this.spawnGit(['-c', 'log.showSignature=false', 'show', '--quiet', commitHash, '--format=' + this.gitFormatCommitDetails], repo, (stdout): DeepWriteable<GitCommitDetails> => {
			const commitInfo = stdout.split(GIT_LOG_SEPARATOR);
			return {
				hash: commitInfo[0],
				parents: commitInfo[1] !== '' ? commitInfo[1].split(' ') : [],
				author: commitInfo[2],
				authorEmail: commitInfo[3],
				authorDate: parseInt(commitInfo[4]),
				committer: commitInfo[5],
				committerEmail: commitInfo[6],
				committerDate: parseInt(commitInfo[7]),
				signature: ['G', 'U', 'X', 'Y', 'R', 'E', 'B'].includes(commitInfo[8])
					? {
						key: commitInfo[10].trim(),
						signer: commitInfo[9].trim(),
						status: <GitSignatureStatus>commitInfo[8]
					}
					: null,
				body: removeTrailingBlankLines(commitInfo.slice(11).join(GIT_LOG_SEPARATOR).split(EOL_REGEX)).join('\n'),
				fileChanges: []
			};
		});
	}

	/**
	 * Get the configuration list of a repository.
	 * @param repo The path of the repository.
	 * @param location The location of the configuration to be listed.
	 * @returns A set of key-value pairs of Git configuration records.
	 */
	private getConfigList(repo: string, location?: GitConfigLocation): Promise<GitConfigSet> {
		const args = ['--no-pager', 'config', '--list', '-z', '--includes'];
		if (location) {
			args.push('--' + location);
		}

		return this.spawnGit(args, repo, (stdout) => {
			const configs: GitConfigSet = {}, keyValuePairs = stdout.split('\0');
			const numPairs = keyValuePairs.length - 1;
			let comps, key;
			for (let i = 0; i < numPairs; i++) {
				comps = keyValuePairs[i].split(EOL_REGEX);
				key = comps.shift()!;
				configs[key] = comps.join('\n');
			}
			return configs;
		}).catch((errorMessage) => {
			if (typeof errorMessage === 'string') {
				const message = errorMessage.toLowerCase();
				if (message.startsWith('fatal: unable to read config file') && message.endsWith('no such file or directory')) {
					// If the Git command failed due to the configuration file not existing, return an empty list instead of throwing the exception
					return {};
				}
			} else {
				errorMessage = 'An unexpected error occurred while spawning the Git child process.';
			}
			throw errorMessage;
		});
	}

	/**
	 * Get the diff `--name-status` records.
	 * @param repo The path of the repository.
	 * @param fromHash The revision the diff is from.
	 * @param toHash The revision the diff is to.
	 * @param filter The types of file changes to retrieve (defaults to `AMDR`).
	 * @returns An array of `--name-status` records.
	 */
	private getDiffNameStatus(repo: string, fromHash: string, toHash: string, filter: string = 'AMDR') {
		return this.execDiff(repo, fromHash, toHash, '--name-status', filter).then((output) => {
			let records: DiffNameStatusRecord[] = [], i = 0;
			while (i < output.length && output[i] !== '') {
				let type = <GitFileStatus>output[i][0];
				if (type === GitFileStatus.Added || type === GitFileStatus.Deleted || type === GitFileStatus.Modified) {
					// Add, Modify, or Delete
					let p = getPathFromStr(output[i + 1]);
					records.push({ type: type, oldFilePath: p, newFilePath: p });
					i += 2;
				} else if (type === GitFileStatus.Renamed) {
					// Rename
					records.push({ type: type, oldFilePath: getPathFromStr(output[i + 1]), newFilePath: getPathFromStr(output[i + 2]) });
					i += 3;
				} else {
					break;
				}
			}
			return records;
		});
	}

	/**
	 * Get the diff `--numstat` records.
	 * @param repo The path of the repository.
	 * @param fromHash The revision the diff is from.
	 * @param toHash The revision the diff is to.
	 * @param filter The types of file changes to retrieve (defaults to `AMDR`).
	 * @returns An array of `--numstat` records.
	 */
	private getDiffNumStat(repo: string, fromHash: string, toHash: string, filter: string = 'AMDR') {
		return this.execDiff(repo, fromHash, toHash, '--numstat', filter).then((output) => {
			let records: DiffNumStatRecord[] = [], i = 0;
			while (i < output.length && output[i] !== '') {
				let fields = output[i].split('\t');
				if (fields.length !== 3) break;
				if (fields[2] !== '') {
					// Add, Modify, or Delete
					records.push({ filePath: getPathFromStr(fields[2]), additions: parseInt(fields[0]), deletions: parseInt(fields[1]) });
					i += 1;
				} else {
					// Rename
					records.push({ filePath: getPathFromStr(output[i + 2]), additions: parseInt(fields[0]), deletions: parseInt(fields[1]) });
					i += 3;
				}
			}
			return records;
		});
	}

	/**
	 * Get the raw commits in a repository.
	 * @param repo The path of the repository.
	 * @param branches The list of branch heads to display, or NULL (show all).
	 * @param num The maximum number of commits to return.
	 * @param includeTags Include commits only referenced by tags.
	 * @param includeRemotes Include remote branches.
	 * @param includeCommitsMentionedByReflogs Include commits mentioned by reflogs.
	 * @param onlyFollowFirstParent Only follow the first parent of commits.
	 * @param order The order for commits to be returned.
	 * @param remotes An array of the known remotes.
	 * @param hideRemotes An array of hidden remotes.
	 * @param stashes An array of all stashes in the repository.
	 * @returns An array of commits.
	 */
	private getLog(repo: string, branches: ReadonlyArray<string> | null, num: number, includeTags: boolean, includeRemotes: boolean, includeCommitsMentionedByReflogs: boolean, onlyFollowFirstParent: boolean, order: CommitOrdering, remotes: ReadonlyArray<string>, hideRemotes: ReadonlyArray<string>, stashes: ReadonlyArray<GitStash>) {
		const args = ['-c', 'log.showSignature=false', 'log', '--max-count=' + num, '--format=' + this.gitFormatLog, '--' + order + '-order'];
		if (onlyFollowFirstParent) {
			args.push('--first-parent');
		}
		if (branches !== null) {
			for (let i = 0; i < branches.length; i++) {
				args.push(branches[i]);
			}
		} else {
			// Show All
			args.push('--branches');
			if (includeTags) args.push('--tags');
			if (includeCommitsMentionedByReflogs) args.push('--reflog');
			if (includeRemotes) {
				if (hideRemotes.length === 0) {
					args.push('--remotes');
				} else {
					remotes.filter((remote) => !hideRemotes.includes(remote)).forEach((remote) => {
						args.push('--glob=refs/remotes/' + remote);
					});
				}
			}

			// Add the unique list of base hashes of stashes, so that commits only referenced by stashes are displayed
			const stashBaseHashes = stashes.map((stash) => stash.baseHash);
			stashBaseHashes.filter((hash, index) => stashBaseHashes.indexOf(hash) === index).forEach((hash) => args.push(hash));

			args.push('HEAD');
		}
		args.push('--');

		return this.spawnGit(args, repo, (stdout) => {
			let lines = stdout.split(EOL_REGEX);
			let commits: GitCommitRecord[] = [];
			for (let i = 0; i < lines.length - 1; i++) {
				let line = lines[i].split(GIT_LOG_SEPARATOR);
				if (line.length !== 6) break;
				commits.push({ hash: line[0], parents: line[1] !== '' ? line[1].split(' ') : [], author: line[2], email: line[3], date: parseInt(line[4]), message: line[5] });
			}
			return commits;
		});
	}

	/**
	 * Get the references in a repository.
	 * @param repo The path of the repository.
	 * @param showRemoteBranches Are remote branches shown.
	 * @param showRemoteHeads Are remote heads shown.
	 * @param hideRemotes An array of hidden remotes.
	 * @returns The references data.
	 */
	private getRefs(repo: string, showRemoteBranches: boolean, showRemoteHeads: boolean, hideRemotes: ReadonlyArray<string>) {
		let args = ['show-ref'];
		if (!showRemoteBranches) args.push('--heads', '--tags');
		args.push('-d', '--head');

		const hideRemotePatterns = hideRemotes.map((remote) => 'refs/remotes/' + remote + '/');

		return this.spawnGit(args, repo, (stdout) => {
			let refData: GitRefData = { head: null, heads: [], tags: [], remotes: [] };
			let lines = stdout.split(EOL_REGEX);
			for (let i = 0; i < lines.length - 1; i++) {
				let line = lines[i].split(' ');
				if (line.length < 2) continue;

				let hash = line.shift()!;
				let ref = line.join(' ');

				if (ref.startsWith('refs/heads/')) {
					refData.heads.push({ hash: hash, name: ref.substring(11) });
				} else if (ref.startsWith('refs/tags/')) {
					let annotated = ref.endsWith('^{}');
					refData.tags.push({ hash: hash, name: (annotated ? ref.substring(10, ref.length - 3) : ref.substring(10)), annotated: annotated });
				} else if (ref.startsWith('refs/remotes/')) {
					if (!hideRemotePatterns.some((pattern) => ref.startsWith(pattern)) && (showRemoteHeads || !ref.endsWith('/HEAD'))) {
						refData.remotes.push({ hash: hash, name: ref.substring(13) });
					}
				} else if (ref === 'HEAD') {
					refData.head = hash;
				}
			}
			return refData;
		});
	}

	/**
	 * Get all of the remotes that contain the specified commit hash.
	 * @param repo The path of the repository.
	 * @param commitHash The commit hash to test.
	 * @param knownRemotes The list of known remotes to check for.
	 * @returns A promise resolving to a list of remote names.
	 */
	private getRemotesContainingCommit(repo: string, commitHash: string, knownRemotes: string[]) {
		return this.spawnGit(['branch', '-r', '--no-color', '--contains=' + commitHash], repo, (stdout) => {
			// Get the names of all known remote branches that contain commitHash
			const branchNames = stdout.split(EOL_REGEX)
				.filter((line) => line.length > 2)
				.map((line) => line.substring(2).split(' -> ')[0])
				.filter((branchName) => !INVALID_BRANCH_REGEXP.test(branchName));

			// Get all the remotes that are the prefix of at least one remote branch name
			return knownRemotes.filter((knownRemote) => {
				const knownRemotePrefix = knownRemote + '/';
				return branchNames.some((branchName) => branchName.startsWith(knownRemotePrefix));
			});
		});
	}

	/**
	 * Get the stashes in a repository.
	 * @param repo The path of the repository.
	 * @returns An array of stashes.
	 */
	private getStashes(repo: string) {
		return this.spawnGit(['reflog', '--format=' + this.gitFormatStash, 'refs/stash', '--'], repo, (stdout) => {
			let lines = stdout.split(EOL_REGEX);
			let stashes: GitStash[] = [];
			for (let i = 0; i < lines.length - 1; i++) {
				let line = lines[i].split(GIT_LOG_SEPARATOR);
				if (line.length !== 7 || line[1] === '') continue;
				let parentHashes = line[1].split(' ');
				stashes.push({
					hash: line[0],
					baseHash: parentHashes[0],
					untrackedFilesHash: parentHashes.length === 3 ? parentHashes[2] : null,
					selector: line[2],
					author: line[3],
					email: line[4],
					date: parseInt(line[5]),
					message: line[6]
				});
			}
			return stashes;
		}).catch(() => <GitStash[]>[]);
	}

	/**
	 * Get the names of the remotes of a repository.
	 * @param repo The path of the repository.
	 * @returns An array of remote names.
	 */
	private getRemotes(repo: string) {
		return this.spawnGit(['remote'], repo, (stdout) => {
			let lines = stdout.split(EOL_REGEX);
			lines.pop();
			return lines;
		});
	}

	/**
	 * Get the signature of a signed tag.
	 * @param repo The path of the repository.
	 * @param ref The reference identifying the tag.
	 * @returns A Promise resolving to the signature.
	 */
	private getTagSignature(repo: string, ref: string): Promise<GitSignature> {
		return this._spawnGit(['verify-tag', '--raw', ref], repo, (stdout, stderr) => stderr || stdout.toString(), true).then((output) => {
			const records = output.split(EOL_REGEX)
				.filter((line) => line.startsWith('[GNUPG:] '))
				.map((line) => line.split(' '));

			let signature: Writeable<GitSignature> | null = null, trustLevel: string | null = null, parsingDetails: GpgStatusCodeParsingDetails | undefined;
			for (let i = 0; i < records.length; i++) {
				parsingDetails = GPG_STATUS_CODE_PARSING_DETAILS[records[i][1]];
				if (parsingDetails) {
					if (signature !== null) {
						throw new Error('Multiple Signatures Exist: As Git currently doesn\'t support them, nor does Git Graph (for consistency).');
					} else {
						signature = {
							status: parsingDetails.status,
							key: records[i][2],
							signer: parsingDetails.uid ? records[i].slice(3).join(' ') : '' // When parsingDetails.uid === TRUE, the signer is the rest of the record (so join the remaining arguments)
						};
					}
				} else if (records[i][1].startsWith('TRUST_')) {
					trustLevel = records[i][1];
				}
			}

			if (signature !== null && signature.status === GitSignatureStatus.GoodAndValid && (trustLevel === 'TRUST_UNDEFINED' || trustLevel === 'TRUST_NEVER')) {
				signature.status = GitSignatureStatus.GoodWithUnknownValidity;
			}

			if (signature !== null) {
				return signature;
			} else {
				throw new Error('No Signature could be parsed.');
			}
		}).catch(() => ({
			status: GitSignatureStatus.CannotBeChecked,
			key: '',
			signer: ''
		}));
	}

	/**
	 * Get the number of uncommitted changes in a repository.
	 * @param repo The path of the repository.
	 * @returns The number of uncommitted changes.
	 */
	private getUncommittedChanges(repo: string) {
		return this.spawnGit(['status', '--untracked-files=' + (getConfig().showUntrackedFiles ? 'all' : 'no'), '--porcelain'], repo, (stdout) => {
			const numLines = stdout.split(EOL_REGEX).length;
			return numLines > 1 ? numLines - 1 : 0;
		});
	}

	/**
	 * Get the untracked and deleted files that are not staged or committed.
	 * @param repo The path of the repository.
	 * @returns The untracked and deleted files.
	 */
	private getStatus(repo: string) {
		return this.spawnGit(['status', '-s', '--untracked-files=' + (getConfig().showUntrackedFiles ? 'all' : 'no'), '--porcelain', '-z'], repo, (stdout) => {
			let output = stdout.split('\0'), i = 0;
			let status: GitStatusFiles = { deleted: [], untracked: [] };
			let path = '', c1 = '', c2 = '';
			while (i < output.length && output[i] !== '') {
				if (output[i].length < 4) break;
				path = output[i].substring(3);
				c1 = output[i].substring(0, 1);
				c2 = output[i].substring(1, 2);
				if (c1 === 'D' || c2 === 'D') status.deleted.push(path);
				else if (c1 === '?' || c2 === '?') status.untracked.push(path);

				if (c1 === 'R' || c2 === 'R' || c1 === 'C' || c2 === 'C') {
					// Renames or copies
					i += 2;
				} else {
					i += 1;
				}
			}
			return status;
		});
	}


	/* Private Utils */

	/**
	 * Check if there are staged changes that resulted from a squash merge, and if so, commit them.
	 * @param repo The path of the repository.
	 * @param obj The object being squash merged into the current branch.
	 * @param actionOn Is the merge on a branch, remote-tracking branch or commit.
	 * @param squashMessageFormat The format to be used in the commit message of the squash.
	 * @returns The ErrorInfo from the executed command.
	 */
	private commitSquashIfStagedChangesExist(repo: string, obj: string, actionOn: MergeActionOn, squashMessageFormat: SquashMessageFormat, signCommits: boolean): Promise<ErrorInfo> {
		return this.areStagedChanges(repo).then((changes) => {
			if (changes) {
				const args = ['commit'];
				if (signCommits) {
					args.push('-S');
				}
				if (squashMessageFormat === SquashMessageFormat.Default) {
					args.push('-m', 'Merge ' + actionOn.toLowerCase() + ' \'' + obj + '\'');
				} else {
					args.push('--no-edit');
				}
				return this.runGitCommand(args, repo);
			} else {
				return null;
			}
		});
	}

	/**
	 * Get the diff between two revisions.
	 * @param repo The path of the repository.
	 * @param fromHash The revision the diff is from.
	 * @param toHash The revision the diff is to.
	 * @param arg Sets the data reported from the diff.
	 * @param filter The types of file changes to retrieve.
	 * @returns The diff output.
	 */
	private execDiff(repo: string, fromHash: string, toHash: string, arg: '--numstat' | '--name-status', filter: string) {
		let args: string[];
		if (fromHash === toHash) {
			args = ['diff-tree', arg, '-r', '--root', '--find-renames', '--diff-filter=' + filter, '-z', fromHash];
		} else {
			args = ['diff', arg, '--find-renames', '--diff-filter=' + filter, '-z', fromHash];
			if (toHash !== '') args.push(toHash);
		}

		return this.spawnGit(args, repo, (stdout) => {
			let lines = stdout.split('\0');
			if (fromHash === toHash) lines.shift();
			return lines;
		});
	}

	/**
	 * Run a Git command (typically for a Git Graph View action).
	 * @param args The arguments to pass to Git.
	 * @param repo The repository to run the command in.
	 * @returns The returned ErrorInfo (suitable for being sent to the Git Graph View).
	 */
	private runGitCommand(args: string[], repo: string): Promise<ErrorInfo> {
		return this._spawnGit(args, repo, () => null).catch((errorMessage: string) => errorMessage);
	}

	/**
	 * Spawn Git, with the return value resolved from `stdout` as a string.
	 * @param args The arguments to pass to Git.
	 * @param repo The repository to run the command in.
	 * @param resolveValue A callback invoked to resolve the data from `stdout`.
	 */
	private spawnGit<T>(args: string[], repo: string, resolveValue: { (stdout: string): T }) {
		return this._spawnGit(args, repo, (stdout) => resolveValue(stdout.toString()));
	}

	/**
	 * Spawn Git, with the return value resolved from `stdout` as a buffer.
	 * @param args The arguments to pass to Git.
	 * @param repo The repository to run the command in.
	 * @param resolveValue A callback invoked to resolve the data from `stdout` and `stderr`.
	 * @param ignoreExitCode Ignore the exit code returned by Git (default: `FALSE`).
	 */
	private _spawnGit<T>(args: string[], repo: string, resolveValue: { (stdout: Buffer, stderr: string): T }, ignoreExitCode: boolean = false) {
		return new Promise<T>((resolve, reject) => {
			if (this.gitExecutable === null) {
				return reject(UNABLE_TO_FIND_GIT_MSG);
			}

			resolveSpawnOutput(cp.spawn(this.gitExecutable.path, args, {
				cwd: repo,
				env: Object.assign({}, process.env, this.askpassEnv)
			})).then((values) => {
				const status = values[0], stdout = values[1], stderr = values[2];
				if (status.code === 0 || ignoreExitCode) {
					resolve(resolveValue(stdout, stderr));
				} else {
					reject(getErrorMessage(status.error, stdout, stderr));
				}
			});

			this.logger.logCmd('git', args);
		});
	}

	/**
	 * Check if a file is eligible for AI analysis based on intelligent detection
	 * @param fileChange The file change to check
	 * @param aiConfig AI analysis configuration
	 * @param repo Repository path for content-based detection
	 * @returns Promise<boolean> True if the file should be analyzed
	 */
	private async isFileEligibleForAIAnalysis(fileChange: GitFileChange, aiConfig: any, repo?: string): Promise<boolean> {
		// 分析新增、修改和重命名的文件（排除删除的文件，因为没有内容可分析）
		if (fileChange.type !== GitFileStatus.Added &&
			fileChange.type !== GitFileStatus.Modified &&
			fileChange.type !== GitFileStatus.Renamed) {
			return false;
		}

		const filePath = fileChange.newFilePath;

		// 使用新的智能文件类型检测器
		try {
			const useIntelligentDetection = aiConfig.useIntelligentFileDetection !== false; // 默认启用
			const isEligible = await FileTypeDetector.isFileEligibleForAnalysis(filePath, repo, useIntelligentDetection);

			// 如果智能检测认为不符合，但用户明确在支持列表中配置了，仍然分析
			if (!isEligible && aiConfig.supportedFileExtensions) {
				const ext = filePath.substring(filePath.lastIndexOf('.')).toLowerCase();
				if (aiConfig.supportedFileExtensions.some((supportedExt: string) => ext === supportedExt.toLowerCase())) {
					return true;
				}
			}

			// 检查排除列表
			if (aiConfig.excludedFileExtensions) {
				const ext = filePath.substring(filePath.lastIndexOf('.')).toLowerCase();
				if (aiConfig.excludedFileExtensions.some((excludedExt: string) => ext === excludedExt.toLowerCase())) {
					return false;
				}
			}

			return isEligible;
		} catch (error) {
			// 如果智能检测失败，回退到原始的扩展名检测
			this.logger.log(`Intelligent file detection failed for ${filePath}, falling back to extension-based detection: ${error}`);

			const ext = filePath.substring(filePath.lastIndexOf('.')).toLowerCase();

			// 检查排除列表
			if (aiConfig.excludedFileExtensions && aiConfig.excludedFileExtensions.some((excludedExt: string) => ext === excludedExt.toLowerCase())) {
				return false;
			}

			// 检查支持列表
			return aiConfig.supportedFileExtensions && aiConfig.supportedFileExtensions.some((supportedExt: string) => ext === supportedExt.toLowerCase());
		}
	}

	/**
	 * Set the callback for AI analysis updates
	 * @param callback The callback function to call when AI analysis is complete
	 */
	public setAIAnalysisUpdateCallback(callback: (commitHash: string, compareWithHash: string | null, aiAnalysis: any) => void) {
		this.aiAnalysisUpdateCallback = callback;
	}

	/**
	 * Send AI analysis update to the callback
	 * @param commitHash The commit hash
	 * @param compareWithHash The commit hash to compare with (optional)
	 * @param aiAnalysis The AI analysis result
	 */
	private sendAIAnalysisUpdate(commitHash: string, compareWithHash: string | null, aiAnalysis: any) {
		// 数据流调试：记录AI分析更新发送
		this.logger.log('[AI Update Callback] 📡 Sending AI analysis update');
		this.logger.log(`[AI Update Callback] 🔗 Target - CommitHash: ${commitHash}, CompareWithHash: ${compareWithHash || 'None'}`);
		this.logger.log(`[AI Update Callback] 📊 Analysis data - HasSummary: ${!!aiAnalysis?.summary}, SummaryLength: ${aiAnalysis?.summary?.length || 0} chars`);

		if (this.aiAnalysisUpdateCallback) {
			try {
				this.logger.log('[AI Update Callback] ✅ Callback exists, invoking update');
				this.aiAnalysisUpdateCallback(commitHash, compareWithHash, aiAnalysis);
				this.logger.log(`[AI Update Callback] 📤 Successfully sent AI analysis update for ${commitHash}`);
			} catch (error) {
				this.logger.logError(`[AI Update Callback] ❌ Failed to invoke AI analysis callback: ${error}`);
				this.logger.logError(`[AI Update Callback] 🔍 Callback error details: ${error instanceof Error ? error.stack : 'Unknown error'}`);
			}
		} else {
			this.logger.log('[AI Update Callback] ⚠️ No AI analysis update callback registered - update will be lost');
		}
	}

	/**
	 * Get the commit history for a specific file
	 * @param repo The path of the repository
	 * @param filePath The path of the file relative to the repository root
	 * @param maxCommits The maximum number of commits to return
	 * @param skipAIAnalysis Whether to skip AI analysis for faster response
	 * @returns The file history data
	 */
	public async getFileHistory(repo: string, filePath: string, maxCommits: number, skipAIAnalysis: boolean = false): Promise<GitFileHistoryData> {
		try {
			// Get the commit history for the file
			const commits = await this.getFileCommitHistory(repo, filePath, maxCommits);

			// 立即返回基本的文件历史数据，不等待AI分析
			const basicResult = {
				filePath: filePath,
				commits: commits,
				aiAnalysis: null,
				error: null
			};

			// 获取AI分析配置
			const config = getConfig();
			const aiConfig = config.aiAnalysis;

			// 异步执行AI分析，不阻塞基本信息的返回
			if (!skipAIAnalysis && aiConfig.enabled && commits.length > 0) {
				this.performAsyncFileHistoryAnalysis(filePath, commits)
					.catch(error => {
						this.logger.logError(`Async file history AI analysis failed for ${filePath}: ${error}`);
					});
			}

			return basicResult;
		} catch (error) {
			return {
				filePath: filePath,
				commits: [],
				aiAnalysis: null,
				error: typeof error === 'string' ? error : 'Failed to get file history'
			};
		}
	}

	/**
	 * Get the commit history for a specific file
	 * @param repo The path of the repository
	 * @param filePath The path of the file
	 * @param maxCommits The maximum number of commits to return
	 * @returns Array of file history commits
	 */
	private async getFileCommitHistory(repo: string, filePath: string, maxCommits: number): Promise<GitFileHistoryCommit[]> {
		try {
			// Use a single git log command to get all the information we need at once
			// Simplified format for better performance
			const gitOutput = await this.spawnGit([
				'log',
				'--follow',
				'--format=%H|%P|%an|%at|%s', // 简化格式，只获取必要信息
				'--numstat',
				`--max-count=${maxCommits}`,
				'--',
				filePath
			], repo, (stdout) => stdout);

			if (!gitOutput.trim()) {
				return [];
			}

			const commits: GitFileHistoryCommit[] = [];
			const lines = gitOutput.trim().split('\n');
			let i = 0;

			while (i < lines.length) {
				const line = lines[i].trim();
				if (!line) {
					i++;
					continue;
				}

				// Parse commit header line
				const parts = line.split('|');
				if (parts.length !== 5) {
					i++;
					continue;
				}

				const [hash, parents, author, authorDate, message] = parts;

				// Skip to next line to find numstat data
				i++;
				let additions: number | null = null;
				let deletions: number | null = null;
				let changeType: GitFileStatus = GitFileStatus.Modified;

				// Look for numstat data (should be the next non-empty line)
				while (i < lines.length) {
					const numStatLine = lines[i].trim();
					if (!numStatLine) {
						i++;
						continue;
					}

					// Check if this is a new commit line (starts with commit hash pattern)
					if (numStatLine.includes('|') && numStatLine.split('|').length === 5) {
						// This is the next commit, don't increment i
						break;
					}

					// Parse numstat line: "additions\tdeletions\tfilename"
					const numStatParts = numStatLine.split('\t');
					if (numStatParts.length >= 3) {
						const addStr = numStatParts[0];
						const delStr = numStatParts[1];
						const fileName = numStatParts[2];

						// Check if this numstat line is for our file
						if (fileName === filePath || fileName.endsWith('/' + filePath.split('/').pop())) {
							additions = addStr === '-' ? null : parseInt(addStr) || 0;
							deletions = delStr === '-' ? null : parseInt(delStr) || 0;

							// Determine change type based on additions/deletions
							if (additions !== null && deletions === null) {
								changeType = GitFileStatus.Added;
							} else if (additions === null && deletions !== null) {
								changeType = GitFileStatus.Deleted;
							} else {
								changeType = GitFileStatus.Modified;
							}
							break;
						}
					}
					i++;
				}

				// Create the commit object
				const fileChange: GitFileChange = {
					oldFilePath: filePath,
					newFilePath: filePath,
					type: changeType,
					additions: additions,
					deletions: deletions
				};

				commits.push({
					hash: hash,
					parents: parents ? parents.split(' ').filter(p => p.length > 0) : [],
					author: author,
					authorEmail: '', // 简化，不获取邮箱
					authorDate: parseInt(authorDate),
					committer: author, // 使用author作为committer
					committerEmail: '', // 简化，不获取邮箱
					committerDate: parseInt(authorDate), // 使用authorDate作为committerDate
					message: message,
					fileChange: fileChange,
					additions: additions,
					deletions: deletions
				});
			}

			return commits;
		} catch (error) {
			this.logger.logError(`Failed to get file commit history for ${filePath}: ${error}`);
			return [];
		}
	}

	/**
	 * Perform AI analysis for file history asynchronously
	 */
	private async performAsyncFileHistoryAnalysis(
		filePath: string,
		commits: GitFileHistoryCommit[]
	): Promise<void> {
		try {
			// 数据流调试：记录文件历史分析开始
			this.logger.log(`[File History AI Flow] 🚀 Starting file history analysis for ${filePath}`);
			this.logger.log(`[File History AI Flow] 📊 Input data - FilePath: ${filePath}, Commits: ${commits.length}`);
			this.logger.log(`[File History AI Flow] 📝 Commit range: ${commits.length > 0 ? `${commits[commits.length - 1].hash.substring(0, 8)} to ${commits[0].hash.substring(0, 8)}` : 'No commits'}`);

			// 分析文件演进模式
			const analysisStartTime = Date.now();
			const analysis = await this.generateFileHistoryAnalysis(filePath, commits, this.logger);
			const analysisEndTime = Date.now();

			this.logger.log(`[File History AI Flow] ⏱️ File history analysis completed in ${analysisEndTime - analysisStartTime}ms`);
			this.logger.log(`[File History AI Flow] 📋 Generated analysis result: ${JSON.stringify(analysis)}`);

			if (analysis) {
				this.logger.log(`[File History AI Flow] ✅ Sending AI analysis update for ${filePath}`);
				// 发送文件历史AI分析更新消息
				this.sendFileHistoryAIAnalysisUpdate(filePath, analysis);
				this.logger.log(`[File History AI Flow] 📤 Successfully sent AI analysis update for ${filePath}`);
			} else {
				this.logger.log(`[File History AI Flow] ⚠️ No analysis generated for ${filePath} - skipping update`);
			}
		} catch (error) {
			this.logger.logError(`[File History AI Flow] ❌ File history AI analysis failed for ${filePath}: ${error}`);
			this.logger.logError(`[File History AI Flow] 🔍 Error details: ${error instanceof Error ? error.stack : 'Unknown error'}`);
		}
	}

	/**
	 * Generate comprehensive file history analysis using AI service
	 */
	private async generateFileHistoryAnalysis(
		filePath: string,
		commits: GitFileHistoryCommit[],
		logger: Logger
	): Promise<FileHistoryAIAnalysis | null> {
		try {
			// 数据流调试：记录文件历史分析服务调用开始
			logger.log(`[File History AI Service] 🎯 Starting file history analysis service call for ${filePath}`);
			logger.log(`[File History AI Service] 📊 File data - Path: ${filePath}, Commits: ${commits.length}`);

			if (commits.length > 0) {
				const firstCommit = commits[commits.length - 1];
				const lastCommit = commits[0];
				logger.log(`[File History AI Service] 📝 Commit range - First: ${firstCommit.hash.substring(0, 8)} (${new Date(firstCommit.authorDate * 1000).toLocaleDateString()})`);
				logger.log(`[File History AI Service] 📝 Commit range - Last: ${lastCommit.hash.substring(0, 8)} (${new Date(lastCommit.authorDate * 1000).toLocaleDateString()})`);

				// 统计贡献者信息
				const authors = Array.from(new Set(commits.map(c => c.author)));
				logger.log(`[File History AI Service] 👥 Contributors: ${authors.length} unique (${authors.slice(0, 3).join(', ')}${authors.length > 3 ? '...' : ''})`);
			}

			// 不在前端构建prompt，直接传递数据
			const payload = {
				filePath: filePath,
				commits: commits
			};

			// 使用专门的文件历史分析服务
			const serviceCallStartTime = Date.now();
			const analysis = await analyzeFileHistory(
				filePath,
				payload, // 发送payload对象
				logger
			);
			const serviceCallEndTime = Date.now();

			logger.log(`[File History AI Service] ⏱️ AI service call completed in ${serviceCallEndTime - serviceCallStartTime}ms`);
			logger.log(`[File History AI Service] 📋 Raw AI service response for ${filePath}: ${JSON.stringify(analysis)}`);

			if (analysis && analysis.summary) {
				logger.log(`[File History AI Service] 🔄 Parsing analysis result for ${filePath}`);
				// 解析AI分析结果
				const parseStartTime = Date.now();
				const parsedAnalysis = this.parseFileHistoryAnalysis(analysis.summary);
				const parseEndTime = Date.now();

				logger.log(`[File History AI Service] ⏱️ Analysis parsing completed in ${parseEndTime - parseStartTime}ms`);
				logger.log(`[File History AI Service] ✅ Successfully parsed analysis for ${filePath}: ${JSON.stringify(parsedAnalysis)}`);
				return parsedAnalysis;
			} else {
				logger.log(`[File History AI Service] ⚠️ No valid analysis received from AI service for ${filePath}`);
			}
		} catch (error) {
			logger.logError(`[File History AI Service] ❌ Failed to generate file history analysis for ${filePath}: ${error}`);
			logger.logError(`[File History AI Service] 🔍 Error stack: ${error instanceof Error ? error.stack : 'No stack trace'}`);
		}
		return null;
	}

	/**
	 * Parse file history analysis result
	 */
	private parseFileHistoryAnalysis(analysisText: string): FileHistoryAIAnalysis {
		this.logger.log(`[File History Parse] Attempting to parse analysis text: ${analysisText.substring(0, 200)}...`);

		try {
			// 清理和预处理分析文本
			let cleanedText = analysisText.trim();

			// 如果文本被包裹在```json```代码块中，提取内容
			const jsonBlockMatch = cleanedText.match(/```json\s*([\s\S]*?)\s*```/);
			if (jsonBlockMatch) {
				cleanedText = jsonBlockMatch[1].trim();
				this.logger.log(`[File History Parse] Extracted JSON from code block: ${cleanedText.substring(0, 100)}...`);
			}

			// 尝试解析JSON格式的分析结果
			const parsed = JSON.parse(cleanedText);
			this.logger.log(`[File History Parse] Successfully parsed JSON: ${JSON.stringify(parsed)}`);

			// 验证必需字段并提供默认值
			const summary = parsed.summary || parsed.evolutionSummary || '文件历史分析完成';
			const evolutionPattern = parsed.evolutionPattern || parsed.pattern || '演进模式分析中';

			// 处理keyChanges字段，可能是字符串或数组
			let keyChanges: string[] = [];
			if (Array.isArray(parsed.keyChanges)) {
				keyChanges = parsed.keyChanges.filter((item: any) => typeof item === 'string' && item.trim() !== '');
			} else if (typeof parsed.keyChanges === 'string' && parsed.keyChanges.trim() !== '') {
				// 如果是字符串，按常见分隔符分割成数组
				keyChanges = parsed.keyChanges
					.split(/[,，。！？；\n]/g)
					.map((item: string) => item.trim())
					.filter((item: string) => item.length > 0 && item !== '');
			} else if (Array.isArray(parsed.changes)) {
				// 备用字段名
				keyChanges = parsed.changes.filter((item: any) => typeof item === 'string' && item.trim() !== '');
			}

			// 如果仍然为空，提供默认值
			if (keyChanges.length === 0) {
				keyChanges = ['关键变更分析中'];
			}

			// 处理recommendations字段，可能是字符串或数组
			let recommendations: string[] = [];
			if (Array.isArray(parsed.recommendations)) {
				recommendations = parsed.recommendations.filter((item: any) => typeof item === 'string' && item.trim() !== '');
			} else if (typeof parsed.recommendations === 'string' && parsed.recommendations.trim() !== '') {
				// 如果是字符串，按常见分隔符分割成数组
				recommendations = parsed.recommendations
					.split(/[,，。！？；\n]/g)
					.map((item: string) => item.trim())
					.filter((item: string) => item.length > 0 && item !== '');
			} else if (Array.isArray(parsed.suggestions)) {
				// 备用字段名
				recommendations = parsed.suggestions.filter((item: any) => typeof item === 'string' && item.trim() !== '');
			}

			// 如果仍然为空，提供默认值
			if (recommendations.length === 0) {
				recommendations = ['优化建议分析中'];
			}

			const result = {
				summary: summary.substring(0, 300), // 限制长度
				evolutionPattern: evolutionPattern.substring(0, 200), // 限制长度
				keyChanges: keyChanges.slice(0, 5), // 最多5个关键变更
				recommendations: recommendations.slice(0, 5) // 最多5个建议
			};

			this.logger.log(`[File History Parse] Final parsed result: ${JSON.stringify(result)}`);
			return result;
		} catch (error) {
			this.logger.log(`[File History Parse] JSON parsing failed, attempting text extraction: ${error}`);

			// 如果不是JSON格式，尝试从自然语言文本中提取信息
			return this.extractInfoFromText(analysisText);
		}
	}

	/**
	 * Extract analysis information from natural language text when JSON parsing fails
	 */
	private extractInfoFromText(analysisText: string): FileHistoryAIAnalysis {
		this.logger.log(`[File History Parse] Extracting from text: ${analysisText.substring(0, 100)}...`);

		// 使用AI返回的文本作为摘要，并生成基于文本的其他字段
		const summary = analysisText.substring(0, 300);

		// 尝试从文本中提取关键信息
		const lines = analysisText.split('\n').filter(line => line.trim() !== '');
		let evolutionPattern = '基于AI分析的演进模式';
		let keyChanges: string[] = ['AI识别的重要变更'];
		let recommendations: string[] = ['基于分析的优化建议'];

		// 简单的关键词匹配来提取信息
		const evolutionKeywords = ['演进', '发展', '变化', '趋势', '模式', '活跃', '频率', '演化'];
		const changeKeywords = ['变更', '修改', '添加', '删除', '重构', '修复', '优化', '更新'];
		const recommendationKeywords = ['建议', '推荐', '应该', '可以', '需要', '优化', '改进', '考虑'];

		// 查找演进模式相关的句子
		for (const line of lines) {
			if (evolutionKeywords.some(keyword => line.includes(keyword))) {
				evolutionPattern = line.trim().substring(0, 200);
				break;
			}
		}

		// 提取变更相关的内容
		const changeLines = lines.filter(line =>
			changeKeywords.some(keyword => line.includes(keyword))
		).slice(0, 3);
		if (changeLines.length > 0) {
			keyChanges = changeLines.map(line => line.trim().substring(0, 100));
		}

		// 提取建议相关的内容
		const recommendationLines = lines.filter(line =>
			recommendationKeywords.some(keyword => line.includes(keyword))
		).slice(0, 3);
		if (recommendationLines.length > 0) {
			recommendations = recommendationLines.map(line => line.trim().substring(0, 100));
		}

		return {
			summary: summary,
			evolutionPattern: evolutionPattern,
			keyChanges: keyChanges,
			recommendations: recommendations
		};
	}

	/**
	 * Send file history AI analysis update
	 */
	private sendFileHistoryAIAnalysisUpdate(filePath: string, analysis: FileHistoryAIAnalysis) {
		// 数据流调试：记录文件历史AI分析更新发送
		this.logger.log('[File History AI Callback] 📡 Sending file history AI analysis update');
		this.logger.log(`[File History AI Callback] 📁 Target file: ${filePath}`);
		this.logger.log(`[File History AI Callback] 📊 Analysis data - Summary: ${analysis.summary?.length || 0} chars, KeyChanges: ${analysis.keyChanges?.length || 0}, Recommendations: ${analysis.recommendations?.length || 0}`);

		if (this.aiAnalysisUpdateCallback) {
			try {
				this.logger.log('[File History AI Callback] ✅ Callback exists, invoking file history update');
				// 使用特殊的格式来标识这是文件历史分析
				this.aiAnalysisUpdateCallback(`file_history:${filePath}`, null, analysis);
				this.logger.log(`[File History AI Callback] 📤 Successfully sent file history AI analysis update for ${filePath}`);
			} catch (error) {
				this.logger.logError(`[File History AI Callback] ❌ Failed to invoke file history AI analysis callback: ${error}`);
				this.logger.logError(`[File History AI Callback] 🔍 Callback error details: ${error instanceof Error ? error.stack : 'Unknown error'}`);
			}
		} else {
			this.logger.log('[File History AI Callback] ⚠️ No AI analysis update callback registered - file history update will be lost');
		}
	}

	/**
	 * Trigger async AI analysis for file history
	 * @param filePath The file path
	 * @param commits The file history commits
	 * @returns Promise that resolves when analysis is complete
	 */
	public async triggerFileHistoryAIAnalysis(filePath: string, commits: GitFileHistoryCommit[]): Promise<void> {
		return this.performAsyncFileHistoryAnalysis(filePath, commits);
	}

	/**
	 * Get the comparison between two versions of a specific file
	 * @param repo The path of the repository
	 * @param filePath The path of the file
	 * @param fromHash The commit hash of the source version
	 * @param toHash The commit hash of the target version
	 * @returns The file version comparison data
	 */
	public async getFileVersionComparison(repo: string, filePath: string, fromHash: string, toHash: string): Promise<GitFileVersionComparisonData> {
		try {
			this.logger.log(`Getting file version comparison for ${filePath} from ${fromHash} to ${toHash}`);

			// 获取文件差异信息
			const [diffNameStatus, diffNumStat, diffContent] = await Promise.all([
				this.getDiffNameStatus(repo, fromHash, toHash, 'AMDR').catch(() => []),
				this.getDiffNumStat(repo, fromHash, toHash, 'AMDR').catch(() => []),
				this.getDiffBetweenRevisions(repo, fromHash, toHash, filePath).catch(() => null)
			]);

			// 查找该文件的变更信息
			let fileChange: GitFileChange | null = null;
			const fileNameStatusRecord = diffNameStatus.find(record =>
				record.newFilePath === filePath || record.oldFilePath === filePath
			);
			const fileNumStatRecord = diffNumStat.find(record => record.filePath === filePath);

			if (fileNameStatusRecord) {
				fileChange = {
					oldFilePath: fileNameStatusRecord.oldFilePath,
					newFilePath: fileNameStatusRecord.newFilePath,
					type: fileNameStatusRecord.type,
					additions: fileNumStatRecord?.additions || null,
					deletions: fileNumStatRecord?.deletions || null
				};
			}

			// 立即返回基本数据，不等待AI分析
			const basicResult: GitFileVersionComparisonData = {
				filePath: filePath,
				fromHash: fromHash,
				toHash: toHash,
				fileChange: fileChange,
				diffContent: diffContent,
				aiAnalysis: null,
				error: null
			};

			// 异步执行AI分析
			const config = getConfig();
			const aiConfig = config.aiAnalysis;

			if (aiConfig.enabled && diffContent && diffContent.trim() !== '') {
				this.performAsyncFileVersionComparisonAnalysis(repo, filePath, fromHash, toHash, diffContent, aiConfig)
					.catch(error => {
						this.logger.logError(`Async file version comparison AI analysis failed for ${filePath} (${fromHash}..${toHash}): ${error}`);
					});
			}

			return basicResult;

		} catch (error) {
			this.logger.logError(`Failed to get file version comparison for ${filePath}: ${error}`);
			return {
				filePath: filePath,
				fromHash: fromHash,
				toHash: toHash,
				fileChange: null,
				diffContent: null,
				aiAnalysis: null,
				error: `Failed to get file version comparison: ${error}`
			};
		}
	}

	/**
	 * Perform AI analysis for file version comparison asynchronously
	 */
	private async performAsyncFileVersionComparisonAnalysis(
		repo: string,
		filePath: string,
		fromHash: string,
		toHash: string,
		diffContent: string,
		_aiConfig: any // Add underscore prefix to mark as intentionally unused
	): Promise<void> {
		try {
			this.logger.log(`Starting async AI analysis for file version comparison: ${filePath} (${fromHash}..${toHash})`);

			// 获取文件内容
			const [contentBefore, contentAfter] = await Promise.all([
				this.getCommitFile(repo, fromHash, filePath).catch(() => null),
				this.getCommitFile(repo, toHash, filePath).catch(() => null)
			]);

			// 生成AI分析
			const analysis = await this.generateFileVersionComparisonAnalysis(
				filePath,
				fromHash,
				toHash,
				diffContent,
				contentBefore,
				contentAfter,
				this.logger
			);

			if (analysis) {
				// 发送AI分析更新
				this.sendFileVersionComparisonAIAnalysisUpdate(filePath, fromHash, toHash, analysis);
			}

		} catch (error) {
			this.logger.logError(`Failed to perform async file version comparison AI analysis: ${error}`);
		}
	}

	/**
	 * Generate AI analysis for file version comparison
	 */
	private async generateFileVersionComparisonAnalysis(
		filePath: string,
		fromHash: string,
		toHash: string,
		diffContent: string,
		contentBefore: string | null,
		contentAfter: string | null,
		logger: Logger
	): Promise<FileVersionComparisonAIAnalysis | null> {
		try {
			const payload = {
				filePath,
				fromHash,
				toHash,
				diffContent,
				contentBefore,
				contentAfter
			};

			// 使用专门的文件版本比较AI服务进行分析
			const analysis = await analyzeFileVersionComparison(
				filePath,
				payload,
				logger
			);

			if (analysis && analysis.summary) {
				return this.parseFileVersionComparisonAnalysis(analysis.summary);
			}

		} catch (error) {
			logger.logError(`Failed to generate AI analysis for file version comparison: ${error}`);
		}
		return null;
	}

	/**
	 * Parse file version comparison AI analysis result
	 */
	private parseFileVersionComparisonAnalysis(analysisText: string): FileVersionComparisonAIAnalysis {
		try {
			// 尝试解析JSON
			const parsed = JSON.parse(analysisText);

			if (parsed.summary && parsed.changeType && parsed.impactAnalysis &&
				Array.isArray(parsed.keyModifications) && Array.isArray(parsed.recommendations)) {
				return {
					summary: parsed.summary,
					changeType: parsed.changeType,
					impactAnalysis: parsed.impactAnalysis,
					keyModifications: parsed.keyModifications,
					recommendations: parsed.recommendations
				};
			}
		} catch (error) {
			this.logger.logError(`Failed to parse file version comparison analysis JSON: ${error}`);
		}

		// 如果JSON解析失败，尝试从文本中提取信息
		return this.extractFileVersionComparisonInfoFromText(analysisText);
	}

	/**
	 * Extract file version comparison analysis info from plain text
	 */
	private extractFileVersionComparisonInfoFromText(analysisText: string): FileVersionComparisonAIAnalysis {
		// 提供一个基础的结构化响应
		return {
			summary: analysisText.substring(0, 100) + (analysisText.length > 100 ? '...' : ''),
			changeType: '代码变更',
			impactAnalysis: '此次变更对文件结构和功能产生了一定影响',
			keyModifications: [
				'文件内容已发生变化',
				'代码逻辑可能有所调整',
				'建议查看具体的diff内容了解详情'
			],
			recommendations: [
				'仔细审查变更内容确保符合预期',
				'考虑进行相关测试以验证功能正确性'
			]
		};
	}

	/**
	 * Send file version comparison AI analysis update
	 */
	private sendFileVersionComparisonAIAnalysisUpdate(filePath: string, fromHash: string, toHash: string, analysis: FileVersionComparisonAIAnalysis) {
		if (this.aiAnalysisUpdateCallback) {
			this.logger.log(`Sending file version comparison AI analysis update for ${filePath} (${fromHash}..${toHash})`);

			// 使用特殊的commitHash格式来标识这是文件版本比较的AI分析
			const specialCommitHash = `file_comparison:${filePath}:${fromHash}:${toHash}`;
			this.aiAnalysisUpdateCallback(specialCommitHash, null, analysis);
		}
	}
}


/**
 * Generates the file changes from the diff output and status information.
 * @param nameStatusRecords The `--name-status` records.
 * @param numStatRecords The `--numstat` records.
 * @param status The deleted and untracked files.
 * @returns An array of file changes.
 */
function generateFileChanges(nameStatusRecords: DiffNameStatusRecord[], numStatRecords: DiffNumStatRecord[], status: GitStatusFiles | null) {
	let fileChanges: Writeable<GitFileChange>[] = [], fileLookup: { [file: string]: number } = {}, i = 0;

	for (i = 0; i < nameStatusRecords.length; i++) {
		fileLookup[nameStatusRecords[i].newFilePath] = fileChanges.length;
		fileChanges.push({ oldFilePath: nameStatusRecords[i].oldFilePath, newFilePath: nameStatusRecords[i].newFilePath, type: nameStatusRecords[i].type, additions: null, deletions: null });
	}

	if (status !== null) {
		let filePath;
		for (i = 0; i < status.deleted.length; i++) {
			filePath = getPathFromStr(status.deleted[i]);
			if (typeof fileLookup[filePath] === 'number') {
				fileChanges[fileLookup[filePath]].type = GitFileStatus.Deleted;
			} else {
				fileChanges.push({ oldFilePath: filePath, newFilePath: filePath, type: GitFileStatus.Deleted, additions: null, deletions: null });
			}
		}
		for (i = 0; i < status.untracked.length; i++) {
			filePath = getPathFromStr(status.untracked[i]);
			fileChanges.push({ oldFilePath: filePath, newFilePath: filePath, type: GitFileStatus.Untracked, additions: null, deletions: null });
		}
	}

	for (i = 0; i < numStatRecords.length; i++) {
		if (typeof fileLookup[numStatRecords[i].filePath] === 'number') {
			fileChanges[fileLookup[numStatRecords[i].filePath]].additions = numStatRecords[i].additions;
			fileChanges[fileLookup[numStatRecords[i].filePath]].deletions = numStatRecords[i].deletions;
		}
	}

	return fileChanges;
}

/**
 * Get the specified config value from a set of key-value config pairs.
 * @param configs A set key-value pairs of Git configuration records.
 * @param key The key of the desired config.
 * @returns The value for `key` if it exists, otherwise NULL.
 */
function getConfigValue(configs: GitConfigSet, key: string) {
	return typeof configs[key] !== 'undefined' ? configs[key] : null;
}

/**
 * Produce a suitable error message from a spawned Git command that terminated with an erroneous status code.
 * @param error An error generated by JavaScript (optional).
 * @param stdoutBuffer A buffer containing the data outputted to `stdout`.
 * @param stderr A string containing the data outputted to `stderr`.
 * @returns A suitable error message.
 */
function getErrorMessage(error: Error | null, stdoutBuffer: Buffer, stderr: string) {
	let stdout = stdoutBuffer.toString(), lines: string[];
	if (stdout !== '' || stderr !== '') {
		lines = (stderr + stdout).split(EOL_REGEX);
		lines.pop();
	} else if (error) {
		lines = error.message.split(EOL_REGEX);
	} else {
		lines = [];
	}
	return lines.join('\n');
}

/**
 * Remove trailing blank lines from an array of lines.
 * @param lines The array of lines.
 * @returns The same array.
 */
function removeTrailingBlankLines(lines: string[]) {
	while (lines.length > 0 && lines[lines.length - 1] === '') {
		lines.pop();
	}
	return lines;
}

/**
 * Get all the unique strings from an array of strings.
 * @param items The array of strings with duplicates.
 * @returns An array of unique strings.
 */
function unique(items: ReadonlyArray<string>) {
	const uniqueItems: { [item: string]: true } = {};
	items.forEach((item) => uniqueItems[item] = true);
	return Object.keys(uniqueItems);
}


/* Types */

interface DiffNameStatusRecord {
	type: GitFileStatus;
	oldFilePath: string;
	newFilePath: string;
}

interface DiffNumStatRecord {
	filePath: string;
	additions: number;
	deletions: number;
}

interface GitBranchData {
	branches: string[];
	head: string | null;
	error: ErrorInfo;
}

interface GitCommitRecord {
	hash: string;
	parents: string[];
	author: string;
	email: string;
	date: number;
	message: string;
}

interface GitCommitData {
	commits: GitCommit[];
	head: string | null;
	tags: string[];
	moreCommitsAvailable: boolean;
	error: ErrorInfo;
}

export interface GitCommitDetailsData {
	commitDetails: GitCommitDetails | null;
	error: ErrorInfo;
}

interface GitCommitComparisonData {
	fileChanges: GitFileChange[];
	aiAnalysis?: { summary: string } | null;
	error: ErrorInfo;
}

type GitConfigSet = { [key: string]: string };

interface GitRef {
	hash: string;
	name: string;
}

interface GitRefTag extends GitRef {
	annotated: boolean;
}

interface GitRefData {
	head: string | null;
	heads: GitRef[];
	tags: GitRefTag[];
	remotes: GitRef[];
}

interface GitRepoInfo extends GitBranchData {
	remotes: string[];
	stashes: GitStash[];
}

interface GitRepoConfigData {
	config: GitRepoConfig | null;
	error: ErrorInfo;
}

interface GitStatusFiles {
	deleted: string[];
	untracked: string[];
}

interface GitTagDetailsData {
	details: GitTagDetails | null;
	error: ErrorInfo;
}

interface GpgStatusCodeParsingDetails {
	readonly status: GitSignatureStatus,
	readonly uid: boolean
}
