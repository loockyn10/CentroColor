import type { StockMovement } from '@centrocolor/domain';

export interface StockCursor {
  receivedAt: string;
  id: string;
}
export interface StockSyncLocalPort {
  pending(businessId: string, limit: number): Promise<StockMovement[]>;
  acknowledge(movement: StockMovement, cloud: StockMovement): Promise<void>;
  fail(movement: StockMovement, message: string): Promise<void>;
  cursor(businessId: string): Promise<StockCursor | null>;
  applyRemote(movement: StockMovement): Promise<void>;
  advanceCursor(businessId: string, cursor: StockCursor): Promise<void>;
}
export interface StockSyncCloudPort {
  push(movement: StockMovement): Promise<StockMovement>;
  pull(
    businessId: string,
    after: StockCursor | null,
    limit: number,
  ): Promise<StockMovement[]>;
}

export async function syncStockMovements(
  businessId: string,
  local: StockSyncLocalPort,
  cloud: StockSyncCloudPort,
): Promise<{ pushed: number; pulled: number }> {
  const result = { pushed: 0, pulled: 0 };
  for (let processed = 0; processed < 1000;) {
    const page = await local.pending(
      businessId,
      Math.min(100, 1000 - processed),
    );
    if (!page.length) break;
    for (const movement of page) {
      if (movement.businessId !== businessId)
        throw new Error('Movimiento de otro negocio.');
      try {
        const cloudMovement = await cloud.push(movement);
        if (
          cloudMovement.id !== movement.id ||
          cloudMovement.businessId !== businessId
        )
          throw new Error('Cloud devolvió otro movimiento.');
        await local.acknowledge(movement, cloudMovement);
        result.pushed++;
      } catch (error) {
        await local.fail(
          movement,
          error instanceof Error
            ? error.message
            : error &&
                typeof error === 'object' &&
                'message' in error &&
                typeof error.message === 'string'
              ? error.message
              : 'Error al subir movimiento.',
        );
        throw error;
      }
      processed++;
    }
    if (page.length < 100) break;
  }
  let cursor = await local.cursor(businessId);
  for (let processed = 0; processed < 1000;) {
    const page = await cloud.pull(
      businessId,
      cursor,
      Math.min(100, 1000 - processed),
    );
    if (!page.length) break;
    for (const movement of page) {
      if (movement.businessId !== businessId || !movement.receivedAt)
        throw new Error('Movimiento Cloud inválido.');
      const next = { receivedAt: movement.receivedAt, id: movement.id };
      if (
        cursor &&
        (next.receivedAt < cursor.receivedAt ||
          (next.receivedAt === cursor.receivedAt && next.id <= cursor.id))
      )
        throw new Error('Cursor de stock no creciente.');
      await local.applyRemote(movement);
      await local.advanceCursor(businessId, next);
      cursor = next;
      result.pulled++;
      processed++;
    }
    if (page.length < 100) break;
  }
  return result;
}
