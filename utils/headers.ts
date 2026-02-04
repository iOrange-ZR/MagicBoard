/**
 * Fetch API 要求 header 值只能是 ISO-8859-1 字符。
 * 若 API Key 等从粘贴/配置来的字符串含有非 Latin-1 字符（如零宽字符、BOM、中文），会报错。
 * 此方法移除非法字符，避免 "String contains non ISO-8859-1 code point"。
 */
export function sanitizeHeaderValue(value: string): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[^\x00-\xFF]/g, '');
}
