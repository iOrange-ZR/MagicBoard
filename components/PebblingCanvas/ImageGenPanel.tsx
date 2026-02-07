import React, { useEffect, useRef, useState } from 'react';
import { CanvasNode, NodeType } from '../../types/pebblingTypes';
import { Icons } from './Icons';

/** 多图输入缩略图：懒加载 + 错误占位，避免同时加载多张导致卡顿 */
const MultiInputThumb: React.FC<{ displayUrl: string; index: number; textMuted: string }> = ({ displayUrl, index, textMuted }) => {
  const [error, setError] = useState(false);
  return (
    <div className="w-10 h-10 rounded overflow-hidden shrink-0 bg-black/20 flex items-center justify-center relative">
      {!error && (
        <img
          src={displayUrl}
          alt=""
          className="w-full h-full object-cover absolute inset-0"
          loading="lazy"
          decoding="async"
          onError={() => setError(true)}
        />
      )}
      {error && <Icons.Image size={16} className={`${textMuted} shrink-0 relative z-0`} />}
      <span className="absolute top-0 right-0 min-w-[14px] h-[14px] flex items-center justify-center rounded-bl text-[10px] font-bold bg-blue-500 text-white leading-none" title={`第 ${index + 1} 张`}>{index + 1}</span>
    </div>
  );
};

interface ImageGenPanelProps {
  node: CanvasNode;
  /** Screen-space position for the panel (center-x, top-y) */
  position: { x: number; y: number };
  isLightCanvas: boolean;
  onUpdateSettings: (nodeId: string, settings: { aspectRatio?: string; resolution?: string }) => void;
  onUpdatePrompt: (nodeId: string, prompt: string) => void;
  onExecute: (nodeId: string) => void;
  onClose: () => void;
  isRunning: boolean;
  /** 工具箱回调：创建高清化/移除背景/扩展图片工具节点 */
  onCreateToolNode?: (sourceNodeId: string, toolType: NodeType, position: { x: number; y: number }) => void;
  /** 多图输入时按顺序的图片 URL 列表，用于预览并显示顺序标签（参考可灵 O1） */
  inputImages?: string[];
}

const ASPECT_RATIOS_ROW1 = ['Auto', '1:1', '3:4', '4:3', '9:16', '16:9'];
const ASPECT_RATIOS_ROW2 = ['2:3', '3:2', '4:5', '5:4', '21:9'];
const RESOLUTIONS = ['1K', '2K', '4K'];

