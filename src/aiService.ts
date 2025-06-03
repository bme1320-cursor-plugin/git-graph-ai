import * as http from 'http';
import { Logger } from './logger';
import { AiCacheManager } from './aiCache';

// Define the structure for the AI analysis result
export interface AIAnalysis {
    summary: string;
    // Potentially add more fields later, e.g., semantic_highlights: any[];
}

const AI_SERVICE_HOST = '127.0.0.1'; // Use 127.0.0.1 instead of localhost for clarity
const AI_SERVICE_PORT = 5111;
const AI_SERVICE_PATH = '/analyze_diff';

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
 * Calls the Python AI service to analyze a file diff.
 * @param filePath The path of the file being diffed.
 * @param fileDiff The raw diff content.
 * @param contentBefore Content before changes (optional, might be useful for AI).
 * @param contentAfter Content after changes (optional, might be useful for AI).
 * @param logger Optional logger instance.
 * @returns A Promise resolving to the AIAnalysis object or null if analysis fails.
 */
export function analyzeDiff(
	filePath: string,
	fileDiff: string,
	contentBefore: string | null,
	contentAfter: string | null,
	logger?: Logger
): Promise<AIAnalysis | null> {
	return new Promise(async (resolve) => {
		// 数据流调试：记录AI服务请求开始
		logger?.log('[AI Service] 🚀 Starting AI analysis request');
		logger?.log(`[AI Service] 📊 Request data - FilePath: ${filePath}, DiffLength: ${fileDiff?.length || 0} chars`);
		logger?.log(`[AI Service] 📝 Content info - Before: ${contentBefore?.length || 0} chars, After: ${contentAfter?.length || 0} chars`);

		// 检查输入有效性
		if (!fileDiff || fileDiff.trim() === '') {
			logger?.log(`[AI Service] ⚠️ Skipping empty diff for: ${filePath}`);
			resolve(null);
			return;
		}

		// 数据流调试：记录缓存检查
		logger?.log('[AI Service] 🔍 Checking cache for analysis result');

		// 尝试从缓存获取结果
		if (cacheManager) {
			const cacheKey = cacheManager.generateCacheKey(fileDiff, filePath);
			logger?.log(`[AI Service] 🔑 Generated cache key: ${cacheKey.substring(0, 16)}...`);

			const cacheCheckStartTime = Date.now();
			const cachedResult = await cacheManager.get(cacheKey);
			const cacheCheckEndTime = Date.now();

			if (cachedResult) {
				logger?.log(`[AI Service] ✅ Cache hit for: ${filePath} (checked in ${cacheCheckEndTime - cacheCheckStartTime}ms)`);
				logger?.log(`[AI Service] 📋 Cached result - Summary length: ${cachedResult.summary?.length || 0} chars`);
				resolve(cachedResult);
				return;
			} else {
				logger?.log(`[AI Service] ❌ Cache miss for: ${filePath} (checked in ${cacheCheckEndTime - cacheCheckStartTime}ms)`);
			}
		} else {
			logger?.log('[AI Service] ⚠️ Cache manager not available - proceeding without cache');
		}

		// 数据流调试：记录HTTP请求构建
		const postData = JSON.stringify({
			file_path: filePath,
			file_diff: fileDiff,
			content_before: contentBefore,
			content_after: contentAfter
		});

		logger?.log(`[AI Service] 📦 Built HTTP request - PayloadSize: ${postData.length} chars`);
		logger?.log(`[AI Service] 🌐 Target endpoint: ${AI_SERVICE_HOST}:${AI_SERVICE_PORT}${AI_SERVICE_PATH}`);

		const options: http.RequestOptions = {
			hostname: AI_SERVICE_HOST,
			port: AI_SERVICE_PORT,
			path: AI_SERVICE_PATH,
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Content-Length': Buffer.byteLength(postData)
			},
			timeout: 30000
		};

		logger?.log(`[AI Service] 🚀 Sending HTTP request to AI service for: ${filePath}`);
		const requestStartTime = Date.now();

		const req = http.request(options, (res) => {
			let responseBody = '';
			res.setEncoding('utf8');

			// 数据流调试：记录响应接收
			logger?.log(`[AI Service] 📡 Receiving response - StatusCode: ${res.statusCode}, Headers: ${JSON.stringify(res.headers)}`);

			res.on('data', (chunk) => {
				responseBody += chunk;
				logger?.log(`[AI Service] 📊 Received data chunk - Size: ${chunk.length} chars, Total so far: ${responseBody.length} chars`);
			});

			res.on('end', async () => {
				const requestEndTime = Date.now();
				const responseTime = requestEndTime - requestStartTime;

				logger?.log(`[AI Service] ⏱️ Request completed in ${responseTime}ms - StatusCode: ${res.statusCode}, ResponseSize: ${responseBody.length} chars`);

				if (res.statusCode === 200) {
					try {
						// 数据流调试：记录响应解析
						logger?.log(`[AI Service] 🔄 Parsing JSON response for ${filePath}`);
						const parseStartTime = Date.now();
						const parsedData = JSON.parse(responseBody);
						const parseEndTime = Date.now();

						logger?.log(`[AI Service] ⏱️ JSON parsing completed in ${parseEndTime - parseStartTime}ms`);
						logger?.log(`[AI Service] 📋 Parsed response structure: ${JSON.stringify(Object.keys(parsedData))}`);

						if (parsedData && parsedData.analysis && parsedData.analysis.summary) {
							const analysis = parsedData.analysis as AIAnalysis;
							logger?.log(`[AI Service] ✅ Valid analysis received for: ${filePath}`);
							logger?.log(`[AI Service] 📝 Analysis summary preview: "${analysis.summary.substring(0, 100)}..."`);

							// 数据流调试：记录缓存存储
							if (cacheManager) {
								logger?.log(`[AI Service] 💾 Storing result in cache for: ${filePath}`);
								const cacheStoreStartTime = Date.now();
								const cacheKey = cacheManager.generateCacheKey(fileDiff, filePath);
								await cacheManager.set(cacheKey, analysis);
								const cacheStoreEndTime = Date.now();
								logger?.log(`[AI Service] ✅ Cached result for: ${filePath} (stored in ${cacheStoreEndTime - cacheStoreStartTime}ms)`);
							}

							resolve(analysis);
						} else {
							logger?.logError(`[AI Service] ❌ Invalid response format from AI service for ${filePath}: ${responseBody}`);
							logger?.logError(`[AI Service] 🔍 Expected structure: {analysis: {summary: string}}, Got: ${JSON.stringify(parsedData)}`);
							resolve(null);
						}
					} catch (e: any) {
						logger?.logError(`[AI Service] ❌ Error parsing JSON response for ${filePath}: ${e} - Response: ${responseBody}`);
						logger?.logError(`[AI Service] 🔍 Parse error details: ${e instanceof Error ? e.stack : 'Unknown parse error'}`);
						resolve(null);
					}
				} else {
					logger?.logError(`[AI Service] ❌ Request failed for ${filePath} - Status Code: ${res.statusCode} - Response: ${responseBody}`);
					logger?.logError(`[AI Service] 🔍 Response headers: ${JSON.stringify(res.headers)}`);
					resolve(null);
				}
			});
		});

		req.on('error', (e: Error) => {
			const requestEndTime = Date.now();
			const failedRequestTime = requestEndTime - requestStartTime;

			logger?.logError(`[AI Service] ❌ Request error for ${filePath} after ${failedRequestTime}ms: ${e.message}`);
			logger?.logError(`[AI Service] 🔍 Error details: ${e.stack || 'No stack trace'}`);

			if (e.message.includes('ECONNREFUSED')) {
				logger?.logError('[AI Service] 🔌 Connection refused. Is the Python AI server running on port 5111?');
			} else if (e.message.includes('ETIMEDOUT')) {
				logger?.logError('[AI Service] ⏰ Connection timed out. Check network connectivity to AI service.');
			}
			resolve(null);
		});

		req.on('timeout', () => {
			const requestEndTime = Date.now();
			const timeoutDuration = requestEndTime - requestStartTime;

			logger?.logError(`[AI Service] ⏰ Request timed out for ${filePath} after ${timeoutDuration}ms.`);
			req.destroy(new Error('Request timed out'));
			resolve(null);
		});

		// 数据流调试：记录数据发送
		logger?.log(`[AI Service] 📤 Writing request data - Size: ${postData.length} chars`);
		// Write data to request body
		req.write(postData);
		req.end();
		logger?.log(`[AI Service] ✅ Request sent successfully for: ${filePath}`);
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
): Promise<Array<{ filePath: string; analysis: AIAnalysis | null }>> {
	// 限制并发数量以避免过载AI服务
	const BATCH_SIZE = 3;
	const results: Array<{ filePath: string; analysis: AIAnalysis | null }> = [];

	for (let i = 0; i < analyses.length; i += BATCH_SIZE) {
		const batch = analyses.slice(i, i + BATCH_SIZE);
		const batchPromises = batch.map(async (item) => {
			const analysis = await analyzeDiff(item.filePath, item.fileDiff, item.contentBefore, item.contentAfter, logger);
			return { filePath: item.filePath, analysis };
		});

		const batchResults = await Promise.all(batchPromises);
		results.push(...batchResults);

		// 在批次之间添加小延迟以避免过载
		if (i + BATCH_SIZE < analyses.length) {
			await new Promise(resolve => setTimeout(resolve, 100));
		}
	}

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
 * @param prompt The analysis prompt
 * @param logger Optional logger instance
 * @returns A Promise resolving to the AIAnalysis object or null if analysis fails
 */
export function analyzeFileHistory(
	filePath: string,
	prompt: string,
	logger?: Logger
): Promise<AIAnalysis | null> {
	return new Promise(async (resolve) => {
		// 检查输入有效性
		if (!prompt || prompt.trim() === '') {
			logger?.log(`[AI Service] Skipping empty prompt for file history: ${filePath}`);
			resolve(null);
			return;
		}

		// 尝试从缓存获取结果
		if (cacheManager) {
			const cacheKey = cacheManager.generateCacheKey(prompt, `file_history:${filePath}`);
			const cachedResult = await cacheManager.get(cacheKey);
			if (cachedResult) {
				logger?.log(`[AI Service] Cache hit for file history: ${filePath}`);
				resolve(cachedResult);
				return;
			}
		}

		const postData = JSON.stringify({
			file_path: filePath,
			file_diff: prompt // 复用这个字段传递完整的提示词
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
							const analysis = parsedData.analysis as AIAnalysis;
							logger?.log(`[AI Service] Received file history analysis for: ${filePath}`);

							// 缓存结果
							if (cacheManager) {
								const cacheKey = cacheManager.generateCacheKey(prompt, `file_history:${filePath}`);
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
 * @param prompt The analysis prompt
 * @param logger Optional logger instance
 * @returns A Promise resolving to the AIAnalysis object or null if analysis fails
 */
export function analyzeFileVersionComparison(
	filePath: string,
	prompt: string,
	logger?: Logger
): Promise<AIAnalysis | null> {
	return new Promise(async (resolve) => {
		// 检查输入有效性
		if (!prompt || prompt.trim() === '') {
			logger?.log(`[AI Service] Skipping empty prompt for file version comparison: ${filePath}`);
			resolve(null);
			return;
		}

		// 尝试从缓存获取结果
		if (cacheManager) {
			const cacheKey = cacheManager.generateCacheKey(prompt, `file_version_comparison:${filePath}`);
			const cachedResult = await cacheManager.get(cacheKey);
			if (cachedResult) {
				logger?.log(`[AI Service] Cache hit for file version comparison: ${filePath}`);
				resolve(cachedResult);
				return;
			}
		}

		const postData = JSON.stringify({
			file_path: filePath,
			file_diff: prompt // 复用这个字段传递完整的提示词
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
						const aiAnalysis: AIAnalysis = {
							summary: response.analysis.summary
						};

						// 缓存结果
						if (cacheManager) {
							const cacheKey = cacheManager.generateCacheKey(prompt, `file_version_comparison:${filePath}`);
							await cacheManager.set(cacheKey, aiAnalysis);
						}

						logger?.log(`[AI Service] File version comparison analysis completed for: ${filePath}`);
						resolve(aiAnalysis);
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
