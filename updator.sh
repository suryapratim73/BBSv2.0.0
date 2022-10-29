#!/bin/bash

mode=${1:-1}

elevate(){
    local funcName=$1 args_q=""
    for i in $(seq 2 $#);do
        args_q="$args_q ${!i}"
    done
    # Below code to grant SU access to install function
    pkexec bash -c "$(declare -f $funcName);$funcName $args_q"
}

install(){
    case $1 in
        1 | -o)
            echo "Post-Install Mode" >> "$2/.config/BBS/logs/appLogs.txt"

            echo "Creating sym link" >> "$2/.config/BBS/logs/appLogs.txt"
            bash -c "ln -s /opt/Bigbyte\ Business\ Service/resources/app/launcher /usr/bin/bbs"
            #bash -c ""
            # Create service for electron app
            #bash -c "ls /root/"
            ;;
        2 | -u)
            echo "Post-Update Mode" >> "$2/.config/BBS/logs/appLogs.txt"
            bash -c "
                    dpkg -i $2/.config/BBS/bbs_$3_amd64.deb >> $2/.config/BBS/logs/appLogs.txt 2>&1
            "
            echo "Update complete" >> "$2/.config/BBS/logs/appLogs.txt"
            ;;
    esac
}
usr=$(who | awk '{print $1}')
#echo $cwd >> "/home/$usr/.config/BBS/logs/appLogs.txt"



if [[ $mode -eq 2 || $mode -eq "-u" ]];then
    if [[ $(id -u) == 0 ]];then
        install $mode "/home/$usr" $2
    else
        elevate install $mode "/home/$usr" $2
    fi
    echo "Launching BBS" >> "/home/$usr/.config/BBS/logs/appLogs.txt"
    bash -c "sudo -u $usr bbs msg='Update complete.'"
else
    install 1 "/home/$usr" $@
fi