/**
 * 可灵 Kling 视频生成服务（先实现图生视频 image2video）
 * 网关: https://api.bltcy.ai/kling/v1/videos/image2video
 * 请求体格式与可灵官方一致
 */

import { getVideoApiConfig } from './unifiedVideoService';
import { sanitizeHeaderValue } from '../utils/headers';

const KLING_API_BASE = 'https://api.bltcy.ai';

export type KlingVideoMode = 'text2video' | 'image2video' | 'multi-image2video';
export type KlingModelId = 'kling-video-v2.6' | 'kling-video-o1';

/** 前端模型 id 映射为官方 model_name */
const MODEL_NAME_MAP: Record<KlingModelId, string> = {
  'kling-video-v2.6': 'kling-v2-6',
  'kling-video-o1': 'kling-video-o1',
};

export interface KlingImage2VideoParams {
  /** 模型，当前实现使用 kling-v2-6 */
  model: KlingModelId;
  /** 参考图像：URL 或 Base64（若为 data URI 会自动去掉前缀，仅传纯 Base64） */
  image: string;
  /** 正向提示词，不超过 2500 字符 */
  prompt: string;
  /** 生成模式：std 标准 / pro 高品质 */
  mode?: 'std' | 'pro';
  /** 时长，秒；'auto' 表示不传该参数由接口自动决定 */
  duration?: '5' | '10' | 'auto';
  /** 负向提示词 */
  negative_prompt?: string;
  /** 自由度 [0,1]，kling-v2.x 不支持 */
  cfg_scale?: number;
  /** 静态笔刷 mask 图 URL 或纯 Base64 */
  static_mask?: string;
  /** 动态笔刷配置 */
  dynamic_masks?: Array<{
    mask: string;
    trajectories: Array<{ x: number; y: number }>;
  }>;
  /** 尾帧图（与 static_mask/dynamic_masks/camera_control 三选一） */
  image_tail?: string;
  /** 是否生成声音 on/off，仅 V2.6+ */
  sound?: 'on' | 'off';
}

/**
 * 将前端传入的图片转为 API 要求格式：
 * - 若为 URL 则原样返回
 * - 若为 data:image/...;base64,xxx 则只返回 xxx（纯 Base64，不加前缀）
 * - 若已是纯 Base64 则原样返回
 */
function imageToApiValue(img: string): string {
  if (!img) return img;
  if (img.startsWith('http://') || img.startsWith('https://')) return img;
  const base64Match = img.match(/^data:image\/[^;]+;base64,(.+)$/i);
  if (base64Match) return base64Match[1].trim();
  return img;
}

/**
 * 创建图生视频任务
 * POST https://api.bltcy.ai/kling/v1/videos/image2video
 */
