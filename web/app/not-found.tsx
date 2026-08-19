import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
      <p className="text-6xl font-extrabold text-zinc-900 dark:text-zinc-100">404</p>
      <h1 className="mt-4 text-2xl font-bold">Page not found</h1>
      <p className="mt-2 text-sm text-slate-500">
        That page doesn&apos;t exist or was moved.
      </p>
      <Link
        href="/"
        className="mt-6 rounded-lg bg-zinc-900 px-5 py-2.5 font-semibold text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        Back to feed
      </Link>
    </main>
  );
}
