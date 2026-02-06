
import React, { useState } from 'react';
import { Icons } from './Icons';
import { NodeType, NodeData, CanvasPreset } from '../../types/pebblingTypes';
import { CanvasListItem } from '../../services/api/canvas';

// 香蕉SVG图标组件
const BananaIcon: React.FC<{ size?: number; className?: string }> = ({ size = 14, className = '' }) => (
  <svg 
    width={size} 
    height={size} 
    viewBox="0 0 24 24" 
    fill="currentColor" 
    className={className}
  >
    <path d="M20.5,10.5c-0.8-0.8-1.9-1.3-3-1.4c0.1-0.5,0.2-1.1,0.2-1.6c0-2.2-1.8-4-4-4c-1.4,0-2.6,0.7-3.3,1.8 C9.6,4.2,8.4,3.5,7,3.5c-2.2,0-4,1.8-4,4c0,0.5,0.1,1.1,0.2,1.6c-1.1,0.1-2.2,0.6-3,1.4c-1.4,1.4-1.4,3.7,0,5.1 c0.7,0.7,1.6,1.1,2.5,1.1c0.9,0,1.8-0.4,2.5-1.1c0.7-0.7,1.1-1.6,1.1-2.5c0-0.9-0.4-1.8-1.1-2.5c-0.2-0.2-0.4-0.4-0.7-0.5 c-0.1-0.4-0.2-0.9-0.2-1.3c0-1.1,0.9-2,2-2s2,0.9,2,2c0,0.5-0.2,0.9-0.5,1.3c-0.5,0.6-0.7,1.3-0.7,2.1c0,0.9,0.4,1.8,1.1,2.5 c0.7,0.7,1.6,1.1,2.5,1.1s1.8-0.4,2.5-1.1c0.7-0.7,1.1-1.6,1.1-2.5c0-0.8-0.3-1.5-0.7-2.1c-0.3-0.4-0.5-0.8-0.5-1.3 c0-1.1,0.9-2,2-2s2,0.9,2,2c0,0.5-0.1,0.9-0.2,1.3c-0.2,0.1-0.5,0.3-0.7,0.5c-0.7,0.7-1.1,1.6-1.1,2.5c0,0.9,0.4,1.8,1.1,2.5 c0.7,0.7,1.6,1.1,2.5,1.1c0.9,0,1.8-0.4,2.5-1.1C21.9,14.2,21.9,11.9,20.5,10.5z"/>
  </svg>
);

