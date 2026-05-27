export interface CrawleeConnectorConfig {
  maxRequestsPerCrawl: number;
  requestHandlerTimeoutSecs: number;
  navigationTimeoutSecs: number;
  headless: boolean;
  useProxy: boolean;
  proxyUrls: string[];
  storageDir: string;
}

export function loadCrawleeConnectorConfig(): CrawleeConnectorConfig {
  const proxyUrls = (process.env['CRAWLEE_PROXY_URLS'] ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  return {
    maxRequestsPerCrawl: Number(process.env['CRAWLEE_MAX_REQUESTS_PER_CRAWL'] ?? 100),
    requestHandlerTimeoutSecs: Number(process.env['CRAWLEE_REQUEST_HANDLER_TIMEOUT_SECS'] ?? 60),
    navigationTimeoutSecs: Number(process.env['CRAWLEE_NAVIGATION_TIMEOUT_SECS'] ?? 45),
    headless: process.env['CRAWLEE_HEADLESS'] !== 'false',
    useProxy: proxyUrls.length > 0,
    proxyUrls,
    storageDir: process.env['CRAWLEE_STORAGE_DIR'] ?? '.local/crawlee-storage',
  };
}
