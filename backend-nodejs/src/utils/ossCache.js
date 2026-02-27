/**
 * OSS Image Cache Module (Node.js)
 * =================================
 * 
 * 移植自 ComfyUI-Custom-Batchbox 的 oss_cache.py，提供：
 * - SHA-256 图片去重
 * - SQLite 本地缓存数据库
 * - 阿里云 OSS 上传（支持传输加速）
 * - OSS 未配置时安全降级
 * 
 * 配置存储路径: data/oss_config.json（已被 .gitignore 排除）
 */

const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

// 目录常量
const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const CONFIG_PATH = path.join(DATA_DIR, 'oss_config.json');
const DB_PATH = path.join(DATA_DIR, 'oss_cache.db');

/**
 * 计算数据的 SHA-256 哈希
 */
function computeHash(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * 根据文件名或 MIME 类型猜测扩展名
 */
function guessExtension(filename, mimeType = '') {
  const ext = path.extname(filename).toLowerCase();
  if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'].includes(ext)) {
    return ext;
  }
  const mimeMap = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'image/bmp': '.bmp',
  };
  return mimeMap[mimeType] || '.png';
}

/**
 * SQLite 缓存数据库
 */
class CacheDB {
  constructor(dbPath = DB_PATH) {
    this.dbPath = dbPath;
    this.db = null;
  }

  _ensureDB() {
    if (this.db) return this.db;
    try {
      const Database = require('better-sqlite3');
      this.db = new Database(this.dbPath);
      this.db.pragma('journal_mode = WAL');
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS image_cache (
          hash        TEXT PRIMARY KEY,
          oss_url     TEXT NOT NULL,
          oss_key     TEXT NOT NULL,
          file_size   INTEGER,
          uploaded_at DATETIME DEFAULT (datetime('now')),
          last_used   DATETIME DEFAULT (datetime('now')),
          use_count   INTEGER DEFAULT 1
        );
        CREATE INDEX IF NOT EXISTS idx_last_used ON image_cache(last_used);
      `);
      return this.db;
    } catch (e) {
      console.error('[OSSCache] Failed to init SQLite:', e.message);
      return null;
    }
  }

  get(fileHash) {
    const db = this._ensureDB();
    if (!db) return null;
    const row = db.prepare('SELECT oss_url FROM image_cache WHERE hash = ?').get(fileHash);
    if (row) {
      db.prepare("UPDATE image_cache SET last_used = datetime('now'), use_count = use_count + 1 WHERE hash = ?").run(fileHash);
      return row.oss_url;
    }
    return null;
  }

  put(fileHash, ossUrl, ossKey, fileSize) {
    const db = this._ensureDB();
    if (!db) return;
    db.prepare(`
      INSERT OR REPLACE INTO image_cache 
      (hash, oss_url, oss_key, file_size, uploaded_at, last_used, use_count) 
      VALUES (?, ?, ?, ?, datetime('now'), datetime('now'), 1)
    `).run(fileHash, ossUrl, ossKey, fileSize);
  }

  getStats() {
    const db = this._ensureDB();
    if (!db) return { total_images: 0, total_size_mb: 0 };
    const row = db.prepare('SELECT COUNT(*) as total, SUM(file_size) as total_size FROM image_cache').get();
    return {
      total_images: row.total || 0,
      total_size_mb: Math.round((row.total_size || 0) / 1024 / 1024 * 100) / 100,
    };
  }
}

/**
 * 主 OSS 缓存类
 */
class OSSImageCache {
  constructor() {
    this._enabled = null; // lazy init
    this._client = null;
    this._config = null;
    this._db = null;
  }

  /**
   * 从 data/oss_config.json 加载配置
   */
  _loadConfig() {
    try {
      if (!fs.existsSync(CONFIG_PATH)) {
        return null;
      }
      const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
      const config = JSON.parse(raw);
      
      // 验证必要字段
      const required = ['access_key_id', 'access_key_secret', 'bucket_name', 'endpoint', 'public_endpoint'];
      for (const field of required) {
        if (!config[field]) {
          console.warn(`[OSSCache] Missing required field: ${field}`);
          return null;
        }
      }
      return config;
    } catch (e) {
      console.warn(`[OSSCache] Failed to load config: ${e.message}`);
      return null;
    }
  }

  /**
   * 保存配置到 data/oss_config.json
   */
  saveConfig(config) {
    try {
      // 确保 data 目录存在
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
      // 重置状态以便下次重新初始化
      this._enabled = null;
      this._client = null;
      this._config = null;
      console.log('[OSSCache] Config saved successfully');
      return true;
    } catch (e) {
      console.error(`[OSSCache] Failed to save config: ${e.message}`);
      return false;
    }
  }

  /**
   * 懒初始化
   */
  _ensureInitialized() {
    if (this._enabled !== null) return this._enabled;

    this._enabled = false;

    // 加载配置
    this._config = this._loadConfig();
    if (!this._config) {
      console.log('[OSSCache] OSS not configured. Caching disabled.');
      return false;
    }

    // 初始化 ali-oss 客户端
    try {
      const OSS = require('ali-oss');
      this._client = new OSS({
        accessKeyId: this._config.access_key_id,
        accessKeySecret: this._config.access_key_secret,
        bucket: this._config.bucket_name,
        endpoint: this._config.endpoint,
        timeout: 120000, // 2分钟超时
      });
      console.log(`[OSSCache] ✅ OSS client initialized: ${this._config.bucket_name}`);
      console.log(`[OSSCache]    Upload endpoint: ${this._config.endpoint}`);
      console.log(`[OSSCache]    Public endpoint: ${this._config.public_endpoint}`);
    } catch (e) {
      console.error(`[OSSCache] ❌ Failed to init OSS client: ${e.message}`);
      return false;
    }

    // 初始化缓存数据库
    try {
      this._db = new CacheDB();
      const stats = this._db.getStats();
      console.log(`[OSSCache]    Cache: ${stats.total_images} images, ${stats.total_size_mb} MB`);
    } catch (e) {
      console.error(`[OSSCache] ❌ Failed to init cache DB: ${e.message}`);
      return false;
    }

    this._enabled = true;
    return true;
  }

  /**
   * 检查 OSS 是否可用
   */
  isEnabled() {
    return this._ensureInitialized();
  }

  /**
   * 获取缓存的 URL 或上传图片到 OSS
   * @param {Buffer} imageBuffer - 图片二进制数据
   * @param {string} filename - 文件名
   * @param {string} mimeType - MIME 类型
   * @returns {string|null} OSS 公开 URL，失败返回 null
   */
  async getOrUpload(imageBuffer, filename = 'image.png', mimeType = 'image/png') {
    if (!this._ensureInitialized()) return null;

    // 1. 计算哈希
    const fileHash = computeHash(imageBuffer);

    // 2. 查缓存
    const cachedUrl = this._db.get(fileHash);
    if (cachedUrl) {
      console.log(`[OSSCache] ✅ Cache hit: ${fileHash.substring(0, 12)}... (saved upload)`);
      return cachedUrl;
    }

    // 3. 上传到 OSS
    const ext = guessExtension(filename, mimeType);
    const ossKey = `images/${fileHash.substring(0, 2)}/${fileHash.substring(2, 4)}/${fileHash}${ext}`;
    const fileSize = imageBuffer.length;

    try {
      const startTime = Date.now();

      if (fileSize > 10 * 1024 * 1024) {
        // > 10MB: 分片上传
        console.log(`[OSSCache] ⬆️ Uploading large image (${(fileSize / 1024 / 1024).toFixed(1)}MB): ${ossKey}`);
        await this._client.multipartUpload(ossKey, imageBuffer, {
          partSize: 5 * 1024 * 1024,
          parallel: 3,
        });
      } else {
        console.log(`[OSSCache] ⬆️ Uploading image (${(fileSize / 1024).toFixed(0)}KB): ${ossKey}`);
        await this._client.put(ossKey, imageBuffer);
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      // 构建公开访问 URL
      const publicUrl = `https://${this._config.bucket_name}.${this._config.public_endpoint}/${ossKey}`;

      // 4. 存入缓存
      this._db.put(fileHash, publicUrl, ossKey, fileSize);

      console.log(`[OSSCache] ✅ Upload complete (${elapsed}s): ${publicUrl}`);
      return publicUrl;
    } catch (e) {
      console.error(`[OSSCache] ❌ Upload failed: ${e.message}`);
      return null;
    }
  }

