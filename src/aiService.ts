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
        const postData = JSON.stringify({
            file_path: filePath,
            file_diff: fileDiff,
            content_before: contentBefore,
            content_after: contentAfter,
        });

        const options: http.RequestOptions = {
            hostname: AI_SERVICE_HOST,
            port: AI_SERVICE_PORT,
            path: AI_SERVICE_PATH,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData),
            },
            timeout: 5000 // 5 second timeout
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
                        if (parsedData && parsedData.analysis) {
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
                logger?.logError('[AI Service] Connection refused. Is the Python AI server running?');
                // Optionally show a user-facing message here if desired, but often background errors are just logged.
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