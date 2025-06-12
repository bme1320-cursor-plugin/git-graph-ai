import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { Logger } from './logger';

// AI分析缓存项接口
export interface AICacheItem {
    key: string;
    analysis: {
        summary: string;
    };
    timestamp: number;
    accessCount: number;
    lastAccessed: number;
}

// 缓存配置接口
export interface AICacheConfig {
    maxMemoryItems: number; // 内存缓存最大项数
    maxDiskItems: number; // 磁盘缓存最大项数
    ttlHours: number; // 缓存生存时间（小时）
    cacheDir: string; // 缓存目录
    enabled: boolean; // 是否启用缓存
}

// 默认缓存配置
const DEFAULT_CACHE_CONFIG: AICacheConfig = {
	maxMemoryItems: 100,
	maxDiskItems: 500,
	ttlHours: 24 * 7, // 7天
	cacheDir: '',
	enabled: true
};

/**
 * 生成缓存键参数接口
 */
export interface CacheKeyParams {
    analysisType: string;
    commitHash?: string;
    compareWithHash?: string;
    filePath?: string;
    additionalContext?: Record<string, string>;
}

/**
 * AI分析缓存管理器
 * 提供内存和磁盘两级缓存，支持LRU淘汰和过期清理
 */
export class AiCacheManager {
    private memoryCache: Map<string, AICacheItem> = new Map();
    private config: AICacheConfig;
    private logger?: Logger;
    private cacheFilePath: string;

    constructor(cacheDir: string, config: Partial<AICacheConfig> = {}, logger?: Logger) {
    	this.config = { ...DEFAULT_CACHE_CONFIG, ...config, cacheDir };
    	this.logger = logger;
    	this.cacheFilePath = path.join(cacheDir, 'ai-analysis-cache.json');

    	// 确保缓存目录存在
    	this.ensureCacheDir();

    	// 加载持久化缓存
    	this.loadPersistentCache();

    	// 定期清理过期缓存
    	this.startCleanupTimer();
    }

    /**
     * 生成缓存键
     * @param params 缓存键参数
     * @returns 缓存键
     */
    public generateCacheKey(params: CacheKeyParams): string {
    	// 构建确定性的键组件
    	const keyComponents: string[] = [
    		`type:${params.analysisType}`
    	];

    	if (params.commitHash) {
    		keyComponents.push(`commit:${params.commitHash}`);
    	}

    	if (params.compareWithHash) {
    		keyComponents.push(`compare:${params.compareWithHash}`);
    	}

    	if (params.filePath) {
    		keyComponents.push(`file:${params.filePath}`);
    	}

    	// 添加额外的上下文参数（按键排序确保一致性）
    	if (params.additionalContext) {
    		const sortedKeys = Object.keys(params.additionalContext).sort();
    		for (const key of sortedKeys) {
    			keyComponents.push(`${key}:${params.additionalContext[key]}`);
    		}
    	}

    	// 生成最终的缓存键
    	const keyString = keyComponents.join('|');
    	const hash = crypto.createHash('sha256');
    	hash.update(keyString);
    	return hash.digest('hex');
    }

    /**
     * 获取缓存项
     * @param key 缓存键
     * @returns 缓存的分析结果，如果不存在或已过期则返回null
     */
    public async get(key: string): Promise<{ summary: string } | null> {
    	if (!this.config.enabled) {
    		return null;
    	}

    	// 首先检查内存缓存
    	let item = this.memoryCache.get(key);

    	// 如果内存中没有，尝试从磁盘加载
    	if (!item) {
    		const diskItem = await this.loadFromDisk(key);
    		if (diskItem) {
    			// 加载到内存缓存
    			item = diskItem;
    			this.memoryCache.set(key, item);
    			this.logger?.log(`[AI Cache] Loaded from disk: ${key.substring(0, 8)}...`);
    		}
    	}

    	// 检查是否过期
    	if (item && this.isExpired(item)) {
    		this.memoryCache.delete(key);
    		await this.removeFromDisk(key);
    		this.logger?.log(`[AI Cache] Expired and removed: ${key.substring(0, 8)}...`);
    		return null;
    	}

    	if (item) {
    		// 更新访问信息
    		item.lastAccessed = Date.now();
    		item.accessCount++;
    		this.logger?.log(`[AI Cache] Hit: ${key.substring(0, 8)}... (accessed ${item.accessCount} times)`);
    		return item.analysis;
    	}

    	this.logger?.log(`[AI Cache] Miss: ${key.substring(0, 8)}...`);
    	return null;
    }

