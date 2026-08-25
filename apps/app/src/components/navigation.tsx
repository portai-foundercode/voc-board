import { Link } from "@tanstack/react-router";

export function Navigation() {
  return (
    <header className="navbar bg-base-200 px-4 sm:px-8">
      <div className="navbar-start">
        <Link className="text-lg font-bold" to="/">
          VoC Board
        </Link>
      </div>
      <nav aria-label="メインナビゲーション" className="navbar-end gap-1 sm:gap-2">
        <Link
          className="btn btn-ghost btn-sm"
          to="/p/$projectSlug"
          params={{ projectSlug: "acme" }}
        >
          投稿
        </Link>
        <Link className="btn btn-ghost btn-sm" to="/app/feedback">
          一覧
        </Link>
        <Link className="btn btn-ghost btn-sm" to="/pricing">
          料金
        </Link>
      </nav>
    </header>
  );
}
