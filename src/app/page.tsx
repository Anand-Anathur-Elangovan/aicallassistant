"use client";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";

export default function Home() {
  const router = useRouter();
  const [mode, setMode] = useState<"landing" | "login" | "signup">("landing");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) router.push("/dashboard");
    });
  }, [router]);

  async function handleAuth(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    if (mode === "signup") {
      const { error: err } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: name } },
      });
      if (err) { setError(err.message); setLoading(false); return; }
    } else {
      const { error: err } = await supabase.auth.signInWithPassword({ email, password });
      if (err) { setError(err.message); setLoading(false); return; }
    }
    router.push("/dashboard");
  }

  if (mode === "landing") {
    return (
      <main className="flex-1 flex flex-col">
        <SiteHeader
          rightSlot={
            <>
              <button onClick={() => setMode("login")} className="text-sm px-3 py-1.5 border rounded-lg hover:bg-gray-50">Sign In</button>
              <button onClick={() => setMode("signup")} className="text-sm px-3 py-1.5 bg-blue-600 text-white rounded-lg">Get Started</button>
            </>
          }
        />
        <section className="flex-1 flex flex-col items-center justify-center px-6 py-20 text-center">
          <div className="inline-block px-4 py-1 rounded-full bg-blue-100 text-blue-700 text-sm font-medium mb-6">
            AI Receptionist · by{" "}
            <a href="https://nexcrafttech.com/" target="_blank" rel="noopener noreferrer" className="underline font-semibold">
              NexCraft Tech
            </a>
          </div>
          <h1 className="text-5xl font-bold max-w-3xl leading-tight mb-6">
            Never Miss a Customer Call Again
          </h1>
          <p className="text-xl text-gray-500 max-w-2xl mb-6">
            Your AI receptionist answers calls 24/7, handles inquiries, quotes prices,
            negotiates offers, and transfers to your team when needed — in 30+ languages.
          </p>
          <p className="text-sm text-gray-500 mb-10">
            Built by{" "}
            <a href="https://nexcrafttech.com/" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline font-medium">
              NexCraft Technologies
            </a>
            {" "}· Web · AI · SEO · Chatbots
          </p>
          <div className="flex flex-wrap gap-4 justify-center">
            <button
              onClick={() => setMode("signup")}
              className="px-8 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition"
            >
              Get Started Free
            </button>
            <button
              onClick={() => setMode("login")}
              className="px-8 py-3 border border-gray-300 rounded-lg font-medium hover:bg-gray-50 transition"
            >
              Sign In
            </button>
            <a
              href="/never-miss-a-customer-call-again.pdf"
              target="_blank"
              rel="noopener noreferrer"
              className="px-8 py-3 border border-gray-300 rounded-lg font-medium hover:bg-gray-50 transition"
            >
              View Pitch PDF
            </a>
          </div>
        </section>

        <section className="px-6 py-16 border-t">
          <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              { title: "Natural Conversations", desc: "Full-duplex calls that sound like a real human receptionist, not a robot." },
              { title: "Smart Negotiation", desc: "Set your pricing rules and let AI handle offers within your defined limits." },
              { title: "Instant Transfer", desc: "Seamlessly routes to your team when a human touch is needed." },
              { title: "30+ Languages", desc: "Auto-detects caller language and responds naturally in Tamil, Hindi, French, and more." },
              { title: "Call Summaries", desc: "Get instant summaries via email, Telegram, or WhatsApp after every call." },
              { title: "Product Knowledge", desc: "Upload your catalog and FAQs — AI answers accurately every time." },
            ].map((f) => (
              <div key={f.title} className="p-6 rounded-xl border">
                <h3 className="font-semibold text-lg mb-2">{f.title}</h3>
                <p className="text-gray-500 text-sm">{f.desc}</p>
              </div>
            ))}
          </div>
          <p className="text-center text-sm text-gray-400 mt-12">
            A product of{" "}
            <a href="https://nexcrafttech.com/" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
              NexCraft Tech
            </a>
            {" "}·{" "}
            <a href="/never-miss-a-customer-call-again.pdf" target="_blank" rel="noopener noreferrer" className="hover:underline">
              Download pitch deck (PDF)
            </a>
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="flex-1 flex flex-col">
      <SiteHeader
        rightSlot={
          <button type="button" onClick={() => setMode("landing")} className="text-sm text-gray-500 hover:underline">
            Back to Home
          </button>
        }
      />
      <div className="flex-1 flex items-center justify-center px-6 py-10">
        <form onSubmit={handleAuth} className="w-full max-w-sm space-y-4">
          <h2 className="text-2xl font-bold text-center mb-6">
            {mode === "login" ? "Welcome Back" : "Create Account"}
          </h2>

          {mode === "signup" && (
            <input
              type="text"
              placeholder="Full Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-4 py-3 border rounded-lg"
              required
            />
          )}
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-4 py-3 border rounded-lg"
            required
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-4 py-3 border rounded-lg"
            minLength={6}
            required
          />

          {error && <p className="text-red-500 text-sm">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50"
          >
            {loading ? "Please wait..." : mode === "login" ? "Sign In" : "Sign Up"}
          </button>

          <p className="text-center text-sm text-gray-500">
            {mode === "login" ? "Don't have an account? " : "Already have an account? "}
            <button
              type="button"
              onClick={() => setMode(mode === "login" ? "signup" : "login")}
              className="text-blue-600 hover:underline"
            >
              {mode === "login" ? "Sign Up" : "Sign In"}
            </button>
          </p>
        </form>
      </div>
    </main>
  );
}
