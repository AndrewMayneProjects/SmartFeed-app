import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildNarrationText, synthesizeNarrationToStorage } from "../_shared/audio.ts";

const buildHeaderImageUrl = (title?: string | null, fallback?: string | null) => {
  const promptSource =
    (title && title.trim()) || (fallback && fallback.trim()) || "simple monochrome illustration of a story moment";
  const descriptivePrompt = `simple monochrome illustration of ${promptSource} central focus minimal background`;
  const slug =
    descriptivePrompt
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 140) || `story-image-${crypto.randomUUID()}`;
  const encoded = encodeURIComponent(slug);
  return `https://magicimage.net/image/${encoded}.jpg?ratio=1:1`;
};
serve(async (req)=>{
  const origin = req.headers.get("Origin") ?? "*";
  const corsHeaders: Record<string, string> = {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin"
  };
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseServiceRoleKey || !supabaseAnonKey) {
      throw new Error("Missing Supabase environment variables");
    }
    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabaseUserClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: authHeader
        }
      },
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
    const {
      data: { user },
      error: authError
    } = await supabaseUserClient.auth.getUser();
    if (authError) {
      console.log("Auth error:", authError.message);
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        },
        status: 401
      });
    }
    if (!user?.id) {
      const serviceToken = payload?.service_token;
      if (serviceToken && serviceToken === Deno.env.get("SERVICE_FEED_TOKEN")) {
        const impersonateUser = typeof payload?.user_id === "string" ? payload.user_id : null;
        if (!impersonateUser) {
          return new Response(JSON.stringify({ error: "user_id required when using service_token" }), {
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json"
            },
            status: 400
          });
        }
        user = { id: impersonateUser } as typeof user;
      } else {
        return new Response(JSON.stringify({ error: "User not found" }), {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          },
          status: 401
        });
      }
    }
    const userId = user.id;
    let payload: Record<string, unknown> = {};
    if (req.method === "POST") {
      const contentType = req.headers.get("Content-Type") ?? "";
      if (contentType.includes("application/json")) {
        try {
          payload = await req.json();
        } catch  {
          payload = {};
        }
      } else {
        try {
          const raw = await req.text();
          payload = raw ? JSON.parse(raw) : {};
        } catch  {
          payload = {};
        }
      }
    }
    const requestedCharacterId =
      typeof payload.characterId === "string"
        ? payload.characterId
        : typeof payload.character_id === "string"
          ? payload.character_id
          : null;
    const characterFields = "id, prompt, likes, dislikes, user_id, name, image_url, history";
    let selected:
      | {
          id: string;
          prompt: string | null;
          likes: number | null;
          dislikes: number | null;
          user_id: string | null;
          name: string | null;
          image_url: string | null;
          history: string | null;
        }
      | null = null;
    if (requestedCharacterId) {
      const { data: targeted, error: targetedError } = await supabase
        .from("characters")
        .select(characterFields)
        .eq("id", requestedCharacterId)
        .eq("user_id", userId)
        .maybeSingle();
      if (targetedError) throw new Error(targetedError.message);
      if (!targeted) {
        return new Response(JSON.stringify({ error: "Character not found" }), {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          },
          status: 404
        });
      }
      selected = targeted;
    } else {
      // Fetch all characters (creators) with their metadata
      const { data: characters, error } = await supabase.from("characters").select(characterFields).eq("user_id", userId);
      if (error) throw new Error(error.message);
      if (!characters || characters.length === 0) {
        return new Response(JSON.stringify({
          error: "No characters found"
        }), {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          },
          status: 400
        });
      }
      // Compute weights and select a character by weighted random
      const weights = characters.map((c)=>1 + Math.sqrt(Math.max(c.likes ?? 0, 0)));
      const total = weights.reduce((acc, w)=>acc + w, 0);
      let r = Math.random() * total;
      selected = characters[0];
      for(let i = 0; i < characters.length; i++){
        r -= weights[i];
        if (r <= 0) {
          selected = characters[i];
          break;
        }
      }
    }
    if (!selected) {
      throw new Error("Unable to select character");
    }
    console.log("selected", selected);
    const existingHistoryRaw = typeof selected.history === "string" ? selected.history : "";
    const historyEntries = existingHistoryRaw.split("\n").map((entry)=>entry.trim()).filter(Boolean);
    const recentHistoryEntries = historyEntries.slice(-10);
    const historyContext = recentHistoryEntries.length > 0 ? `Previous TL;DR summaries (oldest first):\n${recentHistoryEntries.map((entry, idx)=>`${idx + 1}. ${entry}`).join("\n")}` : "No previous TL;DR summaries exist yet for this character.";
    // JSON schema for the structured response
    const responseSchema = {
      name: "feed_item",
      schema: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "Catchy title for the feed item"
          },
          content: {
            type: "string",
            description: "The feed item text generated from the character prompt"
          },
          tldr: {
            type: "string",
            description: "One-sentence TL;DR summary of the content"
          }
        },
        required: [
          "title",
          "content",
          "tldr"
        ],
        additionalProperties: false
      },
      strict: true
    };
    // Call OpenAI GPT‑5.1 using structured output to force a JSON body
    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")}`
      },
      body: JSON.stringify({
        model: "gpt-5.1",
        messages: [
          {
            role: "system",
            content: "You are an AI assistant that writes feed items based on a creator prompt. Respond with JSON containing 'title' (a short, punchy headline), 'content' (the full feed item), and 'tldr' (a one sentence summary). Use plain text and avoid repeating earlier TL;DR summaries. Ground your writing in the creator prompt below.\n\n" + selected.prompt
          },
          {
            role: "user",
            content: `${historyContext}\n\nPick a new idea that feels distinctive compared to the recent entries above. Stay true to the character's persona, but avoid repeating the same event, angle, or thesis. Surprise the audience with a different hook, conflict, or discovery that still makes sense for this character.`
          },
          {
            role: "user",
            content: "Create a new item that adds something fresh to the timeline."
          }
        ],
        response_format: {
          type: "json_schema",
          json_schema: responseSchema
        }
      })
    });
    if (!openaiRes.ok) {
      const errorText = await openaiRes.text();
      console.log("OpenAI API error:", errorText);
      throw new Error(`OpenAI API returned ${openaiRes.status}`);
    }
    const ai = await openaiRes.json();
    console.log("AI:", ai);
    // Parse the structured response to extract the content
    const choiceMessage = ai.choices?.[0]?.message;
    let feedTitle = "";
    let feedContent = "";
    let feedTldr = "";
    const assignFromParsed = (payload: Record<string, unknown> | undefined)=>{
      if (!payload) return;
      if (typeof payload.title === "string") {
        feedTitle = payload.title;
      }
      if (typeof payload.content === "string") {
        feedContent = payload.content;
      }
      if (typeof payload.tldr === "string") {
        feedTldr = payload.tldr;
      }
    };
    // Prefer parsed payload when using response_format json_schema
    if (choiceMessage?.parsed && typeof choiceMessage.parsed === "object") {
      assignFromParsed(choiceMessage.parsed as Record<string, unknown>);
    } else if (typeof choiceMessage?.content === "string") {
      try {
        const parsed = JSON.parse(choiceMessage.content);
        assignFromParsed(parsed);
      } catch (err) {
        console.log("Failed to parse message content, falling back to raw text:", err);
        feedContent = choiceMessage.content;
      }
    } else if (Array.isArray(choiceMessage?.content)) {
      const textPart = choiceMessage.content.find((part)=>part?.type === "output_text" || part?.type === "text");
      if (textPart?.text) {
        try {
          const parsed = JSON.parse(textPart.text);
          assignFromParsed(parsed);
          if (!feedContent) feedContent = textPart.text;
        } catch  {
          feedContent = textPart.text;
        }
      }
    } else if (choiceMessage?.tool_calls?.[0]?.function?.arguments) {
      // Fallback for tool call responses
      const argsRaw = choiceMessage.tool_calls[0].function.arguments;
      try {
        const args = typeof argsRaw === "string" ? JSON.parse(argsRaw) : argsRaw;
        assignFromParsed(args);
      } catch (err) {
        console.log("Failed to parse tool call arguments:", err);
      }
    }
    if (!feedTitle || !String(feedTitle).trim()) {
      throw new Error("Feed title missing from AI response");
    }
    if (!feedContent || !String(feedContent).trim()) {
      throw new Error("Feed content missing from AI response");
    }
    if (!feedTldr || !String(feedTldr).trim()) {
      throw new Error("Feed TL;DR missing from AI response");
    }
    console.log("feedTitle", feedTitle);
    console.log("feedContent", feedContent);
    console.log("feedTldr", feedTldr);
    const updatedHistoryEntries = [
      ...historyEntries,
      feedTldr
    ];
    const maxHistoryEntries = 20;
    const truncatedHistoryEntries = updatedHistoryEntries.slice(-maxHistoryEntries);
    const updatedHistory = truncatedHistoryEntries.join("\n");
    // Insert new feed item entry for the character
    const { data: inserted, error: insertError } = await supabase.from("feed_items").insert({
      user_id: userId,
      character_id: selected.id,
      title: feedTitle,
      content: feedContent,
      tldr: feedTldr,
      character_name: selected.name,
      character_image_url: selected.image_url,
      header_image_url: buildHeaderImageUrl(feedTitle, feedTldr),
      likes: 0,
      dislikes: 0,
      bookmarks: 0
    }).select();
    if (insertError) {
      console.log("Insert failed:", insertError);
      throw new Error(insertError.message);
    }
    const newRow = inserted?.[0];
    if (!newRow) {
      throw new Error("Insert returned no row; check table constraints and RLS policies");
    }
    const { error: historyUpdateError } = await supabase.from("characters").update({
      history: updatedHistory
    }).eq("id", selected.id);
    if (historyUpdateError) {
      console.log("Failed to update character history:", historyUpdateError);
      throw new Error(historyUpdateError.message);
    }

    const narrationText = buildNarrationText(feedTitle, feedContent, feedTldr);
    if (narrationText) {
      try {
        await synthesizeNarrationToStorage({
          supabaseAdmin: supabase,
          feedItemId: newRow.id,
          userId,
          narrationText
        });
      } catch (audioError) {
        console.error("Audio synthesis failed for feed item", newRow.id, audioError);
      }
    }

    return new Response(JSON.stringify({
      character_id: selected.id,
      title: feedTitle,
      content: feedContent,
      tldr: feedTldr
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      },
      status: 200
    });
  } catch (err) {
    console.log("Error", err.message);
    return new Response(JSON.stringify({
      error: err.message
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      },
      status: 500
    });
  }
});
