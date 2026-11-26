/**
 * Normalizes email addresses consistently across registration, login, and OAuth linking.
 */
export function normalizeEmail(email: string): string {
  if (typeof email !== 'string') {
    return '';
  }
  return email.trim().toLowerCase();
}

export function escapeRegexLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
