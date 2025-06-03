import * as fs from 'fs';
import * as path from 'path';

/**
 * 文件类型检测器
 * 提供更智能的文件可读性检测，不仅仅依赖文件扩展名
 */
export class FileTypeDetector {
    // 已知的文本文件扩展名（保留作为快速检测）
    private static readonly TEXT_EXTENSIONS = new Set([
    	'.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.c', '.cpp', '.h', '.hpp',
    	'.cs', '.php', '.rb', '.go', '.rs', '.swift', '.kt', '.scala', '.clj',
    	'.html', '.css', '.scss', '.less', '.vue', '.svelte', '.md', '.txt',
    	'.json', '.xml', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf',
    	'.sh', '.bash', '.zsh', '.fish', '.bat', '.ps1', '.cmd',
    	'.sql', '.dockerfile', '.gitignore', '.gitattributes', '.editorconfig',
    	'.env', '.properties', '.lock', '.log', '.diff', '.patch'
    ]);

    // 明确的二进制文件扩展名
    private static readonly BINARY_EXTENSIONS = new Set([
    	'.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tiff', '.webp', '.ico', '.svg',
    	'.pdf', '.zip', '.tar', '.gz', '.rar', '.7z', '.bz2', '.xz',
    	'.exe', '.dll', '.so', '.dylib', '.bin', '.obj', '.class',
    	'.jar', '.war', '.ear', '.aar', '.apk', '.ipa',
    	'.mp3', '.mp4', '.avi', '.mkv', '.mov', '.wav', '.flac',
    	'.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx'
    ]);

    // 无扩展名但通常是文本文件的文件名
    private static readonly TEXT_FILENAMES = new Set([
    	'dockerfile', 'makefile', 'rakefile', 'gemfile', 'podfile',
    	'license', 'readme', 'changelog', 'authors', 'contributors',
    	'copying', 'install', 'news', 'todo', 'version', 'manifest',
    	'procfile', 'vagrantfile', 'gruntfile', 'gulpfile', 'webpack',
    	'.gitignore', '.gitattributes', '.dockerignore', '.npmignore',
    	'.editorconfig', '.eslintrc', '.prettierrc', '.babelrc', '.nvmrc'
    ]);

    // Shebang 模式匹配（用于识别脚本文件）
    private static readonly SHEBANG_PATTERNS = [
    	/^#!\s*\/.*\/(bash|sh|zsh|fish|dash|csh|tcsh)/,
    	/^#!\s*\/.*\/(python|python3|node|ruby|perl|php)/,
    	/^#!\s*\/usr\/bin\/env\s+(bash|sh|zsh|fish|python|python3|node|ruby|perl|php)/
    ];

    /**
     * 检查文件是否适合进行AI分析
     * @param filePath 文件路径
     * @param repoPath 仓库根路径（可选，用于读取文件内容）
     * @param useIntelligentDetection 是否启用智能检测（默认true）
     * @returns Promise<boolean> 是否适合分析
     */
    public static async isFileEligibleForAnalysis(
    	filePath: string,
    	repoPath?: string,
    	useIntelligentDetection: boolean = true
    ): Promise<boolean> {
    	const fileName = path.basename(filePath).toLowerCase();
    	const ext = path.extname(filePath).toLowerCase();

    	// 1. 快速检查：明确的二进制文件扩展名
    	if (this.BINARY_EXTENSIONS.has(ext)) {
    		return false;
    	}

    	// 2. 快速检查：已知的文本文件扩展名
    	if (this.TEXT_EXTENSIONS.has(ext)) {
    		return true;
    	}

    	// 如果未启用智能检测，只依赖扩展名
    	if (!useIntelligentDetection) {
    		return false;
    	}

    	// 3. 检查无扩展名的已知文本文件
    	if (!ext && this.TEXT_FILENAMES.has(fileName)) {
    		return true;
    	}

    	// 4. 如果提供了仓库路径，进行更深入的内容检测
    	if (repoPath) {
    		return this.detectByContent(path.join(repoPath, filePath));
    	}

    	// 5. 对于未知扩展名，使用启发式规则
    	return this.isLikelyTextFile(fileName, ext);
    }

