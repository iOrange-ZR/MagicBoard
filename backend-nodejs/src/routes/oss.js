/**
 * OSS API 路由
 * 
 * POST /api/oss/upload     - 上传图片到 OSS（接收 base64）
 * GET  /api/oss/config      - 获取 OSS 配置状态（不含密钥）
 * POST /api/oss/config      - 保存 OSS 配置
 * GET  /api/oss/stats       - 获取缓存统计
 * POST /api/oss/test        - 测试 OSS 连接
 */

const express = require('express');
const router = express.Router();
const { ossCache } = require('../utils/ossCache');

// 上传图片到 OSS
// Body: { image: "base64数据或data:URL", filename?: "xxx.png" }
// 返回: { success: true, data: { url: "https://..." } }
router.post('/upload', async (req, res) => {
    try {
        const { image, filename = 'image.png' } = req.body;
        if (!image) {
            return res.status(400).json({ success: false, error: '缺少 image 字段' });
        }

        // 检查 OSS 是否已启用
        if (!ossCache.isEnabled()) {
            return res.json({ success: false, error: 'OSS 未配置或不可用', data: { url: null } });
        }

        // 解析 base64 数据
        let base64Data = image;
        let mimeType = 'image/png';

        // 处理 data:URL 格式
        if (image.startsWith('data:')) {
            const match = image.match(/^data:(image\/\w+);base64,(.+)$/);
            if (match) {
                mimeType = match[1];
                base64Data = match[2];
            } else {
                // 简单去掉前缀
                base64Data = image.split(',')[1] || image;
            }
        }

        const buffer = Buffer.from(base64Data, 'base64');
        const url = await ossCache.getOrUpload(buffer, filename, mimeType);

        if (url) {
            res.json({ success: true, data: { url } });
        } else {
            res.json({ success: false, error: 'OSS 上传失败', data: { url: null } });
        }
    } catch (e) {
        console.error('[OSS Route] Upload error:', e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

// 批量上传
// Body: { images: [{ data: "base64", filename?: "xxx.png" }, ...] }
// 返回: { success: true, data: { urls: ["https://...", ...] } }
router.post('/upload-batch', async (req, res) => {
    try {
        const { images } = req.body;
        if (!images || !Array.isArray(images) || images.length === 0) {
            return res.status(400).json({ success: false, error: '缺少 images 数组' });
        }

        if (!ossCache.isEnabled()) {
            return res.json({ success: false, error: 'OSS 未配置', data: { urls: [] } });
        }

        const urls = [];
        for (const img of images) {
            let base64Data = img.data || img;
            let mimeType = 'image/png';
            const filename = img.filename || 'image.png';

            if (typeof base64Data === 'string' && base64Data.startsWith('data:')) {
                const match = base64Data.match(/^data:(image\/\w+);base64,(.+)$/);
                if (match) {
                    mimeType = match[1];
                    base64Data = match[2];
                } else {
                    base64Data = base64Data.split(',')[1] || base64Data;
                }
            }

            const buffer = Buffer.from(base64Data, 'base64');
            const url = await ossCache.getOrUpload(buffer, filename, mimeType);
            urls.push(url);
        }

        // 如果有任何一个失败了，返回失败
        if (urls.some(u => u === null)) {
            res.json({ success: false, error: '部分图片上传失败', data: { urls } });
        } else {
            res.json({ success: true, data: { urls } });
        }
    } catch (e) {
        console.error('[OSS Route] Batch upload error:', e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

// 获取配置状态（不含密钥）
router.get('/config', (req, res) => {
    const status = ossCache.getConfigStatus();
    res.json({ success: true, data: status });
});

// 保存配置
router.post('/config', (req, res) => {
    const { access_key_id, access_key_secret, bucket_name, endpoint, public_endpoint } = req.body;

    if (!access_key_id || !access_key_secret || !bucket_name || !endpoint || !public_endpoint) {
        return res.status(400).json({ success: false, error: '缺少必要配置字段' });
    }

    const saved = ossCache.saveConfig({
        access_key_id,
        access_key_secret,
        bucket_name,
        endpoint,
        public_endpoint,
    });

    res.json({ success: saved, message: saved ? '配置已保存' : '保存失败' });
});

// 获取缓存统计
router.get('/stats', (req, res) => {
    const stats = ossCache.getStats();
    res.json({ success: true, data: stats });
});

// 测试连接
router.post('/test', async (req, res) => {
    try {
        const result = await ossCache.testConnection();
        res.json({ success: result.success, error: result.error || null });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

module.exports = router;
