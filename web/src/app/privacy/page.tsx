import type { Metadata } from "next";
import { site } from "@/lib/site";

export const metadata: Metadata = { title: "Privacy Policy" };

export default function Privacy() {
  return (
    <article className="legal wrap">
      <h1>Privacy Policy</h1>
      <p className="meta">Last updated: {site.lastUpdated}</p>

      <p>
        This policy explains how {site.company} (&quot;we&quot;) handles information when you use the {site.name} Google
        Forms add-on and this website ({site.url}). {site.name} is a standalone service with its own infrastructure and
        database.
      </p>

      <h2>1. Information we access from Google</h2>
      <p>When you install the add-on, you grant the following Google permissions:</p>
      <ul>
        <li>
          <strong>View and manage the form the add-on is used in</strong> (<code>forms.currentonly</code>): to list the
          form&apos;s question titles in the sidebar and read each new response so it can be included in the WhatsApp
          message you configured. The add-on cannot access any other forms or files.
        </li>
        <li>
          <strong>Your email address</strong> (<code>userinfo.email</code>): to identify your account, plan and monthly
          message quota.
        </li>
        <li>
          <strong>Connect to an external service</strong> (<code>script.external_request</code>): to send the message
          request to our server, which delivers it through the WhatsApp Business Platform.
        </li>
        <li>
          <strong>Run when you are not present</strong> (<code>script.scriptapp</code>): to install the form-submit
          trigger that sends a message when a response arrives.
        </li>
        <li>
          <strong>Display content in Google Forms</strong> (<code>script.container.ui</code>): to show the settings
          sidebar.
        </li>
      </ul>

      <h2>2. What we store</h2>
      <ul>
        <li>Your Google account email address, plan, monthly message count and billing cycle date.</li>
        <li>Your Razorpay subscription ID if you upgrade. We never see or store card or bank details.</li>
        <li>
          A delivery log for each message: a partially masked recipient phone number, the template name, delivery
          status, the WhatsApp message ID and the time.
        </li>
        <li>
          Your add-on settings (your WhatsApp number, message layout, which question holds the respondent&apos;s phone)
          are saved inside your Google Form&apos;s own add-on storage, not on our servers.
        </li>
      </ul>
      <p>
        <strong>Form answers are not stored by us.</strong> The answers you choose to include are passed through our
        server to WhatsApp to deliver the message and are then discarded.
      </p>

      <h2>3. How we use information</h2>
      <p>
        We use the information only to provide the features you set up: sending WhatsApp notifications and
        auto-replies, enforcing plan limits, processing subscriptions and providing support. We do not sell data, use it
        for advertising, or use it to train AI or machine-learning models.
      </p>

      <h2>4. Google API Services User Data Policy</h2>
      <p>
        {site.name}&apos;s use and transfer of information received from Google APIs to any other app will adhere to the{" "}
        <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer">
          Google API Services User Data Policy
        </a>
        , including the Limited Use requirements.
      </p>

      <h2>5. Service providers</h2>
      <p>We share the minimum information needed with these processors to run the service:</p>
      <ul>
        <li>Meta Platforms (WhatsApp Business Platform): recipient phone number and message content, to deliver the message.</li>
        <li>Supabase: database hosting for the account and log data listed above.</li>
        <li>Vercel: hosting for this website and API.</li>
        <li>Razorpay: payment processing for Pro subscriptions.</li>
      </ul>

      <h2>6. Respondents</h2>
      <p>
        If a form owner enables auto-replies, the respondent&apos;s phone number and the answers the owner chose are used
        to send them a WhatsApp message. Form owners are responsible for telling respondents that they will be
        contacted on WhatsApp and for having a lawful basis to do so. Respondents can reply STOP or contact the form owner
        to stop messages, or email us to have their data removed from our logs.
      </p>

      <h2>7. Retention and deletion</h2>
      <p>
        Delivery logs are kept for up to 12 months. Account data is kept while you use the service. To delete your data,
        uninstall the add-on and email <a href={`mailto:${site.supportEmail}`}>{site.supportEmail}</a> from the same
        Google account; we delete it within 30 days. You can also revoke access at any time at{" "}
        <a href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer">
          myaccount.google.com/permissions
        </a>
        .
      </p>

      <h2>8. Security</h2>
      <p>
        Data is encrypted in transit (HTTPS) and at rest. Database access is restricted to our server; requests from the
        add-on are authenticated with a server secret and your Google identity.
      </p>

      <h2>9. Changes and contact</h2>
      <p>
        We will post changes to this page and update the date above. Questions:{" "}
        <a href={`mailto:${site.supportEmail}`}>{site.supportEmail}</a>.
      </p>
    </article>
  );
}
