const DEFAULT_MODEL = '@cf/black-forest-labs/flux-1-schnell';

// Workers AI validates every request against the model's strict JSON schema
// (additionalProperties: false). Any field the model doesn't declare fails with
// error 5006: "Additional or unevaluated properties '/num_steps' at '/' not allowed".
//
// The diffusion-steps field name differs by model family:
//   - FLUX (@cf/black-forest-labs/...): `steps`     — integer, max 8, default 4
//   - Stable Diffusion family (SDXL …): `num_steps` — max 20
function isFlux(model) {
  return /flux|black-forest-labs/i.test(model);
}

function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function json(body, status, cors) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

// Run the model. If the model's strict schema rejects one of the optional
// fields (error 5006), retry with just the required prompt so the user still
// gets an image instead of a schema error.
async function runModel(env, model, input) {
  try {
    return await env.AI.run(model, input);
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    if (/additional or unevaluated properties/i.test(message)) {
      return await env.AI.run(model, { prompt: input.prompt });
    }
    throw err;
  }
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    if (request.method !== 'POST') {
      return json({ error: 'POST only' }, 405, cors);
    }

    // Optional: only enforced if you add a secret named IMAGE_API_KEY (see below)
    if (env.IMAGE_API_KEY) {
      const key = request.headers.get('X-API-Key') || '';
      if (key !== env.IMAGE_API_KEY) {
        return json({ error: 'Unauthorized' }, 401, cors);
      }
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ error: 'Body must be JSON' }, 400, cors);
    }

    const prompt = typeof payload.prompt === 'string' ? payload.prompt.trim() : '';
    if (!prompt) {
      return json({ error: 'prompt is required' }, 400, cors);
    }
    if (prompt.length > 2048) {
      return json({ error: 'prompt too long (max 2048 chars)' }, 400, cors);
    }

    const model =
      typeof payload.model === 'string' && payload.model.startsWith('@cf/')
        ? payload.model
        : DEFAULT_MODEL;

    let steps = Number(payload.steps ?? payload.num_steps ?? payload.numSteps ?? 4);
    if (!Number.isFinite(steps) || steps < 1) steps = 4;
    steps = Math.min(Math.floor(steps), isFlux(model) ? 8 : 20);

    // Only send fields the model's schema actually declares.
    const input = { prompt };
    input[isFlux(model) ? 'steps' : 'num_steps'] = steps;

    try {
      const result = await runModel(env, model, input);

      if (result && typeof result === 'object' && typeof result.image === 'string') {
        return json({ image: result.image, model }, 200, cors);
      }

      if (result instanceof ReadableStream || result instanceof ArrayBuffer || result instanceof Uint8Array) {
        return new Response(result, {
          status: 200,
          headers: { ...cors, 'Content-Type': 'image/png' },
        });
      }

      if (typeof result === 'string') {
        return json({ image: result, model }, 200, cors);
      }

      return json(
        {
          error: 'Unexpected model response shape',
          keys: result && typeof result === 'object' ? Object.keys(result) : [],
        },
        502,
        cors
      );
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      return json({ error: 'Workers AI failed', detail: message }, 502, cors);
    }
  },
};
