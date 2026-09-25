"""Deck options (presets), through the same calls as Anki's deck options screen.

`get_deck_configs_for_update` / `update_deck_configs` are what Anki desktop's
own options page uses. Everything this module doesn't edit (per-deck limit
overrides, the card state customizer, FSRS parameters…) is passed back
unchanged.

Presets are never deleted here: removing one marks the collection's schema
as modified, which would force a one-way sync.
"""

from __future__ import annotations

from typing import Any

from anki.collection import Collection
from anki.deck_config_pb2 import DeckConfig, UpdateDeckConfigsMode, UpdateDeckConfigsRequest

from .decks import deck_name
from .types import DeckOptions, DeckOptionsConfig, DeckPreset

# Editable fields and their allowed ranges (Anki's own limits, or a sane cap).
_INT_RANGES: dict[str, tuple[int, int]] = {
    "new_per_day": (0, 9999),
    "reviews_per_day": (0, 99999),
    "graduating_interval_good": (1, 36500),
    "graduating_interval_easy": (1, 36500),
    "leech_threshold": (1, 99),
    "minimum_lapse_interval": (1, 36500),
    "maximum_review_interval": (1, 36500),
    "cap_answer_time_to_secs": (30, 7200),
}
_FLOAT_RANGES: dict[str, tuple[float, float]] = {
    "initial_ease": (1.31, 5.0),
    "easy_multiplier": (1.0, 5.0),
    "hard_multiplier": (0.5, 1.3),
    "lapse_multiplier": (0.0, 1.0),
    "interval_multiplier": (0.5, 2.0),
    "desired_retention": (0.70, 0.99),
}
_ENUMS: dict[str, Any] = {
    "new_card_insert_order": DeckConfig.Config.NewCardInsertOrder,
    "leech_action": DeckConfig.Config.LeechAction,
    "new_card_gather_priority": DeckConfig.Config.NewCardGatherPriority,
    "new_card_sort_order": DeckConfig.Config.NewCardSortOrder,
    "new_mix": DeckConfig.Config.ReviewMix,
    "interday_learning_mix": DeckConfig.Config.ReviewMix,
    "review_order": DeckConfig.Config.ReviewCardOrder,
}
_BOOLS = ("bury_new", "bury_reviews", "bury_interday_learning", "show_timer", "disable_autoplay")
_STEPS = ("learn_steps", "relearn_steps")
MAX_STEP_MINUTES = 365 * 24 * 60


def deck_options(col: Collection, deck_id: int) -> DeckOptions:
    deck_name(col, deck_id)
    if col.decks.is_filtered(deck_id):  # type: ignore[arg-type]
        raise ValueError("Filtered decks don’t have options presets; edit the filtered deck instead.")
    data = col.decks.get_deck_configs_for_update(deck_id)  # type: ignore[arg-type]
    current = data.current_deck.config_id
    by_id = {c.config.id: c for c in data.all_config}
    return DeckOptions(
        deck_id=deck_id,
        deck_name=data.current_deck.name,
        preset_id=current,
        presets=sorted(
            (DeckPreset(id=c.config.id, name=c.config.name, use_count=c.use_count) for c in data.all_config),
            key=lambda p: p.name.lower(),
        ),
        config=_to_dataclass(by_id[current].config.config),
        fsrs=data.fsrs,
        has_children=bool(col.decks.children(deck_id)),  # type: ignore[arg-type]
    )


