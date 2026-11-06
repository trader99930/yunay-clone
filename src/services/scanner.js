const puppeteer = require('puppeteer-core');
const cheerio = require('cheerio');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Page content safely read karta hai. Heavy sites par client-side navigation ki
 * wajah se "Execution context was destroyed" aa sakta hai — us case me retry.
 */
async function readPageSafely(page, warnings) {
  let lastError = null;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      return {
        url: page.url(),
        title: await page.title(),
        html: await page.content()
      };
    } catch (err) {
      lastError = err;
      warnings.push("Page read retry " + attempt + ": " + err.message.split('\n')[0]);
      await sleep(1200);
    }
  }
  throw lastError;
}

async function scanWebsite(targetUrl) {
  let browser = null;
  const warnings = [];

  try {
    browser = await puppeteer.launch({
      executablePath: '/usr/bin/chromium',
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-blink-features=AutomationControlled'
      ]
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 768 });
    await page.setUserAgent(
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    );
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    const apiCalls = [];
    const assets = { scripts: [], styles: [], images: [] };

    // Network requests intercept karke APIs aur assets track karna.
    // Media (video/audio) block karte hain — scan fast aur reliable rehta hai.
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const type = req.resourceType();
      const url = req.url();
      if (type === 'media') return req.abort();
      if (type === 'xhr' || type === 'fetch') {
        apiCalls.push({ method: req.method(), url });
      }
      req.continue().catch(() => {});
    });
    page.on('dialog', (dialog) => dialog.dismiss().catch(() => {}));

    const navigations = [];
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) navigations.push(frame.url());
    });

    // Step 1: DOM ready hone tak wait (network idle ka intezaar nahi).
    let response = null;
    try {
      response = await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    } catch (err) {
      // Timeout ke baad bhi page partially load ho sakta hai — content try karo.
      warnings.push("Navigation: " + err.message.split('\n')[0]);
    }

    // Step 2: Best-effort network idle, lekin short timeout. Fail ho to aage badho.
    try {
      await page.waitForNetworkIdle({ idleTime: 2500, timeout: 10000 });
    } catch (err) {
      warnings.push("Network idle 10s me nahi aaya; DOM ready content capture kiya.");
    }

    // Step 3: Late scripts/redirects settle hone do.
    await sleep(4000);

    const captured = await readPageSafely(page, warnings);
    const html = captured.html;
    const title = captured.title;
    const finalUrl = captured.url;

    if (!html || html.length < 50) {
      throw new Error("Page ka content nahi mila. Site ne request block ki ho sakti hai.");
    }

    const $ = cheerio.load(html);

    $('script[src]').each((_, el) => assets.scripts.push($(el).attr('src')));
    $('link[rel="stylesheet"]').each((_, el) => assets.styles.push($(el).attr('href')));
    $('img[src]').each((_, el) => assets.images.push($(el).attr('src')));

    // Inline styles aur UI structure summary nikalna
    const metaTags = {};
    $('meta').each((_, el) => {
      const name = $(el).attr('name') || $(el).attr('property');
      const content = $(el).attr('content');
      if (name && content) metaTags[name] = content;
    });

    let screenshotBase64 = null;
    try {
      screenshotBase64 = await page.screenshot({ encoding: 'base64', fullPage: false });
    } catch (err) {
      warnings.push("Screenshot fail: " + err.message.split('\n')[0]);
    }

    return {
      success: true,
      url: targetUrl,
      finalUrl,
      title,
      statusCode: response ? response.status() : null,
      metaTags,
      warnings,
      navigations: navigations.slice(-10),
      stats: {
        htmlLength: html.length,
        scriptsCount: assets.scripts.length,
        stylesCount: assets.styles.length,
        imagesCount: assets.images.length,
        apiCallsCount: apiCalls.length
      },
      assets,
      apiCalls,
      htmlSnippet: html.substring(0, 5000), // First 5KB preview
      fullHtml: html,
      screenshot: screenshotBase64 ? `data:image/png;base64,${screenshotBase64}` : null
    };
  } finally {
    if (browser) await browser.close();
  }
}

module.exports = { scanWebsite };
