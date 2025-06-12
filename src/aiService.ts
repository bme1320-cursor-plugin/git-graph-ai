import * as http from 'http';
import { Logger } from './logger';
import { AiCacheManager } from './aiCache';

// Define the structure for the AI analysis result with enhanced error handling
export interface AIAnalysis {
    summary?: string;
    error?: string;
    errorType?: 'timeout' | 'service_unavailable' | 'authentication_failed' | 'rate_limited' | 'invalid_response' | 'unknown_error';
    technicalError?: string;
    status?: 'analyzing' | 'completed' | 'error';
    // Potentially add more fields later, e.g., semantic_highlights: any[];
}

const AI_SERVICE_HOST = '127.0.0.1'; // Use 127.0.0.1 instead of localhost for clarity
const AI_SERVICE_PORT = 5111;
const AI_SERVICE_PATH = '/analyze_diff';
const DEFAULT_TIMEOUT = 30000; // 30 seconds
const MAX_RETRIES = 2;

// 全局缓存管理器实例
let cacheManager: AiCacheManager | null = null;

/**
 * 初始化AI缓存管理器
 * @param cacheDir 缓存目录
 * @param config 缓存配置
 * @param logger 日志记录器
 */
export function initializeAICache(cacheDir: string, config: any, logger?: Logger): void {
	if (config.enabled) {
		cacheManager = new AiCacheManager(cacheDir, {
			maxMemoryItems: config.maxMemoryItems,
			maxDiskItems: config.maxDiskItems,
			ttlHours: config.ttlHours,
			enabled: config.enabled
		}, logger);
		logger?.log('[AI Service] Cache manager initialized');
	} else {
		cacheManager = null;
		logger?.log('[AI Service] Cache disabled');
	}
}

/**
 * 获取缓存统计信息
 */
export function getCacheStats(): any {
	return cacheManager?.getStats() || {
		memoryItems: 0,
		diskItems: 0,
		totalSize: '0 Bytes',
		hitRate: 'N/A'
	};
}

/**
 * 清除所有缓存
 */
export async function clearCache(): Promise<void> {
	if (cacheManager) {
		await cacheManager.clear();
	}
}

/**
 * Calls the Python AI service to analyze a file diff with enhanced error handling.
 * @param analysisContext The context identifier for the analysis. Can be either:
 *                        - A file path (e.g., "src/components/Button.tsx") for individual file analysis
 *                        - An analysis type identifier (e.g., "comprehensive_commit_analysis") for broader analysis
 * @param fileDiff The raw diff content.
 * @param contentBefore Content before changes (optional, might be useful for AI).
 * @param contentAfter Content after changes (optional, might be useful for AI).
 * @param logger Optional logger instance.
 * @param timeout Request timeout in milliseconds (default: 30000).
 * @param retryCount Current retry attempt (for internal use).
 * @returns A Promise resolving to the AIAnalysis object or null if analysis fails.
 */