def update_deck_options(
    col: Collection,
    deck_id: int,
    *,
    preset_id: int,
    changes: dict[str, Any],
    rename_preset: str | None = None,
    new_preset_name: str | None = None,
    fsrs: bool | None = None,
    apply_to_children: bool = False,
) -> DeckOptions:
    """Save option changes to a preset and use it for this deck (undoable).

    `new_preset_name` saves the settings as a new preset (a copy of
    `preset_id` plus `changes`) instead of changing `preset_id`.
    """
    current = deck_options(col, deck_id)  # also validates the deck
    data = col.decks.get_deck_configs_for_update(deck_id)  # type: ignore[arg-type]
    source = next((c.config for c in data.all_config if c.config.id == preset_id), None)
    if source is None:
        raise ValueError("That preset doesn’t exist any more.")

    target = DeckConfig()
    target.CopyFrom(source)
    if new_preset_name is not None:
        target.id = 0  # Anki adds it as a new preset
        target.name = _preset_name(new_preset_name)
    elif rename_preset is not None:
        target.name = _preset_name(rename_preset)
    _apply(target.config, changes)

    request = UpdateDeckConfigsRequest(
        target_deck_id=deck_id,
        configs=[target],  # the last config is the one the deck uses
        removed_config_ids=[],  # never: removing presets forces a one-way sync
        mode=UpdateDeckConfigsMode.UPDATE_DECK_CONFIGS_MODE_APPLY_TO_CHILDREN
        if apply_to_children and current.has_children
        else UpdateDeckConfigsMode.UPDATE_DECK_CONFIGS_MODE_NORMAL,
        card_state_customizer=data.card_state_customizer,
        limits=data.current_deck.limits,
        new_cards_ignore_review_limit=data.new_cards_ignore_review_limit,
        fsrs=data.fsrs if fsrs is None else fsrs,
        apply_all_parent_limits=data.apply_all_parent_limits,
        fsrs_reschedule=False,
        fsrs_health_check=data.fsrs_health_check,
    )
    col.decks.update_deck_configs(request)
    return deck_options(col, deck_id)


def _preset_name(name: str) -> str:
    name = name.strip()
    if not name:
        raise ValueError("Give the preset a name.")
    return name[:120]


def _to_dataclass(c: DeckConfig.Config) -> DeckOptionsConfig:
    values: dict[str, Any] = {name: getattr(c, name) for name in DeckOptionsConfig.__dataclass_fields__}
    values["learn_steps"] = [round(s, 4) for s in c.learn_steps]
    values["relearn_steps"] = [round(s, 4) for s in c.relearn_steps]
    for name in _FLOAT_RANGES:
        values[name] = round(values[name], 4)
    return DeckOptionsConfig(**values)


def _apply(c: DeckConfig.Config, changes: dict[str, Any]) -> None:
    unknown = set(changes) - set(DeckOptionsConfig.__dataclass_fields__)
    if unknown:
        raise ValueError(f"unknown option(s): {', '.join(sorted(unknown))}")
    for name, value in changes.items():
        if name in _INT_RANGES:
            lo, hi = _INT_RANGES[name]
            v = int(value)
            if not lo <= v <= hi:
                raise ValueError(f"{_label(name)} must be between {lo} and {hi}.")
            setattr(c, name, v)
        elif name in _FLOAT_RANGES:
            lo_f, hi_f = _FLOAT_RANGES[name]
            f = float(value)
            if not lo_f <= f <= hi_f:
                raise ValueError(f"{_label(name)} must be between {lo_f:g} and {hi_f:g}.")
            setattr(c, name, f)
        elif name in _ENUMS:
            v = int(value)
            if v not in _ENUMS[name].values():
                raise ValueError(f"{_label(name)}: unknown choice.")
            setattr(c, name, v)
        elif name in _BOOLS:
            setattr(c, name, bool(value))
        elif name in _STEPS:
            steps = [float(s) for s in value]
            if len(steps) > 20 or any(not 0 < s <= MAX_STEP_MINUTES for s in steps):
                raise ValueError(f"{_label(name)}: each step must be more than 0 and at most a year.")
            if name == "learn_steps" and not steps:
                raise ValueError("Add at least one learning step, like 1m.")
            field = getattr(c, name)
            del field[:]
            field.extend(steps)


def _label(name: str) -> str:
    return name.replace("_", " ").capitalize()
