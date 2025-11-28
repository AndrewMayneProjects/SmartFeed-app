import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
serve(async (req)=>{
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
  const supabaseUserClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: req.headers.get('Authorization') ?? ''
      }
    }
  });
  const { data: { user } } = await supabaseUserClient.auth.getUser();
  if (!user) {
    return new Response(JSON.stringify({
      error: 'Unauthorized'
    }), {
      status: 401
    });
  }
  let body = {};
  try {
    body = await req.json();
  } catch (_) {
    return new Response(JSON.stringify({
      error: 'Invalid JSON body'
    }), {
      status: 400
    });
  }
  const characterId = body.character_id;
  if (!characterId) {
    return new Response(JSON.stringify({
      error: 'character_id is required'
    }), {
      status: 400
    });
  }
  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
  const { data: character, error: charError } = await supabaseAdmin.from('characters').select('prompt,user_id').eq('id', characterId).single();
  if (charError || !character) {
    return new Response(JSON.stringify({
      error: 'Character not found'
    }), {
      status: 404
    });
  }
  if (character.user_id !== user.id) {
    return new Response(JSON.stringify({
      error: 'Forbidden'
    }), {
      status: 403
    });
  }
  const { data: recentItems } = await supabaseAdmin
    .from('feed_items')
    .select('content, created_at')
    .eq('character_id', characterId)
    .order('created_at', { ascending: false })
    .limit(5);
  const historyBlocks = (recentItems ?? [])
    .reverse()
    .map((entry, idx) => `### Previous Item ${idx + 1}\n${entry.content?.trim() ?? ''}`)
    .join('\n\n');
  const historyContext = historyBlocks ? `Previous items:\n${historyBlocks}` : 'No previous items yet.';
  const prompt = `${character.prompt}\n\nYou are writing a single new feed entry for this character. Consider the recent posts you've crafted before, and deliberately pick a new idea, angle, or development that feels different while staying true to the persona. Avoid repeating the same event or punchline.`;
  const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${openaiApiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-5.1',
      messages: [
        {
          role: 'system',
          content: prompt
        },
        {
          role: 'user',
          content: `${historyContext}\n\nCreate one compelling feed item that feels fresh compared to the last few posts.`
        }
      ],
      max_tokens: 200
    })
  });
  const openaiData = await openaiRes.json();
  const content = openaiData?.choices?.[0]?.message?.content?.trim();
  if (!content) {
    return new Response(JSON.stringify({
      error: 'Failed to generate content'
    }), {
      status: 500
    });
  }
  const { error: insertError } = await supabaseAdmin.from('feed_items').insert({
    user_id: user.id,
    character_id: characterId,
    content
  });
  if (insertError) {
    return new Response(JSON.stringify({
      error: insertError.message
    }), {
      status: 500
    });
  }
  return new Response(JSON.stringify({
    content
  }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json'
    }
  });
});
