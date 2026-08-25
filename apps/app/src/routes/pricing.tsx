import { createFileRoute } from "@tanstack/react-router";

import { Navigation } from "../components/navigation";

export const Route = createFileRoute("/pricing")({ component: Pricing });

function Pricing() {
  return (
    <>
      <Navigation />
      <main className="mx-auto max-w-4xl space-y-8 px-4 py-10 sm:px-8">
        <div className="space-y-2 text-center">
          <span className="badge">Owner向け</span>
          <h1 className="text-3xl font-bold">料金プラン</h1>
          <p className="text-base-content/70">チームのフィードバック運用に合わせて選べます。</p>
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          <section className="card card-border">
            <div className="card-body">
              <h2 className="card-title">Free</h2>
              <p className="text-2xl font-bold">¥0</p>
              <p>モックで基本的な投稿と一覧を試せます。</p>
            </div>
          </section>
          <section className="card card-border">
            <div className="card-body">
              <h2 className="card-title">Pro</h2>
              <p className="text-2xl font-bold">月額¥4,980</p>
              <p>チームでの整理や活用を広げたい方向けのプランです。</p>
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
