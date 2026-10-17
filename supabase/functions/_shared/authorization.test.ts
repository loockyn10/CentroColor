import { describe, expect, it } from 'vitest';
import {
  assertBusinessAdmin,
  AuthorizationError,
  type BusinessMembershipAuthorization,
} from './authorization';
import { errorResponse } from './http';

const userId = 'user-1';
const businessId = 'business-1';

function membership(
  changes: Partial<BusinessMembershipAuthorization> = {},
): BusinessMembershipAuthorization {
  return {
    business_id: businessId,
    user_id: userId,
    role: 'owner',
    is_active: true,
    ...changes,
  };
}

describe('assertBusinessAdmin', () => {
  it.each(['owner', 'admin'])(
    'autoriza un usuario autenticado con membership activo y rol %s',
    (role) => {
      expect(
        assertBusinessAdmin(userId, businessId, membership({ role })),
      ).toMatchObject({ role, is_active: true });
    },
  );

  it('rechaza staff con una respuesta HTTP 403', async () => {
    expect(() =>
      assertBusinessAdmin(userId, businessId, membership({ role: 'staff' })),
    ).toThrowError(AuthorizationError);
    try {
      assertBusinessAdmin(userId, businessId, membership({ role: 'staff' }));
    } catch (error) {
      expect(error).toMatchObject({ status: 403 });
      const response = errorResponse(error);
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({
        error: 'Se requiere rol owner o admin.',
      });
    }
  });

  it('rechaza una membership de otro Business con 403', () => {
    expect(() =>
      assertBusinessAdmin(
        userId,
        businessId,
        membership({ business_id: 'business-2' }),
      ),
    ).toThrowError(AuthorizationError);
  });

  it('rechaza una membership de otro usuario o inactiva con 403', () => {
    expect(() =>
      assertBusinessAdmin(
        userId,
        businessId,
        membership({ user_id: 'user-2' }),
      ),
    ).toThrowError(AuthorizationError);
    expect(() =>
      assertBusinessAdmin(userId, businessId, membership({ is_active: false })),
    ).toThrowError(AuthorizationError);
  });

  it('rechaza la ausencia de membership con 403', () => {
    expect(() => assertBusinessAdmin(userId, businessId, null)).toThrowError(
      AuthorizationError,
    );
  });
});
