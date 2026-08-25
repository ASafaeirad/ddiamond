#!/usr/bin/env bash

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="${ADD_SKILL_DIR:-$HOME/.agents/skills}"
BIN_DIR="${ADD_BIN_DIR:-$HOME/.local/bin}"
CLAUDE_SKILL_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude/skills}"

mkdir -p "$SKILL_DIR" "$BIN_DIR" "$CLAUDE_SKILL_DIR"

for skill in dd-discover dd-diverge dd-converge; do
  ln -sfn "$REPO/skills/$skill" "$SKILL_DIR/$skill"
  ln -sfn "$SKILL_DIR/$skill" "$CLAUDE_SKILL_DIR/$skill"
  echo "skill  $CLAUDE_SKILL_DIR/$skill -> $SKILL_DIR/$skill -> $REPO/skills/$skill"
done

chmod +x "$REPO/src/ddiamond.ts"
ln -sfn "$REPO/src/ddiamond.ts" "$BIN_DIR/ddiamond"
echo "bin    $BIN_DIR/ddiamond -> $REPO/src/ddiamond.ts"

command -v deno >/dev/null || echo "warning: deno is not on PATH, dd needs it to run."

case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) echo "warning: $BIN_DIR is not on your PATH." ;;
esac

echo
echo "Done. Try: ddiamond --help"
