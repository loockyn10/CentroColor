import Database from '@tauri-apps/plugin-sql';
import type { StorageHealthPort } from '@centrocolor/application';

export class SqliteStorageHealthAdapter implements StorageHealthPort {
  async check(): Promise<'ready' | 'unavailable'> {
    try {
      const db = await Database.load('sqlite:centrocolor.db');
      await db.select('SELECT 1 FROM app_meta LIMIT 1');
      return 'ready';
    } catch (error) {
      console.error('Local database unavailable', error);
      return 'unavailable';
    }
  }
}
