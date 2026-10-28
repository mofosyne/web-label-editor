// SPDX-License-Identifier: GPL-3.0-or-later
// Links to the GitHub issue forms (.github/ISSUE_TEMPLATE), pre-filled with
// what the app knows, so reporting a printer or asking for a label size is a
// couple of clicks.

export const REPO_URL = 'https://github.com/mofosyne/web-label-editor';

// "Linux, Chromium 130" from the browser, as far as it tells us.
export function systemInfo() {
  const data = navigator.userAgentData;
  if (data?.brands?.length) {
    const brand = data.brands.find((b) => !/not.?a.?brand/i.test(b.brand) && b.brand !== 'Chromium')
      ?? data.brands.find((b) => b.brand === 'Chromium');
    return `${data.platform || 'unknown OS'}, ${brand ? `${brand.brand} ${brand.version}` : 'Chromium-based browser'}`;
  }
  return navigator.userAgent;
}

function issueUrl(template, title, fields) {
  const q = new URLSearchParams({ template, title });
  for (const [k, v] of Object.entries(fields)) if (v) q.set(k, v);
  return `${REPO_URL}/issues/new?${q}`;
}

export function printerReportUrl({ printer, label, connection }) {
  return issueUrl('printer-report.yml', `Printer report: ${printer}`, {
    printer, label, connection, system: systemInfo(),
  });
}

export function labelRequestUrl({ printer }) {
  return issueUrl('label-request.yml', 'Label request: ', { printer });
}