const ImageGenPanel: React.FC<ImageGenPanelProps> = ({
  node,
  position,
  isLightCanvas,
  onUpdateSettings,
  onClose,
  onCreateToolNode,
  inputImages = [],
}) => {
  const settings = node.data?.settings || {};
  const currentRatio = settings.aspectRatio || 'Auto';
  const currentResolution = settings.resolution || '2K';
  const panelRef = useRef<HTMLDivElement>(null);

  // 判断节点是否已有图片内容（非空、非 prompt: 前缀）
  const hasImage = !!(node.content && !node.content.startsWith('prompt:'));
  const isToolboxMode = hasImage && !!onCreateToolNode;

  // Close on outside click - 使用延迟检测避免与节点选择冲突
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as HTMLElement)) {
        // 不要在点击画布节点时关闭（由 handleNodeDragStart 管理面板状态）
        const target = e.target as HTMLElement;
        if (target.closest?.('[data-node-id]')) return;
        onClose();
      }
    };
    document.addEventListener('mousedown', handler, true);
    return () => document.removeEventListener('mousedown', handler, true);
  }, [onClose, isToolboxMode]);

  // 多图输入时展示预览+顺序标签（仅顺序，无名称与插入）
  const hasMultiInput = inputImages.length > 1;

  // 面板尺寸根据模式不同（工具箱横排更宽更矮；配置面板含比例+分辨率，多图时略高）
  const panelW = isToolboxMode ? 220 : 260;
  const panelH = isToolboxMode ? 80 : (hasMultiInput ? 260 : 200);

  // Clamp position to viewport（面板在节点下方居中）
  const centeredX = position.x - panelW / 2;
  const clampedX = Math.max(16, Math.min(centeredX, window.innerWidth - panelW - 16));
  const clampedY = Math.max(60, Math.min(position.y, window.innerHeight - panelH - 16));

  const bg = isLightCanvas ? 'bg-white/95' : 'bg-[#1c1c1e]/95';
  const border = isLightCanvas ? 'border-gray-200' : 'border-white/10';
  const text = isLightCanvas ? 'text-gray-900' : 'text-white';
  const textMuted = isLightCanvas ? 'text-gray-500' : 'text-zinc-500';
  const handleSetRatio = (ratio: string) => {
    onUpdateSettings(node.id, { ...settings, aspectRatio: ratio });
  };

  const handleSetResolution = (res: string) => {
    onUpdateSettings(node.id, { ...settings, resolution: res });
  };

  const handleToolClick = (toolType: NodeType) => {
    if (onCreateToolNode) {
      onCreateToolNode(node.id, toolType, { x: node.x + node.width + 100, y: node.y });
      onClose();
    }
  };

  const toolBtnClass = isLightCanvas
    ? 'bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-700'
    : 'bg-white/5 hover:bg-white/10 border border-white/10 text-zinc-200';

  if (isToolboxMode) {
    // ===== 横向工具箱模式 =====
    return (
      <div
        ref={panelRef}
        className={`fixed z-[60] ${bg} backdrop-blur-xl border ${border} rounded-2xl shadow-2xl p-2 flex items-center gap-1 animate-in fade-in slide-in-from-top-2 duration-200`}
        style={{
          left: clampedX,
          top: clampedY,
          pointerEvents: 'auto',
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button
          className={`flex flex-col items-center gap-1 px-3 py-2 rounded-xl transition-all ${toolBtnClass} active:scale-[0.95]`}
          onClick={() => handleToolClick('upscale')}
          onMouseDown={(e) => e.stopPropagation()}
          title="高清化 - 提升图片分辨率"
        >
          <div className="w-8 h-8 rounded-lg bg-blue-500/15 flex items-center justify-center">
            <Icons.Sparkles size={16} className="text-blue-400" />
          </div>
          <span className={`text-[9px] font-semibold ${text}`}>高清化</span>
        </button>
        <button
          className={`flex flex-col items-center gap-1 px-3 py-2 rounded-xl transition-all ${toolBtnClass} active:scale-[0.95]`}
          onClick={() => handleToolClick('remove-bg')}
          onMouseDown={(e) => e.stopPropagation()}
          title="移除背景 - 提取图片主体"
        >
          <div className="w-8 h-8 rounded-lg bg-emerald-500/15 flex items-center justify-center">
            <Icons.Scissors size={16} className="text-emerald-400" />
          </div>
          <span className={`text-[9px] font-semibold ${text}`}>抠图</span>
        </button>
        <button
          className={`flex flex-col items-center gap-1 px-3 py-2 rounded-xl transition-all ${toolBtnClass} active:scale-[0.95]`}
          onClick={() => handleToolClick('edit')}
          onMouseDown={(e) => e.stopPropagation()}
          title="扩展图片 - AI 向外扩展画面"
        >
          <div className="w-8 h-8 rounded-lg bg-purple-500/15 flex items-center justify-center">
            <Icons.Expand size={16} className="text-purple-400" />
          </div>
          <span className={`text-[9px] font-semibold ${text}`}>扩图</span>
        </button>
      </div>
    );
  }

  return (
    <div
      ref={panelRef}
      className={`fixed z-[60] ${bg} backdrop-blur-xl border ${border} rounded-2xl shadow-2xl p-3 flex flex-col gap-2.5 animate-in fade-in slide-in-from-top-2 duration-200`}
      style={{
        left: clampedX,
        top: clampedY,
        width: panelW,
        pointerEvents: 'auto',
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className={`flex items-center justify-between pb-1.5 border-b ${border}`}>
        <div className="flex items-center gap-2">
          <Icons.Image size={14} className="text-blue-400" />
          <span className={`text-xs font-bold ${text}`}>图片生成配置</span>
        </div>
        <button
          onClick={onClose}
          className={`w-5 h-5 rounded flex items-center justify-center ${isLightCanvas ? 'hover:bg-gray-100 text-gray-400' : 'hover:bg-white/10 text-zinc-500'}`}
        >
          <Icons.Close size={10} />
        </button>
      </div>

      {/* 多图输入：按顺序的预览，右上角顺序标签（参考可灵 O1），懒加载与错误占位避免卡顿 */}
      {!isToolboxMode && hasMultiInput && (
        <div className="flex flex-col gap-1">
          <span className={`text-[10px] font-semibold ${textMuted}`}>输入顺序</span>
          <div className="flex gap-1 overflow-x-auto pb-0.5 max-h-14">
            {inputImages.map((url, idx) => {
              const displayUrl = url.startsWith('data:') || url.startsWith('http') ? url : (url.startsWith('/files/') ? `${typeof window !== 'undefined' ? window.location.origin : ''}${url}` : url);
              return (
                <MultiInputThumb key={`${idx}-${displayUrl.slice(0, 30)}`} displayUrl={displayUrl} index={idx} textMuted={textMuted} />
              );
            })}
          </div>
        </div>
      )}

      {/* ===== 生成配置模式（画面比例 + 分辨率） ===== */}
          {/* Aspect Ratio */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className={`text-[10px] font-semibold ${textMuted}`}>画面比例</span>
              <span className="text-[10px] font-mono font-semibold text-blue-400">{currentRatio}</span>
            </div>
            <div className="grid grid-cols-6 gap-0.5">
              {ASPECT_RATIOS_ROW1.map(ratio => (
                <button
                  key={ratio}
                  onClick={() => handleSetRatio(ratio)}
                  className={`py-1 text-[9px] font-semibold rounded-md transition-all ${
                    currentRatio === ratio
                      ? 'bg-blue-500 text-white shadow-sm'
                      : isLightCanvas
                        ? 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                        : 'bg-white/5 text-zinc-500 hover:bg-white/10'
                  }`}
                >
                  {ratio}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-5 gap-0.5 mt-0.5">
              {ASPECT_RATIOS_ROW2.map(ratio => (
                <button
                  key={ratio}
                  onClick={() => handleSetRatio(ratio)}
                  className={`py-1 text-[9px] font-semibold rounded-md transition-all ${
                    currentRatio === ratio
                      ? 'bg-blue-500 text-white shadow-sm'
                      : isLightCanvas
                        ? 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                        : 'bg-white/5 text-zinc-500 hover:bg-white/10'
                  }`}
                >
                  {ratio}
                </button>
              ))}
            </div>
          </div>

          {/* Resolution */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className={`text-[10px] font-semibold ${textMuted}`}>分辨率</span>
              <span className="text-[10px] font-mono font-semibold text-blue-400">{currentResolution}</span>
            </div>
            <div className="grid grid-cols-3 gap-0.5">
              {RESOLUTIONS.map(res => (
                <button
                  key={res}
                  onClick={() => handleSetResolution(res)}
                  className={`py-1 text-[10px] font-semibold rounded-md transition-all ${
                    currentResolution === res
                      ? 'bg-blue-500 text-white shadow-sm'
                      : isLightCanvas
                        ? 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                        : 'bg-white/5 text-zinc-500 hover:bg-white/10'
                  }`}
                >
                  {res}
                </button>
              ))}
            </div>
          </div>

      {/* 提示：通过节点上方的 Run 按钮执行生成 */}
    </div>
  );
};

export default ImageGenPanel;
