"""The two first grid presentations share the normal card difficulty."""

GRID_MODE_FILL_CELL = "fill_cell"
GRID_MODE_FILL_ROW = "fill_row"
GRID_MODES = (GRID_MODE_FILL_CELL, GRID_MODE_FILL_ROW)


def normalize_grid_mode(mode):
    return mode if mode in GRID_MODES else GRID_MODE_FILL_CELL


def grid_mode_difficulty(mode=None):
    normalize_grid_mode(mode)
    return 1.0
