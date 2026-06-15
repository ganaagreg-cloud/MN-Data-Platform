export const TENDER_CATEGORIES = [
  "Барилга угсралт",
  "Бараа нийлүүлэлт",
  "Үйлчилгээ",
  "Зөвлөх үйлчилгээ",
  "Технологи, МТ",
  "Тоног төхөөрөмж",
  "Хүнс, ундаа",
  "Эм, эмнэлгийн хэрэгсэл",
  "Судалгаа, шинжилгээ",
  "Сургалт",
] as const;

export type TenderCategory = (typeof TENDER_CATEGORIES)[number];
