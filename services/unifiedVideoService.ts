/**
 * 统一视频生成服务（Sora + Veo + Wan）
 * 同一网关：POST/GET /v2/videos/generations，通过 body.model 区分模型。
 */

import { sanitizeHeaderValue } from '../utils/headers';

export type UnifiedVideoModel =
  | 'sora-2'
  | 'sora-2-pro'
  | 'veo3.1-fast'
  | 'veo3.1'
  | 'veo3.1-4k'
  | 'veo3.1-pro'
  | 'veo3.1-pro-4k'
  | 'veo3.1-components'
  | 'veo3.1-components-4k'
  | 'wan2.6-r2v'
  | 'wan2.6-t2v'
  | 'wan2.6-i2v';

export type TaskStatus = 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILURE';

export interface VideoApiConfig {
  apiKey: string;
  baseUrl: string;
}

export interface UnifiedVideoParams {
  model: string;
  prompt: string;
  images?: string[];
  aspectRatio?: '16:9' | '9:16';
  duration?: '10' | '15' | '25';
  hd?: boolean;
  enhancePrompt?: boolean;
  enableUpsample?: boolean;
  seed?: number;
}

function imageToBase64DataUri(content: string): string {
  if (content.startsWith('data:image')) return content;
  return `data:image/png;base64,${content}`;
}

export function getVideoApiConfig(): VideoApiConfig {
  const sora = localStorage.getItem('soraConfig');
  if (sora) {
    const c = JSON.parse(sora);
    if (c?.apiKey) return { apiKey: c.apiKey, baseUrl: c.baseUrl || 'https://api.bltcy.ai' };
  }
  const veo = localStorage.getItem('veoConfig');
  if (veo) {
    const c = JSON.parse(veo);
    if (c?.apiKey) return { apiKey: c.apiKey, baseUrl: c.baseUrl || 'https://api.bltcy.ai' };
  }
  return { apiKey: '', baseUrl: 'https://api.bltcy.ai' };
}

export async function createUnifiedVideoTask(params: UnifiedVideoParams): Promise<string> {
  const config = getVideoApiConfig();
  if (!config.apiKey) throw new Error('请先配置视频 API Key（Sora 或 Veo 配置项）');

  const url = `${config.baseUrl.replace(/\/$/, '')}/v2/videos/generations`;
  const model = params.model || 'sora-2';

  const body: Record<string, unknown> = {
    prompt: params.prompt,
    model,
  };

  if (params.images && params.images.length > 0) {
    body.images = params.images.map(imageToBase64DataUri);
  }
  if (params.aspectRatio) {
    body.aspect_ratio = params.aspectRatio;
  }

  const isSora = model.startsWith('sora-');
  const isVeo = model.startsWith('veo3.1');
  const isWan = model.startsWith('wan2.6');

  if (isSora) {
    if (params.duration) body.duration = params.duration;
    if (params.hd !== undefined) body.hd = params.hd;
  }
  if (isVeo || isWan) {
    if (params.enhancePrompt !== undefined) body.enhance_prompt = params.enhancePrompt;
    if (params.enableUpsample !== undefined && !model.includes('components')) {
      body.enable_upsample = params.enableUpsample;
    }
    if (params.seed != null && params.seed > 0) body.seed = params.seed;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${sanitizeHeaderValue(config.apiKey)}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`视频任务创建失败 (${res.status}): ${await res.text()}`);
  const data = (await res.json()) as { task_id?: string; data?: string };
  const taskId = data.task_id ?? data.data;
  if (!taskId) throw new Error(`视频任务创建失败: ${JSON.stringify(data)}`);
  return taskId;
}

export interface UnifiedTaskStatus {
  status: TaskStatus;
  progress: number;
  videoUrl?: string;
  failReason?: string;
}

export async function getUnifiedVideoTaskStatus(taskId: string): Promise<UnifiedTaskStatus> {
  const config = getVideoApiConfig();
  const url = `${config.baseUrl.replace(/\/$/, '')}/v2/videos/generations/${taskId}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${sanitizeHeaderValue(config.apiKey)}` },
  });
  if (!res.ok) throw new Error(`查询任务失败 (${res.status}): ${await res.text()}`);
  const result = (await res.json()) as {
    status?: string;
    progress?: string | number;
    fail_reason?: string;
    data?: { output?: string };
  };
  const raw = (result.status || '').toLowerCase();
  let status: TaskStatus = 'PENDING';
  if (raw === 'success' || raw === 'completed') status = 'SUCCESS';
  else if (raw === 'running' || raw === 'in_progress') status = 'RUNNING';
  else if (raw === 'failure' || raw === 'failed') status = 'FAILURE';
  else if (raw === 'pending' || raw === 'not_start') status = 'PENDING';

  let progress = 0;
  const p = result.progress;
  if (typeof p === 'number') progress = p;
  else if (typeof p === 'string') {
    const m = p.match(/(\d+)/);
    progress = m ? parseInt(m[1], 10) : 0;
  }
  const videoUrl = result.data?.output;
  return { status, progress, videoUrl, failReason: result.fail_reason };
}

export async function waitForUnifiedVideoCompletion(
  taskId: string,
  onProgress?: (progress: number, status: string) => void,
  maxAttempts = 360,
  interval = 5000
): Promise<string> {
  for (let i = 0; i < maxAttempts; i++) {
    const task = await getUnifiedVideoTaskStatus(taskId);
    if (onProgress) onProgress(task.progress, task.status);
    if (task.status === 'SUCCESS') {
      if (task.videoUrl) return task.videoUrl;
      throw new Error('视频生成成功但未返回 URL');
    }
    if (task.status === 'FAILURE') throw new Error(task.failReason || '视频生成失败');
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error('视频生成超时');
}
