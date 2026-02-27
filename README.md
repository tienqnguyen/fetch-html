# RSS titles as plain text
/?url=https://www.investing.com/rss/news_25.rss&regex=<title>(.*?)</title>

# RSS titles as JSON
/?url=https://www.investing.com/rss/news_25.rss&regex=<title>(.*?)</title>&format=json

# HTML article as Markdown
/?url=https://example.com/post&regex=<article[\s\S]*?<\/article>

# HTML main content as JSON array
/?url=https://example.com&regex=<p>(.*?)<\/p>&format=json
