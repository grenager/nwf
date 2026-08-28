import { BrandLink } from "@/components/brand-mark";
import Link from "next/link";

const primaryButtonClass: string =
  "bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300";

const secondaryLinkClass: string =
  "text-sm font-semibold text-zinc-700 underline underline-offset-2 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100";

const valueProps: { title: string; body: string }[] = [
  {
    title: "Friends, not followers",
    body: "Every conversation is with people you actually know and trust — no strangers, no public replies, no algorithm deciding who sees what you say.",
  },
  {
    title: "Curated by people you trust",
    body: "Your feed is shaped by what your friends are reading and rating each day — vibrant, tailored, and free of the noise a generic feed brings.",
  },
  {
    title: "Never miss what matters",
    body: "Friends surface the key articles and the conversations worth having, so the important stuff finds you instead of getting lost in your inbox.",
  },
];

/** Marketing page shown at "/" to signed-out visitors who arrived without an invitation. */
export function Landing() {
  return (
    <div className="flex min-h-dvh flex-col bg-white dark:bg-zinc-950">
      <header className="sticky top-0 z-40 border-b border-zinc-200 bg-white/95 pt-[env(safe-area-inset-top)] backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3 sm:px-6">
          <BrandLink className="text-zinc-900 dark:text-zinc-50" markClassName="h-6 w-6" />
          <Link
            href="/signin"
            className="text-sm font-medium text-zinc-500 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            Sign in
          </Link>
        </div>
      </header>

      <main className="flex-1">
        <section className="mx-auto max-w-3xl px-4 pb-12 pt-14 text-center sm:px-6 sm:pt-20">
          <h1 className="font-serif text-4xl font-semibold tracking-tight text-zinc-900 sm:text-5xl dark:text-zinc-50">
            The news, with the people you actually trust.
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-base text-zinc-600 sm:text-lg dark:text-zinc-300">
            NewsWithFriends is a private place to read and talk about the news
            with a handful of friends — not followers, not strangers, not an
            algorithm.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Link href="/signin" className={primaryButtonClass}>
              Create free account
            </Link>
            <Link href="/signin" className={secondaryLinkClass}>
              Sign in
            </Link>
          </div>
          <p className="mt-4 text-xs text-zinc-400">
            No password — just a magic link.
          </p>
        </section>

        <section className="border-t border-zinc-200 bg-zinc-50 py-12 sm:py-16 dark:border-zinc-800 dark:bg-zinc-900/40">
          <div className="mx-auto grid max-w-5xl gap-5 px-4 sm:grid-cols-3 sm:px-6">
            {valueProps.map((prop) => (
              <div
                key={prop.title}
                className="border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950"
              >
                <h2 className="font-serif text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                  {prop.title}
                </h2>
                <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
                  {prop.body}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-3xl px-4 py-14 text-center sm:px-6">
          <h2 className="font-serif text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
            Ready to read the news with your friends?
          </h2>
          <div className="mt-6">
            <Link href="/signin" className={primaryButtonClass}>
              Create free account
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-zinc-200 py-8 dark:border-zinc-800">
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-3 px-4 text-center sm:px-6">
          <BrandLink
            className="text-sm font-semibold text-zinc-500 dark:text-zinc-400"
            markClassName="h-4 w-4"
          />
          <p className="text-xs text-zinc-400">
            &copy; {new Date().getFullYear()} NewsWithFriends
          </p>
        </div>
      </footer>
    </div>
  );
}
