export class CreateReviewDto {
  tenQuan?: string;
  urlGoc?: string;
  diemReview: number;
  noiDung: string;
  restaurantId: string;
  userId?: string;
  userName?: string;
  images?: string[];
  aiSentimentLabel?: string;
  aiSentimentScore?: number;
}