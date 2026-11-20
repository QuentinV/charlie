"""`config`: the token file the brain writes, the model resolution and the clamps.

The watchdog rate is not just read from the environment: it is clamped to stay
under the miss TTL, because a look interval longer than the TTL retires a person
standing still (see `pipeline/loop.py#look_fps`). The reopen bounds are pinned too:
a hiccup must not cost half a minute of blindness.
"""
import config


def test_reads_the_token_file(monkeypatch, tmp_path):
    token_file = tmp_path / 'vision-feed.token'
    token_file.write_text('  chk_file\n', encoding='utf-8')

    monkeypatch.setattr(config, 'BRAIN_TOKEN_FILE', str(token_file))
    monkeypatch.setattr(config, 'BRAIN_TOKEN_FILE_FALLBACK', str(tmp_path / 'x'))

    assert config.brain_token() == 'chk_file'


def test_missing_files_are_empty(monkeypatch, tmp_path):
    monkeypatch.setattr(config, 'BRAIN_TOKEN_FILE', str(tmp_path / 'a.token'))
    monkeypatch.setattr(config, 'BRAIN_TOKEN_FILE_FALLBACK', str(tmp_path / 'b.token'))

    assert config.brain_token() == ''


def test_gesture_model_prefers_the_env_var(monkeypatch, tmp_path):
    override = tmp_path / 'custom.task'
    override.write_bytes(b'x')
    local = tmp_path / 'models'
    local.mkdir()
    (local / 'gesture_recognizer.task').write_bytes(b'x')

    monkeypatch.setattr(config, 'GESTURE_MODEL', str(override))
    monkeypatch.setattr(config, 'MODEL_DIR', str(local))
    monkeypatch.setattr(config, 'BAKED_MODEL_DIR', str(tmp_path / 'baked'))

    assert config.resolve_gesture_model() == str(override)


def test_gesture_model_prefers_the_checkout_over_the_baked_copy(
    monkeypatch, tmp_path
):
    local = tmp_path / 'models'
    local.mkdir()
    wanted = local / 'gesture_recognizer.task'
    wanted.write_bytes(b'x')
    baked = tmp_path / 'baked'
    baked.mkdir()
    (baked / 'gesture_recognizer.task').write_bytes(b'x')

    monkeypatch.setattr(config, 'GESTURE_MODEL', None)
    monkeypatch.setattr(config, 'MODEL_DIR', str(local))
    monkeypatch.setattr(config, 'BAKED_MODEL_DIR', str(baked))

    assert config.resolve_gesture_model() == str(wanted)


def test_gesture_model_falls_back_to_the_default_path(monkeypatch, tmp_path):
    # Nothing exists: the returned path is the one the feed names in its message.
    monkeypatch.setattr(config, 'GESTURE_MODEL', None)
    monkeypatch.setattr(config, 'MODEL_DIR', str(tmp_path / 'empty'))
    monkeypatch.setattr(config, 'BAKED_MODEL_DIR', str(tmp_path / 'baked'))

    assert config.resolve_gesture_model() == str(
        tmp_path / 'empty' / 'gesture_recognizer.task'
    )


def test_the_watchdog_rate_cannot_outlive_the_miss_ttl():
    """The invariant: at least two looks per TTL, whatever the environment asked.

    A look interval longer than the TTL would retire a person standing still
    *between two looks* — a new id and a phantom `enter`, which is exactly the churn
    this rate exists to prevent.
    """
    assert config._watchdog_fps(1.0, 2.0) == 1.0  # the default, already safe
    assert config._watchdog_fps(0.1, 2.0) == 1.0  # too slow: raised
    assert config._watchdog_fps(1.0, 1.0) == 2.0  # a shorter TTL needs faster looks
    assert config._watchdog_fps(0.5, 0.0) == 0.5  # no TTL to protect


def test_the_reopen_backoff_is_bounded_and_short():
    """A hiccup must not blind the camera: the cap is seconds, not half a minute."""
    assert 0 < config.REOPEN_MIN_S <= config.REOPEN_MAX_S
    assert config.REOPEN_MAX_S <= 5.0