export function analyzeDiff(
	analysisContext: string,
	fileDiff: string,
	contentBefore: string | null,
	contentAfter: string | null,
	logger?: Logger,
	timeout: number = DEFAULT_TIMEOUT,
	retryCount: number = 0
): Promise<{ summary: string } | null> {
	return new Promise(async (resolve) => {
		logger?.log(`[AI Service] Starting AI analysis request (attempt ${retryCount + 1}/${MAX_RETRIES + 1})`);
		logger?.log(`[AI Service] Request data - AnalysisContext: ${analysisContext}, DiffLength: ${fileDiff?.length || 0} chars`);

		// 检查输入有效性
		if (!fileDiff || fileDiff.trim() === '') {
			logger?.log(`[AI Service] Skipping empty diff for: ${analysisContext}`);
			resolve(null);
			return;
		}

		// 尝试从缓存获取结果
		if (cacheManager) {
			const cacheKey = cacheManager.generateCacheKey(fileDiff, analysisContext);
			logger?.log(`[AI Service] Checking cache with key: ${cacheKey.substring(0, 16)}...`);

			const cachedResult = await cacheManager.get(cacheKey);
			if (cachedResult && cachedResult.summary) {
				logger?.log(`[AI Service] Cache hit for: ${analysisContext}`);
				resolve(cachedResult);
				return;
			} else {
				logger?.log(`[AI Service] Cache miss for: ${analysisContext}`);
			}
		}

		const postData = JSON.stringify({
			analysis_context: analysisContext,
			file_diff: fileDiff,
			content_before: contentBefore,
			content_after: contentAfter
		});

		const options: http.RequestOptions = {
			hostname: AI_SERVICE_HOST,
			port: AI_SERVICE_PORT,
			path: AI_SERVICE_PATH,
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Content-Length': Buffer.byteLength(postData)
			},
			timeout: timeout
		};

		logger?.log(`[AI Service] Sending HTTP request to AI service for: ${analysisContext}`);
		const requestStartTime = Date.now();

		const req = http.request(options, (res) => {
			let responseBody = '';
			res.setEncoding('utf8');

			logger?.log(`[AI Service] Receiving response - StatusCode: ${res.statusCode}`);

			res.on('data', (chunk) => {
				responseBody += chunk;
			});

			res.on('end', async () => {
				const responseTime = Date.now() - requestStartTime;
				logger?.log(`[AI Service] Request completed in ${responseTime}ms - StatusCode: ${res.statusCode}`);

				if (res.statusCode === 200) {
					try {
						const parsedData = JSON.parse(responseBody);

						if (parsedData && parsedData.analysis && parsedData.analysis.summary) {
							const analysis = { summary: parsedData.analysis.summary };
							logger?.log(`[AI Service] Valid analysis received for: ${analysisContext}`);

							// 缓存结果
							if (cacheManager) {
								const cacheKey = cacheManager.generateCacheKey(fileDiff, analysisContext);
								await cacheManager.set(cacheKey, analysis);
								logger?.log(`[AI Service] Result cached for: ${analysisContext}`);
							}

							resolve(analysis);
						} else {
							logger?.logError(`[AI Service] Invalid response format from AI service for ${analysisContext}`);

							// 重试逻辑
							if (retryCount < MAX_RETRIES) {
								logger?.log(`[AI Service] Retrying request for ${analysisContext} (${retryCount + 1}/${MAX_RETRIES})`);
								setTimeout(() => {
									analyzeDiff(analysisContext, fileDiff, contentBefore, contentAfter, logger, timeout, retryCount + 1)
										.then(resolve);
								}, 1000 * (retryCount + 1)); // Exponential backoff
							} else {
								resolve(null);
							}
						}
					} catch (e: any) {
						logger?.logError(`[AI Service] Error parsing JSON response for ${analysisContext}: ${e}`);

						// 重试逻辑
						if (retryCount < MAX_RETRIES) {
							logger?.log(`[AI Service] Retrying request for ${analysisContext} (${retryCount + 1}/${MAX_RETRIES})`);
							setTimeout(() => {
								analyzeDiff(analysisContext, fileDiff, contentBefore, contentAfter, logger, timeout, retryCount + 1)
									.then(resolve);
							}, 1000 * (retryCount + 1));
						} else {
							resolve(null);
						}
					}
				} else {
					logger?.logError(`[AI Service] Request failed for ${analysisContext} - Status Code: ${res.statusCode}`);

					// 重试逻辑 for 5xx errors
					if (res.statusCode && res.statusCode >= 500 && retryCount < MAX_RETRIES) {
						logger?.log(`[AI Service] Server error, retrying request for ${analysisContext} (${retryCount + 1}/${MAX_RETRIES})`);
						setTimeout(() => {
							analyzeDiff(analysisContext, fileDiff, contentBefore, contentAfter, logger, timeout, retryCount + 1)
								.then(resolve);
						}, 1000 * (retryCount + 1));
					} else {
						resolve(null);
					}
				}
			});
		});

		req.on('error', (err) => {
			logger?.logError(`[AI Service] Request error for ${analysisContext}: ${err.message}`);

			// 重试逻辑 for network errors
			if (retryCount < MAX_RETRIES) {
				logger?.log(`[AI Service] Network error, retrying request for ${analysisContext} (${retryCount + 1}/${MAX_RETRIES})`);
				setTimeout(() => {
					analyzeDiff(analysisContext, fileDiff, contentBefore, contentAfter, logger, timeout, retryCount + 1)
						.then(resolve);
				}, 1000 * (retryCount + 1));
			} else {
				resolve(null);
			}
		});

		req.on('timeout', () => {
			logger?.logError(`[AI Service] Request timeout for ${analysisContext} after ${timeout}ms`);
			req.destroy();

			// 重试逻辑 for timeouts
			if (retryCount < MAX_RETRIES) {
				logger?.log(`[AI Service] Timeout, retrying request for ${analysisContext} (${retryCount + 1}/${MAX_RETRIES})`);
				setTimeout(() => {
					analyzeDiff(analysisContext, fileDiff, contentBefore, contentAfter, logger, timeout * 1.5, retryCount + 1) // Increase timeout
						.then(resolve);
				}, 1000 * (retryCount + 1));
			} else {
				resolve(null);
			}
		});

		req.write(postData);
		req.end();
	});
}

