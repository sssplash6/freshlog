/** Where Freshlog lives, unless the mentor's popup says otherwise. */
export const DEFAULT_APP_URL = "https://www.freshlog.net";

/**
 * Open Freshlog as soon as a call ends, which logs it when the student's email
 * is in their Meet name. A mentor who would rather be asked first turns it off.
 */
export const DEFAULT_AUTO_OPEN = true;

/** @returns {Promise<{ appUrl: string, autoOpen: boolean }>} */
export async function settings() {
  const s = await chrome.storage.sync.get({ appUrl: DEFAULT_APP_URL, autoOpen: DEFAULT_AUTO_OPEN });
  return { appUrl: s.appUrl || DEFAULT_APP_URL, autoOpen: Boolean(s.autoOpen) };
}
