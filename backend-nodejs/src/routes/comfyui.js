/**
 * ComfyUI 本地/局域网代理路由
 * 代理前端请求到用户配置的 ComfyUI 地址（如 http://127.0.0.1:8188）
 */
const express = require('express');
const config = require('../config');
const JsonStorage = require('../utils/jsonStorage');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const FormData = require('form-data');

const router = express.Router();

const COMFYUI_CONFIG_KEY = 'comfyui';
const COMFYUI_CONFIG_FILE = config.SETTINGS_FILE;
JsonStorage.init(config.COMFYUI_WORKFLOWS_FILE, []);

function getComfyUIBaseUrl(reqBodyBaseUrl) {
  if (reqBodyBaseUrl && typeof reqBodyBaseUrl === 'string' && reqBodyBaseUrl.trim()) {
    return reqBodyBaseUrl.replace(/\/+$/, '');
  }
  const settings = JsonStorage.load(COMFYUI_CONFIG_FILE, {});
  return settings.comfyuiBaseUrl || '';
}

function setComfyUIBaseUrl(baseUrl) {
  const settings = JsonStorage.load(COMFYUI_CONFIG_FILE, {});
  settings.comfyuiBaseUrl = (baseUrl || '').replace(/\/+$/, '');
  JsonStorage.save(COMFYUI_CONFIG_FILE, settings);
}

/**
 * POST /proxy - 代理任意 GET/POST 到 ComfyUI
 * body: { baseUrl?, path, method?, body? }
 */
router.post('/proxy', async (req, res) => {
  try {
    const baseUrl = getComfyUIBaseUrl(req.body.baseUrl);
    const { path: subPath, method = 'GET', body } = req.body;

    if (!baseUrl) {
      return res.status(400).json({ success: false, error: '未配置 ComfyUI 地址，请在设置或节点中填写 baseUrl' });
    }
    if (!subPath || typeof subPath !== 'string') {
      return res.status(400).json({ success: false, error: '缺少 path 参数' });
    }

    const url = `${baseUrl}${subPath.startsWith('/') ? subPath : '/' + subPath}`;
    const options = {
      method: method.toUpperCase(),
      headers: {},
    };

    if (options.method === 'POST' && body !== undefined) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (_) {
      data = { raw: text };
    }

    if (!response.ok) {
      // ComfyUI 可能返回 error 为对象 { type, message, details, extra_info }，前端不能直接渲染对象，此处统一为字符串
      let errStr = `HTTP ${response.status}`;
      if (typeof data.error === 'string') errStr = data.error;
      else if (typeof data.message === 'string') errStr = data.message;
      else if (data.error && typeof data.error === 'object' && typeof data.error.message === 'string') errStr = data.error.message;
      else if (data.error && typeof data.error === 'object') errStr = JSON.stringify(data.error);
      return res.status(response.status).json({
        success: false,
        error: errStr,
        data: data.node_errors || data,
      });
    }

    res.json({ success: true, data });
  } catch (error) {
    console.error('[ComfyUI] proxy error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message || '代理请求失败',
    });
  }
});

/**
 * POST /upload-image - 上传 base64 图片到 ComfyUI /upload/image
 * body: { baseUrl?, image: base64 }
 * ComfyUI 期望 multipart: image 文件
 */
