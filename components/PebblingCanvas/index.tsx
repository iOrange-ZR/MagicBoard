
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { CanvasNode, Vec2, NodeType, Connection, GenerationConfig, NodeData, CanvasPreset, PresetInput, KlingO1InputItem } from '../../types/pebblingTypes';
import { CreativeIdea, DesktopItem, DesktopFolderItem, DesktopImageItem, DesktopVideoItem, WorkflowNode, WorkflowConnection, WorkflowInput, WorkflowNodeType } from '../../types';
import FloatingInput from './FloatingInput';
import CanvasNodeItem from './CanvasNode';
import Sidebar from './Sidebar';
import ContextMenu from './ContextMenu';
import PresetCreationModal from './PresetCreationModal';
import PresetInstantiationModal from './PresetInstantiationModal';
import CanvasNameBadge from './CanvasNameBadge';
import ImageGenPanel from './ImageGenPanel';
import { editImageWithGemini, chatWithThirdPartyApi, getThirdPartyConfig, ImageEditConfig } from '../../services/geminiService';
import { runAIApp, getAIAppInfo } from '../../services/api/runninghub';
import { comfyuiSubmitPrompt, comfyuiGetHistory, getComfyUIConfig, getComfyUIWorkflows } from '../../services/api/comfyui';
import type { ComfyUIWorkflowConfig, ComfyUIAddress } from '../../services/api/comfyui';
import { useRHTaskQueue } from '../../contexts/RHTaskQueueContext';
import { useTheme } from '../../contexts/ThemeContext';
import * as canvasApi from '../../services/api/canvas';
import { downloadRemoteToOutput, saveVideoToOutput, saveBatchToOutput } from '../../services/api/files';
import type { BatchSaveItem } from '../../services/api/files';
import { Icons } from './Icons';
import { getVideoModelFamily } from '../../constants/videoModels';

// === 画布用API适配器，桥接主项目的geminiService ===

// 检查API是否已配置（支持API或原生Gemini）
const isApiConfigured = (): boolean => {
  const config = getThirdPartyConfig();
  // API 或 Gemini API Key
  const hasThirdParty = !!(config && config.enabled && config.apiKey);
  const hasGemini = !!localStorage.getItem('gemini_api_key');
  return hasThirdParty || hasGemini;
};

// base64 转 File - 支持多种图片格式
const base64ToFile = async (imageUrl: string, filename: string = 'image.png'): Promise<File> => {
  try {
    // 1. 如果是 data:image base64 格式，直接 fetch
    if (imageUrl.startsWith('data:image')) {
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      return new File([blob], filename, { type: blob.type || 'image/png' });
    }
    
    // 2. 如果是本地路径 /files/xxx，需要通过 API 转换
    if (imageUrl.startsWith('/files/') || imageUrl.startsWith('/api/')) {
      // 加载图片并转为 base64
      const img = new Image();
      img.crossOrigin = 'anonymous';
      
      return new Promise((resolve, reject) => {
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0);
          canvas.toBlob((blob) => {
            if (blob) {
              resolve(new File([blob], filename, { type: 'image/png' }));
            } else {
              reject(new Error('图片转换失败'));
            }
          }, 'image/png');
        };
        img.onerror = () => reject(new Error(`图片加载失败: ${imageUrl.slice(0, 100)}`));
        img.src = imageUrl;
      });
    }
    
    // 3. 如果是 HTTP/HTTPS URL，通过 canvas 转换避免 CORS 问题
    if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://') || imageUrl.startsWith('//')) {
      const img = new Image();
      img.crossOrigin = 'anonymous'; // 尝试跨域
      
      return new Promise((resolve, reject) => {
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0);
          canvas.toBlob((blob) => {
            if (blob) {
              resolve(new File([blob], filename, { type: 'image/png' }));
            } else {
              reject(new Error('图片转换失败'));
            }
          }, 'image/png');
        };
        img.onerror = () => {
          console.error('[base64ToFile] 图片加载失败，可能是 CORS 问题:', imageUrl.slice(0, 100));
          reject(new Error(`图片加载失败(CORS): ${imageUrl.slice(0, 100)}`));
        };
        img.src = imageUrl;
      });
    }
    
    // 4. 其他格式，尝试直接 fetch
    console.warn('[base64ToFile] 未知格式，尝试直接 fetch:', imageUrl.slice(0, 50));
    const response = await fetch(imageUrl);
    const blob = await response.blob();
    return new File([blob], filename, { type: blob.type || 'image/png' });
  } catch (error) {
    console.error('[base64ToFile] 转换失败:', error, 'URL:', imageUrl.slice(0, 100));
    throw error;
  }
};

// 生成图片（文生图/图生图）- 自动选择API或Gemini
const generateCreativeImage = async (
  prompt: string, 
  config?: GenerationConfig,
  signal?: AbortSignal
): Promise<string | null> => {
  try {
    const imageConfig: ImageEditConfig = {
      aspectRatio: config?.aspectRatio || '1:1',
      imageSize: config?.resolution || '1K',
    };
    // 使用统一的 editImageWithGemini，它会自动判断用哪个API
    const result = await editImageWithGemini([], prompt, imageConfig);
    return result.imageUrl;
  } catch (e) {
    console.error('文生图失败:', e);
    return null;
  }
};

// 编辑图片（图生图）- 自动选择API或Gemini
const editCreativeImage = async (
  images: string[],
  prompt: string,
  config?: GenerationConfig,
  signal?: AbortSignal
): Promise<string | null> => {
  try {
    console.log('[editCreativeImage] 开始处理, 输入图片数量:', images.length);
    console.log('[editCreativeImage] 图片格式预览:', images.map(img => ({
      prefix: img.slice(0, 50),
      length: img.length,
      isBase64: img.startsWith('data:image'),
      isHttpUrl: img.startsWith('http'),
      isLocalPath: img.startsWith('/files/')
    })));
    
    // 转换所有图片为File对象
    const files = await Promise.all(images.map(async (img, i) => {
      try {
        const file = await base64ToFile(img, `input_${i}.png`);
        console.log(`[editCreativeImage] 图片 ${i + 1} 转换成功:`, {
          name: file.name,
          size: file.size,
          type: file.type
        });
        return file;
      } catch (err) {
        console.error(`[editCreativeImage] 图片 ${i + 1} 转换失败:`, err);
        throw err;
      }
    }));
    
    // 检查是否所有文件都有效
    const validFiles = files.filter(f => f.size > 0);
    console.log(`[editCreativeImage] 有效文件数: ${validFiles.length}/${files.length}`);
    
    if (validFiles.length === 0 && images.length > 0) {
      console.error('[editCreativeImage] 所有图片转换失败，退化为文生图');
    }
    
    const imageConfig: ImageEditConfig = {
      aspectRatio: config?.aspectRatio || 'Auto',
      imageSize: config?.resolution || '1K',
    };
    // 使用统一的 editImageWithGemini，它会自动判断用哪个API
    const result = await editImageWithGemini(validFiles, prompt, imageConfig);
    return result.imageUrl;
  } catch (e) {
    console.error('图生图失败:', e);
    return null;
  }
};

// 生成文本/扩写
const generateCreativeText = async (content: string): Promise<{ title: string; content: string }> => {
  try {
    const systemPrompt = `You are a creative writing assistant. Expand and enhance the following content into a more detailed and vivid description. Output ONLY the enhanced text, no titles or explanations.`;
    const result = await chatWithThirdPartyApi(systemPrompt, content);
    // 提取第一行作为标题
    const lines = result.split('\n').filter(l => l.trim());
    const title = lines[0]?.slice(0, 50) || '扩写内容';
    return { title, content: result };
  } catch (e) {
    console.error('文本生成失败:', e);
    return { title: '错误', content: String(e) };
  }
};

// LLM文本处理
const generateAdvancedLLM = async (
  userPrompt: string,
  systemPrompt?: string,
  images?: string[]
): Promise<string> => {
  try {
    const system = systemPrompt || 'You are a helpful assistant.';
    // 如果有图片，取第一张转换为File
    let imageFile: File | undefined;
    if (images && images.length > 0) {
      imageFile = await base64ToFile(images[0], 'input.png');
    }
    // 使用通用的chat接口（不带图片时传undefined）
    const result = await chatWithThirdPartyApi(system, userPrompt, imageFile);
    return result;
  } catch (e) {
    console.error('LLM处理失败:', e);
    return `错误: ${e}`;
  }
};

// 检查是否是有效的视频数据
const isValidVideo = (content: string | undefined): boolean => {
  if (!content || content.length < 10) return false;
  return (
    content.startsWith('data:video') ||
    content.startsWith('http://') ||
    content.startsWith('https://') ||
    content.startsWith('//') ||
    content.startsWith('/files/')
  );
};

// 检查是否是有效的图片数据
const isValidImage = (content: string | undefined): boolean => {
  if (!content || content.length < 10) return false;
  return (
    content.startsWith('data:image') ||
    content.startsWith('http://') ||
    content.startsWith('https://') ||
    content.startsWith('//') ||
    content.startsWith('/files/') ||
    content.startsWith('/api/')
  );
};

// 🔥 提取图片元数据(宽高/大小/格式)
interface ImageMetadata {
  width: number;
  height: number;
  size: string; // 格式化后的大小, 如 "125 KB"
  format: string; // 图片格式, 如 "PNG", "JPEG"
}