export async function createKlingImage2VideoTask(params: KlingImage2VideoParams): Promise<string> {
  const config = getVideoApiConfig();
  if (!config.apiKey) throw new Error('请先配置视频 API Key');

  const url = `${KLING_API_BASE}/kling/v1/videos/image2video`;
  const modelName = MODEL_NAME_MAP[params.model] ?? 'kling-v2-6';

  const body: Record<string, unknown> = {
    model_name: modelName,
    mode: params.mode ?? 'pro',
    image: imageToApiValue(params.image),
    prompt: params.prompt,
  };
  if (params.duration === '5' || params.duration === '10') {
    body.duration = params.duration;
  }

  if (params.negative_prompt != null) body.negative_prompt = params.negative_prompt;
  if (params.cfg_scale != null) body.cfg_scale = params.cfg_scale;
  if (params.sound != null) body.sound = params.sound;
  if (params.image_tail != null) body.image_tail = imageToApiValue(params.image_tail);
  if (params.static_mask != null) body.static_mask = imageToApiValue(params.static_mask);
  if (params.dynamic_masks != null && params.dynamic_masks.length > 0) {
    body.dynamic_masks = params.dynamic_masks.map((dm) => ({
      mask: imageToApiValue(dm.mask),
      trajectories: dm.trajectories,
    }));
  }
  body.watermark_info = { enabled: false };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${sanitizeHeaderValue(config.apiKey)}`,
    },
    body: JSON.stringify(body),
  });

  const raw = await res.text();
  if (!res.ok) throw new Error(`Kling 图生视频创建失败 (${res.status}): ${raw}`);

  let json: { code?: number; message?: string; data?: { task_id?: string } };
  try {
    json = JSON.parse(raw) as typeof json;
  } catch {
    throw new Error(`Kling 响应非 JSON: ${raw}`);
  }

  if (json.code !== 0 && json.code != null) {
    throw new Error(json.message || `Kling 业务错误: ${raw}`);
  }

  const taskId = json.data?.task_id;
  if (!taskId) throw new Error(`Kling 未返回 task_id: ${raw}`);
  return String(taskId);
}

export type KlingTaskStatus = 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILURE';

/** 官方任务状态 -> 统一状态 */
function mapTaskStatus(taskStatus?: string): KlingTaskStatus {
  const s = (taskStatus ?? '').toLowerCase();
  if (s === 'succeed' || s === 'success' || s === 'completed') return 'SUCCESS';
  if (s === 'processing' || s === 'running' || s === 'in_progress') return 'RUNNING';
  if (s === 'failed' || s === 'failure' || s === 'error') return 'FAILURE';
  return 'PENDING'; // submitted 等
}

/**
 * 查询图生视频任务状态
 * GET https://api.bltcy.ai/kling/v1/videos/tasks/{task_id}
 */
export async function getKlingImage2VideoTaskStatus(
  taskId: string
): Promise<{ status: KlingTaskStatus; progress: number; videoUrl?: string; failReason?: string }> {
  const config = getVideoApiConfig();
  const url = `${KLING_API_BASE}/kling/v1/videos/tasks/${encodeURIComponent(taskId)}`;

  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${sanitizeHeaderValue(config.apiKey)}` },
  });

  const raw = await res.text();
  if (!res.ok) throw new Error(`Kling 查询任务失败 (${res.status}): ${raw}`);

  let result: {
    code?: number;
    message?: string;
    data?: {
      task_id?: string;
      task_status?: string;
      task_result?: {
        video_url?: string;
        videos?: Array<{ url?: string; id?: string; duration?: string }>;
      };
      video_url?: string;
      result?: { video_url?: string };
    };
  };
  try {
    result = JSON.parse(raw) as typeof result;
  } catch {
    throw new Error(`Kling 响应非 JSON: ${raw}`);
  }

  if (result.code !== 0 && result.code != null) {
    throw new Error(result.message || `Kling 业务错误: ${raw}`);
  }

  const data = result.data ?? {};
  const taskStatus = data.task_status ?? '';
  const status = mapTaskStatus(taskStatus);

  const videoUrl =
    data.task_result?.videos?.[0]?.url ??
    data.task_result?.video_url ??
    data.video_url ??
    data.result?.video_url;

  return {
    status,
    progress: status === 'SUCCESS' ? 100 : status === 'RUNNING' ? 50 : 0,
    videoUrl: videoUrl ? String(videoUrl) : undefined,
    failReason: (data as { fail_reason?: string }).fail_reason,
  };
}

