import Link from "next/link";

export default function LandingPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center px-6 text-center">
      <span className="mb-4 rounded-full bg-brand-100 px-4 py-1 text-sm font-medium text-brand-700">
        Read together
      </span>
      <h1 className="text-4xl font-extrabold tracking-tight text-slate-900 sm:text-6xl dark:text-slate-50">
        News<span className="text-brand-600">With</span>Friends
      </h1>
      <p className="mt-6 max-w-xl text-lg text-slate-600 dark:text-slate-300">
        Follow the sources you trust, get a single aggregated feed, star what
        matters, and see what your friends are reading and saying.
      </p>
      <div className="mt-10 flex gap-4">
        <Link
          href="/signin"
          className="rounded-lg bg-brand-600 px-6 py-3 font-semibold text-white shadow-sm transition hover:bg-brand-700"
        >
          Get started
        </Link>
        <Link
          href="/today"
          className="rounded-lg border border-slate-300 px-6 py-3 font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          Open app
        </Link>
      </div>
    </main>
  );
}
