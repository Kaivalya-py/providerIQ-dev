export interface CrawleeScrapeInput {
  runId: string;
  hospitalSeedId: string;
  hospitalName: string;
  city?: string;
  locality?: string;
  startUrls: string[];
  maxRequests?: number;
}

export interface CrawleeScrapedPage {
  url: string;
  loadedUrl?: string;
  title?: string;
  text?: string;
  html?: string;
  sourceType: 'profile' | 'review' | 'listing' | 'complaint_post' | 'website_page';
  metadata?: Record<string, unknown>;
}

export interface CrawleeScrapeResult {
  runId: string;
  pages: CrawleeScrapedPage[];
  totalFetched: number;
  failedUrls: string[];
  warnings: string[];
}
