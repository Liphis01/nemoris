"""The first membership-set release has one unordered recall mode."""

SET_MODE_COLLECT_MEMBERS = "collect_members"
SET_MODES = (SET_MODE_COLLECT_MEMBERS,)


def normalize_set_mode(mode):
    return mode if mode in SET_MODES else SET_MODE_COLLECT_MEMBERS


def set_mode_difficulty(mode=None):
    normalize_set_mode(mode)
    return 1.0
