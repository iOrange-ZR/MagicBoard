
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { CreativeIdea, SmartPlusConfig, SmartPlusComponent, BPField, BPFieldType, BPAgentModel, AspectRatioType, ImageSizeType, CreativeCategoryType, CREATIVE_CATEGORIES } from '../types';
import { Upload as UploadIcon, XCircle as XCircleIcon, PlusCircle as PlusCircleIcon, Lightbulb as LightbulbIcon, AlertTriangle } from 'lucide-react';
import { defaultSmartPlusConfig } from '../App';
import { useTheme } from '../contexts/ThemeContext';
import { compressImage } from '../utils/image';

interface AddCreativeIdeaModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (idea: Partial<CreativeIdea>) => void;
  ideaToEdit?: CreativeIdea | null;
  presetImageUrl?: string | null; // 从桌面图片创建时预设的图片URL
  presetPrompt?: string | null; // 预设的提示词
  presetAspectRatio?: string | null; // 预设的画面比例
  presetResolution?: string | null; // 预设的分辨率
}

const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = error => reject(error);
  });
};

export const AddCreativeIdeaModal: React.FC<AddCreativeIdeaModalProps> = ({ isOpen, onClose, onSave, ideaToEdit, presetImageUrl, presetPrompt, presetAspectRatio, presetResolution }) => {
  const { theme, themeName } = useTheme();
  const isLight = themeName === 'light';
  
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState(''); // 作者字段
  const [category, setCategory] = useState<CreativeCategoryType | ''>(''); // 分类字段
  const [prompt, setPrompt] = useState('');
  const [ideaType, setIdeaType] = useState<'standard' | 'bp' | 'smartPlus'>('standard');
  const [smartPlusConfig, setSmartPlusConfig] = useState<SmartPlusConfig>(() => JSON.parse(JSON.stringify(defaultSmartPlusConfig)));
  const [bpFields, setBpFields] = useState<BPField[]>([]);
  const [suggestedAspectRatio, setSuggestedAspectRatio] = useState<AspectRatioType | ''>('');
  const [suggestedResolution, setSuggestedResolution] = useState<ImageSizeType | ''>('');
  
  const [allowViewPrompt, setAllowViewPrompt] = useState<boolean>(true);
  const [allowEditPrompt, setAllowEditPrompt] = useState<boolean>(true);
  
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  // 确认关闭对话框状态
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  
  // 拖拽状态跟踪
  const isDraggingRef = useRef(false);
  const mouseDownTargetRef = useRef<EventTarget | null>(null);
  
  // 提示词textarea引用
  const promptRef = useRef<HTMLTextAreaElement>(null);
  
  // 插入变量到提示词
  const insertVariable = (varText: string) => {
    const textarea = promptRef.current;
    if (!textarea) return;
    
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const newPrompt = prompt.substring(0, start) + varText + prompt.substring(end);
    setPrompt(newPrompt);
    
    // 设置光标位置到插入内容之后
    setTimeout(() => {
      textarea.focus();
      textarea.selectionStart = textarea.selectionEnd = start + varText.length;
    }, 0);
  };

  const resetState = useCallback(() => {
    setTitle('');
    setAuthor(''); // 重置作者
    setCategory(''); // 重置分类
    setPrompt('');
    setIdeaType('standard');
    setSmartPlusConfig(JSON.parse(JSON.stringify(defaultSmartPlusConfig)));
    setBpFields([]);
    setSuggestedAspectRatio('');
    setSuggestedResolution('');
    setAllowViewPrompt(true);
    setAllowEditPrompt(true);
    setFile(null);
    setPreviewUrl(null); 
    setError(null);
    setShowCloseConfirm(false);
  }, []);

  useEffect(() => {
    if (isOpen) {
      if (ideaToEdit) {
        console.log('[AddCreativeIdeaModal] 加载编辑数据:', {
          id: ideaToEdit.id,
          suggestedAspectRatio: ideaToEdit.suggestedAspectRatio,
          suggestedResolution: ideaToEdit.suggestedResolution
        });
        
        setTitle(ideaToEdit.title);
        setAuthor(ideaToEdit.author || ''); // 加载作者
        setCategory(ideaToEdit.category || ''); // 加载分类
        setPrompt(ideaToEdit.prompt);
        setPreviewUrl(ideaToEdit.imageUrl);
        setSuggestedAspectRatio(ideaToEdit.suggestedAspectRatio || '');
        setSuggestedResolution(ideaToEdit.suggestedResolution || '');
        setAllowViewPrompt(ideaToEdit.allowViewPrompt !== false); // 默认true
        setAllowEditPrompt(ideaToEdit.allowEditPrompt !== false); // 默认true
        if (ideaToEdit.isBP) {
            setIdeaType('bp');
            // Migration for old bpVariables if needed, though assumed bpFields is used now
            setBpFields(ideaToEdit.bpFields || []);
        } else if (ideaToEdit.isSmartPlus) {
            setIdeaType('smartPlus');
            setSmartPlusConfig(ideaToEdit.smartPlusConfig && ideaToEdit.smartPlusConfig.length > 0 ? ideaToEdit.smartPlusConfig : JSON.parse(JSON.stringify(defaultSmartPlusConfig)));
        } else {
            setIdeaType('standard');
        }
        setFile(null);
      } else {
        resetState();
        // 如果有预设图片URL，设置它
        if (presetImageUrl) {
          setPreviewUrl(presetImageUrl);
        }
        // 设置预设的提示词
        if (presetPrompt) {
          setPrompt(presetPrompt);
        }
        // 设置预设的画面比例
        if (presetAspectRatio) {
          setSuggestedAspectRatio(presetAspectRatio as AspectRatioType);
        }
        // 设置预设的分辨率
        if (presetResolution) {
          setSuggestedResolution(presetResolution as ImageSizeType);
        }
      }
    }
  }, [isOpen, ideaToEdit, resetState, presetImageUrl, presetPrompt, presetAspectRatio, presetResolution]);

  useEffect(() => {
    const currentUrl = previewUrl;
    return () => {
      if (currentUrl && currentUrl.startsWith('blob:')) {
        URL.revokeObjectURL(currentUrl);
      }
    };
  }, [previewUrl]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile && selectedFile.type.startsWith('image/')) {
      setFile(selectedFile);
      setPreviewUrl(URL.createObjectURL(selectedFile));
      setError(null);
    }
  };

  const handleSmartPlusConfigChange = (
    id: number,
    field: keyof Omit<SmartPlusComponent, 'id'>,
    value: boolean | string
  ) => {
      setSmartPlusConfig(prev => 
        prev.map(item => 
          item.id === id ? { ...item, [field]: value } : item
        )
      );
  };

  const handleAddSmartPlusComponent = () => {
    const newComponent: SmartPlusComponent = {
      id: Date.now(),
      label: '新组件',
      enabled: true,
      features: '',
    };
    setSmartPlusConfig(prev => [...prev, newComponent]);
  };

  const handleDeleteSmartPlusComponent = (id: number) => {
    setSmartPlusConfig(prev => prev.filter(item => item.id !== id));
  };

  // BP Logic
  const handleAddBPField = (type: BPFieldType) => {
      const id = Date.now().toString();
      const count = bpFields.length + 1;
      
      const newField: BPField = {
          id: id,
          type: type,
          name: type === 'input' ? `var${count}` : `agent${count}`,
          label: type === 'input' ? `变量${count}` : `智能体${count}`,
          agentConfig: type === 'agent' ? {
              instruction: "分析图片中的...",
              model: 'gemini-2.5-flash'
          } : undefined
      };
      setBpFields([...bpFields, newField]);
  };

  const handleRemoveBPField = (id: string) => {
      setBpFields(bpFields.filter(v => v.id !== id));
  };

  const handleBPFieldChange = (id: string, field: keyof BPField, value: any) => {
      setBpFields(bpFields.map(v => v.id === id ? { ...v, [field]: value } : v));
  };
  
  const handleBPAgentConfigChange = (id: string, key: 'instruction' | 'model', value: string) => {
      setBpFields(bpFields.map(v => {
          if (v.id === id && v.agentConfig) {
              return { ...v, agentConfig: { ...v.agentConfig, [key]: value } };
          }
          return v;
      }));
  };
  
  const handleSave = async () => {
    if (!title.trim() || !prompt.trim() || !previewUrl) {
      setError("请填写所有必填项并上传图片");
      return;
    }
    setError(null);

    try {
        // 获取原始图片URL
        const rawImageUrl = file ? await fileToBase64(file) : previewUrl;
        
        // 压缩封面图，最长边512px
        let imageUrl = rawImageUrl;
        try {
          imageUrl = await compressImage(rawImageUrl, 512);
          console.log('[创意库] 封面图已压缩到512px');
        } catch (e) {
          console.warn('[创意库] 封面图压缩失败，使用原图:', e);
        }
        
        const ideaData: Partial<CreativeIdea> = {
          id: ideaToEdit?.id,
          order: ideaToEdit?.order,
          title: title.trim(),
          author: author.trim() || undefined, // 保存作者
          category: category || undefined, // 保存分类
          prompt: prompt.trim(),
          imageUrl: imageUrl!,
          suggestedAspectRatio: suggestedAspectRatio !== '' ? suggestedAspectRatio as AspectRatioType : undefined,
          suggestedResolution: suggestedResolution !== '' ? suggestedResolution as ImageSizeType : undefined,
          isSmart: false, 
          isSmartPlus: ideaType === 'smartPlus',
          isBP: ideaType === 'bp',
          smartPlusConfig: ideaType === 'smartPlus' ? smartPlusConfig : undefined,
          bpFields: ideaType === 'bp' ? bpFields : undefined,
          // 权限设置（仅BP/SmartPlus模式有效）
          allowViewPrompt: (ideaType === 'bp' || ideaType === 'smartPlus') ? allowViewPrompt : true,
          allowEditPrompt: (ideaType === 'bp' || ideaType === 'smartPlus') ? allowEditPrompt : true,
        };
        
        console.log('[CreativeIdea] 保存:', { ratio: ideaData.suggestedAspectRatio, res: ideaData.suggestedResolution });
        onSave(ideaData);
    } catch (e) {
        console.error("Failed to process image file for saving:", e);
        setError("无法读取图片文件");
    }
  };

  // 处理背景点击 - 显示确认对话框
  const handleBackdropClick = (e: React.MouseEvent) => {
    // 如果是拖拽操作，不触发关闭
    if (isDraggingRef.current) {
      isDraggingRef.current = false;
      return;
    }
    // 确保点击的是背景区域，而不是从内部拖拽出来
    if (e.target === e.currentTarget && mouseDownTargetRef.current === e.currentTarget) {
      setShowCloseConfirm(true);
    }
  };
  
  // 跟踪鼠标按下位置
  const handleBackdropMouseDown = (e: React.MouseEvent) => {
    mouseDownTargetRef.current = e.target;
    isDraggingRef.current = false;
  };
  
  // 检测拖拽
  const handleBackdropMouseMove = () => {
    if (mouseDownTargetRef.current) {
      isDraggingRef.current = true;
    }
  };
  
  // 确认关闭
  const handleConfirmClose = () => {
    setShowCloseConfirm(false);
    onClose();
  };
  
  // 取消关闭
  const handleCancelClose = () => {
    setShowCloseConfirm(false);
  };

  if (!isOpen) return null;
  
  const modalTitle = ideaToEdit ? "编辑创意" : "新增创意到库";

  return (
    <div
      className="fixed inset-0 bg-black/85 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onMouseDown={handleBackdropMouseDown}
      onMouseMove={handleBackdropMouseMove}
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      style={{ animation: 'fadeIn 0.2s ease-out' }}
    >
      {/* 确认关闭对话框 */}
      {showCloseConfirm && (
        <div 
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60]"
          onClick={(e) => e.stopPropagation()}
        >
          <div 
            className="rounded-xl p-6 shadow-2xl border max-w-sm w-full mx-4 animate-scale-in"
            style={{
              background: theme.colors.bgPanel,
              borderColor: theme.colors.border
            }}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-blue-500/15 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-blue-400" />
              </div>
              <div>
                <h3 className="text-base font-semibold" style={{ color: theme.colors.textPrimary }}>确认关闭</h3>
                <p className="text-sm mt-0.5" style={{ color: theme.colors.textMuted }}>未保存的内容将丢失</p>
              </div>
            </div>
            <div className="flex gap-3 justify-end">
              <button
                onClick={handleCancelClose}
                className="px-4 py-2 text-sm font-medium rounded-lg transition-all"
                style={{ 
                  background: isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.1)',
                  color: theme.colors.textSecondary
                }}
              >
                继续编辑
              </button>
              <button
                onClick={handleConfirmClose}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-gray-500 hover:bg-gray-600 text-white transition-all"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
      
      <div 
        className="rounded-2xl shadow-2xl w-full max-w-6xl border flex flex-col animate-fade-in h-[90vh] overflow-hidden"
        style={{
          background: theme.colors.bgPanel,
          borderColor: theme.colors.border
        }}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0" style={{ borderColor: theme.colors.border }}>
          <h2 className="text-lg font-bold" style={{ color: theme.colors.textPrimary }}>{modalTitle}</h2>
          <button 
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center transition-all"
            style={{ 
              background: isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.05)',
              color: theme.colors.textMuted
            }}
          >
            <XCircleIcon className="w-5 h-5" />
          </button>
        </div>
        
        {/* 内容区域 - 左右布局 */}
        <div className="flex-1 flex min-h-0 overflow-hidden">
          {/* 左侧：基本信息 - 紧凑布局 */}
          <div className="w-72 flex-shrink-0 border-r p-4 space-y-3 overflow-y-auto custom-scrollbar" style={{ borderColor: theme.colors.border }}>
            {/* 效果图 */}
            <div>
              <label className="text-[10px] font-medium mb-1.5 block" style={{ color: theme.colors.textMuted }}>效果图 *</label>
              <input type="file" id="idea-image-upload" accept="image/*" className="hidden" onChange={handleFileChange} />
              {previewUrl ? (
                <div className="relative w-full aspect-[3/2] rounded-lg overflow-hidden" style={{ background: theme.colors.bgTertiary }}>
                  <img src={previewUrl} alt="Preview" className="w-full h-full object-cover" />
                  <button
                    onClick={() => { setFile(null); setPreviewUrl(null); }}
                    className="absolute top-1.5 right-1.5 w-5 h-5 bg-black/60 hover:bg-black/80 text-white rounded flex items-center justify-center transition-all">
                    <XCircleIcon className="w-3 h-3" />
                  </button>
                </div>
              ) : (
                <label htmlFor="idea-image-upload" className="flex flex-col items-center justify-center w-full aspect-[3/2] border border-dashed rounded-lg cursor-pointer hover:border-blue-500/50 transition-all" style={{ background: isLight ? 'rgba(0,0,0,0.02)' : 'rgba(255,255,255,0.02)', borderColor: theme.colors.border }}>
                  <UploadIcon className="w-6 h-6 mb-1" style={{ color: theme.colors.textMuted }} />
                  <p className="text-[10px]" style={{ color: theme.colors.textMuted }}>上传图片</p>
                </label>
              )}
            </div>
            
            {/* 标题 */}
            <div>
              <label className="text-[10px] font-medium mb-1 block" style={{ color: theme.colors.textMuted }}>标题 *</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-2.5 py-1.5 border rounded-lg text-xs focus:border-blue-500 outline-none transition-all"
                style={{ 
                  background: isLight ? 'rgba(248,250,252,0.95)' : 'rgba(31,41,55,0.8)',
                  borderColor: theme.colors.border,
                  color: theme.colors.textPrimary
                }}
                placeholder="创意标题"
              />
            </div>
            
            {/* 分类 */}
            <div>
              <label className="text-[10px] font-medium mb-1 block" style={{ color: theme.colors.textMuted }}>分类</label>
              <div className="grid grid-cols-3 gap-1">
                {CREATIVE_CATEGORIES.map(cat => (
                  <button
                    key={cat.key}
                    onClick={() => setCategory(category === cat.key ? '' : cat.key)}
                    className={`px-2 py-1.5 text-[10px] font-medium rounded-lg transition-all flex items-center justify-center gap-1`}
                    style={category === cat.key ? {
                      backgroundColor: '#3b82f6',
                      color: 'white'
                    } : {
                      background: isLight ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.05)',
                      color: theme.colors.textSecondary
                    }}
                  >
                    <span>{cat.icon}</span>
                    <span>{cat.label}</span>
                  </button>
                ))}
              </div>
            </div>
            
            {/* 作者 */}
            <div>
              <label className="text-[10px] font-medium mb-1 block" style={{ color: theme.colors.textMuted }}>作者</label>
              <div className="relative">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs" style={{ color: theme.colors.textMuted }}>@</span>
                <input
                  type="text"
                  value={author}
                  onChange={(e) => setAuthor(e.target.value)}
                  className="w-full pl-6 pr-2.5 py-1.5 border rounded-lg text-xs focus:border-blue-500 outline-none transition-all"
                  style={{ 
                    background: isLight ? 'rgba(248,250,252,0.95)' : 'rgba(31,41,55,0.8)',
                    borderColor: theme.colors.border,
                    color: theme.colors.textPrimary
                  }}
                  placeholder="作者名称"
                />
              </div>
            </div>
            
            {/* 创意模式 */}
            <div>
              <label className="text-[10px] font-medium mb-1.5 block" style={{ color: theme.colors.textMuted }}>创意模式</label>
              <div className="grid grid-cols-3 gap-1">
                {(['standard', 'bp'] as const).map(type => (
                  <button 
                    key={type} 
                    onClick={() => setIdeaType(type)} 
                    className="px-2 py-1.5 text-[10px] font-medium rounded-lg transition-all"
                    style={ideaType === type ? {
                      backgroundColor: type === 'bp' ? '#eed16d' : '#3b82f6',
                      color: type === 'bp' ? '#1a1a2e' : 'white'
                    } : {
                      background: isLight ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.05)',
                      color: theme.colors.textSecondary
                    }}
                  >
                    {type === 'standard' && '纯文本'}
                    {type === 'bp' && '智能变量'}
                  </button>
                ))}
              </div>
            </div>
            
            {/* 宽高比和分辨率 */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] font-medium mb-1 block" style={{ color: theme.colors.textMuted }}>宽高比</label>
                <select
                  value={suggestedAspectRatio}
                  onChange={(e) => setSuggestedAspectRatio(e.target.value as AspectRatioType | '')}
                  className="w-full px-3 py-2.5 border rounded-lg text-sm focus:border-blue-500 outline-none"
                  style={{ 
                    background: isLight ? 'rgba(248,250,252,0.95)' : 'rgba(31,41,55,0.95)',
                    borderColor: theme.colors.border,
                    color: theme.colors.textPrimary,
                    colorScheme: isLight ? 'light' : 'dark',
                  }}
                >
                  <option value="">-</option>
                  <option value="Auto">Auto</option>
                  <option value="1:1">1:1</option>
                  <option value="4:3">4:3</option>
                  <option value="3:4">3:4</option>
                  <option value="16:9">16:9</option>
                  <option value="9:16">9:16</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] font-medium mb-1 block" style={{ color: theme.colors.textMuted }}>分辨率</label>
                <select
                  value={suggestedResolution}
                  onChange={(e) => setSuggestedResolution(e.target.value as ImageSizeType | '')}
                  className="w-full px-3 py-2.5 border rounded-lg text-sm focus:border-blue-500 outline-none"
                  style={{ 
                    background: isLight ? 'rgba(248,250,252,0.95)' : 'rgba(31,41,55,0.95)',
                    borderColor: theme.colors.border,
                    color: theme.colors.textPrimary,
                    colorScheme: isLight ? 'light' : 'dark',
                  }}
                >
                  <option value="">-</option>
                  <option value="1K">1K</option>
                  <option value="2K">2K</option>
                  <option value="4K">4K</option>
                </select>
              </div>
            </div>
            
            {/* 权限设置 */}
            {(ideaType === 'bp' || ideaType === 'smartPlus') && (
              <div className="p-2.5 bg-blue-500/5 border border-blue-500/20 rounded-lg space-y-1.5">
                <div className="text-[10px] font-medium text-blue-400 flex items-center gap-1">
                  <span>🔐</span> 分享权限
                </div>
                <label className="flex items-center justify-between cursor-pointer py-0.5">
                  <span className="text-[10px]" style={{ color: theme.colors.textMuted }}>允许查看提示词</span>
                  <div className="relative">
                    <input
                      type="checkbox"
                      checked={allowViewPrompt}
                      onChange={(e) => {
                        setAllowViewPrompt(e.target.checked);
                        if (!e.target.checked) setAllowEditPrompt(false);
                      }}
                      className="sr-only peer"
                    />
                    <div className="w-7 h-3.5 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-2.5 after:w-2.5 after:transition-all peer-checked:bg-blue-500" style={{ background: isLight ? '#e2e8f0' : '#374151' }}></div>
                  </div>
                </label>
                <label className={`flex items-center justify-between cursor-pointer py-0.5 ${!allowViewPrompt ? 'opacity-40' : ''}`}>
                  <span className="text-[10px]" style={{ color: theme.colors.textMuted }}>允许编辑提示词</span>
                  <div className="relative">
                    <input
                      type="checkbox"
                      checked={allowEditPrompt}
                      onChange={(e) => setAllowEditPrompt(e.target.checked)}
                      disabled={!allowViewPrompt}
                      className="sr-only peer"
                    />
                    <div className="w-7 h-3.5 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-2.5 after:w-2.5 after:transition-all peer-checked:bg-blue-500" style={{ background: isLight ? '#e2e8f0' : '#374151' }}></div>
                  </div>
                </label>
              </div>
            )}
          </div>
          
          {/* 右侧：提示词编辑区 */}
          <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
            {/* 提示词标题栏 */}
            <div className="px-5 py-3 border-b flex items-center justify-between flex-shrink-0" style={{ borderColor: theme.colors.border }}>
              <div className="flex items-center gap-2">
                <span 
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: ideaType === 'bp' ? '#eed16d' : '#3b82f6' }}
                ></span>
                <span className="text-sm font-medium" style={{ color: theme.colors.textPrimary }}>
                  {ideaType === 'standard' && "提示词编辑"}
                  {ideaType === 'smartPlus' && "基础场景"}
                  {ideaType === 'bp' && "智能变量编排"}
                </span>
              </div>
              {/* BP模式下显示可点击的变量标签 */}
              {ideaType === 'bp' && bpFields.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {bpFields.map(f => (
                    <button
                      key={f.id}
                      onClick={() => insertVariable(f.type === 'agent' ? `{${f.name}}` : `/${f.name}`)}
                      className="px-2 py-0.5 text-[10px] font-mono rounded transition-all hover:scale-105 active:scale-95"
                      style={{ 
                        backgroundColor: 'rgba(238,209,109,0.2)', 
                        border: '1px solid rgba(238,209,109,0.35)',
                        color: '#eed16d'
                      }}
                      title={`点击插入 ${f.type === 'agent' ? `{${f.name}}` : `/${f.name}`}`}
                    >
                      {f.type === 'agent' ? `{${f.name}}` : `/${f.name}`}
                    </button>
                  ))}
                </div>
              )}
            </div>
            
            {/* 提示词输入区 - 占据所有剩余空间 */}
            <div className="flex-1 p-5 flex flex-col min-h-0">
              <textarea
                ref={promptRef}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                className={`flex-1 w-full p-4 border rounded-xl resize-none text-sm leading-relaxed font-mono outline-none transition-all ${
                  ideaType === 'bp' 
                    ? 'focus:ring-2' 
                    : 'focus:border-blue-500/50 focus:ring-2 focus:ring-blue-500/20'
                }`}
                style={{
                  background: isLight ? 'rgba(248,250,252,0.9)' : 'rgba(31,41,55,0.5)',
                  borderColor: ideaType === 'bp' ? 'rgba(238,209,109,0.35)' : theme.colors.border,
                  color: theme.colors.textPrimary
                }}
                placeholder={
                  ideaType === 'smartPlus' 
                    ? "输入一个基础场景描述..."
                    : ideaType === 'bp'
                      ? "示例：一张 /{风格} 的照片，主体是 {主体分析}，背景在 /{地点}。\n\n点击右上角标签可快速插入变量"
                      : "输入详细的提示词描述..."
                }
              />
            </div>
            
            {/* BP 配置区域 */}
            {ideaType === 'bp' && (
              <div className="px-5 pb-4 flex-shrink-0">
                <div 
                  className="p-4 rounded-xl"
                  style={{ 
                    backgroundColor: 'rgba(238,209,109,0.08)', 
                    border: '1px solid rgba(238,209,109,0.25)' 
                  }}
                >
                  <div className="flex justify-between items-center mb-3">
                    <span className="text-xs font-medium" style={{ color: '#eed16d' }}>智能变量配置</span>
                    <div className="flex gap-2">
                      <button 
                        onClick={() => handleAddBPField('input')} 
                        className="text-[10px] flex items-center gap-1 px-2 py-1 rounded-lg transition-colors"
                        style={{ backgroundColor: 'rgba(238,209,109,0.2)', color: '#eed16d' }}
                      >
                        <PlusCircleIcon className="w-3 h-3"/> 手动变量
                      </button>
                      <button 
                        onClick={() => handleAddBPField('agent')} 
                        className="text-[10px] flex items-center gap-1 px-2 py-1 rounded-lg transition-colors"
                        style={{ backgroundColor: 'rgba(238,209,109,0.15)', color: '#eed16d' }}
                      >
                        <LightbulbIcon className="w-3 h-3"/> 智能体变量
                      </button>
                    </div>
                  </div>
                  <div className="space-y-2 max-h-48 overflow-y-auto custom-scrollbar pr-1">
                    {bpFields.map(v => (
                      <div key={v.id} className={`p-2.5 rounded-lg border ${
                        v.type === 'agent' ? 'bg-blue-900/20 border-blue-700/50' : 'bg-blue-900/10 border-blue-800/30'
                      }`}>
                        <div className="flex gap-2 items-center">
                          <div className="relative flex items-center shrink-0">
                            <span className={`absolute left-2 text-xs font-mono ${v.type === 'agent' ? 'text-blue-400' : 'text-blue-500'}`}>
                              {v.type === 'agent' ? '{' : '/'}
                            </span>
                            <input 
                              value={v.name} 
                              onChange={(e) => handleBPFieldChange(v.id, 'name', e.target.value)}
                              className={`w-20 pl-4 pr-2 py-1 bg-gray-800 border rounded text-[11px] text-white outline-none font-mono ${
                                v.type === 'agent' ? 'border-blue-600 focus:border-blue-400' : 'border-blue-700 focus:border-blue-500'
                              }`}
                              placeholder="name"
                            />
                            <span className={`absolute right-2 text-xs font-mono ${v.type === 'agent' ? 'text-blue-400' : 'text-transparent'}`}>
                              {v.type === 'agent' ? '}' : ''}
                            </span>
                          </div>
                          <input 
                            value={v.label} 
                            onChange={(e) => handleBPFieldChange(v.id, 'label', e.target.value)}
                            className="flex-grow py-1 px-2 bg-gray-800 border border-gray-700 rounded text-[11px] text-white focus:border-gray-500 outline-none" 
                            placeholder="显示标签"
                          />
                          <button onClick={() => handleRemoveBPField(v.id)} className="text-gray-500 hover:text-gray-400 p-0.5">
                            <XCircleIcon className="w-4 h-4"/>
                          </button>
                        </div>
                        {v.type === 'agent' && v.agentConfig && (
                          <div className="mt-2 pt-2 border-t border-blue-500/20">
                            <textarea 
                              value={v.agentConfig.instruction}
                              onChange={(e) => handleBPAgentConfigChange(v.id, 'instruction', e.target.value)}
                              className="w-full bg-gray-800/50 text-[11px] text-gray-300 border border-blue-900/50 rounded-lg p-2 h-12 resize-none focus:ring-1 focus:ring-blue-500 outline-none"
                              placeholder="给智能体的指令..."
                            />
                          </div>
                        )}
                      </div>
                    ))}
                    {bpFields.length === 0 && (
                      <p className="text-[11px] text-gray-500 text-center py-3">
                        添加变量后，在提示词中使用 /name 或 {'{name}'} 引用
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}
            
            {/* Smart+ 配置区域 */}
            {ideaType === 'smartPlus' && (
              <div className="px-5 pb-4 flex-shrink-0">
                <div className="p-4 bg-blue-500/5 border border-blue-700/30 rounded-xl">
                  <div className="flex justify-between items-center mb-3">
                    <span className="text-xs font-medium text-blue-400">Smart+ 导演模式配置</span>
                    <button
                      onClick={handleAddSmartPlusComponent}
                      className="text-[10px] flex items-center gap-1 bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 px-2 py-1 rounded-lg"
                    >
                      <PlusCircleIcon className="w-3 h-3"/> 添加组件
                    </button>
                  </div>
                  <div className="space-y-2 max-h-40 overflow-y-auto custom-scrollbar pr-1">
                    {smartPlusConfig.map(component => (
                      <div key={component.id} className="flex items-center gap-2">
                        <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
                          <input
                            type="checkbox"
                            className="sr-only peer"
                            checked={component.enabled}
                            onChange={(e) => handleSmartPlusConfigChange(component.id, 'enabled', e.target.checked)}
                          />
                          <div className="w-7 h-4 bg-gray-700 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-blue-500"></div>
                        </label>
                        <input
                          type="text"
                          value={component.label}
                          onChange={(e) => handleSmartPlusConfigChange(component.id, 'label', e.target.value)}
                          className="w-20 px-2 py-1 text-[11px] font-medium text-gray-200 bg-gray-800 border border-gray-700 rounded-lg focus:border-blue-500 outline-none"
                        />
                        <input
                          type="text"
                          value={component.features}
                          onChange={(e) => handleSmartPlusConfigChange(component.id, 'features', e.target.value)}
                          className="flex-grow px-2 py-1 bg-gray-800 border border-gray-700 rounded-lg text-[11px] text-gray-300 focus:border-blue-500 outline-none"
                          placeholder={`输入特征...`}
                          disabled={!component.enabled}
                        />
                        <button
                          onClick={() => handleDeleteSmartPlusComponent(component.id)}
                          className="text-gray-500 hover:text-gray-400 p-0.5"
                        >
                          <XCircleIcon className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
        
        {/* 底部操作栏 */}
        <div className="px-6 py-4 border-t flex items-center justify-between flex-shrink-0" style={{ borderColor: theme.colors.border }}>
          <div>
            {error && <p className="text-sm text-gray-400">{error}</p>}
          </div>
          <div className="flex gap-3">
            <button 
              onClick={onClose} 
              className="px-5 py-2 text-sm font-medium rounded-lg transition-all"
              style={{ 
                background: isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.1)',
                color: theme.colors.textSecondary
              }}
            >
              取消
            </button>
            <button 
              onClick={handleSave} 
              className="px-6 py-2 bg-blue-500 hover:bg-blue-400 text-white text-sm font-medium rounded-lg shadow-lg shadow-blue-500/25 transition-all"
            >
              保存创意
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
