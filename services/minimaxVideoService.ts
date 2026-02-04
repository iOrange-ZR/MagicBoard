/**
 * MiniMax 海螺视频生成服务
 * 网关 OpenAPI: POST /minimax/v1/video_generation
 * 图生视频参数以 MiniMax 官方为准：https://platform.minimax.io/docs/api-reference/video-generation-i2v
 * 首帧图片字段为 first_frame_image，支持公网 URL 或 Base64 Data URL（data:image/xxx;base64,...）。
 */

import { getVideoApiConfig } from './unifiedVideoService';
import { sanitizeHeaderValue } from '../utils/headers';

export type MinimaxHailuoModel = 'minimax-hailuo-2.3' | 'minimax-hailuo-2.3-fast';

/** 文档可选值：分辨率 768P | 1080P，时长(秒) 6 | 10 */
export type MinimaxResolution = '768P' | '1080P';
export type MinimaxDuration = 6 | 10;

function imageToBase64DataUri(content: string): string {
  if (content.startsWith('data:image')) return content;
  return `data:image/png;base64,${content}`;
}

export interface MinimaxVideoParams {
  model: MinimaxHailuoModel;
  prompt: string;
  /** 图生视频时传入至少一张图片（与 unified 一致：data URL 或 base64 字符串） */
  images?: string[];
  /** 视频时长（秒），仅支持 6 或 10 */
  duration?: MinimaxDuration;
  /** 分辨率，仅支持 768P 或 1080P */
  resolution?: MinimaxResolution;
}

