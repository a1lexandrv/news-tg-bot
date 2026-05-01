export interface NewsEntity {
  id: number;
  title: string;
  originalTitle: string | null;
  summary: string | null;
  source: string;
  url: string;
  category: string | null;
  publishedAt: number | null;
  hypeScore: number | null;
  isPosted: boolean;
  postedAt: number | null;
  createdAt: number;
}