const extractImageMetadata = async (imageUrl: string): Promise<ImageMetadata> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    
    img.onload = () => {
      const width = img.naturalWidth;
      const height = img.naturalHeight;
      
      // 提取格式
      let format = 'UNKNOWN';
      if (imageUrl.startsWith('data:image/')) {
        const match = imageUrl.match(/data:image\/(\w+);/);
        format = match ? match[1].toUpperCase() : 'BASE64';
      } else if (imageUrl.includes('.')) {
        const ext = imageUrl.split('.').pop()?.split('?')[0];
        format = ext ? ext.toUpperCase() : 'URL';
      }
      
      // 计算大小
      let size = 'Unknown';
      if (imageUrl.startsWith('data:')) {
        // Base64: 计算字符串长度
        const base64Length = imageUrl.split(',')[1]?.length || 0;
        const bytes = (base64Length * 3) / 4; // Base64解码后的字节数
        if (bytes < 1024) {
          size = `${Math.round(bytes)} B`;
        } else if (bytes < 1024 * 1024) {
          size = `${(bytes / 1024).toFixed(1)} KB`;
        } else {
          size = `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
        }
      }
      
      resolve({ width, height, size, format });
    };
    
    img.onerror = () => {
      console.warn('[extractImageMetadata] 图片加载失败:', imageUrl.slice(0, 100));
      // 返回默认值
      resolve({ width: 0, height: 0, size: 'Unknown', format: 'Unknown' });
    };
    
    img.src = imageUrl;
  });
};

// === 画布组件开始 ===

export interface BatchSavedOptions {
  label: string;
  imageUrls: string[];
  coverIndex: number;
  canvasId?: string;
  canvasName?: string;
  isVideo?: boolean;
}

/** 画布节点类型中与创意库 WorkflowNode 兼容的子集 */
const WORKFLOW_NODE_TYPES: WorkflowNodeType[] = ['text', 'image', 'edit', 'video', 'llm', 'resize', 'relay', 'remove-bg', 'upscale'];

function canvasNodeToWorkflowNode(n: CanvasNode): WorkflowNode {
  const type = (WORKFLOW_NODE_TYPES.includes(n.type as WorkflowNodeType) ? n.type : 'relay') as WorkflowNodeType;
  return {
    id: n.id,
    type,
    title: n.title,
    content: n.content ?? '',
    x: n.x,
    y: n.y,
    width: n.width,
    height: n.height,
    data: n.data ? { prompt: n.data.prompt, systemInstruction: n.data.systemInstruction, settings: n.data.settings } : undefined,
  };
}

interface PebblingCanvasProps {
  onImageGenerated?: (imageUrl: string, prompt: string, canvasId?: string, canvasName?: string, isVideo?: boolean) => void; // 回调同步到桌面（含画布ID用于联动；isVideo 用于 ComfyUI 视频 URL 正确保存）
  onBatchSaved?: (opts: BatchSavedOptions) => void; // 批量保存完成：创建桌面子文件夹并放入全部图片
  onCanvasCreated?: (canvasId: string, canvasName: string) => void; // 画布创建回调（用于桌面联动创建文件夹）
  onCanvasDeleted?: (canvasId: string) => void; // 画布删除回调（用于桌面文件夹标记归档）
  creativeIdeas?: CreativeIdea[]; // 主项目创意文本库
  desktopItems?: DesktopItem[]; // 素材库（桌面）项目，用于画布内素材库浮动面板
  isActive?: boolean; // 画布是否处于活动状态（用于快捷键作用域控制）
  pendingImageToAdd?: { imageUrl: string; imageName?: string } | null; // 待添加的图片（从素材库添加）
  onPendingImageAdded?: () => void; // 图片添加完成后的回调
  saveRef?: React.MutableRefObject<(() => Promise<void>) | null>; // 暴露保存函数给父组件
  /** 将画布流程保存到创意文本库（作为画布流程条目），便于在创意库中复用 */
  onSaveWorkflowToCreativeLibrary?: (idea: Omit<CreativeIdea, 'id'>) => Promise<void>;
}

const PebblingCanvas: React.FC<PebblingCanvasProps> = ({ 
  onImageGenerated, 
  onBatchSaved,
  onCanvasCreated,
  onCanvasDeleted,
  creativeIdeas = [], 
  desktopItems = [],
  isActive = true,
  pendingImageToAdd,
  onPendingImageAdded,
  saveRef,
  onSaveWorkflowToCreativeLibrary,
}) => {
  // --- 画布管理状态 ---
  const [currentCanvasId, setCurrentCanvasId] = useState<string | null>(null);
  const [canvasList, setCanvasList] = useState<canvasApi.CanvasListItem[]>([]);
  const [canvasName, setCanvasName] = useState('未命名画布');
  const [isCanvasLoading, setIsCanvasLoading] = useState(false);
  const saveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastSaveRef = useRef<{ nodes: string; connections: string }>({ nodes: '', connections: '' });
  const saveCanvasRef = useRef<(() => Promise<void>) | null>(null); // 用于避免循环依赖

  // --- State ---
  const [showIntro, setShowIntro] = useState(false); // 禁用解锁动画
  const [nodes, setNodes] = useState<CanvasNode[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  
  // 自动保存状态（默认禁用，首次操作后启用）
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(false);
  
  // 未保存标记（用于提醒用户）
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  
  // Refs for State (to avoid stale closures in execution logic)
  const nodesRef = useRef<CanvasNode[]>([]);
  const connectionsRef = useRef<Connection[]>([]);

  useEffect(() => {
      nodesRef.current = nodes;
  }, [nodes]);

  useEffect(() => {
      connectionsRef.current = connections;
  }, [connections]);

  // 撤销历史：默认 5 步，可在设置中调整 1–50 步
  const DEFAULT_UNDO_STEPS = 5;
  const MAX_UNDO_STEPS = 50;
  const getMaxUndoSteps = useCallback((): number => {
    try {
      const v = parseInt(localStorage.getItem('canvas_undo_max_steps') || String(DEFAULT_UNDO_STEPS), 10);
      return Math.min(MAX_UNDO_STEPS, Math.max(1, isNaN(v) ? DEFAULT_UNDO_STEPS : v));
    } catch {
      return DEFAULT_UNDO_STEPS;
    }
  }, []);
  const historyRef = useRef<{ nodes: CanvasNode[]; connections: Connection[] }[]>([]);
  const prevNodesRef = useRef<CanvasNode[]>([]);
  const prevConnectionsRef = useRef<Connection[]>([]);
  const isFirstRunRef = useRef(true);
  const isUndoRef = useRef(false);
  const isLoadRef = useRef(false);

  // 过程记录：在 nodes/connections 变更后把上一状态压入撤销栈（排除首次、撤销、加载）
  useEffect(() => {
    if (isFirstRunRef.current) {
      isFirstRunRef.current = false;
      prevNodesRef.current = nodes;
      prevConnectionsRef.current = connections;
      return;
    }
    if (isUndoRef.current) {
      isUndoRef.current = false;
      prevNodesRef.current = nodes;
      prevConnectionsRef.current = connections;
      return;
    }
    if (isLoadRef.current) {
      isLoadRef.current = false;
      prevNodesRef.current = nodes;
      prevConnectionsRef.current = connections;
      return;
    }
    const prevNodes = prevNodesRef.current;
    const prevConnections = prevConnectionsRef.current;
    prevNodesRef.current = nodes;
    prevConnectionsRef.current = connections;
    const maxSteps = getMaxUndoSteps();
    historyRef.current.push({
      nodes: JSON.parse(JSON.stringify(prevNodes)),
      connections: JSON.parse(JSON.stringify(prevConnections)),
    });
    if (historyRef.current.length > maxSteps) historyRef.current.shift();
  }, [nodes, connections, getMaxUndoSteps]);

  const undo = useCallback(() => {
    if (historyRef.current.length === 0) return;
    const last = historyRef.current.pop()!;
    isUndoRef.current = true;
    setNodes(last.nodes);
    setConnections(last.connections);
  }, []);

  // 加载 ComfyUI 工作流列表与地址列表（画布激活时拉取，供节点下拉选择）
  useEffect(() => {
    if (!isActive) return;
    const cfg = getComfyUIConfig();
    setComfyuiAddresses(cfg.addresses || []);
    getComfyUIWorkflows().then((res) => {
      if (res.success && res.data) setComfyuiWorkflows(res.data);
    });
  }, [isActive]);

  // ComfyUI 地址列表（配置页维护，画布节点只能选择）
  const [comfyuiAddresses, setComfyuiAddresses] = useState<ComfyUIAddress[]>([]);
  
  // Canvas Transform
  const [canvasOffset, setCanvasOffset] = useState<Vec2>({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const [isDraggingCanvas, setIsDraggingCanvas] = useState(false);
  const [dragStart, setDragStart] = useState<Vec2>({ x: 0, y: 0 });
  const [isSpacePressed, setIsSpacePressed] = useState(false); // 空格键状态，用于拖拽画布
  const [isPanMode, setIsPanMode] = useState(false); // 平移模式开关

  // 右侧创意库浮动面板状态
  const [isCreativeLibraryCollapsed, setIsCreativeLibraryCollapsed] = useState(() => {
    try { return localStorage.getItem('canvas_creative_library_collapsed') === 'true'; } catch { return false; }
  });
  const [creativeLibrarySidebarWidth, setCreativeLibrarySidebarWidth] = useState(() => {
    try { return parseInt(localStorage.getItem('canvas_creative_library_width') || '280') || 280; } catch { return 280; }
  });
  const [libraryFilter, setLibraryFilter] = useState<'all' | 'bp' | 'workflow' | 'favorite'>('all');
  const [canvasLibraryHeight, setCanvasLibraryHeight] = useState<number>(() => {
    try { return parseInt(localStorage.getItem('canvas_creative_library_height') || '0') || 0; } catch { return 0; } // 0 = 自动全高
  });
  // 浮动面板位置和锁定（展开态）
  const [canvasLibraryPos, setCanvasLibraryPos] = useState<{ x: number; y: number }>(() => {
    try { const s = localStorage.getItem('canvas_library_float_pos'); return s ? JSON.parse(s) : { x: -1, y: -1 }; } catch { return { x: -1, y: -1 }; }
  });
  const [canvasLibraryLocked, setCanvasLibraryLocked] = useState<boolean>(() => {
    try { return localStorage.getItem('canvas_library_float_locked') === 'true'; } catch { return false; }
  });
  // 浮动图标位置和锁定（收起态）- 默认在右侧下方，与素材库上下摆放
  const [canvasLibraryIconPos, setCanvasLibraryIconPos] = useState<{ x: number; y: number }>(() => {
    try { const s = localStorage.getItem('canvas_library_icon_pos'); return s ? JSON.parse(s) : { x: -1, y: -1 }; } catch { return { x: -1, y: -1 }; }
  });
  const [canvasLibraryIconLocked, setCanvasLibraryIconLocked] = useState<boolean>(() => {
    try { return localStorage.getItem('canvas_library_icon_locked') === 'true'; } catch { return false; }
  });
  // 拖拽 ref
  const canvasLibDragRef = useRef<{ target: 'panel' | 'icon'; startMouse: { x: number; y: number }; startPos: { x: number; y: number } } | null>(null);

  // 素材库浮动面板状态（独立于创意文本库）
  const [isMediaLibraryCollapsed, setIsMediaLibraryCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem('canvas_media_library_collapsed') === 'true'; } catch { return false; }
  });
  const [mediaLibraryWidth, setMediaLibraryWidth] = useState<number>(() => {
    try { return parseInt(localStorage.getItem('canvas_media_library_width') || '280') || 280; } catch { return 280; }
  });
  const [mediaLibraryHeight, setMediaLibraryHeight] = useState<number>(() => {
    try { return parseInt(localStorage.getItem('canvas_media_library_height') || '0') || 0; } catch { return 0; }
  });
  const [mediaLibraryPos, setMediaLibraryPos] = useState<{ x: number; y: number }>(() => {
    try { const s = localStorage.getItem('canvas_media_library_pos'); return s ? JSON.parse(s) : { x: -1, y: 12 }; } catch { return { x: -1, y: 12 }; }
  });
  const [mediaLibraryLocked, setMediaLibraryLocked] = useState<boolean>(() => {
    try { return localStorage.getItem('canvas_media_library_locked') === 'true'; } catch { return false; }
  });
  const [mediaLibraryIconPos, setMediaLibraryIconPos] = useState<{ x: number; y: number }>(() => {
    try { const s = localStorage.getItem('canvas_media_library_icon_pos'); return s ? JSON.parse(s) : { x: -1, y: 12 }; } catch { return { x: -1, y: 12 }; }
  });
  const [mediaLibraryIconLocked, setMediaLibraryIconLocked] = useState<boolean>(() => {
    try { return localStorage.getItem('canvas_media_library_icon_locked') === 'true'; } catch { return false; }
  });
  const [mediaLibraryFilter, setMediaLibraryFilter] = useState<'all' | 'image' | 'video'>('all');
  const mediaLibDragRef = useRef<{ target: 'panel' | 'icon'; startMouse: { x: number; y: number }; startPos: { x: number; y: number } } | null>(null);
  const mediaLibResizeRef = useRef<{ edge: 'left' | 'right' | 'top' | 'bottom' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'; startMouse: { x: number; y: number }; startSize: { w: number; h: number }; startPos: { x: number; y: number } } | null>(null);
  const mediaDragStartedRef = useRef(false); // 区分点击与拖拽，避免拖拽松开后误触发点击放置

  // ComfyUI 工作流列表（供画布节点选择，与 ComfyUI Tab 配置同步）
  const [comfyuiWorkflows, setComfyuiWorkflows] = useState<ComfyUIWorkflowConfig[]>([]);

  // Node Selection & Dragging
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set<string>());
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [isDragOperation, setIsDragOperation] = useState(false); // Tracks if actual movement occurred
  
  // Refs to track dragging state for immediate save detection
  const draggingNodeIdRef = useRef<string | null>(null);
  const isDragOperationRef = useRef(false);
  
  useEffect(() => {
    draggingNodeIdRef.current = draggingNodeId;
  }, [draggingNodeId]);
  
  useEffect(() => {
    isDragOperationRef.current = isDragOperation;
  }, [isDragOperation]);
  
  // Copy/Paste Buffer
  const clipboardRef = useRef<CanvasNode[]>([]);

  // 单击连线延迟删除的 timeout（双击时取消，保留“双击在中间插入节点”）
  const connectionClickTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
      if (connectionClickTimeoutRef.current) clearTimeout(connectionClickTimeoutRef.current);
  }, []);

  // Abort Controllers for cancelling operations
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());
  const executingNodesRef = useRef<Set<string>>(new Set()); // 正在执行的节点ID集合，用于防止重复执行

  // Dragging Mathematics (Delta based)
  const [dragStartMousePos, setDragStartMousePos] = useState<Vec2>({ x: 0, y: 0 });
  const dragStartMousePosRef = useRef<Vec2>({ x: 0, y: 0 }); // ref 备份，供实时更新
  const [initialNodePositions, setInitialNodePositions] = useState<Map<string, Vec2>>(new Map());
  const initialNodePositionsRef = useRef<Map<string, Vec2>>(new Map()); // ref 同步备份，供 RAF 使用
  
  // 拖拽优化：使用 ref 存储实时偏移量，避免频繁 setState
  const dragDeltaRef = useRef<Vec2>({ x: 0, y: 0 });
  const canvasDragRef = useRef<Vec2>({ x: 0, y: 0 });
  const rafRef = useRef<number | null>(null);
  const isDraggingRef = useRef(false);
  const isCanvasDraggingRef = useRef(false);
  
  // 上次鼠标位置，用于计算画布平移时的增量
  const lastMousePosRef = useRef<Vec2>({ x: 0, y: 0 });
  
  // 缩放结束后的重绘定时器
  const zoomEndTimerRef = useRef<number | null>(null);
  
  // Ref to handleExecuteNode for use in callbacks (避免依赖循环)
  const executeNodeRef = useRef<((nodeId: string, batchCount?: number) => Promise<void>) | null>(null);
  
  // Selection Box
  const [selectionBox, setSelectionBox] = useState<{ start: Vec2, current: Vec2 } | null>(null);

  // Connection Linking
  const [linkingState, setLinkingState] = useState<{
      active: boolean;
      fromNode: string | null;
      startPos: Vec2;
      currPos: Vec2;
  }>({ active: false, fromNode: null, startPos: { x: 0, y: 0 }, currPos: { x: 0, y: 0 } });

  // 从 output/空白/连线 添加节点菜单（sourceNodeId 无则仅创建节点不连线；toNodeId+connId 有则作为中间节点插入）
  const [addNodeFromOutputMenu, setAddNodeFromOutputMenu] = useState<{
    position: Vec2;
    sourceNodeId?: string;
    toNodeId?: string;
    connId?: string;
    toPortKey?: string;
    toPortOffsetY?: number;
  } | null>(null);
  const releasedOnNodeRef = useRef(false); // 本次 mouseup 是否释放在节点上，避免误弹菜单

  // Generation Global Flag (Floating Input)
  const [isGenerating, setIsGenerating] = useState(false);
  
  // RH 任务队列
  const rhTaskQueue = useRHTaskQueue();

  // Presets & Libraries - Load from localStorage
  const [userPresets, setUserPresets] = useState<CanvasPreset[]>(() => {
    try {
      const saved = localStorage.getItem('pebbling_user_presets');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      console.error('Failed to load presets:', e);
      return [];
    }
  });

  // Save presets to localStorage whenever they change
  useEffect(() => {
    try {
      localStorage.setItem('pebbling_user_presets', JSON.stringify(userPresets));
    } catch (e) {
      console.error('Failed to save presets:', e);
    }
  }, [userPresets]);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [showPresetModal, setShowPresetModal] = useState(false);
  const [nodesForPreset, setNodesForPreset] = useState<CanvasNode[]>([]); // Buffer for preset creation
  
  // Preset Instantiation
  const [instantiatingPreset, setInstantiatingPreset] = useState<CanvasPreset | null>(null);

  // API Settings Modal
  const [showApiSettings, setShowApiSettings] = useState(false);
  const [apiConfigured, setApiConfigured] = useState(false);

  // ImageGenPanel - 浮动图片生成面板
  const [imageGenPanelNodeId, setImageGenPanelNodeId] = useState<string | null>(null);

  // 画布主题与全局主题同步（使用 ThemeContext，不再单独维护）
  const { themeName, setTheme } = useTheme();
  const isLightCanvas = themeName === 'light';

  // Check API configuration on mount
  useEffect(() => {
    setApiConfigured(isApiConfigured());
  }, []);

  // --- 画布持久化逻辑 ---
  
  // 加载画布列表
  const loadCanvasList = useCallback(async () => {
    try {
      const result = await canvasApi.getCanvasList();
      if (result.success && result.data) {
        setCanvasList(result.data);
        return result.data;
      }
    } catch (e) {
      console.error('[Canvas] 加载列表失败:', e);
    }
    return [];
  }, []);

  // 加载单个画布
  const loadCanvas = useCallback(async (canvasId: string) => {
    console.log('='.repeat(60));
    console.log('[画布切换] 开始切换到画布:', canvasId);
    
    // 🔧 关键修复1：立即清除自动保存定时器，防止在切换过程中触发保存
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      console.log('[画布切换] 已清除自动保存定时器');
    }
    
    // 🔧 关键修复2：先保存当前画布（如果有变化）
    if (currentCanvasId && currentCanvasId !== canvasId) {
      console.log('[画布切换] 💾 当前画布:', currentCanvasId.slice(0, 12));
      console.log('[画布切换] 💾 nodesRef.current.length:', nodesRef.current.length);
      console.log('[画布切换] 💾 nodesRef.current:', JSON.stringify(nodesRef.current.map(n => ({ id: n.id.slice(0, 8), type: n.type }))));
      
      // 检查是否有变化（与 lastSaveRef 比较）
      const currentNodesStr = JSON.stringify(nodesRef.current);
      const currentConnsStr = JSON.stringify(connectionsRef.current);
      const hasChanges = currentNodesStr !== lastSaveRef.current.nodes || 
                         currentConnsStr !== lastSaveRef.current.connections;
      
      if (hasChanges || nodesRef.current.length > 0) {
        console.log('[画布切换] ✅ 检测到数据，强制保存...');
        try {
          // 🔧 直接保存，不使用 ref，避免闭包陷阱
          await canvasApi.updateCanvas(currentCanvasId, {
            nodes: nodesRef.current,
            connections: connectionsRef.current,
          });
          console.log('[画布切换] ✅ 当前画布已保存');
          lastSaveRef.current = {
            nodes: currentNodesStr,
            connections: currentConnsStr
          };
          // 🆕 保存后刷新列表，更新节点数和修改时间
          await loadCanvasList();
        } catch (e) {
          console.error('[画布切换] ❌ 保存失败:', e);
        }
      } else {
        console.log('[画布切换] ⏭️ 当前画布无数据，跳过保存');
      }
    }
    
    setIsCanvasLoading(true);
    try {
      console.log('[画布切换] 📥 开始调用 canvasApi.getCanvas:', canvasId.slice(0, 12));
      const result = await canvasApi.getCanvas(canvasId);
      if (result.success && result.data) {
        let loadedNodes = result.data.nodes || [];
        const loadedConnections = result.data.connections || [];
        
        // 规范化预览节点：确保 content 与 previewItems[previewCoverIndex] 一致，便于刷新后恢复选中封面
        loadedNodes = loadedNodes.map((n: CanvasNode) => {
          if (n.type !== 'preview' || !n.data?.previewItems?.length) return n;
          const items = n.data.previewItems;
          const coverIndex = Math.min(Math.max(0, n.data.previewCoverIndex ?? 0), items.length - 1);
          const expectedContent = items[coverIndex] ?? items[0] ?? '';
          if (expectedContent && (!n.content || n.content !== expectedContent)) {
            return { ...n, content: expectedContent };
          }
          return n;
        });
        
        console.log('[画布切换] 📦 后端返回数据:', result.data.name);
        console.log('[画布切换] 📦 loadedNodes.length:', loadedNodes.length);
        console.log('[画布切换] 📦 loadedNodes:', JSON.stringify(loadedNodes.map((n: CanvasNode) => ({ id: n.id.slice(0, 8), type: n.type }))));
        
        // 🔧 关键修复3：先更新 currentCanvasId，再更新 nodes/connections
        // 这样自动保存的 useEffect 就会看到正确的 canvasId
        setCurrentCanvasId(canvasId);
        setCanvasName(result.data.name);
        
        // 🔧 关键：先清空 ref，再设置新值
        nodesRef.current = [];
        connectionsRef.current = [];
        console.log('[画布切换] 🧹 已清空 nodesRef');

        // 加载画布时不写入撤销历史
        isLoadRef.current = true;
        // 然后更新 state 和 ref
        setNodes(loadedNodes);
        setConnections(loadedConnections);
        nodesRef.current = loadedNodes;
        connectionsRef.current = loadedConnections;
        
        console.log('[画布切换] 🔄 更新后的 nodesRef.length:', nodesRef.current.length);
        console.log('[画布切换] 🔄 更新后的 nodesRef:', JSON.stringify(nodesRef.current.map(n => ({ id: n.id.slice(0, 8), type: n.type }))));
        
        // 更新缓存，防止立即触发保存
        lastSaveRef.current = {
          nodes: JSON.stringify(loadedNodes),
          connections: JSON.stringify(loadedConnections)
        };
        
        // 清除未保存标记
        setHasUnsavedChanges(false);
        
        console.log('[画布切换] ✅ 切换完成:', result.data.name);
        console.log('='.repeat(60));
        
        // 自动恢复Video节点的异步任务
        setTimeout(() => {
          recoverVideoTasks(loadedNodes);
        }, 1000); // 延迟1秒执行，确保画布已完全加载
      }
    } catch (e) {
      console.error('[画布切换] ❌ 加载画布失败:', e);
    }
    setIsCanvasLoading(false);
  }, [currentCanvasId, loadCanvasList]);

  // 创建新画布
  const createNewCanvas = useCallback(async (name?: string) => {
    console.log('[创建画布] 开始创建新画布:', name);
    
    // 🔧 关键修复：立即清除自动保存定时器
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      console.log('[创建画布] 已清除自动保存定时器');
    }
    
    // 🔧 先保存当前画布（如果有变化）
    if (currentCanvasId) {
      console.log('[创建画布] 当前画布:', currentCanvasId, '节点数:', nodesRef.current.length);
      
      const currentNodesStr = JSON.stringify(nodesRef.current);
      const currentConnsStr = JSON.stringify(connectionsRef.current);
      const hasChanges = currentNodesStr !== lastSaveRef.current.nodes || 
                         currentConnsStr !== lastSaveRef.current.connections;
      
      if (hasChanges || nodesRef.current.length > 0) {
        console.log('[创建画布] 检测到数据，强制保存...');
        try {
          // 🔧 直接保存，不使用 ref，避免闭包陷阱
          await canvasApi.updateCanvas(currentCanvasId, {
            nodes: nodesRef.current,
            connections: connectionsRef.current,
          });
          console.log('[创建画布] 当前画布已保存');
          lastSaveRef.current = {
            nodes: currentNodesStr,
            connections: currentConnsStr
          };
          // 🆕 保存后刷新列表，更新节点数和修改时间
          await loadCanvasList();
        } catch (e) {
          console.error('[创建画布] 保存失败:', e);
        }
      } else {
        console.log('[创建画布] 当前画布无数据，跳过保存');
      }
    }
    
    try {
      // 🆕 智能命名：从“画布 1”开始轮询，重名则跳过
      let finalName = name;
      if (!finalName) {
        // 刷新列表获取最新数据
        const latestList = await loadCanvasList();
        const existingNames = new Set(latestList.map(c => c.name));
        
        // 从 1 开始轮询，找到第一个未被使用的名字
        let index = 1;
        while (existingNames.has(`画布 ${index}`)) {
          index++;
        }
        finalName = `画布 ${index}`;
        console.log('[创建画布] 智能命名:', finalName);
      }
      
      const result = await canvasApi.createCanvas({ name: finalName });
      if (result.success && result.data) {
        setCurrentCanvasId(result.data.id);
        setCanvasName(result.data.name);
        isLoadRef.current = true;
        setNodes([]);
        setConnections([]);
        nodesRef.current = [];
        connectionsRef.current = [];
        lastSaveRef.current = { nodes: '[]', connections: '[]' };
        setHasUnsavedChanges(false);
        await loadCanvasList();
        console.log('[创建画布] 创建新画布完成:', result.data.name);
          
        // 通知外层创建桌面文件夹
        if (onCanvasCreated) {
          onCanvasCreated(result.data.id, result.data.name);
        }
          
        return result.data;
      }
    } catch (e) {
      console.error('[创建画布] 创建画布失败:', e);
    }
    return null;
  }, [loadCanvasList, onCanvasCreated, currentCanvasId]);

  // 保存当前画布（防抖）- 会自动将图片内容本地化到画布专属文件夹
  const saveCurrentCanvas = useCallback(async () => {
    if (!currentCanvasId) return;
    
    // 先检查是否有变化，避免无操作时重复执行本地化（含远程图片下载）
    const currentNodesStr = JSON.stringify(nodesRef.current);
    const currentConnsStr = JSON.stringify(connectionsRef.current);
    if (currentNodesStr === lastSaveRef.current.nodes && currentConnsStr === lastSaveRef.current.connections) {
      return;
    }
    
    // 获取当前画布名称
    const currentCanvas = canvasList.find(c => c.id === currentCanvasId);
    const currentCanvasName = currentCanvas?.name || canvasName;
    
    // 本地化图片内容：将base64/临时URL转换为本地文件（保存到画布专属文件夹）
    const localizedNodes = await Promise.all(nodesRef.current.map(async (node) => {
      // 预览节点：本地化 previewItems 及选中的 content，保证刷新后多图和选中封面可恢复
      if (node.type === 'preview' && node.data?.previewItems?.length) {
        const items = node.data.previewItems;
        const types = node.data.previewItemTypes;
        const coverIndex = Math.min(Math.max(0, node.data.previewCoverIndex ?? 0), items.length - 1);
        const localizedItems: string[] = [];
        for (let i = 0; i < items.length; i++) {
          const url = items[i];
          const isVideo = types?.[i] === 'video' || url.includes('.mp4') || url.startsWith('data:video');
          const isBase64 = url.startsWith('data:');
          const isTempUrl = (url.startsWith('http') || url.startsWith('//')) && !url.includes('/files/');
          let newUrl = url;
          try {
            if (isBase64 && url.startsWith('data:image')) {
              const result = await canvasApi.saveCanvasImage(url, currentCanvasName, `${node.id}_p${i}`, currentCanvasId);
              if (result?.success && result.data?.url) newUrl = result.data.url;
            } else if (isBase64 && url.startsWith('data:video')) {
              const result = await saveVideoToOutput(url, `canvas_${node.id}_p${i}_${Date.now()}.mp4`);
              if (result?.success && result.data?.url) newUrl = result.data.url;
            } else if (isTempUrl) {
              const ext = isVideo ? 'mp4' : 'png';
              const result = await downloadRemoteToOutput(url, `canvas_${node.id}_p${i}_${Date.now()}.${ext}`);
              if (result?.success && result.data?.url) newUrl = result.data.url;
            }
          } catch (e) {
            console.warn(`[Canvas] 预览项本地化失败 [${node.id.slice(0, 8)}][${i}]:`, e);
          }
          localizedItems.push(newUrl);
        }
        const newContent = localizedItems[coverIndex] ?? localizedItems[0] ?? node.content ?? '';
        return {
          ...node,
          content: newContent,
          data: { ...node.data, previewItems: localizedItems }
        };
      }

      // 只处理有图片内容的节点
      if (!node.content) return node;
      
      // 检查是否是需要本地化的内容
      const isBase64 = node.content.startsWith('data:image');
      const isTempUrl = node.content.startsWith('http') && 
                        !node.content.includes('/files/output/') && 
                        !node.content.includes('/files/input/');
      
      if (!isBase64 && !isTempUrl) {
        // 已经是本地文件URL，无需处理
        return node;
      }
      
      try {
        let result;
        if (isBase64) {
          // Base64 -> 保存到画布专属文件夹
          result = await canvasApi.saveCanvasImage(node.content, currentCanvasName, node.id, currentCanvasId);
        } else if (isTempUrl) {
          // 远程URL -> 下载到本地
          result = await downloadRemoteToOutput(node.content, `canvas_${node.id}_${Date.now()}.png`);
        }
        
        if (result?.success && result.data?.url) {
          console.log(`[Canvas] 图片已本地化: ${node.id.slice(0,8)} -> ${result.data.url}`);
          return { ...node, content: result.data.url };
        }
      } catch (e) {
        console.error(`[Canvas] 图片本地化失败:`, e);
      }
      
      return node;
    }));
    
    const nodesStr = JSON.stringify(localizedNodes);
    const connectionsStr = JSON.stringify(connectionsRef.current);
    
    // 检查是否有变化
    if (nodesStr === lastSaveRef.current.nodes && connectionsStr === lastSaveRef.current.connections) {
      return;
    }
    
    try {
      await canvasApi.updateCanvas(currentCanvasId, {
        nodes: localizedNodes,
        connections: connectionsRef.current,
      });
      
      // 更新 ref 和 state
      nodesRef.current = localizedNodes;
      setNodes(localizedNodes);
      
      lastSaveRef.current = { nodes: nodesStr, connections: connectionsStr };
      console.log('[Canvas] 自动保存');
      
      // 🆕 保存后刷新列表，更新节点数和修改时间
      await loadCanvasList();
    } catch (e) {
      console.error('[Canvas] 保存失败:', e);
    }
  }, [currentCanvasId, canvasList, canvasName, loadCanvasList]);

  // 将saveCurrentCanvas赋值给ref，供其他函数调用（避免循环依赖）
  useEffect(() => {
    saveCanvasRef.current = saveCurrentCanvas;
  }, [saveCurrentCanvas]);
  
  // 自动恢复Video节点的异步任务
  const recoverVideoTasks = useCallback(async (nodesToCheck: CanvasNode[]) => {
    const videoNodes = nodesToCheck.filter(node => 
      node.type === 'video' && 
      node.status === 'running' && 
      (node.data as any)?.videoTaskId &&
      !isValidVideo(node.content)
    );
    
    if (videoNodes.length === 0) {
      console.log('[画布恢复] 没有检测到未完成的Video任务');
      return;
    }
    
    console.log(`[画布恢复] 检测到 ${videoNodes.length} 个未完成的Video任务，开始恢复...`);
    
    // 对每个未完成的Video节点，触发执行流程（会自动进入恢复逻辑）
    for (let i = 0; i < videoNodes.length; i++) {
      const node = videoNodes[i];
      console.log(`[画布恢复] 恢复节点 ${node.id.slice(0, 8)}, taskId: ${(node.data as any)?.videoTaskId}`);
      // 触发执行，handleExecuteNode 会检测到这是恢复场景
      // 使用 executeNodeRef 来避免依赖问题
      setTimeout(() => {
        if (executeNodeRef.current) {
          executeNodeRef.current(node.id);
        }
      }, i * 500); // 每个节点间隔500ms，避免同时触发多个请求
    }
  }, []);

  // 删除画布
  const deleteCanvasById = useCallback(async (canvasId: string) => {
    try {
      console.log('[删除画布] 开始删除:', canvasId.slice(0, 12));
      
      // 🆕 先获取当前列表，确定删除后要切换到哪个画布
      const currentList = canvasList.length > 0 ? canvasList : await loadCanvasList();
      const deleteIndex = currentList.findIndex(c => c.id === canvasId);
      const isDeletingCurrent = canvasId === currentCanvasId;
      
      console.log('[删除画布] 当前列表长度:', currentList.length);
      console.log('[删除画布] 删除索引:', deleteIndex);
      console.log('[删除画布] 是否删除当前画布:', isDeletingCurrent);
      
      const result = await canvasApi.deleteCanvas(canvasId);
      if (result.success) {
        console.log('[删除画布] ✅ 后端删除成功');
        
        // 通知外层将桌面文件夹标记为已归档
        if (onCanvasDeleted) {
          onCanvasDeleted(canvasId);
        }
        
        // 刷新列表
        const updatedList = await loadCanvasList();
        console.log('[删除画布] 删除后列表长度:', updatedList.length);
        
        // 🆕 如果删除的是当前画布，需要自动切换
        if (isDeletingCurrent) {
          if (updatedList.length === 0) {
            // 没有画布了，创建新画布
            console.log('[删除画布] 没有画布了，创建新画布');
            await createNewCanvas();
          } else {
            // 🆕 有其他画布，切换到下一个（或上一个）
            let nextCanvas;
            if (deleteIndex < updatedList.length) {
              // 切换到同一位置的下一个画布
              nextCanvas = updatedList[deleteIndex];
              console.log('[删除画布] 切换到下一个画布:', nextCanvas.name);
            } else {
              // 删除的是最后一个，切换到倒数第二个
              nextCanvas = updatedList[updatedList.length - 1];
              console.log('[删除画布] 删除最后一个，切换到:', nextCanvas.name);
            }
            await loadCanvas(nextCanvas.id);
          }
        }
        
        console.log('[删除画布] ✅ 删除完成');
      }
    } catch (e) {
      console.error('[删除画布] ❌ 删除失败:', e);
    }
  }, [currentCanvasId, canvasList, loadCanvasList, createNewCanvas, loadCanvas, onCanvasDeleted]);

  // 重命名画布（同步重命名文件夹）
  const renameCanvas = useCallback(async (newName: string) => {
    if (!currentCanvasId || !newName.trim()) return;
    
    try {
      const result = await canvasApi.updateCanvas(currentCanvasId, { name: newName.trim() });
      if (result.success) {
        setCanvasName(newName.trim());
        await loadCanvasList();
        console.log('[Canvas] 画布已重命名:', newName);
      }
    } catch (e) {
      console.error('[Canvas] 重命名失败:', e);
    }
  }, [currentCanvasId, loadCanvasList]);

  // 初始化：加载最近画布或创建新画布
  useEffect(() => {
    const initCanvas = async () => {
      const list = await loadCanvasList();
      if (list.length > 0) {
        // 加载最近更新的画布
        const sorted = [...list].sort((a, b) => b.updatedAt - a.updatedAt);
        await loadCanvas(sorted[0].id);
      } else {
        // 创建第一个画布
        await createNewCanvas('画布 1');
      }
      
      // 画布初始化完成后，处理待添加的图片
      canvasInitializedRef.current = true;
      setTimeout(() => {
        processPendingImage();
      }, 200);
    };
    initCanvas();
  }, []); // 只在组件挂载时执行一次

  // 自动保存（防拖2000ms，避免拖拽时频繁触发）
  useEffect(() => {
    if (!currentCanvasId) return;
      
    // 如果自动保存被禁用，跳过
    if (!autoSaveEnabled) {
      console.log('[自动保存] 已禁用，跳过');
      return;
    }
      
    // 如果正在拖拽节点，跳过自动保存
    if (draggingNodeId || isDragOperation) {
      console.log('[自动保存] 拖拽中，跳过');
      return;
    }
      
    // 🔧 关键修复：检查当前 nodes/connections 是否与 lastSaveRef 一致
    // 如果一致，说明是刚加载的数据，不需要保存
    const currentNodesStr = JSON.stringify(nodes);
    const currentConnsStr = JSON.stringify(connections);
    if (currentNodesStr === lastSaveRef.current.nodes && 
        currentConnsStr === lastSaveRef.current.connections) {
      console.log('[自动保存] 数据未变化，跳过');
      return;
    }
      
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }
      
    saveTimerRef.current = setTimeout(() => {
      saveCurrentCanvas();
    }, 2000); // 增加防拖时间到2秒
      
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, [nodes, connections, currentCanvasId, saveCurrentCanvas, draggingNodeId, isDragOperation, autoSaveEnabled]);


  // Re-check API config when settings modal closes
  const handleCloseApiSettings = () => {
    setShowApiSettings(false);
    setApiConfigured(isApiConfigured());
  };

  const containerRef = useRef<HTMLDivElement>(null);

  // --- Utils ---
  const uuid = () => Math.random().toString(36).substr(2, 9);

  // Helper for Client-Side Resize
  const resizeImageClient = (base64Str: string, mode: 'longest' | 'shortest' | 'width' | 'height' | 'exact', widthVal: number, heightVal: number): Promise<string> => {
      return new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => {
              let currentW = img.width;
              let currentH = img.height;
              let newWidth = currentW;
              let newHeight = currentH;
              const aspectRatio = currentW / currentH;

              if (mode === 'exact') {
                  newWidth = widthVal;
                  newHeight = heightVal;
              } else if (mode === 'width') {
                  newWidth = widthVal;
                  newHeight = widthVal / aspectRatio;
              } else if (mode === 'height') {
                  newHeight = heightVal;
                  newWidth = heightVal * aspectRatio;
              } else if (mode === 'longest') {
                  const target = widthVal; // Use widthVal as the primary 'target' container
                  if (currentW > currentH) {
                      newWidth = target;
                      newHeight = target / aspectRatio;
                  } else {
                      newHeight = target;
                      newWidth = target * aspectRatio;
                  }
              } else if (mode === 'shortest') {
                  const target = widthVal; // Use widthVal as the primary 'target' container
                  if (currentW < currentH) {
                      newWidth = target;
                      newHeight = target / aspectRatio;
                  } else {
                      newHeight = target;
                      newWidth = target * aspectRatio;
                  }
              }

              const canvas = document.createElement('canvas');
              canvas.width = newWidth;
              canvas.height = newHeight;
              const ctx = canvas.getContext('2d');
              if (ctx) {
                  // High quality scaling
                  ctx.imageSmoothingEnabled = true;
                  ctx.imageSmoothingQuality = 'high';
                  ctx.drawImage(img, 0, 0, newWidth, newHeight);
                  resolve(canvas.toDataURL(base64Str.startsWith('data:image/png') ? 'image/png' : 'image/jpeg', 0.92));
              } else {
                  reject("Canvas context error");
              }
          };
          img.onerror = reject;
          img.src = base64Str;
      });
  };

  // --- Color Logic ---
  const resolveEffectiveType = useCallback((nodeId: string, visited: Set<string> = new Set()): string => {
      if (visited.has(nodeId)) return 'default';
      visited.add(nodeId);
      const node = nodes.find(n => n.id === nodeId);
      if (!node) return 'default';
      if (node.type !== 'relay') return node.type;
      const inputConnection = connections.find(c => c.toNode === nodeId);
      if (inputConnection) return resolveEffectiveType(inputConnection.fromNode, visited);
      return 'default';
  }, [nodes, connections]);

  const getLinkColor = (effectiveType: string, isSelected: boolean) => {
      if (isSelected) return '#f97316'; // Orange for selected
      switch (effectiveType) {
          case 'image': case 'edit': case 'remove-bg': case 'upscale': case 'resize': return '#3b82f6';
          case 'llm': return '#a855f7'; // Purple for LLM/Logic
          case 'text': return '#10b981'; // Emerald for Text
          case 'video': return '#eab308';
          default: return '#71717a';
      }
  };

  // --- Actions ---

  // 启用自动保存（首次操作时触发）
  const enableAutoSave = useCallback(() => {
    if (!autoSaveEnabled) {
      setAutoSaveEnabled(true);
      console.log('[自动保存] 已启用');
    }
  }, [autoSaveEnabled]);

  // 手动保存
  const handleManualSave = useCallback(async () => {
    console.log('[手动保存] 开始保存...');
    await saveCurrentCanvas();
    // 保存后清除未保存标记
    setHasUnsavedChanges(false);
    console.log('[手动保存] 保存完成');
  }, [saveCurrentCanvas]);

  // 暴露保存函数给父组件
  useEffect(() => {
    if (saveRef) {
      saveRef.current = handleManualSave;
    }
  }, [saveRef, handleManualSave]);

  // 持久化创意库浮动面板状态
  useEffect(() => { try { localStorage.setItem('canvas_creative_library_collapsed', String(isCreativeLibraryCollapsed)); } catch {} }, [isCreativeLibraryCollapsed]);
  useEffect(() => { try { localStorage.setItem('canvas_creative_library_width', String(creativeLibrarySidebarWidth)); } catch {} }, [creativeLibrarySidebarWidth]);
  useEffect(() => { try { localStorage.setItem('canvas_creative_library_height', String(canvasLibraryHeight)); } catch {} }, [canvasLibraryHeight]);
  useEffect(() => { try { localStorage.setItem('canvas_library_float_pos', JSON.stringify(canvasLibraryPos)); } catch {} }, [canvasLibraryPos]);
  useEffect(() => { try { localStorage.setItem('canvas_library_float_locked', String(canvasLibraryLocked)); } catch {} }, [canvasLibraryLocked]);
  useEffect(() => { try { localStorage.setItem('canvas_library_icon_pos', JSON.stringify(canvasLibraryIconPos)); } catch {} }, [canvasLibraryIconPos]);
  useEffect(() => { try { localStorage.setItem('canvas_library_icon_locked', String(canvasLibraryIconLocked)); } catch {} }, [canvasLibraryIconLocked]);

  // 持久化素材库浮动面板状态
  useEffect(() => { try { localStorage.setItem('canvas_media_library_collapsed', String(isMediaLibraryCollapsed)); } catch {} }, [isMediaLibraryCollapsed]);
  useEffect(() => { try { localStorage.setItem('canvas_media_library_width', String(mediaLibraryWidth)); } catch {} }, [mediaLibraryWidth]);
  useEffect(() => { try { localStorage.setItem('canvas_media_library_height', String(mediaLibraryHeight)); } catch {} }, [mediaLibraryHeight]);
  useEffect(() => { try { localStorage.setItem('canvas_media_library_pos', JSON.stringify(mediaLibraryPos)); } catch {} }, [mediaLibraryPos]);
  useEffect(() => { try { localStorage.setItem('canvas_media_library_locked', String(mediaLibraryLocked)); } catch {} }, [mediaLibraryLocked]);
  useEffect(() => { try { localStorage.setItem('canvas_media_library_icon_pos', JSON.stringify(mediaLibraryIconPos)); } catch {} }, [mediaLibraryIconPos]);
  useEffect(() => { try { localStorage.setItem('canvas_media_library_icon_locked', String(mediaLibraryIconLocked)); } catch {} }, [mediaLibraryIconLocked]);

  // 浮动面板拖拽逻辑
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!canvasLibDragRef.current) return;
      const dx = e.clientX - canvasLibDragRef.current.startMouse.x;
      const dy = e.clientY - canvasLibDragRef.current.startMouse.y;
      const newX = Math.max(0, Math.min(window.innerWidth - 60, canvasLibDragRef.current.startPos.x + dx));
      const newY = Math.max(0, Math.min(window.innerHeight - 40, canvasLibDragRef.current.startPos.y + dy));
      if (canvasLibDragRef.current.target === 'panel') setCanvasLibraryPos({ x: newX, y: newY });
      else setCanvasLibraryIconPos({ x: newX, y: newY });
    };
    const handleMouseUp = () => { canvasLibDragRef.current = null; };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => { document.removeEventListener('mousemove', handleMouseMove); document.removeEventListener('mouseup', handleMouseUp); };
  }, []);

  // 素材库浮动面板拖拽逻辑
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!mediaLibDragRef.current) return;
      const dx = e.clientX - mediaLibDragRef.current.startMouse.x;
      const dy = e.clientY - mediaLibDragRef.current.startMouse.y;
      const newX = Math.max(0, Math.min(window.innerWidth - 60, mediaLibDragRef.current.startPos.x + dx));
      const newY = Math.max(0, Math.min(window.innerHeight - 40, mediaLibDragRef.current.startPos.y + dy));
      if (mediaLibDragRef.current.target === 'panel') setMediaLibraryPos({ x: newX, y: newY });
      else setMediaLibraryIconPos({ x: newX, y: newY });
    };
    const handleMouseUp = () => { mediaLibDragRef.current = null; };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => { document.removeEventListener('mousemove', handleMouseMove); document.removeEventListener('mouseup', handleMouseUp); };
  }, []);

  // 浮动面板边缘拖拽调整大小（左/右/上/下及四角）
  type ResizeEdge = 'left' | 'right' | 'top' | 'bottom' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  const canvasLibResizeRef = useRef<{ edge: ResizeEdge; startMouse: { x: number; y: number }; startSize: { w: number; h: number }; startPos: { x: number; y: number } } | null>(null);
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!canvasLibResizeRef.current) return;
      const { edge, startMouse, startSize, startPos } = canvasLibResizeRef.current;
      const dx = e.clientX - startMouse.x;
      const dy = e.clientY - startMouse.y;
      const updateLeft = edge === 'left' || edge === 'top-left' || edge === 'bottom-left';
      const updateRight = edge === 'right' || edge === 'top-right' || edge === 'bottom-right';
      const updateTop = edge === 'top' || edge === 'top-left' || edge === 'top-right';
      const updateBottom = edge === 'bottom' || edge === 'bottom-left' || edge === 'bottom-right';
      if (updateLeft) {
        const newW = Math.max(200, Math.min(500, startSize.w - dx));
        setCreativeLibrarySidebarWidth(newW);
        setCanvasLibraryPos(prev => ({ ...prev, x: startPos.x + dx }));
      }
      if (updateRight) {
        const newW = Math.max(200, Math.min(500, startSize.w + dx));
        setCreativeLibrarySidebarWidth(newW);
      }
      if (updateTop) {
        const newH = Math.max(200, Math.min(window.innerHeight - 20, startSize.h - dy));
        setCanvasLibraryHeight(newH);
        setCanvasLibraryPos(prev => ({ ...prev, y: startPos.y + dy }));
      }
      if (updateBottom) {
        const newH = Math.max(200, Math.min(window.innerHeight - 20, startSize.h + dy));
        setCanvasLibraryHeight(newH);
      }
    };
    const handleMouseUp = () => { canvasLibResizeRef.current = null; document.body.style.cursor = ''; document.body.style.userSelect = ''; };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => { document.removeEventListener('mousemove', handleMouseMove); document.removeEventListener('mouseup', handleMouseUp); };
  }, []);

  // 素材库浮动面板边缘拖拽调整大小（左/右/上/下及四角）
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!mediaLibResizeRef.current) return;
      const { edge, startMouse, startSize, startPos } = mediaLibResizeRef.current;
      const dx = e.clientX - startMouse.x;
      const dy = e.clientY - startMouse.y;
      const updateLeft = edge === 'left' || edge === 'top-left' || edge === 'bottom-left';
      const updateRight = edge === 'right' || edge === 'top-right' || edge === 'bottom-right';
      const updateTop = edge === 'top' || edge === 'top-left' || edge === 'top-right';
      const updateBottom = edge === 'bottom' || edge === 'bottom-left' || edge === 'bottom-right';
      if (updateLeft) {
        const newW = Math.max(200, Math.min(500, startSize.w - dx));
        setMediaLibraryWidth(newW);
        setMediaLibraryPos(prev => ({ ...prev, x: startPos.x + dx }));
      }
      if (updateRight) {
        const newW = Math.max(200, Math.min(500, startSize.w + dx));
        setMediaLibraryWidth(newW);
      }
      if (updateTop) {
        const newH = Math.max(200, Math.min(window.innerHeight - 20, startSize.h - dy));
        setMediaLibraryHeight(newH);
        setMediaLibraryPos(prev => ({ ...prev, y: startPos.y + dy }));
      }
      if (updateBottom) {
        const newH = Math.max(200, Math.min(window.innerHeight - 20, startSize.h + dy));
        setMediaLibraryHeight(newH);
      }
    };
    const handleMouseUp = () => { mediaLibResizeRef.current = null; document.body.style.cursor = ''; document.body.style.userSelect = ''; };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => { document.removeEventListener('mousemove', handleMouseMove); document.removeEventListener('mouseup', handleMouseUp); };
  }, []);

  // 开始拖拽画布创意库
  const startCanvasLibDrag = useCallback((target: 'panel' | 'icon', e: React.MouseEvent, el: HTMLElement) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = el.getBoundingClientRect();
    canvasLibDragRef.current = { target, startMouse: { x: e.clientX, y: e.clientY }, startPos: { x: rect.left, y: rect.top } };
    if (target === 'panel') setCanvasLibraryPos({ x: rect.left, y: rect.top });
    else setCanvasLibraryIconPos({ x: rect.left, y: rect.top });
  }, []);

  // 开始拖拽素材库浮动面板
  const startMediaLibDrag = useCallback((target: 'panel' | 'icon', e: React.MouseEvent, el: HTMLElement) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = el.getBoundingClientRect();
    mediaLibDragRef.current = { target, startMouse: { x: e.clientX, y: e.clientY }, startPos: { x: rect.left, y: rect.top } };
    if (target === 'panel') setMediaLibraryPos({ x: rect.left, y: rect.top });
    else setMediaLibraryIconPos({ x: rect.left, y: rect.top });
  }, []);

  // 辅助：计算浮动位置 style（x=-1 用 right，y=-1 用 bottom）
  const getCanvasFloatStyle = useCallback((pos: { x: number; y: number }): React.CSSProperties => {
    const s: React.CSSProperties = { position: 'fixed', zIndex: 90 };
    if (pos.x === -1) s.right = 12; else s.left = pos.x;
    if (pos.y === -1) s.bottom = 12; else s.top = pos.y;
    return s;
  }, []);

  // 应用创意库到画布（从右侧创意库面板调用）
  const handleApplyCreativeIdea = useCallback((idea: CreativeIdea) => {
    const baseX = -canvasOffset.x / scale + 200;
    const baseY = -canvasOffset.y / scale + 100;
    
    setHasUnsavedChanges(true);

    // 画布流程保存时的日夜模式：应用到画布时同步全局主题
    if (idea.isWorkflow && idea.workflowCanvasTheme) {
      setTheme(idea.workflowCanvasTheme);
    }
    
    if (idea.isWorkflow && idea.workflowNodes && idea.workflowConnections) {
      const offsetX = canvasOffset.x + 200;
      const offsetY = canvasOffset.y + 100;
      const newNodes = idea.workflowNodes.map(n => ({
        ...n,
        id: `${n.id}_${Date.now()}`,
        x: n.x + offsetX,
        y: n.y + offsetY,
      }));
      const idMapping = new Map(idea.workflowNodes.map((n, i) => [n.id, newNodes[i].id]));
      const newConns = idea.workflowConnections.map(c => ({
        ...c,
        id: `${c.id}_${Date.now()}`,
        fromNode: idMapping.get(c.fromNode) || c.fromNode,
        toNode: idMapping.get(c.toNode) || c.toNode,
      }));
      setNodes(prev => [...prev, ...newNodes] as CanvasNode[]);
      setConnections(prev => [...prev, ...newConns]);
    } else if (idea.isBP && idea.bpFields) {
      const bpNodeId = `bp_${Date.now()}`;
      const bpNode: CanvasNode = {
        id: bpNodeId,
        type: 'bp' as NodeType,
        title: idea.title,
        content: '',
        x: baseX,
        y: baseY,
        width: 320,
        height: 300,
        data: {
          bpTemplate: {
            id: idea.id,
            title: idea.title,
            prompt: idea.prompt,
            bpFields: idea.bpFields,
            imageUrl: idea.imageUrl,
          },
          bpInputs: {},
          settings: {
            aspectRatio: idea.suggestedAspectRatio || '1:1',
            resolution: idea.suggestedResolution || '2K',
          },
        },
      };
      setNodes(prev => [...prev, bpNode]);
    } else {
      // 非BP创意：创建text节点承载提示词
      const textId = `text_${Date.now()}`;
      const textNode: CanvasNode = {
        id: textId,
        type: 'text' as NodeType,
        title: idea.title,
        content: idea.prompt,
        x: baseX,
        y: baseY,
        width: 280,
        height: 280,
        data: {},
      };
      setNodes(prev => [...prev, textNode]);
    }
  }, [canvasOffset, scale]);

  // 更新节点 settings（从 ImageGenPanel 调用）
  const handleUpdateNodeSettings = useCallback((nodeId: string, settings: { aspectRatio?: string; resolution?: string }) => {
    setNodes(prev => prev.map(n => n.id === nodeId ? { ...n, data: { ...n.data, settings } } : n));
    setHasUnsavedChanges(true);
  }, []);

  // 更新节点 prompt（从 ImageGenPanel 调用）
  const handleUpdateNodePrompt = useCallback((nodeId: string, prompt: string) => {
    setNodes(prev => prev.map(n => n.id === nodeId ? { ...n, data: { ...n.data, prompt } } : n));
    setHasUnsavedChanges(true);
  }, []);

  // 计算 ImageGenPanel 在屏幕上的位置（节点下方居中）
  const getImageGenPanelPosition = useCallback((nodeId: string) => {
    const node = nodesRef.current.find(n => n.id === nodeId);
    if (!node) return { x: 200, y: 200 };
    const screenX = (node.x + (node.width || 300) / 2) * scale + canvasOffset.x;
    const screenY = (node.y + (node.height || 300)) * scale + canvasOffset.y + 12;
    return { x: screenX, y: screenY };
  }, [scale, canvasOffset]);

  const handleResetView = () => {
    setCanvasOffset({ x: 0, y: 0 });
    setScale(1);
  };

  // 按 id 切断/删除单条连线（供单击连线和键盘 Delete 共用）
  const removeConnectionById = useCallback((connectionId: string) => {
      const connToDelete = connectionsRef.current.find(c => c.id === connectionId);
      if (!connToDelete) return;
      if (connToDelete.toPortKey) {
          const targetNode = nodesRef.current.find(n => n.id === connToDelete.toNode);
          if (targetNode?.data?.nodeInputs?.[connToDelete.toPortKey]) {
              updateNode(connToDelete.toNode, {
                  data: {
                      ...targetNode.data,
                      nodeInputs: {
                          ...targetNode.data.nodeInputs,
                          [connToDelete.toPortKey]: '' // 清空参数值
                      }
                  }
              });
          }
      }
      setConnections(prev => prev.filter(c => c.id !== connectionId));
      if (selectedConnectionId === connectionId) setSelectedConnectionId(null);
      setHasUnsavedChanges(true); // 标记未保存
  }, [selectedConnectionId]);

  const deleteSelection = useCallback(() => {
      // 1. Delete Nodes
      if (selectedNodeIds.size > 0) {
          const idsToDelete = new Set<string>(selectedNodeIds);
          setNodes(prev => prev.filter(n => !idsToDelete.has(n.id)));
          setConnections(prev => prev.filter(c => !idsToDelete.has(c.fromNode) && !idsToDelete.has(c.toNode)));
          setSelectedNodeIds(new Set<string>());
          setHasUnsavedChanges(true); // 标记未保存
      }
      // 2. Delete Connection（复用单条切断逻辑）
      if (selectedConnectionId) {
          removeConnectionById(selectedConnectionId);
      }
  }, [selectedNodeIds, selectedConnectionId, removeConnectionById]);

  const handleCopy = useCallback(() => {
      if (selectedNodeIds.size === 0) return;
      const nodesToCopy = nodesRef.current.filter(n => selectedNodeIds.has(n.id));
      // Store deep copy
      clipboardRef.current = JSON.parse(JSON.stringify(nodesToCopy));
  }, [selectedNodeIds]);

  const handlePaste = useCallback(() => {
      if (clipboardRef.current.length === 0) return;
      
      const newNodes: CanvasNode[] = [];
      const idMap = new Map<string, string>(); // Old ID -> New ID

      // Create new nodes
      clipboardRef.current.forEach(node => {
          const newId = uuid();
          idMap.set(node.id, newId);
          newNodes.push({
              ...node,
              id: newId,
              x: node.x + 50, // Offset
              y: node.y + 50,
              status: 'idle' // Reset status
          });
      });

      setNodes(prev => [...prev, ...newNodes]);
      setSelectedNodeIds(new Set(newNodes.map(n => n.id)));
      setHasUnsavedChanges(true); // 标记未保存
  }, []);

  // Global Key Listener - 只在画布活动时生效
  useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
          // 空格键跟踪（仅在画布活动时）
          if (isActive && e.code === 'Space' && !e.repeat) {
              const tag = document.activeElement?.tagName.toLowerCase();
              if (tag !== 'input' && tag !== 'textarea') {
                  setIsSpacePressed(true);
                  // 记录按下空格时的鼠标位置
                  lastMousePosRef.current = { x: 0, y: 0 }; // 将在下次 mousemove 更新
              }
          }
          
          // 如果画布不活动，不响应任何快捷键
          if (!isActive) return;
          
          // 其他快捷键只在画布生效
          const tag = document.activeElement?.tagName.toLowerCase();
          if (tag === 'input' || tag === 'textarea') return;

          if (e.key === 'Delete' || e.key === 'Backspace') {
              e.preventDefault();
              deleteSelection();
          }

          if (e.ctrlKey || e.metaKey) {
              if (e.key === 'z') {
                  e.preventDefault();
                  undo();
              }
              if (e.key === 'c') {
                  e.preventDefault();
                  handleCopy();
              }
              if (e.key === 'v') {
                  e.preventDefault();
                  handlePaste();
              }
              if (e.key === 'a') {
                  // Ctrl+A 选中所有节点
                  e.preventDefault();
                  setSelectedNodeIds(new Set(nodesRef.current.map(n => n.id)));
              }
          }
      };
      
      const handleKeyUp = (e: KeyboardEvent) => {
          if (e.code === 'Space') {
              setIsSpacePressed(false);
          }
      };
      
      // 监听自定义的 sidebar-drag-end 事件（鼠标模拟拖拽）
      const handleSidebarDragEnd = (e: Event) => {
          const detail = (e as CustomEvent).detail;
          console.log('[Canvas] sidebar-drag-end received:', detail);
          
          const container = containerRef.current;
          if (!container) return;
          
          const rect = container.getBoundingClientRect();
          const x = (detail.x - rect.left - canvasOffset.x) / scale - 150;
          const y = (detail.y - rect.top - canvasOffset.y) / scale - 100;
          
          if (detail.type && ['image', 'text', 'video', 'llm', 'relay', 'edit', 'remove-bg', 'upscale', 'resize', 'bp', 'runninghub', 'rh-config', 'drawing-board', 'comfyui', 'comfy-config'].includes(detail.type)) {
              console.log('[Canvas] 创建节点:', detail.type, '位置:', x, y);
              addNode(detail.type, '', { x, y });
          }
      };
      
      window.addEventListener('keydown', handleKeyDown);
      window.addEventListener('keyup', handleKeyUp);
      window.addEventListener('sidebar-drag-end', handleSidebarDragEnd);
      
      return () => {
          window.removeEventListener('keydown', handleKeyDown);
          window.removeEventListener('keyup', handleKeyUp);
          window.removeEventListener('sidebar-drag-end', handleSidebarDragEnd);
      };
  }, [deleteSelection, handleCopy, handlePaste, canvasOffset, scale, isActive, undo]);

  // Wheel event handler for zooming
  const onWheel = useCallback((e: WheelEvent) => {
      // 🔧 检查事件源是否在文本类节点内，如果是则不缩放画布，让内容自然滚动
      const target = e.target as HTMLElement;
      // 检查是否在 textarea/文本容器内，或者父元素有 scrollable 类
      const isInTextArea = target.tagName === 'TEXTAREA' || 
                           target.tagName === 'INPUT' ||
                           target.closest('.overflow-y-auto') !== null ||
                           target.closest('.scrollbar-hide') !== null ||
                           target.closest('[data-scrollable]') !== null;
      
      if (isInTextArea) {
          // 不阻止默认行为，让内容自然滚动
          return;
      }
      
      // Wheel = Zoom centered on cursor
      e.preventDefault(); 

      // 使用更平滑的缩放灵敏度
      const zoomSensitivity = 0.002;
      const rawDelta = -e.deltaY * zoomSensitivity;
      
      // 限制单次缩放幅度，避免跳跃
      const delta = Math.max(-0.15, Math.min(0.15, rawDelta));
      const newScale = Math.min(Math.max(0.1, scale * (1 + delta)), 5);

      // Calculate Zoom towards Mouse Position
      const container = containerRef.current;
      if (!container) {
          setScale(newScale);
          return;
      }
      
      const rect = container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      // Math: NewOffset = Mouse - ((Mouse - OldOffset) / OldScale) * NewScale
      const newOffsetX = mouseX - ((mouseX - canvasOffset.x) / scale) * newScale;
      const newOffsetY = mouseY - ((mouseY - canvasOffset.y) / scale) * newScale;

      // 使用 RAF 确保平滑更新
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
          setScale(newScale);
          setCanvasOffset({ x: newOffsetX, y: newOffsetY });
      });
  }, [scale, canvasOffset]);

  // 添加原生 wheel 事件监听器（非被动模式）
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    
    container.addEventListener('wheel', onWheel as any, { passive: false });
    
    return () => {
      container.removeEventListener('wheel', onWheel as any);
    };
  }, [onWheel]);

  const addNode = (type: NodeType, content: string = '', position?: Vec2, title?: string, data?: NodeData) => {
      const container = containerRef.current;
      let x, y;

      // 节点尺寸预计算
      let width = 300; let height = 200;
      if (type === 'image') { 
          width = 300; 
          height = 300; 
          if (data?.settings?.aspectRatio && data.settings.aspectRatio !== 'AUTO') {
              const [w, h] = data.settings.aspectRatio.split(':').map(Number);
              if (w && h) {
                  height = (width * h) / w;
              }
          }
      }
      if (type === 'video') { width = 400; height = 225; }
      if (type === 'relay') { width = 40; height = 40; }
      if (['edit', 'remove-bg', 'upscale', 'llm', 'resize'].includes(type)) { width = 280; height = 250; }
      if (type === 'llm') { width = 320; height = 300; }
      // RunningHub 节点（输入 ID 的节点）
      if (type === 'runninghub') { width = 280; height = 180; }
      if (type === 'comfyui') { width = 380; height = 260; }
      if (type === 'comfy-config') { width = 320; height = 280; }
      // RH-Main 节点（封面主节点）
      if (type === 'rh-main') { width = 280; height = 280; }
      // RH-Param 节点（独立参数 Ticket）
      if (type === 'rh-param') { width = 280; height = 56; }
      // 画板节点需要更大的尺寸（约4个图片节点大小）
      if (type === 'drawing-board') { width = 800; height = 700; }
      if (type === 'preview') { width = 320; height = 320; }

      if (position) {
          x = position.x;
          y = position.y;
      } else {
          // 计算当前视野范围（画布坐标系）
          const viewWidth = container ? container.clientWidth : window.innerWidth;
          const viewHeight = container ? container.clientHeight : window.innerHeight;
          
          // 视野在画布坐标系中的范围
          const viewLeft = -canvasOffset.x / scale;
          const viewTop = -canvasOffset.y / scale;
          const viewRight = viewLeft + viewWidth / scale;
          const viewBottom = viewTop + viewHeight / scale;
          
          // 视野中心
          const viewCenterX = (viewLeft + viewRight) / 2;
          const viewCenterY = (viewTop + viewBottom) / 2;
          
          const currentNodes = nodesRef.current.length > 0 ? nodesRef.current : nodes;
          
          // 检查位置是否与现有节点重叠
          const isOverlapping = (px: number, py: number, pw: number, ph: number) => {
              return currentNodes.some(n => {
                  const margin = 20;
                  return !(px + pw + margin < n.x || px > n.x + n.width + margin ||
                           py + ph + margin < n.y || py > n.y + n.height + margin);
              });
          };
          
          // 在视野内寻找空白位置（从中心开始螺旋向外搜索）
          const findEmptySpot = (): { x: number, y: number } => {
              // 先尝试视野中心
              let testX = viewCenterX - width / 2;
              let testY = viewCenterY - height / 2;
              
              if (!isOverlapping(testX, testY, width, height)) {
                  return { x: testX, y: testY };
              }
              
              // 螺旋搜索空白位置
              const step = 80;
              for (let radius = 1; radius <= 20; radius++) {
                  for (let angle = 0; angle < 360; angle += 30) {
                      const rad = (angle * Math.PI) / 180;
                      testX = viewCenterX + Math.cos(rad) * radius * step - width / 2;
                      testY = viewCenterY + Math.sin(rad) * radius * step - height / 2;
                      
                      // 确保在视野内
                      if (testX >= viewLeft && testX + width <= viewRight &&
                          testY >= viewTop && testY + height <= viewBottom) {
                          if (!isOverlapping(testX, testY, width, height)) {
                              return { x: testX, y: testY };
                          }
                      }
                  }
              }
              
              // 找不到空白位置，放在视野右侧
              return { x: viewRight - width - 50, y: viewCenterY - height / 2 };
          };
          
          const spot = findEmptySpot();
          x = spot.x;
          y = spot.y;
      }

      const baseData = data || {};
      // 为新 image 节点设置默认 settings（比例/分辨率）
      if (type === 'image' && !(baseData as any).settings) {
          (baseData as any).settings = { aspectRatio: 'Auto', resolution: '2K' };
      }
      if (type === 'comfyui' && baseData.comfyBaseUrl == null) {
          const cfg = getComfyUIConfig();
          (baseData as Record<string, unknown>).comfyBaseUrl = cfg.baseUrl || 'http://127.0.0.1:8188';
      }
      const newNode: CanvasNode = {
          id: uuid(),
          type,
          content,
          x,
          y,
          width,
          height,
          title,
          data: baseData,
          status: 'idle'
      };
      setNodes(prev => [...prev, newNode]);
      setHasUnsavedChanges(true); // 标记未保存
      
      return newNode;
  };

  // 点击素材库项在画布上放置节点（与创意文本库点击放置一致）
  const handleApplyMediaItem = useCallback((type: 'image' | 'video-output', url: string, name?: string) => {
    const baseX = -canvasOffset.x / scale + 200;
    const baseY = -canvasOffset.y / scale + 100;
    setHasUnsavedChanges(true);
    addNode(type, url, { x: baseX, y: baseY }, name);
  }, [canvasOffset, scale]);

  // 处理从桌面添加图片到画布 - 使用 ref 避免闭包问题
  const pendingImageRef = useRef<{ imageUrl: string; imageName?: string } | null>(null);
  const canvasInitializedRef = useRef(false); // 标记画布是否已初始化
  
  useEffect(() => {
    pendingImageRef.current = pendingImageToAdd || null;
    
    // 如果画布已初始化且有待添加的图片，直接处理
    if (canvasInitializedRef.current && pendingImageToAdd) {
      setTimeout(() => {
        processPendingImage();
      }, 100);
    }
  }, [pendingImageToAdd]);
  
  // 处理待添加的图片/视频（在画布初始化完成后调用）
  const processPendingImage = useCallback(() => {
    const pending = pendingImageRef.current;
    if (!pending) return;
    
    console.log('[Canvas] 处理待添加的内容:', pending.imageName);
    
    // 🔧 检测是视频还是图片
    const isVideo = pending.imageUrl.includes('.mp4') || pending.imageUrl.includes('.webm') || pending.imageUrl.startsWith('data:video');
    
    if (isVideo) {
      // 添加视频节点
      console.log('[Canvas] 添加视频节点');
      addNode('video-output', pending.imageUrl, undefined, pending.imageName || '视频');
    } else {
      // 添加图片节点
      addNode('image', pending.imageUrl, undefined, pending.imageName);
    }
    
    // 通知父组件内容已添加
    onPendingImageAdded?.();
    pendingImageRef.current = null;
  }, [onPendingImageAdded]);

  // 🔧 修复竞态条件：使用函数式更新确保状态一致性
  const updateNode = useCallback((id: string, updates: Partial<CanvasNode>) => {
      // 先同步更新 ref，确保级联执行时能立即获取最新状态
      nodesRef.current = nodesRef.current.map(n => 
          n.id === id ? { ...n, ...updates } : n
      );
      
      // 使用函数式更新，确保基于最新状态
      setNodes(prev => prev.map(n => 
          n.id === id ? { ...n, ...updates } : n
      ));
  }, []);

  // --- EXECUTION LOGIC ---

  // Helper: 检查是否是有效图片
  const isValidImage = (content: string | undefined): boolean => {
      if (!content) return false;
      return (
          content.startsWith('data:image') || 
          content.startsWith('http://') || 
          content.startsWith('https://') ||
          content.startsWith('//') ||
          content.startsWith('/files/') ||
          content.startsWith('/api/')
      );
  };
  
  // Helper: 下载视频并保存（通过后端代理，绕过CORS，节省浏览器内存）
  // 当 returnUrlOnly 为 true 时只返回本地 URL，不更新节点（用于预览节点批量收集）
  const downloadAndSaveVideo = async (videoUrl: string, nodeId: string, signal: AbortSignal, returnUrlOnly?: boolean): Promise<string | undefined> => {
      console.log('[Video节点] 视频生成成功, 开始后端代理下载:', videoUrl);
      
      try {
          const response = await fetch('/api/files/download-remote-video', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ videoUrl })
          });
          
          if (!response.ok) {
              const errorData = await response.json().catch(() => ({}));
              throw new Error(errorData.error || `后端下载失败: ${response.status}`);
          }
          
          const result = await response.json();
          
          if (!result.success || !result.data?.url) {
              throw new Error(result.error || '后端返回数据异常');
          }
          
          if (signal.aborted) {
              console.log('[Video节点] 下载后检测到中断');
              return undefined;
          }
          
          const localVideoUrl = result.data.url;
          console.log('[Video节点] 视频已保存到本地:', result.data.filename);
          
          if (returnUrlOnly) {
              return localVideoUrl;
          }
          
          updateNode(nodeId, { 
              content: localVideoUrl, 
              status: 'completed',
              data: { 
                  ...nodesRef.current.find(n => n.id === nodeId)?.data, 
                  videoTaskId: undefined,
                  videoTaskStatus: undefined,
                  videoProgress: undefined,
                  videoFailReason: undefined
              }
          });
          
          saveCurrentCanvas();
          if (onImageGenerated) {
              setTimeout(() => {
                  onImageGenerated(localVideoUrl, '视频生成结果', currentCanvasId || undefined, canvasName);
              }, 500);
          }
          console.log('[Video节点] 视频处理完成');
          return localVideoUrl;
      } catch (downloadErr) {
          console.error('[Video节点] 后端代理下载失败:', downloadErr);
          if (!signal.aborted && !returnUrlOnly) {
              updateNode(nodeId, { 
                  status: 'error',
                  data: { 
                      ...nodesRef.current.find(n => n.id === nodeId)?.data, 
                      videoTaskId: undefined,
                      videoFailReason: `下载失败: ${downloadErr instanceof Error ? downloadErr.message : String(downloadErr)}`,
                      videoUrl: videoUrl
                  }
              });
              saveCurrentCanvas();
          }
          return undefined;
      }
  };

  // Helper: Recursive Input Resolution - 向上追溯获取输入
  // 就近原则：收集沿途的文本，一旦找到图片就停止这条路径的回溯
  // 例如：图1→文1→图2→文2→图3(RUN) → 结果: images=[图2], texts=[文2]
  const resolveInputs = (nodeId: string, visited = new Set<string>()): { images: string[], texts: string[] } => {
      if (visited.has(nodeId)) return { images: [], texts: [] };
      visited.add(nodeId);

      // Find connections pointing to this node
      const inputConnections = connectionsRef.current.filter(c => c.toNode === nodeId);
      // Find the nodes
      const inputNodes = inputConnections
          .map(c => nodesRef.current.find(n => n.id === c.fromNode))
          .filter((n): n is CanvasNode => !!n);
      
      // Sort by Y for deterministic order
      inputNodes.sort((a, b) => a.y - b.y);

      let images: string[] = [];
      let texts: string[] = [];

      for (const node of inputNodes) {
          let foundImageInThisPath = false;
          
          // 根据节点类型收集输出
          if (node.type === 'image') {
              // 检查这个 Image 节点是否有上游连接（判断是否为容器节点）
              const hasUpstream = connectionsRef.current.some(c => c.toNode === node.id);
              
              console.log(`[resolveInputs] Image节点 ${node.id.slice(0,8)}:`, {
                  hasUpstream,
                  status: node.status,
                  hasContent: isValidImage(node.content),
                  contentPreview: node.content?.slice(0, 50)
              });
              
              // 如果是容器节点（有上游），必须 status === 'completed' 才能使用其 content
              // 如果是源节点（无上游，用户上传的图片），直接使用 content
              if (hasUpstream) {
                  // 容器节点：必须已完成才能使用
                  if (node.status === 'completed' && isValidImage(node.content)) {
                      console.log(`[resolveInputs] ✅ 容器节点已完成，收集图片`);
                      images.push(node.content);
                      foundImageInThisPath = true;
                  } else {
                      console.log(`[resolveInputs] ⚠️ 容器节点未完成或无图片，继续向上追溯`);
                  }
              } else {
                  // 源节点：直接使用（用户上传的图片）
                  if (isValidImage(node.content)) {
                      console.log(`[resolveInputs] ✅ 源节点有图片，收集`);
                      images.push(node.content);
                      foundImageInThisPath = true;
                  }
              }
          } else if (node.type === 'text') {
              // 文本节点：输入=文本，输出=文本
              // 文本可以为空，但不管有没有内容，都不应该向上追溯找图片
              if (node.content) {
                  texts.push(node.content);
              }
              // 文本节点的输入输出都是文本，不可能有图片，停止这条路径
              foundImageInThisPath = true;
          } else if (node.type === 'llm') {
              // LLM节点：输入=图片+文本，输出=文本
              // LLM 上游的图片是给 LLM 用的，不是给下游节点的
              if (node.data?.output && node.status === 'completed') {
                  texts.push(node.data.output);
              }
              // 不管 LLM 有没有完成，都不应该追溯它的上游图片
              foundImageInThisPath = true;
          } else if (node.type === 'relay') {
              // 转接器：什么进来什么出去，透传上游数据
              // 不停止，继续向上追溯
          } else if (node.type === 'video' || node.type === 'video-output' || node.type === 'frame-extractor') {
              // 视频节点/帧提取器：输入=视频，输出=视频/图片
              // 不提供图片或文本输出（图片在下游Image节点），停止追溯
              foundImageInThisPath = true;
          } else if (node.type === 'edit') {
              // Magic节点：输入=图片或文字，输出=图片
              // Magic 的输出在下游创建的 Image 节点中，不在自身
              // 如果有人直接连接到 Magic，不应该追溯它的上游（那是 Magic 的输入）
              if (node.data?.output && node.status === 'completed' && isValidImage(node.data.output)) {
                  images.push(node.data.output);
              }
              // 不管有没有输出，都停止追溯
              foundImageInThisPath = true;
          } else if (node.type === 'remove-bg' || node.type === 'upscale' || node.type === 'resize') {
              // 工具节点：输入=图片，输出=图片
              // 输出在下游创建的 Image 节点中，不在自身
              // 不应该追溯它们的上游（那是工具节点的输入）
              foundImageInThisPath = true;
          } else if (node.type === 'bp') {
              // BP节点：优先从 data.output 获取（有下游连接时），否则从 content 获取
              const bpOutput = node.data?.output;
              if (node.status === 'completed') {
                  if (bpOutput && isValidImage(bpOutput)) {
                      images.push(bpOutput);
                      foundImageInThisPath = true;
                  } else if (isValidImage(node.content)) {
                      images.push(node.content);
                      foundImageInThisPath = true;
                  }
              }
          } else if (node.type === 'comfyui' || node.type === 'comfy-config') {
              // ComfyUI 节点：执行完成后输出在 data.outputImages
              if (node.status === 'completed' && node.data?.outputImages?.length) {
                  node.data.outputImages.forEach((url: string) => {
                      if (isValidImage(url)) images.push(url);
                  });
                  foundImageInThisPath = true;
              }
          } else if (node.type === 'preview') {
              // 预览节点：输出为当前选中的封面（用户未选则默认第一张）
              if (node.content && (isValidImage(node.content) || isValidVideo(node.content))) {
                  images.push(node.content);
              }
              foundImageInThisPath = true;
          }
          // relay 节点没有自身输出，继续传递

          // 就近原则：只有当这条路径还没找到图片时，才继续向上追溯
          if (!foundImageInThisPath) {
              const child = resolveInputs(node.id, new Set(visited));
              images.push(...child.images);
              texts.push(...child.texts);
          }
      }
      return { images, texts };
  };

  /** 可灵 O1：解析直接连入的图片/视频上游，返回有序的 images、videos、items（含节点名称），不递归。按连接顺序排列，新加入的素材在后面。约束：至多 7 张图或 1 视频+4 张图。 */
  const resolveInputsForKlingO1 = (nodeId: string): { images: string[]; videos: string[]; items: KlingO1InputItem[] } => {
      const inputConnections = connectionsRef.current.filter(c => c.toNode === nodeId);
      const inputNodes = inputConnections
          .map(c => nodesRef.current.find(n => n.id === c.fromNode))
          .filter((n): n is CanvasNode => !!n);
      // 保持连接顺序：先连的在前，后连的（新加入的）在后，不按 Y 排序

      const images: string[] = [];
      const videos: string[] = [];
      const items: KlingO1InputItem[] = [];

      for (const node of inputNodes) {
          if (node.type === 'image') {
              const hasUpstream = connectionsRef.current.some(c => c.toNode === node.id);
              const valid = hasUpstream
                  ? (node.status === 'completed' && isValidImage(node.content))
                  : isValidImage(node.content);
              if (valid && node.content) {
                  images.push(node.content);
                  items.push({ type: 'image', nodeId: node.id, title: node.title || '图片', url: node.content });
              }
          } else if (node.type === 'video-output' || node.type === 'video') {
              const videoUrl = node.content && isValidVideo(node.content) ? node.content : (node.data?.videoUrl ?? node.data?.outputVideos?.[0]);
              if (videoUrl && typeof videoUrl === 'string') {
                  videos.push(videoUrl);
                  items.push({ type: 'video', nodeId: node.id, title: node.title || '视频', url: videoUrl });
              }
          } else if (node.type === 'frame-extractor') {
              if (node.content && isValidImage(node.content)) {
                  images.push(node.content);
                  items.push({ type: 'image', nodeId: node.id, title: node.title || '帧', url: node.content });
              }
          }
      }

      return { images, videos, items };
  };

  // --- 多图：批量保存到 output 子文件夹，完成后走 onBatchSaved 或 onImageGenerated（封面） ---
  const saveBatchToDesktopFolder = useCallback(async (
      contents: string[],
      coverIndex: number,
      label: string,
      isVideo: boolean = false,
  ) => {
      if (!contents.length) return;
      if (!onImageGenerated && !onBatchSaved) return;

      const MAX_RETRIES = 3;
      const RETRY_DELAY_MS = 1500;
      const timestamp = new Date().toISOString().replace(/[:.T]/g, '-').slice(0, 19);
      const safeLabel = label.replace(/[<>:"\/\\|?*]/g, '_').trim().slice(0, 20) || '生成';
      const subFolder = `batch_${safeLabel}_${timestamp}`;
      const items: BatchSaveItem[] = contents.map((content, i) => ({
          data: content,
          filename: isVideo ? `${i + 1}_${Date.now()}.mp4` : `${i + 1}_${Date.now()}.png`,
          isVideo,
      }));

      const saveWithRetry = async (): Promise<{ savedUrls: string[]; coverUrl: string }> => {
          for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
              try {
                  const result = await saveBatchToOutput(items, subFolder, coverIndex);
                  if (result.success && result.data) {
                      const savedUrls = (result.data.results || [])
                          .filter(r => r.success && r.data?.url)
                          .map(r => r.data!.url);
                      const clampedCover = Math.min(Math.max(0, coverIndex), Math.max(0, savedUrls.length - 1));
                      const coverUrl = savedUrls[clampedCover] || savedUrls[0] || '';
                      return { savedUrls, coverUrl };
                  }
                  throw new Error(result.error || '保存返回失败');
              } catch (err) {
                  console.warn(`[批量保存] 第${attempt}次尝试失败:`, err);
                  if (attempt < MAX_RETRIES) await new Promise(r => setTimeout(r, RETRY_DELAY_MS * attempt));
              }
          }
          return { savedUrls: [], coverUrl: '' };
      };

      saveWithRetry().then(({ savedUrls }) => {
          if (savedUrls.length === 0) return;
          const batchLabel = `📁 ${safeLabel} (${savedUrls.length}张)`;
          if (onBatchSaved) {
              onBatchSaved({
                  label: batchLabel,
                  imageUrls: savedUrls,
                  coverIndex,
                  canvasId: currentCanvasId || undefined,
                  canvasName,
                  isVideo,
              });
          } else if (onImageGenerated) {
              const coverUrl = savedUrls[Math.min(coverIndex, savedUrls.length - 1)] || savedUrls[0];
              onImageGenerated(coverUrl, batchLabel, currentCanvasId || undefined, canvasName, isVideo);
          }
      }).catch(err => console.error('[批量保存] 异步保存异常:', err));
  }, [onImageGenerated, onBatchSaved, currentCanvasId, canvasName]);

  // --- 批量生成：先创建 N 个 image 节点并执行，全部完成后合并为一个预览节点 ---
  const handleBatchExecute = async (sourceNodeId: string, sourceNode: CanvasNode, count: number) => {
      updateNode(sourceNodeId, { status: 'running' });
      const inputs = resolveInputs(sourceNodeId);
      const combinedPrompt = inputs.texts.join('\n') || sourceNode.data?.prompt || '';
      const inputImages = inputs.images;
      let imageSource: string[] = inputImages.length > 0 ? inputImages : (isValidImage(sourceNode.content) ? [sourceNode.content] : []);
      const hasPrompt = !!combinedPrompt;
      const hasImage = imageSource.length > 0;
      if (!hasPrompt && !hasImage) {
          updateNode(sourceNodeId, { status: 'idle' });
          return;
      }

      const resultNodeIds: string[] = [];
      const newNodes: CanvasNode[] = [];
      const newConnections: Connection[] = [];
      const baseX = sourceNode.x + sourceNode.width + 150;
      const nodeHeight = 300;
      const gap = 20;
      const totalHeight = count * nodeHeight + (count - 1) * gap;
      const startY = sourceNode.y + (sourceNode.height / 2) - (totalHeight / 2);

      for (let i = 0; i < count; i++) {
          const newId = uuid();
          resultNodeIds.push(newId);
          newNodes.push({
              id: newId,
              type: 'image',
              title: `结果 ${i + 1}`,
              content: '',
              x: baseX,
              y: startY + i * (nodeHeight + gap),
              width: 280,
              height: nodeHeight,
              status: 'running',
              data: { prompt: combinedPrompt, settings: sourceNode.data?.settings }
          });
          newConnections.push({ id: uuid(), fromNode: sourceNodeId, toNode: newId });
      }
      setNodes(prev => [...prev, ...newNodes]);
      setConnections(prev => [...prev, ...newConnections]);
      nodesRef.current = [...nodesRef.current, ...newNodes];
      connectionsRef.current = [...connectionsRef.current, ...newConnections];
      setHasUnsavedChanges(true);

      const execPromises = resultNodeIds.map(async (nodeId, index) => {
          const abortController = new AbortController();
          abortControllersRef.current.set(nodeId, abortController);
          const signal = abortController.signal;
          try {
              let result: string | null = null;
              const aspectRatio = sourceNode.data?.settings?.aspectRatio || 'AUTO';
              const resolution = sourceNode.data?.settings?.resolution || '1K';
              if (hasPrompt && !hasImage) {
                  result = await generateCreativeImage(combinedPrompt, aspectRatio !== 'AUTO' ? { aspectRatio, resolution } : { aspectRatio: '1:1', resolution }, signal);
              } else if (hasPrompt && hasImage) {
                  const config = aspectRatio === 'AUTO' ? (resolution !== 'AUTO' && resolution !== '1K' ? { resolution } : undefined) : { aspectRatio, resolution: resolution !== 'AUTO' ? resolution : '1K' };
                  result = await editCreativeImage(imageSource, combinedPrompt, config, signal);
              } else {
                  result = imageSource[0];
              }
              if (!signal.aborted) {
                  updateNode(nodeId, { content: result || '', status: result ? 'completed' : 'error' });
                  // 与单张逻辑一致：每生成一张就保存到素材库一张
                  if (result && onImageGenerated) onImageGenerated(result, combinedPrompt, currentCanvasId || undefined, canvasName);
              }
          } catch (err) {
              if (!signal.aborted) updateNode(nodeId, { status: 'error' });
          } finally {
              abortControllersRef.current.delete(nodeId);
          }
      });
      await Promise.all(execPromises);

      const contents = resultNodeIds.map(id => nodesRef.current.find(n => n.id === id)?.content).filter((c): c is string => !!c && (isValidImage(c) || isValidVideo(c)));
      setNodes(prev => prev.filter(n => !resultNodeIds.includes(n.id)));
      setConnections(prev => prev.filter(c => !resultNodeIds.includes(c.toNode)));
      nodesRef.current = nodesRef.current.filter(n => !resultNodeIds.includes(n.id));
      connectionsRef.current = connectionsRef.current.filter(c => !resultNodeIds.includes(c.toNode));

      if (contents.length <= 1) {
          const singleNodeId = uuid();
          const singleNode: CanvasNode = {
              id: singleNodeId,
              type: 'image',
              title: '结果',
              content: contents[0] || '',
              x: baseX,
              y: sourceNode.y,
              width: 280,
              height: nodeHeight,
              status: contents.length > 0 ? 'completed' : 'error',
              data: { prompt: combinedPrompt, settings: sourceNode.data?.settings }
          };
          const singleConn: Connection = { id: uuid(), fromNode: sourceNodeId, toNode: singleNodeId };
          setNodes(prev => [...prev, singleNode]);
          setConnections(prev => [...prev, singleConn]);
          nodesRef.current = [...nodesRef.current, singleNode];
          connectionsRef.current = [...connectionsRef.current, singleConn];
          // 单张结果同步到桌面
          if (contents[0] && onImageGenerated) onImageGenerated(contents[0], combinedPrompt, currentCanvasId || undefined, canvasName);
      } else {
          const previewNodeId = uuid();
          const previewNode: CanvasNode = {
              id: previewNodeId,
              type: 'preview',
              title: '预览',
              content: contents[0] || '',
              x: baseX,
              y: sourceNode.y,
              width: 320,
              height: 320,
              status: 'completed',
              data: { previewItems: contents, previewCoverIndex: 0, previewExpectedCount: count }
          };
          const previewConn: Connection = { id: uuid(), fromNode: sourceNodeId, toNode: previewNodeId };
          setNodes(prev => [...prev, previewNode]);
          setConnections(prev => [...prev, previewConn]);
          nodesRef.current = [...nodesRef.current, previewNode];
          connectionsRef.current = [...connectionsRef.current, previewConn];
          // 多图与单张逻辑一致：已在上面每生成一张时通过 onImageGenerated 保存到素材库，此处不再批量保存
          console.log(`[批量生成] 全部完成，已合并为预览节点共 ${contents.length} 张（每张已单独保存到素材库）`);
      }
      updateNode(sourceNodeId, { status: 'completed' });
      saveCurrentCanvas();
  };

  // --- BP节点批量执行：自动创建图像节点并生成 ---
  const handleBpIdeaBatchExecute = async (sourceNodeId: string, sourceNode: CanvasNode, count: number) => {
      // 立即标记源节点为 running，防止重复点击
      updateNode(sourceNodeId, { status: 'running' });
      
      console.log(`[BP批量] 开始生成 ${count} 个图像节点`);
      
      // 获取输入
      const inputs = resolveInputs(sourceNodeId);
      const inputImages = inputs.images;
      
      // 获取提示词和设置
      let finalPrompt = '';
      let settings: any = {};
      
      if (sourceNode.type === 'bp') {
          // BP节点：处理Agent和模板
          const bpTemplate = sourceNode.data?.bpTemplate;
          const bpInputs = sourceNode.data?.bpInputs || {};
          settings = sourceNode.data?.settings || {};
          
          if (!bpTemplate) {
              console.error('[BP/Idea批量] BP节点无模板配置');
              updateNode(sourceNodeId, { status: 'idle' }); // 恢复状态
              return;
          }
          
          const bpFields = bpTemplate.bpFields || [];
          const inputFields = bpFields.filter((f: any) => f.type === 'input');
          const agentFields = bpFields.filter((f: any) => f.type === 'agent');
          
          // 收集用户输入值
          const userInputValues: Record<string, string> = {};
          for (const field of inputFields) {
              userInputValues[field.name] = bpInputs[field.id] || bpInputs[field.name] || '';
          }
          
          // 执行Agent
          const agentResults: Record<string, string> = {};
          for (const field of agentFields) {
              if (field.agentConfig) {
                  let instruction = field.agentConfig.instruction;
                  for (const [name, value] of Object.entries(userInputValues)) {
                      instruction = instruction.split(`/${name}`).join(value);
                  }
                  for (const [name, result] of Object.entries(agentResults)) {
                      instruction = instruction.split(`{${name}}`).join(result);
                  }
                  
                  try {
                      const agentResult = await generateAdvancedLLM(
                          instruction,
                          'You are a creative assistant. Generate content based on the given instruction. Output ONLY the requested content, no explanations.',
                          inputImages.length > 0 ? [inputImages[0]] : undefined
                      );
                      agentResults[field.name] = agentResult;
                  } catch (agentErr) {
                      agentResults[field.name] = `[Agent错误: ${agentErr}]`;
                  }
              }
          }
          
          // 替换模板变量
          finalPrompt = bpTemplate.prompt;
          for (const [name, value] of Object.entries(userInputValues)) {
              finalPrompt = finalPrompt.split(`/${name}`).join(value);
          }
          for (const [name, result] of Object.entries(agentResults)) {
              finalPrompt = finalPrompt.split(`{${name}}`).join(result);
          }
      }
      
      if (!finalPrompt) {
          console.error('[BP/Idea批量] 无提示词');
          updateNode(sourceNodeId, { status: 'idle' }); // 恢复状态
          return;
      }
      
      console.log(`[BP/Idea批量] 最终提示词:`, finalPrompt.slice(0, 100));
      
      const resultNodeIds: string[] = [];
      const newNodes: CanvasNode[] = [];
      const newConnections: Connection[] = [];
      const baseX = sourceNode.x + sourceNode.width + 150;
      const nodeHeight = 300;
      const gap = 20;
      const totalHeight = count * nodeHeight + (count - 1) * gap;
      const startY = sourceNode.y + (sourceNode.height / 2) - (totalHeight / 2);
      for (let i = 0; i < count; i++) {
          const newId = uuid();
          resultNodeIds.push(newId);
          newNodes.push({
              id: newId,
              type: 'image',
              title: `结果 ${i + 1}`,
              content: '',
              x: baseX,
              y: startY + i * (nodeHeight + gap),
              width: 280,
              height: nodeHeight,
              status: 'running',
              data: { prompt: finalPrompt, settings: settings }
          });
          newConnections.push({ id: uuid(), fromNode: sourceNodeId, toNode: newId });
      }
      setNodes(prev => [...prev, ...newNodes]);
      setConnections(prev => [...prev, ...newConnections]);
      nodesRef.current = [...nodesRef.current, ...newNodes];
      connectionsRef.current = [...connectionsRef.current, ...newConnections];
      setHasUnsavedChanges(true);

      const execPromises = resultNodeIds.map(async (nodeId, index) => {
          const abortController = new AbortController();
          abortControllersRef.current.set(nodeId, abortController);
          const signal = abortController.signal;
          try {
              let result: string | null = null;
              const aspectRatio = settings.aspectRatio || 'AUTO';
              const resolution = settings.resolution || '2K';
              let config: GenerationConfig | undefined = undefined;
              if (inputImages.length > 0) {
                  if (aspectRatio === 'AUTO') config = { resolution }; else config = { aspectRatio, resolution };
                  result = await editCreativeImage(inputImages, finalPrompt, config, signal);
              } else {
                  config = aspectRatio !== 'AUTO' ? { aspectRatio, resolution } : { aspectRatio: '1:1', resolution };
                  result = await generateCreativeImage(finalPrompt, config, signal);
              }
              if (!signal.aborted) {
                  updateNode(nodeId, { content: result || '', status: result ? 'completed' : 'error' });
              }
          } catch (err) {
              if (!signal.aborted) updateNode(nodeId, { status: 'error' });
          } finally {
              abortControllersRef.current.delete(nodeId);
          }
      });
      await Promise.all(execPromises);

      const contents = resultNodeIds.map(id => nodesRef.current.find(n => n.id === id)?.content).filter((c): c is string => !!c && (isValidImage(c) || isValidVideo(c)));
      setNodes(prev => prev.filter(n => !resultNodeIds.includes(n.id)));
      setConnections(prev => prev.filter(c => !resultNodeIds.includes(c.toNode)));
      nodesRef.current = nodesRef.current.filter(n => !resultNodeIds.includes(n.id));
      connectionsRef.current = connectionsRef.current.filter(c => !resultNodeIds.includes(c.toNode));

      if (contents.length <= 1) {
          const singleNodeId = uuid();
          const singleNode: CanvasNode = {
              id: singleNodeId,
              type: 'image',
              title: '结果',
              content: contents[0] || '',
              x: baseX,
              y: sourceNode.y,
              width: 320,
              height: 320,
              status: contents.length > 0 ? 'completed' : 'error',
              data: {}
          };
          const singleConn: Connection = { id: uuid(), fromNode: sourceNodeId, toNode: singleNodeId };
          setNodes(prev => [...prev, singleNode]);
          setConnections(prev => [...prev, singleConn]);
          nodesRef.current = [...nodesRef.current, singleNode];
          connectionsRef.current = [...connectionsRef.current, singleConn];
          // 单张结果同步到桌面
          if (contents[0] && onImageGenerated) onImageGenerated(contents[0], finalPrompt, currentCanvasId || undefined, canvasName);
      } else {
          const previewNodeId = uuid();
          const previewNode: CanvasNode = {
              id: previewNodeId,
              type: 'preview',
              title: '预览',
              content: contents[0] || '',
              x: baseX,
              y: sourceNode.y,
              width: 320,
              height: 320,
              status: 'completed',
              data: { previewItems: contents, previewCoverIndex: 0, previewExpectedCount: count }
          };
          const previewConn: Connection = { id: uuid(), fromNode: sourceNodeId, toNode: previewNodeId };
          setNodes(prev => [...prev, previewNode]);
          setConnections(prev => [...prev, previewConn]);
          nodesRef.current = [...nodesRef.current, previewNode];
          connectionsRef.current = [...connectionsRef.current, previewConn];
          // 异步批量保存到桌面子文件夹
          const promptLabel = finalPrompt.trim().slice(0, 15) || 'BP批量';
          saveBatchToDesktopFolder(contents, 0, promptLabel, false);
          console.log(`[BP批量] 全部完成，已合并为预览节点共 ${contents.length} 张`);
      }
      updateNode(sourceNodeId, { status: 'completed' });
      saveCurrentCanvas();
  };

  // 工具节点批量执行（remove-bg/upscale）：先创建 N 个 image 节点，全部完成后合并为一个预览节点
  const handleToolBatchExecute = async (sourceNodeId: string, sourceNode: CanvasNode, count: number) => {
      updateNode(sourceNodeId, { status: 'running' });
      const inputs = resolveInputs(sourceNodeId);
      const inputImages = inputs.images;
      if (inputImages.length === 0) {
          updateNode(sourceNodeId, { status: 'error' });
          return;
      }
      const baseX = sourceNode.x + sourceNode.width + 150;
      const nodeHeight = 300;
      const gap = 20;
      const totalHeight = count * nodeHeight + (count - 1) * gap;
      const startY = sourceNode.y + (sourceNode.height / 2) - (totalHeight / 2);
      const resultNodeIds: string[] = [];
      const newNodes: CanvasNode[] = [];
      const newConnections: Connection[] = [];
      for (let i = 0; i < count; i++) {
          const newId = uuid();
          resultNodeIds.push(newId);
          newNodes.push({
              id: newId,
              type: 'image',
              content: '',
              x: baseX,
              y: startY + i * (nodeHeight + gap),
              width: 300,
              height: 300,
              status: 'running',
              data: {}
          });
          newConnections.push({ id: uuid(), fromNode: sourceNodeId, toNode: newId });
      }
      setNodes(prev => [...prev, ...newNodes]);
      setConnections(prev => [...prev, ...newConnections]);
      nodesRef.current = [...nodesRef.current, ...newNodes];
      connectionsRef.current = [...connectionsRef.current, ...newConnections];
      setHasUnsavedChanges(true);

      const execPromises = resultNodeIds.map(async (nodeId) => {
          const abortController = new AbortController();
          abortControllersRef.current.set(nodeId, abortController);
          const signal = abortController.signal;
          try {
              let result: string | null = null;
              if (sourceNode.type === 'remove-bg') {
                  result = await editCreativeImage([inputImages[0]], "Remove the background, keep subject on transparent or white background", undefined, signal);
              } else if (sourceNode.type === 'upscale') {
                  const upscaleResolution = sourceNode.data?.settings?.resolution || '2K';
                  result = await editCreativeImage([inputImages[0]], "Upscale this image to high resolution while preserving all original details, colors, and composition. Enhance clarity and sharpness without altering the content.", { resolution: upscaleResolution as '1K' | '2K' | '4K' }, signal);
              }
              if (!signal.aborted && result) {
                  const metadata = await extractImageMetadata(result);
                  updateNode(nodeId, { content: result, status: 'completed', data: { imageMetadata: metadata } });
              } else if (!signal.aborted) {
                  updateNode(nodeId, { status: 'error' });
              }
          } catch (err) {
              if (!signal.aborted) updateNode(nodeId, { status: 'error' });
          } finally {
              abortControllersRef.current.delete(nodeId);
          }
      });
      await Promise.all(execPromises);

      const contents = resultNodeIds.map(id => nodesRef.current.find(n => n.id === id)?.content).filter((c): c is string => !!c && (isValidImage(c) || isValidVideo(c)));
      setNodes(prev => prev.filter(n => !resultNodeIds.includes(n.id)));
      setConnections(prev => prev.filter(c => !resultNodeIds.includes(c.toNode)));
      nodesRef.current = nodesRef.current.filter(n => !resultNodeIds.includes(n.id));
      connectionsRef.current = connectionsRef.current.filter(c => !resultNodeIds.includes(c.toNode));

      if (contents.length <= 1) {
          const singleNodeId = uuid();
          const singleNode: CanvasNode = {
              id: singleNodeId,
              type: 'image',
              title: '结果',
              content: contents[0] || '',
              x: baseX,
              y: sourceNode.y,
              width: 300,
              height: 300,
              status: contents.length > 0 ? 'completed' : 'error',
              data: {}
          };
          const singleConn: Connection = { id: uuid(), fromNode: sourceNodeId, toNode: singleNodeId };
          setNodes(prev => [...prev, singleNode]);
          setConnections(prev => [...prev, singleConn]);
          nodesRef.current = [...nodesRef.current, singleNode];
          connectionsRef.current = [...connectionsRef.current, singleConn];
      } else {
          const previewNodeId = uuid();
          const previewNode: CanvasNode = {
              id: previewNodeId,
              type: 'preview',
              title: '预览',
              content: contents[0] || '',
              x: baseX,
              y: sourceNode.y,
              width: 320,
              height: 320,
              status: 'completed',
              data: { previewItems: contents, previewCoverIndex: 0, previewExpectedCount: count }
          };
          const previewConn: Connection = { id: uuid(), fromNode: sourceNodeId, toNode: previewNodeId };
          setNodes(prev => [...prev, previewNode]);
          setConnections(prev => [...prev, previewConn]);
          nodesRef.current = [...nodesRef.current, previewNode];
          connectionsRef.current = [...connectionsRef.current, previewConn];
          // 异步批量保存到桌面子文件夹
          const toolLabel = sourceNode.type === 'remove-bg' ? '批量抠图' : '批量高清';
          saveBatchToDesktopFolder(contents, 0, toolLabel, false);
          console.log(`[工具批量] 全部完成，已合并为预览节点共 ${contents.length} 张`);
      }
      updateNode(sourceNodeId, { status: 'completed' });
      saveCurrentCanvas();
  };

  // 视频节点批量执行：先创建 N 个 video-output 节点，全部完成后合并为一个预览节点
  const handleVideoBatchExecute = async (sourceNodeId: string, sourceNode: CanvasNode, count: number) => {
      const videoModel = sourceNode.data?.videoModel || (sourceNode.data?.videoService === 'veo' ? (sourceNode.data?.veoModel || 'veo3.1-fast') : 'sora-2');
      const isKlingO1 = videoModel === 'kling-video-o1';

      let inputs: { images: string[]; texts: string[] };
      let inputVideos: string[] = [];
      if (isKlingO1) {
          const o1Resolved = resolveInputsForKlingO1(sourceNodeId);
          const { images: o1Images, videos: o1Videos } = o1Resolved;
          if (o1Videos.length > 1 || (o1Videos.length === 1 && o1Images.length > 4) || (o1Videos.length === 0 && o1Images.length > 7)) {
              updateNode(sourceNodeId, { status: 'error', data: { ...sourceNode.data, videoFailReason: '可灵 O1 仅支持至多 7 张图片，或 1 个视频 + 4 张图片' } });
              return;
          }
          inputs = { images: o1Images, texts: [] };
          inputVideos = o1Videos;
      } else {
          inputs = resolveInputs(sourceNodeId);
          const outConns = connectionsRef.current.filter(
            c => c.fromNode === sourceNodeId && nodesRef.current.find(n => n.id === c.toNode)?.type === 'video-output'
          );
          for (const c of outConns) {
            const outInputs = resolveInputs(c.toNode, new Set());
            if (outInputs.images.length > 0) inputs = { images: [...inputs.images, ...outInputs.images], texts: [...inputs.texts, ...outInputs.texts] };
          }
      }

      const combinedPrompt = inputs.texts.join('\n') || sourceNode.data?.prompt || '';
      const inputImages = inputs.images;
      if (!combinedPrompt) {
          updateNode(sourceNodeId, { status: 'error' });
          return;
      }

      if (isKlingO1 && inputVideos.length > 0) {
          const { isKlingServerAccessibleVideoUrl } = await import('../../services/klingVideoService');
          if (!isKlingServerAccessibleVideoUrl(inputVideos[0])) {
              updateNode(sourceNodeId, { status: 'error', data: { ...sourceNode.data, videoFailReason: '当前为本地或不可访问的视频地址，无法作为参考视频。视频上传功能服务器尚在开发中，请暂时使用可公网访问的视频 URL，或先断开视频输入仅用图片生成。' } });
              return;
          }
      }

      const baseX = sourceNode.x + sourceNode.width + 150;
      const nodeHeight = 300;
      const nodeWidth = 400;
      const gap = 20;
      const totalHeight = count * nodeHeight + (count - 1) * gap;
      const startY = sourceNode.y + (sourceNode.height / 2) - (totalHeight / 2);
      const resultNodeIds: string[] = [];
      const newNodes: CanvasNode[] = [];
      const newConnections: Connection[] = [];
      for (let i = 0; i < count; i++) {
          const newId = uuid();
          resultNodeIds.push(newId);
          newNodes.push({
              id: newId,
              type: 'video-output',
              title: `视频 ${i + 1}`,
              content: '',
              x: baseX,
              y: startY + i * (nodeHeight + gap),
              width: nodeWidth,
              height: nodeHeight,
              status: 'running',
              data: {}
          });
          newConnections.push({ id: uuid(), fromNode: sourceNodeId, toNode: newId });
      }
      setNodes(prev => [...prev, ...newNodes]);
      setConnections(prev => [...prev, ...newConnections]);
      nodesRef.current = [...nodesRef.current, ...newNodes];
      connectionsRef.current = [...connectionsRef.current, ...newConnections];
      setHasUnsavedChanges(true);
      updateNode(sourceNodeId, { status: 'completed' });
      saveCurrentCanvas();

      const family = getVideoModelFamily(videoModel) || 'unified';
      const runOne = async (outputNodeId: string, index: number) => {
          const abortController = new AbortController();
          abortControllersRef.current.set(outputNodeId, abortController);
          const signal = abortController.signal;
          try {
              // 与单节点执行、Veo 多图输入一致：统一处理 data:/files/http(s) 多种来源
              let processedImages: string[] = [];
              if (inputImages.length > 0) {
                  for (const img of inputImages) {
                      if (img.startsWith('/files/')) {
                          const fullUrl = `${window.location.origin}${img}`;
                          const resp = await fetch(fullUrl);
                          if (!resp.ok) throw new Error(`获取图片失败: ${resp.status}`);
                          const blob = await resp.blob();
                          const base64 = await new Promise<string>((resolve, reject) => {
                              const reader = new FileReader();
                              reader.onloadend = () => resolve(reader.result as string);
                              reader.onerror = reject;
                              reader.readAsDataURL(blob);
                          });
                          processedImages.push(base64);
                      } else if (img.startsWith('data:image')) {
                          const match = img.match(/^data:image\/(\w+);base64,/);
                          if (match && ['png', 'jpg', 'jpeg', 'webp'].includes(match[1].toLowerCase())) {
                              processedImages.push(img);
                          } else if (!match) {
                              processedImages.push(img);
                          }
                      } else if (img.startsWith('http://') || img.startsWith('https://')) {
                          if (img.includes('localhost') || img.includes('127.0.0.1')) {
                              const response = await fetch(img);
                              if (!response.ok) throw new Error(`获取图片失败: ${response.status}`);
                              const blob = await response.blob();
                              const base64 = await new Promise<string>((resolve, reject) => {
                                  const reader = new FileReader();
                                  reader.onloadend = () => resolve(reader.result as string);
                                  reader.onerror = reject;
                                  reader.readAsDataURL(blob);
                              });
                              processedImages.push(base64);
                          } else {
                              processedImages.push(img);
                          }
                      }
                  }
              }
              let videoUrl: string | null = null;
              if (family === 'unified') {
                  const { createUnifiedVideoTask, waitForUnifiedVideoCompletion } = await import('../../services/unifiedVideoService');
                  const videoSize = sourceNode.data?.videoSize || '1280x720';
                  const aspectRatio = (sourceNode.data?.veoAspectRatio || (videoSize === '720x1280' ? '9:16' : '16:9')) as '16:9' | '9:16';
                  const taskId = await createUnifiedVideoTask({
                      model: videoModel,
                      prompt: combinedPrompt,
                      images: processedImages.length > 0 ? processedImages : undefined,
                      aspectRatio,
                      duration: (sourceNode.data?.videoSeconds || '10') as '10' | '15' | '25',
                      hd: videoModel === 'sora-2-pro',
                      enhancePrompt: sourceNode.data?.veoEnhancePrompt ?? false,
                      enableUpsample: sourceNode.data?.veoEnableUpsample ?? false,
                  });
                  videoUrl = await waitForUnifiedVideoCompletion(taskId, (progress, status) => {
                      updateNode(outputNodeId, { data: { ...nodesRef.current.find(n => n.id === outputNodeId)?.data, videoProgress: progress, videoTaskStatus: status } });
                  });
              } else if (family === 'kling' && videoModel === 'kling-video-o1') {
                  const { createKlingO1Task, waitForKlingOmniCompletion, isKlingServerAccessibleVideoUrl } = await import('../../services/klingVideoService');
                  if (inputVideos.length > 0 && !isKlingServerAccessibleVideoUrl(inputVideos[0])) {
                      updateNode(outputNodeId, { status: 'error', data: { ...nodesRef.current.find(n => n.id === outputNodeId)?.data, videoFailReason: '当前为本地或不可访问的视频地址，无法作为参考视频。视频上传功能服务器尚在开发中，请暂时使用可公网访问的视频 URL，或先断开视频输入仅用图片生成。' } });
                      return;
                  }
                  const klingResolution = sourceNode.data?.klingResolution ?? '1080p';
                  const klingAspectRatio = sourceNode.data?.klingAspectRatio ?? '16:9';
                  const rawDur = sourceNode.data?.klingDuration ?? '5';
                  const klingDuration: '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' = (rawDur === 'auto' || !['3','4','5','6','7','8','9','10'].includes(rawDur)) ? '5' : rawDur;
                  const taskId = await createKlingO1Task({
                      prompt: combinedPrompt,
                      image_list: processedImages.length > 0 ? processedImages.map(url => ({ image_url: url })) : undefined,
                      video_list: inputVideos.length > 0 ? [{ video_url: inputVideos[0], refer_type: 'base', keep_original_sound: 'no' }] : undefined,
                      element_list: [],
                      mode: klingResolution === '720p' ? 'std' : 'pro',
                      aspect_ratio: (klingAspectRatio === 'auto' ? '16:9' : klingAspectRatio) as '16:9' | '9:16' | '1:1',
                      duration: klingDuration,
                  });
                  videoUrl = await waitForKlingOmniCompletion(taskId, (progress, status) => {
                      updateNode(outputNodeId, { data: { ...nodesRef.current.find(n => n.id === outputNodeId)?.data, videoProgress: progress, videoTaskStatus: status } });
                  });
              } else if (family === 'kling') {
                  const { createKlingVideoTask, waitForKlingCompletion } = await import('../../services/klingVideoService');
                  const klingMode = sourceNode.data?.klingMode || 'image2video';
                  const klingDur26 = sourceNode.data?.klingDuration === '10' ? '10' : sourceNode.data?.klingDuration === 'auto' ? 'auto' : '5';
                  const taskId = await createKlingVideoTask({
                      model: videoModel as 'kling-video-v2.6' | 'kling-video-o1',
                      mode: klingMode,
                      prompt: combinedPrompt,
                      images: processedImages.length > 0 ? processedImages : undefined,
                      duration: klingDur26,
                      sound: processedImages.length >= 2 ? 'off' : (sourceNode.data?.klingSound ?? 'off'),
                      negative_prompt: sourceNode.data?.klingNegativePrompt || undefined,
                  });
                  videoUrl = await waitForKlingCompletion(taskId, klingMode, (progress, status) => {
                      updateNode(outputNodeId, { data: { ...nodesRef.current.find(n => n.id === outputNodeId)?.data, videoProgress: progress, videoTaskStatus: status } });
                  });
              } else {
                  if (videoModel === 'minimax-hailuo-2.3-fast' && processedImages.length === 0) {
                      updateNode(outputNodeId, { status: 'error', data: { ...nodesRef.current.find(n => n.id === outputNodeId)?.data, videoFailReason: '海螺 2.3 Fast 仅支持图生视频，请连接图片节点作为输入' } });
                      return;
                  }
                  if (processedImages.length >= 2) {
                      updateNode(outputNodeId, { status: 'error', data: { ...nodesRef.current.find(n => n.id === outputNodeId)?.data, videoFailReason: '海螺不支持多图，请仅连接 1 张图片' } });
                      return;
                  }
                  // 与 Veo 一致：图片来自 resolveInputs(sourceNodeId) + 所连 video-output 上游，已并入 inputImages → processedImages
                  const { createMinimaxVideoTask, waitForMinimaxCompletion } = await import('../../services/minimaxVideoService');
                  const taskId = await createMinimaxVideoTask({
                      model: videoModel as 'minimax-hailuo-2.3' | 'minimax-hailuo-2.3-fast',
                      prompt: combinedPrompt,
                      images: processedImages.length > 0 ? processedImages : undefined,
                      resolution: (sourceNode.data?.minimaxResolution || '1080P') as '768P' | '1080P',
                      duration: sourceNode.data?.minimaxDuration ?? 6,
                  });
                  videoUrl = await waitForMinimaxCompletion(taskId, (progress, status) => {
                      updateNode(outputNodeId, { data: { ...nodesRef.current.find(n => n.id === outputNodeId)?.data, videoProgress: progress, videoTaskStatus: status } });
                  });
              }
              if (signal.aborted) return;
              if (videoUrl) await downloadAndSaveVideo(videoUrl, outputNodeId, signal);
              else throw new Error('未返回视频URL');
          } catch (err) {
              if (!signal.aborted) updateNode(outputNodeId, { status: 'error', data: { ...nodesRef.current.find(n => n.id === outputNodeId)?.data, videoFailReason: err instanceof Error ? err.message : String(err) } });
          } finally {
              abortControllersRef.current.delete(outputNodeId);
          }
      };

      await Promise.all(resultNodeIds.map((id, i) => runOne(id, i)));

      const contents = resultNodeIds.map(id => nodesRef.current.find(n => n.id === id)?.content).filter((c): c is string => !!c && (isValidImage(c) || isValidVideo(c)));

      if (contents.length <= 1 && resultNodeIds.length === 1) {
          const existingId = resultNodeIds[0];
          updateNode(existingId, {
              x: baseX,
              y: sourceNode.y,
              data: { ...nodesRef.current.find(n => n.id === existingId)?.data, videoTaskId: undefined, videoTaskStatus: undefined, videoProgress: undefined, videoFailReason: undefined }
          });
      } else if (contents.length <= 1 && resultNodeIds.length > 1) {
          setNodes(prev => prev.filter(n => !resultNodeIds.includes(n.id)));
          setConnections(prev => prev.filter(c => !resultNodeIds.includes(c.toNode)));
          nodesRef.current = nodesRef.current.filter(n => !resultNodeIds.includes(n.id));
          connectionsRef.current = connectionsRef.current.filter(c => !resultNodeIds.includes(c.toNode));
          const singleNodeId = uuid();
          const singleNode: CanvasNode = {
              id: singleNodeId,
              type: 'video-output',
              title: '视频',
              content: contents[0] || '',
              x: baseX,
              y: sourceNode.y,
              width: 400,
              height: 225,
              status: contents.length > 0 ? 'completed' : 'error',
              data: {}
          };
          const singleConn: Connection = { id: uuid(), fromNode: sourceNodeId, toNode: singleNodeId };
          setNodes(prev => [...prev, singleNode]);
          setConnections(prev => [...prev, singleConn]);
          nodesRef.current = [...nodesRef.current, singleNode];
          connectionsRef.current = [...connectionsRef.current, singleConn];
          if (contents[0] && onImageGenerated) onImageGenerated(contents[0], '视频输出', currentCanvasId || undefined, canvasName, true);
      } else if (contents.length > 1) {
          setNodes(prev => prev.filter(n => !resultNodeIds.includes(n.id)));
          setConnections(prev => prev.filter(c => !resultNodeIds.includes(c.toNode)));
          nodesRef.current = nodesRef.current.filter(n => !resultNodeIds.includes(n.id));
          connectionsRef.current = connectionsRef.current.filter(c => !resultNodeIds.includes(c.toNode));
          const previewNodeId = uuid();
          const previewNode: CanvasNode = {
              id: previewNodeId,
              type: 'preview',
              title: '预览',
              content: contents[0] || '',
              x: baseX,
              y: sourceNode.y,
              width: 320,
              height: 320,
              status: 'completed',
              data: { previewItems: contents, previewCoverIndex: 0, previewExpectedCount: count, previewItemTypes: contents.map(() => 'video' as const) }
          };
          const previewConn: Connection = { id: uuid(), fromNode: sourceNodeId, toNode: previewNodeId };
          setNodes(prev => [...prev, previewNode]);
          setConnections(prev => [...prev, previewConn]);
          nodesRef.current = [...nodesRef.current, previewNode];
          connectionsRef.current = [...connectionsRef.current, previewConn];
          // 异步批量保存视频到桌面子文件夹
          saveBatchToDesktopFolder(contents, 0, '批量视频', true);
          console.log(`[视频批量] 全部完成，已合并为预览节点共 ${contents.length} 个`);
      }
      saveCurrentCanvas();
  };

  const handleExecuteNode = async (nodeId: string, batchCount: number = 1) => {
      const node = nodesRef.current.find(n => n.id === nodeId);
      if (!node) {
          console.warn(`[执行] 节点 ${nodeId.slice(0,8)} 不存在`);
          return;
      }
      
      // 🔒 原子操作：防止重复执行（关键修复点）
      if (executingNodesRef.current.has(nodeId)) {
          console.warn(`[🔒执行锁] 节点 ${nodeId.slice(0,8)} 正在执行中，阻止重复请求`);
          return;
      }
      
      // 立即标记为执行中（在任何异步操作之前）
      executingNodesRef.current.add(nodeId);
      console.log(`[🔒执行锁] 节点 ${nodeId.slice(0,8)} 已加锁，开始执行`);
      
      // 防止重复执行：如果节点已经在运行中，直接返回
      if (node.status === 'running') {
          console.warn(`[执行] 节点 ${nodeId.slice(0,8)} 已在运行中，忽略重复请求`);
          executingNodesRef.current.delete(nodeId); // 解锁
          return;
      }
      
      // 检查是否已有未完成的abortController
      if (abortControllersRef.current.has(nodeId)) {
          console.warn(`[执行] 节点 ${nodeId.slice(0,8)} 存在未清理的abortController，先取消旧任务`);
          const oldController = abortControllersRef.current.get(nodeId);
          oldController?.abort();
          abortControllersRef.current.delete(nodeId);
      }

      // 批量生成：创建多个结果节点
      if (batchCount > 1 && ['image', 'edit'].includes(node.type)) {
          try {
              await handleBatchExecute(nodeId, node, batchCount);
          } finally {
              executingNodesRef.current.delete(nodeId); // 解锁
          }
          return;
      }
      
      // 工具节点批量执行（>1时才走批量路径，=1时走下方单次执行路径）
      if (batchCount > 1 && ['remove-bg', 'upscale'].includes(node.type)) {
          try {
              await handleToolBatchExecute(nodeId, node, batchCount);
          } finally {
              executingNodesRef.current.delete(nodeId); // 解锁
          }
          return;
      }
      
      // BP节点批量执行：自动创建图像节点
      if (batchCount >= 1 && node.type === 'bp') {
          try {
              await handleBpIdeaBatchExecute(nodeId, node, batchCount);
          } finally {
              executingNodesRef.current.delete(nodeId); // 解锁
          }
          return;
      }
      
      // 视频节点批量执行：自动创建 video-output 节点
      if (batchCount >= 1 && node.type === 'video') {
          try {
              await handleVideoBatchExecute(nodeId, node, batchCount);
          } finally {
              executingNodesRef.current.delete(nodeId); // 解锁
          }
          return;
      }
      
      // 画板节点执行：接收图片(count=1) 或 输出PNG(count=2)
      if (node.type === 'drawing-board') {
          try {
              if (batchCount === 1) {
                  // 接收上游图片
                  const inputs = resolveInputs(nodeId);
                  const inputImages = inputs.images;
                  
                  console.log('[DrawingBoard] 接收图片:', inputImages.length);
                  
                  if (inputImages.length > 0) {
                      updateNode(nodeId, { 
                          status: 'completed',
                          data: { ...node.data, receivedImages: inputImages }
                      });
                  } else {
                      console.warn('[DrawingBoard] 无上游图片输入');
                      updateNode(nodeId, { status: 'completed' });
                  }
              } else if (batchCount === 2) {
                  // 输出PNG：从 node.content 获取 dataUrl
                  const outputDataUrl = node.content;
                  
                  if (outputDataUrl && outputDataUrl.startsWith('data:image')) {
                      console.log('[DrawingBoard] 输出图片...');
                      
                      // 保存到服务器
                      try {
                          const { saveToOutput } = await import('../../services/api/files');
                          const savedPath = await saveToOutput(outputDataUrl, 'drawing-board-output.png');
                          console.log('[DrawingBoard] 图片已保存:', savedPath);
                      } catch (err) {
                          console.warn('[DrawingBoard] 保存到output失败:', err);
                      }
                      
                      // 创建输出图片节点
                      const outputNodeId = uuid();
                      const outputNode: CanvasNode = {
                          id: outputNodeId,
                          type: 'image',
                          title: '画板输出',
                          content: outputDataUrl,
                          x: node.x + node.width + 100,
                          y: node.y,
                          width: 280,
                          height: 280,
                          data: {},
                          status: 'completed'
                      };
                      
                      const newConnection: Connection = {
                          id: uuid(),
                          fromNode: nodeId,
                          toNode: outputNodeId
                      };
                      
                      setNodes(prev => [...prev, outputNode]);
                      setConnections(prev => [...prev, newConnection]);
                      nodesRef.current = [...nodesRef.current, outputNode];
                      connectionsRef.current = [...connectionsRef.current, newConnection];
                      
                      updateNode(nodeId, { status: 'completed', data: { ...node.data, outputImageUrl: outputDataUrl } });
                      saveCurrentCanvas();
                  } else {
                      console.warn('[DrawingBoard] 无有效输出内容');
                      updateNode(nodeId, { status: 'error' });
                  }
              }
          } finally {
              executingNodesRef.current.delete(nodeId); // 解锁
          }
          return;
      }

      // Create abort controller for this execution
      const abortController = new AbortController();
      abortControllersRef.current.set(nodeId, abortController);
      const signal = abortController.signal;

      updateNode(nodeId, { status: 'running' });

      try {
          // 级联执行：先执行上游未完成的节点
          const inputConnections = connectionsRef.current.filter(c => c.toNode === nodeId);
          console.log(`[级联执行] 节点 ${nodeId.slice(0,8)} 有 ${inputConnections.length} 个上游连接`);
          
          for (const conn of inputConnections) {
              const upstreamNode = nodesRef.current.find(n => n.id === conn.fromNode);
              console.log(`[级联执行] 上游节点:`, {
                  id: upstreamNode?.id.slice(0,8),
                  type: upstreamNode?.type,
                  status: upstreamNode?.status
              });
              
              // 如果上游节点需要执行且未完成，先执行上游
              if (upstreamNode && upstreamNode.status !== 'completed') {
                  // 只有 idle 状态的节点才需要级联执行（关键修复点）
                  // running: 已在执行，等待完成
                  // error: 已失败，不重试
                  if (upstreamNode.status !== 'idle') {
                      console.log(`[级联执行] ⚠️ 上游节点状态为 ${upstreamNode.status}，跳过级联执行`);
                      continue; // 跳过这个上游节点
                  }
                  
                  // 可执行的节点类型：包含 image 以支持容器模式级联执行
                  const executableTypes = ['image', 'llm', 'edit', 'remove-bg', 'upscale', 'resize', 'video', 'bp'];
                  if (executableTypes.includes(upstreamNode.type)) {
                      console.log(`[级联执行] ⤵️ 触发上游节点执行: ${upstreamNode.type} ${upstreamNode.id.slice(0,8)}`);
                      // 递归执行上游节点
                      await handleExecuteNode(upstreamNode.id);
                      console.log(`[级联执行] ✅ 上游节点执行完成`);
                  }
              } else if (upstreamNode) {
                  console.log(`[级联执行] ✅ 上游节点已完成，无需重新执行`);
              }
          }
          
          // 检查是否被中断
          if (signal.aborted) return;

          // Resolve all inputs (recursive for edits/relays) - 向上追溯
          const inputs = resolveInputs(nodeId);
          
          if (node.type === 'image') {
              // 获取节点自身的prompt
              const nodePrompt = node.data?.prompt || '';
              // 上游输入的文本
              const inputTexts = inputs.texts.join('\n');
              // 上游图片
              const inputImages = inputs.images;
              
              // 从上游节点获取设置
              let upstreamSettings: any = null;
              let upstreamPrompt = '';
              const inputConnections = connectionsRef.current.filter(c => c.toNode === nodeId);
              for (const conn of inputConnections) {
                  const upstreamNode = nodesRef.current.find(n => n.id === conn.fromNode);
                  if (upstreamNode?.type === 'image' && upstreamNode.data?.prompt && !nodePrompt) {
                      // 从上游image节点继承prompt
                      upstreamPrompt = upstreamNode.data.prompt;
                  }
              }
              
              // 合并prompt：上游文本输入 > 上游节点prompt > 自身
              // 🔧 修改优先级：上游输入替代节点自身prompt
              const combinedPrompt = inputTexts || upstreamPrompt || nodePrompt;
              
              // 合并设置：自身 > 上游节点设置 > 默认
              const rawSettings = node.data?.settings || upstreamSettings || {};
              // 标准化 'Auto' -> 'AUTO'
              const effectiveSettings = {
                ...rawSettings,
                aspectRatio: rawSettings.aspectRatio === 'Auto' ? 'AUTO' : rawSettings.aspectRatio,
              };
              
              // 获取图片：优先用上游输入，其次用节点自身的图片
              let imageSource: string[] = [];
              if (inputImages.length > 0) {
                  // 有上游图片输入
                  imageSource = inputImages;
              } else if (isValidImage(node.content)) {
                  // 没有上游图片，但节点自身有图片
                  imageSource = [node.content];
              }
              
              // 执行逻辑：
              // 1. 无prompt + 无图片 = 不执行（但如果是上传的图片，应该已经是completed状态）
              // 2. 有prompt + 无图片 = 文生图
              // 3. 无prompt + 有图片 = 传递图片（容器模式）
              // 4. 有prompt + 有图片 = 图生图
              
              console.log('[Image节点] 执行前检查:', {
                  nodeId: nodeId.slice(0, 8),
                  hasCombinedPrompt: !!combinedPrompt,
                  imageSourceLength: imageSource.length,
                  nodeContent: node.content?.slice(0, 100),
                  isValidContent: isValidImage(node.content)
              });
              
              if (!combinedPrompt && imageSource.length === 0) {
                  // 无prompt + 无图片 = 不执行
                  // 特殊情况：如果节点本身就有content（用户上传的图片或画布恢复的），标记为completed
                  if (isValidImage(node.content)) {
                      console.log('[Image节点] ✅ 已有图片内容，直接标记为completed');
                      updateNode(nodeId, { status: 'completed' });
                  } else {
                      console.error('[Image节点] ❌ 执行失败：无提示词且无图片，content:', node.content);
                      updateNode(nodeId, { status: 'error' });
                  }
              } else if (combinedPrompt && imageSource.length === 0) {
                  // 有prompt + 无图片 = 文生图
                  // 使用effectiveSettings（合并后的设置）
                  const imgAspectRatio = effectiveSettings.aspectRatio || 'AUTO';
                  const imgResolution = effectiveSettings.resolution || '2K';
                  const imgConfig = imgAspectRatio !== 'AUTO' 
                      ? { aspectRatio: imgAspectRatio, resolution: imgResolution as '1K' | '2K' | '4K' }
                      : { aspectRatio: '1:1', resolution: imgResolution as '1K' | '2K' | '4K' }; // 文生图默认1:1
                  
                  const result = await generateCreativeImage(combinedPrompt, imgConfig, signal);
                  if (!signal.aborted) {
                      updateNode(nodeId, { content: result || '', status: result ? 'completed' : 'error' });
                      // 立即保存画布（避免切换TAB时数据丢失）
                      saveCurrentCanvas();
                      // 同步到桌面
                      if (result && onImageGenerated) {
                          onImageGenerated(result, combinedPrompt, currentCanvasId || undefined, canvasName);
                      }
                  }
              } else if (!combinedPrompt && imageSource.length > 0) {
                  // 无prompt + 有图片 = 传递图片（容器模式）
                  if (!signal.aborted) {
                      updateNode(nodeId, { content: imageSource[0], status: 'completed' });
                  }
              } else {
                  // 有prompt + 有图片 = 图生图
                  // 🔧 修复：正确使用 effectiveSettings（合并后的设置）
                  const imgAspectRatio = effectiveSettings.aspectRatio || 'AUTO';
                  const imgResolution = effectiveSettings.resolution || '1K';
                  
                  let imgConfig: GenerationConfig | undefined = undefined;
                  if (imgAspectRatio === 'AUTO') {
                      // AUTO 模式：只传 resolution（如果不是默认值），保持原图比例
                      if (imgResolution !== 'AUTO' && imgResolution !== '1K') {
                          imgConfig = { resolution: imgResolution as '1K' | '2K' | '4K' };
                      }
                  } else {
                      // 用户指定了比例
                      imgConfig = { 
                          aspectRatio: imgAspectRatio, 
                          resolution: imgResolution !== 'AUTO' ? imgResolution as '1K' | '2K' | '4K' : '1K'
                      };
                  }
                  
                  console.log('[Image节点] 图生图配置:', { imgAspectRatio, imgResolution, imgConfig });
                  const result = await editCreativeImage(imageSource, combinedPrompt, imgConfig, signal);
                  if (!signal.aborted) {
                      updateNode(nodeId, { content: result || '', status: result ? 'completed' : 'error' });
                      // 立即保存画布（避免切换TAB时数据丢失）
                      saveCurrentCanvas();
                      // 同步到桌面
                      if (result && onImageGenerated) {
                          onImageGenerated(result, combinedPrompt, currentCanvasId || undefined, canvasName);
                      }
                  }
              }
          }
          else if (node.type === 'edit') {
               // Magic节点执行逻辑
               const inputTexts = inputs.texts.join('\n');
               const inputImages = inputs.images;
                         
               // 获取节点的设置和提示词
               const nodePrompt = node.data?.prompt || '';
               // 🔧 上游输入优先替代节点自身prompt
               const combinedPrompt = inputTexts || nodePrompt;
                         
              // 获取Edit节点的设置
               const editAspectRatio = node.data?.settings?.aspectRatio || 'AUTO';
               const editResolution = node.data?.settings?.resolution || 'AUTO';
               
               console.log('[Magic] 节点设置:', {
                   aspectRatio: editAspectRatio,
                   resolution: editResolution,
                   nodeSettings: node.data?.settings
               });
                         
               // 🔧 修复：AUTO 比例应该传递给服务层，让服务层根据是否有输入图片决定处理方式
               let finalConfig: GenerationConfig | undefined = undefined;
               const hasInputImages = inputImages.length > 0;
                         
               if (editAspectRatio === 'AUTO' && hasInputImages) {
                   // 图生图 + AUTO：只传递 resolution（如果不是 AUTO），不传 aspectRatio
                   if (editResolution !== 'AUTO') {
                       finalConfig = {
                           resolution: editResolution as '1K' | '2K' | '4K'
                       };
                   }
               } else if (editAspectRatio !== 'AUTO' || editResolution !== 'AUTO') {
                   finalConfig = {
                       aspectRatio: editAspectRatio !== 'AUTO' ? editAspectRatio : '1:1',
                       resolution: editResolution !== 'AUTO' ? editResolution as '1K' | '2K' | '4K' : '1K'
                   };
               }
               
               console.log('[Magic] 构建的 finalConfig:', finalConfig);
                         
               // 🔧 每次运行都创建新的输出节点
               const outputNodeId = uuid();
               const outputNode: CanvasNode = {
                   id: outputNodeId,
                   type: 'image',
                   content: '',
                   x: node.x + node.width + 100,
                   y: node.y,
                   width: 300,
                   height: 300,
                   data: {},
                   status: 'running'
               };
                         
               const newConnection = {
                   id: uuid(),
                   fromNode: nodeId,
                   toNode: outputNodeId
               };
                         
               setNodes(prev => [...prev, outputNode]);
               setConnections(prev => [...prev, newConnection]);
               setHasUnsavedChanges(true);
               console.log(`[Magic] 已创建新输出节点 ${outputNodeId.slice(0,8)}`);
                         
               // 调用API
               try {
                   let result: string | null = null;
                             
                   if (!combinedPrompt && inputImages.length === 0) {
                       console.warn('[Magic] 无prompt且无图片，无法执行');
                       updateNode(outputNodeId, { status: 'error' });
                       updateNode(nodeId, { status: 'error' });
                       return;
                   } else if (combinedPrompt && inputImages.length === 0) {
                       result = await generateCreativeImage(combinedPrompt, finalConfig, signal);
                   } else if (!combinedPrompt && inputImages.length > 0) {
                       result = inputImages[0];
                       updateNode(nodeId, { status: 'completed' });
                   } else {
                       result = await editCreativeImage(inputImages, combinedPrompt, finalConfig, signal);
                   }
                             
                   if (!signal.aborted) {
                       if (result) {
                           console.log(`[Magic] API返回成功,更新输出节点内容`);
                           const metadata = await extractImageMetadata(result);
                           updateNode(outputNodeId, { 
                               content: result,
                               status: 'completed',
                               data: { imageMetadata: metadata }
                           });
                           updateNode(nodeId, { status: 'completed' });
                           
                           // 同步到桌面对应画布文件夹
                           if (onImageGenerated) onImageGenerated(result, 'Magic结果', currentCanvasId || undefined, canvasName);
                           
                           // 🔧 保存画布
                           saveCurrentCanvas();
                       } else {
                           updateNode(outputNodeId, { status: 'error' });
                           updateNode(nodeId, { status: 'error' });
                       }
                   }
               } catch (error) {
                   console.error('[Magic] 执行失败:', error);
                   updateNode(outputNodeId, { status: 'error' });
                   updateNode(nodeId, { status: 'error' });
               }
          }
          else if (node.type === 'video') {
               const videoModel = node.data?.videoModel || (node.data?.videoService === 'veo' ? (node.data?.veoModel || 'veo3.1-fast') : 'sora-2');
               const family = getVideoModelFamily(videoModel) || 'unified';
               const isKlingO1 = videoModel === 'kling-video-o1';

               let inputImages: string[];
               let inputVideos: string[] = [];
               let combinedPrompt: string;
               if (isKlingO1) {
                   const o1Resolved = resolveInputsForKlingO1(nodeId);
                   if (o1Resolved.videos.length > 1 || (o1Resolved.videos.length === 1 && o1Resolved.images.length > 4) || (o1Resolved.videos.length === 0 && o1Resolved.images.length > 7)) {
                       updateNode(nodeId, { status: 'error', data: { ...node.data, videoFailReason: '可灵 O1 仅支持至多 7 张图片，或 1 个视频 + 4 张图片' } });
                       return;
                   }
                   inputImages = o1Resolved.images;
                   inputVideos = o1Resolved.videos;
                   combinedPrompt = node.data?.prompt || '';
               } else {
                   const nodePrompt = node.data?.prompt || '';
                   const inputTexts = inputs.texts.join('\n');
                   combinedPrompt = inputTexts || nodePrompt;
                   let merged = inputs.images;
                   const outConns = connectionsRef.current.filter(
                     c => c.fromNode === nodeId && nodesRef.current.find(n => n.id === c.toNode)?.type === 'video-output'
                   );
                   for (const c of outConns) {
                     const outInputs = resolveInputs(c.toNode, new Set());
                     if (outInputs.images.length > 0) merged = [...merged, ...outInputs.images];
                   }
                   inputImages = merged;
               }

               console.log('[Video节点] ========== 开始处理 ==========');
               console.log('[Video节点] 模型:', videoModel, 'family:', family);
               console.log('[Video节点] inputImages:', {
                   count: inputImages.length,
                   hasImages: inputImages.length > 0,
                   preview: inputImages.map(img => img.slice(0, 50))
               });
               
               // 🔍 详细检查图片格式
               if (inputImages.length > 0) {
                   inputImages.forEach((img, idx) => {
                       const isBase64 = img.startsWith('data:image');
                       const isLocalPath = img.startsWith('/files/');
                       const isHttpUrl = img.startsWith('http://') || img.startsWith('https://');
                       console.log(`[Video节点] 图片 ${idx + 1} 格式:`, {
                           isBase64,
                           isLocalPath,
                           isHttpUrl,
                           length: img.length,
                           preview: img.slice(0, 100)
                       });
                   });
               }
               
               // 检查是否有保存的任务ID（恢复场景）
               const savedTaskId = node.data?.videoTaskId;
               const hasVideoContent = isValidVideo(node.content);
               
               // 如果节点状态是 running 但没有内容，说明是恢复的未完成任务
               if ((node.status as string) === 'running' && savedTaskId && !hasVideoContent) {
                   console.log('[Video节点] 检测到未完成的任务，恢复轮询:', savedTaskId, 'family:', family);
                   try {
                       if (family === 'unified') {
                           const { getUnifiedVideoTaskStatus, waitForUnifiedVideoCompletion } = await import('../../services/unifiedVideoService');
                           const taskStatus = await getUnifiedVideoTaskStatus(savedTaskId);
                           updateNode(nodeId, { data: { ...node.data, videoTaskStatus: taskStatus.status, videoFailReason: taskStatus.failReason } });
                           if (taskStatus.status === 'SUCCESS' && taskStatus.videoUrl) {
                               await downloadAndSaveVideo(taskStatus.videoUrl, nodeId, signal);
                           } else if (taskStatus.status === 'FAILURE') {
                               updateNode(nodeId, { status: 'error', data: { ...node.data, videoTaskId: undefined, videoTaskStatus: 'FAILURE', videoFailReason: taskStatus.failReason || '未知错误' } });
                           } else {
                               const videoUrl = await waitForUnifiedVideoCompletion(savedTaskId, (progress, status) => {
                                   updateNode(nodeId, { data: { ...nodesRef.current.find(n => n.id === nodeId)?.data, videoProgress: progress, videoTaskStatus: status } });
                               });
                               if (!signal.aborted && videoUrl) await downloadAndSaveVideo(videoUrl, nodeId, signal);
                           }
                       } else if (family === 'kling' && videoModel === 'kling-video-o1') {
                           const { getKlingOmniTaskStatus, waitForKlingOmniCompletion } = await import('../../services/klingVideoService');
                           const taskStatus = await getKlingOmniTaskStatus(savedTaskId);
                           updateNode(nodeId, { data: { ...node.data, videoTaskStatus: taskStatus.status, videoFailReason: taskStatus.failReason } });
                           if (taskStatus.status === 'SUCCESS' && taskStatus.videoUrl) {
                               await downloadAndSaveVideo(taskStatus.videoUrl, nodeId, signal);
                           } else if (taskStatus.status === 'FAILURE') {
                               updateNode(nodeId, { status: 'error', data: { ...node.data, videoTaskId: undefined, videoTaskStatus: 'FAILURE', videoFailReason: taskStatus.failReason || '未知错误' } });
                           } else {
                               const videoUrl = await waitForKlingOmniCompletion(savedTaskId, (progress, status) => {
                                   updateNode(nodeId, { data: { ...nodesRef.current.find(n => n.id === nodeId)?.data, videoProgress: progress, videoTaskStatus: status } });
                               });
                               if (!signal.aborted && videoUrl) await downloadAndSaveVideo(videoUrl, nodeId, signal);
                           }
                       } else if (family === 'kling') {
                           const klingMode = node.data?.klingMode || 'image2video';
                           const { getKlingTaskStatus, waitForKlingCompletion } = await import('../../services/klingVideoService');
                           const taskStatus = await getKlingTaskStatus(savedTaskId, klingMode);
                           updateNode(nodeId, { data: { ...node.data, videoTaskStatus: taskStatus.status, videoFailReason: taskStatus.failReason } });
                           if (taskStatus.status === 'SUCCESS' && taskStatus.videoUrl) {
                               await downloadAndSaveVideo(taskStatus.videoUrl, nodeId, signal);
                           } else if (taskStatus.status === 'FAILURE') {
                               updateNode(nodeId, { status: 'error', data: { ...node.data, videoTaskId: undefined, videoTaskStatus: 'FAILURE', videoFailReason: taskStatus.failReason || '未知错误' } });
                           } else {
                               const videoUrl = await waitForKlingCompletion(savedTaskId, klingMode, (progress, status) => {
                                   updateNode(nodeId, { data: { ...nodesRef.current.find(n => n.id === nodeId)?.data, videoProgress: progress, videoTaskStatus: status } });
                               });
                               if (!signal.aborted && videoUrl) await downloadAndSaveVideo(videoUrl, nodeId, signal);
                           }
                       } else {
                           const { getMinimaxTaskStatus, waitForMinimaxCompletion } = await import('../../services/minimaxVideoService');
                           const taskStatus = await getMinimaxTaskStatus(savedTaskId);
                           updateNode(nodeId, { data: { ...node.data, videoTaskStatus: taskStatus.status, videoFailReason: taskStatus.failReason } });
                           if (taskStatus.status === 'SUCCESS') {
                               const videoUrl = taskStatus.videoUrl || (taskStatus.fileId ? await (await import('../../services/minimaxVideoService')).getMinimaxFileUrl(taskStatus.fileId) : undefined);
                               if (videoUrl && !signal.aborted) await downloadAndSaveVideo(videoUrl, nodeId, signal);
                           } else if (taskStatus.status === 'FAILURE') {
                               updateNode(nodeId, { status: 'error', data: { ...node.data, videoTaskId: undefined, videoTaskStatus: 'FAILURE', videoFailReason: taskStatus.failReason || '未知错误' } });
                           } else {
                               const videoUrl = await waitForMinimaxCompletion(savedTaskId, (progress, status) => {
                                   updateNode(nodeId, { data: { ...nodesRef.current.find(n => n.id === nodeId)?.data, videoProgress: progress, videoTaskStatus: status } });
                               });
                               if (!signal.aborted && videoUrl) await downloadAndSaveVideo(videoUrl, nodeId, signal);
                           }
                       }
                   } catch (err) {
                       console.error('[Video节点] 恢复任务失败:', err);
                       updateNode(nodeId, { status: 'error', data: { ...node.data, videoTaskId: undefined, videoTaskStatus: 'FAILURE', videoFailReason: err instanceof Error ? err.message : String(err) } });
                   }
                   return;
               }
               
               // 前置验证：提前检查必需参数
               if (!combinedPrompt) {
                   updateNode(nodeId, { status: 'error' });
                   console.warn('[Video节点] 执行失败：无提示词');
                   return;
               }
               
               // 📝 处理图片数据：确保格式正确
               let processedImages: string[] = [];
               if (inputImages.length > 0) {
                   for (const img of inputImages) {
                       if (img.startsWith('/files/')) {
                           console.log('[Video节点] 检测到本地路径，开始转换为 base64:', img);
                           try {
                               const fullUrl = `${window.location.origin}${img}`;
                               const response = await fetch(fullUrl);
                               if (!response.ok) throw new Error(`获取图片失败: ${response.status}`);
                               const blob = await response.blob();
                               const base64 = await new Promise<string>((resolve, reject) => {
                                   const reader = new FileReader();
                                   reader.onloadend = () => resolve(reader.result as string);
                                   reader.onerror = reject;
                                   reader.readAsDataURL(blob);
                               });
                               console.log('[Video节点] 本地路径已转换为 base64, 大小:', (base64.length / 1024).toFixed(2), 'KB');
                               processedImages.push(base64);
                           } catch (err) {
                               console.error('[Video节点] 转换本地图片失败:', err);
                               throw new Error(`无法读取本地图片: ${img}`);
                           }
                       } else if (img.startsWith('data:image')) {
                           const match = img.match(/^data:image\/(\w+);base64,/);
                           if (match) {
                               const format = match[1].toLowerCase();
                               if (['png', 'jpg', 'jpeg', 'webp'].includes(format)) {
                                   processedImages.push(img);
                               } else {
                                   throw new Error(`不支持的图片格式: ${format}`);
                               }
                           } else {
                               throw new Error('Base64 图片格式错误');
                           }
                       } else if (img.startsWith('http://') || img.startsWith('https://')) {
                           if (img.includes('localhost') || img.includes('127.0.0.1')) {
                               try {
                                   const response = await fetch(img);
                                   if (!response.ok) throw new Error(`获取图片失败: ${response.status}`);
                                   const blob = await response.blob();
                                   const base64 = await new Promise<string>((resolve, reject) => {
                                       const reader = new FileReader();
                                       reader.onloadend = () => resolve(reader.result as string);
                                       reader.onerror = reject;
                                       reader.readAsDataURL(blob);
                                   });
                                   processedImages.push(base64);
                               } catch (err) {
                                   throw new Error(`无法读取本地图片: ${img}`);
                               }
                           } else {
                               processedImages.push(img);
                           }
                       } else {
                           throw new Error('不支持的图片数据格式');
                       }
                   }
               }
               
               try {
                   const videoSize = node.data?.videoSize || '1280x720';
                   const aspectRatio = (node.data?.veoAspectRatio || (videoSize === '720x1280' ? '9:16' : '16:9')) as '16:9' | '9:16';

                   if (family === 'unified') {
                       const veoMode = node.data?.veoMode || 'text2video';
                       if (veoMode === 'image2video' && processedImages.length === 0) throw new Error('图生视频模式需要连接1张图片');
                       if (veoMode === 'keyframes' && processedImages.length < 2) throw new Error('首尾帧模式需要连接2张图片（上=首帧，下=尾帧）');
                       if (veoMode === 'multi-reference' && processedImages.length === 0) throw new Error('多图参考模式需要连接1-3张图片');

                       const { createUnifiedVideoTask, waitForUnifiedVideoCompletion } = await import('../../services/unifiedVideoService');
                       const taskId = await createUnifiedVideoTask({
                           model: videoModel,
                           prompt: combinedPrompt,
                           images: processedImages.length > 0 ? processedImages : undefined,
                           aspectRatio,
                           duration: (node.data?.videoSeconds || '10') as '10' | '15' | '25',
                           hd: videoModel === 'sora-2-pro',
                           enhancePrompt: node.data?.veoEnhancePrompt ?? false,
                           enableUpsample: node.data?.veoEnableUpsample ?? false,
                       });
                       updateNode(nodeId, { data: { ...node.data, videoTaskId: taskId } });
                       saveCurrentCanvas();
                       const videoUrl = await waitForUnifiedVideoCompletion(taskId, (progress, status) => {
                           updateNode(nodeId, { data: { ...nodesRef.current.find(n => n.id === nodeId)?.data, videoProgress: progress, videoTaskStatus: status } });
                       });
                       if (signal.aborted) return;
                       if (videoUrl) await downloadAndSaveVideo(videoUrl, nodeId, signal);
                       else throw new Error('未返回视频URL');
                   } else if (family === 'kling' && videoModel === 'kling-video-o1') {
                       const { createKlingO1Task, waitForKlingOmniCompletion, isKlingServerAccessibleVideoUrl } = await import('../../services/klingVideoService');
                       if (inputVideos.length > 0 && !isKlingServerAccessibleVideoUrl(inputVideos[0])) {
                           updateNode(nodeId, { status: 'error', data: { ...node.data, videoFailReason: '当前为本地或不可访问的视频地址，无法作为参考视频。视频上传功能服务器尚在开发中，请暂时使用可公网访问的视频 URL，或先断开视频输入仅用图片生成。' } });
                           return;
                       }
                       const klingResolution = node.data?.klingResolution ?? '1080p';
                       const klingAspectRatio = node.data?.klingAspectRatio ?? '16:9';
                       const rawDur = node.data?.klingDuration ?? '5';
                       const klingDuration: '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' = (rawDur === 'auto' || !['3','4','5','6','7','8','9','10'].includes(rawDur)) ? '5' : rawDur;
                       const taskId = await createKlingO1Task({
                           prompt: combinedPrompt,
                           image_list: processedImages.length > 0 ? processedImages.map(url => ({ image_url: url })) : undefined,
                           video_list: inputVideos.length > 0 ? [{ video_url: inputVideos[0], refer_type: 'base', keep_original_sound: 'no' }] : undefined,
                           element_list: [],
                           mode: klingResolution === '720p' ? 'std' : 'pro',
                           aspect_ratio: (klingAspectRatio === 'auto' ? '16:9' : klingAspectRatio) as '16:9' | '9:16' | '1:1',
                           duration: klingDuration,
                       });
                       updateNode(nodeId, { data: { ...node.data, videoTaskId: taskId } });
                       saveCurrentCanvas();
                       const videoUrl = await waitForKlingOmniCompletion(taskId, (progress, status) => {
                           updateNode(nodeId, { data: { ...nodesRef.current.find(n => n.id === nodeId)?.data, videoProgress: progress, videoTaskStatus: status } });
                       });
                       if (signal.aborted) return;
                       if (videoUrl) await downloadAndSaveVideo(videoUrl, nodeId, signal);
                       else throw new Error('未返回视频URL');
                   } else if (family === 'kling') {
                       const klingMode = node.data?.klingMode || 'image2video';
                       const klingDur26 = node.data?.klingDuration === '10' ? '10' : node.data?.klingDuration === 'auto' ? 'auto' : '5';
                       const { createKlingVideoTask, waitForKlingCompletion } = await import('../../services/klingVideoService');
                       const taskId = await createKlingVideoTask({
                           model: videoModel as 'kling-video-v2.6' | 'kling-video-o1',
                           mode: klingMode,
                           prompt: combinedPrompt,
                           images: processedImages.length > 0 ? processedImages : undefined,
                           duration: klingDur26,
                           sound: processedImages.length >= 2 ? 'off' : (node.data?.klingSound ?? 'off'),
                           negative_prompt: node.data?.klingNegativePrompt || undefined,
                       });
                       updateNode(nodeId, { data: { ...node.data, videoTaskId: taskId } });
                       saveCurrentCanvas();
                       const videoUrl = await waitForKlingCompletion(taskId, klingMode, (progress, status) => {
                           updateNode(nodeId, { data: { ...nodesRef.current.find(n => n.id === nodeId)?.data, videoProgress: progress, videoTaskStatus: status } });
                       });
                       if (signal.aborted) return;
                       if (videoUrl) await downloadAndSaveVideo(videoUrl, nodeId, signal);
                       else throw new Error('未返回视频URL');
                   } else {
                       if (videoModel === 'minimax-hailuo-2.3-fast' && processedImages.length === 0) {
                           updateNode(nodeId, { status: 'error', data: { ...node.data, videoFailReason: '海螺 2.3 Fast 仅支持图生视频，请连接图片节点作为输入' } });
                           return;
                       }
                       if (processedImages.length >= 2) {
                           updateNode(nodeId, { status: 'error', data: { ...node.data, videoFailReason: '海螺不支持多图，请仅连接 1 张图片' } });
                           return;
                       }
                       // 与 Veo 一致：图片来自 resolveInputs(nodeId) + 所连 video-output 上游，已并入 inputImages → processedImages
                       const { createMinimaxVideoTask, waitForMinimaxCompletion } = await import('../../services/minimaxVideoService');
                       const taskId = await createMinimaxVideoTask({
                           model: videoModel as 'minimax-hailuo-2.3' | 'minimax-hailuo-2.3-fast',
                           prompt: combinedPrompt,
                           images: processedImages.length > 0 ? processedImages : undefined,
                           resolution: (node.data?.minimaxResolution || '1080P') as '768P' | '1080P',
                           duration: node.data?.minimaxDuration ?? 6,
                       });
                       updateNode(nodeId, { data: { ...node.data, videoTaskId: taskId } });
                       saveCurrentCanvas();
                       const videoUrl = await waitForMinimaxCompletion(taskId, (progress, status) => {
                           updateNode(nodeId, { data: { ...nodesRef.current.find(n => n.id === nodeId)?.data, videoProgress: progress, videoTaskStatus: status } });
                       });
                       if (signal.aborted) return;
                       if (videoUrl) await downloadAndSaveVideo(videoUrl, nodeId, signal);
                       else throw new Error('未返回视频URL');
                   }
               } catch (err) {
                   console.error('[Video节点] 生成失败:', err);
                   if (!signal.aborted) {
                       updateNode(nodeId, { 
                           status: 'error',
                           data: { ...node.data, videoTaskId: undefined, videoTaskStatus: 'FAILURE', videoFailReason: err instanceof Error ? err.message : String(err) }
                       });
                   }
               }
          }
          else if (node.type === 'text') {
               // Text节点：容器模式 - 接收上游文本内容
               // 重新获取输入（因为上游可能刚执行完）
               const freshInputs = resolveInputs(nodeId);
               const inputTexts = freshInputs.texts;
               
               // 检查是否有上游连接
               const hasUpstreamConnection = connectionsRef.current.some(c => c.toNode === nodeId);
               
               // 如果有上游连接，作为纯容器使用
               if (hasUpstreamConnection) {
                   if (inputTexts.length > 0) {
                       // 直接显示上游内容（容器模式）
                       const mergedText = inputTexts.join('\n\n');
                       if (!signal.aborted) {
                           updateNode(nodeId, { 
                               content: mergedText, 
                               status: 'completed' 
                           });
                       }
                   } else {
                       // 上游还没有输出
                       updateNode(nodeId, { status: 'error' });
                       console.warn('上游节点无输出');
                   }
               } else if (node.content) {
                   // 没有上游连接，但有自身内容，使用LLM扩展
                   const result = await generateCreativeText(node.content);
                   if (!signal.aborted) {
                       updateNode(nodeId, { 
                           title: result.title, 
                           content: result.content, 
                           status: 'completed' 
                       });
                   }
               } else {
                   // 无上游输入且无自身内容
                   updateNode(nodeId, { status: 'error' });
                   console.warn('文本节点执行失败：无内容');
               }
          }
          else if (node.type === 'llm') {
              // LLM节点：可以处理图片+文本输入
              // 执行后创建文字节点展示结果
              const nodePrompt = node.data?.prompt || '';
              const inputTexts = inputs.texts.join('\n');
              // 🔧 上游输入优先替代节点自身prompt
              const userPrompt = inputTexts || nodePrompt;
              const systemPrompt = node.data?.systemInstruction;
              const inputImages = inputs.images;
              
              if (!userPrompt && inputImages.length === 0) {
                  updateNode(nodeId, { status: 'error' });
                  console.warn('LLM节点执行失败：无输入');
              } else {
                  // 🔧 每次运行都创建新的文字节点展示输出
                  const outputNodeId = uuid();
                  const outputNode: CanvasNode = {
                      id: outputNodeId,
                      type: 'text',
                      title: 'LLM输出',
                      content: '',
                      x: node.x + node.width + 100,
                      y: node.y,
                      width: 300,
                      height: 200,
                      data: {},
                      status: 'running'
                  };
                  
                  const newConnection = {
                      id: uuid(),
                      fromNode: nodeId,
                      toNode: outputNodeId
                  };
                  
                  setNodes(prev => [...prev, outputNode]);
                  setConnections(prev => [...prev, newConnection]);
                  setHasUnsavedChanges(true);
                  console.log(`[LLM] 已创建输出文字节点 ${outputNodeId.slice(0,8)}`);
                  
                  // 调用 LLM API
                  const result = await generateAdvancedLLM(userPrompt, systemPrompt, inputImages);
                  if (!signal.aborted) {
                      // 更新LLM节点自身的输出（供下游节点获取）
                      updateNode(nodeId, { 
                          data: { ...node.data, output: result },
                          status: 'completed' 
                      });
                      
                      // 更新输出节点内容
                      if (result) {
                          updateNode(outputNodeId, { 
                              content: result,
                              status: 'completed' 
                          });
                      } else {
                          updateNode(outputNodeId, { status: 'error' });
                      }
                  }
              }
          }
          else if (node.type === 'resize') {
              // Resize节点：需要上游图片输入
              const inputImages = inputs.images;
              
              if (inputImages.length === 0) {
                  updateNode(nodeId, { status: 'error' });
                  console.warn('Resize节点执行失败：无输入图片');
              } else {
                  const src = inputImages[0];
                  const mode = node.data?.resizeMode || 'longest';
                  const w = node.data?.resizeWidth || 1024;
                  const h = node.data?.resizeHeight || 1024;
                  const resized = await resizeImageClient(src, mode, w, h);
                  if (!signal.aborted) {
                      updateNode(nodeId, { content: resized, status: 'completed' });
                      
                      // 同步到桌面对应画布文件夹
                      if (resized && onImageGenerated) onImageGenerated(resized, 'Resize结果', currentCanvasId || undefined, canvasName);
                      
                      // 🔧 保存画布
                      saveCurrentCanvas();
                  }
              }
          }
          else if (node.type === 'remove-bg') {
              // Remove-BG节点:需要上游图片输入
              const inputImages = inputs.images;
                        
              if (inputImages.length === 0) {
                  updateNode(nodeId, { status: 'error' });
                  console.warn('Remove-BG节点执行失败:无输入图片');
              } else {
                  // 🎯 修复:点击RUN立即创建输出节点,显示loading状态
                  console.log(`[Remove-BG] 开始执行,立即创建输出节点`);
                            
                  // 1. 立即创建右侧Image节点(空白+loading)
                  const outputNodeId = uuid();
                  const outputNode: CanvasNode = {
                      id: outputNodeId,
                      type: 'image',
                      content: '', // 空白,等待API返回
                      x: node.x + node.width + 100,
                      y: node.y,
                      width: 300,
                      height: 300,
                      data: {},
                      status: 'running' // loading状态
                  };
                            
                  const newConnection = {
                      id: uuid(),
                      fromNode: nodeId,
                      toNode: outputNodeId
                  };
                            
                  // 2. 立即更新UI:添加节点+连接
                  setNodes(prev => [...prev, outputNode]);
                  setConnections(prev => [...prev, newConnection]);
                  setHasUnsavedChanges(true);
                  console.log(`[Remove-BG] 已创建输出节点 ${outputNodeId.slice(0,8)}, 状态:running`);
                            
                  // 3. 调用API
                  const prompt = "Remove the background, keep subject on transparent or white background";
                  const result = await editCreativeImage([inputImages[0]], prompt, undefined, signal);
                            
                  if (!signal.aborted) {
                      if (result) {
                          console.log(`[Remove-BG] API返回成功,更新输出节点内容`);
                                    
                          // 🔥 提取图片元数据
                          const metadata = await extractImageMetadata(result);
                          console.log(`[Remove-BG] 图片元数据:`, metadata);
                                    
                          // 4. 更新已存在的输出节点:填充内容+元数据
                          updateNode(outputNodeId, { 
                              content: result,
                              status: 'completed',
                              data: { imageMetadata: metadata }
                          });
                                    
                          // 5. 标记工具节点完成
                          updateNode(nodeId, { status: 'completed' });
                          
                          // 同步到桌面对应画布文件夹
                          if (onImageGenerated) onImageGenerated(result, '抠图结果', currentCanvasId || undefined, canvasName);
                          
                          // 🔧 保存画布
                          saveCurrentCanvas();
                      } else {
                          // API失败,更新输出节点为error
                          updateNode(outputNodeId, { status: 'error' });
                          updateNode(nodeId, { status: 'error' });
                      }
                  }
              }
          }
          else if (node.type === 'upscale') {
              // Upscale节点:高清放大处理
              const inputImages = inputs.images;
                        
              console.log(`[Upscale] 收集到的输入图片数量: ${inputImages.length}`);
              if (inputImages.length > 0) {
                  console.log(`[Upscale] 图片预览:`, inputImages[0]?.slice(0, 80));
              }
                        
              if (inputImages.length === 0) {
                  updateNode(nodeId, { status: 'error' });
                  console.error('❌ Upscale节点执行失败:无输入图片!请检查上游节点是否已执行完成');
              } else {
                  // 🎯 修复:点击RUN立即创建输出节点,显示loading状态
                  console.log(`[Upscale] 开始执行,立即创建输出节点`);
                            
                  // 1. 立即创建右侧Image节点(空白+loading)
                  const outputNodeId = uuid();
                  const outputNode: CanvasNode = {
                      id: outputNodeId,
                      type: 'image',
                      content: '', // 空白,等待API返回
                      x: node.x + node.width + 100,
                      y: node.y,
                      width: 300,
                      height: 300,
                      data: {},
                      status: 'running' // loading状态
                  };
                            
                  const newConnection = {
                      id: uuid(),
                      fromNode: nodeId,
                      toNode: outputNodeId
                  };
                            
                  // 2. 立即更新UI:添加节点+连接
                  setNodes(prev => [...prev, outputNode]);
                  setConnections(prev => [...prev, newConnection]);
                  setHasUnsavedChanges(true);
                  console.log(`[Upscale] 已创建输出节点 ${outputNodeId.slice(0,8)}, 状态:running`);
                            
                  // 3. 调用API
                  const prompt = "Upscale this image to high resolution while preserving all original details, colors, and composition. Enhance clarity and sharpness without altering the content.";
                  const upscaleResolution = node.data?.settings?.resolution || '2K';
                  const upscaleConfig: GenerationConfig = {
                      resolution: upscaleResolution as '1K' | '2K' | '4K'
                  };
                  console.log(`[Upscale] 开始调用API,分辨率: ${upscaleResolution}`);
                  const result = await editCreativeImage([inputImages[0]], prompt, upscaleConfig, signal);
                  console.log(`[Upscale] API调用完成,result:`, result ? `有图片 (${result.slice(0,50)}...)` : 'null');
                            
                  if (!signal.aborted) {
                      if (result) {
                          console.log(`[Upscale] API返回成功,更新输出节点内容`);
                                    
                          // 🔥 提取图片元数据
                          const metadata = await extractImageMetadata(result);
                          console.log(`[Upscale] 图片元数据:`, metadata);
                                    
                          // 4. 更新已存在的输出节点:填充内容+元数据
                          updateNode(outputNodeId, { 
                              content: result,
                              status: 'completed',
                              data: { imageMetadata: metadata }
                          });
                                    
                          // 5. 标记工具节点完成
                          updateNode(nodeId, { status: 'completed' });
                          
                          // 同步到桌面对应画布文件夹
                          if (onImageGenerated) onImageGenerated(result, '放大结果', currentCanvasId || undefined, canvasName);
                          
                          // 🔧 保存画布
                          saveCurrentCanvas();
                      } else {
                          console.error(`[Upscale] API返回失败,result为空`);
                          // API失败,更新输出节点为error
                          updateNode(outputNodeId, { status: 'error' });
                          updateNode(nodeId, { status: 'error' });
                      }
                  }
              }
          }
          else if (node.type === 'bp') {
              // BP节点：内置智能体+模板，执行图片生成
              const bpTemplate = node.data?.bpTemplate;
              const bpInputs = node.data?.bpInputs || {};
              const inputImages = inputs.images;
              
              if (!bpTemplate) {
                  updateNode(nodeId, { status: 'error' });
                  console.error('BP节点执行失败：无模板配置');
              } else {
                  try {
                      const bpFields = bpTemplate.bpFields || [];
                      const inputFields = bpFields.filter(f => f.type === 'input');
                      const agentFields = bpFields.filter(f => f.type === 'agent');
                      
                      console.log('[BP节点] 原始输入:', bpInputs);
                      console.log('[BP节点] 字段配置:', bpFields);
                      console.log('[BP节点] Input字段:', inputFields.map(f => f.name));
                      console.log('[BP节点] Agent字段:', agentFields.map(f => f.name));
                      
                      // 1. 收集用户输入值（input字段）
                      const userInputValues: Record<string, string> = {};
                      for (const field of inputFields) {
                          // input字段从bpInputs中取值（可以是field.id或field.name）
                          userInputValues[field.name] = bpInputs[field.id] || bpInputs[field.name] || '';
                          console.log(`[BP节点] Input ${field.name} = "${userInputValues[field.name]}"`);
                      }
                      
                      // 2. 按顺序执行智能体字段（agent字段）
                      const agentResults: Record<string, string> = {};
                      
                      for (const field of agentFields) {
                          if (field.agentConfig) {
                              // 准备agent的instruction：替换其中的变量
                              let instruction = field.agentConfig.instruction;
                              
                              // 替换 /inputName 为用户输入值
                              for (const [name, value] of Object.entries(userInputValues)) {
                                  instruction = instruction.split(`/${name}`).join(value);
                              }
                              
                              // 替换 {agentName} 为已执行的agent结果
                              for (const [name, result] of Object.entries(agentResults)) {
                                  instruction = instruction.split(`{${name}}`).join(result);
                              }
                              
                              console.log(`[BP节点] 执行Agent ${field.name}, instruction:`, instruction.slice(0, 200));
                              
                              // 调用LLM执行agent
                              try {
                                  const agentResult = await generateAdvancedLLM(
                                      instruction, // instruction作为user prompt
                                      'You are a creative assistant. Generate content based on the given instruction. Output ONLY the requested content, no explanations.',
                                      inputImages.length > 0 ? [inputImages[0]] : undefined
                                  );
                                  agentResults[field.name] = agentResult;
                                  console.log(`[BP节点] Agent ${field.name} 返回:`, agentResult.slice(0, 100));
                              } catch (agentErr) {
                                  console.error(`[BP节点] Agent ${field.name} 执行失败:`, agentErr);
                                  agentResults[field.name] = `[Agent错误: ${agentErr}]`;
                              }
                          }
                      }
                      
                      // 3. 替换最终模板中的所有变量
                      let finalPrompt = bpTemplate.prompt;
                      console.log('[BP节点] 原始模板:', finalPrompt);
                      
                      // 替换 /inputName 为用户输入值
                      for (const [name, value] of Object.entries(userInputValues)) {
                          const beforeReplace = finalPrompt;
                          finalPrompt = finalPrompt.split(`/${name}`).join(value);
                          if (beforeReplace !== finalPrompt) {
                              console.log(`[BP节点] 替换 /${name} -> ${value.slice(0, 50)}`);
                          }
                      }
                      
                      // 替换 {agentName} 为agent结果
                      for (const [name, result] of Object.entries(agentResults)) {
                          const beforeReplace = finalPrompt;
                          finalPrompt = finalPrompt.split(`{${name}}`).join(result);
                          if (beforeReplace !== finalPrompt) {
                              console.log(`[BP节点] 替换 {${name}} -> ${result.slice(0, 50)}`);
                          }
                      }
                      
                      console.log('[BP节点] 最终提示词:', finalPrompt.slice(0, 300));
                      
                      // 4. 调用图片生成API
                      const settings = node.data?.settings || {};
                      const aspectRatio = settings.aspectRatio || 'AUTO';
                      const resolution = settings.resolution || '2K';
                      
                      let result: string | null = null;
                      if (inputImages.length > 0) {
                          // 有输入图片 = 图生图
                          let config: GenerationConfig | undefined = undefined;
                          if (aspectRatio === 'AUTO') {
                              // AUTO 模式：只传 resolution（如果不是默认值）
                              if (resolution !== 'AUTO' && resolution !== '1K') {
                                  config = { resolution: resolution as '1K' | '2K' | '4K' };
                              }
                          } else {
                              config = { aspectRatio, resolution: resolution as '1K' | '2K' | '4K' };
                          }
                          console.log('[BP节点] 调用图生图 API, 配置:', { aspectRatio, resolution, config });
                          result = await editCreativeImage(inputImages, finalPrompt, config, signal);
                      } else {
                          // 无输入图片 = 文生图
                          const config: GenerationConfig = {
                              aspectRatio: aspectRatio !== 'AUTO' ? aspectRatio : '1:1',
                              resolution: resolution as '1K' | '2K' | '4K'
                          };
                          console.log('[BP节点] 调用文生图 API, 配置:', config);
                          result = await generateCreativeImage(finalPrompt, config, signal);
                      }
                      
                      console.log('[BP节点] API返回结果:', result ? `有图片 (${result.slice(0,50)}...)` : 'null');
                      
                      if (!signal.aborted) {
                          // 检查是否有下游连接
                          const hasDownstream = connectionsRef.current.some(c => c.fromNode === nodeId);
                          console.log('[BP节点] 有下游连接:', hasDownstream);
                          
                          if (hasDownstream) {
                              // 有下游连接：结果存到 data.output，保持节点原貌
                              console.log('[BP节点] 有下游，结果存到 data.output');
                              updateNode(nodeId, {
                                  data: { ...node.data, output: result || '' },
                                  status: result ? 'completed' : 'error'
                              });
                          } else {
                              // 无下游连接：结果存到 content，显示图片
                              console.log('[BP节点] 无下游，结果存到 content');
                              updateNode(nodeId, {
                                  content: result || '',
                                  status: result ? 'completed' : 'error'
                              });
                          }
                          
                          // 保存画布
                          saveCurrentCanvas();
                          
                          // 同步到桌面
                          if (result && onImageGenerated) {
                              onImageGenerated(result, finalPrompt, currentCanvasId || undefined, canvasName);
                          }
                      }
                  } catch (err) {
                      console.error('BP节点执行失败:', err);
                      updateNode(nodeId, { status: 'error' });
                  }
              }
          }
          else if (node.type === 'comfyui' || node.type === 'comfy-config') {
              // ComfyUI / Comfy-Config 节点：从 Tab 配置的工作流取 JSON，代入暴露参数后提交（共用同一套执行逻辑）
              const baseUrl = (node.data?.comfyBaseUrl || getComfyUIConfig().baseUrl || '').trim();
              const workflowId = node.data?.workflowId ?? '';
              const comfyInputs = node.data?.comfyInputs ?? {};

              if (!baseUrl) {
                  updateNode(nodeId, { status: 'error', data: { ...node.data, error: '请配置 ComfyUI 地址（节点内或 ComfyUI Tab）' } });
                  return;
              }
              if (!workflowId) {
                  updateNode(nodeId, { status: 'error', data: { ...node.data, error: '请选择工作流（在 ComfyUI Tab 中先配置）' } });
                  return;
              }

              const workflowsRes = await getComfyUIWorkflows();
              if (!workflowsRes.success || !workflowsRes.data) {
                  updateNode(nodeId, { status: 'error', data: { ...node.data, error: '获取工作流列表失败' } });
                  return;
              }
              const workflow = workflowsRes.data.find((w) => w.id === workflowId);
              if (!workflow || !workflow.workflowApiJson) {
                  updateNode(nodeId, { status: 'error', data: { ...node.data, error: '工作流不存在或已删除' } });
                  return;
              }

              try {
                  let prompt: Record<string, Record<string, unknown>>;
                  try {
                      prompt = JSON.parse(workflow.workflowApiJson) as Record<string, Record<string, unknown>>;
                  } catch (_) {
                      updateNode(nodeId, { status: 'error', data: { ...node.data, error: '工作流 JSON 格式无效' } });
                      return;
                  }
                  // 暴露到画布的参数：用户填了用用户值，未填用默认值；未暴露的保持工作流 JSON 原值
                  (workflow.inputSlots || []).filter((s) => s.exposed).forEach((slot) => {
                      const raw = comfyInputs[slot.slotKey];
                      const slotDefault = (slot as { defaultValue?: string }).defaultValue;
                      const hasUserValue = raw !== undefined && raw !== null && String(raw).trim() !== '';
                      const val = hasUserValue ? raw : (slotDefault ?? '');
                      const hasEffective = val !== undefined && val !== null && String(val).trim() !== '';
                      if (!hasEffective) return; // 无用户值且无默认值，不替换，沿用工作流原值
                      if (!slot.nodeId || !prompt[slot.nodeId]?.inputs || !slot.inputName) return;
                      if (slot.type === 'INT') prompt[slot.nodeId].inputs[slot.inputName] = parseInt(String(val), 10) || 0;
                      else if (slot.type === 'FLOAT') prompt[slot.nodeId].inputs[slot.inputName] = parseFloat(String(val)) || 0;
                      else if (slot.type === 'BOOLEAN') prompt[slot.nodeId].inputs[slot.inputName] = val === 'true' || val === '1';
                      else prompt[slot.nodeId].inputs[slot.inputName] = String(val);
                  });
                  const submitRes = await comfyuiSubmitPrompt(prompt as Record<string, unknown>, baseUrl);
                  if (!submitRes.success || !submitRes.promptId) {
                      const errStr = typeof submitRes.error === 'string' ? submitRes.error : (submitRes.error && typeof submitRes.error === 'object' && 'message' in submitRes.error ? String((submitRes.error as { message?: unknown }).message) : String(submitRes.error ?? ''));
                      const displayError = (errStr || '提交失败') + (
                          /validation|failed validation|validate/i.test(errStr)
                              ? '\n\n建议：① 工作流中引用的模型（大模型、LoRA 等）是否已放入 ComfyUI 对应目录；② 在 ComfyUI 界面中直接运行该工作流是否正常；③ 必填参数是否已填写。'
                              : ''
                      );
                      updateNode(nodeId, { status: 'error', data: { ...node.data, error: displayError } });
                      return;
                  }
                  const promptId = submitRes.promptId;
                  let attempts = 0;
                  const maxAttempts = 120; // 约 4 分钟
                  const apiBase = '/api';
                  while (attempts < maxAttempts && !signal.aborted) {
                      await new Promise(r => setTimeout(r, 2000));
                      const histRes = await comfyuiGetHistory(promptId, baseUrl);
                      if (!histRes.success || !histRes.data?.[promptId]) {
                          attempts++;
                          continue;
                      }
                      const item = histRes.data[promptId];
                      const outputs = item?.outputs as Record<string, { images?: Array<{ filename: string; subfolder?: string; type?: string }>; gifs?: Array<{ filename: string; subfolder?: string; type?: string }> }> | undefined;
                      if (outputs) {
                          const imageUrls: string[] = [];
                          const videoUrls: string[] = [];
                          for (const nodeOutput of Object.values(outputs)) {
                              const imgs = nodeOutput?.images || [];
                              for (const img of imgs) {
                                  const params = new URLSearchParams({ baseUrl, filename: img.filename, subfolder: img.subfolder || '', type: img.type || 'output' });
                                  imageUrls.push(`${apiBase}/comfyui/view?${params.toString()}`);
                              }
                              const gifs = nodeOutput?.gifs || [];
                              for (const g of gifs) {
                                  const params = new URLSearchParams({ baseUrl, filename: g.filename, subfolder: g.subfolder || '', type: g.type || 'output' });
                                  videoUrls.push(`${apiBase}/comfyui/view?${params.toString()}`);
                              }
                          }
                          const hasOutput = imageUrls.length > 0 || videoUrls.length > 0;
                          if (hasOutput) {
                              updateNode(nodeId, {
                                  status: 'completed',
                                  data: { ...node.data, outputImages: imageUrls, outputVideos: videoUrls, outputPromptId: promptId, error: undefined }
                              });
                              // 先创建 N 个 image/video-output 节点，再合并为一个预览节点
                              const comfyNode = nodesRef.current.find(n => n.id === nodeId)!;
                              const startX = comfyNode.x + comfyNode.width + 80;
                              const outIds: string[] = [];
                              let offsetY = 0;
                              for (const url of imageUrls) {
                                  const outId = uuid();
                                  outIds.push(outId);
                                  const imgNode: CanvasNode = {
                                      id: outId,
                                      type: 'image',
                                      content: url,
                                      x: startX,
                                      y: comfyNode.y + offsetY,
                                      width: 300,
                                      height: 300,
                                      data: {},
                                      status: 'completed'
                                  };
                                  nodesRef.current = [...nodesRef.current, imgNode];
                                  connectionsRef.current = [...connectionsRef.current, { id: uuid(), fromNode: nodeId, toNode: outId }];
                                  setNodes(prev => [...prev, imgNode]);
                                  setConnections(prev => [...prev, { id: uuid(), fromNode: nodeId, toNode: outId }]);
                                  offsetY += 320;
                                  if (onImageGenerated) onImageGenerated(url, 'ComfyUI 输出', currentCanvasId || undefined, canvasName);
                              }
                              for (const url of videoUrls) {
                                  const outId = uuid();
                                  outIds.push(outId);
                                  const vidNode: CanvasNode = {
                                      id: outId,
                                      type: 'video-output',
                                      content: url,
                                      x: startX,
                                      y: comfyNode.y + offsetY,
                                      width: 400,
                                      height: 225,
                                      data: {},
                                      status: 'completed'
                                  };
                                  nodesRef.current = [...nodesRef.current, vidNode];
                                  connectionsRef.current = [...connectionsRef.current, { id: uuid(), fromNode: nodeId, toNode: outId }];
                                  setNodes(prev => [...prev, vidNode]);
                                  setConnections(prev => [...prev, { id: uuid(), fromNode: nodeId, toNode: outId }]);
                                  offsetY += 245;
                                  if (onImageGenerated) onImageGenerated(url, 'ComfyUI 视频输出', currentCanvasId || undefined, canvasName, true);
                              }
                              const previewItems = [...imageUrls, ...videoUrls];
                              const previewItemTypes: ('image' | 'video')[] = [...imageUrls.map(() => 'image' as const), ...videoUrls.map(() => 'video' as const)];
                              setNodes(prev => prev.filter(n => !outIds.includes(n.id)));
                              setConnections(prev => prev.filter(c => !outIds.includes(c.toNode)));
                              nodesRef.current = nodesRef.current.filter(n => !outIds.includes(n.id));
                              connectionsRef.current = connectionsRef.current.filter(c => !outIds.includes(c.toNode));
                              if (previewItems.length <= 1) {
                                  const url = previewItems[0];
                                  const isVideo = videoUrls.length > 0;
                                  const outId = uuid();
                                  const outNode: CanvasNode = {
                                      id: outId,
                                      type: isVideo ? 'video-output' : 'image',
                                      content: url || '',
                                      x: startX,
                                      y: comfyNode.y,
                                      width: isVideo ? 400 : 300,
                                      height: isVideo ? 225 : 300,
                                      data: {},
                                      status: 'completed'
                                  };
                                  const newConn: Connection = { id: uuid(), fromNode: nodeId, toNode: outId };
                                  setNodes(prev => [...prev, outNode]);
                                  setConnections(prev => [...prev, newConn]);
                                  nodesRef.current = [...nodesRef.current, outNode];
                                  connectionsRef.current = [...connectionsRef.current, newConn];
                                  if (url && onImageGenerated) onImageGenerated(url, isVideo ? 'ComfyUI 视频输出' : 'ComfyUI 输出', currentCanvasId || undefined, canvasName, isVideo);
                              } else {
                                  const previewNodeId = uuid();
                                  const previewNode: CanvasNode = {
                                      id: previewNodeId,
                                      type: 'preview',
                                      title: '预览',
                                      content: previewItems[0] || '',
                                      x: startX,
                                      y: comfyNode.y,
                                      width: 320,
                                      height: 320,
                                      status: 'completed',
                                      data: { previewItems, previewCoverIndex: 0, previewItemTypes, previewExpectedCount: previewItems.length }
                                  };
                                  const newConn: Connection = { id: uuid(), fromNode: nodeId, toNode: previewNodeId };
                                  setNodes(prev => [...prev, previewNode]);
                                  setConnections(prev => [...prev, newConn]);
                                  nodesRef.current = [...nodesRef.current, previewNode];
                                  connectionsRef.current = [...connectionsRef.current, newConn];
                                  // 异步批量保存到桌面子文件夹
                                  const hasVideo = previewItemTypes.some(t => t === 'video');
                                  saveBatchToDesktopFolder(previewItems, 0, 'ComfyUI批量', hasVideo);
                              }
                              saveCurrentCanvas();
                              return;
                          }
                      }
                      attempts++;
                  }
                  updateNode(nodeId, { status: 'error', data: { ...node.data, error: '执行超时或未获取到输出' } });
              } catch (err) {
                  console.error('[ComfyUI] 执行失败:', err);
                  updateNode(nodeId, { status: 'error', data: { ...node.data, error: (err as Error).message } });
              }
          }
          else if (node.type === 'runninghub') {
              // RunningHub 节点：点击 RUN 后获取应用信息并创建配置节点
              const webappId = node.data?.webappId;
              
              console.log('[RunningHub] 节点执行:', { webappId });
              
              if (!webappId) {
                  // 无应用 ID，报错
                  updateNode(nodeId, { status: 'error', data: { ...node.data, error: '请先输入应用 ID' } });
                  console.error('[RunningHub] 无应用 ID');
              } else {
                  // 获取应用信息
                  try {
                      console.log('[RunningHub] 获取应用信息...');
                      const appInfoResult = await getAIAppInfo(webappId);
                      
                      if (!appInfoResult.success || !appInfoResult.data) {
                          throw new Error(appInfoResult.error || '获取应用信息失败');
                      }
                      
                      const appInfo = appInfoResult.data;
                      const appName = appInfo.webappName || webappId;
                      console.log('[RunningHub] 获取应用信息成功:', appName);
                      
                      // 更新当前节点的 appInfo
                      updateNode(nodeId, {
                          status: 'completed',
                          data: {
                              ...node.data,
                              appInfo,
                              error: undefined
                          }
                      });
                      
                      // 创建配置节点 (rh-config) - 大容器，包含所有 Ticket 参数卡片
                      const configNodeId = uuid();
                      const nodeWidth = 320;
                      const paramCount = appInfo.nodeInfoList?.length || 0;
                      // 布局：头部(32) + 封面图(200) + 卡片区(padding8 + 每个Ticket 52px + 8px间距)
                      const headerHeight = 32;
                      const coverHeight = 200;
                      const ticketPadding = 8;
                      const ticketHeight = 52;
                      const ticketGap = 8;
                      const paramAreaHeight = ticketPadding + paramCount * (ticketHeight + ticketGap) + ticketPadding;
                      const totalHeight = headerHeight + coverHeight + paramAreaHeight;
                      
                      const configNode: CanvasNode = {
                          id: configNodeId,
                          type: 'rh-config',
                          title: appName,
                          content: '',
                          x: node.x + node.width + 80,
                          y: node.y,
                          width: nodeWidth,
                          height: totalHeight,
                          data: {
                              webappId,
                              appInfo,
                              nodeInputs: {},
                              coverUrl: appInfo.covers?.[0]?.url || appInfo.covers?.[0]?.thumbnailUri
                          },
                          status: 'idle'
                      };
                      
                      // 初始化默认输入值
                      const defaultInputs: Record<string, string> = {};
                      appInfo.nodeInfoList?.forEach((info: any) => {
                          const key = `${info.nodeId}_${info.fieldName}`;
                          const fieldType = (info.fieldType || '').toUpperCase();
                          // 媒体类型不自动填入默认值
                          if (['IMAGE', 'VIDEO', 'AUDIO'].includes(fieldType)) {
                              defaultInputs[key] = '';
                          } else {
                              defaultInputs[key] = info.fieldValue || '';
                          }
                      });
                      configNode.data!.nodeInputs = defaultInputs;
                      
                      // 创建连接 - 连到封面图区域
                      const newConnection = {
                          id: uuid(),
                          fromNode: nodeId,
                          toNode: configNodeId,
                          toPortKey: 'cover', // 连接到封面图端口
                          toPortOffsetY: headerHeight + coverHeight / 2 // 封面图中心位置: 32 + 100 = 132
                      };
                      
                      nodesRef.current = [...nodesRef.current, configNode];
                      connectionsRef.current = [...connectionsRef.current, newConnection];
                      setNodes(prev => [...prev, configNode]);
                      setConnections(prev => [...prev, newConnection]);
                      setHasUnsavedChanges(true);
                      
                      console.log('[RunningHub] 已创建配置节点:', configNodeId.slice(0, 8));
                      saveCurrentCanvas();
                  } catch (err: any) {
                      console.error('[RunningHub] 获取应用信息失败:', err);
                      updateNode(nodeId, {
                          status: 'error',
                          data: { ...node.data, error: err.message || '获取应用信息失败' }
                      });
                  }
              }
          }
          else if (node.type === 'rh-config') {
              // RunningHub 配置节点：通过队列执行 AI 应用
              const webappId = node.data?.webappId;
              const appInfo = node.data?.appInfo;
              const nodeInputs = { ...(node.data?.nodeInputs || {}) };
              
              console.log('[RH-Config] 节点执行（入队）:', { webappId, hasAppInfo: !!appInfo, batchCount });
              
              if (!webappId || !appInfo) {
                  updateNode(nodeId, { status: 'error', data: { ...node.data, error: '缺少应用配置' } });
                  return;
              }
              
              try {
                  const appName = (appInfo as any).webappName || appInfo.title || webappId;
                  
                  // ============ 收集待上传的图片 ============
                  const currentConnections = connectionsRef.current;
                  const incomingImageConns = currentConnections.filter(c => 
                      c.toNode === nodeId && c.toPortKey && c.toPortKey !== 'cover'
                  );
                  
                  const pendingImageUploads: Array<{ portKey: string; imageData: string }> = [];
                  
                  for (const conn of incomingImageConns) {
                      const sourceNode = nodesRef.current.find(n => n.id === conn.fromNode);
                      if (!sourceNode?.content) continue;
                      
                      const hasImageContent = sourceNode.content.startsWith('data:image') ||
                          sourceNode.content.startsWith('http') ||
                          sourceNode.content.startsWith('/files/');
                      
                      if (!hasImageContent) continue;
                      
                      const portKey = conn.toPortKey!;
                      // 如果已有值，跳过
                      if (nodeInputs[portKey] && nodeInputs[portKey].length > 10) continue;
                      
                      // 转换为 base64
                      let imageData = sourceNode.content;
                      if (imageData.startsWith('/files/') || imageData.startsWith('http')) {
                          const img = new Image();
                          img.crossOrigin = 'anonymous';
                          try {
                              imageData = await new Promise<string>((resolve, reject) => {
                                  img.onload = () => {
                                      const canvas = document.createElement('canvas');
                                      canvas.width = img.naturalWidth;
                                      canvas.height = img.naturalHeight;
                                      const ctx = canvas.getContext('2d');
                                      ctx?.drawImage(img, 0, 0);
                                      resolve(canvas.toDataURL('image/png'));
                                  };
                                  img.onerror = () => reject(new Error('图片加载失败'));
                                  img.src = imageData.startsWith('/files/') ? `http://localhost:8765${imageData}` : imageData;
                              });
                          } catch (err) {
                              console.error('[RH-Config] 图片转换失败:', portKey, err);
                              continue;
                          }
                      }
                      
                      pendingImageUploads.push({ portKey, imageData });
                  }
                  
                  // ============ 构建 nodeInfoList ============
                  const nodeInfoList = appInfo.nodeInfoList?.map((info: any) => {
                      const key = `${info.nodeId}_${info.fieldName}`;
                      const hasUserValue = key in nodeInputs;
                      return {
                          nodeId: info.nodeId,
                          fieldName: info.fieldName,
                          fieldValue: hasUserValue ? (nodeInputs[key] || '') : (info.fieldValue || '')
                      };
                  }) || [];
                  
                  // ============ 创建输出节点（提前创建，显示排队状态） ============
                  const outputNodes: { id: string; batchIndex: number }[] = [];
                  for (let batchIdx = 0; batchIdx < batchCount; batchIdx++) {
                      const outputNodeId = uuid();
                      const outputNode: CanvasNode = {
                          id: outputNodeId,
                          type: 'image',
                          content: '',
                          x: node.x + node.width + 100,
                          y: node.y + (batchIdx * 420),
                          width: 400,
                          height: 400,
                          data: {},
                          status: 'running' // 显示加载状态
                      };
                      
                      const newConnection = {
                          id: uuid(),
                          fromNode: nodeId,
                          toNode: outputNodeId
                      };
                      
                      nodesRef.current = [...nodesRef.current, outputNode];
                      connectionsRef.current = [...connectionsRef.current, newConnection];
                      setNodes(prev => [...prev, outputNode]);
                      setConnections(prev => [...prev, newConnection]);
                      
                      outputNodes.push({ id: outputNodeId, batchIndex: batchIdx });
                  }
                  setHasUnsavedChanges(true);
                  
                  // ============ 入队执行 ============
                  const taskIds = rhTaskQueue.enqueueTask({
                      nodeId,
                      canvasId: currentCanvasId || undefined,
                      title: appName,
                      webappId,
                      nodeInfoList,
                      batchCount,
                      pendingImageUploads: pendingImageUploads.length > 0 ? pendingImageUploads : undefined,
                      
                      onNodeInputsUpdate: (nid, updates) => {
                          // 更新节点的 nodeInputs
                          const targetNode = nodesRef.current.find(n => n.id === nid);
                          if (targetNode) {
                              const currentInputs = targetNode.data?.nodeInputs || {};
                              updateNode(nid, {
                                  data: {
                                      ...targetNode.data,
                                      nodeInputs: { ...currentInputs, ...updates }
                                  }
                              });
                          }
                      },
                      
                      onTaskComplete: (taskId, batchIndex, result, status) => {
                          // 直接使用传递的 batchIndex 找到对应的输出节点
                          const outputNode = outputNodes.find(o => o.batchIndex === batchIndex);
                          if (!outputNode) {
                              console.error(`[RH-Config] 找不到 batchIndex=${batchIndex} 的输出节点`);
                              return;
                          }
                          
                          if (result.outputs?.length) {
                              const output = result.outputs[0];
                              const outputUrl = output.fileUrl;
                              const outputType = output.fileType === 'video' ? 'video' : 'image';
                              
                              console.log(`[RH-Config] 任务完成:`, { batchIndex, outputUrl, status });
                              
                              // 先立即更新节点内容，不等 metadata
                              updateNode(outputNode.id, {
                                  content: outputUrl,
                                  status: 'completed'
                              });
                              
                              // 异步获取 metadata（不阻塞）
                              extractImageMetadata(outputUrl).then(metadata => {
                                  updateNode(outputNode.id, {
                                      data: { imageMetadata: metadata }
                                  });
                              }).catch(err => {
                                  console.warn(`[RH-Config] 获取图片元数据失败:`, err);
                              });
                              
                              // 同步到桌面
                              if (outputType === 'image' && onImageGenerated) {
                                  onImageGenerated(outputUrl, `RunningHub: ${appName}`, currentCanvasId || undefined, canvasName);
                              }
                          }
                      },
                      
                      onTaskError: (taskId, batchIndex, error, status) => {
                          // 直接使用传递的 batchIndex 找到对应的输出节点
                          const outputNode = outputNodes.find(o => o.batchIndex === batchIndex);
                          if (outputNode) {
                              updateNode(outputNode.id, { status: 'error' });
                          }
                          
                          console.error(`[RH-Config] 任务失败:`, { batchIndex, error, status });
                      },
                      
                      onAllTasksDone: (nid, status) => {
                          console.log(`[RH-Config] 所有任务完成:`, status);
                          // 更新节点状态
                          updateNode(nid, { status: status.failedCount > 0 ? 'error' : 'completed' });
                          saveCurrentCanvas();
                      }
                  });
                  
                  console.log('[RH-Config] 已入队:', taskIds.length, '个任务');
                  
                  // 更新节点状态为运行中
                  updateNode(nodeId, { status: 'running' });
                  
              } catch (err: any) {
                  console.error('[RH-Config] 入队异常:', err);
                  updateNode(nodeId, {
                      status: 'error',
                      data: { ...node.data, error: err.message || '入队异常' }
                  });
              }
          }
          // ============ rh-main 节点执行（从关联的 rh-param 节点收集参数） ============
          else if (node.type === 'rh-main') {
              const webappId = node.data?.webappId;
              const appInfo = node.data?.appInfo;
              const mainNodeId = node.id;
              
              console.log('[RH-Main] 节点执行:', { webappId, hasAppInfo: !!appInfo, batchCount });
              
              if (!webappId || !appInfo) {
                  updateNode(nodeId, { status: 'error', data: { ...node.data, error: '缺少应用配置' } });
                  return;
              }
              
              try {
                  const appName = (appInfo as any).webappName || appInfo.title || webappId;
                  console.log('[RH-Main] 开始执行 AI 应用:', appName, '批次:', batchCount);
                  
                  // 从关联的 rh-param 节点收集参数值
                  const currentNodes = nodesRef.current;
                  const paramNodes = currentNodes.filter(n => 
                      n.type === 'rh-param' && n.data?.rhParentNodeId === mainNodeId
                  );
                  
                  console.log('[RH-Main] 找到参数节点:', paramNodes.length);
                  
                  // 构建 nodeInfoList
                  const nodeInfoList = appInfo.nodeInfoList?.map((info: any) => {
                      const key = `${info.nodeId}_${info.fieldName}`;
                      
                      // 在参数节点中查找对应的值
                      const paramNode = paramNodes.find(pn => 
                          pn.data?.rhParamInfo?.nodeId === info.nodeId && 
                          pn.data?.rhParamInfo?.fieldName === info.fieldName
                      );
                      
                      const nodeInputs = paramNode?.data?.nodeInputs || {};
                      const userValue = nodeInputs[key];
                      
                      return {
                          nodeId: info.nodeId,
                          fieldName: info.fieldName,
                          fieldValue: userValue !== undefined ? (userValue || '') : (info.fieldValue || '')
                      };
                  }) || [];
                  
                  console.log('[RH-Main] nodeInfoList:', nodeInfoList);
                  
                  const lastParamNode = paramNodes[paramNodes.length - 1];
                  const fromNodeId = lastParamNode ? lastParamNode.id : nodeId;
                  const outputBaseY = lastParamNode ? (lastParamNode.y + lastParamNode.height + 50) : (node.y + node.height + 50);
                  const usePreview = batchCount > 1;
                  const resultNodeIds: string[] = [];

                  if (usePreview) {
                      for (let i = 0; i < batchCount; i++) {
                          const outId = uuid();
                          resultNodeIds.push(outId);
                          const outputNode: CanvasNode = {
                              id: outId,
                              type: 'image',
                              content: '',
                              x: node.x,
                              y: outputBaseY + i * 420,
                              width: 300,
                              height: 300,
                              data: {},
                              status: 'running'
                          };
                          const newConnection = { id: uuid(), fromNode: fromNodeId, toNode: outId };
                          nodesRef.current = [...nodesRef.current, outputNode];
                          connectionsRef.current = [...connectionsRef.current, newConnection];
                          setNodes(prev => [...prev, outputNode]);
                          setConnections(prev => [...prev, newConnection]);
                      }
                      setHasUnsavedChanges(true);
                  }

                  for (let batchIdx = 0; batchIdx < batchCount; batchIdx++) {
                      if (signal.aborted) return;
                      console.log(`[RH-Main] 执行第 ${batchIdx + 1}/${batchCount} 次任务`);
                      const outputNodeId = usePreview ? resultNodeIds[batchIdx]! : uuid();
                      if (!usePreview) {
                          const outputNode: CanvasNode = {
                              id: outputNodeId,
                              type: 'image',
                              content: '',
                              x: node.x,
                              y: outputBaseY,
                              width: 300,
                              height: 300,
                              data: {},
                              status: 'running'
                          };
                          const newConnection = { id: uuid(), fromNode: fromNodeId, toNode: outputNodeId };
                          nodesRef.current = [...nodesRef.current, outputNode];
                          connectionsRef.current = [...connectionsRef.current, newConnection];
                          setNodes(prev => [...prev, outputNode]);
                          setConnections(prev => [...prev, newConnection]);
                          setHasUnsavedChanges(true);
                      }

                      const result = await runAIApp(webappId, nodeInfoList);
                      if (signal.aborted) return;

                      if (result.success && result.data?.outputs?.length) {
                          const output = result.data.outputs[0];
                          const outputUrl = output.fileUrl;
                          const outputType = output.fileType === 'video' ? 'video' : 'image';
                          console.log(`[RH-Main] 任务 ${batchIdx + 1} 执行成功:`, { outputUrl, outputType });
                          const metadata = await extractImageMetadata(outputUrl);
                          updateNode(outputNodeId, {
                              content: outputUrl,
                              data: { imageMetadata: metadata },
                              status: 'completed'
                          });
                          if (outputType === 'image' && onImageGenerated) {
                              onImageGenerated(outputUrl, `RunningHub: ${appName}`, currentCanvasId || undefined, canvasName);
                          }
                      } else {
                          const errorMsg = result.error || '执行失败';
                          console.error(`[RH-Main] 任务 ${batchIdx + 1} 执行失败:`, errorMsg);
                          updateNode(outputNodeId, { status: 'error' });
                      }
                  }

                  if (usePreview && resultNodeIds.length > 0) {
                      const contents = resultNodeIds.map(id => nodesRef.current.find(n => n.id === id)?.content).filter((c): c is string => !!c && (isValidImage(c) || isValidVideo(c)));
                      setNodes(prev => prev.filter(n => !resultNodeIds.includes(n.id)));
                      setConnections(prev => prev.filter(c => !resultNodeIds.includes(c.toNode)));
                      nodesRef.current = nodesRef.current.filter(n => !resultNodeIds.includes(n.id));
                      connectionsRef.current = connectionsRef.current.filter(c => !resultNodeIds.includes(c.toNode));
                      if (contents.length <= 1) {
                          const singleId = uuid();
                          const isVideo = contents[0] ? isValidVideo(contents[0]) : false;
                          const singleNode: CanvasNode = {
                              id: singleId,
                              type: isVideo ? 'video-output' : 'image',
                              title: isVideo ? '视频' : '结果',
                              content: contents[0] || '',
                              x: node.x,
                              y: outputBaseY,
                              width: isVideo ? 400 : 320,
                              height: isVideo ? 225 : 320,
                              status: contents.length > 0 ? 'completed' : 'error',
                              data: {}
                          };
                          const singleConn = { id: uuid(), fromNode: fromNodeId, toNode: singleId };
                          setNodes(prev => [...prev, singleNode]);
                          setConnections(prev => [...prev, singleConn]);
                          nodesRef.current = [...nodesRef.current, singleNode];
                          connectionsRef.current = [...connectionsRef.current, singleConn];
                          if (contents[0] && onImageGenerated) onImageGenerated(contents[0], `RunningHub: ${appName}`, currentCanvasId || undefined, canvasName, isVideo);
                      } else {
                          const previewNodeId = uuid();
                          const previewNode: CanvasNode = {
                              id: previewNodeId,
                              type: 'preview',
                              title: '预览',
                              content: contents[0] || '',
                              x: node.x,
                              y: outputBaseY,
                              width: 320,
                              height: 320,
                              status: contents.length > 0 ? 'completed' : 'error',
                              data: { previewItems: contents, previewCoverIndex: 0, previewExpectedCount: batchCount }
                          };
                          const previewConn = { id: uuid(), fromNode: fromNodeId, toNode: previewNodeId };
                          setNodes(prev => [...prev, previewNode]);
                          setConnections(prev => [...prev, previewConn]);
                          nodesRef.current = [...nodesRef.current, previewNode];
                          connectionsRef.current = [...connectionsRef.current, previewConn];
                          // 异步批量保存到桌面子文件夹
                          const hasVideoContent = contents.some(c => isValidVideo(c));
                          saveBatchToDesktopFolder(contents, 0, `RH_${appName.slice(0, 10)}`, hasVideoContent);
                      }
                  }

                  updateNode(nodeId, { status: 'completed' });
                  saveCurrentCanvas();
                  
              } catch (err: any) {
                  console.error('[RH-Main] 执行异常:', err);
                  updateNode(nodeId, {
                      status: 'error',
                      data: { ...node.data, error: err.message || '执行异常' }
                  });
              }
          }
          else {
              // 未实现执行逻辑的节点类型：恢复状态并提示，避免一直停留在 running
              console.warn(`[执行] 节点类型 "${node.type}" 暂无执行逻辑`);
              updateNode(nodeId, { status: 'idle', data: { ...node.data, error: `节点类型 ${node.type} 暂不支持执行` } });
          }

      } catch (e) {
          if ((e as Error).name !== 'AbortError') {
              console.error(e);
              updateNode(nodeId, { status: 'error' });
          }
      } finally {
          // Clean up abort controller
          abortControllersRef.current.delete(nodeId);
          // 🔓 解锁：移除执行标记
          executingNodesRef.current.delete(nodeId);
          console.log(`[🔓执行锁] 节点 ${nodeId.slice(0,8)} 已解锁`);
      }
  };
  
  // 将 handleExecuteNode 赋值给 ref，供 recoverVideoTasks 使用
  useEffect(() => {
      executeNodeRef.current = handleExecuteNode;
  }, []);

  // Function to cancel/stop a running node execution
  const handleStopNode = (nodeId: string) => {
      const controller = abortControllersRef.current.get(nodeId);
      if (controller) {
          controller.abort();
          abortControllersRef.current.delete(nodeId);
          updateNode(nodeId, { status: 'idle' });
      }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  // 供浮动面板使用：在面板上释放时也视为在画布上放置（面板会转发 drop 事件）
  const handleDropOnCanvasOrPanel = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const x = (e.clientX - rect.left - canvasOffset.x) / scale - 150;
    const y = (e.clientY - rect.top - canvasOffset.y) / scale - 100;

    let type = e.dataTransfer.getData('nodeType') as NodeType;
    if (!type) type = e.dataTransfer.getData('text/plain') as NodeType;
    if (!type && (window as any).__draggingNodeType) {
      type = (window as any).__draggingNodeType as NodeType;
      (window as any).__draggingNodeType = null;
    }

    const mediaUrl = e.dataTransfer.getData('mediaUrl');
    if (mediaUrl && (type === 'image' || type === 'video-output')) {
      addNode(type === 'video-output' ? 'video-output' : 'image', mediaUrl, { x, y });
      return;
    }
    const creativeIdeaId = e.dataTransfer.getData('creativeIdeaId');
    if (creativeIdeaId && creativeIdeas) {
      const idea = creativeIdeas.find(i => String(i.id) === creativeIdeaId);
      if (idea) {
        handleApplyCreativeIdea(idea);
        return;
      }
    }
    if (type && ['image', 'text', 'video', 'video-output', 'llm', 'relay', 'edit', 'remove-bg', 'upscale', 'resize', 'bp', 'comfyui'].includes(type)) {
      addNode(type, '', { x, y });
      return;
    }
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      Array.from(e.dataTransfer.files).forEach((item, index) => {
        const file = item as File;
        const offsetX = x + (index * 20);
        const offsetY = y + (index * 20);
        if (file.type.startsWith('image/')) {
          const reader = new FileReader();
          reader.onload = (ev) => {
            if (ev.target?.result) addNode('image', ev.target.result as string, { x: offsetX, y: offsetY });
          };
          reader.readAsDataURL(file);
        } else if (file.type.startsWith('video/')) {
          const reader = new FileReader();
          reader.onload = async (ev) => {
            if (!ev.target?.result) return;
            const base64Data = ev.target.result as string;
            try {
              const { saveVideoToOutput } = await import('@/services/api/files');
              const result = await saveVideoToOutput(base64Data, `video_${Date.now()}.mp4`);
              const url = result.success && result.data?.url ? result.data.url : base64Data;
              addNode('video-output', url, { x: offsetX, y: offsetY }, file.name);
            } catch {
              addNode('video-output', base64Data, { x: offsetX, y: offsetY }, file.name);
            }
          };
          reader.readAsDataURL(file);
        }
      });
    }
  }, [canvasOffset, scale, creativeIdeas, handleApplyCreativeIdea, addNode]);

  const handleDrop = (e: React.DragEvent) => {
    handleDropOnCanvasOrPanel(e);
  };

  // --- INTERACTION HANDLERS ---

  const onMouseDownCanvas = (e: React.MouseEvent) => {
      // Logic:
      // 平移模式 + 左键 = Pan Canvas
      // Space + 左键 = Pan Canvas
      // Ctrl/Meta + 左键 = Box Selection
      // 中键 = Pan
      // 左键点击空白 = 取消选择
      
      if (e.button === 0) {
          if (e.ctrlKey || e.metaKey) {
             // START SELECTION BOX
             setSelectionBox({ start: { x: e.clientX, y: e.clientY }, current: { x: e.clientX, y: e.clientY } });
          } else if (isSpacePressed || isPanMode) {
             // Space/平移模式 + 左键 = Pan Canvas
             setIsDraggingCanvas(true);
             setDragStart({ x: e.clientX - canvasOffset.x, y: e.clientY - canvasOffset.y });
          } else {
             // Just Left Click = Deselect only (no pan)
             setSelectedNodeIds(new Set());
             setSelectedConnectionId(null);
             setImageGenPanelNodeId(null);
          }
      } else if (e.button === 1) {
          // Middle click pan
          setIsDraggingCanvas(true);
          setDragStart({ x: e.clientX - canvasOffset.x, y: e.clientY - canvasOffset.y });
      }
  };

  const onMouseMove = (e: React.MouseEvent) => {
      const clientX = e.clientX;
      const clientY = e.clientY;
      
      // 1. Pan Canvas - 使用 RAF 批量更新
      if (isDraggingCanvas) {
          if (rafRef.current) cancelAnimationFrame(rafRef.current);
          rafRef.current = requestAnimationFrame(() => {
              setCanvasOffset({
                  x: clientX - dragStart.x,
                  y: clientY - dragStart.y
              });
          });
          return;
      }

     // 2. Dragging Nodes - 使用 RAF 批量更新
      if (draggingNodeId && isDragOperation) {
          // 🔥 新功能：拖拽节点时按住空格可同时平移画布
          if (isSpacePressed) {
              // 计算鼠标移动增量（屏幕空间）
              const mouseDeltaX = clientX - lastMousePosRef.current.x;
              const mouseDeltaY = clientY - lastMousePosRef.current.y;
              
              // 初始化时跳过（避免第一次大跳跃）
              if (lastMousePosRef.current.x !== 0 || lastMousePosRef.current.y !== 0) {
                  // 平移画布
                  setCanvasOffset(prev => ({
                      x: prev.x + mouseDeltaX,
                      y: prev.y + mouseDeltaY
                  }));
                  
                  // 🔧 优化：直接更新 ref，避免 setState 导致的重渲染和卡顿
                  dragStartMousePosRef.current = {
                      x: dragStartMousePosRef.current.x + mouseDeltaX,
                      y: dragStartMousePosRef.current.y + mouseDeltaY
                  };
              }
              
              // 更新上次鼠标位置
              lastMousePosRef.current = { x: clientX, y: clientY };
          } else {
              // 未按空格时重置上次位置
              lastMousePosRef.current = { x: 0, y: 0 };
          }
          
          // 使用 ref 计算 delta，避免闭包问题
          const deltaX = (clientX - dragStartMousePosRef.current.x) / scale;
          const deltaY = (clientY - dragStartMousePosRef.current.y) / scale;
          
          // 存储当前 delta
          dragDeltaRef.current = { x: deltaX, y: deltaY };
          
          if (rafRef.current) cancelAnimationFrame(rafRef.current);
          rafRef.current = requestAnimationFrame(() => {
              const delta = dragDeltaRef.current;
              const newNodes = nodesRef.current.map(node => {
                  if (selectedNodeIds.has(node.id)) {
                      const initialPos = initialNodePositionsRef.current.get(node.id); // 使用 ref 获取最新值
                      if (initialPos) {
                          return {
                              ...node,
                              x: initialPos.x + delta.x,
                              y: initialPos.y + delta.y
                          };
                      }
                  }
                  return node;
              });
              // 同时更新 state 和 ref，确保一致性
              nodesRef.current = newNodes;
              setNodes(newNodes);
          });
          return;
      }

      // 3. Selection Box
      if (selectionBox) {
          if (rafRef.current) cancelAnimationFrame(rafRef.current);
          rafRef.current = requestAnimationFrame(() => {
              setSelectionBox(prev => prev ? { ...prev, current: { x: clientX, y: clientY } } : null);
          });
          return;
      }

      // 4. Linking - 使用 RAF 优化
      if (linkingState.active) {
          const container = containerRef.current;
          if (container) {
               const rect = container.getBoundingClientRect();
               const newPos = {
                   x: (clientX - rect.left - canvasOffset.x) / scale,
                   y: (clientY - rect.top - canvasOffset.y) / scale
               };
               if (rafRef.current) cancelAnimationFrame(rafRef.current);
               rafRef.current = requestAnimationFrame(() => {
                   setLinkingState(prev => ({
                       ...prev,
                       currPos: newPos
                   }));
               });
          }
      }
  };

  const onMouseUp = (e: React.MouseEvent) => {
      // 清理 RAF
      if (rafRef.current) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
      }
      
      // 记录是否刚完成拖拽操作
      const wasDragging = isDragOperation && draggingNodeId;
      
      setIsDraggingCanvas(false);
      setDraggingNodeId(null);
      setIsDragOperation(false);
      // 从 output 拖拽连线松手到空白处：弹出添加节点菜单（释放在节点上时不弹）
      if (linkingState.active && linkingState.fromNode && !releasedOnNodeRef.current) {
          setAddNodeFromOutputMenu({
              position: { ...linkingState.currPos },
              sourceNodeId: linkingState.fromNode
          });
      }
      releasedOnNodeRef.current = false;
      setLinkingState(prev => ({ ...prev, active: false, fromNode: null }));

      // 拖拽结束后标记未保存
      if (wasDragging) {
          setHasUnsavedChanges(true);
          console.log('[拖拽] 拖拽结束，已标记未保存');
      }

      // Resolve Selection Box
      if (selectionBox) {
          const container = containerRef.current;
          if (container) {
              const rect = container.getBoundingClientRect();
              
              // Convert box to canvas space
              const startX = (selectionBox.start.x - rect.left - canvasOffset.x) / scale;
              const startY = (selectionBox.start.y - rect.top - canvasOffset.y) / scale;
              const curX = (selectionBox.current.x - rect.left - canvasOffset.x) / scale;
              const curY = (selectionBox.current.y - rect.top - canvasOffset.y) / scale;

              const minX = Math.min(startX, curX);
              const maxX = Math.max(startX, curX);
              const minY = Math.min(startY, curY);
              const maxY = Math.max(startY, curY);

              // Standard box select behavior: Select what is inside
              const newSelection = new Set<string>();
              // Note: If you want to hold Shift to add to selection, handle e.shiftKey here. 
              // For now, implementing standard replacement selection.
              
              nodes.forEach(node => {
                  const nodeCenterX = node.x + node.width / 2;
                  const nodeCenterY = node.y + node.height / 2;
                  if (nodeCenterX >= minX && nodeCenterX <= maxX && nodeCenterY >= minY && nodeCenterY <= maxY) {
                      newSelection.add(node.id);
                  }
              });
              setSelectedNodeIds(newSelection);
          }
          setSelectionBox(null);
      }
  };

  const handleNodeDragStart = (e: React.MouseEvent, id: string) => {
      if (e.button !== 0) return; // Only left click
      e.stopPropagation();
      
      const isMulti = e.shiftKey;
      const newSelection = new Set(selectedNodeIds);
      if (!newSelection.has(id)) {
          if (!isMulti) newSelection.clear();
          newSelection.add(id);
          setSelectedNodeIds(newSelection);
      }
      
      // 选中 image/preview 节点时打开浮动面板（生成配置或工具箱）
      const selectedNode = nodesRef.current.find(n => n.id === id);
      if (!isMulti && newSelection.size === 1 && (
          selectedNode?.type === 'image' ||
          (selectedNode?.type === 'preview' && selectedNode.content)
      )) {
          setImageGenPanelNodeId(id);
      } else {
          setImageGenPanelNodeId(null);
      }
      
      setDraggingNodeId(id);
      setIsDragOperation(true);
      setDragStartMousePos({ x: e.clientX, y: e.clientY });
      dragStartMousePosRef.current = { x: e.clientX, y: e.clientY }; // 同步更新 ref
      
      // Snapshot positions - 使用 nodesRef 确保获取最新的节点位置
      const positions = new Map<string, Vec2>();
      const currentNodes = nodesRef.current.length > 0 ? nodesRef.current : nodes;
      currentNodes.forEach(n => {
          if (newSelection.has(n.id)) {
              positions.set(n.id, { x: n.x, y: n.y });
          }
      });
      setInitialNodePositions(positions);
      initialNodePositionsRef.current = positions; // 同步更新 ref
  };

  const handleStartConnection = (nodeId: string, portType: 'in' | 'out', pos: Vec2) => {
     if (portType === 'out') {
         setLinkingState({
             active: true,
             fromNode: nodeId,
             startPos: pos, 
             currPos: { x: (pos.x - canvasOffset.x) / scale, y: (pos.y - canvasOffset.y) / scale } 
         });
     }
  };

  const handleEndConnection = async (targetNodeId: string, portKey?: string) => {
      releasedOnNodeRef.current = true; // 本次松手在节点上，不弹添加节点菜单
      if (linkingState.active && linkingState.fromNode && linkingState.fromNode !== targetNodeId) {
          const sourceNodeId = linkingState.fromNode;
          const targetNode = nodes.find(n => n.id === targetNodeId);
          const sourceNode = nodes.find(n => n.id === sourceNodeId);
          
          // 检查是否连接到 rh-config 节点的参数端口
          if (targetNode?.type === 'rh-config' && portKey && sourceNode) {
              console.log('[Connection] 连接到 rh-config 参数:', { portKey, sourceType: sourceNode.type });
              
              // 检查源节点是否有图片内容
              const hasImageContent = sourceNode.content && (
                  sourceNode.content.startsWith('data:image') ||
                  sourceNode.content.startsWith('http') ||
                  sourceNode.content.startsWith('/files/')
              );
              
              // 检查源节点是否是文字节点
              const isTextNode = sourceNode.type === 'text' || sourceNode.type === 'llm';
              
              // 特殊处理：连接到封面图区域（即时更新显示）
              if (portKey === 'cover' && hasImageContent) {
                  console.log('[Connection] 连接到封面图区域');
                  let displayUrl = sourceNode.content;
                  if (displayUrl.startsWith('/files/')) {
                      displayUrl = `http://localhost:8765${displayUrl}`;
                  }
                  updateNode(targetNodeId, {
                      data: {
                          ...targetNode.data,
                          coverUrl: displayUrl
                      }
                  });
              } 
              // 图片连接：不立即上传，只记录连接关系，RUN 时再上传
              // 文字节点：直接填入内容（即时）
              else if (isTextNode && sourceNode.content) {
                  console.log('[Connection] 文字节点连接, 填入内容:', sourceNode.content.substring(0, 50));
                  const nodeInputs = targetNode.data?.nodeInputs || {};
                  updateNode(targetNodeId, {
                      data: {
                          ...targetNode.data,
                          nodeInputs: {
                              ...nodeInputs,
                              [portKey]: sourceNode.content
                          }
                      }
                  });
              }
              // 图片连接：只记录，不上传（RUN 时处理）
          }
          
          // 立即创建连接（即时反馈）
          const exists = connections.some(c => c.fromNode === sourceNodeId && c.toNode === targetNodeId && c.toPortKey === portKey);
          if (!exists) {
              // 计算端口相对于目标节点的 Y 偏移
              let toPortOffsetY: number | undefined = undefined;
              if (portKey && targetNode?.type === 'rh-config') {
                  toPortOffsetY = linkingState.currPos.y - targetNode.y;
              }
              
              const newConnection = {
                  id: uuid(),
                  fromNode: sourceNodeId,
                  toNode: targetNodeId,
                  toPortKey: portKey,
                  toPortOffsetY
              };
              connectionsRef.current = [...connectionsRef.current, newConnection];
              setConnections(prev => [...prev, newConnection]);
              setHasUnsavedChanges(true);
              console.log('[Connection] 连接已创建（即时反馈）');
          }
      }
  };

  // 处理工具节点创建
  const handleCreateToolNode = (sourceNodeId: string, toolType: NodeType, position: { x: number, y: number }) => {
      // 为扩图工具预设 prompt
      let presetData = {};
      if (toolType === 'edit') {
          presetData = { prompt: "Extend the image naturally, maintaining style and coherence" };
      }
      
      const newNode = addNode(toolType, '', position, undefined, presetData);
      
      // 自动创建连接
      setConnections(prev => [...prev, {
          id: uuid(),
          fromNode: sourceNodeId,
          toNode: newNode.id
      }]);
      setHasUnsavedChanges(true); // 标记未保存
  };

  // 从菜单添加节点：支持仅创建、从 output 连线、或作为中间节点插入
  const handleAddNodeFromOutput = useCallback((type: NodeType) => {
      if (!addNodeFromOutputMenu) return;
      const { position, sourceNodeId, toNodeId, connId, toPortKey, toPortOffsetY } = addNodeFromOutputMenu;
      const newNode = addNode(type, '', position);
      if (toNodeId && connId && sourceNodeId) {
          // 作为中间节点：删除原连线，新增 源→新节点、新节点→目标
          setConnections(prev => [
              ...prev.filter(c => c.id !== connId),
              { id: uuid(), fromNode: sourceNodeId, toNode: newNode.id },
              { id: uuid(), fromNode: newNode.id, toNode: toNodeId, toPortKey, toPortOffsetY }
          ]);
      } else if (sourceNodeId) {
          setConnections(prev => [...prev, { id: uuid(), fromNode: sourceNodeId, toNode: newNode.id }]);
      }
      setHasUnsavedChanges(true);
      setAddNodeFromOutputMenu(null);
  }, [addNodeFromOutputMenu]);

  // 双击输出口：在节点右侧弹出添加节点菜单
  const handleOutputDoubleClick = useCallback((nodeId: string) => {
      setLinkingState(prev => ({ ...prev, active: false, fromNode: null }));
      const node = nodesRef.current.find(n => n.id === nodeId);
      if (!node) return;
      const position: Vec2 = { x: node.x + node.width + 80, y: node.y + node.height / 2 - 40 };
      setAddNodeFromOutputMenu({ position, sourceNodeId: nodeId });
  }, []);

  // 双击连线：在点击位置弹出添加节点菜单（新节点将作为中间节点插入）
  const handleConnectionDoubleClick = useCallback((conn: Connection, e: React.MouseEvent) => {
      e.stopPropagation();
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const position: Vec2 = {
          x: (e.clientX - rect.left - canvasOffset.x) / scale,
          y: (e.clientY - rect.top - canvasOffset.y) / scale
      };
      setAddNodeFromOutputMenu({
          position,
          sourceNodeId: conn.fromNode,
          toNodeId: conn.toNode,
          connId: conn.id,
          toPortKey: conn.toPortKey,
          toPortOffsetY: conn.toPortOffsetY
      });
  }, [canvasOffset, scale]);

  // 左键双击空白：在点击位置弹出添加节点菜单（不自动连线）
  const onDoubleClickCanvas = useCallback((e: React.MouseEvent) => {
      const target = e.target as HTMLElement;
      // 仅响应点在空白区域（容器本身或带 data-canvas-content 的变换层，排除节点和连线）
      const isBlank = target === containerRef.current || target.getAttribute?.('data-canvas-content') === 'true';
      if (!isBlank || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const position: Vec2 = {
          x: (e.clientX - rect.left - canvasOffset.x) / scale,
          y: (e.clientY - rect.top - canvasOffset.y) / scale
      };
      setAddNodeFromOutputMenu({ position });
  }, [canvasOffset, scale]);

  // 处理视频帧提取
  const handleExtractFrame = async (nodeId: string, position: 'first' | 'last' | number) => {
      const node = nodes.find(n => n.id === nodeId);
      if (!node || !node.content) {
          console.warn('[ExtractFrame] 节点无内容:', nodeId);
          return;
      }

      console.log('[ExtractFrame] 开始提取帧:', { nodeId, position, content: node.content.substring(0, 100) });

      try {
          // 创建视频元素来提取帧
          const video = document.createElement('video');
          video.crossOrigin = 'anonymous';
          
          // 处理视频 URL
          let videoUrl = node.content;
          if (videoUrl.startsWith('/files/')) {
              videoUrl = `http://localhost:8765${videoUrl}`;
          }
          
          // 等待视频加载
          await new Promise<void>((resolve, reject) => {
              video.onloadedmetadata = () => {
                  console.log('[ExtractFrame] 视频元数据加载完成:', { duration: video.duration, width: video.videoWidth, height: video.videoHeight });
                  resolve();
              };
              video.onerror = (e) => {
                  console.error('[ExtractFrame] 视频加载失败:', e);
                  reject(new Error('视频加载失败'));
              };
              video.src = videoUrl;
              video.load();
          });

          // 计算目标时间
          let targetTime: number;
          if (position === 'first') {
              targetTime = 0;
          } else if (position === 'last') {
              targetTime = Math.max(0, video.duration - 0.1);
          } else {
              // 任意秒数，确保不超出视频时长
              targetTime = Math.min(Math.max(0, position), video.duration - 0.1);
          }
          
          // 跳转到指定帧位置
          await new Promise<void>((resolve) => {
              video.onseeked = () => {
                  console.log('[ExtractFrame] 跳转完成:', targetTime);
                  resolve();
              };
              video.currentTime = targetTime;
          });

          // 使用 canvas 提取帧
          const canvas = document.createElement('canvas');
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('无法创建 canvas context');
          
          ctx.drawImage(video, 0, 0);
          const frameDataUrl = canvas.toDataURL('image/png');
          console.log('[ExtractFrame] 帧提取成功, 大小:', frameDataUrl.length);

          // 保存到 output 目录
          const { saveToOutput } = await import('@/services/api/files');
          const result = await saveToOutput(frameDataUrl, `frame_${Date.now()}.png`);
          if (!result.success || !result.data) {
              throw new Error(result.error || '保存帧失败');
          }
          const savedPath = result.data.url;
          console.log('[ExtractFrame] 保存成功:', savedPath);

          // 🔧 同步到桌面
          if (onImageGenerated) {
              const frameLabel = position === 'first' ? '首帧' : position === 'last' ? '尾帧' : `${position}s帧`;
              onImageGenerated(savedPath, `视频${frameLabel}`, currentCanvasId || undefined, canvasName);
          }

          // 创建新的图片节点
          const sourceNode = nodes.find(n => n.id === nodeId);
          const newNodeX = (sourceNode?.x || 0) + (sourceNode?.width || 300) + 50;
          const newNodeY = sourceNode?.y || 0;

          const newNode = addNode('image', savedPath, { x: newNodeX, y: newNodeY });
          
          // 建立连接
          setConnections(prev => [...prev, {
              id: uuid(),
              fromNode: nodeId,
              toNode: newNode.id
          }]);
          setHasUnsavedChanges(true);

          console.log('[ExtractFrame] 完成，新节点:', newNode.id);
      } catch (error) {
          console.error('[ExtractFrame] 提取帧失败:', error);
      }
  };

  // 创建帧提取器节点
  const handleCreateFrameExtractor = (sourceVideoNodeId: string) => {
      const sourceNode = nodes.find(n => n.id === sourceVideoNodeId);
      if (!sourceNode || !sourceNode.content) {
          console.warn('[FrameExtractor] 源视频节点无内容');
          return;
      }
      
      console.log('[FrameExtractor] 创建帧提取器, 源视频:', sourceNode.content.slice(0, 100));
      
      // 计算新节点位置（源节点右侧）
      const newX = sourceNode.x + sourceNode.width + 50;
      const newY = sourceNode.y;
      
      // 创建帧提取器节点
      const newNode = addNode('frame-extractor', sourceNode.content, { x: newX, y: newY }, '帧提取器', {
          sourceVideoUrl: sourceNode.content,
          currentFrameTime: 0
      });
      
      // 创建连接
      setConnections(prev => [...prev, {
          id: uuid(),
          fromNode: sourceVideoNodeId,
          toNode: newNode.id
      }]);
      setHasUnsavedChanges(true);
      
      console.log('[FrameExtractor] 创建完成:', newNode.id);
  };

  // 从帧提取器提取帧
  const handleExtractFrameFromExtractor = async (nodeId: string, time: number) => {
      const node = nodes.find(n => n.id === nodeId);
      if (!node) {
          console.warn('[FrameExtractor] 节点不存在');
          return;
      }
      
      const videoUrl = node.data?.sourceVideoUrl || node.content;
      if (!videoUrl) {
          console.warn('[FrameExtractor] 无视频源');
          return;
      }
      
      console.log('[FrameExtractor] 提取帧:', { nodeId, time, videoUrl: videoUrl.slice(0, 100) });
      
      try {
          // 创建视频元素
          const video = document.createElement('video');
          video.crossOrigin = 'anonymous';
          
          let fullVideoUrl = videoUrl;
          if (videoUrl.startsWith('/files/')) {
              fullVideoUrl = `http://localhost:8765${videoUrl}`;
          }
          
          // 加载视频
          await new Promise<void>((resolve, reject) => {
              video.onloadedmetadata = () => resolve();
              video.onerror = reject;
              video.src = fullVideoUrl;
              video.load();
          });
          
          // 跳转到指定时间
          await new Promise<void>((resolve) => {
              video.onseeked = () => resolve();
              video.currentTime = Math.min(time, video.duration - 0.1);
          });
          
          // 提取帧
          const canvas = document.createElement('canvas');
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('无法创建 canvas context');
          
          ctx.drawImage(video, 0, 0);
          const frameDataUrl = canvas.toDataURL('image/png');
          
          // 保存到 output 目录
          const { saveToOutput } = await import('@/services/api/files');
          const result = await saveToOutput(frameDataUrl, `frame_${Date.now()}.png`);
          if (!result.success || !result.data) {
              throw new Error(result.error || '保存帧失败');
          }
          const savedPath = result.data.url;
          
          // 🔧 同步到桌面
          if (onImageGenerated) {
              onImageGenerated(savedPath, `帧 ${time.toFixed(1)}s`, currentCanvasId || undefined, canvasName);
          }
          
          // 创建图片节点
          const newNodeX = node.x + node.width + 50;
          const newNodeY = node.y;
          const newNode = addNode('image', savedPath, { x: newNodeX, y: newNodeY }, `帧 ${time.toFixed(1)}s`);
          
          // 创建连接
          setConnections(prev => [...prev, {
              id: uuid(),
              fromNode: nodeId,
              toNode: newNode.id
          }]);
          setHasUnsavedChanges(true);
          
          console.log('[FrameExtractor] 提取完成:', newNode.id);
      } catch (error) {
          console.error('[FrameExtractor] 提取帧失败:', error);
      }
  };

  // --- FLOATING GENERATOR HANDLER ---
  const handleGenerate = async (type: NodeType, prompt: string, config: GenerationConfig, files?: File[]) => {
      console.log('[FloatingInput] 开始生成:', { type, prompt, config });
      setIsGenerating(true);
      
      let base64Files: string[] = [];
      if (files && files.length > 0) {
          const promises = files.map(file => new Promise<string>((resolve) => {
              const reader = new FileReader();
              reader.onload = (e) => resolve(e.target?.result as string);
              reader.readAsDataURL(file);
          }));
          base64Files = await Promise.all(promises);
      }

      const newNode = addNode(type, '', undefined, undefined, { 
          prompt: prompt,
          settings: config
      });
      console.log('[FloatingInput] 节点已创建:', newNode.id);
      
      updateNode(newNode.id, { status: 'running' });

      try {
          if (type === 'image') {
               const result = await generateCreativeImage(prompt, config);
               updateNode(newNode.id, { content: result || '', status: result ? 'completed' : 'error' });
               // 同步到桌面
               if (result && onImageGenerated) {
                   onImageGenerated(result, prompt, currentCanvasId || undefined, canvasName);
               }
          } 
          else if (type === 'edit') {
               const result = await editCreativeImage(base64Files, prompt, config);
               updateNode(newNode.id, { content: result || '', status: result ? 'completed' : 'error' });
               // 同步到桌面
               if (result && onImageGenerated) {
                   onImageGenerated(result, prompt, currentCanvasId || undefined, canvasName);
               }
          }
      } catch(e) {
          console.error('[FloatingInput] 生成失败:', e);
          updateNode(newNode.id, { status: 'error' });
      } finally {
          setIsGenerating(false);
      }
  };

  // --- CONTEXT MENU ---（素材库/创意文本库为外部导入工具，其内右键不弹出画布“保存/删除”菜单）
  const handleContextMenu = (e: React.MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('[data-canvas-lib-panel], [data-canvas-lib-root], [data-media-lib-panel], [data-media-lib-root]')) {
          e.preventDefault();
          e.stopPropagation();
          return;
      }
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY });
  };

  const contextOptionsNoSelection = [
      { label: "请先选择节点", icon: <Icons.Move />, action: () => setContextMenu(null) }
  ];

  const contextOptionsWithSelection = [
      { 
          label: "保存为画布流程", 
          icon: <Icons.Layers />, 
          action: () => {
              if (selectedNodeIds.size > 0) {
                  setNodesForPreset(nodes.filter(n => selectedNodeIds.has(n.id)));
              } else {
                  setNodesForPreset([...nodes]);
              }
              setShowPresetModal(true);
          }
      },
      {
          label: "删除选中",
          icon: <Icons.Close />,
          action: deleteSelection,
          danger: true
      }
  ];

  const contextOptions = selectedNodeIds.size > 0 ? contextOptionsWithSelection : contextOptionsNoSelection;

  return (
    <div 
      className={`w-full h-full text-white overflow-hidden relative transition-colors duration-300 ${
        isLightCanvas ? 'bg-[#f5f5f7]' : 'bg-[#0a0a0f]'
      }`}
      style={{ color: isLightCanvas ? '#1d1d1f' : '#ffffff' }}
      onContextMenu={handleContextMenu}
    >

      <Sidebar 
          onDragStart={(type) => { /* HTML5 drag handled in drop */ }}
          onAdd={(type, data, title) => addNode(type, '', undefined, title, data)}
          userPresets={userPresets}
          onAddPreset={(pid) => {
             const p = userPresets.find(pr => pr.id === pid);
             if (p) setInstantiatingPreset(p);
          }}
          onDeletePreset={(pid) => setUserPresets(prev => prev.filter(p => p.id !== pid))}
          onHome={handleResetView}
          onOpenSettings={() => setShowApiSettings(true)}
          isApiConfigured={apiConfigured}
          canvasList={canvasList}
          currentCanvasId={currentCanvasId}
          canvasName={canvasName}
          isCanvasLoading={isCanvasLoading}
          onCreateCanvas={createNewCanvas}
          onLoadCanvas={loadCanvas}
          onDeleteCanvas={deleteCanvasById}
          onRenameCanvas={renameCanvas}
          onManualSave={handleManualSave}
          autoSaveEnabled={autoSaveEnabled}
          hasUnsavedChanges={hasUnsavedChanges}
          canvasTheme={themeName}
          onToggleTheme={() => setTheme(themeName === 'light' ? 'dark' : 'light')}
      />
      
      {/* 画布名称标识 - 独立模块 */}
      <CanvasNameBadge 
        canvasName={canvasName}
        isLoading={isCanvasLoading}
        hasUnsavedChanges={hasUnsavedChanges}
      />
      
      {/* 平移模式按钮已移除 - 可通过鼠标中键或空格+左键拖拽来平移画布 */}
      
      <div
        ref={containerRef}
        className={`w-full h-full relative ${(isSpacePressed || isPanMode) ? 'cursor-grab' : 'cursor-default'} ${isDraggingCanvas ? '!cursor-grabbing' : ''}`}
        onMouseDown={onMouseDownCanvas}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onDoubleClick={onDoubleClickCanvas}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      > 
        {/* Background Grid */}
        <div 
            className={`absolute inset-0 pointer-events-none transition-opacity duration-300 ${
              isLightCanvas ? 'opacity-30' : 'opacity-20'
            }`}
            style={{
                backgroundImage: `radial-gradient(circle, ${isLightCanvas ? '#c0c0c0' : '#444'} 1px, transparent 1px)`,
                backgroundSize: `${20 * scale}px ${20 * scale}px`,
                backgroundPosition: `${canvasOffset.x}px ${canvasOffset.y}px`
            }}
        />

        {/* Canvas Content Container - data-canvas-content 用于区分双击空白与双击节点/连线 */}
        <div 
            data-canvas-content="true"
            style={{ 
                transform: `translate3d(${canvasOffset.x}px, ${canvasOffset.y}px, 0) scale(${scale})`,
                transformOrigin: '0 0',
                width: '100%',
                height: '100%',
                willChange: 'transform',
                backfaceVisibility: 'hidden',
                pointerEvents: 'none',
            } as React.CSSProperties}
            className="absolute top-0 left-0"
        >
            {/* Connections */}
            <svg className="absolute top-0 left-0 w-full h-full overflow-visible pointer-events-none z-0">
                {/* 发光滤镜定义 - 黑白光感 */}
                <defs>
                    <filter id="glow-white" x="-50%" y="-50%" width="200%" height="200%">
                        <feGaussianBlur stdDeviation="2.5" result="coloredBlur"/>
                        <feMerge>
                            <feMergeNode in="coloredBlur"/>
                            <feMergeNode in="SourceGraphic"/>
                        </feMerge>
                    </filter>
                    <filter id="glow-selected" x="-50%" y="-50%" width="200%" height="200%">
                        <feGaussianBlur stdDeviation="4" result="coloredBlur"/>
                        <feMerge>
                            <feMergeNode in="coloredBlur"/>
                            <feMergeNode in="SourceGraphic"/>
                        </feMerge>
                    </filter>
                    {/* 绿色发光滤镜 - 用于 RunningHub 连线 */}
                    <filter id="glow-green" x="-50%" y="-50%" width="200%" height="200%">
                        <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
                        <feMerge>
                            <feMergeNode in="coloredBlur"/>
                            <feMergeNode in="SourceGraphic"/>
                        </feMerge>
                    </filter>
                    {/* 黑白渐变 - 深色模式 */}
                    <linearGradient id="grad-mono-dark" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stopColor="#666" stopOpacity="0.4"/>
                        <stop offset="30%" stopColor="#fff" stopOpacity="0.9"/>
                        <stop offset="70%" stopColor="#fff" stopOpacity="0.9"/>
                        <stop offset="100%" stopColor="#666" stopOpacity="0.4"/>
                    </linearGradient>
                    {/* 浅色模式渐变 */}
                    <linearGradient id="grad-mono-light" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stopColor="#999" stopOpacity="0.4"/>
                        <stop offset="30%" stopColor="#333" stopOpacity="0.9"/>
                        <stop offset="70%" stopColor="#333" stopOpacity="0.9"/>
                        <stop offset="100%" stopColor="#999" stopOpacity="0.4"/>
                    </linearGradient>
                    <linearGradient id="grad-selected" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stopColor="#888" stopOpacity="0.5"/>
                        <stop offset="50%" stopColor="#fff" stopOpacity="1"/>
                        <stop offset="100%" stopColor="#888" stopOpacity="0.5"/>
                    </linearGradient>
                    {/* 浅色模式的发光滤镜 */}
                    <filter id="glow-dark" x="-50%" y="-50%" width="200%" height="200%">
                        <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
                        <feMerge>
                            <feMergeNode in="coloredBlur"/>
                            <feMergeNode in="SourceGraphic"/>
                        </feMerge>
                    </filter>
                </defs>
                {connections.map(conn => {
                    // 使用 nodes 状态保证新添加节点后同帧即可渲染连线（nodesRef 会晚一帧）
                    const from = nodes.find(n => n.id === conn.fromNode);
                    const to = nodes.find(n => n.id === conn.toNode);
                    if (!from || !to) return null;

                    const startX = from.x + from.width;
                    const startY = from.y + from.height / 2;
                    
                    // 计算终点位置 - 默认连到节点左侧中心
                    let endX = to.x - 8;
                    let endY = to.y + to.height / 2;
                    
                    // 🎨 判断是否是"图片连接到图片类型参数" - 只有这种情况才用绿色
                    let isImageToImagePort = false;
                    const isSourceImageNode = from.type === 'image';
                    
                    // ============ rh-config 节点：优先使用存储的 toPortOffsetY ============
                    if (to.type === 'rh-config' && conn.toPortKey) {
                        if (conn.toPortOffsetY !== undefined) {
                            // ✅ 直接使用存储的偏移量，不需要任何计算
                            endY = to.y + conn.toPortOffsetY;
                        } else if (conn.toPortKey === 'cover') {
                            // 🔧 兼容旧数据：cover 端口固定连接到封面图中心（headerHeight + coverHeight/2 = 32 + 100 = 132）
                            endY = to.y + 132;
                        }
                        // 向后兼容：其他端口如果没有存储偏移量，使用节点中心
                        
                        // 检查是否是图片类型参数（cover 也算）
                        if (conn.toPortKey === 'cover') {
                            isImageToImagePort = isSourceImageNode;
                        } else if (to.data?.appInfo?.nodeInfoList) {
                            const portInfo = to.data.appInfo.nodeInfoList.find((info: any) => 
                                `${info.nodeId}_${info.fieldName}` === conn.toPortKey
                            );
                            const targetFieldType = (portInfo?.fieldType || '').toUpperCase();
                            isImageToImagePort = isSourceImageNode && ['IMAGE', 'VIDEO', 'AUDIO'].includes(targetFieldType);
                        }
                    }
                    // ============ rh-param 节点（独立 Ticket）============
                    else if (to.type === 'rh-param') {
                        // 独立参数节点：直接连到左侧中心
                        endX = to.x - 8;
                        endY = to.y + to.height / 2;
                        
                        // 检查是否是图片类型参数
                        const paramFieldType = to.data?.rhParamInfo?.fieldType?.toUpperCase() || '';
                        isImageToImagePort = isSourceImageNode && ['IMAGE', 'VIDEO', 'AUDIO'].includes(paramFieldType);
                    }
                    // ============ rh-main 节点（封面主节点）============
                    else if (to.type === 'rh-main') {
                        // 主节点：连到左侧中心
                        endX = to.x - 8;
                        endY = to.y + to.height / 2;
                    }
                    // ============ 旧 runninghub 节点的兼容处理 ============
                    else if (conn.toPortKey && to.type === 'runninghub' && to.data?.appInfo?.nodeInfoList) {
                        // 从 toPortKey 解析参数信息
                        const portKeyMatch = conn.toPortKey.match(/^input-(.+)-(.+)$/);
                        if (portKeyMatch) {
                            const [_, nodeId, fieldName] = portKeyMatch;
                            const portInfo = to.data.appInfo.nodeInfoList.find((info: any) => 
                                info.nodeId === nodeId && info.fieldName === fieldName
                            );
                            const targetFieldType = (portInfo?.fieldType || '').toUpperCase();
                            isImageToImagePort = isSourceImageNode && ['IMAGE', 'VIDEO', 'AUDIO'].includes(targetFieldType);
                        }
                    }
                    
                    // 根据是否是图片到图片端口连接决定颜色
                    const lineColor = isImageToImagePort 
                        ? { main: '#34d399', glow: 'rgba(52, 211, 153, 0.4)', selected: '#10b981' }
                        : { main: isLightCanvas ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.9)', 
                            glow: isLightCanvas ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.3)',
                            selected: isLightCanvas ? '#1d1d1f' : '#ffffff' };
                    
                    const isSelected = selectedConnectionId === conn.id;
                    
                    // 计算水平和垂直距离
                    const dx = endX - startX;
                    const dy = endY - startY;
                    const distance = Math.abs(dx);
                    const verticalDistance = Math.abs(dy);
                    
                    // 最小控制点偏移，确保连线始终可见
                    const minControlOffset = 50;
                    
                    let ctrl1X, ctrl1Y, ctrl2X, ctrl2Y;
                    
                    if (dx >= 0) {
                        // 正常方向：从左到右
                        // 控制点偏移：确保曲线可见，但不超过实际距离的一半
                        const controlOffset = Math.min(Math.max(distance / 3, minControlOffset), distance / 2 + 20);
                        ctrl1X = startX + controlOffset;
                        ctrl1Y = startY;
                        ctrl2X = endX - controlOffset;
                        ctrl2Y = endY;
                        
                        // 特殊处理：当水平距离很小时（节点靠近），使用直线而非曲线
                        if (distance < 100) {
                            ctrl1X = startX + distance / 2;
                            ctrl2X = startX + distance / 2;
                        }
                    } else {
                        // 反向连接：目标在源节点左侧，需要曲线绕行
                        // 使用更大的控制点偏移来创建可见的曲线
                        const controlOffset = Math.max(distance / 2, minControlOffset * 1.5);
                        ctrl1X = startX + controlOffset;
                        ctrl1Y = startY + (verticalDistance > 50 ? 0 : (endY > startY ? 50 : -50)); // 垂直偏移避免重叠
                        ctrl2X = endX - controlOffset;
                        ctrl2Y = endY + (verticalDistance > 50 ? 0 : (endY > startY ? -50 : 50));
                    }
                    
                    // 三次贝塞尔曲线路径
                    const pathD = `M ${startX} ${startY} C ${ctrl1X} ${ctrl1Y}, ${ctrl2X} ${ctrl2Y}, ${endX} ${endY}`;

                    return (
                        <g
                            key={conn.id}
                            className="pointer-events-auto cursor-pointer group"
                            title="单击切断连线，双击在中间插入节点"
                            onClick={(e) => {
                                e.stopPropagation();
                                if (connectionClickTimeoutRef.current) clearTimeout(connectionClickTimeoutRef.current);
                                connectionClickTimeoutRef.current = setTimeout(() => {
                                    connectionClickTimeoutRef.current = null;
                                    removeConnectionById(conn.id);
                                }, 250);
                            }}
                            onDoubleClick={(e) => {
                                e.stopPropagation();
                                if (connectionClickTimeoutRef.current) {
                                    clearTimeout(connectionClickTimeoutRef.current);
                                    connectionClickTimeoutRef.current = null;
                                }
                                handleConnectionDoubleClick(conn, e);
                            }}
                        >
                             {/* 点击区域 */}
                             <path 
                                d={pathD}
                                stroke="transparent"
                                strokeWidth="20"
                                fill="none"
                                style={{ cursor: 'pointer' }}
                            />
                            {/* 外层光晕 */}
                            <path 
                                d={pathD}
                                stroke={isSelected ? (isImageToImagePort ? 'rgba(16, 185, 129, 0.6)' : (isLightCanvas ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.8)')) : lineColor.glow}
                                strokeWidth={isSelected ? 8 : 5}
                                fill="none"
                                filter={isImageToImagePort ? 'url(#glow-green)' : (isLightCanvas ? 'url(#glow-dark)' : 'url(#glow-white)')}
                                strokeLinecap="round"
                            />
                            {/* 主线条 */}
                            <path 
                                d={pathD}
                                stroke={isSelected ? lineColor.selected : lineColor.main}
                                strokeWidth={isSelected ? 3 : 2}
                                fill="none"
                                strokeLinecap="round"
                            />
                            {/* 端点光球 */}
                            <circle 
                                cx={startX} 
                                cy={startY} 
                                r={isSelected ? 5 : 4} 
                                fill={isImageToImagePort ? '#34d399' : (isLightCanvas ? '#1d1d1f' : '#ffffff')}
                                filter={isImageToImagePort ? 'url(#glow-green)' : (isLightCanvas ? 'url(#glow-dark)' : 'url(#glow-white)')}
                            />
                            <circle 
                                cx={endX} 
                                cy={endY} 
                                r={isSelected ? 5 : 4} 
                                fill={isImageToImagePort ? '#34d399' : (isLightCanvas ? '#1d1d1f' : '#ffffff')}
                                filter={isImageToImagePort ? 'url(#glow-green)' : (isLightCanvas ? 'url(#glow-dark)' : 'url(#glow-white)')}
                            />
                        </g>
                    );
                })}
                
                {/* Active Link Line */}
                {linkingState.active && linkingState.fromNode && (() => {
                     // 🔧 使用 nodesRef 获取最新位置
                     const fromNode = nodesRef.current.find(n => n.id === linkingState.fromNode);
                     if (!fromNode) return null;
                     const startX = fromNode.x + fromNode.width; 
                     const startY = fromNode.y + fromNode.height / 2;
                     const endX = linkingState.currPos.x;
                     const endY = linkingState.currPos.y;
                     
                     // 计算水平和垂直距离
                     const dx = endX - startX;
                     const dy = endY - startY;
                     const distance = Math.abs(dx);
                     const verticalDistance = Math.abs(dy);
                     
                     // 最小控制点偏移
                     const minControlOffset = 50;
                     
                     let ctrl1X, ctrl1Y, ctrl2X, ctrl2Y;
                     
                     if (dx >= 0) {
                         const controlOffset = Math.min(Math.max(distance / 3, minControlOffset), distance / 2 + 20);
                         ctrl1X = startX + controlOffset;
                         ctrl1Y = startY;
                         ctrl2X = endX - controlOffset;
                         ctrl2Y = endY;
                         
                         // 特殊处理：当水平距离很小时，使用直线
                         if (distance < 100) {
                             ctrl1X = startX + distance / 2;
                             ctrl2X = startX + distance / 2;
                         }
                     } else {
                         const controlOffset = Math.max(distance / 2, minControlOffset * 1.5);
                         ctrl1X = startX + controlOffset;
                         ctrl1Y = startY + (verticalDistance > 50 ? 0 : (endY > startY ? 50 : -50));
                         ctrl2X = endX - controlOffset;
                         ctrl2Y = endY + (verticalDistance > 50 ? 0 : (endY > startY ? -50 : 50));
                     }
                     
                     return (
                        <>
                            <path 
                                d={`M ${startX} ${startY} C ${ctrl1X} ${ctrl1Y}, ${ctrl2X} ${ctrl2Y}, ${endX} ${endY}`}
                                stroke={isLightCanvas ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.4)'}
                                strokeWidth="4"
                                fill="none"
                                filter={isLightCanvas ? 'url(#glow-dark)' : 'url(#glow-white)'}
                                strokeLinecap="round"
                            />
                            <path 
                                d={`M ${startX} ${startY} C ${ctrl1X} ${ctrl1Y}, ${ctrl2X} ${ctrl2Y}, ${endX} ${endY}`}
                                stroke={isLightCanvas ? 'url(#grad-mono-light)' : 'url(#grad-mono-dark)'}
                                strokeWidth="1.5"
                                fill="none"
                                strokeLinecap="round"
                                strokeDasharray="6,4"
                            />
                            <circle cx={startX} cy={startY} r="3" fill={isLightCanvas ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.8)'} filter={isLightCanvas ? 'url(#glow-dark)' : 'url(#glow-white)'} />
                            <circle cx={endX} cy={endY} r="3" fill={isLightCanvas ? 'rgba(0,0,0,0.4)' : 'rgba(255,255,255,0.6)'} filter={isLightCanvas ? 'url(#glow-dark)' : 'url(#glow-white)'} />
                        </>
                     )
                })()}
            </svg>

            {/* Nodes */}
            {nodes.map(node => {
                const hasUpstreamImageNode = (nodeId: string): boolean => {
                    const visited = new Set<string>();
                    const stack = [nodeId];
                    while (stack.length > 0) {
                        const id = stack.pop()!;
                        if (visited.has(id)) continue;
                        visited.add(id);
                        for (const c of connections) {
                            if (c.toNode !== id) continue;
                            const from = nodes.find(n => n.id === c.fromNode);
                            if (!from) continue;
                            if (from.type === 'image') return true;
                            stack.push(c.fromNode);
                        }
                    }
                    return false;
                };
                const imageInputCount = (() => {
                    const fromIds = new Set(connections.filter(c => c.toNode === node.id).map(c => c.fromNode));
                    return Array.from(fromIds).filter(id => nodes.find(n => n.id === id)?.type === 'image').length;
                })();
                return (
                <CanvasNodeItem 
                    key={node.id}
                    node={node}
                    isSelected={selectedNodeIds.has(node.id)}
                    isLightCanvas={isLightCanvas}
                    scale={scale}
                    comfyuiWorkflows={comfyuiWorkflows}
                    comfyuiAddresses={comfyuiAddresses}
                    creativeIdeasForImage={creativeIdeas?.map((i) => ({ id: i.id, title: i.title, imageUrl: i.imageUrl })) ?? []}
                    effectiveColor={node.type === 'relay' ? 'stroke-' + resolveEffectiveType(node.id).replace('text', 'emerald').replace('image', 'blue').replace('llm', 'purple') + '-400' : undefined}
                    hasDownstream={connections.some(c => c.fromNode === node.id)}
                    hasImageInput={hasUpstreamImageNode(node.id)}
                    imageInputCount={imageInputCount}
                    incomingConnections={connections.filter(c => c.toNode === node.id).map(c => ({ fromNode: c.fromNode, toPortKey: c.toPortKey }))}
                    klingO1Inputs={node.type === 'video' && node.data?.videoModel === 'kling-video-o1' ? resolveInputsForKlingO1(node.id).items : undefined}
                    onSelect={(id, multi) => {
                        const newSet = new Set(multi ? selectedNodeIds : []);
                        newSet.add(id);
                        setSelectedNodeIds(newSet);
                        // 选中 image 节点时打开浮动生成面板
                        const selectedNode = nodesRef.current.find(n => n.id === id);
                        if (selectedNode?.type === 'image' && !multi) {
                            setImageGenPanelNodeId(id);
                        } else {
                            setImageGenPanelNodeId(null);
                        }
                    }}
                    onDragStart={handleNodeDragStart}
                    onUpdate={updateNode}
                    onDelete={(id) => setNodes(prev => prev.filter(n => n.id !== id))}
                    onExecute={(id, count) => { Promise.resolve(handleExecuteNode(id, count ?? 1)).catch(err => { console.error('[执行]', err); }); }}
                    onStop={handleStopNode}
                    onDownload={async (id) => {
                        const n = nodes.find(x => x.id === id);
                        if (!n || !n.content) {
                            console.warn('[Download] 节点无内容:', id);
                            return;
                        }
                        
                        // 根据内容类型判断文件扩展名
                        const isVideo = n.content.startsWith('data:video') || n.content.includes('.mp4') || n.type === 'video';
                        const ext = isVideo ? 'mp4' : 'png';
                        const filename = `pebbling-${n.id}.${ext}`;
                        const content = n.content;
                        
                        // 如果是 base64 数据，直接下载
                        if (content.startsWith('data:')) {
                            const link = document.createElement('a');
                            link.href = content;
                            link.download = filename;
                            document.body.appendChild(link);
                            link.click();
                            document.body.removeChild(link);
                            console.log('[Download] Base64 下载成功:', filename);
                            return;
                        }
                        
                        // 处理 URL 路径（/files/、/api/、http://、https://）
                        try {
                            let urlToFetch = content;
                            
                            // 相对路径转绝对路径
                            if (content.startsWith('/files/') || content.startsWith('/api/')) {
                                urlToFetch = `http://localhost:8765${content}`;
                            }
                            
                            console.log('[Download] 正在下载:', urlToFetch);
                            const response = await fetch(urlToFetch);
                            
                            if (!response.ok) {
                                throw new Error(`HTTP ${response.status}`);
                            }
                            
                            const blob = await response.blob();
                            const blobUrl = URL.createObjectURL(blob);
                            const link = document.createElement('a');
                            link.href = blobUrl;
                            link.download = filename;
                            document.body.appendChild(link);
                            link.click();
                            document.body.removeChild(link);
                            URL.revokeObjectURL(blobUrl);
                            console.log('[Download] URL 下载成功:', filename);
                        } catch (error: any) {
                            console.error('[Download] 下载失败:', error);
                            // 降级：在新窗口打开
                            window.open(content, '_blank');
                        }
                    }}
                    onStartConnection={(id, type, pos) => {
                        handleStartConnection(id, type, pos);
                    }}
                    onEndConnection={handleEndConnection}
                    onOutputDoubleClick={handleOutputDoubleClick}
                    onCreateToolNode={handleCreateToolNode}
                    onExtractFrame={handleExtractFrame}
                    onCreateFrameExtractor={handleCreateFrameExtractor}
                    onExtractFrameFromExtractor={handleExtractFrameFromExtractor}
                    onRetryVideoDownload={async (id) => {
                        const n = nodesRef.current.find(x => x.id === id);
                        if (!n || !n.data?.videoUrl) {
                            console.warn('[RetryDownload] 节点无原始URL:', id);
                            return;
                        }
                        
                        const videoUrl = n.data.videoUrl;
                        console.log('[RetryDownload] 重试下载:', videoUrl);
                        
                        // 更新状态为 running
                        updateNode(id, { 
                            status: 'running',
                            data: { ...n.data, videoFailReason: undefined }
                        });
                        
                        // 创建一个新的 AbortController
                        const controller = new AbortController();
                        abortControllersRef.current.set(id, controller);
                        
                        try {
                            await downloadAndSaveVideo(videoUrl, id, controller.signal);
                        } catch (err: any) {
                            console.error('[RetryDownload] 重试失败:', err);
                            updateNode(id, { 
                                status: 'error',
                                data: { ...n.data, videoFailReason: `重试失败: ${err.message || err}` }
                            });
                        } finally {
                            abortControllersRef.current.delete(id);
                        }
                    }}
                />
            ); })}
        </div>

        {/* Selection Box Overlay */}
        {selectionBox && (
            <div 
                className="absolute border border-blue-500 bg-blue-500/20 pointer-events-none z-50"
                style={{
                    left: Math.min(selectionBox.start.x, selectionBox.current.x),
                    top: Math.min(selectionBox.start.y, selectionBox.current.y),
                    width: Math.abs(selectionBox.current.x - selectionBox.start.x),
                    height: Math.abs(selectionBox.current.y - selectionBox.start.y)
                }}
            />
        )}
      </div>

      {/* ImageGenPanel - 图片节点浮动面板（生成配置 / 工具箱双模式） */}
      {imageGenPanelNodeId && (() => {
        const panelNode = nodes.find(n => n.id === imageGenPanelNodeId);
        if (!panelNode || (panelNode.type !== 'image' && panelNode.type !== 'preview')) return null;
        const pos = getImageGenPanelPosition(imageGenPanelNodeId);
        const inputImages = resolveInputs(panelNode.id).images;
        return (
          <ImageGenPanel
            node={panelNode}
            position={pos}
            isLightCanvas={isLightCanvas}
            onUpdateSettings={handleUpdateNodeSettings}
            onUpdatePrompt={handleUpdateNodePrompt}
            onExecute={(id) => handleExecuteNode(id)}
            onClose={() => setImageGenPanelNodeId(null)}
            isRunning={panelNode.status === 'running'}
            onCreateToolNode={handleCreateToolNode}
            inputImages={inputImages}
          />
        );
      })()}

      {/* 右侧创意文本库 - 浮动面板，可拖拽/可锁定 */}
      {(() => {
        const filteredIdeas = (creativeIdeas || []).filter(idea => {
          if (libraryFilter === 'all') return true;
          if (libraryFilter === 'favorite') return idea.isFavorite;
          if (libraryFilter === 'bp') return idea.isBP;
          if (libraryFilter === 'workflow') return idea.isWorkflow;
          return true;
        });

        if (isCreativeLibraryCollapsed) {
          /* 收起态 - 浮动小图标（标记为导入工具，不触发画布右键菜单） */
          return (
            <div
              data-canvas-lib-root
              className="select-none flex items-center gap-1 rounded-2xl border shadow-lg"
              style={{
                ...getCanvasFloatStyle(canvasLibraryIconPos),
                background: isLightCanvas ? 'rgba(255,255,255,0.9)' : 'rgba(20,20,25,0.85)',
                borderColor: isLightCanvas ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.1)',
                backdropFilter: 'blur(16px)',
                padding: '4px 6px',
                pointerEvents: 'auto',
              }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              {!canvasLibraryIconLocked && (
                <div
                  className="cursor-grab active:cursor-grabbing flex items-center"
                  style={{ color: isLightCanvas ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.25)' }}
                  onMouseDown={(e) => { const el = e.currentTarget.parentElement; if (el) startCanvasLibDrag('icon', e, el); }}
                >
                  <Icons.GripVertical size={10} />
                </div>
              )}
              <button
                onClick={() => setIsCreativeLibraryCollapsed(false)}
                className="w-8 h-8 rounded-xl flex items-center justify-center transition-all hover:scale-110 active:scale-95"
                style={{ color: '#60a5fa' }}
                title="展开创意文本库"
              >
                <Icons.Layers size={16} />
              </button>
              <button
                onClick={() => setCanvasLibraryIconLocked(!canvasLibraryIconLocked)}
                className="w-4 h-4 rounded flex items-center justify-center transition-all hover:scale-110"
                style={{ color: canvasLibraryIconLocked ? '#60a5fa' : (isLightCanvas ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.2)') }}
                title={canvasLibraryIconLocked ? '点击解锁' : '点击锁定'}
              >
                {canvasLibraryIconLocked ? <Icons.Lock size={8} /> : <Icons.Unlock size={8} />}
              </button>
            </div>
          );
        }

        /* 展开态 - 浮动面板，可拖拽/可拉伸调整大小；支持在面板上释放拖拽内容 */
        return (
          <div
            data-canvas-lib-panel
            className="select-none flex flex-col rounded-2xl border shadow-2xl"
            style={{
              ...getCanvasFloatStyle(canvasLibraryPos),
              width: creativeLibrarySidebarWidth,
              height: canvasLibraryHeight > 0 ? canvasLibraryHeight : 'calc(100vh - 24px)',
              maxHeight: 'calc(100vh - 10px)',
              background: isLightCanvas ? 'rgba(255,255,255,0.97)' : 'rgba(20,20,25,0.95)',
              borderColor: isLightCanvas ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.1)',
              backdropFilter: 'blur(20px)',
              pointerEvents: 'auto',
              overflow: 'hidden',
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
            onDrop={(e) => handleDropOnCanvasOrPanel(e)}
          >
            {/* 左侧边缘拖拽调宽 */}
            <div
              className="absolute left-0 top-2 bottom-2 w-1.5 cursor-ew-resize z-10 group"
              onMouseDown={(e) => {
                e.preventDefault(); e.stopPropagation();
                const el = e.currentTarget.closest('[data-canvas-lib-panel]') as HTMLElement;
                if (!el) return;
                const rect = el.getBoundingClientRect();
                document.body.style.cursor = 'ew-resize'; document.body.style.userSelect = 'none';
                canvasLibResizeRef.current = { edge: 'left', startMouse: { x: e.clientX, y: e.clientY }, startSize: { w: creativeLibrarySidebarWidth, h: canvasLibraryHeight || rect.height }, startPos: { x: rect.left, y: rect.top } };
              }}
            >
              <div className={`absolute inset-0 rounded-l transition-colors group-hover:${isLightCanvas ? 'bg-blue-400/40' : 'bg-blue-500/40'}`} />
            </div>
            {/* 底部边缘拖拽调高 */}
            <div
              className="absolute bottom-0 left-2 right-2 h-1.5 cursor-ns-resize z-10 group"
              onMouseDown={(e) => {
                e.preventDefault(); e.stopPropagation();
                const el = e.currentTarget.closest('[data-canvas-lib-panel]') as HTMLElement;
                if (!el) return;
                const rect = el.getBoundingClientRect();
                document.body.style.cursor = 'ns-resize'; document.body.style.userSelect = 'none';
                canvasLibResizeRef.current = { edge: 'bottom', startMouse: { x: e.clientX, y: e.clientY }, startSize: { w: creativeLibrarySidebarWidth, h: canvasLibraryHeight || rect.height }, startPos: { x: rect.left, y: rect.top } };
              }}
            >
              <div className={`absolute inset-0 rounded-b transition-colors group-hover:${isLightCanvas ? 'bg-blue-400/40' : 'bg-blue-500/40'}`} />
            </div>
            {/* 左下角同时调宽+调高 */}
            <div
              className="absolute bottom-0 left-0 w-3 h-3 cursor-nesw-resize z-20"
              onMouseDown={(e) => {
                e.preventDefault(); e.stopPropagation();
                const el = e.currentTarget.closest('[data-canvas-lib-panel]') as HTMLElement;
                if (!el) return;
                const rect = el.getBoundingClientRect();
                document.body.style.cursor = 'nesw-resize'; document.body.style.userSelect = 'none';
                canvasLibResizeRef.current = { edge: 'bottom-left', startMouse: { x: e.clientX, y: e.clientY }, startSize: { w: creativeLibrarySidebarWidth, h: canvasLibraryHeight || rect.height }, startPos: { x: rect.left, y: rect.top } };
              }}
            />
            {/* 右侧边缘拖拽调宽 */}
            <div
              className="absolute right-0 top-2 bottom-2 w-1.5 cursor-ew-resize z-10 group"
              onMouseDown={(e) => {
                e.preventDefault(); e.stopPropagation();
                const el = e.currentTarget.closest('[data-canvas-lib-panel]') as HTMLElement;
                if (!el) return;
                const rect = el.getBoundingClientRect();
                document.body.style.cursor = 'ew-resize'; document.body.style.userSelect = 'none';
                canvasLibResizeRef.current = { edge: 'right', startMouse: { x: e.clientX, y: e.clientY }, startSize: { w: creativeLibrarySidebarWidth, h: canvasLibraryHeight || rect.height }, startPos: { x: rect.left, y: rect.top } };
              }}
            >
              <div className={`absolute inset-0 rounded-r transition-colors group-hover:${isLightCanvas ? 'bg-blue-400/40' : 'bg-blue-500/40'}`} />
            </div>
            {/* 上侧边缘拖拽调高 */}
            <div
              className="absolute top-0 left-2 right-2 h-1.5 cursor-ns-resize z-10 group"
              onMouseDown={(e) => {
                e.preventDefault(); e.stopPropagation();
                const el = e.currentTarget.closest('[data-canvas-lib-panel]') as HTMLElement;
                if (!el) return;
                const rect = el.getBoundingClientRect();
                document.body.style.cursor = 'ns-resize'; document.body.style.userSelect = 'none';
                canvasLibResizeRef.current = { edge: 'top', startMouse: { x: e.clientX, y: e.clientY }, startSize: { w: creativeLibrarySidebarWidth, h: canvasLibraryHeight || rect.height }, startPos: { x: rect.left, y: rect.top } };
              }}
            >
              <div className={`absolute inset-0 rounded-t transition-colors group-hover:${isLightCanvas ? 'bg-blue-400/40' : 'bg-blue-500/40'}`} />
            </div>
            {/* 左上角 */}
            <div
              className="absolute top-0 left-0 w-3 h-3 cursor-nwse-resize z-20"
              onMouseDown={(e) => {
                e.preventDefault(); e.stopPropagation();
                const el = e.currentTarget.closest('[data-canvas-lib-panel]') as HTMLElement;
                if (!el) return;
                const rect = el.getBoundingClientRect();
                document.body.style.cursor = 'nwse-resize'; document.body.style.userSelect = 'none';
                canvasLibResizeRef.current = { edge: 'top-left', startMouse: { x: e.clientX, y: e.clientY }, startSize: { w: creativeLibrarySidebarWidth, h: canvasLibraryHeight || rect.height }, startPos: { x: rect.left, y: rect.top } };
              }}
            />
            {/* 右上角 */}
            <div
              className="absolute top-0 right-0 w-3 h-3 cursor-nesw-resize z-20"
              onMouseDown={(e) => {
                e.preventDefault(); e.stopPropagation();
                const el = e.currentTarget.closest('[data-canvas-lib-panel]') as HTMLElement;
                if (!el) return;
                const rect = el.getBoundingClientRect();
                document.body.style.cursor = 'nesw-resize'; document.body.style.userSelect = 'none';
                canvasLibResizeRef.current = { edge: 'top-right', startMouse: { x: e.clientX, y: e.clientY }, startSize: { w: creativeLibrarySidebarWidth, h: canvasLibraryHeight || rect.height }, startPos: { x: rect.left, y: rect.top } };
              }}
            />
            {/* 右下角 */}
            <div
              className="absolute bottom-0 right-0 w-3 h-3 cursor-nwse-resize z-20"
              onMouseDown={(e) => {
                e.preventDefault(); e.stopPropagation();
                const el = e.currentTarget.closest('[data-canvas-lib-panel]') as HTMLElement;
                if (!el) return;
                const rect = el.getBoundingClientRect();
                document.body.style.cursor = 'nwse-resize'; document.body.style.userSelect = 'none';
                canvasLibResizeRef.current = { edge: 'bottom-right', startMouse: { x: e.clientX, y: e.clientY }, startSize: { w: creativeLibrarySidebarWidth, h: canvasLibraryHeight || rect.height }, startPos: { x: rect.left, y: rect.top } };
              }}
            />

            {/* 拖拽栏 + 控制按钮 */}
            <div className={`flex items-center gap-1 px-2 py-1.5 flex-shrink-0 border-b ${isLightCanvas ? 'border-gray-200' : 'border-white/10'}`}>
              {!canvasLibraryLocked && (
                <div
                  className="cursor-grab active:cursor-grabbing flex items-center"
                  style={{ color: isLightCanvas ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.25)' }}
                  onMouseDown={(e) => { const el = e.currentTarget.closest('[data-canvas-lib-panel]') as HTMLElement; if (el) startCanvasLibDrag('panel', e, el); }}
                >
                  <Icons.GripVertical size={12} />
                </div>
              )}
              <Icons.Layers size={14} className="text-blue-400 flex-shrink-0" />
              <span className={`text-xs font-bold flex-1 min-w-0 truncate ${isLightCanvas ? 'text-gray-900' : 'text-white'}`}>创意文本库</span>
              <span className={`text-[10px] flex-shrink-0 ${isLightCanvas ? 'text-gray-500' : 'text-zinc-500'}`}>({(creativeIdeas || []).length})</span>
              {/* 锁定 */}
              <button
                onClick={() => setCanvasLibraryLocked(!canvasLibraryLocked)}
                className="w-5 h-5 rounded flex items-center justify-center transition-all hover:scale-110"
                style={{ color: canvasLibraryLocked ? '#60a5fa' : (isLightCanvas ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.25)') }}
                title={canvasLibraryLocked ? '点击解锁（可拖拽）' : '点击锁定（防止误拖动）'}
              >
                {canvasLibraryLocked ? <Icons.Lock size={10} /> : <Icons.Unlock size={10} />}
              </button>
              {/* 收起 */}
              <button
                onClick={() => setIsCreativeLibraryCollapsed(true)}
                className={`w-5 h-5 rounded flex items-center justify-center transition-all ${isLightCanvas ? 'text-gray-400 hover:text-gray-700 hover:bg-gray-100' : 'text-zinc-500 hover:text-white hover:bg-white/10'}`}
                title="收起创意文本库"
              >
                <Icons.Close size={10} />
              </button>
            </div>

            {/* 筛选 */}
            <div className={`px-3 py-2 flex gap-1 flex-wrap border-b flex-shrink-0 ${isLightCanvas ? 'border-gray-100' : 'border-white/5'}`}>
              {[
                { key: 'all', label: '全部' },
                { key: 'favorite', label: '收藏' },
                { key: 'bp', label: '变量模式' },
                { key: 'workflow', label: '画布流程' },
              ].map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setLibraryFilter(key as typeof libraryFilter)}
                  className={`px-2 py-1 text-[10px] rounded-lg transition-all ${
                    libraryFilter === key
                      ? 'bg-blue-500/20 text-blue-400 border border-blue-500/40'
                      : isLightCanvas
                        ? 'bg-gray-100 text-gray-500 hover:bg-gray-200 border border-transparent'
                        : 'bg-white/5 text-zinc-400 hover:bg-white/10 border border-transparent'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* 创意列表 - 可点击应用，也可拖拽到画布 */}
            <div className="flex-1 overflow-y-auto overflow-x-hidden px-2 py-2 space-y-1.5 pointer-events-auto" onWheel={(e) => e.stopPropagation()}>
              {filteredIdeas.length === 0 ? (
                <div className={`text-center py-10 text-xs ${isLightCanvas ? 'text-gray-400' : 'text-zinc-500'}`}>
                  暂无创意
                </div>
              ) : (
                filteredIdeas.map((idea) => (
                  <button
                    key={idea.id}
                    type="button"
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('creativeIdeaId', String(idea.id));
                      e.dataTransfer.setData('nodeType', idea.isWorkflow ? 'idea' : idea.isBP ? 'bp' : 'text');
                      e.dataTransfer.effectAllowed = 'copy';
                    }}
                    onClick={() => handleApplyCreativeIdea(idea)}
                    className={`w-full text-left p-2 rounded-lg border transition-all cursor-pointer ${
                      idea.isWorkflow
                        ? 'bg-purple-500/10 border-purple-500/20 hover:bg-purple-500/20'
                        : idea.isBP
                        ? 'bg-blue-500/10 border-blue-500/20 hover:bg-blue-500/20'
                        : isLightCanvas
                          ? 'bg-gray-50 border-gray-200 hover:bg-gray-100'
                          : 'bg-white/5 border-white/5 hover:bg-white/10'
                    }`}
                  >
                    <div className="flex gap-2">
                      {idea.imageUrl && (
                        <div className="w-9 h-9 flex-shrink-0 rounded overflow-hidden bg-black/20">
                          <img src={idea.imageUrl} alt="" className="w-full h-full object-cover" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1 mb-0.5">
                          <span className={`text-[10px] font-bold truncate ${isLightCanvas ? 'text-gray-900' : 'text-white'}`}>
                            {idea.isFavorite && '* '}
                            {idea.title}
                          </span>
                          {idea.isWorkflow && <span className="text-[8px] bg-purple-500/30 text-purple-300 px-1 rounded flex-shrink-0">画布</span>}
                          {idea.isBP && <span className="text-[8px] bg-blue-500/30 text-blue-300 px-1 rounded flex-shrink-0">变量</span>}
                        </div>
                        <div className={`text-[9px] truncate ${isLightCanvas ? 'text-gray-500' : 'text-zinc-500'}`}>
                          {idea.isBP && idea.bpFields
                            ? `输入: ${idea.bpFields.map(f => f.label).join(', ')}`
                            : idea.isWorkflow && idea.workflowNodes
                            ? `${idea.workflowNodes.length} 个节点`
                            : idea.prompt.slice(0, 40) + (idea.prompt.length > 40 ? '...' : '')}
                        </div>
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        );
      })()}

      {/* 素材库浮动面板 - 按文件夹/画布分类，可拖拽图片/视频到画布 */}
      {(() => {
        const items = desktopItems || [];
        const itemMap = new Map(items.map(i => [i.id, i]));
        const folders = items.filter((i): i is DesktopFolderItem => i.type === 'folder');
        const itemIdsInFolders = new Set(folders.flatMap(f => f.itemIds));
        const topLevelMedia = items.filter((i): i is DesktopImageItem | DesktopVideoItem =>
          (i.type === 'image' || i.type === 'video') && !itemIdsInFolders.has(i.id)
        );
        const groups: { id: string; label: string; items: (DesktopImageItem | DesktopVideoItem)[] }[] = [];
        if (topLevelMedia.length > 0) groups.push({ id: '_top', label: '未分类', items: topLevelMedia });
        folders.forEach(f => {
          const groupItems = f.itemIds
            .map(id => itemMap.get(id))
            .filter((i): i is DesktopImageItem | DesktopVideoItem => !!i && (i.type === 'image' || i.type === 'video'));
          if (groupItems.length > 0) {
            const label = f.linkedCanvasId ? `画布: ${f.name}` : `文件夹: ${f.name}`;
            groups.push({ id: f.id, label, items: groupItems });
          }
        });
        const applyTypeFilter = (list: (DesktopImageItem | DesktopVideoItem)[]) => {
          if (mediaLibraryFilter === 'all') return list;
          if (mediaLibraryFilter === 'image') return list.filter(i => i.type === 'image');
          if (mediaLibraryFilter === 'video') return list.filter(i => i.type === 'video');
          return list;
        };
        const totalFiltered = groups.reduce((sum, g) => sum + applyTypeFilter(g.items).length, 0);

        if (isMediaLibraryCollapsed) {
          /* 收起态（标记为导入工具，不触发画布右键菜单） */
          return (
            <div
              data-media-lib-root
              className="select-none flex items-center gap-1 rounded-2xl border shadow-lg"
              style={{
                ...getCanvasFloatStyle(mediaLibraryIconPos),
                background: isLightCanvas ? 'rgba(255,255,255,0.9)' : 'rgba(20,20,25,0.85)',
                borderColor: isLightCanvas ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.1)',
                backdropFilter: 'blur(16px)',
                padding: '4px 6px',
                pointerEvents: 'auto',
              }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              {!mediaLibraryIconLocked && (
                <div
                  className="cursor-grab active:cursor-grabbing flex items-center"
                  style={{ color: isLightCanvas ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.25)' }}
                  onMouseDown={(e) => { const el = e.currentTarget.parentElement; if (el) startMediaLibDrag('icon', e, el); }}
                >
                  <Icons.GripVertical size={10} />
                </div>
              )}
              <button
                onClick={() => setIsMediaLibraryCollapsed(false)}
                className="w-8 h-8 rounded-xl flex items-center justify-center transition-all hover:scale-110 active:scale-95"
                style={{ color: '#22c55e' }}
                title="展开素材库"
              >
                <Icons.Image size={16} />
              </button>
              <button
                onClick={() => setMediaLibraryIconLocked(!mediaLibraryIconLocked)}
                className="w-4 h-4 rounded flex items-center justify-center transition-all hover:scale-110"
                style={{ color: mediaLibraryIconLocked ? '#22c55e' : (isLightCanvas ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.2)') }}
                title={mediaLibraryIconLocked ? '点击解锁' : '点击锁定'}
              >
                {mediaLibraryIconLocked ? <Icons.Lock size={8} /> : <Icons.Unlock size={8} />}
              </button>
            </div>
          );
        }

        return (
          <div
            data-media-lib-panel
            className="select-none flex flex-col rounded-2xl border shadow-2xl"
            style={{
              ...getCanvasFloatStyle(mediaLibraryPos),
              width: mediaLibraryWidth,
              height: mediaLibraryHeight > 0 ? mediaLibraryHeight : 'calc(100vh - 24px)',
              maxHeight: 'calc(100vh - 10px)',
              background: isLightCanvas ? 'rgba(255,255,255,0.97)' : 'rgba(20,20,25,0.95)',
              borderColor: isLightCanvas ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.1)',
              backdropFilter: 'blur(20px)',
              pointerEvents: 'auto',
              overflow: 'hidden',
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
            onDrop={(e) => handleDropOnCanvasOrPanel(e)}
          >
            <div
              className="absolute left-0 top-2 bottom-2 w-1.5 cursor-ew-resize z-10 group"
              onMouseDown={(e) => {
                e.preventDefault(); e.stopPropagation();
                const el = e.currentTarget.closest('[data-media-lib-panel]') as HTMLElement;
                if (!el) return;
                const rect = el.getBoundingClientRect();
                document.body.style.cursor = 'ew-resize'; document.body.style.userSelect = 'none';
                mediaLibResizeRef.current = { edge: 'left', startMouse: { x: e.clientX, y: e.clientY }, startSize: { w: mediaLibraryWidth, h: mediaLibraryHeight || rect.height }, startPos: { x: rect.left, y: rect.top } };
              }}
            >
              <div className={`absolute inset-0 rounded-l transition-colors group-hover:${isLightCanvas ? 'bg-green-400/40' : 'bg-green-500/40'}`} />
            </div>
            <div
              className="absolute bottom-0 left-2 right-2 h-1.5 cursor-ns-resize z-10 group"
              onMouseDown={(e) => {
                e.preventDefault(); e.stopPropagation();
                const el = e.currentTarget.closest('[data-media-lib-panel]') as HTMLElement;
                if (!el) return;
                const rect = el.getBoundingClientRect();
                document.body.style.cursor = 'ns-resize'; document.body.style.userSelect = 'none';
                mediaLibResizeRef.current = { edge: 'bottom', startMouse: { x: e.clientX, y: e.clientY }, startSize: { w: mediaLibraryWidth, h: mediaLibraryHeight || rect.height }, startPos: { x: rect.left, y: rect.top } };
              }}
            >
              <div className={`absolute inset-0 rounded-b transition-colors group-hover:${isLightCanvas ? 'bg-green-400/40' : 'bg-green-500/40'}`} />
            </div>
            <div
              className="absolute bottom-0 left-0 w-3 h-3 cursor-nesw-resize z-20"
              onMouseDown={(e) => {
                e.preventDefault(); e.stopPropagation();
                const el = e.currentTarget.closest('[data-media-lib-panel]') as HTMLElement;
                if (!el) return;
                const rect = el.getBoundingClientRect();
                document.body.style.cursor = 'nesw-resize'; document.body.style.userSelect = 'none';
                mediaLibResizeRef.current = { edge: 'bottom-left', startMouse: { x: e.clientX, y: e.clientY }, startSize: { w: mediaLibraryWidth, h: mediaLibraryHeight || rect.height }, startPos: { x: rect.left, y: rect.top } };
              }}
            />
            {/* 右侧边缘拖拽调宽 */}
            <div
              className="absolute right-0 top-2 bottom-2 w-1.5 cursor-ew-resize z-10 group"
              onMouseDown={(e) => {
                e.preventDefault(); e.stopPropagation();
                const el = e.currentTarget.closest('[data-media-lib-panel]') as HTMLElement;
                if (!el) return;
                const rect = el.getBoundingClientRect();
                document.body.style.cursor = 'ew-resize'; document.body.style.userSelect = 'none';
                mediaLibResizeRef.current = { edge: 'right', startMouse: { x: e.clientX, y: e.clientY }, startSize: { w: mediaLibraryWidth, h: mediaLibraryHeight || rect.height }, startPos: { x: rect.left, y: rect.top } };
              }}
            >
              <div className={`absolute inset-0 rounded-r transition-colors group-hover:${isLightCanvas ? 'bg-green-400/40' : 'bg-green-500/40'}`} />
            </div>
            {/* 上侧边缘拖拽调高 */}
            <div
              className="absolute top-0 left-2 right-2 h-1.5 cursor-ns-resize z-10 group"
              onMouseDown={(e) => {
                e.preventDefault(); e.stopPropagation();
                const el = e.currentTarget.closest('[data-media-lib-panel]') as HTMLElement;
                if (!el) return;
                const rect = el.getBoundingClientRect();
                document.body.style.cursor = 'ns-resize'; document.body.style.userSelect = 'none';
                mediaLibResizeRef.current = { edge: 'top', startMouse: { x: e.clientX, y: e.clientY }, startSize: { w: mediaLibraryWidth, h: mediaLibraryHeight || rect.height }, startPos: { x: rect.left, y: rect.top } };
              }}
            >
              <div className={`absolute inset-0 rounded-t transition-colors group-hover:${isLightCanvas ? 'bg-green-400/40' : 'bg-green-500/40'}`} />
            </div>
            {/* 左上角 */}
            <div
              className="absolute top-0 left-0 w-3 h-3 cursor-nwse-resize z-20"
              onMouseDown={(e) => {
                e.preventDefault(); e.stopPropagation();
                const el = e.currentTarget.closest('[data-media-lib-panel]') as HTMLElement;
                if (!el) return;
                const rect = el.getBoundingClientRect();
                document.body.style.cursor = 'nwse-resize'; document.body.style.userSelect = 'none';
                mediaLibResizeRef.current = { edge: 'top-left', startMouse: { x: e.clientX, y: e.clientY }, startSize: { w: mediaLibraryWidth, h: mediaLibraryHeight || rect.height }, startPos: { x: rect.left, y: rect.top } };
              }}
            />
            {/* 右上角 */}
            <div
              className="absolute top-0 right-0 w-3 h-3 cursor-nesw-resize z-20"
              onMouseDown={(e) => {
                e.preventDefault(); e.stopPropagation();
                const el = e.currentTarget.closest('[data-media-lib-panel]') as HTMLElement;
                if (!el) return;
                const rect = el.getBoundingClientRect();
                document.body.style.cursor = 'nesw-resize'; document.body.style.userSelect = 'none';
                mediaLibResizeRef.current = { edge: 'top-right', startMouse: { x: e.clientX, y: e.clientY }, startSize: { w: mediaLibraryWidth, h: mediaLibraryHeight || rect.height }, startPos: { x: rect.left, y: rect.top } };
              }}
            />
            {/* 右下角 */}
            <div
              className="absolute bottom-0 right-0 w-3 h-3 cursor-nwse-resize z-20"
              onMouseDown={(e) => {
                e.preventDefault(); e.stopPropagation();
                const el = e.currentTarget.closest('[data-media-lib-panel]') as HTMLElement;
                if (!el) return;
                const rect = el.getBoundingClientRect();
                document.body.style.cursor = 'nwse-resize'; document.body.style.userSelect = 'none';
                mediaLibResizeRef.current = { edge: 'bottom-right', startMouse: { x: e.clientX, y: e.clientY }, startSize: { w: mediaLibraryWidth, h: mediaLibraryHeight || rect.height }, startPos: { x: rect.left, y: rect.top } };
              }}
            />
            <div className={`flex items-center gap-1 px-2 py-1.5 flex-shrink-0 border-b ${isLightCanvas ? 'border-gray-200' : 'border-white/10'}`}>
              {!mediaLibraryLocked && (
                <div
                  className="cursor-grab active:cursor-grabbing flex items-center"
                  style={{ color: isLightCanvas ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.25)' }}
                  onMouseDown={(e) => { const el = e.currentTarget.closest('[data-media-lib-panel]') as HTMLElement; if (el) startMediaLibDrag('panel', e, el); }}
                >
                  <Icons.GripVertical size={12} />
                </div>
              )}
              <Icons.Image size={14} className="text-green-500 flex-shrink-0" />
              <span className={`text-xs font-bold flex-1 min-w-0 truncate ${isLightCanvas ? 'text-gray-900' : 'text-white'}`}>素材库</span>
              <span className={`text-[10px] flex-shrink-0 ${isLightCanvas ? 'text-gray-500' : 'text-zinc-500'}`}>({totalFiltered})</span>
              <button
                onClick={() => setMediaLibraryLocked(!mediaLibraryLocked)}
                className="w-5 h-5 rounded flex items-center justify-center transition-all hover:scale-110"
                style={{ color: mediaLibraryLocked ? '#22c55e' : (isLightCanvas ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.25)') }}
                title={mediaLibraryLocked ? '点击解锁（可拖拽）' : '点击锁定（防止误拖动）'}
              >
                {mediaLibraryLocked ? <Icons.Lock size={10} /> : <Icons.Unlock size={10} />}
              </button>
              <button
                onClick={() => setIsMediaLibraryCollapsed(true)}
                className={`w-5 h-5 rounded flex items-center justify-center transition-all ${isLightCanvas ? 'text-gray-400 hover:text-gray-700 hover:bg-gray-100' : 'text-zinc-500 hover:text-white hover:bg-white/10'}`}
                title="收起素材库"
              >
                <Icons.Close size={10} />
              </button>
            </div>
            <div className={`px-3 py-2 flex gap-1 flex-wrap border-b flex-shrink-0 ${isLightCanvas ? 'border-gray-100' : 'border-white/5'}`}>
              {[
                { key: 'all', label: '全部' },
                { key: 'image', label: '图片' },
                { key: 'video', label: '视频' },
              ].map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setMediaLibraryFilter(key as typeof mediaLibraryFilter)}
                  className={`px-2 py-1 text-[10px] rounded-lg transition-all ${
                    mediaLibraryFilter === key
                      ? 'bg-green-500/20 text-green-400 border border-green-500/40'
                      : isLightCanvas
                        ? 'bg-gray-100 text-gray-500 hover:bg-gray-200 border border-transparent'
                        : 'bg-white/5 text-zinc-400 hover:bg-white/10 border border-transparent'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto overflow-x-hidden px-2 py-2 space-y-3 pointer-events-auto" onWheel={(e) => e.stopPropagation()}>
              {totalFiltered === 0 ? (
                <div className={`text-center py-10 text-xs ${isLightCanvas ? 'text-gray-400' : 'text-zinc-500'}`}>
                  暂无素材，请在素材库 Tab 中添加
                </div>
              ) : (
                groups.map(group => {
                  const list = applyTypeFilter(group.items);
                  if (list.length === 0) return null;
                  return (
                    <div key={group.id} className="space-y-1.5">
                      <div className={`text-[10px] font-semibold truncate px-1 ${isLightCanvas ? 'text-gray-500' : 'text-zinc-400'}`}>
                        {group.label} ({list.length})
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {list.map((item) => {
                          const url = item.type === 'image' ? item.imageUrl : item.videoUrl;
                          const thumb = item.type === 'image' ? (item.thumbnailUrl || item.imageUrl) : (item.thumbnailUrl || item.videoUrl);
                          const nodeType = item.type === 'image' ? 'image' : 'video-output';
                          return (
                            <div
                              key={item.id}
                              role="button"
                              tabIndex={0}
                              draggable
                              onDragStart={(e) => {
                                mediaDragStartedRef.current = true;
                                e.dataTransfer.setData('nodeType', nodeType);
                                e.dataTransfer.setData('mediaUrl', url);
                                e.dataTransfer.effectAllowed = 'copy';
                              }}
                              onDragEnd={() => { mediaDragStartedRef.current = false; }}
                              onClick={() => {
                                if (mediaDragStartedRef.current) {
                                  mediaDragStartedRef.current = false;
                                  return;
                                }
                                handleApplyMediaItem(nodeType, url, item.name);
                              }}
                              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}
                              className={`rounded-lg border overflow-hidden cursor-grab active:cursor-grabbing transition-all outline-none ${
                                isLightCanvas ? 'bg-gray-50 border-gray-200 hover:bg-gray-100' : 'bg-white/5 border-white/5 hover:bg-white/10'
                              }`}
                              title={`点击或拖拽到画布 · ${item.name}`}
                            >
                              <div className="aspect-square relative bg-black/20">
                                {item.type === 'image' ? (
                                  <img src={thumb} alt="" className="w-full h-full object-cover pointer-events-none" draggable={false} />
                                ) : (
                                  <video src={thumb} className="w-full h-full object-cover pointer-events-none" muted playsInline preload="metadata" draggable={false} />
                                )}
                              </div>
                              <div className={`px-1.5 py-1 truncate text-[9px] ${isLightCanvas ? 'text-gray-600' : 'text-zinc-400'}`}>
                                {item.name}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        );
      })()}

      {/* 底部快捷键提示条 */}
      <div 
        className={`absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-3 px-4 py-1.5 rounded-full border pointer-events-none select-none z-30 transition-all duration-300 ${
          isLightCanvas 
            ? 'bg-white/80 border-gray-200/60 text-gray-400' 
            : 'bg-black/40 border-white/5 text-zinc-500'
        }`}
        style={{ backdropFilter: 'blur(12px)', fontSize: '10px' }}
      >
        <span><kbd className={`px-1 py-0.5 rounded text-[9px] font-mono ${isLightCanvas ? 'bg-gray-100 text-gray-500' : 'bg-white/10 text-zinc-400'}`}>Ctrl</kbd> + 拖动 = 框选</span>
        <span className="opacity-30">|</span>
        <span><kbd className={`px-1 py-0.5 rounded text-[9px] font-mono ${isLightCanvas ? 'bg-gray-100 text-gray-500' : 'bg-white/10 text-zinc-400'}`}>Shift</kbd> + 点击 = 多选</span>
        <span className="opacity-30">|</span>
        <span>右键 = 保存 / 删除</span>
        <span className="opacity-30">|</span>
        <span><kbd className={`px-1 py-0.5 rounded text-[9px] font-mono ${isLightCanvas ? 'bg-gray-100 text-gray-500' : 'bg-white/10 text-zinc-400'}`}>Space</kbd> + 拖动 = 平移</span>
        <span className="opacity-30">|</span>
        <span>滚轮 = 缩放</span>
      </div>

      {/* Context Menu */}
      {contextMenu && (
          <ContextMenu 
            x={contextMenu.x} 
            y={contextMenu.y} 
            onClose={() => setContextMenu(null)}
            options={contextOptions}
            isLight={isLightCanvas}
          />
      )}

      {/* 从 output 添加节点菜单（双击/拖拽连线后弹出） */}
      {addNodeFromOutputMenu && containerRef.current && (() => {
          const rect = containerRef.current.getBoundingClientRect();
          const menuX = rect.left + canvasOffset.x + addNodeFromOutputMenu.position.x * scale;
          const menuY = rect.top + canvasOffset.y + addNodeFromOutputMenu.position.y * scale;
          // 与左侧边栏名称、分组顺序一致：媒体 → 逻辑 → 第三方 → 其他
          const addNodeOptions = [
              { label: '图片', action: () => handleAddNodeFromOutput('image') },
              { label: '文本', action: () => handleAddNodeFromOutput('text') },
              { label: '视频', action: () => handleAddNodeFromOutput('video') },
              { label: 'LLM / 视觉', action: () => handleAddNodeFromOutput('llm') },
              { label: '中继', action: () => handleAddNodeFromOutput('relay') },
              { label: '魔法扩图', action: () => handleAddNodeFromOutput('edit') },
              { label: '画板', action: () => handleAddNodeFromOutput('drawing-board') },
              { label: 'RunningHub', action: () => handleAddNodeFromOutput('runninghub') },
              { label: 'ComfyUI', action: () => handleAddNodeFromOutput('comfyui') },
              { label: '去背', action: () => handleAddNodeFromOutput('remove-bg') },
              { label: '放大', action: () => handleAddNodeFromOutput('upscale') },
              { label: '预览', action: () => handleAddNodeFromOutput('preview') },
          ];
          return (
              <ContextMenu
                  x={menuX}
                  y={menuY}
                  onClose={() => setAddNodeFromOutputMenu(null)}
                  options={addNodeOptions}
                  isLight={isLightCanvas}
              />
          );
      })()}

      {/* Modals */}
      {showPresetModal && (
          <PresetCreationModal 
             selectedNodes={nodesForPreset}
             onCancel={() => setShowPresetModal(false)}
             onSave={(title, desc, inputs) => {
                 const newPreset: CanvasPreset = {
                     id: uuid(),
                     title,
                     description: desc,
                     nodes: JSON.parse(JSON.stringify(nodesForPreset)), // Deep copy
                     connections: connections.filter(c => {
                         const nodeIds = new Set(nodesForPreset.map(n => n.id));
                         return nodeIds.has(c.fromNode) && nodeIds.has(c.toNode);
                     }),
                     inputs
                 };
                 setUserPresets(prev => [...prev, newPreset]);
                 setShowPresetModal(false);
             }}
          />
      )}

      {instantiatingPreset && (
          <PresetInstantiationModal 
             preset={instantiatingPreset}
             onCancel={() => setInstantiatingPreset(null)}
             onConfirm={(inputValues) => {
                 // Clone Nodes
                 const idMap = new Map<string, string>();
                 const newNodes: CanvasNode[] = [];
                 
                 // Center placement
                 const centerX = (-canvasOffset.x + window.innerWidth/2) / scale;
                 const centerY = (-canvasOffset.y + window.innerHeight/2) / scale;
                 
                 // Find centroid of preset
                 const minX = Math.min(...instantiatingPreset.nodes.map(n => n.x));
                 const minY = Math.min(...instantiatingPreset.nodes.map(n => n.y));

                 instantiatingPreset.nodes.forEach(n => {
                     const newId = uuid();
                     idMap.set(n.id, newId);
                     
                     // Apply Inputs
                     let content = n.content;
                     let prompt = n.data?.prompt;
                     let system = n.data?.systemInstruction;

                     // Check overrides
                     instantiatingPreset.inputs.forEach(inp => {
                         if (inp.nodeId === n.id) {
                             const val = inputValues[`${n.id}-${inp.field}`];
                             if (val) {
                                 if (inp.field === 'content') content = val;
                                 if (inp.field === 'prompt') prompt = val;
                                 if (inp.field === 'systemInstruction') system = val;
                             }
                         }
                     });

                     newNodes.push({
                         ...n,
                         id: newId,
                         x: n.x - minX + centerX - 200, // Offset to center
                         y: n.y - minY + centerY - 150,
                         content,
                         data: { ...n.data, prompt, systemInstruction: system },
                         status: 'idle'
                     });
                 });

                 // Clone Connections
                 const newConns = instantiatingPreset.connections.map(c => ({
                     id: uuid(),
                     fromNode: idMap.get(c.fromNode)!,
                     toNode: idMap.get(c.toNode)!
                 }));

                 setNodes(prev => [...prev, ...newNodes]);
                 setConnections(prev => [...prev, ...newConns]);
                 setInstantiatingPreset(null);
             }}
          />
      )}

    </div>
  );
};

export default PebblingCanvas;
