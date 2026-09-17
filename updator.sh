#!/bin/bash

mode=${1:-1}

elevate(){
    local funcName=$1
    shift
    # Grant SU access to the install function. Arguments are passed as
    # positional params so they are never embedded in the evaluated string.
    pkexec bash -c "$(declare -f $funcName); $funcName \"\$@\"" updator-sh "$@"
}

install(){
    case $1 in
        1 | -o)
            echo "Post-Install Mode" >> "$2/.config/BBS/logs/appLogs.txt"
            echo "Creating sym link" >> "$2/.config/BBS/logs/appLogs.txt"
            ln -s "/opt/Bigbyte Business Service/resources/app/launcher" /usr/bin/bbs
            ;;
        2 | -u)
            echo "Post-Update Mode" >> "$2/.config/BBS/logs/appLogs.txt"
            dpkg -i "$2/.config/BBS/bbs_$3_amd64.deb" >> "$2/.config/BBS/logs/appLogs.txt" 2>&1
            echo "Update complete" >> "$2/.config/BBS/logs/appLogs.txt"
            ;;
        *)
            echo "Default case"
    esac
}

# Resolve the desktop user and their home. The app launches this script as
# the logged-in user; `who` is only a fallback for when we run as root
# (deb postinst hook, where HOME is /root).
if [[ $(id -u) -eq 0 ]];then
    usr=$(who | awk '{print $1}' | head -n1)
    home="/home/$usr"
else
    usr=$(id -un)
    home="$HOME"
fi
logFile="$home/.config/BBS/logs/appLogs.txt"
if [[ -n "$usr" ]];then
    mkdir -p "$(dirname "$logFile")"
fi

if [[ "$mode" == "2" || "$mode" == "-u" ]];then
    # Defense in depth: only install a deb this user's app actually
    # downloaded - version must be a plain semver string and the file must
    # exist and be owned by the invoking user (guests can't feed us files).
    launchArgs=""
    if [[ "$2" =~ ^[0-9]+(\.[0-9]+)*$ ]];then
        debFile="$home/.config/BBS/bbs_$2_amd64.deb"
        if [[ $(id -u) -eq 0 ]] || { [[ -f "$debFile" ]] && [[ "$(stat -c %u "$debFile")" == "$(id -u)" ]]; };then
            if [[ $(id -u) == 0 ]];then
                install "$mode" "$home" "$2"
            else
                elevate install "$mode" "$home" "$2"
            fi
            if [[ $? -eq 0 ]];then
                # Install succeeded - notify the app via the protocol URL
                launchArgs="bbs://update-complete"
            fi
        else
            echo "Installer missing or not owned by current user: $debFile" >> "$logFile"
        fi
    else
        echo "Invalid version argument: $2" >> "$logFile"
    fi
    # Relaunch the app either way; without the URL when install didn't run
    echo "Launching BBS" >> "$logFile"
    launchCmd="bbs"
    command -v bbs >/dev/null 2>&1 || launchCmd="/opt/Bigbyte Business Service/bbs"
    if [[ $(id -u) -eq 0 && -n "$usr" ]];then
        runuser -u "$usr" -- nohup "$launchCmd" $launchArgs >> "$logFile" 2>&1 &
    else
        nohup "$launchCmd" $launchArgs >> "$logFile" 2>&1 &
    fi
else
    install 1 "$home" "$@"
fi

# Don't leave root-owned files in the user's home (postinst hook case)
if [[ $(id -u) -eq 0 && -n "$usr" ]];then
    chown -R "$usr:$usr" "$home/.config/BBS/logs" 2>/dev/null
fi
