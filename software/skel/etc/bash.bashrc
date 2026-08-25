# /etc/bash.bashrc — System-wide configuration for interactive bash(1) shells.
# Standardized OS Skeleton for SHAPER OS & UNIV Containers (Debian 13 Trixie / Podman)

# Disable software flow control (Ctrl+S / Ctrl+Q terminal freezing)
[[ $- == *i* ]] && stty -ixon

# If not running interactively, do nothing
[ -z "$PS1" ] && return

# ------------------------------------------------------------------------------
# 1. Shell Options & Window Geometry
# ------------------------------------------------------------------------------
shopt -s checkwinsize   # Update LINES and COLUMNS upon window resize
shopt -s histappend     # Append to history file instead of overwriting
shopt -s cdspell        # Autocorrect minor spelling errors in directory names
shopt -s cmdhist        # Save multi-line commands as single history entries

# ------------------------------------------------------------------------------
# 2. Auditable & Persistent History
# ------------------------------------------------------------------------------
export HISTCONTROL=ignoreboth:erasedups
export HISTSIZE=50000
export HISTFILESIZE=50000
export HISTTIMEFORMAT="%Y-%m-%d %H:%M:%S "
PROMPT_COMMAND="${PROMPT_COMMAND:+$PROMPT_COMMAND$'\n'}history -a"

# ------------------------------------------------------------------------------
# 3. Environment & Permissions
# ------------------------------------------------------------------------------
if [ "$(id -u)" = "0" ]; then
    umask 022
else
    umask 002
fi

# Set identifying chroot if running inside one
if [ -z "${debian_chroot:-}" ] && [ -r /etc/debian_chroot ]; then
    debian_chroot=$(cat /etc/debian_chroot)
fi

# Standard PATH expansions
[ -d "$HOME/bin" ] && PATH="$HOME/bin:$PATH"
[ -d "$HOME/.local/bin" ] && PATH="$HOME/.local/bin:$PATH"
export PATH

# ------------------------------------------------------------------------------
# 4. Interactive Bash Completion
# ------------------------------------------------------------------------------
if [ -f /usr/share/bash-completion/bash_completion ]; then
    . /usr/share/bash-completion/bash_completion
elif [ -f /etc/bash_completion ]; then
    . /etc/bash_completion
fi

# ------------------------------------------------------------------------------
# 5. Visual Prompt (PS1) — Red for Root / Green for User
# ------------------------------------------------------------------------------
if [ "$TERM" != "dumb" ]; then
    eval "$(dircolors -b 2>/dev/null)"
    
    C_RESET="\[\033[0m\]"
    C_BOLD="\[\033[1m\]"
    C_GREEN="\[\033[1;32m\]"
    C_RED="\[\033[1;31m\]"
    C_BLUE="\[\033[1;34m\]"
    C_GRAY="\[\033[0;90m\]"
    
    if [ "$(id -u)" = "0" ]; then
        PS1="${debian_chroot:+($debian_chroot)}${C_RED}\u${C_RESET}@${C_BOLD}\h${C_RESET}:${C_BLUE}\w${C_RED}#${C_RESET} "
    else
        PS1="${debian_chroot:+($debian_chroot)}${C_GREEN}\u${C_RESET}@${C_BOLD}\h${C_RESET}:${C_BLUE}\w${C_GREEN}\$${C_RESET} "
    fi
else
    PS1='${debian_chroot:+($debian_chroot)}\u@\h:\w\$ '
fi

# ------------------------------------------------------------------------------
# 6. Essential Aliases & Utilities
# ------------------------------------------------------------------------------
alias ls='ls --color=auto --quoting-style=shell'
alias ll='ls -lh'
alias la='ls -Ah'
alias lla='ls -lah'
alias llt='ls -lth'
alias lltr='ls -ltrh'
alias lld='ls -ldh */'
alias lldtr='ls -ldh -tr */'

# Directory Navigation
alias ..='cd ..'
alias ...='cd ../..'
alias ....='cd ../../..'
alias .....='cd ../../../..'

# Safety & Color Defaults
alias grep='grep --color=auto'
alias fgrep='fgrep --color=auto'
alias egrep='egrep --color=auto'
alias df='df -h'
alias free='free -m'
alias dmesg='dmesg -T'

# Infrastructure & Container Tooling
function maj() {
    apt-get update && apt-get dist-upgrade "$@" && apt-get clean
}
alias ports='ss -tulpn'
alias p='podman'
alias pps='podman ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"'

# Fast Search Helpers
function search() {
    grep -rn --color=auto --exclude-dir={node_modules,.git,dist,.tmp} "$@" .
}

function s() {
    sudo su -
}