export async function waitForKlingImage2VideoCompletion(
  taskId: string,
  onProgress?: (progress: number, status: string) => void,
  maxAttempts = 360,
  interval = 5000
): Promise<string> {
  for (let i = 0; i < maxAttempts; i++) {
    const task = await getKlingImage2VideoTaskStatus(taskId);
    if (onProgress) onProgress(task.progress, task.status);
    if (task.status === 'SUCCESS') {
      if (task.videoUrl) return task.videoUrl;
      throw new Error('Kling 图生视频成功但未返回 URL');
    }
    if (task.status === 'FAILURE') {
      throw new Error(task.failReason || 'Kling 图生视频失败');
    }
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error('Kling 图生视频超时');
}

// ---------- 兼容旧调用：仅支持 image2video，统一入口 ----------

export interface KlingVideoParams {
  model: KlingModelId;
  mode: KlingVideoMode;
  prompt: string;
  images?: string[];
  duration?: '5' | '10' | 'auto';
  sound?: 'on' | 'off';
  negative_prompt?: string;
}

/**
 * 创建 Kling 视频任务（兼容旧接口）
 * 当前仅实现 image2video；mode 为 text2video / multi-image2video 时抛出明确错误。
 */
export async function createKlingVideoTask(params: KlingVideoParams): Promise<string> {
  if (params.mode !== 'image2video') {
    throw new Error(`当前仅支持图生视频(image2video)，暂不支持 ${params.mode}`);
  }
  const image = params.images?.[0];
  if (!image) throw new Error('图生视频需要至少一张参考图');
  const imageTail = params.images?.length >= 2 ? params.images[1] : undefined;
  return createKlingImage2VideoTask({
    model: params.model,
    image,
    prompt: params.prompt,
    mode: 'pro',
    duration: params.duration === 'auto' ? undefined : (params.duration ?? '5'),
    sound: params.sound ?? 'off',
    negative_prompt: params.negative_prompt,
    image_tail: imageTail,
  });
}

export async function getKlingTaskStatus(
  taskId: string,
  mode: KlingVideoMode
): Promise<{ status: KlingTaskStatus; progress: number; videoUrl?: string; failReason?: string }> {
  if (mode !== 'image2video') {
    throw new Error(`当前仅支持图生视频任务查询，mode=${mode}`);
  }
  return getKlingImage2VideoTaskStatus(taskId);
}

export async function waitForKlingCompletion(
  taskId: string,
  mode: KlingVideoMode,
  onProgress?: (progress: number, status: string) => void,
  maxAttempts = 360,
  interval = 5000
): Promise<string> {
  if (mode !== 'image2video') {
    throw new Error(`当前仅支持图生视频等待完成，mode=${mode}`);
  }
  return waitForKlingImage2VideoCompletion(taskId, onProgress, maxAttempts, interval);
}

// ---------- 可灵 O1 Omni 视频 API ----------

const KLING_OMNI_VIDEO_URL = `${KLING_API_BASE}/kling/v1/videos/omni-video`;

/**
 * 判断视频 URL 是否可被可灵服务器访问（公网 URL）。
 * 本地路径、data/blob、localhost 等均不可被服务器访问，不应传入 video_list。
 */
export function isKlingServerAccessibleVideoUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  const u = url.trim();
  if (u.startsWith('data:') || u.startsWith('blob:')) return false;
  if (u.startsWith('/files/') || u.startsWith('/api/')) return false;
  try {
    if (u.startsWith('http://') || u.startsWith('https://')) {
      const host = new URL(u).hostname;
      if (host === 'localhost' || host === '127.0.0.1' || host === '') return false;
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

export interface KlingO1ImageItem {
  image_url: string; // URL 或纯 Base64
  type?: 'first_frame' | 'end_frame';
}

export interface KlingO1VideoItem {
  video_url: string;
  refer_type?: 'feature' | 'base';
  keep_original_sound?: 'yes' | 'no';
}

export interface KlingO1ElementItem {
  element_id: number;
}

export interface KlingO1TaskParams {
  prompt: string;
  image_list?: KlingO1ImageItem[];
  video_list?: KlingO1VideoItem[];
  element_list?: KlingO1ElementItem[];
  mode?: 'std' | 'pro';
  aspect_ratio?: '16:9' | '9:16' | '1:1';
  duration?: '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10';
  watermark_info?: { enabled: boolean };
}

/**
 * 创建可灵 O1 Omni 视频任务
 * POST https://api.bltcy.ai/kling/v1/videos/omni-video
 */
export async function createKlingO1Task(params: KlingO1TaskParams): Promise<string> {
  const config = getVideoApiConfig();
  if (!config.apiKey) throw new Error('请先配置视频 API Key');

  const image_list = (params.image_list ?? []).map((item) => ({
    image_url: imageToApiValue(item.image_url),
    ...(item.type != null ? { type: item.type } : {}),
  }));

  const video_list = params.video_list ?? [];
  const element_list = params.element_list ?? [];

  const body: Record<string, unknown> = {
    model_name: 'kling-video-o1',
    prompt: params.prompt,
    image_list,
    element_list,
    mode: params.mode ?? 'pro',
    aspect_ratio: params.aspect_ratio ?? '16:9',
    duration: params.duration ?? '5',
    watermark_info: params.watermark_info ?? { enabled: false },
  };

  if (video_list.length > 0) {
    body.video_list = video_list;
  }

  const res = await fetch(KLING_OMNI_VIDEO_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${sanitizeHeaderValue(config.apiKey)}`,
    },
    body: JSON.stringify(body),
  });

  const raw = await res.text();
  if (!res.ok) throw new Error(`Kling O1 创建任务失败 (${res.status}): ${raw}`);

  let json: { code?: number | string; message?: string; data?: { task_id?: string } };
  try {
    json = JSON.parse(raw) as typeof json;
  } catch {
    throw new Error(`Kling O1 响应非 JSON: ${raw}`);
  }

  const isError = json.code != null && json.code !== 0 && json.code !== '0';
  if (isError) {
    const msg = json.message || '';
    if (json.code === 'get_ratios_error' || /media_duration|audio duration|get.*duration/i.test(msg)) {
      throw new Error('参考视频无法被服务器解析或访问。请使用可公网访问的 MP4/MOV 视频 URL（不要使用本地路径或 data 链接）；若无需参考视频可先断开视频输入再试。');
    }
    throw new Error(msg || `Kling O1 业务错误: ${raw}`);
  }

  const taskId = json.data?.task_id;
  if (!taskId) throw new Error(`Kling O1 未返回 task_id: ${raw}`);
  return String(taskId);
}

/**
 * 查询可灵 O1 Omni 任务状态（复用 image2video 任务查询端点）
 */
export async function getKlingOmniTaskStatus(
  taskId: string
): Promise<{ status: KlingTaskStatus; progress: number; videoUrl?: string; failReason?: string }> {
  return getKlingImage2VideoTaskStatus(taskId);
}

export async function waitForKlingOmniCompletion(
  taskId: string,
  onProgress?: (progress: number, status: string) => void,
  maxAttempts = 360,
  interval = 5000
): Promise<string> {
  return waitForKlingImage2VideoCompletion(taskId, onProgress, maxAttempts, interval);
}
