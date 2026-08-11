import axios from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../axios';

vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    default: { ...actual.default, put: vi.fn(), isAxiosError: actual.default.isAxiosError },
  };
});

vi.mock('../axios', () => ({
  default: { post: vi.fn() },
}));

vi.mock('../../components/Toast', () => ({
  Toast: { error: vi.fn() },
}));

describe('fileService mirror upload', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_FILE_UPLOAD_MODE = 'mirror';
  });

  it('keeps the multipart result and mirrors without credentials or retries', async () => {
    api.post
      .mockResolvedValueOnce({ data: { success: true, file: { filename: 'server.png' } } })
      .mockResolvedValueOnce({ data: {
        uploadId: 'upload-1', uploadUrl: 'https://s3.test/pending/file',
        headers: { 'Content-Type': 'image/png' },
      } })
      .mockResolvedValueOnce({ status: 204 });
    axios.put.mockResolvedValue({ status: 200 });
    const { default: fileService } = await import('../fileService');
    const file = new File(['image'], 'file.png', { type: 'image/png' });

    const result = await fileService.uploadFile(file, vi.fn());

    expect(result.data.file.filename).toBe('server.png');
    await vi.waitFor(() => expect(api.post).toHaveBeenCalledTimes(3));
    expect(api.post).toHaveBeenNthCalledWith(2, '/api/files/upload/presign', {
      originalFilename: 'file.png', contentType: 'image/png', size: file.size,
    }, expect.objectContaining({ maxRetries: 0 }));
    expect(axios.put).toHaveBeenCalledWith('https://s3.test/pending/file', file,
      expect.objectContaining({ withCredentials: false }));
    expect(api.post).toHaveBeenNthCalledWith(3, '/api/files/upload/mirror-result',
      expect.objectContaining({ uploadId: 'upload-1', success: true, status: 200 }),
      expect.objectContaining({ maxRetries: 0 }));
    expect(result.success).toBe(true);
  });

  it('keeps the multipart result when the mirror PUT fails', async () => {
    api.post
      .mockResolvedValueOnce({ data: { success: true, file: { filename: 'server.png' } } })
      .mockResolvedValueOnce({ data: {
        uploadId: 'upload-1', uploadUrl: 'https://s3.test/pending/file',
        headers: { 'Content-Type': 'image/png' },
      } })
      .mockResolvedValueOnce({ status: 204 });
    axios.put.mockRejectedValue(Object.assign(new Error('forbidden'), { response: { status: 403 } }));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { default: fileService } = await import('../fileService');

    const result = await fileService.uploadFile(
      new File(['image'], 'file.png', { type: 'image/png' }), vi.fn());

    expect(result.success).toBe(true);
    expect(result.data.file.filename).toBe('server.png');
    await vi.waitFor(() => expect(api.post).toHaveBeenCalledWith(
      '/api/files/upload/mirror-result',
      expect.objectContaining({ uploadId: 'upload-1', success: false, status: 403 }),
      expect.objectContaining({ maxRetries: 0 })
    ));
  });

  it('does not call S3 in server mode', async () => {
    process.env.NEXT_PUBLIC_FILE_UPLOAD_MODE = 'server';
    api.post.mockResolvedValueOnce({ data: { success: true, file: { filename: 'server.png' } } });
    const { default: fileService } = await import('../fileService');

    await fileService.uploadFile(new File(['image'], 'file.png', { type: 'image/png' }), vi.fn());

    expect(api.post).toHaveBeenCalledTimes(1);
    expect(axios.put).not.toHaveBeenCalled();
  });

  it('handles upload size limit errors without logging console errors', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { default: fileService } = await import('../fileService');

    const result = fileService.handleUploadError(
      Object.assign(new Error('파일 크기는 5MB를 초과할 수 없습니다.'), { status: 413 })
    );

    expect(result).toEqual({
      success: false,
      message: '파일 크기는 5MB를 초과할 수 없습니다.',
    });
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