interface SidebarProps {
    onDragStart: (type: NodeType) => void;
    onAdd: (type: NodeType, data?: NodeData, title?: string) => void;
    userPresets: CanvasPreset[];
    onAddPreset: (presetId: string) => void;
    onDeletePreset: (presetId: string) => void;
    onHome: () => void;
    onOpenSettings: () => void;
    isApiConfigured: boolean;
    // 画布管理
    canvasList: CanvasListItem[];
    currentCanvasId: string | null;
    canvasName: string;
    isCanvasLoading: boolean;
    onCreateCanvas: () => void;
    onLoadCanvas: (id: string) => void;
    onDeleteCanvas: (id: string) => void;
    onRenameCanvas: (newName: string) => void;
    // 手动保存
    onManualSave?: () => void;
    autoSaveEnabled?: boolean;
    hasUnsavedChanges?: boolean;
    // 画布主题
    canvasTheme?: 'dark' | 'light';
    onToggleTheme?: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ 
  onDragStart, onAdd, userPresets, onAddPreset, onDeletePreset, onHome, onOpenSettings, isApiConfigured,
  canvasList, currentCanvasId, canvasName, isCanvasLoading, onCreateCanvas, onLoadCanvas, onDeleteCanvas, onRenameCanvas,
  onManualSave, autoSaveEnabled = false, hasUnsavedChanges = false,
  canvasTheme = 'dark', onToggleTheme
}) => {
  const [showCanvasPanel, setShowCanvasPanel] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editingName, setEditingName] = useState('');

  // 根据主题设置颜色
  const isLight = canvasTheme === 'light';
  const dockBg = isLight ? 'bg-white/95' : 'bg-[#1c1c1e]/95';
  const dockBorder = isLight ? 'border-gray-200' : 'border-white/10';
  const btnBg = isLight ? 'bg-gray-100' : 'bg-white/5';
  const btnHoverBg = isLight ? 'hover:bg-gray-200' : 'hover:bg-white/15';
  const btnText = isLight ? 'text-gray-600' : 'text-zinc-400';
  const btnHoverText = isLight ? 'hover:text-gray-900' : 'hover:text-white';
  const labelText = isLight ? 'text-gray-500' : 'text-zinc-600';

  // Default Presets
  const defaultPresets = [
      {
          id: 'p1',
          title: "Vision: Describe Image",
          description: "Reverse engineer an image into a prompt.",
          type: 'llm' as NodeType,
          data: { systemInstruction: "You are an expert computer vision assistant. Describe the input image in extreme detail, focusing on style, lighting, composition, and subjects." }
      },
      {
          id: 'p2',
          title: "Text Refiner",
          description: "Rewrite text to be professional and concise.",
          type: 'llm' as NodeType,
          data: { systemInstruction: "You are a professional editor. Rewrite the following user text to be more concise, professional, and impactful. Maintain the original meaning." }
      },
      {
          id: 'p3',
          title: "Story Expander",
          description: "Turn a simple sentence into a paragraph.",
          type: 'llm' as NodeType,
          data: { systemInstruction: "You are a creative writer. Take the user's short input and expand it into a vivid, descriptive paragraph suitable for a novel." }
      }
  ];

  return (
    <>
        <div className="fixed left-6 top-1/2 -translate-y-1/2 z-40 flex flex-col gap-4 pointer-events-none">
        
        {/* 画布管理按钮 - 随全局主题变色 */}
        <button 
            onClick={(e) => { e.stopPropagation(); setShowCanvasPanel(!showCanvasPanel); }}
            className={`w-12 h-12 rounded-2xl flex items-center justify-center border shadow-xl backdrop-blur-sm pointer-events-auto select-none transition-all active:scale-95 ${
              showCanvasPanel
                ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-600 dark:text-emerald-300'
                : isLight
                  ? 'bg-gray-100 border-gray-200 text-gray-700 hover:bg-gray-200'
                  : 'bg-white/5 border-white/10 text-zinc-300 hover:bg-white/10 hover:text-white'
            }`}
            title={isCanvasLoading ? '加载中...' : canvasName}
        >
            <Icons.Layout className="w-5 h-5" />
        </button>

        {/* 手动保存按钮 - 随全局主题变色 */}
        {onManualSave && (
            <button 
                onClick={(e) => { e.stopPropagation(); onManualSave(); }}
                className={`w-12 h-12 rounded-2xl flex items-center justify-center border shadow-xl backdrop-blur-sm pointer-events-auto select-none transition-all active:scale-95 relative ${
                    hasUnsavedChanges
                        ? 'bg-orange-500/20 border-orange-500/30 text-orange-600 dark:text-orange-300 animate-pulse'
                        : isLight
                          ? 'bg-gray-100 border-gray-200 text-gray-700 hover:bg-gray-200'
                          : 'bg-white/5 border-white/10 text-zinc-300 hover:bg-white/10 hover:text-white'
                }`}
                title={hasUnsavedChanges ? "有未保存的修改，点击保存" : "保存画布"}
            >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                </svg>
                {hasUnsavedChanges && (
                    <div className={`absolute -top-1 -right-1 w-3 h-3 bg-orange-500 rounded-full border-2 ${isLight ? 'border-white' : 'border-[#1c1c1e]'}`} />
                )}
            </button>
        )}

        {/* 画布主题切换按钮（与全局日夜同步） */}
        {onToggleTheme && (
            <button 
                onClick={(e) => { e.stopPropagation(); onToggleTheme(); }}
                className={`w-12 h-12 rounded-2xl flex items-center justify-center border shadow-xl backdrop-blur-sm pointer-events-auto select-none transition-all active:scale-95 ${
                    canvasTheme === 'light'
                        ? 'bg-amber-100 border-amber-300 text-amber-600'
                        : isLight
                          ? 'bg-gray-100 border-gray-200 text-gray-700 hover:bg-gray-200'
                          : 'bg-white/5 border-white/10 text-zinc-300 hover:bg-white/10 hover:text-white'
                }`}
                title={canvasTheme === 'light' ? '切换到深色' : '切换到浅色'}
            >
                {canvasTheme === 'light' ? (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                    </svg>
                ) : (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                    </svg>
                )}
            </button>
        )}

        {/* Main Dock */}
        <div 
            className={`${dockBg} backdrop-blur-xl border ${dockBorder} p-2 rounded-2xl flex flex-col gap-2 shadow-2xl pointer-events-auto items-center`}
            onMouseDown={(e) => {
                // 只在点击在 dock 背景上时阻止传播，不阻止拖拽事件
                if (e.target === e.currentTarget) {
                    e.stopPropagation();
                }
            }}
        >
            
            {/* Media Group */}
            <div className="flex flex-col gap-1.5">
                <span className={`text-[9px] font-bold ${labelText} text-center uppercase tracking-wider`}>Media</span>
                <DraggableButton type="image" icon={<Icons.Image />} label="Image" onDragStart={onDragStart} onClick={() => onAdd('image')} isLight={isLight} />
                <DraggableButton type="text" icon={<Icons.Type />} label="Text" onDragStart={onDragStart} onClick={() => onAdd('text')} isLight={isLight} />
                <DraggableButton type="video" icon={<Icons.Video />} label="Video" onDragStart={onDragStart} onClick={() => onAdd('video')} isLight={isLight} />
            </div>
            
            <div className={`w-8 h-px ${isLight ? 'bg-gray-200' : 'bg-white/10'} my-1`} />
            
            {/* Logic Group */}
            <div className="flex flex-col gap-1.5">
                <span className={`text-[9px] font-bold ${labelText} text-center uppercase tracking-wider`}>Logic</span>
                <DraggableButton type="llm" icon={<Icons.Sparkles />} label="LLM / Vision" onDragStart={onDragStart} onClick={() => onAdd('llm')} isLight={isLight} />
                <DraggableButton type="idea" icon={<Icons.Magic />} label="Idea Gen" onDragStart={onDragStart} onClick={() => onAdd('idea')} isLight={isLight} />
                <DraggableButton type="relay" icon={<Icons.Relay />} label="Relay" onDragStart={onDragStart} onClick={() => onAdd('relay')} isLight={isLight} />
                <DraggableButton type="edit" icon={<BananaIcon />} label="Magic" onDragStart={onDragStart} onClick={() => onAdd('edit')} isLight={isLight} />
                <DraggableButton 
                    type="runninghub" 
                    icon={<span className="text-[10px] font-black">R</span>} 
                    label="RunningHub" 
                    onDragStart={onDragStart} 
                    onClick={() => onAdd('runninghub')} 
                    isLight={isLight}
                />
                <DraggableButton 
                    type="drawing-board" 
                    icon={<Icons.Palette />} 
                    label="画板" 
                    onDragStart={onDragStart} 
                    onClick={() => onAdd('drawing-board')} 
                    isLight={isLight}
                />
            </div>

            <div className={`w-8 h-px ${isLight ? 'bg-gray-200' : 'bg-white/10'} my-1`} />

            {/* ComfyUI 分组：本地/局域网 ComfyUI */}
            <div className="flex flex-col gap-1.5">
                <span className={`text-[9px] font-bold ${labelText} text-center uppercase tracking-wider`}>ComfyUI</span>
                <DraggableButton 
                    type="comfyui" 
                    icon={<Icons.Workflow size={16} />} 
                    label="ComfyUI" 
                    onDragStart={onDragStart} 
                    onClick={() => onAdd('comfyui')} 
                    isLight={isLight}
                />
            </div>

        </div>
        </div>

        {/* 画布管理面板 - 随全局主题变色 */}
        {showCanvasPanel && (
            <div 
                className={`fixed left-24 top-6 z-30 w-72 backdrop-blur-xl border rounded-2xl shadow-2xl overflow-hidden animate-in slide-in-from-left-4 fade-in duration-300 pointer-events-auto ${
                    isLight ? 'bg-white/95 border-gray-200' : 'bg-[#1c1c1e]/95 border-white/10'
                }`}
                onMouseDown={(e) => e.stopPropagation()}
            >
                {/* 头部 */}
                <div className={`px-4 py-3 border-b flex items-center justify-between ${isLight ? 'border-gray-200' : 'border-white/10'}`}>
                    <div className="flex items-center gap-2">
                        <Icons.Layout size={14} className="text-emerald-500"/>
                        <span className={`text-sm font-bold ${isLight ? 'text-gray-900' : 'text-white'}`}>画布管理</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <button 
                            onClick={(e) => { e.stopPropagation(); onCreateCanvas(); }}
                            className="p-1.5 rounded-lg bg-emerald-500/20 text-emerald-600 dark:text-emerald-300 hover:bg-emerald-500/30 transition-colors"
                            title="新增画布"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                            </svg>
                        </button>
                        <button 
                            onClick={() => setShowCanvasPanel(false)} 
                            className={isLight ? 'text-gray-500 hover:text-gray-900' : 'text-zinc-500 hover:text-white'}
                        >
                            <Icons.Close size={14}/>
                        </button>
                    </div>
                </div>
                
                {/* 当前画布 */}
                <div className={`px-4 py-2 bg-emerald-500/5 border-b ${isLight ? 'border-gray-100' : 'border-white/5'}`}>
                    <div className={`text-[10px] mb-1 ${isLight ? 'text-gray-500' : 'text-zinc-500'}`}>当前画布</div>
                    {isEditingName ? (
                        <input
                            type="text"
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                            onBlur={() => {
                                if (editingName.trim() && editingName !== canvasName) {
                                    onRenameCanvas(editingName);
                                }
                                setIsEditingName(false);
                            }}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    if (editingName.trim() && editingName !== canvasName) {
                                        onRenameCanvas(editingName);
                                    }
                                    setIsEditingName(false);
                                } else if (e.key === 'Escape') {
                                    setIsEditingName(false);
                                }
                            }}
                            autoFocus
                            className={`w-full border border-emerald-500/30 rounded px-2 py-1 text-sm outline-none focus:border-emerald-500 ${isLight ? 'bg-gray-100 text-gray-900' : 'bg-white/10 text-white'}`}
                        />
                    ) : (
                        <div 
                            className="flex items-center gap-2 group cursor-pointer"
                            onClick={() => {
                                setEditingName(canvasName);
                                setIsEditingName(true);
                            }}
                        >
                            <span className={`text-sm font-medium truncate flex-1 ${isLight ? 'text-gray-900' : 'text-white'}`}>
                                {isCanvasLoading ? '加载中...' : canvasName}
                            </span>
                            <svg className={`w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity ${isLight ? 'text-gray-400' : 'text-zinc-500'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                            </svg>
                        </div>
                    )}
                </div>

                {/* 画布列表 */}
                <div className="max-h-80 overflow-y-auto" onWheel={(e) => e.stopPropagation()}>
                    {canvasList.length === 0 ? (
                        <div className={`p-4 text-center text-sm ${isLight ? 'text-gray-500' : 'text-zinc-500'}`}>暂无画布</div>
                    ) : (
                        canvasList
                            .sort((a, b) => b.updatedAt - a.updatedAt)
                            .map(canvas => (
                                <div
                                    key={canvas.id}
                                    className={`px-4 py-2.5 flex items-center justify-between group cursor-pointer border-b last:border-b-0 ${
                                        canvas.id === currentCanvasId ? 'bg-emerald-500/10' : ''
                                    } ${isLight ? 'hover:bg-gray-100 border-gray-100' : 'hover:bg-white/5 border-white/5'}`}
                                    onClick={() => {
                                        if (canvas.id !== currentCanvasId) {
                                            onLoadCanvas(canvas.id);
                                            setShowCanvasPanel(false);
                                        }
                                    }}
                                >
                                    <div className="flex-1 min-w-0">
                                        <div className={`text-sm truncate flex items-center gap-2 ${isLight ? 'text-gray-800' : 'text-zinc-200'}`}>
                                            {canvas.name}
                                            {canvas.id === currentCanvasId && (
                                                <span className="text-[9px] bg-emerald-500/20 text-emerald-600 dark:text-emerald-300 px-1.5 py-0.5 rounded-full">当前</span>
                                            )}
                                        </div>
                                        <div className={`text-[10px] mt-0.5 ${isLight ? 'text-gray-500' : 'text-zinc-500'}`}>
                                            {canvas.nodeCount} 个节点 · {new Date(canvas.updatedAt).toLocaleDateString()}
                                        </div>
                                    </div>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            if (confirm(`确定删除画布「${canvas.name}」吗？`)) {
                                                onDeleteCanvas(canvas.id);
                                            }
                                        }}
                                        className={`p-1.5 rounded opacity-0 group-hover:opacity-100 hover:bg-red-500/20 transition-all ${isLight ? 'text-gray-500 hover:text-red-500' : 'text-zinc-500 hover:text-red-400'}`}
                                        title="删除画布"
                                    >
                                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                        </svg>
                                    </button>
                                </div>
                            ))
                    )}
                </div>

                {/* 底部操作 */}
                <div className={`px-4 py-2 border-t ${isLight ? 'border-gray-200 bg-gray-50' : 'border-white/10 bg-white/5'}`}>
                    <button 
                        onClick={(e) => { e.stopPropagation(); onHome(); }}
                        className={`w-full py-1.5 text-xs transition-colors flex items-center justify-center gap-1.5 ${isLight ? 'text-gray-500 hover:text-gray-900' : 'text-zinc-400 hover:text-white'}`}
                    >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                        </svg>
                        重置视图
                    </button>
                </div>
            </div>
        )}

    </>
  );
};

const DraggableButton = ({ type, icon, label, onDragStart, onClick, isLight = false }: { type: NodeType, icon: React.ReactNode, label: string, onDragStart: (t: NodeType) => void, onClick: () => void, isLight?: boolean }) => {
    const [isDragging, setIsDragging] = React.useState(false);
    const startPosRef = React.useRef({ x: 0, y: 0 });
    
    const btnBg = isLight ? 'bg-gray-100' : 'bg-white/5';
    const btnHoverBg = isLight ? 'hover:bg-gray-200' : 'hover:bg-white/15';
    const btnText = isLight ? 'text-gray-600' : 'text-zinc-400';
    const btnHoverText = isLight ? 'hover:text-gray-900' : 'hover:text-white';
    const tooltipBg = isLight ? 'bg-white' : 'bg-[#1c1c1e]';
    const tooltipBorder = isLight ? 'border-gray-200' : 'border-white/10';
    const tooltipText = isLight ? 'text-gray-800' : 'text-white';
    
    const handleMouseDown = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        startPosRef.current = { x: e.clientX, y: e.clientY };
        
        const handleMouseMove = (moveE: MouseEvent) => {
            const dx = moveE.clientX - startPosRef.current.x;
            const dy = moveE.clientY - startPosRef.current.y;
            // 移动超过 5px 才算拖拽
            if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
                if (!isDragging) {
                    setIsDragging(true);
                    console.log('[Sidebar] Mouse drag start:', type);
                    (window as any).__draggingNodeType = type;
                    (window as any).__dragMousePos = { x: moveE.clientX, y: moveE.clientY };
                }
                (window as any).__dragMousePos = { x: moveE.clientX, y: moveE.clientY };
            }
        };
        
        const handleMouseUp = (upE: MouseEvent) => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
            
            const dx = upE.clientX - startPosRef.current.x;
            const dy = upE.clientY - startPosRef.current.y;
            
            if (Math.abs(dx) <= 5 && Math.abs(dy) <= 5) {
                // 没有移动，算点击
                onClick();
            } else {
                // 拖拽结束，触发全局事件
                console.log('[Sidebar] Mouse drag end at:', upE.clientX, upE.clientY);
                (window as any).__dragMousePos = { x: upE.clientX, y: upE.clientY };
                // 触发自定义事件
                window.dispatchEvent(new CustomEvent('sidebar-drag-end', { 
                    detail: { type, x: upE.clientX, y: upE.clientY } 
                }));
            }
            
            setIsDragging(false);
            (window as any).__draggingNodeType = null;
        };
        
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    };
    
    return (
        <div
            onMouseDown={handleMouseDown}
            className="group relative cursor-grab active:cursor-grabbing select-none"
        >
            <div className={`w-8 h-8 rounded-lg ${btnBg} ${btnText} ${btnHoverText} ${btnHoverBg} hover:scale-105 transition-all shadow-inner border border-transparent hover:border-white/10 active:scale-95 flex items-center justify-center`}>
                 <span className="inline-flex items-center justify-center w-4 h-4 shrink-0">
                   {React.isValidElement(icon) ? React.cloneElement(icon as React.ReactElement<any>, { size: 16, className: 'shrink-0 block' }) : icon}
                 </span>
            </div>
            {/* Tooltip */}
            <div className={`absolute left-full top-1/2 -translate-y-1/2 ml-3 px-2 py-1 ${tooltipBg} border ${tooltipBorder} rounded text-[10px] font-medium ${tooltipText} opacity-0 group-hover:opacity-100 transition-all pointer-events-none whitespace-nowrap z-50 shadow-lg translate-x-[-5px] group-hover:translate-x-0`}>
                {label}
            </div>
        </div>
    )
}

export default Sidebar;
