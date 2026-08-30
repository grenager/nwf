import { BrandLink } from "@/components/brand-mark";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy — NewsWithFriends",
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <BrandLink className="mb-8 text-xl font-bold text-zinc-900 dark:text-zinc-50" markClassName="h-6 w-6" />
      <h1 className="text-2xl font-bold">Privacy Policy</h1>
      <p className="mt-1 text-sm text-slate-500">Last updated: August 30, 2026</p>

      <div className="mt-8 space-y-6 text-sm leading-6 text-slate-700 dark:text-slate-300">
        <p>
          NewsWithFriends (&quot;we&quot;, &quot;us&quot;) operates
          newswithfriends.org, a service for reading news and discussing it
          with friends. This policy explains what information we collect,
          how we use it, and the choices you have.
        </p>

        <section>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
            Information we collect
          </h2>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>
              <strong>Account information</strong> — your email address, and
              your name and profile photo if you provide them or sign in
              with Google.
            </li>
            <li>
              <strong>Content you create</strong> — comments, stars, saved
              articles, friend connections, and notification preferences.
            </li>
            <li>
              <strong>Usage data</strong> — standard technical data such as
              IP address, browser type, and pages visited, collected
              automatically to operate and secure the service.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
            How we use your information
          </h2>
          <p className="mt-2">We use your information to:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Authenticate you and maintain your account.</li>
            <li>Show you news and your friends&apos; activity within the app.</li>
            <li>Send transactional email, such as sign-in links, invitations, and optional digest emails.</li>
            <li>Maintain the security and reliability of the service.</li>
          </ul>
          <p className="mt-2">
            We do not sell your personal information, and we do not use it
            for advertising.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
            Sign in with Google
          </h2>
          <p className="mt-2">
            If you sign in with Google, we receive your name, email address,
            and profile photo from Google in order to create and
            authenticate your account. We do not request access to any
            other Google data, and we do not use this information for any
            purpose other than operating your NewsWithFriends account.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
            Third-party service providers
          </h2>
          <p className="mt-2">
            We use a small number of service providers to operate
            NewsWithFriends, including hosting and authentication
            infrastructure, transactional email delivery, and news-article
            summarization/clustering. These providers only receive the data
            needed to perform their function and are not permitted to use
            it for their own purposes.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
            Cookies
          </h2>
          <p className="mt-2">
            We use essential cookies to keep you signed in and to remember
            basic preferences (such as dark mode). We do not use
            advertising or tracking cookies.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
            Data retention and deletion
          </h2>
          <p className="mt-2">
            We retain your account information for as long as your account
            is active. You can request deletion of your account and
            associated data at any time by contacting us at the address
            below.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
            Children&apos;s privacy
          </h2>
          <p className="mt-2">
            NewsWithFriends is not directed to children under 13, and we do
            not knowingly collect personal information from children under
            13.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
            Changes to this policy
          </h2>
          <p className="mt-2">
            We may update this policy from time to time. We will post any
            changes on this page and update the &quot;Last updated&quot;
            date above.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
            Contact us
          </h2>
          <p className="mt-2">
            If you have questions about this policy or your data, contact
            us at{" "}
            <a className="underline" href="mailto:privacy@newswithfriends.org">
              privacy@newswithfriends.org
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
