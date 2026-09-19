export async function fetchOnePagerPreviewHtml({ endpoint, user, weekId, projectCode, ganttWindowSettings }) {
  if (!endpoint) throw new Error('Professional PDF previews are not configured yet.');
  if (!user?.getIdToken) throw new Error('Please sign in before previewing a report.');
  const token = await user.getIdToken();
  const response = await fetch(`${endpoint}/v1/reports/one-pager-preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ weekId, projectCode, ganttWindowSettings }),
    cache: 'no-store'
  });
  if (!response.ok || !String(response.headers.get('content-type')).includes('text/html')) {
    let message = 'Unable to generate the preview.';
    try { message = (await response.json()).error || message; } catch {}
    throw new Error(message);
  }
  return response.text();
}

export async function downloadProfessionalPdf({ endpoint, user, request, filename }) {
  if (!endpoint) throw new Error('Professional PDF downloads are not configured yet.');
  if (!user?.getIdToken) throw new Error('Please sign in before downloading a report.');
  const token = await user.getIdToken();
  const response = await fetch(`${endpoint}/v1/reports/${request.mode}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(request),
    cache: 'no-store'
  });
  if (!response.ok || !String(response.headers.get('content-type')).includes('application/pdf')) {
    let message = 'Unable to generate the PDF report.';
    try { message = (await response.json()).error || message; } catch {}
    throw new Error(message);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