    /**
     * 设置缓存项
     * @param key 缓存键
     * @param analysis 分析结果
     */
    public async set(key: string, analysis: { summary: string }): Promise<void> {
    	if (!this.config.enabled) {
    		return;
    	}

    	const now = Date.now();
    	const item: AICacheItem = {
    		key,
    		analysis,
    		timestamp: now,
    		accessCount: 1,
    		lastAccessed: now
    	};

    	// 添加到内存缓存
    	this.memoryCache.set(key, item);
    	this.logger?.log(`[AI Cache] Set: ${key.substring(0, 8)}...`);

    	// 检查内存缓存大小限制
    	if (this.memoryCache.size > this.config.maxMemoryItems) {
    		this.evictLruFromMemory();
    	}

    	// 异步保存到磁盘
    	this.saveToDisk(item).catch(error => {
    		this.logger?.logError(`[AI Cache] Failed to save to disk: ${error}`);
    	});
    }

    /**
     * 清除所有缓存
     */
    public async clear(): Promise<void> {
    	this.memoryCache.clear();
    	try {
    		if (fs.existsSync(this.cacheFilePath)) {
    			fs.unlinkSync(this.cacheFilePath);
    		}
    		this.logger?.log('[AI Cache] Cleared all cache');
    	} catch (error) {
    		this.logger?.logError(`[AI Cache] Failed to clear disk cache: ${error}`);
    	}
    }

    /**
     * 获取缓存统计信息
     */
    public getStats(): {
        memoryItems: number;
        diskItems: number;
        totalSize: string;
        hitRate: string;
        } {
    	const diskItems = this.getDiskCacheSize();
    	return {
    		memoryItems: this.memoryCache.size,
    		diskItems,
    		totalSize: this.formatBytes(this.calculateCacheSize()),
    		hitRate: 'N/A' // 可以在后续版本中添加命中率统计
    	};
    }

    /**
     * 确保缓存目录存在
     */
    private ensureCacheDir(): void {
    	try {
    		if (!fs.existsSync(this.config.cacheDir)) {
    			fs.mkdirSync(this.config.cacheDir, { recursive: true });
    		}
    	} catch (error) {
    		this.logger?.logError(`[AI Cache] Failed to create cache directory: ${error}`);
    	}
    }

    /**
     * 加载持久化缓存
     */
    private loadPersistentCache(): void {
    	try {
    		if (fs.existsSync(this.cacheFilePath)) {
    			const data = fs.readFileSync(this.cacheFilePath, 'utf8');
    			const cacheData = JSON.parse(data);

    			let loadedCount = 0;
    			for (const item of cacheData.items || []) {
    				if (!this.isExpired(item) && loadedCount < this.config.maxMemoryItems / 2) {
    					this.memoryCache.set(item.key, item);
    					loadedCount++;
    				}
    			}

    			this.logger?.log(`[AI Cache] Loaded ${loadedCount} items from persistent cache`);
    		}
    	} catch (error) {
    		this.logger?.logError(`[AI Cache] Failed to load persistent cache: ${error}`);
    	}
    }

    /**
     * 从磁盘加载特定缓存项
     */
    private async loadFromDisk(key: string): Promise<AICacheItem | null> {
    	try {
    		if (fs.existsSync(this.cacheFilePath)) {
    			const data = fs.readFileSync(this.cacheFilePath, 'utf8');
    			const cacheData = JSON.parse(data);

    			const item = cacheData.items?.find((item: AICacheItem) => item.key === key);
    			return item || null;
    		}
    	} catch (error) {
    		this.logger?.logError(`[AI Cache] Failed to load from disk: ${error}`);
    	}
    	return null;
    }

    /**
     * 保存缓存项到磁盘
     */
    private async saveToDisk(item: AICacheItem): Promise<void> {
    	try {
    		let cacheData: { items: AICacheItem[] } = { items: [] };

    		// 读取现有缓存
    		if (fs.existsSync(this.cacheFilePath)) {
    			const data = fs.readFileSync(this.cacheFilePath, 'utf8');
    			cacheData = JSON.parse(data);
    		}

    		// 更新或添加项
    		const existingIndex = cacheData.items.findIndex(i => i.key === item.key);
    		if (existingIndex >= 0) {
    			cacheData.items[existingIndex] = item;
    		} else {
    			cacheData.items.push(item);
    		}

    		// 清理过期项
    		cacheData.items = cacheData.items.filter(i => !this.isExpired(i));

    		// 限制磁盘缓存大小
    		if (cacheData.items.length > this.config.maxDiskItems) {
    			cacheData.items.sort((a, b) => b.lastAccessed - a.lastAccessed);
    			cacheData.items = cacheData.items.slice(0, this.config.maxDiskItems);
    		}

    		// 写入文件
    		fs.writeFileSync(this.cacheFilePath, JSON.stringify(cacheData, null, 2));
    	} catch (error) {
    		this.logger?.logError(`[AI Cache] Failed to save to disk: ${error}`);
    	}
    }

