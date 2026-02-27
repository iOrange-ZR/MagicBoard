/**
 * OSS 缓存前端服务
 * 
 * 封装与后端 /api/oss/ 的通信，提供：
 * - OSS 状态检查
 * - 图片上传到 OSS
 * - 批量上传
 * - 配置管理
 */

// 后端地址（与其他 API 服务一致）
const API_BASE = '/api/oss';

export interface OssConfigStatus {
    enabled: boolean;
    bucket_name?: string;
    endpoint?: string;
    public_endpoint?: string;
    access_key_id_preview?: string | null;
}

export interface OssConfig {
    access_key_id: string;
    access_key_secret: string;
    bucket_name: string;
    endpoint: string;
    public_endpoint: string;
}

export interface OssStats {
    enabled: boolean;
    total_images: number;
    total_size_mb: number;
}

// 缓存 OSS 状态，避免每次请求都查询
let _ossEnabledCache: boolean | null = null;
let _ossCheckTime: number = 0;
const OSS_CHECK_INTERVAL = 30000; // 30秒缓存

/**
 * 检查 OSS 是否已启用（带缓存）
 */
export async function checkOssEnabled(): Promise<boolean> {
    const now = Date.now();
    if (_ossEnabledCache !== null && now - _ossCheckTime < OSS_CHECK_INTERVAL) {
        return _ossEnabledCache;
    }

    try {
        const res = await fetch(`${API_BASE}/config`);
        if (!res.ok) {
            _ossEnabledCache = false;
            return false;
        }
        const data = await res.json();
        _ossEnabledCache = data?.data?.enabled || false;
        _ossCheckTime = now;
        return _ossEnabledCache;
    } catch {
        _ossEnabledCache = false;
        return false;
    }
}

/**
 * 上传单张图片到 OSS
 * @param base64Data - base64 字符串或 data:URL
 * @param filename - 文件名
 * @returns OSS URL 或 null
 */
export async function uploadToOss(base64Data: string, filename = 'image.png'): Promise<string | null> {
    try {
        const res = await fetch(`${API_BASE}/upload`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image: base64Data, filename }),
        });
        if (!res.ok) return null;
        const data = await res.json();
        return data?.data?.url || null;
    } catch (e) {
        console.warn('[OSS] Upload failed:', e);
        return null;
    }
}

/**
 * 批量上传图片到 OSS
 * @param images - 图片数组（base64 字符串或 data:URL）
 * @returns URL 数组，全部成功返回 URL 数组，任何失败返回 null
 */
export async function batchUploadToOss(
    images: Array<{ data: string; filename?: string }>
): Promise<string[] | null> {
    try {
        const res = await fetch(`${API_BASE}/upload-batch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ images }),
        });
        if (!res.ok) return null;
        const result = await res.json();
        if (result?.success && result?.data?.urls) {
            return result.data.urls;
        }
        return null;
    } catch (e) {
        console.warn('[OSS] Batch upload failed:', e);
        return null;
    }
}

/**
 * 获取 OSS 配置状态（不含密钥）
 */
export async function getOssConfig(): Promise<OssConfigStatus> {
    try {
        const res = await fetch(`${API_BASE}/config`);
        if (!res.ok) return { enabled: false };
        const data = await res.json();
        return data?.data || { enabled: false };
    } catch {
        return { enabled: false };
    }
}

/**
 * 保存 OSS 配置
 */
export async function saveOssConfig(config: OssConfig): Promise<boolean> {
    try {
        // 重置缓存
        _ossEnabledCache = null;

        const res = await fetch(`${API_BASE}/config`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config),
        });
        if (!res.ok) return false;
        const data = await res.json();
        return data?.success || false;
    } catch {
        return false;
    }
}

/**
 * 测试 OSS 连接
 */
export async function testOssConnection(): Promise<{ success: boolean; error?: string }> {
    try {
        const res = await fetch(`${API_BASE}/test`, { method: 'POST' });
        if (!res.ok) return { success: false, error: '请求失败' };
        return await res.json();
    } catch (e) {
        return { success: false, error: String(e) };
    }
}

/**
 * 获取缓存统计
 */
export async function getOssStats(): Promise<OssStats> {
    try {
        const res = await fetch(`${API_BASE}/stats`);
        if (!res.ok) return { enabled: false, total_images: 0, total_size_mb: 0 };
        const data = await res.json();
        return data?.data || { enabled: false, total_images: 0, total_size_mb: 0 };
    } catch {
        return { enabled: false, total_images: 0, total_size_mb: 0 };
    }
}

/**
 * 尝试将 File 对象数组上传到 OSS，返回 URL 数组
 * 如果 OSS 未启用或上传失败，返回 null（调用方应 fallback 到 base64）
 */
export async function tryUploadFilesToOss(files: File[]): Promise<string[] | null> {
    // 快速检查 OSS 是否启用
    const enabled = await checkOssEnabled();
    if (!enabled) return null;

    try {
        // 将 File 转为 base64
        const images = await Promise.all(
            files.map(async (file) => {
                const base64 = await fileToBase64ForOss(file);
                return { data: base64, filename: file.name };
            })
        );

        const urls = await batchUploadToOss(images);
        if (urls && urls.every(u => u !== null)) {
            console.log(`[OSS] ✅ ${urls.length} image(s) uploaded to OSS`);
            return urls;
        }
        return null;
    } catch (e) {
        console.warn('[OSS] tryUploadFilesToOss failed, falling back to base64:', e);
        return null;
    }
}

/**
 * File 转 base64 data URL（用于 OSS 上传）
 */
function fileToBase64ForOss(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            if (reader.result && typeof reader.result === 'string') {
                resolve(reader.result); // data:image/xxx;base64,...
            } else {
                reject(new Error('文件读取失败'));
            }
        };
        reader.onerror = () => reject(new Error('文件读取出错'));
        reader.readAsDataURL(file);
    });
}
