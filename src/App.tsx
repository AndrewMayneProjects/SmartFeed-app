import { useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase, supabaseAnonKey, supabaseUrl } from "./lib/supabaseClient";
import "./App.css";

type AuthMode = "signIn" | "signUp";

type AudioStatus = "idle" | "processing" | "ready" | "error";

type FeedItem = {
  id: string;
  character_id: string | null;
  title: string | null;
  content: string | null;
  tldr: string | null;
  character_name: string | null;
  character_image_url: string | null;
  likes: number;
  bookmarks: number;
  is_bookmarked: boolean;
  created_at: string | null;
  audio_url: string | null;
  audio_status: AudioStatus;
  audio_voice: string | null;
  audio_error: string | null;
};

const FEED_LIMIT = 40;

const formatRelativeTime = (dateString: string | null, locale = "en-US") => {
  if (!dateString) return "";
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return "";

  const diffMs = Date.now() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);

  if (diffSeconds < 45) return "just now";
  if (diffSeconds < 90) return "1m";
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d`;
  return date.toLocaleDateString(locale, {
    month: "short",
    day: "numeric"
  });
};

const buildPreview = (text: string | null | undefined, limit = 240) => {
  if (!text) return "";
  if (text.length <= limit) return text;
  return `${text.slice(0, limit).trimEnd()}…`;
};

const AccountIcon = () => (
  <svg
    aria-hidden="true"
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 12c2.761 0 5-2.239 5-5s-2.239-5-5-5-5 2.239-5 5 2.239 5 5 5Z" />
    <path d="M4 20.5c1.556-3.033 4.588-4.5 8-4.5s6.444 1.467 8 4.5" />
  </svg>
);

const ThumbUpIcon = () => (
  <svg
    aria-hidden="true"
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M7 22V9l5-7 1.5 1.5a2 2 0 0 1 .5 1.34L14 9h7a2 2 0 0 1 2 2l-1.19 6.55a2 2 0 0 1-1.97 1.62H12" />
    <path d="M7 22H4a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2h3" />
  </svg>
);

const BookmarkIcon = () => (
  <svg
    aria-hidden="true"
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M19 21 12 17 5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2Z" />
  </svg>
);

const BookmarkFilledIcon = () => (
  <svg
    aria-hidden="true"
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="currentColor"
    stroke="none"
  >
    <path d="M19 3a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v18l7-4 7 4z" />
  </svg>
);

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [authMode, setAuthMode] = useState<AuthMode>("signIn");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [showToast, setShowToast] = useState(false);
  const [feedItems, setFeedItems] = useState<FeedItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [view, setView] = useState<"feed" | "characters">("feed");
  const [characters, setCharacters] = useState<CharacterSummary[]>([]);
  const [loadingCharacters, setLoadingCharacters] = useState(false);
  const [generatingCharacterId, setGeneratingCharacterId] = useState<string | null>(null);
  const [pendingLike, setPendingLike] = useState<string | null>(null);
  const [pendingBookmark, setPendingBookmark] = useState<string | null>(null);
  const [createMode, setCreateMode] = useState(false);
  const [createDescription, setCreateDescription] = useState("");
  const [creatingCharacter, setCreatingCharacter] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [fontSizeChoice, setFontSizeChoice] = useState<FontSizeChoice>("comfortable");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const toastTimeoutRef = useRef<number | null>(null);

  const closeAccount = useCallback(() => setAccountOpen(false), []);
  const toggleAccount = useCallback(() => setAccountOpen((open) => !open), []);
  const toggleExpanded = useCallback((itemId: string) => {
    setExpandedId((current) => (current === itemId ? null : itemId));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem("smartfeed-font-size");
    if (stored && (stored === "compact" || stored === "comfortable" || stored === "large" || stored === "extra")) {
      setFontSizeChoice(stored);
    }
  }, []);

  useEffect(() => {
    const preset = FONT_SIZE_PRESETS[fontSizeChoice];
    if (typeof document !== "undefined") {
      document.documentElement.style.setProperty("--app-base-font-size", `${preset.size}px`);
    }
    if (typeof window !== "undefined") {
      window.localStorage.setItem("smartfeed-font-size", fontSizeChoice);
    }
  }, [fontSizeChoice]);

  const showToastMessage = useCallback((message: string) => {
    setStatusMessage(message);
    setShowToast(true);
    if (toastTimeoutRef.current) {
      window.clearTimeout(toastTimeoutRef.current);
    }
    toastTimeoutRef.current = window.setTimeout(() => {
      setShowToast(false);
      toastTimeoutRef.current = null;
    }, 2500);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) {
        window.clearTimeout(toastTimeoutRef.current);
      }
    };
  }, []);

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
    if (!session?.user?.id) {
      setFeedItems([]);
      return;
    }
    setRefreshing(true);
    setError(null);
    console.info("[SmartFeed] Refresh requested", new Date().toISOString());
    try {
      const { data, error: feedError } = await supabase
        .from("feed_items")
        .select(
          "id, character_id, title, content, tldr, character_name, character_image_url, likes, bookmarks, created_at, audio_url, audio_status, audio_voice, audio_error"
        )
        .eq("user_id", session.user.id)
        .order("created_at", { ascending: false })
        .limit(FEED_LIMIT);
      if (feedError) {
        console.error("Failed to load feed:", feedError);
        setError(feedError.message ?? "Unable to load feed right now.");
      } else {
        const sanitized = (data ?? []).map((entry) => ({
          ...entry,
          likes: typeof entry.likes === "number" ? entry.likes : 0,
          bookmarks: typeof entry.bookmarks === "number" ? entry.bookmarks : 0,
          audio_status: ((entry.audio_status as AudioStatus | null) ?? "idle") as AudioStatus,
          audio_url: entry.audio_url ?? null,
          audio_voice: entry.audio_voice ?? null,
          audio_error: entry.audio_error ?? null
        }));
        let bookmarkedSet = new Set<string>();
        if (sanitized.length > 0) {
          const ids = sanitized.map((entry) => entry.id);
          const { data: bookmarkRows, error: bookmarkError } = await supabase
            .from("feed_item_bookmarks")
            .select("feed_item_id")
            .eq("user_id", session.user.id)
            .in("feed_item_id", ids);
          if (bookmarkError) {
            console.error("Failed to load bookmarks:", bookmarkError);
          } else if (bookmarkRows) {
            bookmarkedSet = new Set(bookmarkRows.map((row) => row.feed_item_id as string));
          }
        }
        setFeedItems(
          sanitized.map(
            (entry) =>
              ({
                ...entry,
                is_bookmarked: bookmarkedSet.has(entry.id)
              }) as FeedItem
          )
        );
      }
    } finally {
      setRefreshing(false);
    }
  }, [session]);

  const handleSwitchView = useCallback(
    (next: "feed" | "characters") => {
      if (view === next) return;
      setStatusMessage(null);
      setError(null);
      setExpandedId(null);
      setView(next);
    },
    [view]
  );

  const loadCharacters = useCallback(async () => {
    if (!session?.user?.id) {
      setCharacters([]);
      return;
    }
    setLoadingCharacters(true);
    try {
      const { data, error: charactersError } = await supabase
        .from("characters")
        .select("id, name, description, prompt, image_url, history, likes")
        .eq("user_id", session.user.id)
        .order("name", { ascending: true });
      if (charactersError) {
        console.error("Failed to load characters:", charactersError);
        setError(charactersError.message ?? "Unable to load characters.");
      } else {
        setCharacters(
          (data ?? []).map((entry) => ({
            id: entry.id,
            name: entry.name ?? "Untitled",
            description: entry.description ?? "",
            prompt: entry.prompt ?? "",
            image_url: entry.image_url ?? null,
            history: typeof entry.history === "string" ? entry.history : "",
            likes: typeof entry.likes === "number" ? entry.likes : 0
          }))
        );
      }
    } finally {
      setLoadingCharacters(false);
    }
  }, [session]);

  useEffect(() => {
    if (view !== "feed") {
      return;
    }
    if (session) {
      loadFeed();
    } else {
      setFeedItems([]);
    }
  }, [session, view, loadFeed]);

  useEffect(() => {
    if (view === "characters") {
      loadCharacters();
    }
  }, [view, loadCharacters]);

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
    try {
      await supabase.auth.signOut();
      setSession(null);
    } catch (signOutError) {
      const message =
        signOutError instanceof Error
          ? signOutError.message
          : typeof signOutError === "object" && signOutError !== null && "message" in signOutError
            ? String((signOutError as { message: unknown }).message)
            : "Failed to sign out.";
      setError(message);
    } finally {
      setFeedItems([]);
      setExpandedId(null);
      closeAccount();
    }
  }, [closeAccount]);

  const handleGenerate = useCallback(async () => {
    if (!session) return;
    setGenerating(true);
    setError(null);
    try {
      const headers: Record<string, string> = {};
      if (session?.access_token) {
        headers.Authorization = `Bearer ${session.access_token}`;
      }
      if (supabaseAnonKey) {
        headers.apikey = supabaseAnonKey;
      }
      const { error: fnError } = await supabase.functions.invoke("generate-weighted-feed-item", {
        body: { source: "web-app" },
        headers
      });
      if (fnError) {
        throw fnError;
      }
      await loadFeed();
    } catch (invokeError) {
      console.error("Failed to generate feed item:", invokeError);
      const message =
        invokeError instanceof Error
          ? invokeError.message
          : typeof invokeError === "object" && invokeError !== null && "message" in invokeError
            ? String((invokeError as { message: unknown }).message)
            : "Failed to generate a new feed item.";
      setError(message);
    } finally {
      setGenerating(false);
    }
  }, [session, loadFeed]);

  const handleGenerateForCharacter = useCallback(
    async (characterId: string) => {
      if (!session) return;
      setGeneratingCharacterId(characterId);
      setError(null);
      setStatusMessage(null);
      try {
        const headers: Record<string, string> = {};
        if (session?.access_token) {
          headers.Authorization = `Bearer ${session.access_token}`;
        }
        if (supabaseAnonKey) {
          headers.apikey = supabaseAnonKey;
        }
        const { error: fnError } = await supabase.functions.invoke("generate-weighted-feed-item", {
          body: { source: "web-app", character_id: characterId },
          headers
        });
        if (fnError) {
          throw fnError;
        }
        await loadFeed();
        setView("feed");
        setExpandedId(null);
        const character = characters.find((entry) => entry.id === characterId);
        if (character) {
          setStatusMessage(`Generated new item for ${character.name}.`);
        }
      } catch (invokeError) {
        console.error("Failed to generate feed item:", invokeError);
        const message =
          invokeError instanceof Error
            ? invokeError.message
            : typeof invokeError === "object" && invokeError !== null && "message" in invokeError
              ? String((invokeError as { message: unknown }).message)
              : "Failed to generate a new feed item.";
        setError(message);
      } finally {
        setGeneratingCharacterId(null);
      }
    },
    [session, loadFeed, characters]
  );

  const handleReaction = useCallback(
    async (item: FeedItem) => {
      if (!session?.user?.id) return;
      if (pendingLike === item.id) return;
      setPendingLike(item.id);
      setError(null);
      try {
        const { data, error: reactionError } = await supabase.rpc("react_to_feed_item", {
          p_feed_item_id: item.id,
          p_reaction: "like"
        });
        if (reactionError) {
          throw reactionError;
        }
        const payload = Array.isArray(data) ? data[0] : data;
        if (!payload || typeof payload !== "object") {
          throw new Error("No reaction data returned.");
        }
        const parsed = payload as Record<string, unknown>;
        const nextLikes = typeof parsed.likes === "number" ? parsed.likes : item.likes;
        const nextCharacterLikes =
          typeof parsed.character_likes === "number" ? parsed.character_likes : undefined;

        setFeedItems((items) =>
          items.map((feedItem) =>
            feedItem.id === item.id
              ? {
                  ...feedItem,
                  likes: nextLikes
                }
              : feedItem
          )
        );
        if (item.character_id) {
          setCharacters((entries) =>
            entries.map((character) =>
              character.id === item.character_id
                ? {
                    ...character,
                    likes: nextCharacterLikes ?? character.likes
                  }
                : character
            )
          );
        }
        const storyName = item.title ?? item.tldr ?? item.character_name ?? "this story";
        showToastMessage(`You liked ${storyName}.`);
      } catch (reactionError) {
        console.error("Failed to react to feed item:", reactionError);
        const message =
          reactionError instanceof Error
            ? reactionError.message
            : typeof reactionError === "object" && reactionError !== null && "message" in reactionError
              ? String((reactionError as { message: unknown }).message)
              : "Failed to update reaction.";
        setError(message);
      } finally {
        setPendingLike(null);
      }
    },
    [session, pendingLike, showToastMessage]
  );

  const handleBookmark = useCallback(
    async (item: FeedItem) => {
      if (!session?.user?.id) return;
      if (pendingBookmark === item.id) return;
      setPendingBookmark(item.id);
      setError(null);
      try {
        const { data, error: bookmarkError } = await supabase.rpc("toggle_feed_item_bookmark", {
          p_feed_item_id: item.id
        });
        if (bookmarkError) {
          throw bookmarkError;
        }
        const payload = Array.isArray(data) ? data[0] : data;
        if (!payload || typeof payload !== "object") {
          throw new Error("No bookmark data returned.");
        }
        const parsed = payload as Record<string, unknown>;
        const isBookmarked =
          typeof parsed.is_bookmarked === "boolean" ? parsed.is_bookmarked : !item.is_bookmarked;
        const nextBookmarks =
          typeof parsed.bookmarks === "number" ? parsed.bookmarks : item.bookmarks;
        setFeedItems((items) =>
          items.map((feedItem) =>
            feedItem.id === item.id
              ? {
                  ...feedItem,
                  is_bookmarked: isBookmarked,
                  bookmarks: nextBookmarks
                }
              : feedItem
          )
        );
        showToastMessage(isBookmarked ? "Saved to bookmarks." : "Removed from bookmarks.");
      } catch (bookmarkError) {
        console.error("Failed to toggle bookmark:", bookmarkError);
        const message =
          bookmarkError instanceof Error
            ? bookmarkError.message
            : typeof bookmarkError === "object" && bookmarkError !== null && "message" in bookmarkError
              ? String((bookmarkError as { message: unknown }).message)
              : "Failed to update bookmark.";
        setError(message);
      } finally {
        setPendingBookmark(null);
      }
    },
    [session, pendingBookmark, showToastMessage]
  );

  const handleStartCreate = useCallback(() => {
    setCreateMode(true);
    setCreateDescription("");
    setCreateError(null);
  }, []);

  const handleCancelCreate = useCallback(() => {
    setCreateMode(false);
    setCreateDescription("");
    setCreateError(null);
    setRecording(false);
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    mediaRecorderRef.current = null;
    audioChunksRef.current = [];
  }, []);

  const handleCreateCharacterSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!session?.user?.id) return;
      const trimmed = createDescription.trim();
      if (!trimmed) {
        setCreateError("Describe the character you have in mind.");
        return;
      }
      setCreatingCharacter(true);
      setCreateError(null);
      try {
        const { data, error: createFnError } = await supabase.functions.invoke("create-character", {
          body: { description: trimmed }
        });
        if (createFnError) {
          throw createFnError;
        }
        const createdName =
          data && typeof data === "object" && data !== null && "name" in data && typeof (data as { name: unknown }).name === "string"
            ? ((data as { name: string }).name || "your character")
            : "your character";
        showToastMessage(`Created ${createdName}.`);
        setCreateMode(false);
        setCreateDescription("");
        await loadCharacters();
      } catch (createErr) {
        const message =
          createErr instanceof Error
            ? createErr.message
            : typeof createErr === "object" && createErr !== null && "message" in createErr
              ? String((createErr as { message: unknown }).message)
              : "Failed to create character.";
        setCreateError(message);
      } finally {
        setCreatingCharacter(false);
      }
    },
    [session?.user?.id, createDescription, showToastMessage, loadCharacters]
  );

  const handleToggleRecording = useCallback(async () => {
    if (recording) {
      mediaRecorderRef.current?.stop();
      return;
    }

    try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("This browser does not support microphone input.");
        }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };
      recorder.onstop = async () => {
        setRecording(false);
        stream.getTracks().forEach((track) => track.stop());
        const firstChunkType = audioChunksRef.current[0]?.type || "audio/webm";
        const audioBlob = new Blob(audioChunksRef.current, { type: firstChunkType });
        const extension = firstChunkType.includes("mp4")
          ? "mp4"
          : firstChunkType.includes("ogg")
            ? "ogg"
            : firstChunkType.includes("wav")
              ? "wav"
              : "webm";
        if (audioBlob.size === 0) {
          setCreateError("No audio captured. Try again.");
          return;
        }
        try {
          const formData = new FormData();
          formData.append("audio", audioBlob, `character.${extension}`);
          formData.append("prompt", "Transcribe this user spoken description for a fictional character.");

          const targetUrl = `${supabaseUrl}/functions/v1/transcribe-audio`;
          const authToken = session?.access_token ?? supabaseAnonKey;
          const response = await fetch(targetUrl, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${authToken}`,
              apikey: supabaseAnonKey
            },
            body: formData
          });

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(errorText || "Edge function returned an error.");
          }

          const payload = await response.json();
          const text =
            payload && typeof payload === "object" && "text" in payload && typeof (payload as { text: unknown }).text === "string"
              ? (payload as { text: string }).text
              : "";
          if (!text) {
            throw new Error("Transcription failed.");
          }
          setCreateDescription((prev) => (prev ? `${prev.trim()}\n${text}` : text));
          showToastMessage("Transcribed your description.");
        } catch (transcribeError) {
          console.error("Transcription error:", transcribeError);
          const message =
            transcribeError instanceof Error
              ? transcribeError.message
              : typeof transcribeError === "object" && transcribeError !== null && "message" in transcribeError
                ? String((transcribeError as { message: unknown }).message)
                : "Failed to transcribe audio.";
          setCreateError(message);
          showToastMessage(message);
        }
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
      showToastMessage("Listening… tap again to stop.");
    } catch (micError) {
      console.error("Microphone error:", micError);
      const message =
        micError instanceof Error
          ? micError.message
          : typeof micError === "object" && micError !== null && "message" in micError
            ? String((micError as { message: unknown }).message)
            : "Microphone permission denied. Check system settings.";
      showToastMessage(message);
      setCreateError(message);
    }
  }, [recording, session, showToastMessage]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (!accountOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [accountOpen]);

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

  const userEmail = session.user?.email ?? "";
  const userInitial = userEmail ? userEmail.charAt(0).toUpperCase() : "☺";

  return (
    <div className="appShell">
      <div className="headerContainer" role="navigation">
        <header className="appTopBar">
          <button
            type="button"
            className="accountChip"
            onClick={toggleAccount}
            aria-label="Account menu"
            aria-expanded={accountOpen}
          >
            <AccountIcon />
          </button>
          <div className="navActions">
            <div className="viewSwitch" role="tablist" aria-label="Primary view">
              <button
                type="button"
                role="tab"
                aria-selected={view === "feed"}
                className={`viewSwitch__button ${view === "feed" ? "is-active" : ""}`}
                onClick={() => handleSwitchView("feed")}
              >
                Feed
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={view === "characters"}
                className={`viewSwitch__button ${view === "characters" ? "is-active" : ""}`}
                onClick={() => handleSwitchView("characters")}
              >
                Characters
              </button>
            </div>
            <button
              type="button"
              className="generateButton"
              onClick={handleGenerate}
              disabled={generating || refreshing}
              aria-label="Generate feed item"
            >
              <span className="buttonLabel">{generating ? "Generating…" : "Generate"}</span>
            </button>
          </div>
        </header>
      </div>
      <div className="topSpacer" aria-hidden="true" />
      {showToast && statusMessage ? <Toast message={statusMessage} /> : null}
      {error && <p className="errorMessage">{error}</p>}
      {view === "feed" ? (
        <main className="feedList timeline">
          {feedItems.length === 0 ? (
            <div className="emptyState card">
              <p>No feed items yet. Trigger the generator to get started.</p>
            </div>
          ) : (
            feedItems.map((item) => (
              <FeedCard
                key={item.id}
                item={item}
                isExpanded={expandedId === item.id}
                onToggle={() => toggleExpanded(item.id)}
                onInteract={closeAccount}
                onReact={() => handleReaction(item)}
                isReacting={pendingLike === item.id}
                onBookmark={() => handleBookmark(item)}
                isBookmarking={pendingBookmark === item.id}
              />
            ))
          )}
        </main>
      ) : (
        <section className="characterList">
          {!createMode ? (
            <div className="characterActions">
              <button
                type="button"
                className="characterCreateToggle"
                onClick={handleStartCreate}
                disabled={creatingCharacter}
              >
                + New character
              </button>
            </div>
          ) : null}
          {createMode ? (
            <article className="card characterCreateCard">
              <header className="characterCreateHeader">
                <h3>Describe your new character</h3>
                <button
                  type="button"
                  className="createCloseButton"
                  onClick={handleCancelCreate}
                  aria-label="Close create character form"
                  disabled={creatingCharacter}
                >
                  ✕
                </button>
              </header>
              <form className="characterCreateForm" onSubmit={handleCreateCharacterSubmit}>
                <label>
                  <span>Character description</span>
                  <textarea
                    className="characterCreateDescription"
                    name="description"
                    placeholder="Describe the persona, goals, tone, and any quirks you want this character to have."
                    value={createDescription}
                    onChange={(event) => setCreateDescription(event.target.value)}
                    disabled={creatingCharacter}
                    minLength={12}
                    required
                  />
                </label>
                {createError ? <p className="errorMessage">{createError}</p> : null}
                <div className="characterCreateActions">
                  <button
                    type="button"
                    className={`micButton ${recording ? "recording" : ""}`}
                    onClick={handleToggleRecording}
                    disabled={creatingCharacter}
                    aria-pressed={recording}
                    aria-label={recording ? "Stop recording" : "Record description"}
                  >
                    {recording ? <StopIcon /> : <MicIcon />}
                  </button>
                  <button type="submit" className="primaryButton" disabled={creatingCharacter}>
                    {creatingCharacter ? "Creating…" : "Create character"}
                  </button>
                </div>
              </form>
            </article>
          ) : null}
          {loadingCharacters ? (
            <div className="card loadingCard">Loading characters…</div>
          ) : characters.length === 0 ? (
            <div className="card emptyState">
              <p>No characters yet. Create one to start generating stories.</p>
            </div>
          ) : (
            characters.map((character) => (
              <CharacterCard
                key={character.id}
                character={character}
                onGenerate={() => handleGenerateForCharacter(character.id)}
                isGenerating={generatingCharacterId === character.id}
              />
            ))
          )}
        </section>
      )}
      {accountOpen ? (
        <div className="accountOverlay" role="dialog" aria-modal="true" aria-label="Account menu" onClick={closeAccount}>
          <div
            className="accountSheet card"
            role="document"
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <header className="accountHeader">
              <div className="accountAvatar">{userInitial}</div>
              <div className="accountInfo">
                <p className="accountEmail">{userEmail}</p>
                <p className="accountHint">Supabase session</p>
              </div>
              <button className="modalBackButton" onClick={closeAccount} aria-label="Close account menu">
                ✕
              </button>
            </header>
            <div className="accountActions">
              <div className="accountSection">
                <label htmlFor="fontSizeSelect">Font size</label>
                <select
                  id="fontSizeSelect"
                  value={fontSizeChoice}
                  onChange={(event) => {
                    const next = event.target.value as FontSizeChoice;
                    setFontSizeChoice(next);
                  }}
                >
                  {Object.entries(FONT_SIZE_PRESETS).map(([key, preset]) => (
                    <option key={key} value={key}>
                      {preset.label}
                    </option>
                  ))}
                </select>
                <small>Saved to this device for a consistent web-app experience.</small>
              </div>
              <button className="primaryButton signOutButton" onClick={handleSignOut}>
                Sign out
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

type FeedCardProps = {
  item: FeedItem;
  isExpanded: boolean;
  onToggle: () => void;
  onInteract: () => void;
  onReact: () => void;
  isReacting: boolean;
  onBookmark: () => void;
  isBookmarking: boolean;
};

type CharacterSummary = {
  id: string;
  name: string;
  description: string;
  prompt: string;
  image_url: string | null;
  history: string;
  likes: number;
};

type CharacterCardProps = {
  character: CharacterSummary;
  onGenerate: () => void;
  isGenerating: boolean;
};

type FontSizeChoice = "compact" | "comfortable" | "large" | "extra";

const FONT_SIZE_PRESETS: Record<FontSizeChoice, { label: string; size: number }> = {
  compact: { label: "Compact", size: 16 },
  comfortable: { label: "Comfortable", size: 18 },
  large: { label: "Large", size: 20 },
  extra: { label: "Extra large", size: 22.5 }
};

function CharacterCard({ character, onGenerate, isGenerating }: CharacterCardProps) {
  const description = character.description || character.prompt || "No description provided.";
  const truncated = description.length > 220 ? `${description.slice(0, 220).trimEnd()}…` : description;

  return (
    <article className="card characterCard">
      <div className="characterAvatar">
        {character.image_url ? (
          <img src={character.image_url} alt={`${character.name} avatar`} />
        ) : (
          <span>{character.name.charAt(0).toUpperCase()}</span>
        )}
      </div>
      <div className="characterBody">
        <div className="characterHeader">
          <h3>{character.name}</h3>
          <button className="characterGenerateButton" onClick={onGenerate} disabled={isGenerating}>
            <span className="buttonLabel">{isGenerating ? "Generating…" : "Generate item"}</span>
          </button>
        </div>
        <div className="characterStats" aria-label="Character likes">
          <span className="characterStat">
            <ThumbUpIcon /> {character.likes}
          </span>
        </div>
        <p className="characterDescription">{truncated}</p>
      </div>
    </article>
  );
}

function Toast({ message }: { message: string }) {
  return (
    <div className="toast" role="status" aria-live="polite">
      {message}
    </div>
  );
}

const MicIcon = () => (
  <svg
    aria-hidden="true"
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3Z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <line x1="12" x2="12" y1="19" y2="22" />
    <line x1="8" x2="16" y1="22" y2="22" />
  </svg>
);

const StopIcon = () => (
  <svg
    aria-hidden="true"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </svg>
);

function FeedCard({ item, isExpanded, onToggle, onInteract, onReact, isReacting, onBookmark, isBookmarking }: FeedCardProps) {
  const previewText = buildPreview(item.content ?? item.tldr);
  const resolvedAudioStatus: AudioStatus = item.audio_status ?? "idle";
  const showNarration =
    Boolean(item.audio_url) || (resolvedAudioStatus !== "idle" && resolvedAudioStatus !== undefined);

  return (
    <article
      className={`feedCard card ${isExpanded ? "expanded" : ""}`}
      role="button"
      tabIndex={0}
      aria-expanded={isExpanded}
      onClick={() => {
        onInteract();
        onToggle();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onInteract();
          onToggle();
        }
      }}
    >
      <div className="feedCardHeader">
        <div className="feedHeaderRow">
          {item.character_image_url ? (
            <img className="avatar" src={item.character_image_url} alt={item.character_name ?? "Character avatar"} />
          ) : (
            <span className="avatar placeholder">{item.character_name?.[0]?.toUpperCase() ?? "?"}</span>
          )}
          <div className="feedHeaderInfo">
            <span className="feedAuthor">{item.character_name ?? "Unknown character"}</span>
            {item.created_at ? <span className="feedTime">{formatRelativeTime(item.created_at)}</span> : null}
          </div>
        </div>
        <div className="bookmarkWrapper">
          <button
            type="button"
            className={`bookmarkButton ${item.is_bookmarked ? "is-active" : ""}`}
            aria-label={item.is_bookmarked ? "Remove bookmark" : "Save to bookmarks"}
            disabled={isBookmarking}
            onClick={(event) => {
              event.stopPropagation();
              onInteract();
              onBookmark();
            }}
          >
            {item.is_bookmarked ? <BookmarkFilledIcon /> : <BookmarkIcon />}
          </button>
        </div>
      </div>
      <h2 className="feedTitle">{item.title ?? "Untitled"}</h2>
      {isExpanded ? (
        <p className="feedBody">{(item.content ?? item.tldr ?? "").trim()}</p>
      ) : (
        <p className="feedPreview">{previewText}</p>
      )}
      {showNarration && item.audio_url ? (
        <div
          className="feedAudioSection"
          role="region"
          aria-label="Story narration"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <audio className="feedAudioPlayer" controls preload="none" src={item.audio_url ?? undefined}>
            <track kind="captions" label="Transcript not available" />
          </audio>
        </div>
      ) : null}
      <div className="feedFooter">
        <button
          type="button"
          className="reactionButton"
          aria-label="Like story"
          disabled={isReacting}
          onClick={(event) => {
            event.stopPropagation();
            onInteract();
            onReact();
          }}
        >
          <ThumbUpIcon />
        </button>
        <span className="feedCta">{isExpanded ? "Collapse" : "Open story"}</span>
      </div>
    </article>
  );
}

export default App;
