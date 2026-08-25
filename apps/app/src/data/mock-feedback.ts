export const statusLabels = {
  new: "新着",
  reviewing: "確認中",
  planned: "計画済み",
} as const;

export type FeedbackStatus = keyof typeof statusLabels;

export type MockFeedback = {
  id: string;
  title: string;
  customerName: string;
  companyName: string;
  body: string;
  status: FeedbackStatus;
  receivedAt: string;
};

export const mockFeedback: readonly MockFeedback[] = [
  {
    id: "fb-001",
    title: "CSV出力に対応してほしい",
    customerName: "山田 太郎",
    companyName: "株式会社サンプル",
    body: "集計結果を社内共有するため、CSVで出力したいです。",
    status: "new",
    receivedAt: "2026-08-20",
  },
  {
    id: "fb-002",
    title: "検索条件を保存したい",
    customerName: "佐藤 花子",
    companyName: "Example Inc.",
    body: "毎週同じ条件で確認するので、検索条件を保存したいです。",
    status: "reviewing",
    receivedAt: "2026-08-18",
  },
  {
    id: "fb-003",
    title: "週次レポートを共有したい",
    customerName: "鈴木 一郎",
    companyName: "デモ株式会社",
    body: "チームへ共有できる週次レポートがあると助かります。",
    status: "planned",
    receivedAt: "2026-08-15",
  },
];

export const findFeedbackById = (id: string) => mockFeedback.find((item) => item.id === id);
