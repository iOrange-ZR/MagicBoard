/**
 * 可灵 Kling 视频生成服务（仅视频：文生视频、图生视频、多图参考生视频）
 * 网关: api.bltcy.ai/kling/v1/videos/{text2video|image2video|multi-image2video}
 */

import { getVideoApiConfig } from './unifiedVideoService';
import { sanitizeHeaderValue } from '../utils/headers';

export type KlingVideoMode = 'text2video' | 'image2video' | 'multi-image2video';
export type KlingModelId = 'kling-video-v2.6' | 'kling-video-o1';

export interface KlingVideoParams {
  model: KlingModelId;
  mode: KlingVideoMode;
  prompt: string;
  images?: string[];
  aspectRatio?: '16:9' | '9:16';
}

function imageToDataUri(img: string): string {
  if (img.startsWith('data:image')) return img;
  return `data:image/png;base64,${img}`;
}

export async function createKlingVideoTask(params: KlingVideoParams): Promise<string> {
  const config = getVideoApiConfig();
  if (!config.apiKey) throw new Error('请先配置视频 API Key');

  const base = config.baseUrl.replace(/\/$/, '');
  const path = `/kling/v1/videos/${params.mode}`;
  const url = `${base}${path}`;

  const body: Record<string, unknown> = {
    prompt: params.prompt,
    model_name: params.model,
    aspect_ratio: params.aspectRatio || '16:9',
  };
  if (params.images && params.images.length > 0) {
    if (params.mode === 'text2video') {
      // 文生视频一般不传图，若网关支持可忽略
    } else if (params.mode === 'image2video') {
      body.image = imageToDataUri(params.images[0]);
    } else {
      body.images = params.images.map(imageToDataUri);
    }
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${sanitizeHeaderValue(config.apiKey)}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Kling 创建任务失败 (${res.status}): ${await res.text()}`);
  const data = (await res.json()) as { task_id?: string; data?: string; id?: string };
  const taskId = data.task_id ?? data.data ?? data.id;
  if (!taskId) throw new Error(`Kling 任务创建失败: ${JSON.stringify(data)}`);
  return String(taskId);
}

export type KlingTaskStatus = 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILURE';

export async function getKlingTaskStatus(
  taskId: string,
  mode: KlingVideoMode
): Promise<{ status: KlingTaskStatus; progress: number; videoUrl?: string; failReason?: string }> {
  const config = getVideoApiConfig();
  const base = config.baseUrl.replace(/\/$/, '');
  const url = `${base}/kling/v1/videos/${mode}/${taskId}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${sanitizeHeaderValue(config.apiKey)}` },
  });
  if (!res.ok) throw new Error(`Kling 查询任务失败 (${res.status}): ${await res.text()}`);
  const result = (await res.json()) as {
    status?: string;
    task_status?: string;
    progress?: string | number;
    fail_reason?: string;
    data?: { output?: string; video_url?: string; result?: string };
    output?: string;
    video_url?: string;
  };
  const raw = (result.status ?? result.task_status ?? '').toLowerCase();
  let status: KlingTaskStatus = 'PENDING';
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
  const videoUrl =
    result.data?.output ??
    result.data?.video_url ??
    result.data?.result ??
    result.output ??
    result.video_url;
  return {
    status,
    progress,
    videoUrl: videoUrl ? String(videoUrl) : undefined,
    failReason: result.fail_reason,
  };
}

export async function waitForKlingCompletion(
  taskId: string,
  mode: KlingVideoMode,
  onProgress?: (progress: number, status: string) => void,
  maxAttempts = 360,
  interval = 5000
): Promise<string> {
  for (let i = 0; i < maxAttempts; i++) {
    const task = await getKlingTaskStatus(taskId, mode);
    if (onProgress) onProgress(task.progress, task.status);
    if (task.status === 'SUCCESS') {
      if (task.videoUrl) return task.videoUrl;
      throw new Error('Kling 视频生成成功但未返回 URL');
    }
    if (task.status === 'FAILURE') throw new Error(task.failReason || 'Kling 视频生成失败');
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error('Kling 视频生成超时');
}
