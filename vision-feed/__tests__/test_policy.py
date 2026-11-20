"""Tier 2 policy tests — pure stdlib, no model.

Tracks in, semantic events out: `enter` once, `dwell` once past the threshold,
`leave` after the miss TTL, and nothing for an uninteresting class. The threshold
is per class (`dwell_by_class`), because one camera may run several modes.

Three of these pin the enter/leave fix: `None` (the detector did not look) is not an
empty room, a track carried across a miss (`matched=False`) is alive but must not
postpone its own `leave`, and an `enter` needs `confirm_looks` confirmed frames — one
look is not a visit, and a track that never reaches the confirmation is dropped in
silence (a `leave` for a visit nobody was told about is a phantom event).
"""
from dataclasses import dataclass

from pipeline.policy import PolicyEngine


@dataclass
class T:
    id: int
    cls: str
    #: False on a track the tracker carried across a miss (see `track.py`).
    matched: bool = True


def _enter(p, at: float, tracks) -> list:
    """The `enter` a track gets on its **first confirmed look**.

    The default is `confirm_looks=1` (measured: the detector reports a still person in
    single-frame bursts, so asking for two looks left real visits unannounced), and the
    rule itself has its own tests below.
    """
    return p.update(at, tracks)


def test_enter_dwell_leave():
    p = PolicyEngine(classes={'person'}, dwell_s=10.0, miss_ttl_s=1.0)
    assert [e.kind for e in _enter(p, 0.0, [T(1, 'person')])] == ['enter']
    assert p.update(5.0, [T(1, 'person')]) == []  # present, not yet dwelling
    dwell = p.update(10.0, [T(1, 'person')])
    assert [e.kind for e in dwell] == ['dwell']
    assert p.update(20.0, [T(1, 'person')]) == []  # dwell fires once
    left = p.update(25.0, [])  # gone longer than the TTL
    assert [e.kind for e in left] == ['leave']


def test_the_shipped_default_announces_on_the_first_look():
    """The knob's default, pinned: one confirmed frame is a visit.

    It was 2 in the first cut of this fix, and the live trace is what changed it: with
    `confirm_looks=2`, a person the detector reported once and then carried for 15+
    frames stayed on `pending #1:1` and was **never announced** — the opposite failure of
    churn, and the worse one for a `presence` automation.
    """
    import config

    assert config.ENTER_CONFIRM_LOOKS == 1
    p = PolicyEngine(classes={'person'}, dwell_s=10.0, miss_ttl_s=1.0)
    assert [e.kind for e in p.update(0.0, [T(1, 'person')])] == ['enter']


def test_two_looks_can_be_demanded_from_a_noisy_camera():
    """`confirm_looks=2`: a single false detection must not announce a visit.

    The knob is kept for a detector that reports ghosts — and a track that never reaches
    the count is dropped in **silence**: no `leave` for a visit nobody was told about.
    """
    p = PolicyEngine(
        classes={'person'}, dwell_s=10.0, miss_ttl_s=1.0, confirm_looks=2
    )
    assert p.update(0.0, [T(1, 'person')]) == []
    assert [e.kind for e in p.update(0.1, [T(1, 'person')])] == ['enter']

    q = PolicyEngine(
        classes={'person'}, dwell_s=10.0, miss_ttl_s=1.0, confirm_looks=2
    )
    assert q.update(0.0, [T(1, 'person')]) == []  # one look only...
    assert q.update(5.0, []) == []  # ...and the drop is silent


def test_a_blink_does_not_postpone_the_enter():
    """The count is of *confirmations*, never of consecutive frames.

    A detector that blinks between two looks must not keep a real person waiting: the
    carried frame is not evidence either way, so it neither counts nor resets.
    """
    p = PolicyEngine(
        classes={'person'}, dwell_s=10.0, miss_ttl_s=1.0, confirm_looks=2
    )
    assert p.update(0.0, [T(1, 'person')]) == []
    assert p.update(0.1, [T(1, 'person', matched=False)]) == []
    assert [e.kind for e in p.update(0.2, [T(1, 'person')])] == ['enter']


def test_pending_names_the_tracks_short_of_their_enter():
    """What the debug UI needs: an enter that has not fired is not a blind camera."""
    p = PolicyEngine(
        classes={'person'}, dwell_s=10.0, miss_ttl_s=1.0, confirm_looks=2
    )
    p.update(0.0, [T(1, 'person')])
    assert p.pending() == {1: 1}
    p.update(0.1, [T(1, 'person')])
    assert p.pending() == {}
    assert p.snapshot(0.2)[1]['entered'] is True


def test_uninteresting_class_is_ignored():
    p = PolicyEngine(classes={'person'}, dwell_s=1.0, miss_ttl_s=1.0)
    assert p.update(0.0, [T(2, 'cat')]) == []


