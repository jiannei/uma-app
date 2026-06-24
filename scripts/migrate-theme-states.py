#!/usr/bin/env python3
"""
One-time migration: convert theme.json states from upstream array form
(`"idle": ["uma-idle-follow.svg"]`) to our object form
(`"idle": {"file": "uma-idle-follow.svg", "type": "svg"}`).

Background: upstream uses arrays to support cycling animations per
state (multiple files for one state). We simplified to single-file-
per-state with an explicit type. pet.html's inlined theme already
uses the object form, but the on-disk theme.json still had the
upstream array form from the move (themes/ → public/themes/), causing
the dev panel's ThemeEditor to see empty file/type fields.

Idempotent: skips states that are already objects.
"""
import json
import sys
from pathlib import Path

THEMES_DIR = Path("public/themes")


def ext_to_type(filename: str) -> str:
    if filename.lower().endswith(".apng"):
        return "apng"
    return "svg"


def migrate_states(states) -> bool:
    """In-place convert array-form state defs to object form. Returns
    whether any change was made. Walks nested state dicts (e.g.
    `miniMode.states`) too."""
    if not isinstance(states, dict):
        return False
    changed = False
    for state, defn in list(states.items()):
        if isinstance(defn, list):
            if not defn:
                continue
            # Multi-file: take the first as the primary, drop the
            # rest (we don't support cycling yet). Originals live
            # in git history.
            primary = defn[0]
            states[state] = {
                "file": primary,
                "type": ext_to_type(primary),
            }
            changed = True
        elif isinstance(defn, dict):
            # Recurse — handles nested state dicts.
            if migrate_states(defn):
                changed = True
    return changed


def walk_and_migrate(node, changed_ref):
    """Walk the JSON tree and migrate any state dict (mapping
    state name → array/file-def-object) we find. Recurses through
    nested dicts and lists. `changed_ref` is a [bool] so we can
    flag changes from deep inside the recursion."""
    if isinstance(node, dict):
        # Is this a state dict? Heuristic: values are arrays of
        # strings, OR objects with {file, type}. Mix of those → it's
        # a state dict.
        is_state_dict = bool(node) and all(
            isinstance(v, (list, dict))
            and (
                (isinstance(v, list) and all(isinstance(x, str) for x in v))
                or (isinstance(v, dict) and ("file" in v or "type" in v))
            )
            for v in node.values()
        )
        if is_state_dict:
            if migrate_states(node):
                changed_ref[0] = True
            return
        for v in node.values():
            walk_and_migrate(v, changed_ref)
    elif isinstance(node, list):
        for v in node:
            walk_and_migrate(v, changed_ref)


def migrate_theme(path: Path) -> bool:
    data = json.loads(path.read_text())
    changed_ref = [False]
    walk_and_migrate(data, changed_ref)
    if changed_ref[0]:
        path.write_text(json.dumps(data, indent=2) + "\n")
        print(f"migrated {path}")
    else:
        print(f"already object form: {path}")
    return changed_ref[0]


def main() -> int:
    if not THEMES_DIR.is_dir():
        print(f"themes dir not found: {THEMES_DIR}", file=sys.stderr)
        return 1
    count = 0
    for theme_json in THEMES_DIR.glob("*/theme.json"):
        if migrate_theme(theme_json):
            count += 1
    print(f"\n{count} theme(s) migrated")
    return 0


if __name__ == "__main__":
    sys.exit(main())
