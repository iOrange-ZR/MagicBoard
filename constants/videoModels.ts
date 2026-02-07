/**
 * 视频模型配置表：供 UI 模型选择器与执行层按 family 路由使用。
 * family 'unified' = 统一网关 POST/GET /v2/videos/generations（Sora / Veo）
 */

export type VideoModelFamily = 'unified' | 'kling' | 'minimax';

export interface VideoModelItem {
  id: string;
  label: string;
  family: VideoModelFamily;
}

export const VIDEO_MODEL_LIST: VideoModelItem[] = [
  // unified: Sora
  { id: 'sora-2', label: 'Sora 2', family: 'unified' },
  { id: 'sora-2-pro', label: 'Sora 2 Pro', family: 'unified' },
  // unified: Veo 3.1
  { id: 'veo3.1-fast', label: 'Veo 3.1 Fast', family: 'unified' },
  { id: 'veo3.1', label: 'Veo 3.1 标准', family: 'unified' },
  { id: 'veo3.1-4k', label: 'Veo 3.1 4K', family: 'unified' },
  { id: 'veo3.1-pro', label: 'Veo 3.1 Pro', family: 'unified' },
  { id: 'veo3.1-pro-4k', label: 'Veo 3.1 Pro 4K', family: 'unified' },
  { id: 'veo3.1-components', label: 'Veo 3.1 Comp', family: 'unified' },
  { id: 'veo3.1-components-4k', label: 'Veo 3.1 Comp 4K', family: 'unified' },
  // Kling
  { id: 'kling-video-v2.6', label: '可灵2.6（支持首尾帧）', family: 'kling' },
  { id: 'kling-video-o1', label: '可灵 O1', family: 'kling' },
  // MiniMax 海螺
  { id: 'minimax-hailuo-2.3', label: '海螺 2.3', family: 'minimax' },
  { id: 'minimax-hailuo-2.3-fast', label: '海螺 2.3 Fast', family: 'minimax' },
];

const VIDEO_MODEL_MAP = new Map(VIDEO_MODEL_LIST.map((m) => [m.id, m]));

/** 二级菜单：按系列分组，一级为系列名，二级为该系列下的具体模型 */
export const VIDEO_MODEL_GROUPS: { groupLabel: string; models: VideoModelItem[] }[] = [
  { groupLabel: 'Sora', models: VIDEO_MODEL_LIST.filter((m) => m.id === 'sora-2' || m.id === 'sora-2-pro') },
  { groupLabel: 'Veo 3.1', models: VIDEO_MODEL_LIST.filter((m) => m.id.startsWith('veo3.1')) },
  { groupLabel: '可灵', models: VIDEO_MODEL_LIST.filter((m) => m.family === 'kling') },
  { groupLabel: '海螺', models: VIDEO_MODEL_LIST.filter((m) => m.family === 'minimax') },
];

export function getVideoModelInfo(modelId: string): VideoModelItem | undefined {
  return VIDEO_MODEL_MAP.get(modelId);
}

/** 根据 modelId 得到所属系列标签，用于二级菜单当前选中 */
export function getModelGroupLabel(modelId: string): string | undefined {
  const g = VIDEO_MODEL_GROUPS.find((gr) => gr.models.some((m) => m.id === modelId));
  return g?.groupLabel;
}

export function getVideoModelFamily(modelId: string): VideoModelFamily | undefined {
  return VIDEO_MODEL_MAP.get(modelId)?.family;
}

/** 是否属于 Sora 系（需要 duration / hd / videoSize） */
export function isSoraModel(modelId: string): boolean {
  return modelId === 'sora-2' || modelId === 'sora-2-pro';
}

/** 是否属于 Veo 系（需要 veoMode / veoModel 等） */
export function isVeoModel(modelId: string): boolean {
  return modelId.startsWith('veo3.1');
}
