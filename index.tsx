import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';

const DEBUG = typeof window !== 'undefined' && /[?&]debug=1/.test(window.location.search);

const rootElement = document.getElementById('root');
if (!rootElement) {
  const msg = '[index] 未找到 #root 节点，无法挂载应用';
  console.error(msg);
  document.body.innerHTML = `<div style="padding:24px;font-family:sans-serif;color:#f87171;">${msg}</div>`;
  throw new Error(msg);
}

try {
  if (DEBUG) console.log('[index] 开始挂载 React 根节点');
  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <React.StrictMode>
      <ErrorBoundary fallbackTitle="应用渲染出错（错误边界）">
        <App />
      </ErrorBoundary>
    </React.StrictMode>
  );
  if (DEBUG) console.log('[index] React 根节点已挂载');
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : '';
  console.error('[index] 挂载失败:', err);
  rootElement.innerHTML = `
    <div style="padding:24px;max-width:800px;margin:40px auto;font-family:system-ui;background:#1e1e2e;color:#e0e0e0;border-radius:12px;">
      <h1 style="color:#f87171;">挂载失败</h1>
      <p><strong>${message}</strong></p>
      ${stack ? `<pre style="background:#0d0d14;padding:12px;border-radius:8px;font-size:12px;overflow:auto;">${stack}</pre>` : ''}
      <p style="margin-top:16px;font-size:12px;color:#94a3b8;">请打开控制台 (F12) 查看完整错误。若使用 ?debug=1 可开启调试日志。</p>
    </div>
  `;
}
