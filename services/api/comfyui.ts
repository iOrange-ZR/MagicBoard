/**
 * ComfyUI 本地/局域网 API 服务
 * 通过后端代理访问用户配置的 ComfyUI 地址，避免 CORS。
 */

import { post, get, del } from './index';

// ============================================
// 类型定义（对齐 ComfyUI 官方 API）
// ============================================

/** 单个 ComfyUI 地址（配置页维护，画布中仅能选择） */
export interface ComfyUIAddress {
  id: string;
  label: string;
  baseUrl: string;
}

export interface ComfyUIConfig {
  baseUrl: string;   // 当前/默认地址，用于向后兼容与执行时 fallback
  configured: boolean;
  /** 地址列表（配置页可添加多个） */
  addresses: ComfyUIAddress[];
  /** 画布中新建节点时默认选中的地址 id */
  defaultId: string | null;
}

/** 工作流模板：API 格式 JSON + 暴露的输入槽 */
export interface ComfyUIWorkflowTemplate {
  id: string;
  title: string;
  workflowApiJson: string;  // ComfyUI "API" 格式导出
  inputSlots: ComfyUIInputSlot[];
  createdAt?: number;
}

export interface ComfyUIInputSlot {
  slotKey: string;   // 唯一键，如 "3_text"
  label: string;     // 完整展示，如 "[3] 正面提示词 · 文本"
  type: 'STRING' | 'IMAGE' | 'INT' | 'FLOAT' | 'BOOLEAN';
  nodeId?: string;
  inputName?: string;
  nodeLabel?: string; // 节点友好名称，用于分组展示，如 "正面提示词"
  description?: string;
  /** 默认值：暴露到画布时在画布中显示，未填时执行时代入 workflow */
  defaultValue?: string;
  exposed?: boolean; // 是否暴露给画布节点（Tab 中勾选）
}

/** 后端存储的工作流配置（Tab 中管理） */
export interface ComfyUIWorkflowConfig {
  id: string;
  title: string;
  workflowApiJson: string;
  inputSlots: ComfyUIInputSlot[]; // 含 exposed、defaultValue、placeholder
  updatedAt: number;
}

/** 一键导出包：地址 + 工作流（含完整 inputSlots），便于在不同主机间导入 */
export interface ComfyUIExportBundle {
  version: number;
  exportedAt: string; // ISO 时间
  addresses: ComfyUIAddress[];
  workflows: Array<{
    title: string;
    workflowApiJson: string;
    inputSlots: ComfyUIInputSlot[];
  }>;
}

/** /prompt POST 请求体 */
export interface ComfyUIPromptRequest {
  prompt: Record<string, unknown>;  // workflow API 格式
  client_id?: string;
  extra_data?: Record<string, unknown>;
}

/** /prompt POST 响应 */
export interface ComfyUIPromptResponse {
  prompt_id?: string;
  number?: number;
  node_errors?: Record<string, unknown>;
  error?: string;
}

/** /history/{prompt_id} 单条记录中的输出 */
export interface ComfyUIHistoryOutput {
  images?: Array<{ filename: string; subfolder: string; type: string }>;
  gifs?: Array<{ filename: string; subfolder: string; type: string }>;
  [key: string]: unknown;
}

export interface ComfyUIHistoryItem {
  prompt?: unknown[];
  outputs?: Record<string, ComfyUIHistoryOutput>;
  status?: { status_str: string; completed: boolean; messages: unknown[] };
}

// ============================================
// 配置 API（存于后端或前端 localStorage）
// ============================================

const COMFYUI_CONFIG_KEY = 'comfyui_config';
const DEFAULT_ADDRESS: ComfyUIAddress = { id: 'default', label: '本地 (127.0.0.1:8188)', baseUrl: 'http://127.0.0.1:8188' };

function normalizeBaseUrl(url: string): string {
  return (url || '').trim().replace(/\/+$/, '');
}

/** 获取 ComfyUI 配置（含地址列表与画布默认） */
export const getComfyUIConfig = (): ComfyUIConfig => {
  try {
    const raw = localStorage.getItem(COMFYUI_CONFIG_KEY);
    if (raw) {
      const c = JSON.parse(raw) as Record<string, unknown>;
      // 新格式：addresses + defaultId
      if (Array.isArray(c.addresses) && c.addresses.length > 0) {
        const addresses = c.addresses as ComfyUIAddress[];
        const defaultId = (c.defaultId as string | null) ?? null;
        const defaultAddr = defaultId ? addresses.find((a) => a.id === defaultId) : addresses[0];
        const baseUrl = defaultAddr ? normalizeBaseUrl(defaultAddr.baseUrl) : '';
        return {
          baseUrl,
          configured: !!baseUrl,
          addresses,
          defaultId,
        };
      }
      // 旧格式：仅 baseUrl，迁移为单条地址 + 默认
      if (c.baseUrl && typeof c.baseUrl === 'string') {
        const baseUrl = normalizeBaseUrl(c.baseUrl);
        const addresses: ComfyUIAddress[] = [{ id: 'default', label: '本地', baseUrl }];
        return { baseUrl, configured: true, addresses, defaultId: 'default' };
      }
    }
  } catch (_) {}
  return {
    baseUrl: DEFAULT_ADDRESS.baseUrl,
    configured: true,
    addresses: [DEFAULT_ADDRESS],
    defaultId: 'default',
  };
};

