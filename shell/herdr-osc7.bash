# Bash version of the OSC7 reporter. See herdr-osc7.zsh for why this exists.
#
# Install: source this file from ~/.bashrc
#
#     source /path/to/herdr-radar/shell/herdr-osc7.bash

__herdr_osc7() {
  local win
  win=$(cygpath -m "$PWD" 2>/dev/null) || win="$PWD"
  printf '\033]7;file:///%s\033\\' "${win#/}"
}

# Prepend rather than replace: other tools put things here too.
case "$PROMPT_COMMAND" in
  *__herdr_osc7*) ;;
  *) PROMPT_COMMAND="__herdr_osc7${PROMPT_COMMAND:+; $PROMPT_COMMAND}" ;;
esac
