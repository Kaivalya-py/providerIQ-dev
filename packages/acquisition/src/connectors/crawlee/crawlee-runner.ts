import { Configuration, Dataset, PlaywrightCrawler, ProxyConfiguration } from 'crawlee';
import type { CrawleeConnectorConfig } from './crawlee.config.js';
import type { CrawleeScrapedPage, CrawleeScrapeInput, CrawleeScrapeResult } from './crawlee.types.js';

export interface CrawleePageExtractor {
  sourceName: string;
  sourceType: CrawleeScrapedPage['sourceType'];
  extract(pageContext: {
    requestUrl: string;
    loadedUrl?: string;
    title?: string;
    text?: string;
    html?: string;
  }): Promise<CrawleeScrapedPage | CrawleeScrapedPage[] | null>;
}

export async function runPlaywrightCrawl(
  input: CrawleeScrapeInput,
  config: CrawleeConnectorConfig,
  extractor: CrawleePageExtractor,
): Promise<CrawleeScrapeResult> {
  if (!input.startUrls.length) {
    throw new Error('At least one start URL is required for Crawlee crawl');
  }

  const warnings: string[] = [];
  const failedUrls: string[] = [];
  const pages: CrawleeScrapedPage[] = [];

  const configuration = new Configuration({
    storageDir: config.storageDir,
  });

  const proxyConfiguration =
    config.useProxy && config.proxyUrls.length > 0
      ? new ProxyConfiguration({
          proxyUrls: config.proxyUrls,
        })
      : undefined;

  const dataset = await Dataset.open(`crawlee-${input.runId}-${extractor.sourceName}`, {
    config: configuration,
  });

  const crawler = new PlaywrightCrawler(
    {
      maxRequestsPerCrawl: input.maxRequests ?? config.maxRequestsPerCrawl,
      requestHandlerTimeoutSecs: config.requestHandlerTimeoutSecs,
      navigationTimeoutSecs: config.navigationTimeoutSecs,
      proxyConfiguration,
      launchContext: {
        launchOptions: {
          headless: config.headless,
        },
      },

      async requestHandler({ request, page, log }) {
        log.info(`Crawling ${request.url}`);

        const title = await page.title().catch(() => undefined);
        const text = await page.locator('body').innerText({ timeout: 15_000 }).catch(() => undefined);
        const html = await page.content().catch(() => undefined);
        const loadedUrl = page.url();

        const extracted = await extractor.extract({
          requestUrl: request.url,
          loadedUrl,
          title,
          text,
          html,
        });

        if (!extracted) {
          warnings.push(`No data extracted from ${request.url}`);
          return;
        }

        const extractedPages = Array.isArray(extracted) ? extracted : [extracted];

        for (const extractedPage of extractedPages) {
          pages.push(extractedPage);
          await dataset.pushData(extractedPage);
        }
      },

      failedRequestHandler({ request, error }) {
        failedUrls.push(request.url);
        warnings.push(`Failed to crawl ${request.url}: ${error instanceof Error ? error.message : String(error)}`);
      },
    },
    configuration,
  );

  await crawler.run(input.startUrls);

  return {
    runId: input.runId,
    pages,
    totalFetched: pages.length,
    failedUrls,
    warnings,
  };
}
