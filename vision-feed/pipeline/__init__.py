"""The vision-feed cascade: gate → detect → track → policy.

Only `gate` and `policy` are pure (numpy / stdlib) so they are unit-testable
without OpenCV or a model. `sources`, `detect` and `track` import their heavy
dependencies lazily, so importing this package never requires them.
"""
