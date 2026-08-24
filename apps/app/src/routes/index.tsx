import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({ component: Home });

export function Home() {
  return (
    <main className="hero min-h-screen bg-base-200">
      <div className="hero-content text-center">
        <div className="max-w-xl space-y-4">
          <h1 className="text-4xl font-bold">顧客の声を、次の一手に。</h1>
          <p className="text-base-content/70">顧客の声を、次の行動へつなげる場所です。</p>
        </div>
      </div>
    </main>
  );
}
