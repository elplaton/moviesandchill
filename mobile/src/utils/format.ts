export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  for (let i = 0; i < u.length; i++) {
    if (v < 1024) return `${v.toFixed(1)} ${u[i]}`;
    v /= 1024;
  }
  return `${v.toFixed(1)} PB`;
}
