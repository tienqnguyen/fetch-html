# RSS titles as plain text
/?url=https://www.investing.com/rss/news_25.rss&regex=<title>(.*?)</title>

# RSS titles as JSON
/?url=https://www.investing.com/rss/news_25.rss&regex=<title>(.*?)</title>&format=json

# HTML article as Markdown
/?url=https://example.com/post&regex=<article[\s\S]*?<\/article>

# HTML main content as JSON array
/?url=https://example.com&regex=<p>(.*?)<\/p>&format=json
# CSS selector → Markdown
/?url=https://investing.com&selector=#news td:nth-child(3) div span

# CSS selector → JSON
/?url=https://investing.com&selector=.market-pulse-headline&format=json

# Regex on RSS → JSON
/?url=https://investing.com/rss/news_25.rss&regex=<title>(.*?)</title>&format=json

# Plain proxy (no extraction)
/?url=https://investing.com/rss/news_25.rss
/?url=https://www.investing.com
  &selector=#news div table tbody tr td:nth-child(3) div span
  &format=json

  # As Markdown
/?url=https://www.investing.com&regex=<[^>]+class="[^"]*market-pulse-headline[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>

# As JSON
/?url=https://www.investing.com&regex=<[^>]+class="[^"]*market-pulse-headline[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>&format=json
