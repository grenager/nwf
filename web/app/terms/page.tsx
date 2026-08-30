import { BrandLink } from "@/components/brand-mark";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Service — NewsWithFriends",
};

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <BrandLink className="mb-8 text-xl font-bold text-zinc-900 dark:text-zinc-50" markClassName="h-6 w-6" />
      <h1 className="text-2xl font-bold">Terms of Service</h1>
      <p className="mt-1 text-sm text-slate-500">Last updated: August 30, 2026</p>

      <div className="mt-8 space-y-6 text-sm leading-6 text-slate-700 dark:text-slate-300">
        <p>
          These Terms of Service (&quot;Terms&quot;) govern your use of
          NewsWithFriends (&quot;the service&quot;), operated at
          newswithfriends.org. By creating an account or using the service,
          you agree to these Terms.
        </p>

        <section>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
            Your account
          </h2>
          <p className="mt-2">
            You&apos;re responsible for maintaining the security of your
            account and for all activity that occurs under it. You must
            provide a valid email address (or sign in with Google) to
            create an account.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
            Acceptable use
          </h2>
          <p className="mt-2">You agree not to:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Use the service for any unlawful purpose or to harass others.</li>
            <li>Attempt to gain unauthorized access to other accounts or to the service&apos;s systems.</li>
            <li>Interfere with or disrupt the service or its infrastructure.</li>
            <li>Scrape or bulk-collect content from the service without our permission.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
            Your content
          </h2>
          <p className="mt-2">
            You retain ownership of comments and other content you post.
            By posting content, you grant us a license to store, display,
            and share it with your friends within the service as intended
            by its features (for example, showing your comments and stars
            to friends you&apos;ve connected with).
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
            News content
          </h2>
          <p className="mt-2">
            NewsWithFriends surfaces links to, and summaries of, articles
            published by third-party news sources. We don&apos;t claim
            ownership of that content, and your use of it may be subject to
            the original publisher&apos;s own terms.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
            Termination
          </h2>
          <p className="mt-2">
            You may stop using the service and delete your account at any
            time. We may suspend or terminate accounts that violate these
            Terms.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
            Disclaimer and limitation of liability
          </h2>
          <p className="mt-2">
            The service is provided &quot;as is&quot; without warranties of
            any kind. To the fullest extent permitted by law, NewsWithFriends
            is not liable for any indirect, incidental, or consequential
            damages arising from your use of the service.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
            Changes to these Terms
          </h2>
          <p className="mt-2">
            We may update these Terms from time to time. We will post any
            changes on this page and update the &quot;Last updated&quot;
            date above.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
            Contact us
          </h2>
          <p className="mt-2">
            Questions about these Terms? Contact us at{" "}
            <a className="underline" href="mailto:support@newswithfriends.org">
              support@newswithfriends.org
            </a>
            .
          </p>
        </section>
      </div>

      <Link href="/" className="mt-10 inline-block text-sm text-slate-500 underline">
        Back to NewsWithFriends
      </Link>
    </main>
  );
}
