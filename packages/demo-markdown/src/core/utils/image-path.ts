function isAbsoluteLocalPath(src: string): boolean {
  if (!src) return false;

  // Windows 盘符路径（C:\）与 UNC 路径（\\server\share）
  if (/^[a-z]:[\\/]/i.test(src) || /^\\\\[^\\]/.test(src)) return true;

  return src.startsWith("/");
}

function toFileUrl(src: string): string {
  const normalized = src.replace(/\\/g, "/");

  if (/^\/\/[^/]/.test(normalized)) {
    return `file:${normalized}`;
  }

  if (/^[a-z]:\//i.test(normalized)) {
    return `file:///${normalized}`;
  }

  return `file://${normalized}`;
}

export function resolveImageSrc(src: string): string {
  if (!src) return src;

  if (
    src.startsWith("http://") ||
    src.startsWith("https://") ||
    src.startsWith("file://") ||
    src.startsWith("data:") ||
    src.startsWith("milkup://")
  ) {
    return src;
  }

  if (isAbsoluteLocalPath(src)) {
    return toFileUrl(src);
  }

  // 相对路径：浏览器环境下无法解析本地文件系统，原样返回交给浏览器处理。
  // 需要按基准文件路径解析的宿主，应在自己的图片路径处理器里做（内核不知道「当前文件」是什么）。
  return src;
}
