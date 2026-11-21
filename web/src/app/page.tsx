import Link from "next/link";
import { site } from "@/lib/site";

export default function Home() {
  return (
    <>
      <section className="hero wrap">
        <h1>Get a WhatsApp ping for every Google Form response.</h1>
        <p>
          {site.name} is a Google Forms add-on that messages you on WhatsApp the moment someone submits your form,
          and can send the respondent an instant WhatsApp confirmation. No Meta or Twilio account needed.
        </p>
        <a className="btn" href="#how">See how it works</a>
        <Link className="btn ghost" href="#pricing">Pricing</Link>
      </section>

      <section className="section wrap" id="features">
        <h2>What it does</h2>
        <div className="grid">
          <div className="card">
            <h3>Instant owner alerts</h3>
            <p>A WhatsApp message to your number on every submission, with the answers you choose.</p>
          </div>
          <div className="card">
            <h3>Respondent auto-reply</h3>
            <p>Pro: send the person who filled the form a WhatsApp confirmation, personalised with their answers.</p>
          </div>
          <div className="card">
            <h3>Variables from your form</h3>
            <p>Click chips like {"{{Name}}"} or {"{{Phone}}"} to drop any question&apos;s answer into the message.</p>
          </div>
          <div className="card">
            <h3>Minimal permissions</h3>
            <p>Access is limited to the current form only. We never read your other files.</p>
          </div>
        </div>
      </section>

      <section className="section wrap" id="how">
        <h2>How it works</h2>
        <ol className="steps">
          <li>Install {site.name} from the Google Workspace Marketplace and open it from any Google Form&apos;s add-on menu.</li>
          <li>Enter your WhatsApp number (with country code) and pick which answers to include.</li>
          <li>Press <strong>Send Test WhatsApp</strong>, then switch the add-on to <strong>Active</strong>.</li>
          <li>Every new response now arrives on WhatsApp within seconds.</li>
        </ol>
      </section>

      <section className="section wrap" id="pricing">
        <h2>Pricing</h2>
        <div className="grid">
          <div className="card">
            <h3>Free</h3>
            <div className="price">$0 <small>/ month</small></div>
            <ul>
              <li>25 WhatsApp messages / month</li>
              <li>Owner alerts</li>
              <li>Variable mapping</li>
            </ul>
          </div>
          <div className="card">
            <h3>Pro</h3>
            <div className="price">$12 <small>/ month · or ₹499 / month in India</small></div>
            <ul>
              <li>1,000 WhatsApp messages / month</li>
              <li>Owner alerts + respondent auto-replies</li>
              <li>Priority email support</li>
            </ul>
          </div>
        </div>
        <p style={{ color: "var(--muted)", marginTop: 16 }}>
          Payments are processed by Razorpay. Cancel any time.
        </p>
      </section>

      <section className="section wrap">
        <h2>Questions?</h2>
        <p>
          Email <a href={`mailto:${site.supportEmail}`}>{site.supportEmail}</a>. Read our{" "}
          <Link href="/privacy">Privacy Policy</Link> and <Link href="/terms">Terms of Service</Link>.
        </p>
      </section>
    </>
  );
}
