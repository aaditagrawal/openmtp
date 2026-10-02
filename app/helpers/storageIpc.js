import Storage from '../classes/Storage';

export function updateProfileStorage(request, allowedPaths) {
  if (
    !request ||
    !allowedPaths.includes(request.filePath) ||
    !['setAll', 'setItems'].includes(request.method) ||
    !request.data ||
    typeof request.data !== 'object' ||
    Array.isArray(request.data)
  ) {
    return { ok: false, error: 'Invalid profile storage request' };
  }
  const storage = new Storage(request.filePath);
  return { ok: storage[request.method](request.data) === true };
}