/** 保存 ComfyUI 地址列表与画布默认（配置页使用） */
export const saveComfyUIAddresses = (addresses: ComfyUIAddress[], defaultId: string | null): void => {
  const normalized = addresses.map((a) => ({ ...a, baseUrl: normalizeBaseUrl(a.baseUrl) }));
  const defaultAddr = defaultId ? normalized.find((a) => a.id === defaultId) : normalized[0];
  const baseUrl = defaultAddr ? defaultAddr.baseUrl : '';
  localStorage.setItem(COMFYUI_CONFIG_KEY, JSON.stringify({
    baseUrl,
    configured: !!baseUrl,
    addresses: normalized,
    defaultId,
  }));
};

/** 仅保存单个 baseUrl（向后兼容，会写入为单条地址） */
export const saveComfyUIConfig = (baseUrl: string): void => {
  const normalized = normalizeBaseUrl(baseUrl);
  const addresses: ComfyUIAddress[] = normalized ? [{ id: 'default', label: '本地', baseUrl: normalized }] : [];
  const defaultId = normalized ? 'default' : null;
  saveComfyUIAddresses(addresses, defaultId);
};

// ============================================
// 后端代理 API（后端再请求用户配置的 baseUrl）
// ============================================

/** 代理请求到用户配置的 ComfyUI 实例 */
export const comfyuiProxy = async (params: {
  baseUrl?: string;  // 不传则用后端存储的默认值
  path: string;      // 如 /prompt, /history/xxx, /object_info
  method?: 'GET' | 'POST';
  body?: unknown;
}): Promise<{ success: boolean; data?: unknown; error?: string }> => {
  const res = await post<{ data?: unknown }>('/comfyui/proxy', {
    baseUrl: params.baseUrl || undefined,
    path: params.path,
    method: params.method || 'GET',
    body: params.body,
  });
  if (!res.success) return { success: false, error: (res as any).error };
  return { success: true, data: (res as any).data };
};

/** 提交 workflow 到 ComfyUI 队列 */
export const comfyuiSubmitPrompt = async (
  prompt: Record<string, unknown>,
  baseUrl?: string,
  clientId?: string
): Promise<{ success: boolean; promptId?: string; error?: string }> => {
  const res = await comfyuiProxy({
    baseUrl,
    path: '/prompt',
    method: 'POST',
    body: { prompt, client_id: clientId },
  });
  if (!res.success) return { success: false, error: res.error };
  const data = res.data as ComfyUIPromptResponse;
  if (data.error) return { success: false, error: data.error };
  return { success: true, promptId: data.prompt_id };
};

/** 查询执行历史（取输出图片等信息） */
export const comfyuiGetHistory = async (
  promptId: string,
  baseUrl?: string
): Promise<{ success: boolean; data?: Record<string, ComfyUIHistoryItem>; error?: string }> => {
  const res = await comfyuiProxy({
    baseUrl,
    path: `/history/${promptId}`,
    method: 'GET',
  });
  if (!res.success) return { success: false, error: res.error };
  return { success: true, data: res.data as Record<string, ComfyUIHistoryItem> };
};

/** 上传 base64 图片到 ComfyUI（后端代理转发到 ComfyUI /upload/image） */
export const comfyuiUploadImage = async (
  imageBase64: string,
  baseUrl?: string
): Promise<{ success: boolean; name?: string; error?: string }> => {
  const res = await post<{ name?: string }>('/comfyui/upload-image', {
    baseUrl: baseUrl || undefined,
    image: imageBase64,
  });
  if (!res.success) return { success: false, error: (res as any).error };
  return { success: true, name: (res as any).data?.name };
};

/** 获取 ComfyUI 节点类型信息（/object_info），用于解析可编辑输入 */
export const comfyuiGetObjectInfo = async (
  baseUrl?: string
): Promise<{ success: boolean; data?: Record<string, unknown>; error?: string }> => {
  const res = await comfyuiProxy({ baseUrl, path: '/object_info', method: 'GET' });
  if (!res.success) return { success: false, error: res.error };
  return { success: true, data: res.data as Record<string, unknown> };
};