/**
 * 批量分析多个文件的差异
 * @param analyses Array of file analysis requests
 * @param logger Logger instance
 * @returns Promise resolving to array of analysis results
 */
export async function analyzeDiffBatch(
	analyses: Array<{
		filePath: string;
		fileDiff: string;
		contentBefore: string | null;
		contentAfter: string | null;
	}>,
	logger?: Logger
): Promise<Array<{ filePath: string; analysis: { summary: string } | null }>> {
	logger?.log(`[AI Service] Starting batch analysis for ${analyses.length} files`);

	const results = await Promise.all(
		analyses.map(async ({ filePath, fileDiff, contentBefore, contentAfter }) => {
			const analysis = await analyzeDiff(filePath, fileDiff, contentBefore, contentAfter, logger);
			return { filePath, analysis };
		})
	);

	const successCount = results.filter(r => r.analysis !== null).length;
	logger?.log(`[AI Service] Batch analysis completed: ${successCount}/${analyses.length} successful`);

	return results;
}

/**
 * 检查AI服务是否可用
 * @param logger Logger instance
 * @returns Promise resolving to boolean indicating service availability
 */
export function checkAIServiceAvailability(logger?: Logger): Promise<boolean> {
	return new Promise((resolve) => {
		const options: http.RequestOptions = {
			hostname: AI_SERVICE_HOST,
			port: AI_SERVICE_PORT,
			path: '/health', // 假设AI服务有健康检查端点
			method: 'GET',
			timeout: 3000
		};

		const req = http.request(options, (res) => {
			resolve(res.statusCode === 200);
		});

		req.on('error', () => {
			logger?.log('[AI Service] Service not available');
			resolve(false);
		});

		req.on('timeout', () => {
			req.destroy();
			resolve(false);
		});

		req.end();
	});
}

/**
 * Analyze file history using the dedicated endpoint
 * @param filePath The path of the file
 * @param payload The analysis payload
 * @param logger Optional logger instance
 * @returns A Promise resolving to the analysis result or null if analysis fails
 */
export function analyzeFileHistory(
	filePath: string,
	payload: object,
	logger?: Logger
): Promise<{ summary: string } | null> {
	return new Promise(async (resolve) => {
		const payloadString = JSON.stringify(payload);
		// 检查输入有效性
		if (!payloadString || payloadString === '{}') {
			logger?.log(`[AI Service] Skipping empty payload for file history: ${filePath}`);
			resolve(null);
			return;
		}

		// 尝试从缓存获取结果
		if (cacheManager) {
			const cacheKey = cacheManager.generateCacheKey(payloadString, `file_history:${filePath}`);
			const cachedResult = await cacheManager.get(cacheKey);
			if (cachedResult && cachedResult.summary) {
				logger?.log(`[AI Service] Cache hit for file history: ${filePath}`);
				resolve(cachedResult);
				return;
			}
		}

		const postData = JSON.stringify({
			analysis_context: filePath,
			file_diff: payloadString // 复用这个字段传递完整的JSON负载
		});

		const options: http.RequestOptions = {
			hostname: AI_SERVICE_HOST,
			port: AI_SERVICE_PORT,
			path: '/analyze_file_history', // 使用专门的文件历史分析端点
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Content-Length': Buffer.byteLength(postData)
			},
			timeout: 15000 // 文件历史分析可能需要更长时间
		};

		logger?.log(`[AI Service] Sending file history analysis request for: ${filePath}`);

		const req = http.request(options, (res) => {
			let responseBody = '';
			res.setEncoding('utf8');

			res.on('data', (chunk) => {
				responseBody += chunk;
			});

			res.on('end', async () => {
				if (res.statusCode === 200) {
					try {
						const parsedData = JSON.parse(responseBody);
						if (parsedData && parsedData.analysis && parsedData.analysis.summary) {
							const analysis = { summary: parsedData.analysis.summary };
							logger?.log(`[AI Service] Received file history analysis for: ${filePath}`);

							// 缓存结果
							if (cacheManager) {
								const cacheKey = cacheManager.generateCacheKey(payloadString, `file_history:${filePath}`);
								await cacheManager.set(cacheKey, analysis);
								logger?.log(`[AI Service] Cached file history result for: ${filePath}`);
							}

							resolve(analysis);
						} else {
							logger?.logError(`[AI Service] Invalid response format from file history service for ${filePath}: ${responseBody}`);
							resolve(null);
						}
					} catch (e: any) {
						logger?.logError(`[AI Service] Error parsing JSON response for file history ${filePath}: ${e} - Response: ${responseBody}`);
						resolve(null);
					}
				} else {
					logger?.logError(`[AI Service] File history request failed for ${filePath} - Status Code: ${res.statusCode} - Response: ${responseBody}`);
					resolve(null);
				}
			});
		});

		req.on('error', (e: Error) => {
			logger?.logError(`[AI Service] File history request error for ${filePath}: ${e.message}`);
			if (e.message.includes('ECONNREFUSED')) {
				logger?.logError('[AI Service] Connection refused. Is the Python AI server running on port 5111?');
			}
			resolve(null);
		});

		req.on('timeout', () => {
			logger?.logError(`[AI Service] File history request timed out for ${filePath}.`);
			req.destroy(new Error('Request timed out'));
			resolve(null);
		});

		// Write data to request body
		req.write(postData);
		req.end();
	});
}