export async function createMinimaxVideoTask(params: MinimaxVideoParams): Promise<string> {
  const config = getVideoApiConfig();
  if (!config.apiKey) throw new Error('请先配置视频 API Key');

  const url = `${config.baseUrl.replace(/\/$/, '')}/minimax/v1/video_generation`;
  const resolution = params.resolution ?? '1080P';
  const duration = resolution === '1080P' ? 6 : (params.duration ?? 6); // 1080P 仅支持 6s
  // 网关 model 枚举：用户选 2.3-Fast 仅支持图生，由调用方在无图时拦截并提示
  const modelForApi =
    params.model === 'minimax-hailuo-2.3-fast'
      ? 'MiniMax-Hailuo-2.3-Fast'
      : params.model === 'minimax-hailuo-2.3'
        ? 'MiniMax-Hailuo-2.3'
        : params.model;
  const body: Record<string, unknown> = {
    model: modelForApi,
    prompt: params.prompt,
    duration,
    resolution,
  };
  if (params.images && params.images.length > 0) {
    const imageDataUri = imageToBase64DataUri(params.images[0]);
    body.first_frame_image = imageDataUri;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${sanitizeHeaderValue(config.apiKey)}`,
    },
    body: JSON.stringify(body),
  });
  const responseText = await res.text();
  if (!res.ok) {
    throw new Error(`MiniMax 创建任务失败 (${res.status}): ${responseText}`);
  }
  let data: {
    task_id?: string;
    id?: string;
    data?: string;
    code?: string;
    message?: string;
    upstream_message?: string;
  };
  try {
    data = JSON.parse(responseText) as typeof data;
  } catch {
    throw new Error(`MiniMax 响应解析失败: ${responseText}`);
  }
  const taskId = data.task_id ?? data.id ?? data.data;
  if (!taskId) {
    const msg = data.message ?? data.upstream_message ?? '';
    if (data.code === 'upstream_error' || msg.includes('does not support Text-to-Video')) {
      let reason = '海螺 2.3 Fast 仅支持图生视频，请连接图片节点作为输入';
      try {
        const inner = typeof msg === 'string' ? JSON.parse(msg) : msg;
        const innerMsg = inner?.message;
        if (typeof innerMsg === 'string') {
          const statusMsgMatch = innerMsg.match(/"status_msg"\s*:\s*"((?:[^"\\]|\\.)*)"/);
          if (statusMsgMatch?.[1]) reason = statusMsgMatch[1].replace(/\\"/g, '"');
          else if (innerMsg.includes('Text-to-Video')) reason = '当前模型不支持纯文生视频，请使用图生视频或更换为海螺 2.3 标准版';
        }
      } catch {
        if (typeof msg === 'string' && msg.includes('Text-to-Video')) reason = '当前模型不支持纯文生视频，请使用图生视频或更换为海螺 2.3 标准版';
      }
      throw new Error(reason);
    }
    throw new Error(`MiniMax 任务创建失败: ${JSON.stringify(data)}`);
  }
  return String(taskId);
}

export type MinimaxTaskStatus = 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILURE';

export async function getMinimaxTaskStatus(taskId: string): Promise<{
  status: MinimaxTaskStatus;
  progress: number;
  fileId?: string;
  videoUrl?: string;
  failReason?: string;
}> {
  const config = getVideoApiConfig();
  const base = config.baseUrl.replace(/\/$/, '');
  const queryUrl = `${base}/minimax/v1/query/video_generation?task_id=${encodeURIComponent(taskId)}`;
  const res = await fetch(queryUrl, {
    method: 'GET',
    headers: { Authorization: `Bearer ${sanitizeHeaderValue(config.apiKey)}` },
  });
  if (!res.ok) throw new Error(`MiniMax 查询任务失败 (${res.status}): ${await res.text()}`);
  const result = (await res.json()) as {
    status?: string;
    task_status?: string;
    progress?: string | number;
    fail_reason?: string;
    file_id?: string | number;
    file?: { file_id?: string | number; download_url?: string; video_url?: string };
    data?: { file_id?: string; output?: string; video_url?: string };
  };
  const raw = (result.status ?? result.task_status ?? '').toLowerCase();
  let status: MinimaxTaskStatus = 'PENDING';
  if (raw === 'success' || raw === 'completed' || raw === 'succeed') status = 'SUCCESS';
  else if (raw === 'running' || raw === 'in_progress' || raw === 'processing') status = 'RUNNING';
  else if (raw === 'failure' || raw === 'failed' || raw === 'error') status = 'FAILURE';
  else status = 'PENDING';

  let progress = 0;
  const p = result.progress;
  if (typeof p === 'number') progress = p;
  else if (typeof p === 'string') {
    const m = p.match(/(\d+)/);
    progress = m ? parseInt(m[1], 10) : 0;
  }
  const fileId =
    result.file_id != null
      ? String(result.file_id)
      : result.file?.file_id != null
        ? String(result.file.file_id)
        : result.data?.file_id;
  const videoUrl =
    result.file?.download_url ?? result.file?.video_url ?? result.data?.video_url;
  return {
    status,
    progress,
    fileId,
    videoUrl: videoUrl ? String(videoUrl) : undefined,
    failReason: result.fail_reason,
  };
}

/** 通过 file_id 获取视频 URL */
export async function getMinimaxFileUrl(fileId: string): Promise<string> {
  const config = getVideoApiConfig();
  const base = config.baseUrl.replace(/\/$/, '');
  const url = `${base}/minimax/v1/files/retrieve?file_id=${encodeURIComponent(fileId)}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${sanitizeHeaderValue(config.apiKey)}` },
  });
  if (!res.ok) throw new Error(`MiniMax 获取视频链接失败 (${res.status}): ${await res.text()}`);
  const data = (await res.json()) as { url?: string; data?: string; file_url?: string; output?: string };
  const videoUrl = data.url ?? data.data ?? data.file_url ?? data.output;
  if (!videoUrl) throw new Error(`MiniMax 未返回视频 URL: ${JSON.stringify(data)}`);
  return String(videoUrl);
}

export async function waitForMinimaxCompletion(
  taskId: string,
  onProgress?: (progress: number, status: string) => void,
  maxAttempts = 360,
  interval = 5000
): Promise<string> {
  for (let i = 0; i < maxAttempts; i++) {
    const task = await getMinimaxTaskStatus(taskId);
    if (onProgress) onProgress(task.progress, task.status);
    if (task.status === 'SUCCESS') {
      if (task.videoUrl) return task.videoUrl;
      if (task.fileId) return await getMinimaxFileUrl(task.fileId);
      throw new Error('MiniMax 视频生成成功但未返回 file_id 或 URL');
    }
    if (task.status === 'FAILURE') throw new Error(task.failReason || 'MiniMax 视频生成失败');
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error('MiniMax 视频生成超时');
}
