// 本地文件操作 API
import { get, post, del } from './index';

interface FileInfo {
  name: string;
  size: number;
  created: number;
  modified: number;
}

// 获取输出目录文件列表
export const listOutputFiles = async (): Promise<{ success: boolean; data?: FileInfo[]; error?: string }> => {
  return get<FileInfo[]>('/files/output');
};

// 获取输入目录文件列表
export const listInputFiles = async (): Promise<{ success: boolean; data?: FileInfo[]; error?: string }> => {
  return get<FileInfo[]>('/files/input');
};

// 保存图片到输出目录
export const saveToOutput = async (imageData: string, filename?: string): Promise<{ 
  success: boolean; 
  data?: { filename: string; path: string; url: string }; 
  error?: string 
}> => {
  return post('/files/save-output', { imageData, filename });
};

// 保存图片到输入目录
export const saveToInput = async (imageData: string, filename?: string): Promise<{ 
  success: boolean; 
  data?: { filename: string; path: string; url: string }; 
  error?: string 
}> => {
  return post('/files/save-input', { imageData, filename });
};

// 保存图片到系统桌面
export const saveToDesktop = async (imageData: string, filename?: string): Promise<{ 
  success: boolean; 
  data?: { filename: string; path: string; desktop_path: string }; 
  error?: string 
}> => {
  return post('/files/save-desktop', { imageData, filename });
};

// 删除输出目录文件
export const deleteOutputFile = async (filename: string): Promise<{ success: boolean; error?: string; message?: string }> => {
  return del(`/files/output/${filename}`);
};

// 删除输入目录文件
export const deleteInputFile = async (filename: string): Promise<{ success: boolean; error?: string; message?: string }> => {
  return del(`/files/input/${filename}`);
};

// 获取输出文件的完整URL
export const getOutputFileUrl = (filename: string): string => {
  return `/files/output/${filename}`;
};

// 获取输入文件的完整URL
export const getInputFileUrl = (filename: string): string => {
  return `/files/input/${filename}`;
};

// 保存视频到输出目录
export const saveVideoToOutput = async (videoData: string, filename?: string): Promise<{ 
  success: boolean; 
  data?: { filename: string; path: string; url: string }; 
  error?: string 
}> => {
  return post('/files/save-video', { videoData, filename });
};

// 单张保存到 output 子文件夹（不生成缩略图，避免不支持的图片格式导致报错）
export const saveToOutputInFolder = async (
  imageData: string,
  filename: string,
  subFolder: string
): Promise<{ success: boolean; data?: { filename: string; path: string; url: string }; error?: string }> => {
  return post('/files/save-output-to-folder', { imageData, filename, subFolder });
};

// 单个视频保存到 output 子文件夹（不生成缩略图）
export const saveVideoToOutputInFolder = async (
  videoData: string,
  filename: string,
  subFolder: string
): Promise<{ success: boolean; data?: { filename: string; path: string; url: string }; error?: string }> => {
  return post('/files/save-video-to-folder', { videoData, filename, subFolder });
};

// 将 output 根目录下的文件移入子文件夹（先单图保存再调用；缩略图会同步重命名便于展示）
export const moveOutputToFolder = async (
  filename: string,
  subFolder: string
): Promise<{ success: boolean; data?: { url: string }; error?: string }> => {
  return post('/files/move-output-to-folder', { filename, subFolder });
};

// 批量保存图片/视频到output子文件夹
export interface BatchSaveItem {
  data: string; // base64 data URL
  filename?: string;
  isVideo?: boolean;
}

export interface BatchSaveResult {
  folderName: string;
  folderUrl: string;
  results: Array<{
    index: number;
    success: boolean;
    data?: { filename: string; path: string; url: string };
    error?: string;
  }>;
  successCount: number;
  totalCount: number;
  coverIndex: number;
}

export const saveBatchToOutput = async (
  items: BatchSaveItem[], 
  subFolder: string, 
  coverIndex: number = 0
): Promise<{ success: boolean; data?: BatchSaveResult; error?: string }> => {
  return post('/files/save-batch', { items, subFolder, coverIndex });
};

// 下载远程图片并保存到output目录（用于处理第三方API返回的URL）
export const downloadRemoteToOutput = async (imageUrl: string, filename?: string): Promise<{ 
  success: boolean; 
  data?: { filename: string; path: string; url: string }; 
  error?: string 
}> => {
  return post('/files/download-remote', { imageUrl, filename });
};

// 🔧 保存缩略图到thumbnails目录
export const saveThumbnail = async (imageData: string, filename?: string): Promise<{ 
  success: boolean; 
  data?: { filename: string; path: string; url: string }; 
  error?: string 
}> => {
  return post('/files/save-thumbnail', { imageData, filename });
};

// 🔧 重建单个图片的缩略图
export const rebuildThumbnail = async (imageUrl: string): Promise<{ 
  success: boolean; 
  thumbnailUrl?: string; 
  error?: string 
}> => {
  return post('/files/rebuild-thumbnail', { imageUrl });
};