    /**
     * 通过文件内容检测文件类型
     * @param fullPath 文件的完整路径
     * @returns Promise<boolean>
     */
    private static async detectByContent(fullPath: string): Promise<boolean> {
    	try {
    		// 检查文件是否存在
    		if (!fs.existsSync(fullPath)) {
    			return false;
    		}

    		// 获取文件大小，过大的文件可能不适合分析
    		const stats = fs.statSync(fullPath);
    		if (stats.size > 1024 * 1024) { // 1MB 限制
    			return false;
    		}

    		// 读取文件开头部分进行检测
    		const buffer = fs.readFileSync(fullPath, { encoding: null });
    		const sampleSize = Math.min(512, buffer.length);
    		const sample = buffer.slice(0, sampleSize);

    		// 1. 检查 shebang
    		const content = sample.toString('utf8');
    		const lines = content.split('\n');
    		if (lines[0] && this.matchesShebang(lines[0])) {
    			return true;
    		}

    		// 2. 检查是否包含null字节（二进制文件特征）
    		if (sample.includes(0)) {
    			return false;
    		}

    		// 3. 统计可打印字符比例
    		const printableRatio = this.calculatePrintableRatio(sample);
    		if (printableRatio < 0.7) { // 可打印字符比例低于70%认为是二进制
    			return false;
    		}

    		// 4. 检查文件内容模式
    		return this.detectContentPatterns(content);

    	} catch (error) {
    		// 如果无法读取文件，保守地返回 false
    		return false;
    	}
    }

    /**
     * 检查是否匹配 shebang 模式
     */
    private static matchesShebang(line: string): boolean {
    	return this.SHEBANG_PATTERNS.some(pattern => pattern.test(line));
    }

    /**
     * 计算可打印字符比例
     */
    private static calculatePrintableRatio(buffer: Buffer): number {
    	let printableCount = 0;
    	for (let i = 0; i < buffer.length; i++) {
    		const byte = buffer[i];
    		// 可打印ASCII字符 (32-126) 或常见控制字符 (9, 10, 13)
    		if ((byte >= 32 && byte <= 126) || byte === 9 || byte === 10 || byte === 13) {
    			printableCount++;
    		}
    	}
    	return printableCount / buffer.length;
    }

    /**
     * 检测内容模式
     */
    private static detectContentPatterns(content: string): boolean {
    	// JSON文件
    	if (this.isValidJSON(content)) {
    		return true;
    	}

    	// XML/HTML文件
    	if (/<[^>]+>/.test(content)) {
    		return true;
    	}

    	// YAML文件
    	if (/^[\s]*[a-zA-Z_][a-zA-Z0-9_]*\s*:/.test(content)) {
    		return true;
    	}

    	// 配置文件模式
    	if (/^[\s]*[a-zA-Z_][a-zA-Z0-9_]*\s*=/.test(content)) {
    		return true;
    	}

    	// 包含常见编程语言关键字
    	const programmingKeywords = [
    		'function', 'class', 'import', 'export', 'const', 'let', 'var',
    		'def', 'if', 'else', 'for', 'while', 'return', 'package',
    		'namespace', 'using', 'include', 'require', 'module'
    	];

    	const hasKeywords = programmingKeywords.some(keyword =>
    		new RegExp(`\\b${keyword}\\b`, 'i').test(content)
    	);

    	return hasKeywords;
    }

    /**
     * 验证是否为有效的JSON
     */
    private static isValidJSON(content: string): boolean {
    	try {
    		JSON.parse(content);
    		return true;
    	} catch {
    		return false;
    	}
    }

    /**
     * 启发式规则判断是否可能是文本文件
     */
    private static isLikelyTextFile(fileName: string, _ext: string): boolean {
    	// 检查文件名模式
    	const textPatterns = [
    		/readme/i, /license/i, /changelog/i, /makefile/i,
    		/dockerfile/i, /gemfile/i, /rakefile/i, /procfile/i,
    		/\..*rc$/i, /\.conf$/i, /\.config$/i, /\.cfg$/i
    	];

    	return textPatterns.some(pattern => pattern.test(fileName));
    }

    /**
     * 获取支持的文件扩展名列表（用于向后兼容）
     */
    public static getSupportedExtensions(): string[] {
    	return Array.from(this.TEXT_EXTENSIONS);
    }

    /**
     * 获取排除的文件扩展名列表（用于向后兼容）
     */
    public static getExcludedExtensions(): string[] {
    	return Array.from(this.BINARY_EXTENSIONS);
    }

    /**
     * 批量检测文件
     * @param filePaths 文件路径数组
     * @param repoPath 仓库路径
     * @param useIntelligentDetection 是否启用智能检测（默认true）
     * @returns Promise<string[]> 可分析的文件路径数组
     */
    public static async filterEligibleFiles(
    	filePaths: string[],
    	repoPath?: string,
    	useIntelligentDetection: boolean = true
    ): Promise<string[]> {
    	const results = await Promise.all(
    		filePaths.map(async (filePath) => ({
    			filePath,
    			eligible: await this.isFileEligibleForAnalysis(filePath, repoPath, useIntelligentDetection)
    		}))
    	);

    	return results
    		.filter(result => result.eligible)
    		.map(result => result.filePath);
    }
}