def test_empty_classes_tracks_everything():
    p = PolicyEngine(classes=(), dwell_s=1.0, miss_ttl_s=1.0)
    assert [e.kind for e in _enter(p, 0.0, [T(3, 'dog')])] == ['enter']


def test_per_class_dwell_beats_the_default():
    """Two modes on one camera: `person` at 3 s, the rest at the default."""
    p = PolicyEngine(
        classes={'person', 'cat'},
        dwell_by_class={'person': 3.0},
        dwell_s=15.0,
        miss_ttl_s=1.0,
    )
    both = [T(1, 'person'), T(2, 'cat')]
    assert [e.kind for e in _enter(p, 0.0, both)] == ['enter', 'enter']

    # `person` has its own row: it dwells at 3 s, and only once.
    assert [e.kind for e in p.update(3.0, both)] == ['dwell']
    assert p.update(10.0, both) == []

    # The class with no row waits for the default.
    assert [e.kind for e in p.update(15.0, both)] == ['dwell']


def test_dwell_by_class_drops_unusable_values():
    """A missing, zero or non-numeric row falls back to the default."""
    p = PolicyEngine(
        classes=(),
        dwell_by_class={'person': 0, 'cat': 'soon', 'dog': -2},
        dwell_s=5.0,
    )
    assert p.dwell_for('person') == 5.0
    assert p.dwell_for('cat') == 5.0
    assert p.dwell_for('dog') == 5.0
    assert p.dwell_for('bird') == 5.0


def test_no_information_is_not_an_empty_room():
    """`None` = the detector did not look: no `leave`, and the miss clock stands still.

    Half of the churn fix: `[]` starts the miss clock, `None` must not. And it never
    resets it either — so the first authoritative absence (long past the TTL since the
    last confirmation) retires the track at once, instead of waiting for the *next*
    burst to last a whole TTL.
    """
    p = PolicyEngine(classes={'person'}, dwell_s=10.0, miss_ttl_s=1.0)
    assert [e.kind for e in _enter(p, 0.0, [T(1, 'person')])] == ['enter']

    assert p.update(5.0, None) == []
    assert p.update(20.0, None) == []
    # ...and it never leaves on its own: only an authoritative frame can retire it.
    assert p.update(600.0, None) == []
    assert [e.kind for e in p.update(600.5, [])] == ['leave']


def test_a_dwell_needs_evidence_within_the_miss_ttl():
    """A `dwell` is "they are still here" — so it needs a recent confirmation.

    A track nobody has confirmed for longer than the TTL is on its way out, and the
    wall clock alone (a stream gap counts towards it) must not turn an empty room into
    a lingering presence: the `presence` mode escalates a `dwell`, i.e. a VLM call on
    nobody.
    """
    p = PolicyEngine(classes={'person'}, dwell_s=10.0, miss_ttl_s=1.0)
    _enter(p, 0.0, [T(1, 'person')])

    # A confirmation on the frame the threshold is crossed: the dwell is due.
    assert [e.kind for e in p.update(10.0, [T(1, 'person')])] == ['dwell']

    # The counter-proof: the same age, but nobody has confirmed them for 10 s.
    q = PolicyEngine(classes={'person'}, dwell_s=10.0, miss_ttl_s=1.0)
    _enter(q, 0.0, [T(1, 'person')])
    assert q.update(10.0, None) == []
    # ...and it fires as soon as someone looks again and still sees them.
    assert [e.kind for e in q.update(10.5, [T(1, 'person')])] == ['dwell']


def test_an_unconfirmed_track_does_not_extend_its_own_leave():
    """A carried track is alive but unconfirmed: it must not postpone the leave.

    Otherwise a detector that blinks forever would keep someone "present" for as
    long as it blinked, while the tracker's TTL has long retired the id.
    """
    p = PolicyEngine(classes={'person'}, dwell_s=10.0, miss_ttl_s=1.0)
    _enter(p, 0.0, [T(1, 'person')])

    for at in (0.5, 1.0, 1.5, 2.0):
        assert p.update(at, [T(1, 'person', matched=False)]) == []
    # `state.last` is still 0.1, so the leave is due one TTL after the last *match*.
    assert [e.kind for e in p.update(2.1, [])] == ['leave']


def test_a_matched_track_does_extend_it():
    """The counter-proof: a confirmed track is present, so its clock moves."""
    p = PolicyEngine(classes={'person'}, dwell_s=10.0, miss_ttl_s=1.0)
    _enter(p, 0.0, [T(1, 'person')])
    for at in (0.5, 1.0, 1.5, 2.0):
        assert p.update(at, [T(1, 'person')]) == []
    assert p.update(2.1, []) == []  # 0.1 s since the last match: still here
    assert [e.kind for e in p.update(3.2, [])] == ['leave']