/**
 * Analyze file version comparison using the dedicated endpoint
 * @param filePath The path of the file
 * @param payload The analysis payload
 * @param logger Optional logger instance
 * @returns A Promise resolving to the analysis result or null if analysis fails
 */
export function analyzeFileVersionComparison(
	filePath: string,
	payload: object,
	logger?: Logger
): Promise<{ summary: string } | null> {
	return new Promise(async (resolve) => {
		const payloadString = JSON.stringify(payload);
		// 检查输入有效性
		if (!payloadString || payloadString === '{}') {
			logger?.log(`[AI Service] Skipping empty payload for file version comparison: ${filePath}`);
			resolve(null);
			return;
		}

		// 尝试从缓存获取结果
		if (cacheManager) {
			const cacheKey = cacheManager.generateCacheKey(payloadString, `file_version_comparison:${filePath}`);
			const cachedResult = await cacheManager.get(cacheKey);
			if (cachedResult && cachedResult.summary) {
				logger?.log(`[AI Service] Cache hit for file version comparison: ${filePath}`);
				resolve(cachedResult);
				return;
			}
		}

		const postData = JSON.stringify({
			analysis_context: filePath,
			file_diff: payloadString // 复用这个字段传递完整的JSON负载
		});

		const options: http.RequestOptions = {
			hostname: AI_SERVICE_HOST,
			port: AI_SERVICE_PORT,
			path: '/analyze_file_version_comparison', // 使用专门的文件版本比较分析端点
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Content-Length': Buffer.byteLength(postData)
			},
			timeout: 15000 // 文件版本比较分析可能需要更长时间
		};

		logger?.log(`[AI Service] Sending file version comparison analysis request for: ${filePath}`);

		const req = http.request(options, (res) => {
			let data = '';

			res.on('data', (chunk) => {
				data += chunk;
			});

			res.on('end', async () => {
				try {
					const response = JSON.parse(data);
					if (response.analysis && response.analysis.summary) {
						const analysis = { summary: response.analysis.summary };

						// 缓存结果
						if (cacheManager) {
							const cacheKey = cacheManager.generateCacheKey(payloadString, `file_version_comparison:${filePath}`);
							await cacheManager.set(cacheKey, analysis);
						}

						logger?.log(`[AI Service] File version comparison analysis completed for: ${filePath}`);
						resolve(analysis);
					} else {
						logger?.logError(`[AI Service] Invalid response format for file version comparison analysis: ${filePath}`);
						resolve(null);
					}
				} catch (error) {
					logger?.logError(`[AI Service] Failed to parse file version comparison analysis response for ${filePath}: ${error}`);
					resolve(null);
				}
			});
		});

		req.on('error', (error) => {
			logger?.logError(`[AI Service] Request error for file version comparison analysis ${filePath}: ${error}`);
			resolve(null);
		});

		req.on('timeout', () => {
			logger?.logError(`[AI Service] Request timeout for file version comparison analysis: ${filePath}`);
			req.destroy();
			resolve(null);
		});

		req.write(postData);
		req.end();
	});
}
