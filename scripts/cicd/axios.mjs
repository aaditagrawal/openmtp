import process from 'process';

import { CODEMAGIC_BASE_URL } from './constants.mjs';

const DEFAULT_HEADERS = {
  'Content-Type': 'application/json',
  'x-auth-token': process.env.CODEMAGIC_AUTH_TOKEN_ID,
};

const TIMEOUT_MS = 15000;

async function request(method, url, body) {
  const fullUrl = url.startsWith('http')
    ? url
    : `${CODEMAGIC_BASE_URL.replace(/\/$/, '')}/${url.replace(/^\//, '')}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(fullUrl, {
      method,
      headers: DEFAULT_HEADERS,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }

    if (!response.ok) {
      const error = new Error(
        `Request failed with status ${response.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`,
      );
      error.response = { status: response.status, data };
      throw error;
    }

    return { data, status: response.status };
  } finally {
    clearTimeout(timeout);
  }
}

/** Minimal axios-compatible client for CodeMagic CI scripts (fetch-backed). */
export const axios = {
  post: (url, body) => request('POST', url, body),
};
