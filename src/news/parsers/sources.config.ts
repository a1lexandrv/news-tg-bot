export interface RssSource {
  name: string;
  url: string;
  category: string;
}

export const RSS_SOURCES: RssSource[] = [
  { name: 'The Decoder', url: 'https://the-decoder.com/feed/', category: 'news' },
  { name: 'Marktechpost', url: 'https://marktechpost.com/feed/', category: 'research' },
  { name: 'OpenAI Blog', url: 'https://openai.com/news/rss.xml', category: 'official' },
  {
    name: 'DeepLearning.ai',
    url: 'https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_the_batch.xml',
    category: 'education',
  },
  { name: 'MIT News AI', url: 'http://news.mit.edu/rss/topic/artificial-intelligence2', category: 'research' },
  { name: 'Google AI Blog', url: 'https://feeds.feedburner.com/GoogleAIBlog', category: 'official' },
  {
    name: 'Meta AI',
    url: 'https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_meta_ai.xml',
    category: 'official',
  },
  { name: 'Hugging Face', url: 'https://huggingface.co/blog/feed.xml', category: 'opensource' },
  {
    name: 'Towards Data Science',
    url: 'https://medium.com/feed/towards-data-science/tagged/artificial-intelligence',
    category: 'articles',
  },
  { name: 'Analytics Vidhya', url: 'https://www.analyticsvidhya.com/feed/', category: 'articles' },
];
