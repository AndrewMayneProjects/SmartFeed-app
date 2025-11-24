import { useCallback, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./lib/supabaseClient";
import "./App.css";

type AuthMode = "signIn" | "signUp";

type FeedItem = {
  id: string;
  title: string | null;
  content: string | null;
  tldr: string | null;
  character_name: string | null;
  character_image_url: string | null;
  created_at: string | null;
};

const FEED_LIMIT = 40;

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [authMode, setAuthMode] = useState<AuthMode>("signIn");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [feedItems, setFeedItems] = useState<FeedItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session ?? null);
      setLoading(false);
    });
    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });
    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const loadFeed = useCallback(async () => {
    if (!session) return;
    setRefreshing(true);
    setError(null);
    const { data, error: feedError } = await supabase
      .from("feed_items")
      .select("id, title, content, tldr, character_name, character_image_url, created_at")
      .order("created_at", { ascending: false })
      .limit(FEED_LIMIT);
    if (feedError) {
      console.error("Failed to load feed:", feedError);
      setError(feedError.message ?? "Unable to load feed right now.");
    } else {
      setFeedItems(data ?? []);
    }
    setRefreshing(false);
  }, [session]);

  useEffect(() => {
    if (session) {
      loadFeed();
    } else {
      setFeedItems([]);
    }
  }, [session, loadFeed]);

  const handleAuthSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      const email = String(formData.get("email") ?? "").trim();
      const password = String(formData.get("password") ?? "").trim();
      if (!email || !password) {
        setStatusMessage("Enter both email and password.");
        return;
      }
      setStatusMessage(null);
      setError(null);
      try {
        if (authMode === "signUp") {
          const { error: signUpError } = await supabase.auth.signUp({
            email,
            password
          });
          if (signUpError) throw signUpError;
          setStatusMessage("Check your inbox to confirm your email address.");
          setAuthMode("signIn");
        } else {
          const { error: signInError } = await supabase.auth.signInWithPassword({
            email,
            password
          });
          if (signInError) throw signInError;
        }
      } catch (authError) {
        const message = authError instanceof Error ? authError.message : "Authentication failed.";
        setError(message);
      }
    },
    [authMode]
  );

  const handleSignOut = useCallback(async () => {
    await supabase.auth.signOut();
    setFeedItems([]);
  }, []);

  const greeting = useMemo(() => {
    if (!session?.user?.email) return "Welcome back";
    const prefix = session.user.email.split("@")[0] ?? "";
    return `Hey, ${prefix}`;
  }, [session]);

  if (loading) {
    return (
      <div className="appShell">
        <div className="card loadingCard">Loading...</div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="appShell">
        <div className="card authCard">
          <h1 className="appTitle">SmartFeed</h1>
          <p className="appSubtitle">Sign in to see your personalized feed.</p>
          <form className="authForm" onSubmit={handleAuthSubmit}>
            <label className="field">
              <span>Email</span>
              <input type="email" name="email" placeholder="you@example.com" required />
            </label>
            <label className="field">
              <span>Password</span>
              <input type="password" name="password" placeholder="Enter your password" minLength={6} required />
            </label>
            <button type="submit" className="primaryButton">
              {authMode === "signUp" ? "Create account" : "Sign in"}
            </button>
          </form>
          {statusMessage && <p className="statusMessage">{statusMessage}</p>}
          {error && <p className="errorMessage">{error}</p>}
          <button
            type="button"
            className="linkButton"
            onClick={() => {
              setError(null);
              setStatusMessage(null);
              setAuthMode(authMode === "signUp" ? "signIn" : "signUp");
            }}
          >
            {authMode === "signUp" ? "Have an account? Sign in" : "Need an account? Sign up"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="appShell">
      <header className="appHeader">
        <div>
          <h1 className="appTitle">SmartFeed</h1>
          <p className="appSubtitle">{greeting}</p>
        </div>
        <div className="headerActions">
          <button className="secondaryButton" onClick={loadFeed} disabled={refreshing}>
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>
          <button className="secondaryButton" onClick={handleSignOut}>
            Sign out
          </button>
        </div>
      </header>
      {error && <p className="errorMessage">{error}</p>}
      <main className="feedList">
        {feedItems.length === 0 ? (
          <div className="emptyState card">
            <p>No feed items yet. Trigger the generator to get started.</p>
          </div>
        ) : (
          feedItems.map((item) => (
            <article key={item.id} className="feedCard card">
              <div className="feedCardHeader">
                {item.character_image_url ? (
                  <img className="avatar" src={item.character_image_url} alt={item.character_name ?? "Character avatar"} />
                ) : (
                  <span className="avatar placeholder">{item.character_name?.[0]?.toUpperCase() ?? "?"}</span>
                )}
                <div>
                  <h2 className="feedTitle">{item.title ?? "Untitled"}</h2>
                  <p className="feedMeta">
                    {item.character_name ?? "Unknown character"}
                    {item.created_at ? ` · ${new Date(item.created_at).toLocaleString()}` : null}
                  </p>
                  <p className="feedTldr">{item.tldr}</p>
                </div>
              </div>
              <p className="feedBody">{item.content}</p>
            </article>
          ))
        )}
      </main>
    </div>
  );
}

export default App;
