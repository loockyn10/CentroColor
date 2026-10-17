import { describe, expect, it } from 'vitest';
import {
  syncPhotoFiles,
  type PhotoFileSyncCloudPort,
  type PhotoFileSyncLocalPort,
} from './photo-file-sync';
import type { PhotoJobFile } from '@centrocolor/domain';

describe('photo file metadata sync', () => {
  it('hace pull incremental sin producir escrituras binarias ni outbox', async () => {
    const file: PhotoJobFile = {
      id: 'file',
      businessId: 'business',
      photoJobId: 'job',
      photoJobItemId: 'item',
      driveFileId: 'drive-file',
      driveFolderId: 'drive-folder',
      originalFilename: 'foto.jpg',
      storedFilename: 'safe-foto.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 1234,
      copies: 2,
      workflowRoute: 'lab',
      status: 'uploaded',
      uploadedAt: '2026-10-16T12:00:00Z',
      createdAt: '2026-10-16T12:00:00Z',
      updatedAt: '2026-10-16T12:00:01Z',
    };
    const calls: string[] = [];
    const local: PhotoFileSyncLocalPort = {
      cursor: async () => null,
      apply: async (value) => {
        expect(value).toEqual(file);
        calls.push('apply');
      },
      advance: async (_business, cursor) => {
        expect(cursor.id).toBe('file');
        calls.push('cursor');
      },
    };
    const cloud: PhotoFileSyncCloudPort = { pull: async () => [file] };
    await expect(syncPhotoFiles('business', local, cloud)).resolves.toEqual({
      pulled: 1,
    });
    expect(calls).toEqual(['apply', 'cursor']);
    expect(Object.keys(file)).not.toContain('binary');
  });
});
