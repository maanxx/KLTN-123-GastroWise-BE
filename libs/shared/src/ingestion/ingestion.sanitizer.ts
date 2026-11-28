export const MAX_SANITIZE_DEPTH = 4 as const;
export const MAX_SANITIZE_OBJECT_KEYS = 20 as const;
export const MAX_SANITIZE_ARRAY_ITEMS = 20 as const;
export const MAX_SANITIZE_STRING_LENGTH = 500 as const;
export const MAX_DIAGNOSTIC_STRING_LENGTH = 200 as const;

const SENSITIVE_KEY_PATTERN =
  /password|passphrase|secret|token|api[-_]?key|auth(?:orization)?|cookie|credential|private[-_]?key|session|^_malformedJsonLine$|^_parseError$|^_invalidPayload$/i;

/**
 * Redacts credentials, tokens, sensitive query parameters, and inline secret pairs
 * from untrusted strings before returning them in diagnostics or previews.
 */
export function redactSensitiveDiagnosticString(
  raw: string,
  maxLength: number = MAX_SANITIZE_STRING_LENGTH,
): string {
  const redacted = raw
    // Any URL scheme with embedded user:pass@host credentials
    .replace(/([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^/@\s]+@)/gi, '$1***@')
    // Sensitive URL query parameters
    .replace(
      /([?&](?:token|api[_-]?key|key|secret|password|passphrase|auth(?:orization)?|cookie|credential|private[_-]?key|session)=)[^&\s#]+/gi,
      '$1***',
    )
    // Bearer / Basic authorization tokens
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9\-._~+/]+=*/gi, '$1 [REDACTED]')
    // JSON-quoted key/value secret pairs
    .replace(
      /"(password|passphrase|secret|token|api[_-]?key|authorization|cookie|credential|private[_-]?key)"\s*:\s*"[^"]*"/gi,
      '"$1":"[REDACTED]"',
    )
    // Inline key=value or key: value secret patterns
    .replace(
      /\b(password|passphrase|secret|token|api[_-]?key|authorization|cookie|credential|private[_-]?key)\s*([=:])\s*[^\s,;]+/gi,
      '$1$2[REDACTED]',
    );

  if (redacted.length > maxLength) {
    return `${redacted.slice(0, maxLength)}...[truncated]`;
  }
  return redacted;
}

function sanitizeRecursive(
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
  maxStringLength: number,
): unknown {
  if (value === null || value === undefined || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : '[NonFiniteNumber]';
  }
  if (typeof value === 'string') {
    return redactSensitiveDiagnosticString(value, maxStringLength);
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (typeof value !== 'object') {
    return '[UnsupportedValue]';
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? '[InvalidDate]'
      : value.toISOString();
  }

  if (seen.has(value)) {
    return '[Circular]';
  }

  if (depth >= MAX_SANITIZE_DEPTH) {
    return Array.isArray(value) ? '[MaxDepthArray]' : '[MaxDepthObject]';
  }

  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const limit = Math.min(value.length, MAX_SANITIZE_ARRAY_ITEMS);
      const out: unknown[] = [];
      for (let i = 0; i < limit; i += 1) {
        out.push(sanitizeRecursive(value[i], depth + 1, seen, maxStringLength));
      }
      if (value.length > limit) {
        out.push(`[+${value.length - limit} more items]`);
      }
      return out;
    }

    const safe: Record<string, unknown> = {};
    let count = 0;
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(k)) {
        continue;
      }
      if (count >= MAX_SANITIZE_OBJECT_KEYS) {
        break;
      }
      safe[k] = sanitizeRecursive(v, depth + 1, seen, maxStringLength);
      count += 1;
    }
    return safe;
  } finally {
    seen.delete(value);
  }
}

/**
 * Recursively sanitizes any diagnostic value (`originalValue`, etc.), redacting secrets,
 * bounding depth/keys/items/strings, and handling circular references safely.
 */
export function sanitizeDiagnosticValue(value: unknown): unknown {
  return sanitizeRecursive(
    value,
    0,
    new WeakSet<object>(),
    MAX_DIAGNOSTIC_STRING_LENGTH,
  );
}

/**
 * Recursively sanitizes a raw restaurant record payload for inclusion in `rejectedSample`.
 */
export function sanitizeRawPreview(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const sanitized = sanitizeRecursive(
    payload,
    0,
    new WeakSet<object>(),
    MAX_SANITIZE_STRING_LENGTH,
  );
  return typeof sanitized === 'object' &&
    sanitized !== null &&
    !Array.isArray(sanitized)
    ? (sanitized as Record<string, unknown>)
    : {};
}
