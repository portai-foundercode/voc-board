import { createFileRoute } from "@tanstack/react-router";

import { Navigation } from "../components/navigation";

export const Route = createFileRoute("/")({ component: HomeRoute });

function HomeRoute() {
  return (
    <>
      <Navigation />
      <Home />
    </>
  );
}

export function Home() {
  return (
    <main className="hero min-h-[calc(100vh-4rem)] bg-base-200">
      <div className="hero-content text-center">
        <div className="max-w-xl space-y-5">
          <span className="badge">Visitor向け</span>
          <h1 className="text-4xl font-bold">顧客の声を、次の一手に。</h1>
          <p className="text-base-content/70">顧客の声を、次の行動へつなげる場所です。</p>
          <div className="flex flex-col justify-center gap-3 sm:flex-row">
            <a className="btn btn-primary" href="/p/acme">
              フィードバックを送る
            </a>
            <a className="btn" href="/app/feedback">
              管理画面デモを見る
            </a>
          </div>
        </div>
      </div>
    </main>
  );
}
