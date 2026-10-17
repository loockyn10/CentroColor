import { ApiError } from './http.ts';

export type GetEnv = (name: string) => string | undefined;

export type IntakeConfig = {
  webBaseUrl: string;
  signingSecret: string;
  linkDays: number;
  maxBytes: number;
};

export const DEFAULT_LINK_DAYS = 14;
export const MAX_LINK_DAYS = 90;
export const DEFAULT_MAX_BYTES = 2 * 1024 * 1024 * 1024;
export const MIN_SIGNING_SECRET_LENGTH = 16;

export type ConfigProblem = { name: string; reason: 'missing' | 'invalid' };

const isPlaceholder = (value: string) => /^REEMPLAZAR/i.test(value);

function present(getEnv: GetEnv, name: string) {
  const value = getEnv(name)?.trim();
  return value ? value : undefined;
}

function parseWebBaseUrl(raw: string) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))
    return null;
  if (url.search || url.hash || url.username || url.password) return null;
  return `${url.origin}${url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '')}`;
}

/** Names and reasons only: values are never returned or logged. */
export function inspectIntakeConfig(getEnv: GetEnv): {
  problems: ConfigProblem[];
  config: IntakeConfig | null;
} {
  const problems: ConfigProblem[] = [];
  const secret = present(getEnv, 'PHOTO_UPLOAD_SIGNING_SECRET');
  if (!secret)
    problems.push({ name: 'PHOTO_UPLOAD_SIGNING_SECRET', reason: 'missing' });
  else if (secret.length < MIN_SIGNING_SECRET_LENGTH || isPlaceholder(secret))
    problems.push({ name: 'PHOTO_UPLOAD_SIGNING_SECRET', reason: 'invalid' });

  const rawWeb =
    present(getEnv, 'PUBLIC_WEB_URL') ?? present(getEnv, 'WEB_APP_URL');
  const webBaseUrl = rawWeb ? parseWebBaseUrl(rawWeb) : null;
  if (!rawWeb) problems.push({ name: 'PUBLIC_WEB_URL', reason: 'missing' });
  else if (!webBaseUrl)
    problems.push({ name: 'PUBLIC_WEB_URL', reason: 'invalid' });

  let linkDays = DEFAULT_LINK_DAYS;
  const rawDays = present(getEnv, 'PHOTO_UPLOAD_LINK_DAYS');
  if (rawDays !== undefined) {
    const parsed = Number(rawDays);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_LINK_DAYS)
      problems.push({ name: 'PHOTO_UPLOAD_LINK_DAYS', reason: 'invalid' });
    else linkDays = parsed;
  }

  let maxBytes = DEFAULT_MAX_BYTES;
  const rawBytes = present(getEnv, 'PHOTO_UPLOAD_MAX_BYTES');
  if (rawBytes !== undefined) {
    const parsed = Number(rawBytes);
    if (!/^\d+$/.test(rawBytes) || !Number.isSafeInteger(parsed) || parsed < 1)
      problems.push({ name: 'PHOTO_UPLOAD_MAX_BYTES', reason: 'invalid' });
    else maxBytes = parsed;
  }

  return {
    problems,
    config: problems.length
      ? null
      : { webBaseUrl: webBaseUrl!, signingSecret: secret!, linkDays, maxBytes },
  };
}

export function configurationError(problems: ConfigProblem[]) {
  const names = problems.map((x) => x.name).join(', ');
  return new ApiError(
    `Configuración del servidor incompleta o inválida: ${names}.`,
    500,
    'server_misconfigured',
  );
}

export function intakeConfig(getEnv: GetEnv): IntakeConfig {
  const { problems, config } = inspectIntakeConfig(getEnv);
  if (!config) throw configurationError(problems);
  return config;
}

export type GoogleCredentials = { clientId: string; clientSecret: string };

export function googleCredentials(getEnv: GetEnv): GoogleCredentials {
  const clientId = present(getEnv, 'GOOGLE_DRIVE_CLIENT_ID');
  const clientSecret = present(getEnv, 'GOOGLE_DRIVE_CLIENT_SECRET');
  const problems: ConfigProblem[] = [];
  if (!clientId)
    problems.push({ name: 'GOOGLE_DRIVE_CLIENT_ID', reason: 'missing' });
  if (!clientSecret)
    problems.push({ name: 'GOOGLE_DRIVE_CLIENT_SECRET', reason: 'missing' });
  if (problems.length) throw configurationError(problems);
  return { clientId: clientId!, clientSecret: clientSecret! };
}
