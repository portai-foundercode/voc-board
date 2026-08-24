import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({ component: Home });

export function Home() {
  return (
    <main className="min-h-screen p-6">
      <h1>顧客の声を、事業の前進に。</h1>
      <p>顧客の声を、次の行動へつなげる場所です。</p>
    </main>
  );
}