    /**
     * 从磁盘删除缓存项
     */
    private async removeFromDisk(key: string): Promise<void> {
    	try {
    		if (fs.existsSync(this.cacheFilePath)) {
    			const data = fs.readFileSync(this.cacheFilePath, 'utf8');
    			const cacheData = JSON.parse(data);

    			cacheData.items = cacheData.items.filter((item: AICacheItem) => item.key !== key);

    			fs.writeFileSync(this.cacheFilePath, JSON.stringify(cacheData, null, 2));
    		}
    	} catch (error) {
    		this.logger?.logError(`[AI Cache] Failed to remove from disk: ${error}`);
    	}
    }

    /**
     * 检查缓存项是否过期
     */
    private isExpired(item: AICacheItem): boolean {
    	const now = Date.now();
    	const ttlMs = this.config.ttlHours * 60 * 60 * 1000;
    	return (now - item.timestamp) > ttlMs;
    }

    /**
     * 从内存缓存中淘汰LRU项
     */
    private evictLruFromMemory(): void {
    	let oldestKey = '';
    	let oldestTime = Date.now();

    	for (const [key, item] of this.memoryCache) {
    		if (item.lastAccessed < oldestTime) {
    			oldestTime = item.lastAccessed;
    			oldestKey = key;
    		}
    	}

    	if (oldestKey) {
    		this.memoryCache.delete(oldestKey);
    		this.logger?.log(`[AI Cache] Evicted LRU item: ${oldestKey.substring(0, 8)}...`);
    	}
    }

    /**
     * 启动定期清理定时器
     */
    private startCleanupTimer(): void {
    	// 每小时清理一次过期缓存
    	setInterval(() => {
    		this.cleanupExpiredItems();
    	}, 60 * 60 * 1000);
    }

    /**
     * 清理过期的缓存项
     */
    private cleanupExpiredItems(): void {
    	let cleanedCount = 0;

    	// 清理内存缓存
    	for (const [key, item] of this.memoryCache) {
    		if (this.isExpired(item)) {
    			this.memoryCache.delete(key);
    			cleanedCount++;
    		}
    	}

    	if (cleanedCount > 0) {
    		this.logger?.log(`[AI Cache] Cleaned up ${cleanedCount} expired items from memory`);
    	}

    	// 异步清理磁盘缓存
    	this.cleanupDiskCache().catch(error => {
    		this.logger?.logError(`[AI Cache] Failed to cleanup disk cache: ${error}`);
    	});
    }

    /**
     * 清理磁盘缓存中的过期项
     */
    private async cleanupDiskCache(): Promise<void> {
    	try {
    		if (fs.existsSync(this.cacheFilePath)) {
    			const data = fs.readFileSync(this.cacheFilePath, 'utf8');
    			const cacheData = JSON.parse(data);

    			const originalCount = cacheData.items?.length || 0;
    			cacheData.items = (cacheData.items || []).filter((item: AICacheItem) => !this.isExpired(item));
    			const cleanedCount = originalCount - cacheData.items.length;

    			if (cleanedCount > 0) {
    				fs.writeFileSync(this.cacheFilePath, JSON.stringify(cacheData, null, 2));
    				this.logger?.log(`[AI Cache] Cleaned up ${cleanedCount} expired items from disk`);
    			}
    		}
    	} catch (error) {
    		this.logger?.logError(`[AI Cache] Failed to cleanup disk cache: ${error}`);
    	}
    }

    /**
     * 获取磁盘缓存项数量
     */
    private getDiskCacheSize(): number {
    	try {
    		if (fs.existsSync(this.cacheFilePath)) {
    			const data = fs.readFileSync(this.cacheFilePath, 'utf8');
    			const cacheData = JSON.parse(data);
    			return cacheData.items?.length || 0;
    		}
    	} catch (error) {
    		this.logger?.logError(`[AI Cache] Failed to get disk cache size: ${error}`);
    	}
    	return 0;
    }

    /**
     * 计算缓存总大小（字节）
     */
    private calculateCacheSize(): number {
    	let size = 0;

    	// 内存缓存大小估算
    	for (const item of this.memoryCache.values()) {
    		size += JSON.stringify(item).length * 2; // UTF-16编码
    	}

    	// 磁盘缓存大小
    	try {
    		if (fs.existsSync(this.cacheFilePath)) {
    			const stats = fs.statSync(this.cacheFilePath);
    			size += stats.size;
    		}
    	} catch (error) {
    		// 忽略错误
    	}

    	return size;
    }

    /**
     * 格式化字节数为可读字符串
     */
    private formatBytes(bytes: number): string {
    	if (bytes === 0) return '0 Bytes';

    	const k = 1024;
    	const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    	const i = Math.floor(Math.log(bytes) / Math.log(k));

    	return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
}
