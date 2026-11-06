const puppeteer = require('puppeteer-core');
const cheerio = require('cheerio');

async function scanWebsite(targetUrl) {
  let browser = null;
  try {
    browser = await puppeteer.launch({
      executablePath: '/usr/bin/chromium',
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ]
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 768 });

    const apiCalls = [];
    const assets = { scripts: [], styles: [], images: [] };

    // Network requests intercept karke APIs aur assets track karna
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const type = req.resourceType();
      const url = req.url();
      if (type === 'xhr' || type === 'fetch') {
        apiCalls.push({ method: req.method(), url });
      }
      req.continue();
    });

    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 45000 });

    const title = await page.title();
    const html = await page.content();
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

    const screenshotBase64 = await page.screenshot({ encoding: 'base64', fullPage: false });

    return {
      success: true,
      url: targetUrl,
      title,
      metaTags,
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
      screenshot: `data:image/png;base64,${screenshotBase64}`
    };
  } finally {
    if (browser) await browser.close();
  }
}

module.exports = { scanWebsite };
