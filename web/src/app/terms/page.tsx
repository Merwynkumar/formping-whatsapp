import type { Metadata } from "next";
import Link from "next/link";
import { site } from "@/lib/site";

export const metadata: Metadata = { title: "Terms of Service" };

export default function Terms() {
  return (
    <article className="legal wrap">
      <h1>Terms of Service</h1>
      <p className="meta">Last updated: {site.lastUpdated}</p>

      <p>
        These terms govern your use of the {site.name} Google Forms add-on and website operated by {site.company}. By
        installing or using the add-on you agree to them.
      </p>

      <h2>1. The service</h2>
      <p>
        {site.name} sends WhatsApp messages about Google Form submissions using pre-approved WhatsApp message templates
        through our own WhatsApp Business account. Delivery depends on Meta&apos;s WhatsApp Business Platform and on
        recipients&apos; phones, so we cannot guarantee that every message is delivered or delivered on time.
      </p>

      <h2>2. Plans and billing</h2>
      <ul>
        <li>Free: 25 messages per monthly cycle, owner alerts only.</li>
        <li>Pro: 1,000 messages per monthly cycle, including respondent auto-replies, for US$12/month or ₹499/month.</li>
        <li>Unused messages do not roll over. Test messages count toward your quota.</li>
        <li>
          Pro renews automatically each month through Razorpay until cancelled. You can cancel at any time; the plan
          returns to Free when the subscription ends. Fees already paid are non-refundable except where required by law.
        </li>
        <li>We may change prices with at least 30 days&apos; notice by email.</li>
      </ul>

      <h2>3. Acceptable use</h2>
      <p>You agree not to use {site.name} to:</p>
      <ul>
        <li>message people who have not given permission to be contacted on WhatsApp;</li>
        <li>send spam, marketing blasts, or content that is illegal, deceptive, harassing or infringing;</li>
        <li>break the WhatsApp Business Messaging Policy or Meta&apos;s Commerce Policy;</li>
        <li>attempt to bypass quotas, reverse-engineer the service, or interfere with its operation.</li>
      </ul>
      <p>
        We may suspend accounts that break these rules or that cause our WhatsApp number to receive quality warnings.
      </p>

      <h2>4. Your responsibilities</h2>
      <p>
        You are responsible for the forms you connect, for the content of the messages you configure, and for informing
        respondents and obtaining any consent required by law before they are messaged.
      </p>

      <h2>5. Privacy</h2>
      <p>
        Our <Link href="/privacy">Privacy Policy</Link> explains what data we process and why.
      </p>

      <h2>6. Disclaimers and liability</h2>
      <p>
        The service is provided &quot;as is&quot; without warranties of any kind. To the extent permitted by law, our total
        liability for any claim is limited to the amount you paid us in the three months before the claim, and we are
        not liable for indirect or consequential losses, including missed or delayed messages.
      </p>

      <h2>7. Termination</h2>
      <p>
        You may stop using the service at any time by uninstalling the add-on. We may end or change the service with
        reasonable notice.
      </p>

      <h2>8. Contact</h2>
      <p>
        <a href={`mailto:${site.supportEmail}`}>{site.supportEmail}</a>
      </p>
    </article>
  );
}
