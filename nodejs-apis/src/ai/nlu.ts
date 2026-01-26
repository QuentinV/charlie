import 'dotenv/config';

const host = process.env.RASA_HOST;

async function callRasa(text: string) {
    const res: any = await fetch(`http://${host}/model/parse`, {
        method: 'POST',
        body: JSON.stringify({ text }),
    });

    return res.json();
}

(async () => {
    const res = await callRasa('Allume la lumière de la cuisine');
    console.log(JSON.stringify(res));
})();

/*
function validateSlots(device, state, memory) {
  if (!device) return { ask: "Which device?" };
  if (!state) return { ask: "On or off?" };

  if (!memory.devices.includes(device)) {
    return { ask: `I don't know a device called ${device}.` };
  }

  if (!["on", "off"].includes(state)) {
    return { ask: "I can only turn devices on or off." };
  }

  return { valid: true };
}

*/

/*
const { text } = req.body;

  if (!text) {
    return res.status(400).json({ error: "Missing text" });
  }

  try {
    // Send text to Rasa NLU
    const rasaRes = await axios.post(RASA_URL, { text });
    const { intent, entities } = rasaRes.data;

    console.log("Rasa intent:", intent);
    console.log("Entities:", entities);

    // Handle "set_device_state" intent
    if (intent.name === "set_device_state") {
      const device = entities.find(e => e.entity === "device")?.value;
      const state = entities.find(e => e.entity === "state")?.value;

      if (!device || !state) {
        return res.json({
          reply: "I need both a device and a state to perform this action."
        });
      }

      const result = await changeDeviceState(device, state);

      return res.json({
        reply: `Setting ${device} to ${state}.`,
        result
      });
    }

    // Default fallback
    return res.json({
      reply: `I understood intent "${intent.name}", but I don't handle it yet.`
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal error" });
  }
});*/

// Multi commands :

/*
function splitCommands(text) {
  return text
    .split(/\bet\b|\bpuis\b|\bensuite\b|,/gi)
    .map(t => t.trim())
    .filter(t => t.length > 0);
}

const segments = splitCommands(text);
const results = [];

for (const s of segments) {
  results.push(await parseSegment(s));
}

for (const r of results) {
  if (r.intent.confidence < 0.45) {
    // send to LLM fallback
  } else {
    // execute Home Assistant action
  }
}

*/

/*
if (rasaResult.intent.confidence < 0.45) {
    return callLLM(command, context);
}

const resolved = resolvePronouns(rasaResult, memory);

await executeHomeAssistant(resolved);

memory.lastDevice = resolved.device;
memory.lastIntent = resolved.intent;

return buildAssistantResponse(resolved);

*/

/*
Conversation is not done inside Rasa.
Conversation is done inside Node.js.

Rasa only answers one question:

“What does this message mean?”

Node.js  answers everything else:

What was the previous device?

What was the last intent?

What is the user referring to with “ça”, “la”, “l’autre” ?

Should I call the LLM?

Should I split the message into multiple commands?

Should I ask a clarification question?

Should I execute a Home Assistant action?

Should I store this in memory?

This is exactly how:

Alexa

Siri

Google Assistant

Home Assistant Assist

are built.

They all use a separate NLU engine, and the assistant logic lives elsewhere.
*/
