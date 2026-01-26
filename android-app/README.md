# Charlie android app

# Features idea

- notifications
- sensors ?
- NFC triggers

## Feature examples

### Car gate automation

- Use NFC to turn on driving mode
    - homeassistant://call_service/input_boolean.toggle?entity_id=input_boolean.driving_mode
- Use app to check area and if close to house open or close gate + garage door
  The adaptive‑GPS strategy (Android‑friendly)
  Your idea becomes very easy to implement:

1. When far from home (e.g., > 10–20 km)
   Don’t use GPS at all.

Use Fused Location Provider in balanced or low‑power mode.

Poll maybe every 10–15 minutes or only when driving mode starts.

Battery impact: almost zero.

2. When in the general area (2–10 km)
   Switch to periodic GPS, but slow:

Every 1–2 minutes is plenty.

Still use Fused Location Provider, but request high accuracy only briefly.

Battery impact: very low.

3. When close to home (< 500–800 m)
   Switch to high‑frequency GPS:

Every 5–10 seconds

This is where you detect arrival and trigger the gate.

Battery impact: moderate, but only for a short time.

4. After the event
   Gate opens → stop high‑frequency GPS.

Disable driving mode.

Disconnect MQTT.

Return to low‑power state.

Battery impact: back to near zero.
