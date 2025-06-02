import * as http from 'http';
import { Logger } from './logger'; // Assuming Logger exists and can be used

// Define the structure for the AI analysis result
export interface AIAnalysis {
    summary: string;
    // Potentially add more fields later, e.g., semantic_highlights: any[];
}

const AI_SERVICE_HOST = '127.0.0.1'; // Use 127.0.0.1 instead of localhost for clarity
const AI_SERVICE_PORT = 5111;
const AI_SERVICE_PATH = '/analyze_diff';

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
	return new Promise((resolve) => {
		// 检查输入有效性
		if (!fileDiff || fileDiff.trim() === '') {
			logger?.log(`[AI Service] Skipping empty diff for: ${filePath}`);
			resolve(null);
			return;
		}

		const postData = JSON.stringify({
			file_path: filePath,
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
			timeout: 10000 // 增加到10秒超时
		};

		logger?.log(`[AI Service] Sending request to analyze diff for: ${filePath}`);

		const req = http.request(options, (res) => {
			let responseBody = '';
			res.setEncoding('utf8');

			res.on('data', (chunk) => {
				responseBody += chunk;
			});

			res.on('end', () => {
				if (res.statusCode === 200) {
					try {
						const parsedData = JSON.parse(responseBody);
						if (parsedData && parsedData.analysis && parsedData.analysis.summary) {
							logger?.log(`[AI Service] Received analysis for: ${filePath}`);
							resolve(parsedData.analysis as AIAnalysis);
						} else {
							logger?.logError(`[AI Service] Invalid response format from AI service for ${filePath}: ${responseBody}`);
							resolve(null);
						}
					} catch (e: any) {
						logger?.logError(`[AI Service] Error parsing JSON response for ${filePath}: ${e} - Response: ${responseBody}`);
						resolve(null);
					}
				} else {
					logger?.logError(`[AI Service] Request failed for ${filePath} - Status Code: ${res.statusCode} - Response: ${responseBody}`);
					resolve(null);
				}
			});
		});

		req.on('error', (e: Error) => {
			logger?.logError(`[AI Service] Request error for ${filePath}: ${e.message}`);
			if (e.message.includes('ECONNREFUSED')) {
				logger?.logError('[AI Service] Connection refused. Is the Python AI server running on port 5111?');
			}
			resolve(null);
		});

		req.on('timeout', () => {
			logger?.logError(`[AI Service] Request timed out for ${filePath}.`);
			req.destroy(new Error('Request timed out'));
			resolve(null);
		});

		// Write data to request body
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
