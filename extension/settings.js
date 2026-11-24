/** Where Freshlog lives, unless the mentor's popup says otherwise. */
export const DEFAULT_APP_URL = "https://www.freshlog.net";

/** @returns {Promise<{ appUrl: string, autoOpen: boolean }>} */
export async function settings() {
  const s = await chrome.storage.sync.get({ appUrl: DEFAULT_APP_URL, autoOpen: false });
  return { appUrl: s.appUrl || DEFAULT_APP_URL, autoOpen: Boolean(s.autoOpen) };
}