// ============================================
// 工作流配置 CRUD（ComfyUI Tab 与画布节点）
// ============================================

/** 获取所有已配置的工作流 */
export const getComfyUIWorkflows = async (): Promise<{
  success: boolean;
  data?: ComfyUIWorkflowConfig[];
  error?: string;
}> => {
  return get<ComfyUIWorkflowConfig[]>('/comfyui/workflows');
};

/** 新增或更新工作流 */
export const saveComfyUIWorkflow = async (payload: {
  id?: string;
  title: string;
  workflowApiJson: string;
  inputSlots: ComfyUIInputSlot[];
}): Promise<{ success: boolean; data?: ComfyUIWorkflowConfig; error?: string }> => {
  return post<ComfyUIWorkflowConfig>('/comfyui/workflows', payload);
};

/** 删除工作流 */
export const deleteComfyUIWorkflow = async (id: string): Promise<{ success: boolean; error?: string }> => {
  const res = await del<unknown>(`/comfyui/workflows/${id}`);
  return res.success ? { success: true } : { success: false, error: (res as any).error };
};

// 常用 ComfyUI 节点 class_type 的友好名称（便于管理员识别）
const COMFYUI_CLASS_NAMES: Record<string, string> = {
  CheckpointLoaderSimple: '检查点加载',
  CLIPTextEncode: '提示词',
  KSampler: 'K采样器',
  KSamplerAdvanced: 'K采样器(高级)',
  EmptyLatentImage: '空潜在图像',
  VAEDecode: 'VAE解码',
  SaveImage: '保存图像',
  LoadImage: '加载图像',
  LoraLoader: 'LoRA加载',
  ControlNetLoader: 'ControlNet加载',
  UNETLoader: 'UNet加载',
  ConditioningCombine: '条件合并',
  ConditioningSetArea: '条件设区域',
  SetNode: '设置节点',
  PreviewImage: '预览图像',
  LatentUpscale: '潜在图上采样',
  ImageScale: '图像缩放',
  ImageInvert: '图像反相',
  MaskToImage: '蒙版转图像',
  ImageToMask: '图像转蒙版',
  VAEEncode: 'VAE编码',
};
// 常用参数名的友好名称
const COMFYUI_INPUT_NAMES: Record<string, string> = {
  text: '文本',
  ckpt_name: '模型文件',
  seed: '种子',
  steps: '步数',
  cfg: 'CFG',
  denoise: '去噪强度',
  sampler_name: '采样器',
  scheduler: '调度器',
  width: '宽度',
  height: '高度',
  batch_size: '批次大小',
  filename_prefix: '文件名前缀',
  control_after_generate: '生成后控制',
};

function getNodeDisplayName(classType: string): string {
  return COMFYUI_CLASS_NAMES[classType] || classType;
}

function getInputDisplayName(inputName: string): string {
  return COMFYUI_INPUT_NAMES[inputName] || inputName;
}

/** 从完整工作流 JSON 的 nodes 数组中解析 nodeId -> 用户设置的标题（如「正面提示词」） */
function parseNodeTitlesFromFullWorkflow(root: Record<string, unknown>): Record<string, string> {
  const titles: Record<string, string> = {};
  const nodes = root.nodes;
  if (!Array.isArray(nodes)) return titles;
  for (const n of nodes) {
    if (!n || typeof n !== 'object') continue;
    const node = n as Record<string, unknown>;
    const id = node.id;
    const nodeId = id !== undefined && id !== null ? String(id) : '';
    if (!nodeId) continue;
    const props = node.properties as Record<string, unknown> | undefined;
    // 优先用 title（部分导出含 title），否则用 "Node name for S&R"（ComfyUI 官方）
    const title =
      (typeof node.title === 'string' && node.title.trim() && node.title) ||
      (props && typeof props['Node name for S&R'] === 'string' && (props['Node name for S&R'] as string).trim() && (props['Node name for S&R'] as string)) ||
      (props && typeof props.title === 'string' && (props.title as string).trim() && (props.title as string));
    const type = node.type;
    const classType = typeof type === 'string' ? type : '';
    if (title) titles[nodeId] = title;
    else if (classType) titles[nodeId] = getNodeDisplayName(classType);
  }
  return titles;
}

