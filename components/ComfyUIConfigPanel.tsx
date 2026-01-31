/**
 * ComfyUI 配置 Tab 页：管理 ComfyUI 地址与工作流，从 JSON 自动解析参数并勾选暴露给画布
 */
import React, { useState, useEffect, useCallback } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import {
  ArrowLeft,
  Plus,
  Trash2,
  Edit2,
  Check,
  X,
  Workflow,
  Server,
  Loader2,
  Download,
  Upload,
} from 'lucide-react';
import {
  getComfyUIConfig,
  saveComfyUIAddresses,
  getComfyUIWorkflows,
  saveComfyUIWorkflow,
  deleteComfyUIWorkflow,
  parseWorkflowJsonToSlots,
  getPromptJsonForExecution,
  type ComfyUIWorkflowConfig,
  type ComfyUIInputSlot,
  type ComfyUIAddress,
  type ComfyUIExportBundle,
} from '../services/api/comfyui';

interface ComfyUIConfigPanelProps {
  onBack: () => void;
}

function newAddressId(): string {
  return 'addr-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9);
}

export const ComfyUIConfigPanel: React.FC<ComfyUIConfigPanelProps> = ({ onBack }) => {
  const { theme } = useTheme();
  const isLight = theme.name === 'light';
  const [addresses, setAddresses] = useState<ComfyUIAddress[]>([]);
  const [defaultId, setDefaultId] = useState<string | null>(null);
  const [workflows, setWorkflows] = useState<ComfyUIWorkflowConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingAddresses, setSavingAddresses] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [formTitle, setFormTitle] = useState('');
  const [formJson, setFormJson] = useState('');
  const [formSlots, setFormSlots] = useState<ComfyUIInputSlot[]>([]);
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);
  const [clearingWorkflows, setClearingWorkflows] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const loadWorkflows = useCallback(async () => {
    const res = await getComfyUIWorkflows();
    if (res.success && res.data) setWorkflows(res.data);
  }, []);

  useEffect(() => {
    const cfg = getComfyUIConfig();
    setAddresses(cfg.addresses || []);
    setDefaultId(cfg.defaultId ?? null);
    loadWorkflows().finally(() => setLoading(false));
  }, [loadWorkflows]);

  const handleSaveAddresses = () => {
    setSavingAddresses(true);
    saveComfyUIAddresses(addresses, defaultId);
    setSavingAddresses(false);
  };

  const handleSetDefault = (id: string) => {
    setDefaultId(id);
  };

  const handleAddAddress = () => {
    setAddresses((prev) => [
      ...prev,
      { id: newAddressId(), label: '新地址', baseUrl: 'http://127.0.0.1:8188' },
    ]);
  };

  const handleUpdateAddress = (id: string, field: 'label' | 'baseUrl', value: string) => {
    setAddresses((prev) =>
      prev.map((a) => (a.id === id ? { ...a, [field]: value } : a))
    );
  };

  const handleRemoveAddress = (id: string) => {
    setAddresses((prev) => prev.filter((a) => a.id !== id));
    if (defaultId === id) setDefaultId(prev => (prev === id ? null : prev));
  };

  const handleParseJson = () => {
    setFormError('');
    if (!formJson.trim()) {
      setFormError('请粘贴 ComfyUI API 格式的 workflow JSON');
      return;
    }
    try {
      JSON.parse(formJson);
    } catch {
      setFormError('JSON 格式无效');
      return;
    }
    const slots = parseWorkflowJsonToSlots(formJson);
    setFormSlots(slots);
  };

  const toggleSlotExposed = (slotKey: string) => {
    setFormSlots((prev) =>
      prev.map((s) => (s.slotKey === slotKey ? { ...s, exposed: !s.exposed } : s))
    );
  };

  const updateSlotField = (slotKey: string, field: 'defaultValue', value: string) => {
    setFormSlots((prev) =>
      prev.map((s) => (s.slotKey === slotKey ? { ...s, [field]: value || undefined } : s))
    );
  };

  const openAdd = () => {
    setEditingId(null);
    setFormTitle('');
    setFormJson('');
    setFormSlots([]);
    setFormError('');
    setAddOpen(true);
  };

  const openEdit = (w: ComfyUIWorkflowConfig) => {
    setEditingId(w.id);
    setFormTitle(w.title);
    setFormJson(w.workflowApiJson);
    setFormSlots(w.inputSlots.length ? [...w.inputSlots] : parseWorkflowJsonToSlots(w.workflowApiJson));
    setFormError('');
    setAddOpen(true);
  };

  const handleSaveWorkflow = async () => {
    setFormError('');
    if (!formTitle.trim()) {
      setFormError('请输入工作流名称');
      return;
    }
    if (!formJson.trim()) {
      setFormError('请粘贴 workflow JSON');
      return;
    }
    try {
      JSON.parse(formJson);
    } catch {
      setFormError('JSON 格式无效');
      return;
    }
    setFormSaving(true);
    const executableJson = getPromptJsonForExecution(formJson.trim());
    const workflowApiJsonToSave = executableJson ?? formJson.trim();
    if (!executableJson && formJson.trim().includes('"nodes"')) {
      setFormError('完整工作流中未找到可执行的 prompt（需包含 prompt 或 API 格式节点），请改用「API」导出或粘贴含 prompt 的 JSON');
      setFormSaving(false);
      return;
    }
    const res = await saveComfyUIWorkflow({
      id: editingId || undefined,
      title: formTitle.trim(),
      workflowApiJson: workflowApiJsonToSave,
      inputSlots: formSlots,
    });
    setFormSaving(false);
    if (res.success) {
      setAddOpen(false);
      loadWorkflows();
    } else {
      setFormError(res.error || '保存失败');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除该工作流？')) return;
    const res = await deleteComfyUIWorkflow(id);
    if (res.success) loadWorkflows();
  };

  /** 一键清空所有地址，二次确认 */
  const handleClearAllAddresses = () => {
    if (addresses.length === 0) return;
    if (!confirm('确定要清空所有 ComfyUI 地址吗？')) return;
    if (!confirm('此操作不可恢复，确定继续？')) return;
    setAddresses([]);
    setDefaultId(null);
    saveComfyUIAddresses([], null);
  };

  /** 一键清空所有工作流，二次确认 */
  const handleClearAllWorkflows = async () => {
    if (workflows.length === 0) return;
    if (!confirm('确定要清空所有工作流吗？')) return;
    if (!confirm('此操作不可恢复，确定继续？')) return;
    setClearingWorkflows(true);
    try {
      for (const w of workflows) {
        await deleteComfyUIWorkflow(w.id);
      }
      await loadWorkflows();
    } finally {
      setClearingWorkflows(false);
    }
  };

  /** 一键导出：地址 + 工作流（含完整 inputSlots），便于在其他主机导入 */
  const handleExport = async () => {
    const res = await getComfyUIWorkflows();
    const workflowList = res.success && res.data ? res.data : [];
    const bundle: ComfyUIExportBundle = {
      version: 1,
      exportedAt: new Date().toISOString(),
      addresses: [...addresses],
      workflows: workflowList.map((w) => ({
        title: w.title,
        workflowApiJson: w.workflowApiJson,
        inputSlots: w.inputSlots || [],
      })),
    };
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `comfyui-config-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  /** 一键导入：从 JSON 文件合并地址与工作流，保留暴露参数等信息 */
  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImporting(true);
    try {
      const text = await file.text();
      const data = JSON.parse(text) as ComfyUIExportBundle;
      if (!data || typeof data.version !== 'number' || !Array.isArray(data.addresses) || !Array.isArray(data.workflows)) {
        setImportMessage({ type: 'error', text: '无效的导出包格式，需包含 version、addresses、workflows' });
        setImporting(false);
        return;
      }
      const ts = Date.now();
      const mergedAddresses: ComfyUIAddress[] = [...addresses];
      for (const a of data.addresses) {
        const newId = `imported-addr-${ts}-${Math.random().toString(36).slice(2, 9)}`;
        mergedAddresses.push({ id: newId, label: a.label, baseUrl: a.baseUrl });
      }
      saveComfyUIAddresses(mergedAddresses, defaultId);
      setAddresses(mergedAddresses);

      for (const w of data.workflows) {
        if (!w.title || !w.workflowApiJson) continue;
        await saveComfyUIWorkflow({
          title: w.title,
          workflowApiJson: w.workflowApiJson,
          inputSlots: Array.isArray(w.inputSlots) ? w.inputSlots : [],
        });
      }
      await loadWorkflows();
      const addrCount = data.addresses.length;
      const wfCount = data.workflows.length;
      setImportMessage({ type: 'ok', text: `已导入 ${addrCount} 个地址、${wfCount} 个工作流（含暴露参数）` });
    } catch (err) {
      setImportMessage({ type: 'error', text: err instanceof Error ? err.message : '导入失败：JSON 解析错误' });
    }
    setImporting(false);
  };

  return (
    <div
      className="absolute inset-0 z-50 flex flex-col"
      style={{ backgroundColor: theme.colors.bgPrimary }}
    >
      {/* 头部 */}
      <div
        className="flex items-center justify-between px-6 py-4 border-b shrink-0"
        style={{ borderColor: theme.colors.border }}
      >
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-2 rounded-xl transition-colors hover:bg-black/5 dark:hover:bg-white/10"
            title="返回"
          >
            <ArrowLeft className="w-5 h-5" style={{ color: theme.colors.textSecondary }} />
          </button>
          <div className="flex items-center gap-2">
            <Workflow className="w-6 h-6 text-sky-500" />
            <h1 className="text-lg font-bold" style={{ color: theme.colors.textPrimary }}>
              ComfyUI 配置
            </h1>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        {/* ComfyUI 地址列表 + 画布默认 */}
        <section className="mb-8">
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-2">
              <Server className="w-4 h-4 text-sky-500" />
              <h2 className="text-sm font-semibold" style={{ color: theme.colors.textPrimary }}>
                ComfyUI 地址
              </h2>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={handleImportFile}
              />
              <button
                type="button"
                onClick={handleExport}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border transition-colors"
                style={{
                  borderColor: isLight ? 'rgba(14,165,233,0.4)' : 'rgba(56,189,248,0.3)',
                  color: theme.colors.textPrimary,
                  backgroundColor: isLight ? 'rgba(14,165,233,0.06)' : 'rgba(56,189,248,0.08)',
                }}
                title="导出地址与工作流（含暴露参数）到 JSON，便于在其他主机导入"
              >
                <Upload className="w-4 h-4" /> 导出配置
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={importing}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border transition-colors disabled:opacity-50"
                style={{
                  borderColor: isLight ? 'rgba(14,165,233,0.4)' : 'rgba(56,189,248,0.3)',
                  color: theme.colors.textPrimary,
                  backgroundColor: isLight ? 'rgba(14,165,233,0.06)' : 'rgba(56,189,248,0.08)',
                }}
                title="从 JSON 导入地址与工作流（保留暴露参数信息）"
              >
                {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                导入配置
              </button>
              <button
                type="button"
                onClick={handleAddAddress}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border transition-colors"
                style={{
                  borderColor: isLight ? 'rgba(14,165,233,0.4)' : 'rgba(56,189,248,0.3)',
                  color: theme.colors.textPrimary,
                  backgroundColor: isLight ? 'rgba(14,165,233,0.06)' : 'rgba(56,189,248,0.08)',
                }}
              >
                <Plus className="w-4 h-4" /> 添加其他地址
              </button>
              <button
                onClick={handleSaveAddresses}
                disabled={savingAddresses}
                className="px-4 py-2 rounded-xl font-medium text-sm bg-sky-500 text-white hover:bg-sky-600 disabled:opacity-50 flex items-center gap-2"
              >
                {savingAddresses ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                保存
              </button>
              {addresses.length > 0 && (
                <button
                  type="button"
                  onClick={handleClearAllAddresses}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border border-red-500/40 text-red-600 dark:text-red-400 hover:bg-red-500/10"
                  title="清空所有地址（需二次确认）"
                >
                  <Trash2 className="w-4 h-4" /> 一键清空地址
                </button>
              )}
            </div>
          </div>
          <p className="text-xs mb-3" style={{ color: theme.colors.textMuted }}>
            画布中的 ComfyUI 节点只能从下方列表选择地址；勾选「画布默认」的地址将作为新建节点时的默认选项。
          </p>
          <div className="space-y-3">
            {addresses.length === 0 ? (
              <div
                className="rounded-xl border-2 border-dashed py-6 text-center text-sm"
                style={{ borderColor: isLight ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)', color: theme.colors.textMuted }}
              >
                暂无地址，点击「添加其他地址」或先保存默认地址
              </div>
            ) : (
              addresses.map((addr) => (
                <div
                  key={addr.id}
                  className="rounded-xl border p-4 flex flex-col sm:flex-row sm:items-center gap-3 flex-wrap"
                  style={{
                    backgroundColor: theme.colors.bgSecondary,
                    borderColor: defaultId === addr.id ? 'rgba(14,165,233,0.5)' : (isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)'),
                  }}
                >
                  <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={addr.label}
                      onChange={(e) => handleUpdateAddress(addr.id, 'label', e.target.value)}
                      placeholder="显示名称（如：本地 / 办公室）"
                      className="rounded-lg px-3 py-2 text-sm outline-none border"
                      style={{
                        backgroundColor: theme.colors.bgPrimary,
                        borderColor: isLight ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)',
                        color: theme.colors.textPrimary,
                      }}
                    />
                    <input
                      type="text"
                      value={addr.baseUrl}
                      onChange={(e) => handleUpdateAddress(addr.id, 'baseUrl', e.target.value)}
                      placeholder="http://127.0.0.1:8188"
                      className="rounded-lg px-3 py-2 text-sm outline-none border"
                      style={{
                        backgroundColor: theme.colors.bgPrimary,
                        borderColor: isLight ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)',
                        color: theme.colors.textPrimary,
                      }}
                    />
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleSetDefault(addr.id)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 ${
                        defaultId === addr.id
                          ? 'bg-sky-500 text-white'
                          : 'border'
                      }`}
                      style={
                        defaultId !== addr.id
                          ? { borderColor: isLight ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.15)', color: theme.colors.textSecondary }
                          : undefined
                      }
                      title="画布中新建节点时默认选此地址"
                    >
                      {defaultId === addr.id ? <Check className="w-3.5 h-3.5" /> : null}
                      画布默认
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemoveAddress(addr.id)}
                      className="p-1.5 rounded-lg hover:bg-red-500/10 text-red-500"
                      title="删除此地址"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
          {importMessage && (
            <div
              className={`mt-3 rounded-lg px-4 py-2 text-sm flex items-center justify-between ${importMessage.type === 'ok' ? 'bg-green-500/10 text-green-600 dark:text-green-400' : 'bg-red-500/10 text-red-600 dark:text-red-400'}`}
            >
              <span>{importMessage.text}</span>
              <button type="button" onClick={() => setImportMessage(null)} className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/5">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
        </section>

        {/* 工作流列表 */}
        <section>
          <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
            <h2 className="text-sm font-semibold" style={{ color: theme.colors.textPrimary }}>
              工作流
            </h2>
            <div className="flex items-center gap-2">
              <button
                onClick={openAdd}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-sky-500 text-white hover:bg-sky-600"
              >
                <Plus className="w-4 h-4" /> 添加工作流
              </button>
              {workflows.length > 0 && (
                <button
                  type="button"
                  onClick={handleClearAllWorkflows}
                  disabled={clearingWorkflows}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border border-red-500/40 text-red-600 dark:text-red-400 hover:bg-red-500/10 disabled:opacity-50"
                  title="清空所有工作流（需二次确认）"
                >
                  {clearingWorkflows ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  一键清空工作流
                </button>
              )}
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-sky-500" />
            </div>
          ) : workflows.length === 0 ? (
            <div
              className="rounded-2xl border-2 border-dashed py-12 text-center text-sm"
              style={{ borderColor: isLight ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)', color: theme.colors.textMuted }}
            >
              暂无工作流，点击「添加工作流」从 ComfyUI 导出 API JSON 并配置暴露参数
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {workflows.map((w) => (
                <div
                  key={w.id}
                  className="rounded-xl border p-4 flex flex-col gap-2"
                  style={{
                    backgroundColor: theme.colors.bgSecondary,
                    borderColor: isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)',
                  }}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium truncate" style={{ color: theme.colors.textPrimary }}>
                      {w.title}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => openEdit(w)}
                        className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10"
                        title="编辑"
                      >
                        <Edit2 className="w-4 h-4" style={{ color: theme.colors.textMuted }} />
                      </button>
                      <button
                        onClick={() => handleDelete(w.id)}
                        className="p-1.5 rounded-lg hover:bg-red-500/10 text-red-500"
                        title="删除"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  <div className="text-xs" style={{ color: theme.colors.textMuted }}>
                    暴露参数: {w.inputSlots.filter((s) => s.exposed).length} / {w.inputSlots.length}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* 添加/编辑工作流弹层 */}
      {addOpen && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/50"
          onClick={() => setAddOpen(false)}
        >
          <div
            className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border shadow-2xl flex flex-col"
            style={{
              backgroundColor: theme.colors.bgPrimary,
              borderColor: isLight ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: theme.colors.border }}>
              <h3 className="text-base font-bold" style={{ color: theme.colors.textPrimary }}>
                {editingId ? '编辑工作流' : '添加工作流'}
              </h3>
              <button onClick={() => setAddOpen(false)} className="p-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/10">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: theme.colors.textMuted }}>
                  工作流名称
                </label>
                <input
                  type="text"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  placeholder="例如：文生图 SDXL"
                  className="w-full rounded-lg px-4 py-2 text-sm border outline-none"
                  style={{
                    backgroundColor: theme.colors.bgSecondary,
                    borderColor: theme.colors.border,
                    color: theme.colors.textPrimary,
                  }}
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-medium" style={{ color: theme.colors.textMuted }}>
                    ComfyUI JSON（支持两种格式）
                  </label>
                  <p className="text-[10px] mb-1" style={{ color: theme.colors.textMuted }}>
                    ① API 格式：从 ComfyUI「API」导出。② 完整工作流：含 nodes 时识别节点标题（如「正面提示词」）；若含 prompt 或根即 API 格式，会提取可执行部分并用于调用 ComfyUI。
                  </p>
                  <button
                    type="button"
                    onClick={handleParseJson}
                    className="text-xs px-2 py-1 rounded bg-sky-500/20 text-sky-500 hover:bg-sky-500/30"
                  >
                    解析参数
                  </button>
                </div>
                <textarea
                  value={formJson}
                  onChange={(e) => setFormJson(e.target.value)}
                  placeholder='粘贴 API 格式或完整工作流 JSON（含 nodes 时可识别节点标题）'
                  className="w-full rounded-lg px-4 py-3 text-xs font-mono border outline-none resize-none h-32"
                  style={{
                    backgroundColor: theme.colors.bgSecondary,
                    borderColor: theme.colors.border,
                    color: theme.colors.textPrimary,
                  }}
                />
              </div>
              {formSlots.length > 0 && (() => {
                // 按节点分组，便于管理员识别「哪个节点的哪些参数」可暴露
                const byNode = new Map<string, typeof formSlots>();
                formSlots.forEach((slot) => {
                  const key = slot.nodeId ?? slot.slotKey.split('_')[0] ?? 'other';
                  if (!byNode.has(key)) byNode.set(key, []);
                  byNode.get(key)!.push(slot);
                });
                const nodeOrder = Array.from(byNode.keys()).sort((a, b) => {
                  const na = parseInt(a, 10);
                  const nb = parseInt(b, 10);
                  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
                  return String(a).localeCompare(String(b));
                });
                return (
                  <div>
                    <label className="block text-xs font-medium mb-2" style={{ color: theme.colors.textMuted }}>
                      按节点勾选「暴露到画布」的参数（画布节点中可填写）
                    </label>
                    <div className="space-y-4 max-h-64 overflow-y-auto rounded-lg border p-3" style={{ borderColor: theme.colors.border }}>
                      {nodeOrder.map((nodeId) => {
                        const nodeSlots = byNode.get(nodeId)!;
                        const rawLabel = nodeSlots[0]?.nodeLabel ?? `节点 ${nodeId}`;
                        const dashIndex = rawLabel.indexOf(' — ');
                        const displayTitle = dashIndex >= 0 ? rawLabel.slice(dashIndex + 3) : rawLabel;
                        return (
                          <div key={nodeId} className="space-y-2">
                            <div
                              className="text-xs font-semibold pb-1 border-b shrink-0"
                              style={{ color: theme.colors.textPrimary, borderColor: theme.colors.border }}
                            >
                              <span>{displayTitle}</span>
                              <span className="ml-2 font-normal opacity-70" style={{ color: theme.colors.textMuted }}>节点 {nodeId}</span>
                            </div>
                            <div className="space-y-2 pl-1">
                              {nodeSlots.map((slot) => (
                                <div key={slot.slotKey} className="rounded-lg border p-2 space-y-1.5" style={{ borderColor: theme.colors.border }}>
                                  <label className="flex items-center gap-3 cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={!!slot.exposed}
                                      onChange={() => toggleSlotExposed(slot.slotKey)}
                                      className="rounded border-sky-500 text-sky-500"
                                    />
                                    <span className="text-sm truncate flex-1" style={{ color: theme.colors.textPrimary }}>
                                      {slot.label.includes(' · ') ? slot.label.split(' · ').pop() : slot.label}
                                    </span>
                                    <span className="text-xs shrink-0" style={{ color: theme.colors.textMuted }}>
                                      {slot.type}
                                    </span>
                                  </label>
                                  <div className="pl-6">
                                    <span className="text-[10px] mr-1" style={{ color: theme.colors.textMuted }}>默认值（暴露到画布时显示）</span>
                                    <input
                                      type="text"
                                      value={slot.defaultValue ?? ''}
                                      onChange={(e) => updateSlotField(slot.slotKey, 'defaultValue', e.target.value)}
                                      placeholder="未填时使用"
                                      className="w-full rounded px-2 py-1 text-xs border outline-none mt-0.5"
                                      style={{
                                        backgroundColor: theme.colors.bgPrimary,
                                        borderColor: theme.colors.border,
                                        color: theme.colors.textPrimary,
                                      }}
                                    />
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
              {formError && (
                <div className="rounded-lg px-4 py-2 text-sm bg-red-500/10 text-red-500 border border-red-500/20">
                  {formError}
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 px-6 py-4 border-t" style={{ borderColor: theme.colors.border }}>
              <button
                onClick={() => setAddOpen(false)}
                className="px-4 py-2 rounded-lg border text-sm"
                style={{ borderColor: theme.colors.border, color: theme.colors.textSecondary }}
              >
                取消
              </button>
              <button
                onClick={handleSaveWorkflow}
                disabled={formSaving}
                className="px-4 py-2 rounded-lg bg-sky-500 text-white text-sm font-medium hover:bg-sky-600 disabled:opacity-50 flex items-center gap-2"
              >
                {formSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ComfyUIConfigPanel;
