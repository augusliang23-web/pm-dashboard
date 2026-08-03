import puppeteer from 'puppeteer';
import { paginateMeasuredFlows } from './measured-paginator.js';

const LAUNCH_OPTIONS = {
  headless: 'shell',
  args: ['--no-sandbox', '--disable-setuid-sandbox']
};

export function createPdfRenderer({ launch = options => puppeteer.launch(options) } = {}) {
  let browserPromise;

  async function getBrowser() {
    const current = browserPromise ? await browserPromise.catch(() => null) : null;
    if (current?.isConnected?.()) return current;
    browserPromise = Promise.resolve().then(() => launch(LAUNCH_OPTIONS));
    return browserPromise;
  }

  async function openPage() {
    let browser = await getBrowser();
    try {
      return await browser.newPage();
    } catch (error) {
      if (browser?.isConnected?.() !== false) throw error;
      browserPromise = undefined;
      browser = await getBrowser();
      return browser.newPage();
    }
  }

  const renderPdf = async function renderPdf(html) {
    const page = await openPage();
    try {
      await page.setContent(html, { waitUntil: 'networkidle0' });
      await page.evaluate(paginateMeasuredFlows);
      return await page.pdf({
        format: 'A4',
        landscape: true,
        printBackground: true,
        preferCSSPageSize: true
      });
    } finally {
      await page.close().catch(() => {});
    }
  };

  renderPdf.close = async () => {
    const pendingBrowser = browserPromise;
    browserPromise = undefined;
    const browser = pendingBrowser ? await pendingBrowser.catch(() => null) : null;
    if (browser?.close) await browser.close();
  };

  return renderPdf;
}

export const renderPdfBuffer = createPdfRenderer();
