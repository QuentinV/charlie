"""The gesture vocabulary table — the contract every other tier is filtered by.

A vocabulary that silently loses a row is worse than one that fails: `hits_from_gestures`
drops a name the table does not declare, so a typo in `gestures.json` is a sign that
simply never fires. That is why the parse errors are tested as messages (they name the
row), and why the shipped file is pinned against the built-in default — the two are the
same vocabulary or the build is broken.
"""
import json
import os

import config
import pytest

from pipeline import gesture_vocab

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def rows(*items):
    return {'names': list(items)}


def test_a_row_is_read_with_its_owner_and_its_score():
    vocabulary = gesture_vocab.parse_vocabulary(
        rows(
            {'name': 'Victory', 'source': 'model'},
            {'name': 'ILoveYou', 'source': 'model', 'enabled': False},
            {'name': 'Pinch', 'source': 'custom', 'score': 0.6},
        )
    )
    assert vocabulary.model_allow_list() == ['Victory']
    assert vocabulary.owns('ILoveYou') is True
    assert vocabulary.is_enabled('ILoveYou') is False
    assert vocabulary.custom_allow_list() == ['Pinch']
    assert vocabulary.score_for('Pinch', 0.35) == 0.6
    assert vocabulary.score_for('Victory', 0.35) == 0.35
    # The threshold of the trained classifier is the *lowest* custom row's floor, so no
    # trained label is unreachable because a sibling asked for a stricter one.
    assert vocabulary.custom_score_threshold(0.35) == 0.6


def test_a_bare_list_is_accepted():
    vocabulary = gesture_vocab.parse_vocabulary([{'name': 'Wave', 'source': 'motion'}])
    assert vocabulary.names_of('motion') == ('Wave',)


def test_every_broken_row_is_named():
    with pytest.raises(ValueError) as error:
        gesture_vocab.parse_vocabulary(rows({'name': 'Stop', 'source': 'ruels'}))
    assert "row 0 ('Stop') has source 'ruels'" in str(error.value)

    with pytest.raises(ValueError) as error:
        gesture_vocab.parse_vocabulary(
            rows({'name': 'Stop', 'source': 'rules'}, {'name': 'Stop', 'source': 'model'})
        )
    assert "row 1 ('Stop') repeats row 0" in str(error.value)

    with pytest.raises(ValueError) as error:
        gesture_vocab.parse_vocabulary(rows({'name': 'Stop', 'source': 'rules', 'score': 2}))
    assert "row 0 ('Stop') has score 2.0" in str(error.value)

    with pytest.raises(ValueError) as error:
        gesture_vocab.parse_vocabulary(rows({'source': 'rules'}))
    assert 'row 0 has no name' in str(error.value)

    with pytest.raises(ValueError):
        gesture_vocab.parse_vocabulary(rows())
    with pytest.raises(ValueError):
        gesture_vocab.parse_vocabulary('nonsense')


def test_the_shipped_table_is_the_built_in_default():
    """The file and `DEFAULT_ROWS` cannot drift.

    The file is what a deployment edits (it is mounted); the default is what runs when
    there is no file at all. Two vocabularies would mean two behaviours for one camera.
    """
    with open(os.path.join(REPO, 'gestures.json'), encoding='utf-8') as handle:
        shipped = gesture_vocab.parse_vocabulary(json.load(handle))
    assert shipped.names == gesture_vocab.DEFAULT_VOCABULARY.names


def test_the_shipped_vocabulary_is_the_four_sources():
    vocabulary = gesture_vocab.DEFAULT_VOCABULARY
    # The canned seven are all there (an automation may match them), with the one noisy
    # category disabled by default.
    assert set(vocabulary.names_of('model')) == {
        'Closed_Fist',
        'Open_Palm',
        'Pointing_Up',
        'Thumb_Down',
        'Thumb_Up',
        'Victory',
    }
    assert vocabulary.names_of('model', enabled_only=False)[-1] == 'ILoveYou'
    assert 'Stop' in vocabulary.names_of('rules')
    assert 'Wave' in vocabulary.names_of('motion')
    assert vocabulary.names_of('custom') == ()  # nothing is trained out of the box
    # No name is owned twice, and every row names a known source.
    names = [row.name for row in vocabulary.names]
    assert len(names) == len(set(names))
    assert {row.source for row in vocabulary.names} <= set(gesture_vocab.SOURCES)


def test_config_finds_the_table_and_the_default_when_there_is_none(monkeypatch, tmp_path):
    monkeypatch.setattr(config, '_GESTURES', None)
    monkeypatch.setattr(config, 'GESTURE_TABLE', str(tmp_path / 'missing.json'))
    monkeypatch.setattr(config, 'GESTURE_TABLE_FALLBACK', str(tmp_path / 'nope.json'))
    # `resolve_gesture_table` still finds the repo's own file (this checkout).
    assert config.resolve_gesture_table() == os.path.join(REPO, 'gestures.json')
    assert config.load_gestures().owns('Wave')

    # ...and with no file anywhere, the built-in default runs rather than no gestures.
    monkeypatch.setattr(
        config, 'resolve_gesture_table', lambda: ''
    )
    monkeypatch.setattr(config, '_GESTURES', None)
    assert config.load_gestures().names == gesture_vocab.DEFAULT_VOCABULARY.names


def test_a_broken_table_raises_and_names_the_row(monkeypatch, tmp_path):
    path = tmp_path / 'gestures.json'
    path.write_text(json.dumps(rows({'name': 'Stop', 'source': 'rules!'})), encoding='utf-8')
    monkeypatch.setattr(config, '_GESTURES', None)
    monkeypatch.setattr(config, 'resolve_gesture_table', lambda: str(path))
    with pytest.raises(ValueError) as error:
        config.load_gestures()
    assert "has source 'rules!'" in str(error.value)


def test_the_trained_classifier_is_absent_until_it_is_trained(monkeypatch, tmp_path):
    monkeypatch.setattr(config, 'GESTURE_CLASSIFIER', None)
    monkeypatch.setattr(config, 'MODEL_DIR', str(tmp_path))
    monkeypatch.setattr(config, 'BAKED_MODEL_DIR', str(tmp_path / 'baked'))
    assert config.resolve_gesture_classifier() == ''

    artifact = tmp_path / 'gesture_classifier.tflite'
    artifact.write_bytes(b'x')
    assert config.resolve_gesture_classifier() == str(artifact)