  /**
   * 测试 OSS 连接
   */
  async testConnection() {
    if (!this._config) {
      this._config = this._loadConfig();
    }
    if (!this._config) {
      return { success: false, error: 'OSS 未配置' };
    }

    try {
      const OSS = require('ali-oss');
      const client = new OSS({
        accessKeyId: this._config.access_key_id,
        accessKeySecret: this._config.access_key_secret,
        bucket: this._config.bucket_name,
        endpoint: this._config.endpoint,
        timeout: 10000,
      });
      // 测试列举（最多1个对象）
      await client.list({ 'max-keys': 1 });
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  /**
   * 获取缓存统计
   */
  getStats() {
    if (!this._ensureInitialized()) {
      return { enabled: false, total_images: 0, total_size_mb: 0 };
    }
    const stats = this._db.getStats();
    stats.enabled = true;
    return stats;
  }

  /**
   * 获取配置状态（不含密钥）
   */
  getConfigStatus() {
    const config = this._loadConfig();
    if (!config) {
      return { enabled: false };
    }
    return {
      enabled: true,
      bucket_name: config.bucket_name,
      endpoint: config.endpoint,
      public_endpoint: config.public_endpoint,
      // 不返回 access_key_secret，只返回 ID 的前几位
      access_key_id_preview: config.access_key_id 
        ? config.access_key_id.substring(0, 8) + '***' 
        : null,
    };
  }
}

// 全局单例
const ossCache = new OSSImageCache();

module.exports = { ossCache, OSSImageCache };