/** 从根对象中取出可执行的 prompt 部分（API 格式） */
function getPromptFromRoot(root: Record<string, unknown>): Record<string, { class_type?: string; inputs?: Record<string, unknown> }> | null {
  if (root.prompt && typeof root.prompt === 'object' && root.prompt !== null && !Array.isArray(root.prompt)) {
    return root.prompt as Record<string, { class_type?: string; inputs?: Record<string, unknown> }>;
  }
  const prompt: Record<string, { class_type?: string; inputs?: Record<string, unknown> }> = {};
  for (const [k, v] of Object.entries(root)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && 'class_type' in v && 'inputs' in v) {
      prompt[k] = v as { class_type?: string; inputs?: Record<string, unknown> };
    }
  }
  return Object.keys(prompt).length > 0 ? prompt : null;
}

/**
 * 从任意粘贴的 workflow JSON（API 或完整工作流）中提取可提交给 ComfyUI /prompt 的 API 格式 JSON 字符串。
 * 完整工作流时取 root.prompt 或根中的 prompt 型条目；纯 API 时原样返回。
 * 保存工作流时用此结果作为 workflowApiJson，执行时才能正常调用。
 */
export function getPromptJsonForExecution(workflowApiJson: string): string | null {
  try {
    const root = JSON.parse(workflowApiJson) as Record<string, unknown>;
    const prompt = getPromptFromRoot(root);
    return prompt ? JSON.stringify(prompt) : null;
  } catch {
    return null;
  }
}

/** 从单个节点（API 格式）取标题：支持 _meta.title（ComfyUI 导出的 API 常带此字段） */
function getTitleFromApiNode(node: Record<string, unknown>): string | undefined {
  const meta = node._meta as { title?: string } | undefined;
  return meta && typeof meta.title === 'string' && meta.title.trim() ? meta.title.trim() : undefined;
}

/**
 * 从 ComfyUI workflow JSON 中解析出所有可编辑参数项
 * - 支持三种来源的节点标题（优先级从高到低）：
 *   1）API 格式节点内的 _meta.title（你下载的 API JSON 里就有，如「正面提示词（暴露）」）
 *   2）完整工作流 nodes 数组里的 title / Node name for S&R
 *   3）class_type 的友好名（如「提示词」「K采样器」）
 * - 仅处理 inputs 中值为原始类型的项，跳过连线及对象（如 speak_and_recognation）
 */
export function parseWorkflowJsonToSlots(workflowApiJson: string): ComfyUIInputSlot[] {
  const slots: ComfyUIInputSlot[] = [];
  try {
    const root = JSON.parse(workflowApiJson) as Record<string, unknown>;
    const prompt = getPromptFromRoot(root);
    if (!prompt) return slots;

    const nodeTitlesFromFull = parseNodeTitlesFromFullWorkflow(root);
    const entries = Object.entries(prompt);
    entries.sort(([a], [b]) => {
      const na = parseInt(a, 10);
      const nb = parseInt(b, 10);
      if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
      if (!Number.isNaN(na)) return -1;
      if (!Number.isNaN(nb)) return 1;
      return a.localeCompare(b);
    });
    for (const [nodeId, node] of entries) {
      if (!node || typeof node !== 'object' || !node.inputs) continue;
      const classType = node.class_type || 'Node';
      const displayTitle =
        getTitleFromApiNode(node as Record<string, unknown>) ||
        nodeTitlesFromFull[nodeId] ||
        getNodeDisplayName(classType);
      const nodeLabel = `节点${nodeId} — ${displayTitle}`;
      for (const [inputName, value] of Object.entries(node.inputs)) {
        if (value === null || value === undefined) continue;
        if (Array.isArray(value) || (typeof value === 'object' && value !== null)) continue;
        const t = typeof value;
        let type: ComfyUIInputSlot['type'] = 'STRING';
        if (t === 'number') type = Number.isInteger(value) ? 'INT' : 'FLOAT';
        else if (t === 'boolean') type = 'BOOLEAN';
        else if (t === 'string' && (value === '' || value.startsWith('data:') || /\.(png|jpg|jpeg|webp)$/i.test(value))) type = 'IMAGE';
        const paramLabel = getInputDisplayName(inputName);
        const slotKey = `${nodeId}_${inputName}`;
        const rawDefault = value;
        const defaultValue =
          rawDefault !== null && rawDefault !== undefined && (typeof rawDefault === 'string' || typeof rawDefault === 'number' || typeof rawDefault === 'boolean')
            ? String(rawDefault)
            : undefined;
        slots.push({
          slotKey,
          label: `[节点${nodeId}] ${displayTitle} · ${paramLabel}`,
          type,
          nodeId,
          inputName,
          nodeLabel,
          defaultValue,
          exposed: false,
        });
      }
    }
  } catch (_) {
    // 解析失败返回空
  }
  return slots;
}
