# models/

Drop the trained `hey_charlie.tflite` here **only** if you choose the embedded-blob delivery
route. The default route flashes the model into the `model` partition and mmaps it at runtime,
so this folder stays empty in normal builds.

See `docs/wake-word-training.md` §6 for both delivery routes.
