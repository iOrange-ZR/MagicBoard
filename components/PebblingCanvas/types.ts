/**
 * PebblingCanvas 内部类型定义
 * 画布组件专用的接口和类型别名
 */

import React from 'react';
import { CanvasNode, Vec2, NodeType, GenerationConfig } from '../../types/pebblingTypes';
import { CreativeIdea, DesktopItem } from '../../types';

// 可选：失败时通过 onError 回传错误信息，不抛错、不改变原有生成逻辑
export type ImageGenOptions = { onError?: (message: string) => void };

// 🔥 图片元数据(宽高/大小/格式)
export interface ImageMetadata {
    width: number;
    height: number;
    size: string;   // 格式化后的大小, 如 "125 KB"
    format: string;  // 图片格式, 如 "PNG", "JPEG"
}

// 批量保存选项
export interface BatchSavedOptions {
    label: string;
    imageUrls: string[];
    coverIndex: number;
    canvasId?: string;
    canvasName?: string;
    isVideo?: boolean;
}

// 画布组件 Props
export interface PebblingCanvasProps {
    onImageGenerated?: (imageUrl: string, prompt: string, canvasId?: string, canvasName?: string, isVideo?: boolean) => void;
    onBatchSaved?: (opts: BatchSavedOptions) => void;
    onCanvasCreated?: (canvasId: string, canvasName: string) => void;
    onCanvasDeleted?: (canvasId: string) => void;
    creativeIdeas?: CreativeIdea[];
    desktopItems?: DesktopItem[];
    isActive?: boolean;
    pendingImageToAdd?: { imageUrl: string; imageName?: string } | null;
    onPendingImageAdded?: () => void;
    saveRef?: React.MutableRefObject<(() => Promise<void>) | null>;
    onSaveWorkflowToCreativeLibrary?: (idea: Omit<CreativeIdea, 'id'>) => Promise<void>;
    onImagePreview?: (imageUrl: string) => void;
}
