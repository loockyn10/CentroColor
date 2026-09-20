export interface Customer {
  id: string;
  businessId: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  documentNumber: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export type CustomerDetails = Pick<
  Customer,
  'fullName' | 'phone' | 'email' | 'documentNumber' | 'notes'
>;

export function normalizeCustomerDetails(
  details: CustomerDetails,
): CustomerDetails {
  const fullName = details.fullName.trim().replace(/\s+/g, ' ');
  if (!fullName) throw new Error('El nombre completo es obligatorio.');
  const email = details.email?.trim().toLowerCase() || null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new Error('Ingresá un email válido.');
  return {
    fullName,
    phone: details.phone?.trim().replace(/\s+/g, ' ') || null,
    email,
    documentNumber: details.documentNumber?.trim() || null,
    notes: details.notes?.trim() || null,
  };
}