router.post('/upload-image', async (req, res) => {
  try {
    const baseUrl = getComfyUIBaseUrl(req.body.baseUrl);
    const { image } = req.body;

    if (!baseUrl) {
      return res.status(400).json({ success: false, error: '未配置 ComfyUI 地址' });
    }
    if (!image) {
      return res.status(400).json({ success: false, error: '缺少 image 数据' });
    }

    let base64Data = image;
    let mimeType = 'image/png';
    let extension = '.png';

    if (image.startsWith('data:')) {
      const matches = image.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
      if (matches && matches.length === 3) {
        mimeType = matches[1];
        base64Data = matches[2];
        if (mimeType.includes('jpeg') || mimeType.includes('jpg')) extension = '.jpg';
        else if (mimeType.includes('png')) extension = '.png';
        else if (mimeType.includes('webp')) extension = '.webp';
      }
    }

    const imageBuffer = Buffer.from(base64Data, 'base64');
    const fileName = `upload_${Date.now()}${extension}`;

    const formData = new FormData();
    formData.append('image', imageBuffer, { filename: fileName, contentType: mimeType });

    const response = await fetch(`${baseUrl}/upload/image`, {
      method: 'POST',
      headers: formData.getHeaders(),
      body: formData,
    });

    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (_) {
      data = {};
    }

    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        error: data.error || data.message || `Upload failed: ${response.status}`,
      });
    }

    // ComfyUI 返回格式常见为 { name: "filename.png", subfolder: "", type: "input" }
    res.json({
      success: true,
      data: {
        name: data.name || fileName,
        subfolder: data.subfolder || '',
        type: data.type || 'input',
      },
    });
  } catch (error) {
    console.error('[ComfyUI] upload-image error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /view - 代理 ComfyUI /view 获取输出图片（用于前端展示）
 * query: baseUrl, filename, subfolder?, type?
 */
router.get('/view', async (req, res) => {
  try {
    const baseUrl = getComfyUIBaseUrl(req.query.baseUrl);
    const { filename, subfolder = '', type = 'output' } = req.query;

    if (!baseUrl || !filename) {
      return res.status(400).json({ success: false, error: '缺少 baseUrl 或 filename' });
    }

    const params = new URLSearchParams({ filename, subfolder, type });
    const response = await fetch(`${baseUrl}/view?${params.toString()}`, { method: 'GET' });
    if (!response.ok) {
      return res.status(response.status).send(response.statusText);
    }
    const contentType = response.headers.get('content-type') || 'image/png';
    res.set('Content-Type', contentType);
    const arrayBuffer = await response.arrayBuffer();
    res.send(Buffer.from(arrayBuffer));
  } catch (error) {
    console.error('[ComfyUI] view error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /config - 获取当前存储的 ComfyUI 默认地址（可选，前端也可只用 localStorage）
 */
router.get('/config', (req, res) => {
  try {
    const baseUrl = getComfyUIBaseUrl();
    res.json({
      success: true,
      data: {
        baseUrl,
        configured: !!baseUrl,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /config - 保存默认 ComfyUI 地址
 * body: { baseUrl }
 */
router.post('/config', (req, res) => {
  try {
    const { baseUrl } = req.body;
    setComfyUIBaseUrl(baseUrl);
    res.json({
      success: true,
      data: {
        baseUrl: getComfyUIBaseUrl(),
        configured: !!getComfyUIBaseUrl(),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============ 工作流配置 CRUD（供 ComfyUI Tab 与画布节点使用）============

/**
 * GET /workflows - 获取所有已配置的工作流
 */
router.get('/workflows', (req, res) => {
  try {
    const list = JsonStorage.load(config.COMFYUI_WORKFLOWS_FILE, []);
    res.json({ success: true, data: list });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * POST /workflows - 新增或更新工作流
 * body: { id?, title, workflowApiJson, inputSlots: [{ slotKey, label, type, nodeId, inputName, exposed }] }
 */
router.post('/workflows', (req, res) => {
  try {
    const { id, title, workflowApiJson, inputSlots } = req.body;
    if (!title || !workflowApiJson) {
      return res.status(400).json({ success: false, error: '缺少 title 或 workflowApiJson' });
    }
    const list = JsonStorage.load(config.COMFYUI_WORKFLOWS_FILE, []);
    const slotList = Array.isArray(inputSlots) ? inputSlots : [];
    const workflow = {
      id: id && list.some(w => w.id === id) ? id : 'wf_' + Date.now(),
      title: String(title).trim(),
      workflowApiJson: String(workflowApiJson).trim(),
      inputSlots: slotList,
      updatedAt: Date.now(),
    };
    const index = list.findIndex(w => w.id === workflow.id);
    if (index >= 0) {
      list[index] = workflow;
    } else {
      list.push(workflow);
    }
    JsonStorage.save(config.COMFYUI_WORKFLOWS_FILE, list);
    res.json({ success: true, data: workflow });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * DELETE /workflows/:id - 删除工作流
 */
router.delete('/workflows/:id', (req, res) => {
  try {
    const { id } = req.params;
    const list = JsonStorage.load(config.COMFYUI_WORKFLOWS_FILE, []);
    const next = list.filter(w => w.id !== id);
    if (next.length === list.length) {
      return res.status(404).json({ success: false, error: '工作流不存在' });
    }
    JsonStorage.save(config.COMFYUI_WORKFLOWS_FILE, next);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
