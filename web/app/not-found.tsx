import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
      <p className="text-6xl font-extrabold text-brand-600">404</p>
      <h1 className="mt-4 text-2xl font-bold">Page not found</h1>
      <p className="mt-2 text-sm text-slate-500">
        That page doesn&apos;t exist or was moved.
      </p>
      <Link
        href="/feed"
        className="mt-6 rounded-lg bg-brand-600 px-5 py-2.5 font-semibold text-white hover:bg-brand-700"
      >
        Back to feed
      </Link>
    </main>
  );
}
