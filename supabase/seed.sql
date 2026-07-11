-- Dev seed: a handful of real RSS sources so the scraper has something to do.
insert into public.sources (name, homepage_url, rss_url, tags, has_paywall)
values
    ('NPR News', 'https://www.npr.org', 'https://feeds.npr.org/1001/rss.xml', array['general'], false),
    ('BBC News', 'https://www.bbc.com/news', 'https://feeds.bbci.co.uk/news/rss.xml', array['general','world'], false),
    ('The Verge', 'https://www.theverge.com', 'https://www.theverge.com/rss/index.xml', array['tech'], false),
    ('Ars Technica', 'https://arstechnica.com', 'https://feeds.arstechnica.com/arstechnica/index', array['tech','science'], false),
    ('Hacker News', 'https://news.ycombinator.com', 'https://hnrss.org/frontpage', array['tech'], false)
on conflict (homepage_url) do nothing;
